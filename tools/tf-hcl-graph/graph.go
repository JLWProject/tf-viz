package main

import (
	"path/filepath"
	"sort"

	"github.com/hashicorp/hcl/v2/hclsyntax"
)

// buildGraph parses rootDir as the root Terraform module and recurses into
// every local relative-path (or modules.json-resolved) child module,
// returning the full wire-format Output. Never returns an error itself -
// anything that goes wrong parsing individual files/blocks is captured as a
// ParseError entry so a broken config still yields a best-effort graph for
// everything else.
func buildGraph(rootDir string) Output {
	absRoot, err := filepath.Abs(rootDir)
	if err != nil {
		absRoot = rootDir
	}
	mr := newModuleResolver(absRoot)

	var out Output
	visiting := map[string]bool{}
	modules, errs := parseModuleRecursive(absRoot, "", "", mr, visiting)
	out.Modules = modules
	out.Errors = errs
	if out.Errors == nil {
		out.Errors = []ParseError{}
	}
	if out.Modules == nil {
		out.Modules = []Module{}
	}
	return out
}

// parseModuleRecursive parses one module directory (the root, or a resolved
// child) into a Module, then recurses into every "module" block found,
// appending each successfully-resolved child's own Module(s) to the returned
// slice (flat list - "prefix" carries the nesting, not a tree shape).
//
// prefix is this module's own address prefix ("" for root, "module.foo." for
// a first-level child, "module.foo.module.bar." for a nested one).
// callChain is the dot-joined call-name chain used to match this module
// against a .terraform/modules/modules.json entry ("" for root, "foo",
// "foo.bar", ...).
func parseModuleRecursive(dir string, prefix string, callChain string, mr *moduleResolver, visiting map[string]bool) ([]Module, []ParseError) {
	var allErrors []ParseError

	files, err := listTFFiles(dir)
	if err != nil {
		allErrors = append(allErrors, ParseError{File: dir, Line: 0, Message: "reading directory: " + err.Error()})
		return []Module{{Prefix: prefix, Directory: dir, Expanded: true, Blocks: []Block{}}}, allErrors
	}

	var blocks []Block
	var moduleCalls []*hclsyntax.Block // top-level "module" blocks, for the recursion pass below

	for _, path := range files {
		body, diags, err := parseFile(path)
		if err != nil {
			allErrors = append(allErrors, ParseError{File: path, Line: 0, Message: "reading file: " + err.Error()})
			continue
		}
		allErrors = append(allErrors, diagsToErrors(diags)...)
		if body == nil {
			continue
		}

		for _, b := range body.Blocks {
			switch b.Type {
			case "resource":
				blocks = append(blocks, buildResourceLikeBlock(b, "resource"))
			case "data":
				blocks = append(blocks, buildResourceLikeBlock(b, "data"))
			case "module":
				blocks = append(blocks, buildModuleBlock(b))
				moduleCalls = append(moduleCalls, b)
			case "output":
				blocks = append(blocks, buildNamedBlock(b, "output", "output."))
			case "variable":
				blocks = append(blocks, buildNamedBlock(b, "variable", "var."))
			case "locals":
				blocks = append(blocks, buildLocalsBlocks(b)...)
			default:
				// terraform/provider/check/etc. - out of scope for v1.
			}
		}
	}
	if blocks == nil {
		blocks = []Block{}
	}

	result := []Module{{Prefix: prefix, Directory: dir, Expanded: true, Blocks: blocks}}

	visiting[dir] = true
	defer delete(visiting, dir)

	for _, mc := range moduleCalls {
		if len(mc.Labels) < 1 {
			continue
		}
		name := mc.Labels[0]
		childPrefix := prefix + "module." + name + "."
		childCallChain := name
		if callChain != "" {
			childCallChain = callChain + "." + name
		}

		childDir, resolved := resolveModuleDir(dir, mc.Body, childCallChain, mr)
		if !resolved {
			// Opaque/unexpanded leaf: the module block itself was already
			// emitted above with its own attributes/references, but there
			// is no child scope to parse. Still record a Module entry with
			// expanded:false so the TS layer can tell "known opaque" apart
			// from "not a module at all".
			result = append(result, Module{Prefix: childPrefix, Directory: "", Expanded: false, Blocks: []Block{}})
			continue
		}
		if visiting[childDir] {
			// Cycle guard - a module graph referencing itself (directly or
			// via a longer chain) would otherwise recurse forever.
			allErrors = append(allErrors, ParseError{
				File:    dir,
				Line:    mc.TypeRange.Start.Line,
				Message: "module \"" + name + "\": cyclic module reference to " + childDir + ", not expanding",
			})
			result = append(result, Module{Prefix: childPrefix, Directory: childDir, Expanded: false, Blocks: []Block{}})
			continue
		}

		childModules, childErrors := parseModuleRecursive(childDir, childPrefix, childCallChain, mr, visiting)
		result = append(result, childModules...)
		allErrors = append(allErrors, childErrors...)
	}

	return result, allErrors
}

