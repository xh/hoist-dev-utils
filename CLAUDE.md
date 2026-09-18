# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

`@xh/hoist-dev-utils` is an npm package that provides centralized Rsbuild (Rspack + SWC) build
configuration and shared development dependencies for Hoist React applications. It is published to npm and consumed
by Hoist apps as a dev dependency.

The package is part of the **Hoist** framework ecosystem by Extremely Heavy Industries:
- **hoist-react** — Client-side TypeScript/React framework (published as raw TS source, transpiled by this package)
- **hoist-core** — Server-side Java/Grails framework
- **hoist-dev-utils** — This package: build tooling and Rsbuild config
- **@xh/eslint-config** — Shared ESLint rules (bundled as a dependency here)

## Architecture

One config module over a small shared core:

- **`configureRsbuild.js`** - exports `configureRsbuild(env)` returning an
  [Rsbuild](https://rsbuild.rs) (Rspack + SWC) config, plus a `readCliEnv()` helper mapping `XH_*`
  environment variables onto env options (the Rsbuild CLI has no `--env key=value`). Rsbuild
  replaced webpack in v16; `docs/rsbuild-spike.md` records the migration spike (measurements,
  findings, known differences from the v15 webpack build). By default it transforms Hoist's legacy
  decorators with Babel ahead of SWC (`decoratorTransform: 'babel'`), which is why the hoist-react
  floor did not move at v16. `'swc'` mode is measurement-only for now: SWC's legacy emit breaks
  `@persist` on current hoist-react releases, so the build warns whenever it is set. It becomes the
  default in the release that pairs with hoist-react's TC39 decorators migration
  (xh/hoist-react#4333), whichever hoist-react version carries it.
- **`lib/common.js`** - bundler-agnostic helpers (version checks, entry discovery, CHANGELOG
  parsing, Blueprint icon stubs, manifest content, logging). Nothing in here may touch a bundler
  API.
- **`lib/HoistManifestPlugin.js`** and **`lib/HoistCompressionPlugin.js`** - small Rspack plugins
  emitting the per-app `manifest.json` and the pre-compressed `.br` / `.gz` asset copies. The
  compression plugin stands in for `compression-webpack-plugin`, which declares webpack as a
  required peer dependency.

Key behaviors:
- Accepts ~30 env parameters from the app's `rsbuild.config.mjs`, with build-time overrides as
  `XH_*` environment variables (set in CI, or in Rsbuild's `.env` files) read by `readCliEnv()`
- Discovers app entry points from `src/apps/*.{js,ts}` in the consuming project
- Transpiles both app code and raw hoist-react TypeScript source via SWC, with a Babel pass ahead
  of it for legacy decorators
- Injects `XH.appCode`, `XH.appName`, `XH.appVersion`, `XH.appBuild` via `rspack.DefinePlugin`
- Parses the consuming app's `CHANGELOG.md` into JSON for runtime access
- Supports `inlineHoist` mode for local hoist-react development (resolves from sibling directory)
- Handles CSS/SASS processing, HTML generation, favicon/manifest setup, bundle analysis and
  pre-compressed assets

**`static/`** contains assets bundled with the package:
- `index.html` — Template for the per-app index.html, rendered by Rsbuild's html-rspack-plugin via
  a flat set of template parameters

BlueprintJS icon stubs (which strip the ~700-icon set down to the icons Hoist actually uses) are
generated at build time by `generateBlueprintIconStubs()` in `lib/common.js` and swapped in
via `rspack.NormalModuleReplacementPlugin` - apps opt out with `env.loadAllBlueprintJsIcons`.

## Development

There is no build step — the package ships `configureRsbuild.js`, `lib/**/*` and `static/**/*`
directly. There are no tests in this repo - validation is done by building and running Toolbox
(see `docs/rsbuild-spike.md` for the runtime parity gate approach).

**Package manager: pnpm.** `pnpm-lock.yaml` is the source of truth — do not invoke `npm install`
or `yarn install`, and do not create a `package-lock.json` or `yarn.lock`. The required pnpm
version is pinned via the `packageManager` field in `package.json`; if pnpm is not on the PATH,
run it through corepack (`corepack pnpm <cmd>`). Use `pnpm why <pkg>` to inspect the dependency
tree in read-only fashion without reinstalling.

### Commands

```bash
pnpm install          # Install dependencies
pnpm prettier --check .   # Check formatting
pnpm prettier --write .   # Fix formatting
pnpm outdated             # List deps with newer versions than the lockfile / specs allow
pnpm audit                # Check for known vulnerabilities
```

### Local development workflow

Clone alongside a consuming app (e.g. Toolbox), then use your package manager's link command
(`pnpm link` / `yarn link`, matching the app's own package manager) to symlink this package
into the app's `node_modules`. Changes take effect immediately.

### Versioning

- `develop` branch for feature work, `master` for releases
- Version in `package.json` follows `MAJOR.MINOR.PATCH-SNAPSHOT` between releases
- `MIN_HOIST_REACT_VERSION` in `lib/common.js` enforces the minimum supported hoist-react
  version ('major[.minor]') with a fail-fast build error. Both configs share it. Review on each new
  major and bump whenever a release raises the floor, keeping it in sync with the CHANGELOG's
  "Requires hoist-react" entry and the version-compatibility doc below.

### Version compatibility doc (maintained in hoist-react)

The canonical hoist-react / hoist-dev-utils compatibility reference lives in the **hoist-react**
repo at `docs/version-compatibility.md` (section "hoist-react ↔ hoist-dev-utils", with a reverse
lookup table per dev-utils major). It is surfaced to developers and AI agents via hoist-react's
docs MCP server and the Toolbox docs viewer.

Whenever work here changes a compatibility fact, update that doc in a paired hoist-react PR:

- a new minimum or recommended `hoist-react` version (check `💥 Breaking Changes` for
  "Requires hoist-react >= X" entries)
- a new Node floor (`engines.node` in `package.json`)
- any new pairing constraint apps must know when upgrading (e.g. React/`@types/react` major,
  package-manager support)

A new dev-utils major should always add a row to the reverse lookup table there, even if
requirements are unchanged.

### Changelog

All notable changes are documented in `CHANGELOG.md`. The topmost entry covers unreleased work and
uses the SNAPSHOT version as its heading with no date (e.g. `## v12.0.0-SNAPSHOT`). The actual
release version may differ. At release time, the heading is updated to the final version with a date
(e.g. `## v11.2.0 - 2026-03-15`).

Entries use categorized sections with emoji headings as needed:
- `### 💥 Breaking Changes` — incompatible changes, note required hoist-react version
- `### 🎁 New Features` — new configureRsbuild options or capabilities
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

## MCP Servers

### GitHub MCP Server (opt-in)

A Docker-based server providing GitHub API tools (issues, PRs, code search, etc.) via the
official `github-mcp-server` image. Configured in `.mcp.json` but **not enabled by default** —
it requires Docker and an authenticated GitHub CLI, which not every developer keeps running.

**To enable:**

1. Install and start **Docker**.
2. Install the **GitHub CLI** (`brew install gh`) and authenticate with `gh auth login`. The
   server invokes `gh auth token` at startup to fetch a token from the macOS Keychain (or
   `gh`'s credential store on other platforms), so no plaintext token needs to live in your
   shell environment.
3. Add `"github"` to `enabledMcpjsonServers` in `.claude/settings.local.json` (local settings
   merge with the shared `settings.json` — enabling locally does not affect other developers):
   ```json
   {
     "enabledMcpjsonServers": ["github"]
   }
   ```

If Docker is not running or `gh` is not authenticated when the server is enabled, Claude Code
may show errors on startup — remove `"github"` from your local settings to resolve.

**Fallback when not enabled:** The `gh` CLI provides functionally equivalent access to the same
operations (`gh pr view`, `gh issue list`, `gh api`, `gh pr create`, etc.). Prefer `gh` over
crafting raw `curl` calls to the GitHub API.
