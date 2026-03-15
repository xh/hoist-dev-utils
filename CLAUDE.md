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
- Version follows `MAJOR.MINOR.PATCH-SNAPSHOT` pattern between releases
- Breaking changes are documented in `CHANGELOG.md`

## Code Style

Prettier config (`.prettierrc.json`):
- 4-space indent, 100 char print width
- Single quotes, no bracket spacing, no trailing commas
- Arrow parens: avoid
