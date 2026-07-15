package main

import (
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/hashicorp/hcl/v2"
	"github.com/hashicorp/hcl/v2/hclsyntax"
)

// listTFFiles returns the absolute paths of every "*.tf" file directly inside
// dir (non-recursive - Terraform doesn't merge subdirectories), sorted for
// deterministic output. "*.tf.json" (native JSON syntax) files are skipped -
// out of scope for v1 per the plan.
func listTFFiles(dir string) ([]string, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}
	var files []string
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		name := e.Name()
		if strings.HasSuffix(name, ".tf.json") {
			continue
		}
		if !strings.HasSuffix(name, ".tf") {
			continue
		}
		files = append(files, filepath.Join(dir, name))
	}
	sort.Strings(files)
	return files, nil
}

// parseFile parses a single .tf file with hclsyntax.ParseConfig and returns
// its body. The body may be non-nil (and partially usable) even when diags
// contains errors - hclsyntax does best-effort recovery, so callers should
// still walk whatever blocks were successfully parsed.
func parseFile(path string) (*hclsyntax.Body, hcl.Diagnostics, error) {
	src, err := os.ReadFile(path)
	if err != nil {
		return nil, nil, err
	}
	f, diags := hclsyntax.ParseConfig(src, path, hcl.InitialPos)
	if f == nil {
		return nil, diags, nil
	}
	body, ok := f.Body.(*hclsyntax.Body)
	if !ok {
		// Shouldn't happen for hclsyntax.ParseConfig, but don't panic if the
		// library ever returns a different Body implementation.
		return nil, diags, nil
	}
	return body, diags, nil
}

// diagsToErrors converts HCL diagnostics into our wire-format ParseError
// list.
func diagsToErrors(diags hcl.Diagnostics) []ParseError {
	var out []ParseError
	for _, d := range diags {
		if d.Severity != hcl.DiagError {
			continue
		}
		line := 0
		file := ""
		if d.Subject != nil {
			line = d.Subject.Start.Line
			file = d.Subject.Filename
		}
		out = append(out, ParseError{
			File:    file,
			Line:    line,
			Message: d.Summary + ": " + d.Detail,
		})
	}
	return out
}

// rangeLess gives a stable, deterministic ordering for attributes gathered
// out of a Go map (hclsyntax.Body.Attributes has no defined iteration order).
func rangeLess(a, b Range) bool {
	if a.File != b.File {
		return a.File < b.File
	}
	if a.StartLine != b.StartLine {
		return a.StartLine < b.StartLine
	}
	return a.StartColumn < b.StartColumn
}

// buildReferences walks every free variable reference in an expression
// (hcl.Expression.Variables() - Terraform Core's own correctly-scoped
// dependency-resolution mechanism: handles nested calls, for-expressions
// excluding their own bound iterator, conditionals, template interpolation,
// splats) and reconstructs each as a dotted string with its own source range.
func buildReferences(expr hcl.Expression) []Reference {
	vars := expr.Variables()
	if len(vars) == 0 {
		return []Reference{}
	}
	refs := make([]Reference, 0, len(vars))
	for _, v := range vars {
		refs = append(refs, Reference{
			Expression: traversalString(v),
			Range:      toRange(v.SourceRange()),
		})
	}
	return refs
}

// buildAttribute builds one Attribute. ctx is nil for an ordinary block;
// for a for_each/count instance block (see instances.go) it binds
// each.key/each.value or count.index to that instance's own value, so the
// instance's own literalAttributeValue can resolve an expression like
// `name = "st${each.key}"` to a real per-instance literal.
func buildAttribute(a *hclsyntax.Attribute, ctx *hcl.EvalContext) Attribute {
	value, _ := literalAttributeValue(a.Expr, ctx)
	return Attribute{
		Name:       a.Name,
		Range:      toRange(a.SrcRange),
		References: buildReferences(a.Expr),
		Value:      value,
	}
}

// collectAttributes flattens every attribute in body, plus every attribute
// found by recursing into body's own nested blocks (e.g. a resource's
// "security_rule { ... }" sub-block, or a "dynamic { content { ... } }"
// block) - nested blocks aren't graph nodes of their own, just structural
// containers, so their attributes belong to the same enclosing top-level
// Block. Sorted by source position for deterministic output (map iteration
// order in hclsyntax.Body.Attributes is not stable).
func collectAttributes(body *hclsyntax.Body) []Attribute {
	return collectAttributesWithContext(body, nil)
}

// collectAttributesWithContext is collectAttributes, but evaluating every
// attribute's literal Value against ctx instead of a bare nil context - see
// buildAttribute's doc comment.
func collectAttributesWithContext(body *hclsyntax.Body, ctx *hcl.EvalContext) []Attribute {
	if body == nil {
		return []Attribute{}
	}
	attrs := make([]Attribute, 0, len(body.Attributes))
	for _, a := range body.Attributes {
		attrs = append(attrs, buildAttribute(a, ctx))
	}
	for _, b := range body.Blocks {
		attrs = append(attrs, collectAttributesWithContext(b.Body, ctx)...)
	}
	sort.Slice(attrs, func(i, j int) bool { return rangeLess(attrs[i].Range, attrs[j].Range) })
	return attrs
}

func blockRange(b *hclsyntax.Block) Range {
	r := b.TypeRange
	if b.Body != nil {
		r.End = b.Body.SrcRange.End
	}
	// Prefer the true close-brace end when available for an exact end
	// position.
	if b.CloseBraceRange.Filename != "" {
		r.End = b.CloseBraceRange.End
	}
	return toRange(r)
}
