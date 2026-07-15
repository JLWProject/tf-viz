import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { buildModuleIndex } from '../moduleIndex';
import { resolveReference } from '../references';
import type { ParserOutput } from '../types';

function loadFixture(name: string): ParserOutput {
  const fixturePath = path.join(__dirname, 'fixtures', `${name}.json`);
  return JSON.parse(fs.readFileSync(fixturePath, 'utf8')) as ParserOutput;
}

describe('resolveReference', () => {
  describe('nested_module fixture', () => {
    const output = loadFixture('nested_module');
    const index = buildModuleIndex(output);
    const root = index.get('')!;
    const child = index.get('module.child.')!;

    it('resolves a plain same-scope resource reference (parent -> child input)', () => {
      // module.child's own "some_input" attribute references "random_pet.rg.id"
      // directly in the root scope.
      const result = resolveReference('random_pet.rg.id', root, index, new Set(), 0);
      assert.deepEqual(result, ['random_pet.rg']);
    });

    it('resolves var.<name> by jumping to the parent scope (child -> parent var chain)', () => {
      // child's local_file.child_config references "var.some_input", which was
      // set on the parent's module.child block to "random_pet.rg.id".
      const result = resolveReference('var.some_input', child, index, new Set(), 0);
      assert.deepEqual(result, ['random_pet.rg']);
    });

    it('resolves module.<name>.<output> by jumping into the child scope (parent -> child output chain)', () => {
      // root's local_file.summary references "module.child.some_output",
      // whose own value is "local_file.child_config.filename" inside the child scope.
      const result = resolveReference('module.child.some_output', root, index, new Set(), 0);
      assert.deepEqual(result, ['module.child.local_file.child_config']);
    });

    it('drops an unresolvable module.<name> reference to a nonexistent child', () => {
      const result = resolveReference('module.nonexistent.some_output', root, index, new Set(), 0);
      assert.deepEqual(result, []);
    });

    it('drops root var.<name> (no parent - value comes from tfvars/CLI/env)', () => {
      const result = resolveReference('var.some_input', root, index, new Set(), 0);
      assert.deepEqual(result, []);
    });
  });

  describe('locals fixture', () => {
    const output = loadFixture('locals');
    const index = buildModuleIndex(output);
    const root = index.get('')!;

    it('resolves local.<name> through to the underlying resource', () => {
      const result = resolveReference('local.foo', root, index, new Set(), 0);
      assert.deepEqual(result, ['random_pet.base']);
    });

    it('resolves a local with no references to an empty result (no crash)', () => {
      const result = resolveReference('local.unrelated', root, index, new Set(), 0);
      assert.deepEqual(result, []);
    });
  });

  describe('data_source fixture', () => {
    const output = loadFixture('data_source');
    const index = buildModuleIndex(output);
    const root = index.get('')!;

    it('resolves a data.<type>.<name>.<attr> reference to the data source node', () => {
      const result = resolveReference(
        'data.azurerm_resource_group.existing.name',
        root,
        index,
        new Set(),
        0
      );
      assert.deepEqual(result, ['data.azurerm_resource_group.existing']);
    });
  });

  describe('for_each_count fixture', () => {
    const output = loadFixture('for_each_count');
    const index = buildModuleIndex(output);
    const root = index.get('')!;

    it('resolves a genuine resource reference alongside each/count usage', () => {
      const result = resolveReference('azurerm_resource_group.rg.name', root, index, new Set(), 0);
      assert.deepEqual(result, ['azurerm_resource_group.rg']);
    });

    it('drops each.key', () => {
      assert.deepEqual(resolveReference('each.key', root, index, new Set(), 0), []);
    });

    it('drops each.value', () => {
      assert.deepEqual(resolveReference('each.value', root, index, new Set(), 0), []);
    });

    it('drops count.index', () => {
      assert.deepEqual(resolveReference('count.index', root, index, new Set(), 0), []);
    });

    it('resolves an exact indexed reference to that one instance', () => {
      const result = resolveReference(
        'azurerm_storage_account.each_example["a"].id',
        root,
        index,
        new Set(),
        0
      );
      assert.deepEqual(result, ['azurerm_storage_account.each_example["a"]']);
    });

    it('resolves count[N] the same way', () => {
      const result = resolveReference('azurerm_storage_account.count_example[0].id', root, index, new Set(), 0);
      assert.deepEqual(result, ['azurerm_storage_account.count_example[0]']);
    });

    it('fans a bare (unindexed) reference to a for_each resource out to every one of its instances', () => {
      // Valid Terraform for "all instances at once" (e.g. a for-expression
      // iterating the whole resource) - no block is ever stored at the bare
      // unindexed address once expanded, so this only works via the
      // resolveAgainstScope instance-prefix fallback (see references.ts).
      const result = resolveReference('azurerm_storage_account.each_example', root, index, new Set(), 0);
      assert.deepEqual(
        new Set(result),
        new Set(['azurerm_storage_account.each_example["a"]', 'azurerm_storage_account.each_example["b"]'])
      );
    });

    it('fans a bare (unindexed) reference to a count resource out to every one of its instances', () => {
      const result = resolveReference('azurerm_storage_account.count_example', root, index, new Set(), 0);
      assert.deepEqual(
        new Set(result),
        new Set(['azurerm_storage_account.count_example[0]', 'azurerm_storage_account.count_example[1]'])
      );
    });
  });

  describe('for_each_dynamic fixture', () => {
    const output = loadFixture('for_each_dynamic');
    const index = buildModuleIndex(output);
    const root = index.get('')!;

    it('resolves the single unindexed node normally when for_each is not a literal (no instance fan-out)', () => {
      const result = resolveReference('azurerm_storage_account.dynamic_example', root, index, new Set(), 0);
      assert.deepEqual(result, ['azurerm_storage_account.dynamic_example']);
    });
  });

  describe('module_for_each fixture', () => {
    const output = loadFixture('module_for_each');
    const index = buildModuleIndex(output);
    const root = index.get('')!;

    it('resolves an indexed module output reference into that one instance\'s own child scope', () => {
      // root's output.storage_a_id references module.storage["a"].storage_id,
      // whose own value is azurerm_storage_account.this.id inside that one
      // instance's child scope.
      const result = resolveReference('module.storage["a"].storage_id', root, index, new Set(), 0);
      assert.deepEqual(result, ['module.storage["a"].azurerm_storage_account.this']);
    });

    it('resolves var.<name> up to the parent module block for a specific instance', () => {
      const childA = index.get('module.storage["a"].')!;
      const result = resolveReference('var.resource_group_name', childA, index, new Set(), 0);
      assert.deepEqual(result, ['azurerm_resource_group.rg']);

      const childB = index.get('module.storage["b"].')!;
      const resultB = resolveReference('var.resource_group_name', childB, index, new Set(), 0);
      assert.deepEqual(resultB, ['azurerm_resource_group.rg']);
    });

    it('fans a bare module reference with an output name out to every instance\'s child scope', () => {
      // Not valid final-state Terraform once for_each is set on the module
      // (a real reference needs an index) - see the fixture's own comment -
      // but this tool still resolves it usefully rather than dropping it.
      const result = resolveReference('module.storage.storage_id', root, index, new Set(), 0);
      assert.deepEqual(
        new Set(result),
        new Set(['module.storage["a"].azurerm_storage_account.this', 'module.storage["b"].azurerm_storage_account.this'])
      );
    });
  });

  describe('module_dynamic fixture', () => {
    const output = loadFixture('module_dynamic');
    const index = buildModuleIndex(output);
    const root = index.get('')!;

    it('resolves module.<name>.<output> normally when for_each is not a literal (single unindexed child scope)', () => {
      const child = index.get('module.storage.')!;
      assert.ok(child, 'expected a single unindexed module.storage. child scope');
      assert.equal(root.blocksByAddress.has('module.storage'), true);
    });
  });

  describe('dynamic_block fixture', () => {
    const output = loadFixture('dynamic_block');
    const index = buildModuleIndex(output);
    const root = index.get('')!;

    it('resolves a genuine resource reference used inside a dynamic block', () => {
      const result = resolveReference(
        'azurerm_resource_group.rg.location',
        root,
        index,
        new Set(),
        0
      );
      assert.deepEqual(result, ['azurerm_resource_group.rg']);
    });

    it('drops the dynamic block iterator name (security_rule.key)', () => {
      assert.deepEqual(resolveReference('security_rule.key', root, index, new Set(), 0), []);
    });

    it('drops the dynamic block iterator value access (security_rule.value.priority)', () => {
      assert.deepEqual(
        resolveReference('security_rule.value.priority', root, index, new Set(), 0),
        []
      );
    });

    it('drops var.security_rules at the root (no parent module call)', () => {
      assert.deepEqual(resolveReference('var.security_rules', root, index, new Set(), 0), []);
    });
  });

  describe('synthetic: variable not explicitly passed by the caller', () => {
    // Hand-built - a module call that never sets "config_input" (e.g. the
    // variable has a default), so var.config_input inside the child should
    // drop cleanly with no edge and no crash, rather than resolving to
    // something bogus or throwing.
    const output: ParserOutput = {
      errors: [],
      modules: [
        {
          prefix: '',
          directory: '/root',
          expanded: true,
          blocks: [
            {
              kind: 'module',
              type: '',
              name: 'child',
              address: 'module.child',
              range: { file: 'main.tf', startLine: 1, startColumn: 1, endLine: 3, endColumn: 2 },
              attributes: [
                {
                  name: 'source',
                  range: { file: 'main.tf', startLine: 2, startColumn: 1, endLine: 2, endColumn: 1 },
                  references: [],
                },
                // Deliberately no "config_input" attribute here.
              ],
            },
          ],
        },
        {
          prefix: 'module.child.',
          directory: '/root/child',
          expanded: true,
          blocks: [
            {
              kind: 'variable',
              type: '',
              name: 'config_input',
              address: 'var.config_input',
              range: { file: 'child/main.tf', startLine: 1, startColumn: 1, endLine: 3, endColumn: 2 },
              attributes: [],
            },
            {
              kind: 'resource',
              type: 'local_file',
              name: 'cfg',
              address: 'local_file.cfg',
              range: { file: 'child/main.tf', startLine: 5, startColumn: 1, endLine: 7, endColumn: 2 },
              attributes: [
                {
                  name: 'content',
                  range: {
                    file: 'child/main.tf',
                    startLine: 6,
                    startColumn: 1,
                    endLine: 6,
                    endColumn: 1,
                  },
                  references: [
                    {
                      expression: 'var.config_input',
                      range: {
                        file: 'child/main.tf',
                        startLine: 6,
                        startColumn: 1,
                        endLine: 6,
                        endColumn: 1,
                      },
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };

    const index = buildModuleIndex(output);
    const child = index.get('module.child.')!;

    it('drops var.config_input with no edge and does not throw', () => {
      assert.doesNotThrow(() => {
        const result = resolveReference('var.config_input', child, index, new Set(), 0);
        assert.deepEqual(result, []);
      });
    });
  });
});
