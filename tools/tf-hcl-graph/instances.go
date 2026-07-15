package main

import (
	"math/big"

	"github.com/hashicorp/hcl/v2"
	"github.com/hashicorp/hcl/v2/hclsyntax"
	"github.com/zclconf/go-cty/cty"
)

// instance is one resolved for_each/count instance: the address/name suffix
// Terraform itself would use to address it (e.g. `["a"]` or `[0]`, via the
// same indexString() rendering traversalString() uses for a real reference
// to that instance - see traversal.go), and the hcl.EvalContext that binds
// each.key/each.value or count.index to this instance's own literal value,
// for evaluating this specific instance's own attribute literals.
type instance struct {
	suffix string
	ctx    *hcl.EvalContext
}

// resourceInstances inspects a resource/data block's own top-level body for
// a `for_each` or `count` meta-argument and, if its expression is a plain
// literal - Expression.Value(nil) succeeds, i.e. it doesn't need variables,
// other resources, or unknown/computed values to evaluate - expands it into
// the concrete instance list Terraform itself would create. Returns
// (nil, false) when there's no for_each/count at all, or its value can't be
// statically determined (e.g. `for_each = var.x`, or a set with non-string
// elements); callers should fall back to a single, unindexed block in that
// case, exactly matching pre-expansion behavior - deliberately fails closed
// rather than guess, since guessing wrong would draw a graph that doesn't
// match what `terraform plan` would actually create.
//
// Only ever consults body.Attributes directly (never nested blocks), so a
// nested `dynamic "x" { for_each = ... }` block's own, unrelated for_each is
// never mistaken for the enclosing resource's own - that's an existing,
// separate feature (see dynamic_block fixture/tests) this doesn't touch.
func resourceInstances(body *hclsyntax.Body) ([]instance, bool) {
	if attr, ok := body.Attributes["for_each"]; ok {
		return forEachInstances(attr.Expr)
	}
	if attr, ok := body.Attributes["count"]; ok {
		return countInstances(attr.Expr)
	}
	return nil, false
}

// forEachInstances handles the shapes Terraform itself accepts for
// for_each: a map (or HCL object-constructor literal, which cty types as an
// Object, not a Map, but exposes the same key/value ElementIterator) keyed
// by each.key/each.value, or a set of strings where each.key == each.value
// == the element itself.
//
// A bare list/tuple literal isn't itself valid for_each input - Terraform
// requires an explicit `toset(...)` conversion first, which is by far the
// most common real-world shape for a literal for_each (a plain map is far
// more usual for genuinely per-key values). `toset` isn't a core HCL
// function, so a plain Expression.Value(nil) can't evaluate a call to it at
// all (no Functions in a nil EvalContext) - rather than pull in a full
// Terraform-compatible function library for one conversion, this
// special-cases exactly that one shape: evaluate the call's own single
// argument as a literal, then treat its elements as a set directly (with
// its own dedup, since a literal list can contain duplicates a real set
// wouldn't).
func forEachInstances(expr hcl.Expression) ([]instance, bool) {
	if call, ok := expr.(*hclsyntax.FunctionCallExpr); ok && call.Name == "toset" && len(call.Args) == 1 {
		v, diags := call.Args[0].Value(nil)
		if diags.HasErrors() || v.IsNull() || !v.IsWhollyKnown() {
			return nil, false
		}
		if !v.Type().IsListType() && !v.Type().IsTupleType() && !v.Type().IsSetType() {
			return nil, false
		}
		return collectionForEachInstances(v)
	}

	v, diags := expr.Value(nil)
	if diags.HasErrors() || v.IsNull() || !v.IsWhollyKnown() {
		return nil, false
	}

	t := v.Type()
	switch {
	case t.IsMapType() || t.IsObjectType():
		return mapForEachInstances(v)
	case t.IsSetType():
		return collectionForEachInstances(v)
	default:
		return nil, false
	}
}

func mapForEachInstances(v cty.Value) ([]instance, bool) {
	out := []instance{}
	for it := v.ElementIterator(); it.Next(); {
		k, ev := it.Element()
		if k.Type() != cty.String {
			return nil, false
		}
		out = append(out, instance{
			suffix: indexString(k),
			ctx:    eachEvalContext(k.AsString(), ev),
		})
	}
	return out, true
}

// collectionForEachInstances handles a set (or, via the toset(...) unwrap
// above, a list/tuple treated as one) of strings, where each.key == each.value
// == the element itself. De-duplicates by key so a literal list containing a
// repeated element (which a real set/toset() would collapse) never produces
// two instances at the same address.
func collectionForEachInstances(v cty.Value) ([]instance, bool) {
	out := []instance{}
	seen := map[string]bool{}
	for it := v.ElementIterator(); it.Next(); {
		_, ev := it.Element()
		if ev.IsNull() || !ev.IsKnown() || ev.Type() != cty.String {
			return nil, false
		}
		key := ev.AsString()
		if seen[key] {
			continue
		}
		seen[key] = true
		out = append(out, instance{
			suffix: indexString(ev),
			ctx:    eachEvalContext(key, ev),
		})
	}
	return out, true
}

func eachEvalContext(key string, value cty.Value) *hcl.EvalContext {
	return &hcl.EvalContext{
		Variables: map[string]cty.Value{
			"each": cty.ObjectVal(map[string]cty.Value{
				"key":   cty.StringVal(key),
				"value": value,
			}),
		},
	}
}

// countInstances handles a literal, non-negative whole number - anything
// else (fractional, negative, or simply not statically known) isn't a valid
// count value Terraform itself would accept either, so it's treated the
// same as "not expandable".
func countInstances(expr hcl.Expression) ([]instance, bool) {
	v, diags := expr.Value(nil)
	if diags.HasErrors() || v.IsNull() || !v.IsWhollyKnown() || v.Type() != cty.Number {
		return nil, false
	}

	n, accuracy := v.AsBigFloat().Int64()
	if accuracy != big.Exact || n < 0 {
		return nil, false
	}

	out := make([]instance, 0, n)
	for i := int64(0); i < n; i++ {
		idx := cty.NumberIntVal(i)
		out = append(out, instance{
			suffix: indexString(idx),
			ctx: &hcl.EvalContext{
				Variables: map[string]cty.Value{
					"count": cty.ObjectVal(map[string]cty.Value{
						"index": idx,
					}),
				},
			},
		})
	}
	return out, true
}
