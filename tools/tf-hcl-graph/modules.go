package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"

	"github.com/hashicorp/hcl/v2"
	"github.com/hashicorp/hcl/v2/hclsyntax"
	"github.com/zclconf/go-cty/cty"
)

// moduleRecord mirrors the relevant fields of one entry in the real
// ".terraform/modules/modules.json" file Terraform's own `terraform init`
// writes. The real schema wraps these in a top-level {"Modules": [...]}
// object, but some historical/vendored variants are a bare array, so we
// accept either.
type moduleRecord struct {
	Key string `json:"Key"`
	Dir string `json:"Dir"`
}

type modulesManifest struct {
	Modules []moduleRecord `json:"Modules"`
}

// moduleResolver best-effort resolves a module call's child directory: local
// relative paths are always honored; anything else (registry/git addresses,
// or expressions that aren't a plain literal) falls back to a cached parse of
// rootDir/.terraform/modules/modules.json, matching by dot-joined call-name
// chain, per the real Terraform CLI schema.
type moduleResolver struct {
	rootDir  string
	manifest *modulesManifest // nil until first lookup attempt; may stay nil if absent/unreadable
	loaded   bool
}

func newModuleResolver(rootDir string) *moduleResolver {
	return &moduleResolver{rootDir: rootDir}
}

func (mr *moduleResolver) loadManifest() {
	if mr.loaded {
		return
	}
	mr.loaded = true
	path := filepath.Join(mr.rootDir, ".terraform", "modules", "modules.json")
	data, err := os.ReadFile(path)
	if err != nil {
		return // no manifest, or unreadable - best-effort only, not an error
	}

	// Accept the real object-wrapped schema first.
	var obj modulesManifest
	if err := json.Unmarshal(data, &obj); err == nil && len(obj.Modules) > 0 {
		mr.manifest = &obj
		return
	}
	// Fall back to a bare-array shape, just in case.
	var arr []moduleRecord
	if err := json.Unmarshal(data, &arr); err == nil && len(arr) > 0 {
		mr.manifest = &modulesManifest{Modules: arr}
	}
}

// lookupManifestDir returns the directory recorded for the given dot-joined
// call-name chain (e.g. "foo" or "foo.bar"), if any, resolved relative to
// rootDir per the real modules.json schema.
func (mr *moduleResolver) lookupManifestDir(callChain string) (string, bool) {
	mr.loadManifest()
	if mr.manifest == nil {
		return "", false
	}
	for _, rec := range mr.manifest.Modules {
		if rec.Key == callChain {
			dir := rec.Dir
			if !filepath.IsAbs(dir) {
				dir = filepath.Join(mr.rootDir, dir)
			}
			return dir, true
		}
	}
	return "", false
}

// localSourceLiteral returns (relativePath, true) if the module block's
// "source" attribute is present and is (or reduces to) a plain string
// literal starting with "./" or "../" - a local relative-path module source
// that should be recursed into directly, no modules.json needed.
func localSourceLiteral(body *hclsyntax.Body) (string, bool) {
	attr, ok := body.Attributes["source"]
	if !ok {
		return "", false
	}
	str, ok := literalStringValue(attr.Expr)
	if !ok {
		return "", false
	}
	if strings.HasPrefix(str, "./") || strings.HasPrefix(str, "../") {
		return str, true
	}
	return "", false
}

// literalStringValue extracts a plain string literal out of an expression
// without needing an hcl.EvalContext, trying the fast general path first
// (Expression.Value(nil) succeeds for any expression that needs no variables
// or functions - true of any bare string literal), then falling back to
// inspecting the underlying hclsyntax node shape directly for the rare case
// Value(nil) errors despite the source being "obviously" a plain literal
// (e.g. a heredoc or template hclsyntax represents in a shape Value(nil)
// doesn't like).
func literalStringValue(expr hcl.Expression) (string, bool) {
	if v, diags := expr.Value(nil); !diags.HasErrors() {
		if v.IsKnown() && !v.IsNull() && v.Type() == cty.String {
			return v.AsString(), true
		}
		return "", false
	}

	// Fallback: a single-part template whose one part is itself a plain
	// string literal (LiteralValueExpr), which is what a bare quoted string
	// like `source = "./child"` desugars to in hclsyntax.
	if tmpl, ok := expr.(*hclsyntax.TemplateExpr); ok && len(tmpl.Parts) == 1 {
		if lit, ok := tmpl.Parts[0].(*hclsyntax.LiteralValueExpr); ok {
			if lit.Val.Type() == cty.String && lit.Val.IsKnown() && !lit.Val.IsNull() {
				return lit.Val.AsString(), true
			}
		}
	}
	return "", false
}
