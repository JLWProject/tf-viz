# Changelog

All notable changes to the "Terraform Graph Visualizer" extension are documented
in this file. Format loosely follows [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

- Marketplace listing assets: extension icon, README screenshots, demo GIF.

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
