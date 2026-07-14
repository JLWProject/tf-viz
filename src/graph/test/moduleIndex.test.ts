import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { buildModuleIndex, getBlockByAddress } from '../moduleIndex';
import type { ParserOutput } from '../types';

function loadFixture(name: string): ParserOutput {
  const fixturePath = path.join(__dirname, 'fixtures', `${name}.json`);
  return JSON.parse(fs.readFileSync(fixturePath, 'utf8')) as ParserOutput;
}

describe('moduleIndex', () => {
  describe('nested_module fixture', () => {
    const output = loadFixture('nested_module');
    const index = buildModuleIndex(output);

    it('has one scope per module prefix', () => {
      assert.deepEqual(Array.from(index.keys()).sort(), ['', 'module.child.']);
    });

    it('root scope has no parent', () => {
      const root = index.get('')!;
      assert.equal(root.parent, undefined);
    });

    it('child scope resolves a parent link back to root with the right call name', () => {
      const root = index.get('')!;
      const child = index.get('module.child.')!;
      assert.ok(child.parent);
      assert.equal(child.parent!.scope, root);
      assert.equal(child.parent!.callName, 'child');
    });

    it('indexes root blocks by their un-prefixed address', () => {
      const root = index.get('')!;
      assert.deepEqual(
        Array.from(root.blockAddresses).sort(),
        ['local_file.summary', 'module.child', 'random_pet.rg'].sort()
      );
    });

    it('indexes child blocks by their un-prefixed address', () => {
      const child = index.get('module.child.')!;
      assert.deepEqual(
        Array.from(child.blockAddresses).sort(),
        ['local_file.child_config', 'output.some_output', 'var.some_input'].sort()
      );
    });

    it('getBlockByAddress finds a block within a scope', () => {
      const root = index.get('')!;
      const block = getBlockByAddress(root, 'random_pet.rg');
      assert.ok(block);
      assert.equal(block!.kind, 'resource');
      assert.equal(block!.type, 'random_pet');
      assert.equal(block!.name, 'rg');
    });

    it('getBlockByAddress returns undefined for an unknown address', () => {
      const root = index.get('')!;
      assert.equal(getBlockByAddress(root, 'nonexistent.thing'), undefined);
    });
  });

  describe('a grandchild-nested prefix (synthetic)', () => {
    it('resolves parent link two levels up correctly', () => {
      const output: ParserOutput = {
        errors: [],
        modules: [
          { prefix: '', directory: '/root', expanded: true, blocks: [] },
          { prefix: 'module.child.', directory: '/root/child', expanded: true, blocks: [] },
          {
            prefix: 'module.child.module.grandchild.',
            directory: '/root/child/grandchild',
            expanded: true,
            blocks: [],
          },
        ],
      };
      const index = buildModuleIndex(output);
      const grandchild = index.get('module.child.module.grandchild.')!;
      const child = index.get('module.child.')!;
      assert.ok(grandchild.parent);
      assert.equal(grandchild.parent!.scope, child);
      assert.equal(grandchild.parent!.callName, 'grandchild');
    });
  });
});
