// TypeScript mirror of the tf-hcl-graph Go CLI's JSON wire format.
//
// Source of truth: tools/tf-hcl-graph/types.go - keep these interfaces in
// sync with that file's Go struct definitions/json tags if the CLI's output
// shape ever changes. Do not modify the Go tool from this side; if the shapes
// drift, fix these interfaces to match the Go source, not the other way
// around.

/** A single file/line/column source span, used for both start and end. */
export interface SourceRange {
  file: string;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
}

/**
 * One reconstructed dotted-string traversal found inside an attribute's
 * expression (e.g. "azurerm_subnet.foo.id"), with its own exact source range.
 * The Go parser performs NO filtering here - every raw reference
 * `Expression.Variables()` found is emitted faithfully, including
 * `each.*`/`count.*`/dynamic-block-iterator/`self`/`path.*` traversals. All
 * filtering of what's a "real" resource reference happens in the TypeScript
 * resolver (see references.ts), not here.
 */
export interface ParserReference {
  expression: string;
  range: SourceRange;
}

/** One `name = expr` attribute, wherever it was found on a block. */
export interface ParserAttribute {
  name: string;
  range: SourceRange;
  references: ParserReference[];
  /**
   * A best-effort human-readable rendering of the attribute's literal value
   * (string, number, bool, or comma-joined list/tuple/set of strings),
   * present only when the expression was a plain literal - absent (the Go
   * side omits the JSON key entirely via `omitempty`) for anything derived
   * from a variable/reference/function call, or a computed/unknown value.
   */
  value?: string;
}

export type ParserBlockKind =
  | 'resource'
  | 'data'
  | 'module'
  | 'output'
  | 'variable'
  | 'locals';

/**
 * One logical graph node: a resource, data source, module call, output,
 * variable, or (synthetically, one-per-name) a local.
 *
 * `address` is NOT prefixed with the owning module's prefix - join
 * `ParserModule.prefix + block.address` yourself to get the fully-qualified
 * address.
 */
export interface ParserBlock {
  kind: ParserBlockKind;
  type: string;
  name: string;
  address: string;
  range: SourceRange;
  attributes: ParserAttribute[];
}

/**
 * One logical Terraform module (the root, or a recursed-into local child
 * module). `expanded: false` marks an opaque leaf (unresolvable module
 * source) - `blocks` is empty in that case.
 */
export interface ParserModule {
  prefix: string;
  directory: string;
  expanded: boolean;
  blocks: ParserBlock[];
}

/** A single diagnostic surfaced from a failed/partial parse of a .tf file. */
export interface ParserError {
  file: string;
  line: number;
  message: string;
}

/** The single JSON document the tf-hcl-graph CLI writes to stdout. */
export interface ParserOutput {
  errors: ParserError[];
  modules: ParserModule[];
}
