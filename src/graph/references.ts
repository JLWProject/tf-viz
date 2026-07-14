import type { ModuleScope } from './moduleIndex';

/**
 * Reference-resolution algorithm for the TypeScript layer - a fresh
 * implementation (not a literal transliteration) extending the conceptual
 * base of `tf-plan-visualizer/lib/Parse-TerraformPlan.ps1`'s
 * `Resolve-ReferenceCandidate` (see that file's "Dependency resolution"
 * section) for a richer, module-aware input shape:
 *
 *   - `module.<name>.<output>` -> jump into the child module's scope and
 *     resolve its named `output.<output>` block's own references there.
 *   - `var.<name>` -> jump UP to the parent scope that called this module,
 *     find the actual input expression passed for that variable on the
 *     parent's `module.<callName>` block, and resolve it there.
 *   - `local.<name>` -> resolve the same-scope `locals` block's own
 *     expression (no scope jump).
 *   - `data.<type>.<name>` / plain `<type>.<name>` -> terminal match against
 *     this scope's own known block addresses.
 *
 * The Go parser does no filtering of its own - every raw
 * `Expression.Variables()` traversal is emitted faithfully, including
 * `each.*`/`count.*`/dynamic-block-iterator/`self`/`path.*`/unresolvable
 * references. All of that filtering happens here, naturally, as a side
 * effect of the catch-all case failing to find a matching known block
 * address and returning `[]` (dropped, no edge).
 */

/** Defensive recursion cap - anything exceeding this is treated as unresolvable. */
const MAX_DEPTH = 32;

/**
 * Resolves one raw reference expression string (e.g. "azurerm_subnet.foo.id",
 * "module.network.subnet_id", "var.x", "local.y", "data.aws_ami.foo.id",
 * "each.value.address_prefixes", "count.index", "path.module", "self.id")
 * starting from the given scope, to zero or more terminal fully-prefixed
 * addresses (e.g. "module.child.random_pet.rg").
 *
 * `visited` is a Set of `${scope.prefix}::${rawRef}` guard keys, shared
 * across the whole recursive call tree rooted at one top-level call, to
 * defensively prevent infinite recursion (e.g. a cyclic locals chain) - not
 * expected to ever trigger in valid Terraform config, hence "defensive only".
 */
export function resolveReference(
  rawRef: string,
  scope: ModuleScope,
  index: Map<string, ModuleScope>,
  visited: Set<string>,
  depth: number
): string[] {
  if (depth > MAX_DEPTH) {
    return [];
  }

  const guardKey = `${scope.prefix}::${rawRef}`;
  if (visited.has(guardKey)) {
    return [];
  }
  visited.add(guardKey);

  const parts = rawRef.split('.');
  if (parts.length < 2) {
    return [];
  }

  switch (parts[0]) {
    case 'module':
      return resolveModuleOutputReference(parts, scope, index, visited, depth);
    case 'var':
      return resolveVariableReference(parts, scope, index, visited, depth);
    case 'local':
      return resolveLocalReference(parts, scope, index, visited, depth);
    case 'data':
      return resolveDataReference(parts, scope);
    default:
      return resolvePlainReference(parts, scope);
  }
}

/**
 * `module.<name>.<output>[...]` - only the segment immediately after
 * `module.<name>` is treated as the output name; anything further is
 * ignored (v1 simplification per the plan - exotic nested-attribute-on-an-
 * output-value shapes aren't expected in practice).
 */
function resolveModuleOutputReference(
  parts: string[],
  scope: ModuleScope,
  index: Map<string, ModuleScope>,
  visited: Set<string>,
  depth: number
): string[] {
  if (parts.length < 3) {
    return [];
  }
  const callName = parts[1];
  const outputName = parts[2];

  const childPrefix = `${scope.prefix}module.${callName}.`;
  const childScope = index.get(childPrefix);
  if (!childScope) {
    // Missing child scope: an opaque/unexpanded module (registry/git source
    // that couldn't be resolved to a directory), or not a real module call.
    return [];
  }

  const outputBlock = childScope.blocksByAddress.get(`output.${outputName}`);
  if (!outputBlock) {
    return [];
  }

  const results: string[] = [];
  for (const attr of outputBlock.attributes) {
    for (const ref of attr.references) {
      results.push(...resolveReference(ref.expression, childScope, index, visited, depth + 1));
    }
  }
  return dedupe(results);
}

/**
 * `var.<name>` - the value was supplied by whichever module called `scope`.
 * Root `var.*` (no parent - value comes from tfvars/CLI/env, not visible to
 * static parsing) is dropped.
 */
function resolveVariableReference(
  parts: string[],
  scope: ModuleScope,
  index: Map<string, ModuleScope>,
  visited: Set<string>,
  depth: number
): string[] {
  if (!scope.parent) {
    return [];
  }
  const varName = parts[1];
  const parentScope = scope.parent.scope;

  const moduleBlock = parentScope.blocksByAddress.get(`module.${scope.parent.callName}`);
  if (!moduleBlock) {
    return [];
  }

  const inputAttr = moduleBlock.attributes.find((a) => a.name === varName);
  if (!inputAttr) {
    // Not explicitly passed by the caller (e.g. the variable has a default
    // and wasn't set on the module block) - nothing to resolve, drop cleanly.
    return [];
  }

  const results: string[] = [];
  for (const ref of inputAttr.references) {
    results.push(...resolveReference(ref.expression, parentScope, index, visited, depth + 1));
  }
  return dedupe(results);
}

/** `local.<name>` - same-scope recurse, no jump. */
function resolveLocalReference(
  parts: string[],
  scope: ModuleScope,
  index: Map<string, ModuleScope>,
  visited: Set<string>,
  depth: number
): string[] {
  const localName = parts[1];
  const localBlock = scope.blocksByAddress.get(`local.${localName}`);
  if (!localBlock) {
    return [];
  }

  const results: string[] = [];
  for (const attr of localBlock.attributes) {
    for (const ref of attr.references) {
      results.push(...resolveReference(ref.expression, scope, index, visited, depth + 1));
    }
  }
  return dedupe(results);
}

/** `data.<type>.<name>...` - terminal match using the first 3 dot-segments. */
function resolveDataReference(parts: string[], scope: ModuleScope): string[] {
  if (parts.length < 3) {
    return [];
  }
  const candidate = parts.slice(0, 3).join('.');
  if (scope.blocksByAddress.has(candidate)) {
    return [scope.prefix + candidate];
  }
  return [];
}

/**
 * Catch-all: terminal match using the first 2 dot-segments. This naturally
 * drops `count.index`, `each.key`/`each.value`/`each.value.foo`,
 * `path.module`, `self.id`, `terraform.workspace`, dynamic-block iterator
 * names, and any reference to a resource that exists in the config but isn't
 * in this scope's known block addresses for whatever reason - none of those
 * ever match a real block address, so they resolve to `[]` here with no
 * special-casing needed.
 */
function resolvePlainReference(parts: string[], scope: ModuleScope): string[] {
  const candidate = parts.slice(0, 2).join('.');
  if (scope.blocksByAddress.has(candidate)) {
    return [scope.prefix + candidate];
  }
  return [];
}

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values));
}
