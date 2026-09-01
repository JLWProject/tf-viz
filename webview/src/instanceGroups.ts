// Collapses a large literal for_each/count instance group (see
// graphModel.ts's baseAddress/instanceCount, populated from the Go parser's
// v1.2 per-instance expansion) into one synthetic "N instances" summary node,
// expandable back to the individual instances on demand. Purely a view-layer
// transform on top of an already-built GraphModel - never changes what
// buildGraphModel/the Go parser produced, so full per-instance fidelity
// (attributes, detail lines, edges) is always available the moment a group
// is expanded again.
import type { GraphEdge, GraphModel, GraphNode } from '../../src/graph/graphModel';

/**
 * A group collapses by default once its instance count exceeds this many -
 * a handful (e.g. a 3-AZ fan-out) stays expanded since that's small enough
 * to read as individual cards; a double-digit for_each/count (e.g. a
 * per-environment or per-allowlist-entry fan-out) collapses so it doesn't
 * overwhelm the layout. Any group can still be manually expanded/collapsed
 * regardless of this default - see `expandedGroups`.
 */
export const DEFAULT_COLLAPSE_THRESHOLD = 5;

/** Strips a `type.name["key"]`/`type.name[0]` instance suffix back to the bare name. */
function stripInstanceSuffix(name: string): string {
  const i = name.indexOf('[');
  return i === -1 ? name : name.slice(0, i);
}

/**
 * Returns a new GraphModel with every instance group whose `instanceCount`
 * exceeds `threshold` - and whose `baseAddress` isn't in `expandedGroups` -
 * replaced by one synthetic summary GraphNode (`isInstanceSummary: true`,
 * addressed at the group's own `baseAddress`). Edges touching a collapsed
 * instance are re-targeted at the summary node and deduplicated (including
 * dropping a self-loop that only existed between two sibling instances of
 * the same collapsed group). `addressLocations` gains one entry per
 * collapsed group, copied from any one of its instances - every instance
 * shares the exact same source range (the owning resource/data/module block
 * is declared once; see graph.go's buildResourceLikeBlock), so which member
 * it's copied from doesn't matter.
 *
 * A model with no group past the threshold (or every such group already
 * expanded) is returned completely unchanged - the common case for most
 * real-world configs, where this function is effectively a no-op.
 */
export function collapseInstanceGroups(
  model: GraphModel,
  expandedGroups: ReadonlySet<string>,
  threshold: number = DEFAULT_COLLAPSE_THRESHOLD
): GraphModel {
  const collapsedByBase = new Map<string, GraphNode[]>();
  for (const node of model.nodes) {
    // `module`-kind instances are deliberately excluded: a module node never
    // renders its own card at all (render.ts skips it - its child scope's
    // own cluster represents it instead, see layout.ts's clusterId), so a
    // synthetic summary card built from module instances would have nowhere
    // visible to render its expand toggle. Collapsing a large module
    // for_each/count would need cluster-level grouping instead, a
    // meaningfully different mechanism - left for a future pass rather than
    // shipping a toggle nothing can click.
    if (
      node.baseAddress &&
      (node.kind === 'resource' || node.kind === 'data') &&
      (node.instanceCount ?? 0) > threshold &&
      !expandedGroups.has(node.baseAddress)
    ) {
      const members = collapsedByBase.get(node.baseAddress) ?? [];
      members.push(node);
      collapsedByBase.set(node.baseAddress, members);
    }
  }

  if (collapsedByBase.size === 0) {
    return model;
  }

  const instanceToBase = new Map<string, string>();
  for (const [base, members] of collapsedByBase) {
    for (const member of members) {
      instanceToBase.set(member.address, base);
    }
  }

  const nodes: GraphNode[] = model.nodes.filter((node) => !instanceToBase.has(node.address));
  const addressLocations = { ...model.addressLocations };
  for (const [base, members] of collapsedByBase) {
    const first = members[0];
    nodes.push({
      address: base,
      type: first.type,
      name: `${stripInstanceSuffix(first.name)} ×${first.instanceCount}`,
      module: first.module,
      kind: first.kind,
      attributes: {},
      referencedVariables: [],
      baseAddress: base,
      instanceCount: first.instanceCount,
      isInstanceSummary: true,
    });
    const loc = model.addressLocations[first.address];
    if (loc) {
      addressLocations[base] = loc;
    }
  }

  const edges: GraphEdge[] = [];
  const seenEdges = new Set<string>();
  for (const edge of model.edges) {
    const from = instanceToBase.get(edge.from) ?? edge.from;
    const to = instanceToBase.get(edge.to) ?? edge.to;
    if (from === to) {
      continue; // a self-loop that only existed between two sibling instances of the same collapsed group
    }
    const key = `${from}=>${to}`;
    if (seenEdges.has(key)) {
      continue;
    }
    seenEdges.add(key);
    edges.push({ from, to });
  }

  return { nodes, edges, addressLocations };
}
