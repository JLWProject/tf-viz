import * as assert from 'node:assert/strict';
import { collapseInstanceGroups } from '../instanceGroups';
import type { GraphModel, GraphNode } from '../../../src/graph/graphModel';

function instanceNode(address: string, name: string, overrides: Partial<GraphNode> = {}): GraphNode {
  return {
    address,
    type: 'azurerm_storage_account',
    name,
    module: 'root',
    kind: 'resource',
    attributes: {},
    referencedVariables: [],
    ...overrides,
  };
}

/** Builds a model with `count` literal instances of one base address, above the default collapse threshold by default. */
function manyInstancesModel(count: number): GraphModel {
  const nodes: GraphNode[] = [];
  for (let i = 0; i < count; i++) {
    nodes.push(
      instanceNode(`azurerm_storage_account.fanout[${i}]`, `fanout[${i}]`, {
        baseAddress: 'azurerm_storage_account.fanout',
        instanceCount: count,
      })
    );
  }
  return {
    nodes,
    edges: [],
    addressLocations: Object.fromEntries(
      nodes.map((n) => [n.address, { file: '/fixture/main.tf', line: 3 }])
    ),
  };
}

describe('collapseInstanceGroups', () => {
  it('leaves a model with no group past the threshold completely unchanged', () => {
    const model = manyInstancesModel(3); // below DEFAULT_COLLAPSE_THRESHOLD (5)
    const result = collapseInstanceGroups(model, new Set());
    assert.equal(result, model);
  });

  it('leaves a model with no baseAddress at all unchanged', () => {
    const model: GraphModel = {
      nodes: [instanceNode('azurerm_resource_group.rg', 'rg')],
      edges: [],
      addressLocations: {},
    };
    const result = collapseInstanceGroups(model, new Set());
    assert.equal(result, model);
  });

  it('collapses a group above the threshold into one summary node', () => {
    const model = manyInstancesModel(8);
    const result = collapseInstanceGroups(model, new Set());
    assert.equal(result.nodes.length, 1);
    const summary = result.nodes[0];
    assert.equal(summary.address, 'azurerm_storage_account.fanout');
    assert.equal(summary.isInstanceSummary, true);
    assert.equal(summary.instanceCount, 8);
    assert.equal(summary.name, 'fanout ×8');
  });

  it('copies a source location onto the summary node from one of its instances', () => {
    const model = manyInstancesModel(8);
    const result = collapseInstanceGroups(model, new Set());
    assert.deepEqual(result.addressLocations['azurerm_storage_account.fanout'], { file: '/fixture/main.tf', line: 3 });
  });

  it('leaves the group expanded (unchanged individual nodes) when its baseAddress is in expandedGroups', () => {
    const model = manyInstancesModel(8);
    const result = collapseInstanceGroups(model, new Set(['azurerm_storage_account.fanout']));
    assert.equal(result, model);
  });

  it('re-targets edges from/to a collapsed instance onto the summary node, deduplicated', () => {
    const model = manyInstancesModel(8);
    model.nodes.push(instanceNode('azurerm_resource_group.rg', 'rg', { baseAddress: undefined, instanceCount: undefined }));
    model.edges.push(
      { from: 'azurerm_storage_account.fanout[0]', to: 'azurerm_resource_group.rg' },
      { from: 'azurerm_storage_account.fanout[1]', to: 'azurerm_resource_group.rg' }
    );
    const result = collapseInstanceGroups(model, new Set());
    assert.equal(result.edges.length, 1);
    assert.deepEqual(result.edges[0], { from: 'azurerm_storage_account.fanout', to: 'azurerm_resource_group.rg' });
  });

  it('drops an edge that only existed between two sibling instances of the same collapsed group', () => {
    const model = manyInstancesModel(8);
    model.edges.push({ from: 'azurerm_storage_account.fanout[0]', to: 'azurerm_storage_account.fanout[1]' });
    const result = collapseInstanceGroups(model, new Set());
    assert.equal(result.edges.length, 0);
  });

  it('never collapses a module-kind group, even past the threshold (a module node has no card of its own to attach a toggle to)', () => {
    const nodes: GraphNode[] = [];
    for (let i = 0; i < 8; i++) {
      nodes.push(
        instanceNode(`module.fanout[${i}]`, `fanout[${i}]`, {
          type: '',
          kind: 'module',
          baseAddress: 'module.fanout',
          instanceCount: 8,
        })
      );
    }
    const model: GraphModel = { nodes, edges: [], addressLocations: {} };
    const result = collapseInstanceGroups(model, new Set());
    assert.equal(result, model);
  });

  it('respects a custom threshold', () => {
    const model = manyInstancesModel(4);
    const result = collapseInstanceGroups(model, new Set(), 3);
    assert.equal(result.nodes.length, 1);
    assert.equal(result.nodes[0].isInstanceSummary, true);
  });
});
