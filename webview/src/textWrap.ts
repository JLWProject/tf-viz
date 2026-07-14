// Pure, DOM-free greedy word-wrap for Terraform identifiers and simple
// comma-separated value lists (e.g. a CIDR list like
// "10.0.0.0/16, 10.0.1.0/24" - see nodeDetail.ts).
//
// Terraform addresses/types are snake_case with no spaces (e.g.
// `azurerm_storage_account_customer_managed_key`), so standard whitespace
// word-wrap alone does nothing useful for those - `_` is treated as a break
// opportunity the same way a normal wrapper treats a space. Node detail
// values (see nodeDetail.ts) are a second, different shape this same
// function needs to wrap sensibly: comma/whitespace-joined lists of tokens
// (CIDRs, SKU names) that have no underscores at all - `,` and whitespace
// are therefore *also* treated as break opportunities, so a long CIDR list
// wraps between list entries rather than hard-breaking mid-number.
//
// `measure` is injected (not a hardcoded canvas call) so this is unit-
// testable under plain Node/Mocha with a fake character-width function,
// with no DOM/canvas involved - same dependency-injection pattern already
// used by `resolveReference` (src/graph/references.ts) for its lookups. The
// real caller (layout.ts) passes a canvas-`measureText`-backed function; see
// textMeasure.ts.

// Matches a single break-opportunity character: underscore (identifier
// segments), comma (value lists), or any whitespace (already-spaced value
// lists).
const BREAK_CHAR = /[_,\s]/;

/**
 * Splits `text` into wrap units, each ending at (and including) its own
 * trailing break character if it had one - e.g. "azurerm_storage_account"
 * becomes ["azurerm_", "storage_", "account"], and "10.0.0.0/16, 10.0.1.0/24"
 * becomes ["10.0.0.0/16,", " ", "10.0.1.0/24"]. Keeping the break character
 * attached to the unit that precedes it (rather than dropping it) mirrors
 * how hyphenated words wrap - the separator stays visible on whichever line
 * it ends up on.
 */
function splitIntoUnits(text: string): string[] {
  const units: string[] = [];
  let current = '';
  for (const ch of text) {
    current += ch;
    if (BREAK_CHAR.test(ch)) {
      units.push(current);
      current = '';
    }
  }
  if (current !== '') {
    units.push(current);
  }
  return units;
}

/**
 * Greedily wraps `text` into lines that each measure at or under
 * `maxWidthPx`, breaking at underscore/comma/whitespace boundaries (see
 * `splitIntoUnits`). Every returned line has its leading/trailing whitespace
 * trimmed (a line that happened to start or end on a whitespace break unit
 * would otherwise render with a stray leading/trailing gap) - trimming only
 * ever makes a line narrower than what it was measured against, so it can
 * never introduce an overflow.
 *
 * If a single break-delimited segment is itself wider than `maxWidthPx` on
 * its own (rare - one very long word/number with no break characters), it
 * falls back to a hard character-level break for just that segment, so no
 * returned line can ever exceed `maxWidthPx` regardless of content.
 */
export function wrapText(text: string, maxWidthPx: number, measure: (s: string) => number): string[] {
  if (text.length === 0) {
    return [''];
  }

  const units = splitIntoUnits(text);

  const lines: string[] = [];
  let current = '';

  // Breaks `segment` (already known to overflow `maxWidthPx` on its own)
  // character-by-character into lines that each fit, pushing all but the
  // last onto `lines` and leaving the last as the new running `current`.
  const hardBreak = (segment: string): void => {
    let chunk = '';
    for (const ch of segment) {
      const candidate = chunk + ch;
      if (chunk === '' || measure(candidate) <= maxWidthPx) {
        chunk = candidate;
      } else {
        lines.push(chunk);
        chunk = ch;
      }
    }
    current = chunk;
  };

  for (const unit of units) {
    if (current === '') {
      if (measure(unit) > maxWidthPx) {
        hardBreak(unit);
      } else {
        current = unit;
      }
      continue;
    }

    const candidate = current + unit;
    if (measure(candidate) <= maxWidthPx) {
      current = candidate;
      continue;
    }

    // Doesn't fit onto the current line - start a new one.
    lines.push(current);
    current = '';
    if (measure(unit) > maxWidthPx) {
      hardBreak(unit);
    } else {
      current = unit;
    }
  }

  if (current !== '') {
    lines.push(current);
  }

  // Trim: a line that started or ended on a whitespace break unit (see
  // splitIntoUnits) would otherwise carry a stray leading/trailing space -
  // `.trim()` only ever strips whitespace, never the underscore/comma break
  // characters themselves, so identifier wrapping's existing behavior is
  // unaffected. Drop any line that trims down to nothing (only possible for
  // a pathologically narrow maxWidthPx), but never return an empty result
  // for non-empty input.
  const trimmedLines = lines.map((line) => line.trim()).filter((line) => line.length > 0);
  return trimmedLines.length > 0 ? trimmedLines : [''];
}

/**
 * Greedily packs indivisible `items` (e.g. layout.ts's per-node variable-
 * reference chips) into rows, each row's total measured width (via
 * `measure`, which is expected to already include any inter-item gap the
 * caller wants accounted for) not exceeding `maxWidthPx` where possible -
 * the same greedy-fit approach `wrapText` above uses for its break-unit
 * strings, generalized to arbitrary already-atomic items instead of
 * string sub-units that can themselves be split at a break character.
 * Unlike `wrapText`, a single item that alone exceeds `maxWidthPx` is never
 * broken up - it simply becomes its own (overflowing) row, since there's no
 * meaningful way to hard-break an arbitrary item.
 */
export function packIntoRows<T>(items: T[], maxWidthPx: number, measure: (item: T) => number): T[][] {
  const rows: T[][] = [];
  let currentRow: T[] = [];
  let currentWidth = 0;

  for (const item of items) {
    const itemWidth = measure(item);
    if (currentRow.length > 0 && currentWidth + itemWidth > maxWidthPx) {
      rows.push(currentRow);
      currentRow = [];
      currentWidth = 0;
    }
    currentRow.push(item);
    currentWidth += itemWidth;
  }

  if (currentRow.length > 0) {
    rows.push(currentRow);
  }

  return rows;
}
