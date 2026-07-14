# Terraform Graph Visualizer (tf-graph-visualizer)

## Context

`tf-plan-visualizer` (a sibling project in this repo) reviews a plan *diff*. This is
a different tool with a different job: a **VS Code extension** that shows the static
*topology* of a Terraform config — every resource and how they depend on each other —
the way VS Code's built-in Bicep Visualizer shows a `.bicep` file's resource graph
next to the source, click a node to jump to it.

Research during planning found that the obvious data source, `terraform show -json`,
only exposes the `configuration`/reference tree when run **against a plan file** —
confirmed empirically (bare `terraform show -json` on current state has no
`configuration` key at all). That would force the extension to silently run a real
`terraform plan` just to draw a graph — needing live cloud credentials and real
latency every time, which is a bad fit for something that should feel instant and
offline like Bicep's visualizer. Decision (confirmed with user): parse the `.tf`
source files directly instead — fully static, no `terraform plan`, no credentials,
no live infra calls. Terraform merges every `.tf` file in a directory into one
logical module regardless of filename, so parsing must do the same (not assume
`main.tf` is special).

Getting real reference data out of raw HCL needs a real parser, not regex — surveyed
during planning: `terraform-config-inspect` (HashiCorp's own tool) only enumerates
blocks, no expression-level references; `@cdktf/hcl2json` could do it, but CDKTF was
officially deprecated and archived by HashiCorp in December 2025 (frozen forever, no
fixes) — too risky to build on long-term. Decision (confirmed with user): write a
small **Go companion CLI** directly on `hashicorp/hcl/v2` (the actual library
Terraform itself uses internally) — this is the same shape as `terraform-ls`/`gopls`:
a small compiled binary the extension shells out to. `Expression.Variables()` in that
library gives correctly-scoped references (nested calls, for-expressions, splats —
all handled, because it's Terraform Core's own mechanism) plus exact source position
for every block, attribute, and reference in one parse pass — so click-to-navigate
needs no separate scan, unlike the plan-JSON approach which discards positions
entirely.

A useful side effect of parsing source directly: `locals` become resolvable (a real
gap in the plan-JSON approach, which never exposes locals' expressions at all) —
`local.x` now just means "look up `locals { x = <expr> }` in the same scope and
recurse into its own references," no cross-scope jump needed. Folded into v1 below.

## Location

New top-level folder: `tf-graph-visualizer/`, following the repo's `project/`
convention for planning docs (same as `tf-plan-visualizer`):

```
tf-graph-visualizer/
  package.json, tsconfig.json, esbuild.js   # two build targets: extension host + webview
  tools/
    tf-hcl-graph/                # Go module — the HCL parser
      main.go, go.mod
      # walks every .tf file in a directory (+ local relative-path child modules,
      # recursively), emits one JSON doc: every resource/data/module/output/
      # variable/locals block with module-prefix-qualified address, each
      # attribute's source range, and each attribute's reference traversals
      # (with their own source ranges) via hclsyntax + Expression.Variables()
  src/                            # extension host (Node context)
    extension.ts                  # activate()/deactivate(), command registration
    hclGraphCli.ts                # spawn the per-platform Go binary, parse its JSON
    graph/
      moduleIndex.ts              # scope map with parent links (port of
                                   # Get-ConfiguredResources, generalized)
      references.ts               # resolveReference(): module-output → child scope,
                                   # var.x → parent scope, local.x → same-scope
                                   # recurse, data./plain-resource terminal match
                                   # (port + extension of Resolve-ReferenceCandidate)
      graphModel.ts                # assembles final {nodes, edges} + address→location map
    panel/
      graphPanel.ts                # webview lifecycle, postMessage bridge, reveal-on-click
    test/
      unit/                        # Mocha+Node, no VS Code API needed
      integration/                 # @vscode/test-electron
      fixtures/                    # hand-built .tf trees + captured Go-parser JSON
  webview/
    src/
      main.ts                      # acquireVsCodeApi(), message handling
      layout.ts                    # @dagrejs/dagre wiring (layered DAG + module clusters)
      render.ts                    # SVG construction from positioned layout
      panzoom.ts                   # hand-rolled pointer/wheel pan+zoom
      theme.css                    # var(--vscode-*) — tracks the user's real theme,
                                    # NOT tf-plan-visualizer's fixed dark palette
  project/
    plan.md                        # copy of this plan
    todo.md                        # ordered build checklist
  README.md
  LICENSE
  .gitignore
```

## How it works

1. Command (`Terraform: Show Dependency Graph`, editor-title icon on `.tf` files,
   plus a folder-picker escape hatch and manual refresh command — **not** auto-open
   per file, since a Terraform "unit" is a directory, not a single file, unlike
   Bicep). No live file-watching in v1.
2. `hclGraphCli.ts` resolves the root directory (active file's dir, remembered per
   workspace in `workspaceState`, or folder-picker override) and spawns the bundled
   `tf-hcl-graph` binary for that platform against it.
3. `tf-hcl-graph` parses every `.tf` file into blocks + attributes + reference
   traversals with source ranges (via `hclsyntax.ParseConfig` + `Expression.
   Variables()`), recursing into local relative-path (`./`, `../`) child modules to
   build `module.<name>.`-prefixed addresses. Registry/git-sourced module calls are
   shown as opaque leaf nodes unless `.terraform/modules/modules.json` happens to
   already exist from a prior `terraform init` (best-effort only — not required).
4. `graph/moduleIndex.ts` + `references.ts` port `tf-plan-visualizer`'s
   `Get-ConfiguredResources`/`Get-AllReferences`/`Resolve-ReferenceCandidate`
   algorithm (see
   `tf-plan-visualizer/lib/Parse-TerraformPlan.ps1`, `# ---- Dependency resolution`
   section onward) into TypeScript, extended for cross-scope resolution:
   - `module.foo.output_name` → look up `module.foo`'s scope, resolve the output's
     own expression *inside that child scope*, recurse.
   - `var.x` inside a child module → look up the *parent* scope's `module_calls`-
     equivalent (the `module "foo" { x = <expr> }` block's own attribute), resolve
     *inside the parent scope*, recurse.
   - `local.x` → look up `locals { x = <expr> }` in the *same* scope, recurse (new
     vs. the plan-JSON tool — see Context).
   - `data.type.name...` / `type.name...` → terminal match against known configured
     addresses in that scope, same as today; anything else (`count.index`,
     `each.key`/`each.value`, `path.module`, `self`, unresolvable `dynamic` iterator
     names) dropped, same filter logic as before.
5. `graphModel.ts` builds `{nodes: [{address, type, name, module, mode}], edges:
   [{from, to}]}` plus `addressLocations: address → {file, line}` (straight from the
   parser's source ranges — no second scan needed).
6. Webview lays out with `@dagrejs/dagre` (layered DAG; module grouping via dagre's
   compound-graph `setParent`, not a separate library), renders as SVG (crisp text,
   real DOM nodes for free click handling, no framework needed), hand-rolled
   pan/zoom, styled via VS Code's `--vscode-*` CSS variables so it tracks the user's
   actual theme.
7. Click a node → `postMessage` → host looks up `addressLocations[address]` →
   `showTextDocument` + `revealRange` at that file/line.

## v1 scope

- Static parse only — no `terraform plan`, no credentials, no live infra calls.
- Full resource+data+module graph (not just resources changing, unlike
  `tf-plan-visualizer` — this is a topology map, not a diff tool; no action colors,
  no before/after values).
- Cross-module edges resolved (module output → child scope, `var.x` → parent scope).
- `local.x` resolved (new capability vs. the plan-JSON approach).
- Local relative-path child modules recursed into; registry/git module sources
  shown as opaque nodes (best-effort expansion only if `modules.json` exists).
- Click-to-navigate to exact source line.
- Command-triggered + manual refresh; no auto file-watching.
- Single dagre layered layout with module clustering; VS Code theme-aware styling
  (no fixed palette, no light/dark toggle needed — inherits the editor's).

**Explicitly deferred to backlog** (captured in `todo.md`): live file-watcher
auto-refresh, resource-type icons, search/filter parity with `tf-plan-visualizer`,
`count`/`for_each` per-instance graph (v1 is base-address level, same simplification
`tf-plan-visualizer` made), full registry/git module resolution without requiring a
prior `terraform init`, `elkjs` fallback if dagre's compound clusters look
inadequate at real-world scale, attribute inspection on hover/click.

## Testing

- Go unit tests (`tools/tf-hcl-graph`) against hand-built fixture `.tf` trees:
  multi-file merge (references split across files), nested local child module,
  cross-module output→input chain, `var.x` upward chain, `local.x` resolution, data
  source references, `for_each`/`count`/`each` filtering, a `dynamic` block iterator
  (needs a real fixture to validate the iterator-name filter), commented-out blocks,
  multi-line expressions.
- TS unit tests (Mocha+Node, no VS Code API) for `graph/` resolution logic against
  captured Go-parser JSON fixtures — mirrors `tf-plan-visualizer`'s Pester-fixture
  style.
- `@vscode/test-electron` integration test: open a fixture workspace, run the show-
  graph command, assert the panel exists and posted a non-empty graph.
- Manual end-to-end: a hand-built two-module fixture (local providers, no cloud
  creds needed) with an output→input chain between modules — open, see graph, click
  a cross-module-resolved node, confirm it jumps to the right file/line.

## Verification

1. `go test ./tools/tf-hcl-graph/...` — parser tests green.
2. `npm test` — TS unit tests green.
3. `npm run test:integration` — `@vscode/test-electron` suite green.
4. `vsce package` → install the `.vsix` locally → open the two-module fixture
   workspace → run `Terraform: Show Dependency Graph` → confirm the graph renders,
   module clustering looks right, and clicking a cross-module node navigates to the
   correct source line.
