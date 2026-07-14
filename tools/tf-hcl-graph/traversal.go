package main

import (
	"fmt"

	"github.com/hashicorp/hcl/v2"
	"github.com/zclconf/go-cty/cty"
)

// toRange converts an hcl.Range into our wire-format Range.
func toRange(r hcl.Range) Range {
	return Range{
		File:        r.Filename,
		StartLine:   r.Start.Line,
		StartColumn: r.Start.Column,
		EndLine:     r.End.Line,
		EndColumn:   r.End.Column,
	}
}

// traversalString reconstructs a dotted-reference string from an
// hcl.Traversal (e.g. "azurerm_subnet.foo.id", "module.network.subnet_id",
// "each.value.address_prefixes"). hcl.Traversal doesn't hand callers a
// pre-joined string, so we walk each step ourselves:
//   - the first step is always TraverseRoot{Name}
//   - subsequent steps are TraverseAttr{Name} (".name") or
//     TraverseIndex{Key} ("[key]", rendered for common key value types)
func traversalString(t hcl.Traversal) string {
	out := ""
	for i, step := range t {
		switch s := step.(type) {
		case hcl.TraverseRoot:
			out += s.Name
		case hcl.TraverseAttr:
			out += "." + s.Name
		case hcl.TraverseIndex:
			out += indexString(s.Key)
		default:
			// Unknown step kind (shouldn't happen with current hcl/v2, but
			// don't drop information silently if the library ever adds one).
			out += fmt.Sprintf("<unknown-step-%d>", i)
		}
	}
	return out
}

// indexString renders a TraverseIndex's cty.Value key as "[...]" the way it
// would have appeared in source, for the common key types Terraform configs
// actually use (string and number). Falls back to a generic form for
// anything else rather than silently dropping the index.
func indexString(key cty.Value) string {
	if key.IsNull() || !key.IsKnown() {
		return "[<unknown>]"
	}
	ty := key.Type()
	switch {
	case ty == cty.String:
		return fmt.Sprintf("[%q]", key.AsString())
	case ty == cty.Number:
		bf := key.AsBigFloat()
		return "[" + bf.Text('f', -1) + "]"
	case ty == cty.Bool:
		if key.True() {
			return "[true]"
		}
		return "[false]"
	default:
		return "[<index>]"
	}
}
