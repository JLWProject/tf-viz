# tf-graph-visualizer — todo

## v1 build order — shipped
- [x] Day-1 fixture validation (local/random providers, output→input chain)
- [x] `tools/tf-hcl-graph` Go parser: block/attribute/reference extraction,
      source ranges, local relative-path module recursion,
      `.terraform/modules/modules.json` best-effort registry/git resolution
- [x] Go unit tests (multi-file merge, nested modules, cross-module chains,
      `local.x`, data sources, `for_each`/`count`/`dynamic` filtering,
      comments/multi-line expressions)
- [x] Extension scaffold (`package.json`, `tsconfig.json`, `esbuild.js`,
      two build targets)
- [x] `src/hclGraphCli.ts`, `src/graph/{moduleIndex,references,graphModel}.ts`
      + TS unit tests
- [x] `webview/{layout,render,panzoom,theme.css}.ts` — dagre layout, SVG
      render, hand-rolled pan/zoom, VS Code theme CSS variables
- [x] `src/panel/graphPanel.ts`, `src/extension.ts` — commands, panel
      lifecycle, root-directory resolution + `workspaceState` memory
- [x] `@vscode/test-electron` integration suite
- [x] End-to-end manual check against real fixtures
- [x] README.md, LICENSE, `.vscodeignore`, `vsce package` — currently at
      version 0.0.9, packaged and manually tested via `.vsix` install / F5
      dev host (not yet published to the Marketplace)

## v1.1 — shipped (post-v1 iteration, from real usage against a real config)
- [x] Sensitive-value-aware detail line (CIDR/SKU/tier) on resource/data
      cards, curated per resource category
- [x] Category icon glyphs (network/compute/storage/database/security/etc.),
      originally-drawn line art — no bundled cloud-provider icon sets
      (licensing) — includes the `aws_*_instance` vs. database miscategorization fix
- [x] Real word-wrap everywhere (names/types/details/chips) — no more text
      overflowing a card's edge
- [x] Top-down layout with arrows flowing from source → dependent
- [x] Premium visual pass: soft shadows, gradients, icon badges, curved
      (Catmull-Rom) edges, refined typography, hover polish — verified in
      both VS Code light and dark themes
- [x] Config-node restructure: `variable`/`output`/`locals` no longer render
      as floating disconnected graph boxes — variables show as chips on the
      resource/data cards that reference them; Resources/Data
      Sources/Modules/Variables/Outputs/Locals all get a searchable,
      clickable side-panel list section
- [x] Click-to-navigate reuses an already-open tab instead of duplicating,
      opens new files beside the graph panel
- [x] Edge-routing fix: curve smoothing tension tuned so connectors no
      longer cut through unrelated node boxes
- [x] Dynamic resize: graph auto-refits via `ResizeObserver`, no manual
      "Fit to view" needed after resizing the panel/window
- [x] Theme-robust accent colors: `charts.*` tokens are unreliable across
      real-world themes (confirmed: VS Code always resolves them to
      *something*, so a naive `var(..., fallback)` chain never actually
      falls through) — accents now derive from `button.background`/
      `statusBarItem.remoteBackground`/`focusBorder` with hue-rotation for
      distinctness, verified against the real Warm Luma/Zenith Readable
      theme files in this repo
- [x] Draggable nodes with persisted per-directory positions
      (`workspaceState`), straight-line edge re-routing for moved nodes

## Next up — Marketplace-ready extension page
This project now lives in its own dedicated repo (`github.com/JLWProject/tf-viz`,
`origin` already configured) rather than a personal monorepo — same reasoning as
keeping `tf-plan-visualizer` separate from where it's consumed: a Marketplace
listing needs its own clean history/issues/README.

- [x] Extension icon: 128x128 PNG at `images/icon.png`, wired via
      `package.json`'s `icon` field. Source is `images/icon-source.html` (inline
      SVG, screenshotted with Playwright at 4x then downsized with `sips` —
      no ImageMagick/rsvg-convert on this machine) — edit that file and
      re-screenshot to regenerate. Also added `galleryBanner` + expanded
      `keywords` + a `Visualization` category alongside `Other`.
