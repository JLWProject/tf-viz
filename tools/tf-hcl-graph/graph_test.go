package main

import (
	"path/filepath"
	"testing"
)

// --- helpers -----------------------------------------------------------

func moduleByPrefix(t *testing.T, out Output, prefix string) Module {
	t.Helper()
	for _, m := range out.Modules {
		if m.Prefix == prefix {
			return m
		}
	}
	t.Fatalf("no module with prefix %q in output; modules: %+v", prefix, out.Modules)
	return Module{}
}

func blockByAddress(t *testing.T, m Module, address string) Block {
	t.Helper()
	for _, b := range m.Blocks {
		if b.Address == address {
			return b
		}
	}
	t.Fatalf("no block with address %q in module %q; blocks: %+v", address, m.Prefix, m.Blocks)
	return Block{}
}

func attrByName(t *testing.T, b Block, name string) Attribute {
	t.Helper()
	for _, a := range b.Attributes {
		if a.Name == name {
			return a
		}
	}
	t.Fatalf("no attribute %q on block %q; attributes: %+v", name, b.Address, b.Attributes)
	return Attribute{}
}

func hasReference(refs []Reference, expr string) bool {
	for _, r := range refs {
		if r.Expression == expr {
			return true
		}
	}
	return false
}

func fixture(name string) string {
	return filepath.Join("testdata", name)
}

// --- fixture tests -------------------------------------------------------

func TestMultiFileMerge(t *testing.T) {
	out := buildGraph(fixture("multi_file"))
	if len(out.Errors) != 0 {
		t.Fatalf("unexpected errors: %+v", out.Errors)
	}
	root := moduleByPrefix(t, out, "")

	// 00_first.tf sorts before main.tf but references a resource declared in
	// main.tf - proves merging is file-order-independent.
	sibling := blockByAddress(t, root, "random_pet.sibling")
	prefixAttr := attrByName(t, sibling, "prefix")
	if !hasReference(prefixAttr.References, "random_pet.server.id") {
		t.Errorf("random_pet.sibling.prefix should reference random_pet.server.id, got %+v", prefixAttr.References)
	}

	config := blockByAddress(t, root, "local_file.config")
	filenameAttr := attrByName(t, config, "filename")
	if !hasReference(filenameAttr.References, "random_pet.server.id") {
		t.Errorf("local_file.config.filename should reference random_pet.server.id, got %+v", filenameAttr.References)
	}
	contentAttr := attrByName(t, config, "content")
	if !hasReference(contentAttr.References, "var.config_content") {
		t.Errorf("local_file.config.content should reference var.config_content, got %+v", contentAttr.References)
	}

	// outputs.tf references local_file.config, declared in main.tf.
	output := blockByAddress(t, root, "output.config_file")
	valueAttr := attrByName(t, output, "value")
	if !hasReference(valueAttr.References, "local_file.config.filename") {
		t.Errorf("output.config_file.value should reference local_file.config.filename, got %+v", valueAttr.References)
	}

	// variable blocks: real attributes (default/type/etc.) are captured just
	// like every other block kind - a variable's own default value is
	// legitimate node detail (see nodeDetail.ts's pickNodeDetail).
	v := blockByAddress(t, root, "var.config_content")
	defaultAttr := attrByName(t, v, "default")
	if defaultAttr.Value != "hello" {
		t.Errorf("expected var.config_content default.Value %q, got %q", "hello", defaultAttr.Value)
	}
}

