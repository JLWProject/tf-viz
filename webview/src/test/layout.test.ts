import * as assert from 'node:assert/strict';
import { computeLayout, CONTENT_TOP_RESERVE, ICON_BADGE_INSET, ICON_BADGE_SIZE, type GraphModel } from '../layout';

// `estimateNodeSize()` (the function that actually applies these constants to
// node width/height) is a private, non-exported helper in layout.ts - it's
// only reachable indirectly through the exported `computeLayout()`, so these
// tests build a minimal one-node GraphModel and read the resulting
// PositionedNode.width/height back out.
//
// Node width/height are now driven by real word-wrapped text measurement
// (see textWrap.ts/textMeasure.ts), not a rough character-count heuristic.
// Under plain Node/Mocha there's no real `<canvas>` 2D context available
// (jsdom - not even loaded in this particular test file - stubs
// `HTMLCanvasElement.getContext()` to return null unless the optional
// native `canvas` npm package is installed), so textMeasure.ts's measurer
// falls back deterministically to `text.length * 7.2` px per character -
// see FALLBACK_CHAR_WIDTH in textMeasure.ts. That fallback (not real glyph
// metrics) is what these tests exercise and assert against.
//
// layout.ts's own private sizing constants (mirrored here as comments, not
// imported - they aren't exported): MIN_WIDTH = 96, MAX_WIDTH = 260,
// TEXT_PADDING_X = 16, PADDING_BOTTOM = 14. The icon no longer reserves any
// horizontal gutter (it overlays the card's top-left corner instead - see
// render.ts's buildNode) so, for single-line (unwrapped) text, the width
// formula simplifies to:
//   clamp(label.length * 7.2 + TEXT_PADDING_X(16), MIN_WIDTH, MAX_WIDTH)
// (wrapping only kicks in past ~30 chars at the 7.2px/char fallback rate,
// within the fixed WRAP_WIDTH content column - not exercised by the short
// single-line labels these tests use). If those private constants ever
// change, the hardcoded expected values below will need updating to match.
//
// Height instead reserves CONTENT_TOP_RESERVE (the corner icon badge's own
// footprint plus breathing room) above the text block, rather than an
// icon-driven width reservation - see layout.ts's estimateNodeSize height
// formula and render.ts's blockTop.

function singleNodeModel(name: string): GraphModel {
  return {
    nodes: [
      { address: name, type: '', name, module: 'root', kind: 'variable', attributes: {}, referencedVariables: [] },
    ],
    edges: [],
    addressLocations: {},
  };
}

describe('computeLayout node width sizing', () => {
  it('exports ICON_BADGE_INSET as 7 and ICON_BADGE_SIZE as 20 (the corner badge geometry)', () => {
    assert.equal(ICON_BADGE_INSET, 7);
    assert.equal(ICON_BADGE_SIZE, 20);
  });

  it('exports CONTENT_TOP_RESERVE as 34 (ICON_BADGE_INSET + ICON_BADGE_SIZE + 7px breathing room)', () => {
    assert.equal(CONTENT_TOP_RESERVE, 34);
  });

  it('floors a very short label\'s width at MIN_WIDTH (96), with no icon-gutter addition', () => {
    // name.length === 1 -> raw estimate (7.2 + 16 = 23.2) is well under the
    // floor, so the floor itself is what's under test here.
    const { nodes } = computeLayout(singleNodeModel('x'));
    assert.equal(nodes[0].width, 96);
  });

  it('adds only TEXT_PADDING_X on top of the raw text-driven estimate once label length pushes past the floor', () => {
    // name.length === 20 -> raw estimate = 20*7.2 + 16 = 160, which is above
    // the 96 floor and below the 260 cap, so the full formula is what
    // determines the result here, not the clamp bounds.
    const name = '01234567890123456789'.slice(0, 20); // length 20
    const { nodes } = computeLayout(singleNodeModel(name));
    assert.equal(nodes[0].width, name.length * 7.2 + 16);
    assert.equal(nodes[0].width, 160);
  });

  it('reserves CONTENT_TOP_RESERVE above the text block, on top of the usual bottom padding/line height', () => {
    // A bare single-line `variable` node (no subtitle/detail/chips): height
    // = CONTENT_TOP_RESERVE(34) + PADDING_BOTTOM(14) + NAME_LINE_HEIGHT(14) = 62.
    const { nodes } = computeLayout(singleNodeModel('x'));
    assert.equal(nodes[0].height, 62);
    assert.ok(
      nodes[0].height > CONTENT_TOP_RESERVE,
      `expected height > CONTENT_TOP_RESERVE(${CONTENT_TOP_RESERVE}), got ${nodes[0].height}`
    );
  });
});
