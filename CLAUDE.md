# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

`@xh/hoist-dev-utils` is an npm package that provides centralized Webpack build configuration and
shared development dependencies for Hoist React applications. It is published to npm and consumed
by Hoist apps as a dev dependency.

The package is part of the **Hoist** framework ecosystem by Extremely Heavy Industries:
- **hoist-react** — Client-side TypeScript/React framework (published as raw TS source, transpiled by this package)
- **hoist-core** — Server-side Java/Grails framework
- **hoist-dev-utils** — This package: build tooling and Webpack config
- **@xh/eslint-config** — Shared ESLint rules (bundled as a dependency here)

## Architecture

The entire library is a single file: **`configureWebpack.js`** (~870 lines). It exports one async
function `configureWebpack(env)` that returns a complete Webpack 5 configuration object.

Key behaviors:
- Accepts ~30 env parameters (from app's `webpack.config.js` or CLI `--env` flags)
- Discovers app entry points from `src/apps/*.{js,ts}` in the consuming project
- Transpiles both app code and raw hoist-react TypeScript source via Babel
- Injects `XH.appCode`, `XH.appName`, `XH.appVersion`, `XH.appBuild` via DefinePlugin
- Parses the consuming app's `CHANGELOG.md` into JSON for runtime access
- Supports `inlineHoist` mode for local hoist-react development (resolves from sibling directory)
- Handles CSS/SASS processing, HTML generation, favicon/manifest setup, bundle analysis

**`static/`** contains assets bundled with the package:
- `index.html` — Template for HtmlWebpackPlugin used by all Hoist apps
- `requiredBlueprintIcons.js` — Minimal BlueprintJS icon shim to reduce bundle size

## Development

There is no build step — the package ships `configureWebpack.js` and `static/**/*` directly.
There are no tests in this repo.

### Commands

```bash
yarn install          # Install dependencies
yarn prettier --check .   # Check formatting
yarn prettier --write .   # Fix formatting
```

### Local development workflow

Clone alongside a consuming app (e.g. Toolbox), then use `yarn link` to symlink this package
into the app's `node_modules`. Changes take effect immediately.

### Versioning

- `develop` branch for feature work, `master` for releases
- Version in `package.json` follows `MAJOR.MINOR.PATCH-SNAPSHOT` between releases

### Changelog

All notable changes are documented in `CHANGELOG.md`. The topmost entry covers unreleased work and
uses the SNAPSHOT version as its heading with no date (e.g. `## v12.0.0-SNAPSHOT`). The actual
release version may differ. At release time, the heading is updated to the final version with a date
(e.g. `## v11.2.0 - 2026-03-15`).

Entries use categorized sections with emoji headings as needed:
- `### 💥 Breaking Changes` — incompatible changes, note required hoist-react version
- `### 🎁 New Features` — new configureWebpack options or capabilities
- `### ⚙️ Technical` — internal changes, refactors, config adjustments
- `### 🐞 Bug Fixes`
- `### 📚 Libraries` — dependency version updates

The `📚 Libraries` section lists packages as `* package-name \`oldMajor.oldMinor → newMajor.newMinor\``,
`added @ version` for new deps, and `removed` for dropped deps. Prose context can precede the list
when helpful (e.g. explaining a tooling swap). Major library upgrades that require app-level changes
should also be noted under `💥 Breaking Changes`.

## Code Style

Prettier config (`.prettierrc.json`):
- 4-space indent, 100 char print width
- Single quotes, no bracket spacing, no trailing commas
- Arrow parens: avoid
