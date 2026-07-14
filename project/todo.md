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

## Backlog (not yet done)
- Live file-watcher auto-refresh (v1 ships manual refresh only)
- `count`/`for_each` per-instance graph (v1 is base-address level, same
  simplification `tf-plan-visualizer` made)
- Full registry/git module resolution without requiring a prior `terraform init`
- `elkjs` fallback if dagre's compound-cluster layout looks inadequate at
  real-world scale
- Multi-root-workspace root switcher UI beyond the folder-picker escape hatch
- Cluster background panel doesn't resize to contain a node dragged outside
  its original dagre-computed bounds (known, accepted v1 limitation of the
  "post-hoc override, no re-flow" drag model)
- Reset/clear manual node positions (currently no UI for this — only way
  back to auto-layout is clearing `workspaceState` manually)
