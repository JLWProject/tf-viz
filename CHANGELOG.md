# Changelog

All notable changes to the "Terraform Graph Visualizer" extension are documented
in this file. Format loosely follows [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

## [0.0.28]

- Removed the redundant edge that used to land on a module cluster's own
  backdrop alongside the real one pointing at the card inside it — every
  arrow now points at an actual card on both ends, never at the cluster
  chrome itself.

## [0.0.27]

- Module clusters are clickable again — jumps straight to the
  `module "..." {...}` block's own source location, the same thing the
  module card (removed in 0.0.26) used to do.

## [0.0.26]

- Module calls no longer draw a separate card next to their own cluster —
  it duplicated the cluster's own "MODULE.*" label right next to it.
  Dependency edges that used to point at that card now arrive directly at
  the module's cluster boundary instead, and the cluster itself now carries
  the module accent color that the card used to.

## [0.0.25]

- No functional changes from 0.0.22 — re-baselined the version number after
  reverting a 0.0.23 experiment (node icons keyed off resource/data/module
  kind instead of category) that didn't land well. This is the new build
  base going forward.

## [0.0.22]

- New extension icon: a "tf" monogram replacing the old generic node-diamond
  placeholder.
- The toolbar now starts hidden by default, so the graph gets the full panel
  on first open — bring it back via the tab at the top edge or a right-click.

## [0.0.21]

- Added a "Hide toolbar" button so the graph can take up the full panel.
  Once hidden, a small tab at the top edge brings it back, and right-clicking
  the graph or info panel also offers a "Show toolbar"/"Hide toolbar" option.
  The choice is remembered across the panel being hidden/reloaded.

## [0.0.20]

- Fixed the graph panel showing up blank after being restored by VS Code
  itself (a window reload, or "Reopen Closed Editor") rather than reopened
  via the "Show Dependency Graph" command: no `WebviewPanelSerializer` was
  ever registered for the panel's viewType, so a VS Code-restored panel got
  a raw webview with none of the extension's html/message wiring, and sat
  empty until manually closed and reopened. The extension now registers
  itself as the panel's reviver and rebuilds a restored panel against the
  last-remembered Terraform root directory automatically.
- **Export HTML** now exports just the diagram: the search box, "show
  variables/outputs/locals" and "Live" checkboxes, and the "Fit to
  view"/"Export HTML" buttons no longer appear in the exported standalone
  file (none of them do anything useful without a real VS Code host behind
  them anyway).

## [0.0.18]

- Added an opt-in "Live" toolbar toggle (off by default): follows the
  active editor to a different Terraform root directory the moment you
  focus a `.tf` file there, and auto-rebuilds the graph whenever any `.tf`
  file is saved (debounced, not scoped to only the currently-shown
  directory — a shared child module's file can change the graph too).
  Switching root directories while live still remembers the new root the
  same way the manual "Show Dependency Graph" command does.

## [0.0.17]

- Fixed Variables/Outputs/Locals side-panel rows stretching edge-to-edge
  with only their text centered inside: each row now shrink-wraps to its
  own content and centers as a block within the panel, matching the pill
  treatment already used for the resource/data card variable-reference
  chips.

## [0.0.16]

- Fixed `tf-hcl-graph failed ... spawn ...tf-hcl-graph.exe ENOENT` on Windows:
  every published `.vsix` through 0.0.15 only ever bundled the single binary
  built on the maintainer's own Mac (`tools/tf-hcl-graph/tf-hcl-graph`, macOS
  arm64), so any other OS/arch had no binary to spawn. `tf-hcl-graph` is now
  cross-compiled for win32/linux/darwin × x64/arm64 into
  `tools/tf-hcl-graph/bin/<platform>-<arch>/` (`tools/tf-hcl-graph/build.sh`),
  `src/hclGraphCli.ts` resolves the binary for the running
  `process.platform`/`process.arch`, and the extension now publishes as six
  platform-specific packages (`scripts/package-target.sh <target>`, one per
  target) so each install only ships the ~5 MB binary it actually needs.

## [0.0.15]

- Fixed the toolbar's "Fit to view"/"Export HTML" buttons ballooning in
  height as the panel narrows: they had no `white-space: nowrap` or
  `flex-shrink: 0`, so the flex toolbar shrank them below their natural
  single-line width, wrapping the label onto 2-3 lines (which reads as the
  button "growing", even though it never actually grows - just wraps).
  Buttons now stay a constant, slightly more compact size (smaller padding
  and font) regardless of window width; `.toolbar-search`'s own min-width is
  what absorbs a narrower toolbar instead.

## [0.0.14]

- Extended the 0.0.13 `count`/`for_each` per-instance expansion to `module`
  blocks too: a literal for_each/count on a `module` call now expands into
  one node per instance (`module.name["a"]` / `module.name[0]`), each with
  its own independently-recursed child scope - so two instances of the same
  module call get their own distinct set of child nodes/clusters, not one
  shared/merged scope. A child instance's `var.x` resolves up to that same
  instance's own module-call attributes (two instances can depend on
  different things if their own inputs differ). A bare (unindexed)
  `module.name.output` reference - not valid final-state Terraform once
  for_each is set, but a reasonable thing to encounter mid-refactor - fans
  out across every instance's own output rather than being dropped, mirroring
  0.0.13's same treatment for resources.