func TestNestedModuleBothDirections(t *testing.T) {
	out := buildGraph(fixture("nested_module"))
	if len(out.Errors) != 0 {
		t.Fatalf("unexpected errors: %+v", out.Errors)
	}

	if len(out.Modules) != 2 {
		t.Fatalf("expected 2 modules (root + child), got %d: %+v", len(out.Modules), out.Modules)
	}

	root := moduleByPrefix(t, out, "")
	if !root.Expanded {
		t.Errorf("root module should be expanded")
	}

	// Root -> child: module "child" passes some_input derived from a root resource.
	moduleBlock := blockByAddress(t, root, "module.child")
	someInput := attrByName(t, moduleBlock, "some_input")
	if !hasReference(someInput.References, "random_pet.rg.id") {
		t.Errorf("module.child.some_input should reference random_pet.rg.id, got %+v", someInput.References)
	}

	// Child -> root: root's local_file.summary consumes module.child.some_output.
	summary := blockByAddress(t, root, "local_file.summary")
	content := attrByName(t, summary, "content")
	if !hasReference(content.References, "module.child.some_output") {
		t.Errorf("local_file.summary.content should reference module.child.some_output, got %+v", content.References)
	}

	// Child module itself: expanded, correctly prefixed, var.some_input used.
	child := moduleByPrefix(t, out, "module.child.")
	if !child.Expanded {
		t.Errorf("child module should be expanded (local relative-path source)")
	}
	childConfig := blockByAddress(t, child, "local_file.child_config")
	childFilename := attrByName(t, childConfig, "filename")
	if !hasReference(childFilename.References, "var.some_input") {
		t.Errorf("child local_file.child_config.filename should reference var.some_input, got %+v", childFilename.References)
	}

	childOutput := blockByAddress(t, child, "output.some_output")
	childOutputValue := attrByName(t, childOutput, "value")
	if !hasReference(childOutputValue.References, "local_file.child_config.filename") {
		t.Errorf("child output.some_output.value should reference local_file.child_config.filename, got %+v", childOutputValue.References)
	}
}

func TestLocalsResolution(t *testing.T) {
	out := buildGraph(fixture("locals"))
	if len(out.Errors) != 0 {
		t.Fatalf("unexpected errors: %+v", out.Errors)
	}
	root := moduleByPrefix(t, out, "")

	fooLocal := blockByAddress(t, root, "local.foo")
	if fooLocal.Kind != "locals" {
		t.Errorf("expected kind locals, got %q", fooLocal.Kind)
	}
	if len(fooLocal.Attributes) != 1 {
		t.Fatalf("expected exactly 1 attribute on synthetic locals block, got %+v", fooLocal.Attributes)
	}
	if !hasReference(fooLocal.Attributes[0].References, "random_pet.base.id") {
		t.Errorf("local.foo should reference random_pet.base.id, got %+v", fooLocal.Attributes[0].References)
	}

	unrelatedLocal := blockByAddress(t, root, "local.unrelated")
	if len(unrelatedLocal.Attributes[0].References) != 0 {
		t.Errorf("local.unrelated should have no references, got %+v", unrelatedLocal.Attributes[0].References)
	}

	usesLocal := blockByAddress(t, root, "local_file.uses_local")
	contentAttr := attrByName(t, usesLocal, "content")
	if !hasReference(contentAttr.References, "local.foo") {
		t.Errorf("local_file.uses_local.content should reference local.foo, got %+v", contentAttr.References)
	}
}

func TestDataSourceReference(t *testing.T) {
	out := buildGraph(fixture("data_source"))
	if len(out.Errors) != 0 {
		t.Fatalf("unexpected errors: %+v", out.Errors)
	}
	root := moduleByPrefix(t, out, "")

	dataBlock := blockByAddress(t, root, "data.azurerm_resource_group.existing")
	if dataBlock.Kind != "data" {
		t.Errorf("expected kind data, got %q", dataBlock.Kind)
	}
	if dataBlock.Type != "azurerm_resource_group" {
		t.Errorf("expected type azurerm_resource_group, got %q", dataBlock.Type)
	}

	vnet := blockByAddress(t, root, "azurerm_virtual_network.vnet")
	rgName := attrByName(t, vnet, "resource_group_name")
	if !hasReference(rgName.References, "data.azurerm_resource_group.existing.name") {
		t.Errorf("resource_group_name should reference data.azurerm_resource_group.existing.name, got %+v", rgName.References)
	}

	// A plain string literal attribute should get an extracted Value.
	nameAttr := attrByName(t, vnet, "name")
	if nameAttr.Value != "vnet-example" {
		t.Errorf("expected name.Value %q, got %q", "vnet-example", nameAttr.Value)
	}

	// A list-of-strings literal (the CIDR/"ip space" case) should be
	// comma-joined into a single readable Value.
	addressSpace := attrByName(t, vnet, "address_space")
	if addressSpace.Value != "10.0.0.0/16" {
		t.Errorf("expected address_space.Value %q, got %q", "10.0.0.0/16", addressSpace.Value)
	}

	// An attribute whose expression is derived from a reference (needs
	// variables to evaluate) is not a literal and must not get a Value.
	if rgName.Value != "" {
		t.Errorf("expected resource_group_name.Value to be empty for a reference-derived expression, got %q", rgName.Value)
	}
}

