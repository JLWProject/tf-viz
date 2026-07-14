import * as assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

// buildIcon()/svgEl() call `document.createElementNS(...)` directly (see
// webview/src/svg.ts) - there's no `document` global under plain Node, so a
// jsdom-backed `document` is installed on `globalThis` before importing any
// module that (transitively) touches the DOM at module-load or call time.
// jsdom wasn't already a dependency anywhere in this project, so it's added
// as a new devDependency here rather than reused from elsewhere.
const dom = new JSDOM('<!doctype html><html><body></body></html>');
(globalThis as unknown as { document: Document }).document = dom.window.document;

import { buildIcon, type IconCategory } from '../icons';

const ALL_CATEGORIES: readonly IconCategory[] = [
  'network',
  'compute',
  'storage',
  'database',
  'security',
  'container',
  'messaging',
  'monitoring',
  'generic',
  'module',
  'variable',
  'output',
  'locals',
];

describe('buildIcon', () => {
  it('covers exactly the 13 documented IconCategory values (fails loudly if the type gains/loses a member)', () => {
    assert.equal(ALL_CATEGORIES.length, 13);
  });

  for (const category of ALL_CATEGORIES) {
    describe(`category: ${category}`, () => {
      const icon = buildIcon(category, 24);

      it('returns an <svg> element in the SVG namespace', () => {
        assert.equal(icon.tagName, 'svg');
        assert.equal(icon.namespaceURI, 'http://www.w3.org/2000/svg');
      });

      it('sets viewBox="0 0 24 24"', () => {
        assert.equal(icon.getAttribute('viewBox'), '0 0 24 24');
      });

      it('renders at least one child glyph primitive (guards against an empty/broken GLYPHS entry)', () => {
        assert.ok(
          icon.childElementCount >= 1,
          `expected buildIcon('${category}', 24) to render >=1 child element, got ${icon.childElementCount}`
        );
      });

      it('sizes width/height to the requested size', () => {
        assert.equal(icon.getAttribute('width'), '24');
        assert.equal(icon.getAttribute('height'), '24');
      });
    });
  }
});
