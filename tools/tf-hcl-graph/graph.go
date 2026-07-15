package main

import (
	"path/filepath"
	"sort"

	"github.com/hashicorp/hcl/v2"
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
	var moduleCalls []moduleCallInstance // one per module-call *instance*, for the recursion pass below

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
				blocks = append(blocks, buildResourceLikeBlock(b, "resource")...)
			case "data":
				blocks = append(blocks, buildResourceLikeBlock(b, "data")...)
			case "module":
				moduleBlocks, callInstances := buildModuleBlocks(b)
				blocks = append(blocks, moduleBlocks...)
				moduleCalls = append(moduleCalls, callInstances...)
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

	for _, mci := range moduleCalls {
		mc := mci.block
		if len(mc.Labels) < 1 {
			continue
		}
		name := mc.Labels[0]
		// callChain (used only for the modules.json registry/git lookup
		// below) deliberately excludes the instance suffix - Terraform's own
		// modules.json keys a call by its declaration, not per-instance, since
		// every instance of the same for_each/count module call shares the
		// same resolved source.
		childPrefix := prefix + "module." + name + mci.suffix + "."
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
			// via a longer chain) would otherwise recurse forever. Distinct
			// for_each/count instances of the *same* call intentionally
			// re-enter the same childDir in separate, sequential top-level
			// calls below (each one's `visiting` entry is cleared via defer
			// before the next instance starts), so this never misfires
			// between sibling instances - only a genuine self-reference.
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

// buildResourceLikeBlock builds one Block per instance a resource/data block
// actually creates. Ordinarily (no for_each/count) that's a single Block at
// the plain `type.name` address, same as ever. When for_each/count is
// present *and* statically resolvable (see resourceInstances), it instead
// returns one Block per instance, each addressed exactly the way Terraform
// itself would (`type.name["key"]` / `type.name[0]`) - which, because
// traversalString() (traversal.go) already renders a real
// `type.name["key"].attr`-style reference the same way, means every
// existing cross-reference in this codebase (TS-side resolveReference's
// plain two-segment-prefix terminal match) resolves to these addresses with
// no further changes needed anywhere else. When the for_each/count value
// isn't statically knowable (e.g. driven by a variable), falls back to the
// single unindexed Block, unchanged from pre-expansion behavior.
func buildResourceLikeBlock(b *hclsyntax.Block, kind string) []Block {
	typ, name := "", ""
	if len(b.Labels) > 0 {
		typ = b.Labels[0]
	}
	if len(b.Labels) > 1 {
		name = b.Labels[1]
	}
	baseAddress := typ + "." + name
	if kind == "data" {
		baseAddress = "data." + baseAddress
	}

	instances, expandable := resourceInstances(b.Body)
	if !expandable {
		return []Block{{
			Kind:       kind,
			Type:       typ,
			Name:       name,
			Address:    baseAddress,
			Range:      blockRange(b),
			Attributes: collectAttributes(b.Body),
		}}
	}

	blocks := make([]Block, 0, len(instances))
	for _, inst := range instances {
		blocks = append(blocks, Block{
			Kind:       kind,
			Type:       typ,
			Name:       name + inst.suffix,
			Address:    baseAddress + inst.suffix,
			Range:      blockRange(b),
			Attributes: collectAttributesWithContext(b.Body, inst.ctx),
		})
	}
	return blocks
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

// moduleCallInstance pairs one "module" block with one specific instance's
// address suffix ("" when for_each/count isn't present or isn't statically
// resolvable - a single, unindexed instance, same as pre-expansion behavior)
// and the hcl.EvalContext that binds each.key/each.value/count.index for
// that instance, so the recursion pass below can build the right per-
// instance child prefix and evaluate this call's own attributes correctly.
type moduleCallInstance struct {
	block  *hclsyntax.Block
	suffix string
	ctx    *hcl.EvalContext
}

// buildModuleBlocks is buildResourceLikeBlock's counterpart for "module"
// blocks: ordinarily (no for_each/count) a single Block plus a single
// moduleCallInstance with an empty suffix, exactly matching pre-expansion
// behavior. When for_each/count is present and statically resolvable, one
// Block *and* one moduleCallInstance per instance instead - each instance
// gets its own recursion into the (shared) child module directory, with its
// own instance-specific address prefix, so its own resources are addressed
// module.name["key"].resource.foo rather than colliding under one shared
// module.name.* prefix.
func buildModuleBlocks(b *hclsyntax.Block) ([]Block, []moduleCallInstance) {
	name := ""
	if len(b.Labels) > 0 {
		name = b.Labels[0]
	}
	baseAddress := "module." + name

	instances, expandable := resourceInstances(b.Body)
	if !expandable {
		block := Block{
			Kind:       "module",
			Type:       "",
			Name:       name,
			Address:    baseAddress,
			Range:      blockRange(b),
			Attributes: collectAttributes(b.Body),
		}
		return []Block{block}, []moduleCallInstance{{block: b, suffix: ""}}
	}

	blocks := make([]Block, 0, len(instances))
	calls := make([]moduleCallInstance, 0, len(instances))
	for _, inst := range instances {
		blocks = append(blocks, Block{
			Kind:       "module",
			Type:       "",
			Name:       name + inst.suffix,
			Address:    baseAddress + inst.suffix,
			Range:      blockRange(b),
			Attributes: collectAttributesWithContext(b.Body, inst.ctx),
		})
		calls = append(calls, moduleCallInstance{block: b, suffix: inst.suffix, ctx: inst.ctx})
	}
	return blocks, calls
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
		attr := buildAttribute(a, nil)
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