func TestForEachAndCountRawTraversals(t *testing.T) {
	out := buildGraph(fixture("for_each_count"))
	if len(out.Errors) != 0 {
		t.Fatalf("unexpected errors: %+v", out.Errors)
	}
	root := moduleByPrefix(t, out, "")

	// A literal for_each map expands into one Block per key, addressed
	// exactly the way Terraform itself (and a real reference to one specific
	// instance) would: `type.name["key"]` - see instances.go/traversal.go.
	eachA := blockByAddress(t, root, `azurerm_storage_account.each_example["a"]`)
	nameAttrA := attrByName(t, eachA, "name")
	if !hasReference(nameAttrA.References, "each.key") {
		t.Errorf("expected raw each.key traversal in name attribute, got %+v", nameAttrA.References)
	}
	// each.key/each.value are now bound to this specific instance's own
	// value, so the previously-unresolvable `"st${each.key}"` template
	// literal now resolves to a real per-instance value.
	if nameAttrA.Value != "sta" {
		t.Errorf(`expected each_example["a"]'s name Value to resolve to "sta" (each.key bound), got %q`, nameAttrA.Value)
	}
	locationAttrA := attrByName(t, eachA, "location")
	if !hasReference(locationAttrA.References, "each.value") {
		t.Errorf("expected raw each.value traversal in location attribute, got %+v", locationAttrA.References)
	}
	if locationAttrA.Value != "1" {
		t.Errorf(`expected each_example["a"]'s location Value to resolve to "1" (each.value bound), got %q`, locationAttrA.Value)
	}
	rgAttrA := attrByName(t, eachA, "resource_group_name")
	if !hasReference(rgAttrA.References, "azurerm_resource_group.rg.name") {
		t.Errorf("genuine resource reference should still be captured alongside each.*, got %+v", rgAttrA.References)
	}

	eachB := blockByAddress(t, root, `azurerm_storage_account.each_example["b"]`)
	nameAttrB := attrByName(t, eachB, "name")
	if nameAttrB.Value != "stb" {
		t.Errorf(`expected each_example["b"]'s name Value to resolve to "stb", got %q`, nameAttrB.Value)
	}

	// A literal count expands into one Block per index, 0-based, same
	// `type.name[N]` addressing convention.
	count0 := blockByAddress(t, root, "azurerm_storage_account.count_example[0]")
	countName0 := attrByName(t, count0, "name")
	if !hasReference(countName0.References, "count.index") {
		t.Errorf("expected raw count.index traversal in name attribute, got %+v", countName0.References)
	}
	if countName0.Value != "stcount0" {
		t.Errorf(`expected count_example[0]'s name Value to resolve to "stcount0" (count.index bound), got %q`, countName0.Value)
	}
	countRg0 := attrByName(t, count0, "resource_group_name")
	if !hasReference(countRg0.References, "azurerm_resource_group.rg.name") {
		t.Errorf("genuine resource reference should still be captured alongside count.*, got %+v", countRg0.References)
	}

	count1 := blockByAddress(t, root, "azurerm_storage_account.count_example[1]")
	countName1 := attrByName(t, count1, "name")
	if countName1.Value != "stcount1" {
		t.Errorf(`expected count_example[1]'s name Value to resolve to "stcount1", got %q`, countName1.Value)
	}

	// Exactly 2 + 2 instances, no leftover unindexed base-address block.
	for _, addr := range []string{"azurerm_storage_account.each_example", "azurerm_storage_account.count_example"} {
		for _, b := range root.Blocks {
			if b.Address == addr {
				t.Errorf("unindexed base address %q should not appear once expanded into instances", addr)
			}
		}
	}
}

func TestForEachSetOfStrings(t *testing.T) {
	out := buildGraph(fixture("for_each_set"))
	if len(out.Errors) != 0 {
		t.Fatalf("unexpected errors: %+v", out.Errors)
	}
	root := moduleByPrefix(t, out, "")

	// For a set, each.key == each.value == the element itself.
	web := blockByAddress(t, root, `azurerm_storage_account.set_example["web"]`)
	nameAttr := attrByName(t, web, "name")
	if nameAttr.Value != "stweb" {
		t.Errorf(`expected set_example["web"]'s name Value to resolve to "stweb", got %q`, nameAttr.Value)
	}
	blockByAddress(t, root, `azurerm_storage_account.set_example["db"]`)
}

