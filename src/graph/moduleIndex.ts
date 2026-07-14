import type { ParserBlock, ParserModule, ParserOutput } from './types';

/**
 * A resolved link from a child module scope up to the parent scope that
 * called it, plus the call name used (the label on the parent's
 * `module "<callName>" { ... }` block) - needed to find the parent's own
 * `module.<callName>` block when resolving `var.*` references upward.
 */
export interface ModuleParentLink {
  scope: ModuleScope;
  callName: string;
}

/**
 * One entry in the module index: a single Terraform module scope (the root,
 * or a recursed-into child), with its own blocks indexed by their
 * un-prefixed address, and a resolved link to its parent scope (if any).
 */
export interface ModuleScope {
  /** This module's own prefix, exactly as emitted by the parser ("" for root). */
  prefix: string;
  /** The raw parser module this scope was built from. */
  module: ParserModule;
  /**
   * This module's own block addresses, NOT prefixed - e.g. "random_pet.rg",
   * "module.child", "local.foo", "var.x", "output.y".
   */
  blockAddresses: Set<string>;
  /** Lookup of this module's own blocks by their un-prefixed address. */
  blocksByAddress: Map<string, ParserBlock>;
  /** Undefined for the root module; set for every child module scope. */
  parent: ModuleParentLink | undefined;
}

/**
 * Builds a scope index from a ParserOutput's modules[], keyed by each
 * module's own (un-prefixed) `prefix` string, with parent links resolved by
 * walking up the prefix's dot structure:
 *   - prefix "module.child." -> parent scope "" (root), callName "child"
 *   - prefix "module.child.module.grandchild." -> parent scope
 *     "module.child.", callName "grandchild"
 *   - prefix "" (root) -> no parent
 */
export function buildModuleIndex(output: ParserOutput): Map<string, ModuleScope> {
  const index = new Map<string, ModuleScope>();

  for (const mod of output.modules) {
    const blocksByAddress = new Map<string, ParserBlock>();
    for (const block of mod.blocks) {
      blocksByAddress.set(block.address, block);
    }
    index.set(mod.prefix, {
      prefix: mod.prefix,
      module: mod,
      blockAddresses: new Set(blocksByAddress.keys()),
      blocksByAddress,
      parent: undefined,
    });
  }

  // Second pass: every scope needs to exist in the index before parent links
  // can be resolved (a parent scope might come later in output.modules).
  for (const scope of index.values()) {
    scope.parent = computeParentLink(scope.prefix, index);
  }

  return index;
}

function computeParentLink(
  prefix: string,
  index: Map<string, ModuleScope>
): ModuleParentLink | undefined {
  if (prefix === '') {
    return undefined;
  }

  // prefix always ends in "." for a non-root module (e.g. "module.child.").
  const trimmed = prefix.endsWith('.') ? prefix.slice(0, -1) : prefix;
  const segments = trimmed.split('.'); // e.g. ["module", "child", "module", "grandchild"]
  if (segments.length < 2) {
    return undefined;
  }

  const callName = segments[segments.length - 1];
  const parentSegments = segments.slice(0, -2); // drop trailing "module", "<callName>"
  const parentPrefix = parentSegments.length === 0 ? '' : parentSegments.join('.') + '.';

  const parentScope = index.get(parentPrefix);
  if (!parentScope) {
    // Parent scope not present in the index - e.g. an opaque/unexpanded
    // module whose own children somehow still got parsed (shouldn't happen,
    // but don't crash if it does).
    return undefined;
  }

  return { scope: parentScope, callName };
}

/** Look up a specific block by its un-prefixed address within a given scope. */
export function getBlockByAddress(
  scope: ModuleScope,
  address: string
): ParserBlock | undefined {
  return scope.blocksByAddress.get(address);
}
