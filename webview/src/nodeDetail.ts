// Picks a single small "what's actually configured here" detail line for a
// graph node, e.g. a virtual network's `address_space` CIDR or a storage
// account's `account_tier` - the whole point being the symbolic
// name/type alone tells you *that* something exists, not *what* it is.
//
// `resource`/`data` nodes: only a small curated list of attribute names per
// resource category (see CURATED_ATTRIBUTES below) is ever considered. The
// `security` category is deliberately given NO curated list at all: key
// vaults/secrets/certificates shouldn't ever grow a detail line by default,
// even though everything this module reads was already a plaintext literal
// in the source (see literalvalue.go on the Go side) and never an actual
// runtime secret value - this is a judgment call to avoid ever looking like
// it's surfacing something sensitive-adjacent.
//
// `variable`/`output`/`locals` nodes: handled with their own bespoke rules
// below (see pickNodeDetail) rather than the curated-attribute-list
// mechanism, since each of those kinds has exactly one attribute shape worth
// surfacing rather than a category-dependent list. `module` nodes never get a
// detail line - a module call's own attributes are its *inputs*, and showing
// one arbitrarily wouldn't be meaningful the way a resource's own config is.
import type { GraphNode } from '../../src/graph/graphModel';
import { inferResourceCategory } from './resourceCategory';
import type { IconCategory } from './icons';

/**
 * Curated, ordered attribute names per resource category - the first name in
 * a category's list that's actually present in a node's `attributes` bag
 * wins. Only categories with a genuinely common, simple-literal "at a
 * glance" attribute get a list; everything else (container/messaging/
 * monitoring/generic, plus security - see module comment above) is
 * deliberately omitted so `pickNodeDetail` never forces a detail line where
 * there's no sensible common attribute.
 */
const CURATED_ATTRIBUTES: Partial<Record<IconCategory, readonly string[]>> = {
  network: ['address_space', 'address_prefixes', 'cidr_block', 'cidr_blocks'],
  compute: ['vm_size', 'instance_type', 'size', 'sku_name'],
  storage: ['account_tier', 'account_replication_type', 'sku'],
  database: ['sku_name', 'version', 'engine_version'],
};

/**
 * Returns the first curated attribute value present on `node`, or `undefined`
 * if none of that node's category's curated names are present (including
 * when the node's kind/category has no curated list at all).
 */
function pickResourceDetail(node: GraphNode): string | undefined {
  const category = inferResourceCategory(node.type);
  const names = CURATED_ATTRIBUTES[category];
  if (!names) {
    return undefined;
  }

  for (const name of names) {
    const value = node.attributes[name];
    if (value) {
      return value;
    }
  }
  return undefined;
}

/**
 * `variable` nodes: show `default` if present, unless the variable is marked
 * `sensitive = true` - in which case the default is withheld (same privacy
 * caution as the `security` resource category above, even though a
 * sensitive variable's default is a plaintext literal in source). Falls back
 * to `description` when there's no usable default.
 */
function pickVariableDetail(node: GraphNode): string | undefined {
  const isSensitive = node.attributes.sensitive === 'true';
  if (!isSensitive && node.attributes.default) {
    return node.attributes.default;
  }
  return node.attributes.description || undefined;
}

/**
 * `output` nodes: an output's `value` is almost always a reference chain, not
 * a literal, so `description` is the primary detail - but if `value` did
 * happen to resolve to a literal, prefer showing that since it's more
 * concretely useful.
 */
function pickOutputDetail(node: GraphNode): string | undefined {
  return node.attributes.value || node.attributes.description || undefined;
}

/**
 * `locals` nodes: the synthetic per-local block has exactly one attribute -
 * that local's own expression, keyed by the local's name (see
 * graphModel.ts's `attributes` construction and graph.go's
 * `buildLocalsBlocks`). Show it directly when it resolved to a literal.
 */
function pickLocalsDetail(node: GraphNode): string | undefined {
  return node.attributes[node.name] || undefined;
}

export function pickNodeDetail(node: GraphNode): string | undefined {
  switch (node.kind) {
    case 'resource':
    case 'data':
      return pickResourceDetail(node);
    case 'variable':
      return pickVariableDetail(node);
    case 'output':
      return pickOutputDetail(node);
    case 'locals':
      return pickLocalsDetail(node);
    default:
      // "module" (and anything else future block kinds might add) - no
      // sensible single "interesting attribute" to surface.
      return undefined;
  }
}