func TestForEachCountDynamicFallback(t *testing.T) {
	out := buildGraph(fixture("for_each_dynamic"))
	if len(out.Errors) != 0 {
		t.Fatalf("unexpected errors: %+v", out.Errors)
	}
	root := moduleByPrefix(t, out, "")

	// for_each driven by a variable (not a literal) can't be statically
	// resolved, so it must fall back to a single unindexed block - exactly
	// like pre-expansion behavior - rather than silently producing zero
	// instances or guessing.
	single := blockByAddress(t, root, "azurerm_storage_account.dynamic_example")
	nameAttr := attrByName(t, single, "name")
	if !hasReference(nameAttr.References, "each.key") {
		t.Errorf("expected raw (unresolved) each.key traversal to still be captured, got %+v", nameAttr.References)
	}
	if nameAttr.Value != "" {
		t.Errorf("expected no literal Value for an each.key-templated name when for_each isn't statically known, got %q", nameAttr.Value)
	}
}

func TestForEachEmptyMapProducesNoInstances(t *testing.T) {
	out := buildGraph(fixture("for_each_empty"))
	if len(out.Errors) != 0 {
		t.Fatalf("unexpected errors: %+v", out.Errors)
	}
	root := moduleByPrefix(t, out, "")

	for _, b := range root.Blocks {
		if b.Type == "azurerm_storage_account" {
			t.Errorf("a literal empty for_each map should produce zero instance blocks, found: %+v", b)
		}
	}
}

func TestModuleForEachExpandsPerInstanceChildScopes(t *testing.T) {
	out := buildGraph(fixture("module_for_each"))
	if len(out.Errors) != 0 {
		t.Fatalf("unexpected errors: %+v", out.Errors)
	}

	// root + 2 module instances (one child Module entry per instance, not
	// one shared entry).
	if len(out.Modules) != 3 {
		t.Fatalf("expected root + 2 module instances, got %d: %+v", len(out.Modules), out.Modules)
	}

	root := moduleByPrefix(t, out, "")
	moduleA := blockByAddress(t, root, `module.storage["a"]`)
	locationA := attrByName(t, moduleA, "location")
	if locationA.Value != "westeurope" {
		t.Errorf(`expected module.storage["a"]'s location Value to resolve to "westeurope" (each.value bound), got %q`, locationA.Value)
	}
	moduleB := blockByAddress(t, root, `module.storage["b"]`)
	locationB := attrByName(t, moduleB, "location")
	if locationB.Value != "northeurope" {
		t.Errorf(`expected module.storage["b"]'s location Value to resolve to "northeurope", got %q`, locationB.Value)
	}
	for _, addr := range []string{"module.storage"} {
		for _, b := range root.Blocks {
			if b.Address == addr {
				t.Errorf("unindexed base module address %q should not appear once expanded into instances", addr)
			}
		}
	}

	// Each instance recursed into its own child scope, addressed with its
	// own instance suffix, both resolving var.resource_group_name up to the
	// SAME root resource (proving computeParentLink's per-instance callName
	// resolution works, not just the Go-side expansion).
	childA := moduleByPrefix(t, out, `module.storage["a"].`)
	if !childA.Expanded {
		t.Errorf(`module.storage["a"] child scope should be expanded (local relative-path source)`)
	}
	resourceA := blockByAddress(t, childA, "azurerm_storage_account.this")
	rgAttrA := attrByName(t, resourceA, "resource_group_name")
	if !hasReference(rgAttrA.References, "var.resource_group_name") {
		t.Errorf("child resource should reference var.resource_group_name, got %+v", rgAttrA.References)
	}

	childB := moduleByPrefix(t, out, `module.storage["b"].`)
	blockByAddress(t, childB, "azurerm_storage_account.this")
}

func TestModuleDynamicForEachFallsBackToSingleInstance(t *testing.T) {
	out := buildGraph(fixture("module_dynamic"))
	if len(out.Errors) != 0 {
		t.Fatalf("unexpected errors: %+v", out.Errors)
	}

	// for_each driven by a variable isn't statically knowable, so the module
	// call falls back to a single unindexed instance - exactly like
	// pre-expansion behavior, and exactly like the resource/data fallback.
	if len(out.Modules) != 2 {
		t.Fatalf("expected root + 1 unindexed module instance, got %d: %+v", len(out.Modules), out.Modules)
	}

	root := moduleByPrefix(t, out, "")
	blockByAddress(t, root, "module.storage")

	child := moduleByPrefix(t, out, "module.storage.")
	blockByAddress(t, child, "azurerm_storage_account.this")
}