- [x] Capture a demo GIF (`images/demo.gif`): scripted Playwright interaction
      against the real `webview/dev-preview.html` harness (real captured
      GraphModel, not fake data) — live search filtering, toggling
      variables/outputs/locals, dragging the `vm` node. PNG frames encoded
      to GIF with the pure-JS `gifenc`/`pngjs` packages (no system ffmpeg/
      ImageMagick available; Playwright's bundled ffmpeg is a stripped build
      with no GIF muxer). Script lives only in the session scratchpad, not
      committed — rerun similarly if the visuals change materially.
- [x] Screenshots for the README/Marketplace gallery — all via Playwright
      against the real built webview bundle, not mockups:
      `screenshot-dark.png` / `screenshot-light.png` (dark/light theme),
      `screenshot-side-panel.png` (toggle on: chips + Resources/Variables/
      Outputs/Locals panel), `screenshot-warm-luma-theme.png` (bonus: the
      `nested_module` two-module fixture in this author's real "Warm Luma"
      theme tokens, showing module clustering + cross-module edges).
- [x] Polish `README.md` for Marketplace rendering — leads with the demo GIF,
      added a Features list + a 2x2 screenshot gallery, "Development" section
      already lived at the bottom (no reorder needed).
- [x] `CHANGELOG.md` added, backfilled from this file's v1/v1.1 shipped
      sections (0.0.1 initial release, 0.0.9 config-node/side-panel/visual
      pass, 0.0.10 dragging/theme-robust accents/resize).
- [x] Found and fixed a real gap while verifying packaging: no
      `.vscodeignore` existed at all (`vsce ls` showed every `.ts`/`.go`
      source file, test fixture, and this `project/` folder would have
      shipped in the `.vsix`, despite the README's Development section
      already claiming dev-preview harnesses were excluded via one). Added
      `.vscodeignore`; `vsce ls` now shows only the 14 files actually needed
      to run.
- [x] Added real `repository`/`bugs`/`homepage` fields to `package.json`,
      pointing at `github.com/JLWProject/tf-viz` (this repo, now confirmed
      as the dedicated repo — no monorepo split needed after all). `vsce
      package --no-dependencies` now succeeds with no escape-hatch flags
      (4.65 MB, 16 files incl. manifest) and automatically rewrites the
      README's relative `images/*` links to `raw.githubusercontent.com`
      URLs in the packaged `readme.md` — confirmed by inspecting the built
      `.vsix`. The Marketplace listing page will render them once this repo
      is pushed and public; they already render in VS Code's local
      Extension Details view regardless, since the images are bundled
      directly into the `.vsix` too.
- [x] Confirmed `LICENSE` copyright holder + year: "Jordan Walker, 2026" —
      already correct for this repo, no change needed.
- [ ] Push this repo to `origin` (`github.com/JLWProject/tf-viz`) and make it
      public if it isn't already — required before the Marketplace listing
      page can actually resolve the `raw.githubusercontent.com` image links.
- [ ] PSGallery-style publish walkthrough for VS Code Marketplace: publisher
      account (`vsce login`/Azure DevOps PAT), `vsce publish`, verify listing
      renders correctly once the repo is pushed/public

## v1.2 — shipped
- [x] `count`/`for_each` per-instance graph: a literal (statically-evaluable)
      for_each/count on a `resource`/`data` block now expands into one node
      per instance, addressed exactly the way Terraform itself would
      (`type.name["key"]` / `type.name[0]`) - see `tools/tf-hcl-graph/
      instances.go`. `each.key`/`each.value`/`count.index` are substituted
      per instance for the literal-detail extraction too, so e.g.
      `name = "st${each.key}"` shows the real resolved value on each
      instance's own card, not just the raw unresolved template.
      Non-literal for_each/count (driven by a variable, another resource,
      or an unevaluable function) falls back to a single unindexed node,
      unchanged from pre-expansion behavior - deliberately fails closed
      rather than guess. A `toset([...])` literal is specially unwrapped
      (not a core HCL function, so unevaluable otherwise) since it's the
      most common real-world literal-set shape. Turned out the existing TS
      reference-resolution code (`references.ts`/`moduleIndex.ts`) needed
      almost no changes at all: `traversalString()` (traversal.go) already
      rendered a real `type.name["key"].attr` reference exactly the same
      way, so an indexed cross-reference just resolves against the new
      addresses for free. Did add one real enhancement while in there: a
      *bare* (unindexed) reference to a for_each/count resource - valid
      Terraform for "all instances at once" (a `for` expression iterating
      the whole resource, or a downstream `for_each = that_resource`
      fan-out) - now fans out to every one of that resource's instances
      instead of silently dropping the reference (`resolveAgainstScope` in
      references.ts).
