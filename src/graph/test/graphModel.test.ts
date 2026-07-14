import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { buildGraphModel } from '../graphModel';
import type { ParserOutput } from '../types';

function loadFixture(name: string): ParserOutput {
  const fixturePath = path.join(__dirname, 'fixtures', `${name}.json`);
  return JSON.parse(fs.readFileSync(fixturePath, 'utf8')) as ParserOutput;
}

function hasEdge(edges: { from: string; to: string }[], from: string, to: string): boolean {
  return edges.some((e) => e.from === from && e.to === to);
}

describe('buildGraphModel', () => {
  describe('nested_module fixture', () => {
    const model = buildGraphModel(loadFixture('nested_module'));

    it('produces one node per block across both module scopes', () => {
      const addresses = model.nodes.map((n) => n.address).sort();
      assert.deepEqual(addresses, [
        'local_file.summary',
        'module.child',
        'module.child.local_file.child_config',
        'module.child.output.some_output',
        'module.child.var.some_input',
        'random_pet.rg',
      ].sort());
    });

    it('labels the child module nodes with the trimmed prefix, root nodes as "root"', () => {
      const byAddress = new Map(model.nodes.map((n) => [n.address, n]));
      assert.equal(byAddress.get('random_pet.rg')!.module, 'root');
      assert.equal(byAddress.get('module.child.local_file.child_config')!.module, 'module.child');
    });

    it('resolves the child -> parent output edge (root local_file.summary -> child local_file.child_config)', () => {
      assert.ok(
        hasEdge(model.edges, 'local_file.summary', 'module.child.local_file.child_config'),
        `expected an edge local_file.summary -> module.child.local_file.child_config, got: ${JSON.stringify(model.edges)}`
      );
    });

    it('resolves the parent -> child var edge (child local_file.child_config -> root random_pet.rg)', () => {
      assert.ok(
        hasEdge(model.edges, 'module.child.local_file.child_config', 'random_pet.rg'),
        `expected an edge module.child.local_file.child_config -> random_pet.rg, got: ${JSON.stringify(model.edges)}`
      );
    });

    it('resolves the module call\'s own input edge (module.child -> root random_pet.rg)', () => {
      assert.ok(
        hasEdge(model.edges, 'module.child', 'random_pet.rg'),
        `expected an edge module.child -> random_pet.rg, got: ${JSON.stringify(model.edges)}`
      );
    });

    it('records an addressLocations entry with the right file/line for a cross-module node', () => {
      const loc = model.addressLocations['module.child.local_file.child_config'];
      assert.ok(loc);
      assert.ok(loc.file.endsWith('nested_module/child/main.tf'));
      assert.equal(loc.line, 5);
    });
  });

  describe('locals fixture', () => {
    const model = buildGraphModel(loadFixture('locals'));

    it('resolves local.foo through to the underlying resource as a direct edge', () => {
      assert.ok(
        hasEdge(model.edges, 'local_file.uses_local', 'random_pet.base'),
        `expected an edge local_file.uses_local -> random_pet.base, got: ${JSON.stringify(model.edges)}`
      );
    });

    it('does not create an edge to the intermediate local.foo node itself', () => {
      assert.ok(!hasEdge(model.edges, 'local_file.uses_local', 'local.foo'));
    });

    it('still includes locals as their own nodes in the topology', () => {
      const addresses = model.nodes.map((n) => n.address);
      assert.ok(addresses.includes('local.foo'));
      assert.ok(addresses.includes('local.unrelated'));
    });
  });

  describe('data_source fixture', () => {
    const model = buildGraphModel(loadFixture('data_source'));

    it('includes the data source as its own node', () => {
      const node = model.nodes.find((n) => n.address === 'data.azurerm_resource_group.existing');
      assert.ok(node);
      assert.equal(node!.kind, 'data');
    });

    it('resolves a data source reference to a single deduplicated edge', () => {
      const matching = model.edges.filter(
        (e) =>
          e.from === 'azurerm_virtual_network.vnet' &&
          e.to === 'data.azurerm_resource_group.existing'
      );
      // Two attributes ("resource_group_name" and "location") both reference
      // the same data source - should collapse to exactly one edge.
      assert.equal(matching.length, 1);
    });
  });

  describe('for_each_count fixture', () => {
    const model = buildGraphModel(loadFixture('for_each_count'));

    it('resolves the genuine resource_group_name reference on both resources', () => {
      assert.ok(hasEdge(model.edges, 'azurerm_storage_account.each_example', 'azurerm_resource_group.rg'));
      assert.ok(hasEdge(model.edges, 'azurerm_storage_account.count_example', 'azurerm_resource_group.rg'));
    });

    it('produces no edges from each.*/count.* usage (only the 2 genuine edges exist)', () => {
      assert.equal(model.edges.length, 2);
    });
  });

  describe('dynamic_block fixture', () => {
    const model = buildGraphModel(loadFixture('dynamic_block'));

    it('resolves genuine references to azurerm_resource_group.rg from within the dynamic block', () => {
      assert.ok(
        hasEdge(model.edges, 'azurerm_network_security_group.nsg', 'azurerm_resource_group.rg')
      );
    });

    it('produces no edge/node referencing the dynamic block iterator name', () => {
      assert.ok(!model.nodes.some((n) => n.address.startsWith('security_rule')));
      assert.ok(!model.edges.some((e) => e.to.startsWith('security_rule')));
    });
  });
});