## [0.0.13]

- `count`/`for_each` per-instance graph: a literal for_each/count on a
  `resource`/`data` block now expands into one node per instance
  (`type.name["key"]` / `type.name[0]`, matching Terraform's own instance
  addressing) instead of one node for the whole resource. `each.key`/
  `each.value`/`count.index` are substituted per instance in curated detail
  values too (e.g. `name = "st${each.key}"` shows the real resolved name on
  each instance's card). Non-literal for_each/count (driven by a variable,
  another resource, or an unevaluable function) still falls back to a single
  unindexed node, unchanged from before. A bare (unindexed) reference to a
  for_each/count resource - valid Terraform for referencing "all instances at
  once" - now fans out to every instance instead of being dropped.

## [0.0.12]

- Confirmed the node-card vertical-centering fix from 0.0.11 (the
  `getBBox()`-measured post-render pass) against a real-world config -
  version bump only, no further functional changes.

## [0.0.11]

- Marketplace listing assets: extension icon, README screenshots, demo GIF.
- Side panel rows (Resources/Data Sources/Modules/Variables/Outputs/Locals)
  now center their name/detail text, matching the graph node cards.
- Fixed `npm test`: no `.mocharc.json` existed, so Mocha couldn't find any of
  the 146 existing unit tests (`Error: No test files found: "test"`) despite
  `tsconfig.test.json` already referencing it by name. Added one
  (`ts-node/register/transpile-only`, spec globs for both `src/**` and
  `webview/src/**`, excluding the separate `@vscode/test-electron` suite).
- Fixed node cards' name/type/detail/chip text sitting noticeably below true
  center on some real-world resources - the old vertical-centering math
  assumed its own size *estimate* (name/type/detail/chip line counts) always
  matched `layout.ts`'s pre-sized card height exactly. Real content (measured
  against a live theme's actual font metrics, not the Node-only test
  fallback) could drift enough from that estimate to visibly bias the block
  toward the bottom. Now measured for real: the text/chip block renders into
  its own `.node-content` group, then a post-render pass reads its actual
  `getBBox()` once the SVG is attached to the live document and nudges it to
  the card's true vertical center (still never above the icon badge's
  reserved corner).

## [0.0.10]

- Draggable nodes with per-directory positions remembered across sessions;
  edges to a moved node redraw as straight lines instead of curved routing.
- Theme-robust accent colors: node/edge accents now derive from
  `button.background` / `statusBarItem.remoteBackground` / `focusBorder` with
  hue-rotation for distinctness, since VS Code's `charts.*` tokens turned out
  to be unreliable across real-world themes.
- Dynamic resize: the graph auto-refits via `ResizeObserver`; no manual
  "Fit to view" needed after resizing the panel or window.
- Edge-routing tuning so connectors no longer cut through unrelated nodes.

## [0.0.9]

- Config-node restructure: `variable`, `output`, and `locals` blocks no
  longer render as floating disconnected graph boxes. Variables now show as
  small chips on the resource/data cards that reference them; a searchable,
  clickable side panel lists Resources, Data Sources, Modules, Variables,
  Outputs, and Locals.
- Sensitive-value-aware detail line (CIDR, SKU, tier, etc.) on resource/data
  cards, curated per resource category.
- Original, hand-drawn category icon glyphs (network, compute, storage,
  database, security, and more) — no bundled cloud-provider icon set.
- Real word-wrap everywhere (names, types, details, chips).
- Top-down layout with arrows flowing from source to dependent.
- Premium visual pass: soft shadows, gradients, icon badges, curved
  (Catmull-Rom) edges, refined typography, hover polish.
- Click-to-navigate reuses an already-open tab instead of duplicating it.

## [0.0.1] - Initial release

- Static, offline parse of `.tf` source (no `terraform plan`, no
  credentials, no network calls) via a bundled Go CLI built on
  `hashicorp/hcl/v2`.
- Full resource/data/module dependency graph, including cross-module edges
  (`module.x.output` into the child scope, `var.x` up into the parent scope
  that supplied it) and same-scope `local.x` resolution.
- Local relative-path child modules recursed into automatically; commands to
  show the graph for the active file's directory or an explicitly picked
  folder, plus manual refresh.
- Interactive SVG graph: dagre layered auto-layout with module clustering,
  pan/zoom, click-to-navigate to exact source line.
- VS Code theme-aware styling throughout (light and dark).
- **Export HTML**: saves the graph exactly as shown (positions, toggle
  state, real theme colors) as a single self-contained, interactive file.