- [x] `module` blocks' own `count`/`for_each` now expand too (same literal-only
      rule as above), via `buildModuleBlocks`/`moduleCallInstance` in
      `graph.go` - one `Block` *and* one independent recursion into the
      (shared) child directory per instance, prefixed
      `module.name["a"].`/`module.name[0].` etc. Two instances of the same
      module call get their own distinct child scope/cluster, not a merged
      one - each instance's `var.x` resolves up to *that instance's own*
      `module.name["a"] { ... }` call attributes (`computeParentLink` in
      moduleIndex.ts already derives the per-instance callName correctly
      from the prefix string with zero changes needed, same lucky
      convergence as the resource case). `resolveModuleOutputReference` in
      references.ts extended with the same bare-reference-fans-out-to-every-
      instance treatment as `resolveAgainstScope` - worth noting the
      *realistic* trigger for that path turned out narrower than for
      resources: a real for-expression like `[for m in module.name : m.out]`
      never actually produces a traversal with the output name attached (HCL
      correctly excludes the bound loop variable's own `.out` access from
      `Expression.Variables()`), so the fan-out only fires for a bare
      `module.name.out` written directly (not valid final-state Terraform
      once for_each is set, but a reasonable thing mid-refactor) - kept
      anyway for defensive value and consistency with the resource side.

## v1.3 — shipped
- [x] Toolbar fix: "Fit to view"/"Export HTML" had no `white-space: nowrap` or
      `flex-shrink: 0`, so the flex toolbar would shrink them below their
      natural single-line width as the panel narrowed, wrapping the label
      onto 2-3 lines - reads as the button "growing" even though it's really
      just wrapping. Now a constant, slightly more compact size (smaller
      padding/font) regardless of window width; `.toolbar-search`'s own
      min-width absorbs a narrower toolbar instead. Refreshed all 4
      screenshots + the demo GIF since they all show the toolbar.

## v1.4 — shipped
- [x] Fixed a real Windows install failure (`tf-hcl-graph failed ... spawn
      ...tf-hcl-graph.exe ENOENT`): every `.vsix` through 0.0.15 only ever
      bundled whatever single binary happened to be `go build`-ed locally
      (macOS arm64 on this author's machine), so installs on any other OS/arch
      had nothing to spawn. `tools/tf-hcl-graph/build.sh` now cross-compiles
      win32/linux/darwin × x64/arm64 into `bin/<platform>-<arch>/`;
      `src/hclGraphCli.ts` resolves the binary for the running
      `process.platform`/`process.arch` at that path. Publishing moves from
      one universal `.vsix` to six platform-specific ones
      (`scripts/package-target.sh <target>`) - `vsce`'s own
      `--ignore-other-target-folders` turned out to be wired for the
      npm-optionalDependencies convention only (doesn't filter arbitrary
      bundled folders), so the script generates a temporary `.vscodeignore`
      excluding every other target's `bin/<target>/` and packages via
      `vsce package --ignoreFile`. Verified by unzipping a `--target
      win32-x64` package and confirming exactly one binary
      (`bin/win32-x64/tf-hcl-graph.exe`, `file`-confirmed as a real PE32+
      Windows executable) ships, at ~5 MB instead of ~35 MB for all six.
      README's Development/Packaging section updated to match; the old
      "ships for the platform it was built on only" known-limitation note is
      gone since it's now fixed.

## Backlog (not yet done)
- Live file-watcher auto-refresh (v1 ships manual refresh only)
- Full registry/git module resolution without requiring a prior `terraform init`
- `elkjs` fallback if dagre's compound-cluster layout looks inadequate at
  real-world scale
- Multi-root-workspace root switcher UI beyond the folder-picker escape hatch
- Cluster background panel doesn't resize to contain a node dragged outside
  its original dagre-computed bounds (known, accepted v1 limitation of the
  "post-hoc override, no re-flow" drag model)
- Reset/clear manual node positions (currently no UI for this — only way
  back to auto-layout is clearing `workspaceState` manually)
