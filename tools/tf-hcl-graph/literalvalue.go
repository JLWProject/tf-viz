package main

import (
	"strings"

	"github.com/hashicorp/hcl/v2"
	"github.com/hashicorp/hcl/v2/hclsyntax"
	"github.com/zclconf/go-cty/cty"
)

// literalAttributeValue extracts a best-effort human-readable string
// representation of an attribute expression's value, generalizing
// literalStringValue (see modules.go) beyond plain strings. Tries the same
// fast general path first - Expression.Value(nil) succeeds for any
// expression that needs no variables or functions, true of any bare literal
// - falling back to the same single-part-template-wrapping-a-literal shape
// Value(nil) sometimes chokes on for a bare quoted string.
//
// Handles the shapes common to Terraform attributes worth surfacing as
// node detail: strings, numbers, bools, and lists/tuples/sets of strings
// (the common shape for CIDR/IP-space attributes like address_space /
// address_prefixes). Anything else - objects, maps, unknown/computed
// values, or expressions that need variables/functions - is not
// extractable and returns ("", false).
func literalAttributeValue(expr hcl.Expression) (string, bool) {
	v, diags := expr.Value(nil)
	if diags.HasErrors() {
		// Fallback: mirror literalStringValue's single-part template shape,
		// i.e. a bare quoted string like `account_tier = "Standard"`.
		tmpl, ok := expr.(*hclsyntax.TemplateExpr)
		if !ok || len(tmpl.Parts) != 1 {
			return "", false
		}
		lit, ok := tmpl.Parts[0].(*hclsyntax.LiteralValueExpr)
		if !ok {
			return "", false
		}
		v = lit.Val
	}
	return ctyValueToDetailString(v)
}

// ctyValueToDetailString renders a cty.Value into the human-readable form
// described on literalAttributeValue, or reports it isn't representable.
func ctyValueToDetailString(v cty.Value) (string, bool) {
	if !v.IsKnown() || v.IsNull() {
		return "", false
	}

	t := v.Type()
	switch {
	case t == cty.String:
		return v.AsString(), true

	case t == cty.Number:
		bf := v.AsBigFloat()
		return bf.Text('f', -1), true

	case t == cty.Bool:
		if v.True() {
			return "true", true
		}
		return "false", true

	case t.IsListType() || t.IsTupleType() || t.IsSetType():
		parts := make([]string, 0, 4)
		for it := v.ElementIterator(); it.Next(); {
			_, ev := it.Element()
			if !ev.IsKnown() || ev.IsNull() || ev.Type() != cty.String {
				// Mixed/non-string element - not a clean list-of-strings,
				// don't try to partially represent it.
				return "", false
			}
			parts = append(parts, ev.AsString())
		}
		if len(parts) == 0 {
			return "", false
		}
		return strings.Join(parts, ", "), true

	default:
		return "", false
	}
}
