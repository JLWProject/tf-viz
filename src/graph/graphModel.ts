import { buildModuleIndex } from './moduleIndex';
import type { ModuleScope } from './moduleIndex';
import { resolveReference } from './references';
import type { ParserBlock, ParserBlockKind, ParserOutput } from './types';

/** One graph node - one entry per parsed block, across every module scope. */
export interface GraphNode {
  /** Fully-prefixed address, e.g. "module.child.random_pet.rg". */
  address: string;
  /** Resource/data type; empty for module/output/variable/locals nodes. */
  type: string;
  name: string;
  /** The owning module's prefix, trimmed of its trailing "."; root is "root". */
  module: string;
  kind: ParserBlockKind;
  /**
   * The block's own direct (top-level, non-nested-block) attributes that had
   * an extractable literal `value` (see ParserAttribute.value), keyed by
   * attribute name - e.g. `{ address_space: "10.0.0.0/16" }`. Used by the
   * webview to surface a small curated detail line per node. Nested-block
   * attributes (e.g. inside a `security_rule { ... }` sub-block) are not
   * included here.
   */
  attributes: Record<string, string>;
  /**
   * Fully-prefixed addresses of `variable` blocks this `resource`/`data`
   * block's own attributes directly reference (e.g. a resource with
   * `location = var.region` gets `["var.region"]`, or the module-prefixed
   * equivalent for a non-root scope). Direct references only - no following
   * through a `local.x` or nested expression to find a variable buried
   * further away. Always present, empty for every other node kind (module/
   * output/variable/locals never need this) and for resource/data blocks
   * that reference no variables - keeps webview consumers simpler than an
   * optional field would (same convention as `attributes` above). The
   * webview no longer renders variable blocks as their own graph nodes (see
   * main.ts's filterModel()) - this is what lets a resource/data card show
   * "which variables feed into me" as inline chips instead.
   */
  referencedVariables: string[];
}

/** One resolved dependency edge: `from` references `to`. */
export interface GraphEdge {
  from: string;
  to: string;
}

export interface SourceLocation {
  file: string;
  line: number;
}

export interface GraphModel {
  nodes: GraphNode[];
  edges: GraphEdge[];
  addressLocations: Record<string, SourceLocation>;
}

/**
 * Direct-reference-only scan (no chain-following through `local.x`/nested
 * expressions) of a `resource`/`data` block's own attributes' raw reference
 * expressions (the pre-resolution strings, e.g. "var.environment") for ones
 * whose first dot-segment is `var`, resolved to the *same-scope* variable's
 * full address using the exact same addressing convention as the rest of
 * this module (`scope.prefix + "var." + name`) - only when that address is
 * actually declared in this scope (`scope.blocksByAddress`); otherwise
 * skipped silently, same defensive posture as `resolveReference`. Every
 * other block kind (module/output/variable/locals) doesn't need this, so
 * callers should only invoke this for `resource`/`data` blocks.
 */
function computeReferencedVariables(block: ParserBlock, scope: ModuleScope): string[] {
  const found = new Set<string>();
  for (const attr of block.attributes) {
    for (const ref of attr.references) {
      const parts = ref.expression.split('.');
      if (parts.length < 2 || parts[0] !== 'var') {
        continue;
      }
      const varAddress = `var.${parts[1]}`;
      if (scope.blocksByAddress.has(varAddress)) {
        found.add(scope.prefix + varAddress);
      }
    }
  }
  return Array.from(found);
}

/**
 * Builds the final node/edge dependency graph from a tf-hcl-graph CLI's
 * parsed output: one node per block across every module scope, and one
 * deduplicated edge per resolved cross-attribute reference.
 *
 * Note (v1 scope, flagged for the webview-phase UI decision): `variable`,
 * `output`, `locals`, and `module` nodes ARE included in this full topology
 * graph, not just infrastructure resources/data sources - this is a
 * structural map of the whole config, not filtered to "real" cloud
 * resources. Hiding non-resource node kinds by default is a legitimate
 * UI-layer decision to make later, not something this phase should decide.
 */
export function buildGraphModel(parserOutput: ParserOutput): GraphModel {
  const index = buildModuleIndex(parserOutput);

  const nodes: GraphNode[] = [];
  const addressLocations: Record<string, SourceLocation> = {};
  const edges: GraphEdge[] = [];
  const seenEdges = new Set<string>();

  for (const scope of index.values()) {
    const moduleLabel = scope.prefix === '' ? 'root' : scope.prefix.replace(/\.$/, '');

    for (const block of scope.module.blocks) {
      const fullAddress = scope.prefix + block.address;

      const attributes: Record<string, string> = {};
      for (const attr of block.attributes) {
        if (attr.value) {
          attributes[attr.name] = attr.value;
        }
      }

      const referencedVariables =
        block.kind === 'resource' || block.kind === 'data' ? computeReferencedVariables(block, scope) : [];

      nodes.push({
        address: fullAddress,
        type: block.type,
        name: block.name,
        module: moduleLabel,
        kind: block.kind,
        attributes,
        referencedVariables,
      });
      addressLocations[fullAddress] = {
        file: block.range.file,
        line: block.range.startLine,
      };

      for (const attr of block.attributes) {
        for (const ref of attr.references) {
          const visited = new Set<string>();
          const targets = resolveReference(ref.expression, scope, index, visited, 0);

          for (const target of targets) {
            if (target === fullAddress) {
              continue; // skip self-loops
            }
            const edgeKey = `${fullAddress}=>${target}`;
            if (seenEdges.has(edgeKey)) {
              continue;
            }
            seenEdges.add(edgeKey);
            edges.push({ from: fullAddress, to: target });
          }
        }
      }
    }
  }

  return { nodes, edges, addressLocations };
}