func TestDynamicBlockIteratorRawTraversals(t *testing.T) {
	out := buildGraph(fixture("dynamic_block"))
	if len(out.Errors) != 0 {
		t.Fatalf("unexpected errors: %+v", out.Errors)
	}
	root := moduleByPrefix(t, out, "")

	nsg := blockByAddress(t, root, "azurerm_network_security_group.nsg")

	// Nested "dynamic" -> "content" block attributes must be flattened into
	// the enclosing resource's Attributes, including the dynamic block's own
	// iterator name ("security_rule", the block label) as a raw traversal -
	// filtering that out is the TS layer's job, not this tool's.
	nameAttr := attrByName(t, nsg, "name") // outer "name" of the NSG itself
	_ = nameAttr

	priorityAttr := attrByName(t, nsg, "priority")
	if !hasReference(priorityAttr.References, "security_rule.value.priority") {
		t.Errorf("expected raw security_rule.value.priority traversal, got %+v", priorityAttr.References)
	}

	sourcePrefixAttr := attrByName(t, nsg, "source_address_prefix")
	if !hasReference(sourcePrefixAttr.References, "azurerm_resource_group.rg.location") {
		t.Errorf("genuine resource reference inside dynamic block should still be captured, got %+v", sourcePrefixAttr.References)
	}
}

func TestCommentsAndMultilineExpressions(t *testing.T) {
	out := buildGraph(fixture("comments_and_multiline"))
	if len(out.Errors) != 0 {
		t.Fatalf("unexpected errors: %+v", out.Errors)
	}
	root := moduleByPrefix(t, out, "")

	for _, b := range root.Blocks {
		if b.Address == "azurerm_resource_group.commented_out" {
			t.Fatalf("commented-out block must not appear in output, found: %+v", b)
		}
	}

	rendered := blockByAddress(t, root, "local_file.rendered")
	contentAttr := attrByName(t, rendered, "content")
	if !hasReference(contentAttr.References, "random_pet.base.id") {
		t.Errorf("multi-line heredoc template should still capture its reference, got %+v", contentAttr.References)
	}
	for _, a := range rendered.Attributes {
		if a.Name == "sensitive" {
			t.Errorf("commented-out attribute line must not appear, found sensitive attribute")
		}
	}

	multiArg := blockByAddress(t, root, "local_file.multi_arg")
	multiArgContent := attrByName(t, multiArg, "content")
	if !hasReference(multiArgContent.References, "random_pet.base.id") {
		t.Errorf("multi-line function call args should still capture reference, got %+v", multiArgContent.References)
	}
}

func TestUnresolvableModuleSource(t *testing.T) {
	out := buildGraph(fixture("unresolvable_module_source"))
	if len(out.Errors) != 0 {
		t.Fatalf("unexpected errors: %+v", out.Errors)
	}

	// No child Module should have been produced for "external" beyond the
	// opaque expanded:false stub - i.e. exactly root + the one opaque entry.
	if len(out.Modules) != 2 {
		t.Fatalf("expected root + 1 opaque module entry, got %d: %+v", len(out.Modules), out.Modules)
	}

	opaque := moduleByPrefix(t, out, "module.external.")
	if opaque.Expanded {
		t.Errorf("unresolvable module source should be expanded:false")
	}
	if len(opaque.Blocks) != 0 {
		t.Errorf("unresolvable module source should have no blocks (no recursion attempted), got %+v", opaque.Blocks)
	}

	root := moduleByPrefix(t, out, "")
	moduleBlock := blockByAddress(t, root, "module.external")
	inputAttr := attrByName(t, moduleBlock, "input")
	if !hasReference(inputAttr.References, "random_pet.base.id") {
		t.Errorf("module.external's own attributes should still be captured even though it's opaque, got %+v", inputAttr.References)
	}
}

func TestMalformedFileDoesNotCrashAndReportsErrors(t *testing.T) {
	out := buildGraph(fixture("malformed"))
	if len(out.Errors) == 0 {
		t.Fatalf("expected at least one parse error for the malformed file")
	}
	found := false
	for _, e := range out.Errors {
		if filepath.Base(e.File) == "broken.tf" {
			found = true
		}
	}
	if !found {
		t.Errorf("expected an error referencing broken.tf, got %+v", out.Errors)
	}

	root := moduleByPrefix(t, out, "")
	// The valid file's block must still be reported despite the other file
	// failing to parse.
	blockByAddress(t, root, "random_pet.valid")
}
