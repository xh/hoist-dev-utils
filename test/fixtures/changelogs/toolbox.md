# Changelog

<!--
  Entry conventions: CLAUDE.md ("Changelog" section) - read it before adding entries here.

  Entries are parsed at build time and shown in-app to users. Three rules:

  1. Every bullet is a single line, however long. The parser is line-based - a wrapped bullet keeps
     its first line and silently drops the rest.
  2. Open with a past-tense verb (Added / Fixed / Removed), name what changed in backticks, and keep
     each bullet to one change. Use highly concise language suitable for relaying to app users.
  3. Plain ASCII punctuation only. Use " - " for in-sentence breaks, never an em dash.
-->

## 14.0-SNAPSHOT - unreleased

## 13.0.0 - 2026-11-20

### New Features

* Added a `PropertyTable` demo page to Components > General, showing hoist-react's new display-only list of labeled values, with a playground, columns that fit the width, labels on the left or on top, label and value alignment, the compact size, dividers, intents and long text.
* Added a `Callout` demo page to Components > General, showing hoist-react's new note set off within content, with a playground that sets the container width, each intent with and without a title, standard and compact sizes, custom and hidden icons, callouts in a form, a detail panel and above a grid, a markdown body and long-URL wrapping.
* Added a `ProgressBar` demo page to Components > General, showing hoist-react's new bar for a value against a maximum, with a playground, shares of a total from the sample portfolio, intents, a target marker, the indeterminate state and odd data.
* Added a `Separator` demo page to Components > General, showing hoist-react's new rule between content, horizontal and vertical, with a label at the start, the center or the end.
* Added a `Sparkline` demo page to Components > General, showing hoist-react's new inline trend chart, with a playground, its three types, colors, markers, bars, sizing, and its use in a `StatCard` and in a grid column over the sample price history.
* Added a `ViewManager` demo page to Components > General, with a playground for its menu button - including hoist-react's new `buttonTextMode` - and for the `ViewManagerModel` configs it is built with, saving layouts of a small dashboard. View sharing is off, so visitors cannot publish layouts to each other.
* Switched the 30-day close column in the Portfolio example's Orders grid from the AG Grid sparkline to Hoist's `Sparkline`, with a tooltip showing the dates covered, the first and last close and the change.
* Added Day P&L, Long, Short, Cost Basis and Commission columns to the desktop and mobile tree grid demos and the Portfolio example, rolled up on the server from the existing portfolio data. The tree column is now pinned left on mobile and in Portfolio.
* Added a Header Intent picker to the Panel playground in Layout > Panels, showing hoist-react's new `Panel.headerIntent`, with Collapsible and Modal Support options to show the collapse and modal buttons and the vertical collapsed header.
* Added a Fill Order option to the `PropertyTable` demo, showing hoist-react's new `fillOrder` prop, with a two-column example filled down columns.
* Added an In a Toolbar section and an Intent option to the `Slider` demo, showing hoist-react's new `SliderProps.intent`.
* Moved the `PdfViewer` demo's live viewer state into a `StatCardStrip` below the PDF, with a new Find card.

### Technical

* Changed the desktop and mobile docs viewers to read docs straight from `@xh/hoist-docs` in the browser, for the Hoist versions Toolbox runs, exported by `pnpm docs` at build time. Search now uses the same ranking as the MCP tools and opens each result at its best-matching section.
* Removed the server-side `DocsService` and `DocsController`, including the GitHub download of docs at startup.
* Made the docs viewers degrade gently when the docs cannot be loaded - they show a message with a retry, and the rest of Toolbox is unaffected.
* Removed the bundled hoist-react and hoist-core MCP servers and the `installHoistCoreTools` Gradle task - agents now use the `hoist-docs` MCP server.
* Migrated app CSS variable overrides and reads to hoist-react v91's CSS variables - `--xh-` prefixed names in place of the removed unprefixed hooks, renamed variables, and sizes with units.
* Migrated element specs from the legacy `item` / `items` keys to the standard React `children` key, using hoist-react's v91 codemod.
* Set `method: 'POST'` on the fetches that change server state - the WebSocket test's subscribe and unsubscribe and the file manager's delete - since hoist-react v91 sends a request with `params` and no `method` as a GET.

### Libraries

* @xh/hoist `90.1 → 91.0`
* @xh/hoist-dev-utils `16.2 → 16.5`
* hoist-core `44.1 → 45.0`
* ag-grid `36.2 → 36.3`
* Gradle `9.8 → 9.9`

## 12.1.0 - 2026-11-13

### New Features

* Added a `CubeGrid` demo page to the Grids tab, showing hoist-react's new pivoting `CubeGrid` component spreading measures across pivot dimensions, with tabbed Main and Pivoting options for summaries, collapsing, measure ordering and `showRootGroup`.
* Added a `PdfViewer` demo page to Components > General, showing hoist-react's new pdf.js-based document viewer with its toolbar options and model state.
* Added a `StatCard` demo page to Components > General, showing hoist-react's new `StatCard` and `StatCardStrip` components with a live playground for every prop, plus examples of wrapping, sizes, intents, accents, clickable cards and CSS variable styling.

### Technical

* Moved formatted number and date columns across the shared column definitions, grid examples and admin tests to hoist-react's new `Column.textRenderer` for plain-text cells.
* Added Cube pivoting and `CubeGrid` test pages and benchmarks to Admin > Tests, plus a Grid Formatter Parity test and an expanded Grid Scrolling benchmark comparing a Hoist `Grid` with a bare `AgGridReact`.
* Pinned `@rspack/core` to `2.3.0` via a pnpm override - Rspack 2.3.2's minifier breaks classes that reference themselves in static initializers when `keep_classnames` is set (as hoist-dev-utils does), crashing production builds on load. Apps on hoist-dev-utils should apply the same override until a fixed Rspack ships - see xh/hoist-dev-utils#85.

### Libraries

* @xh/hoist `90.0 → 90.1`
* hoist-core `44.0 → 44.1`
* pdfjs-dist `6.5`