// resolveModuleDir implements the module-source resolution rules from the
// plan: a literal "./"/"../" source is resolved relative to the current
// directory; anything else falls back to a best-effort
// .terraform/modules/modules.json lookup keyed by the dot-joined call-name
// chain; if neither applies, the module is left unresolved (opaque leaf).
func resolveModuleDir(currentDir string, moduleBody *hclsyntax.Body, callChain string, mr *moduleResolver) (string, bool) {
	if rel, ok := localSourceLiteral(moduleBody); ok {
		return filepath.Clean(filepath.Join(currentDir, rel)), true
	}
	if dir, ok := mr.lookupManifestDir(callChain); ok {
		return dir, true
	}
	return "", false
}

func buildResourceLikeBlock(b *hclsyntax.Block, kind string) Block {
	typ, name := "", ""
	if len(b.Labels) > 0 {
		typ = b.Labels[0]
	}
	if len(b.Labels) > 1 {
		name = b.Labels[1]
	}
	address := typ + "." + name
	if kind == "data" {
		address = "data." + address
	}
	return Block{
		Kind:       kind,
		Type:       typ,
		Name:       name,
		Address:    address,
		Range:      blockRange(b),
		Attributes: collectAttributes(b.Body),
	}
}

// buildNamedBlock builds a Block for a single-label, no-type block kind
// (module/output/variable), addressed as addrPrefix+name.
func buildNamedBlock(b *hclsyntax.Block, kind string, addrPrefix string) Block {
	name := ""
	if len(b.Labels) > 0 {
		name = b.Labels[0]
	}
	return Block{
		Kind:       kind,
		Type:       "",
		Name:       name,
		Address:    addrPrefix + name,
		Range:      blockRange(b),
		Attributes: collectAttributes(b.Body),
	}
}

func buildModuleBlock(b *hclsyntax.Block) Block {
	return buildNamedBlock(b, "module", "module.")
}

// buildLocalsBlocks expands one `locals { foo = ..., bar = ... }` block (0
// labels, N attributes) into one synthetic Block per local name, per the
// wire-format contract - keeps the TS consumer's shape uniform rather than
// needing a locals-specific case.
func buildLocalsBlocks(b *hclsyntax.Block) []Block {
	if b.Body == nil {
		return nil
	}
	attrs := make([]*hclsyntax.Attribute, 0, len(b.Body.Attributes))
	for _, a := range b.Body.Attributes {
		attrs = append(attrs, a)
	}
	// Deterministic order: by source position (map iteration order isn't
	// stable).
	sortAttributesByRange(attrs)

	blocks := make([]Block, 0, len(attrs))
	for _, a := range attrs {
		attr := buildAttribute(a)
		blocks = append(blocks, Block{
			Kind:       "locals",
			Type:       "",
			Name:       a.Name,
			Address:    "local." + a.Name,
			Range:      attr.Range,
			Attributes: []Attribute{attr},
		})
	}
	return blocks
}

func sortAttributesByRange(attrs []*hclsyntax.Attribute) {
	sort.Slice(attrs, func(i, j int) bool {
		return rangeLess(toRange(attrs[i].SrcRange), toRange(attrs[j].SrcRange))
	})
}
