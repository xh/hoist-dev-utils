# Changelog

## 15.0.0-SNAPSHOT

Cleanup release per [#72](https://github.com/xh/hoist-dev-utils/issues/72) - sheds obsolete build
config accumulated over years of webpack evolution, so that only config with a re-verified reason
to exist carries forward. **Use with `hoist-react >= 87`.**

### 💥 Breaking Changes

* **Requires hoist-react >= 87** - now enforced with a fail-fast error at build/startup.
* **TS-only app support**: `.jsx` files are no longer resolved or transpiled - apps on this
  release must be TypeScript, with JSX carried solely by `.tsx` files. Apps with remaining
  `.jsx` files must rename them to `.tsx` before upgrading - the build fails fast with an
  error listing any found under `/src` or in `babelIncludePaths` packages.
* Flipped `@babel/plugin-proposal-decorators` from `{version: 'legacy'}` to `{version: '2023-05'}`
  to align with hoist-react's migration to TC39 Stage 3 modern decorators. Consuming apps must
  upgrade `@xh/hoist` and `@xh/hoist-dev-utils` together — mixing a legacy-decorator app with this
  build of dev-utils will silently break all `@observable` and `@bindable` fields. See the
  hoist-react upgrade notes for the codemod required in app code.

### ⚙️ Technical

* Dropped forced Babel transpilation of nullish-coalescing (`??`) and optional-chaining (`?.`)
  operators - 2020-era guards, native in all target browsers for years. Bundles shrink slightly.
* Dropped Terser `compress: {comparisons: false, collapse_vars: false}` overrides - workarounds
  for 2018-era bugs in tools long since gone. Terser compression defaults now apply.
* Collapsed the duplicated TypeScript transform config: `@babel/preset-typescript` removed; the
  explicit `@babel/plugin-transform-typescript` now runs per-extension, so JSX parses only in
  `.tsx` files and angle-bracket type assertions remain valid in plain `.ts`. It stays ahead of
  the decorators plugin, which cannot handle unstripped TS.
* Rewrote the catch-all asset rule's exclude list - now covers all script-type extensions and
  documents why each exclusion exists.

### 📚 Libraries

* @babel/preset-typescript `removed`
* sass-material-colors `removed` - consumed only by hoist-react's `vars.scss`, and hoist-react
  \>= 87 declares its own copy. Any app importing it directly in its own SCSS must declare it in
  its own `package.json` (previously it could resolve via this package's copy).

## 14.0.1 - 2026-08-18

### 🐞 Bug Fixes

* Restored the Blueprint icon bundle-size optimization, silently broken since Blueprint 5 changed
  its icon packaging - the full `@blueprintjs/icons` set (~0.5MB gzipped) was landing in the
  initial bundle of every app. Build-time-generated stubs now limit that to the icons Hoist's
  Blueprint components actually use, and an unexpected icon import fails the build rather than
  rendering blank. Opt out with the existing `loadAllBlueprintJsIcons` flag.

## 14.0.0 - 2026-08-08

This release adds support for [pnpm](https://pnpm.io) as the package manager for Hoist apps.
Apps that wish to adopt pnpm must take this release - v13 and earlier rely on `node_modules`
layout assumptions that do not hold under pnpm. Apps remaining on yarn classic or npm can also
take v14 freely: it is fully compatible with those package managers, and the resolution changes
below are no-ops on their flat layouts.

**Use with `hoist-react >= 87`** (the React 19 baseline). Apps on earlier hoist-react / React 18
should remain on dev-utils v13.

### 💥 Breaking Changes

* **Apps adopting pnpm must declare every package they import directly** - including
  `@types/lodash` (required by hoist-react's raw TypeScript source, previously hoisted from this
  package) and any loaders referenced by bare name in `extraModuleRules`. Under flat layouts,
  apps could import undeclared packages that hoist-react happened to carry (`@fortawesome/*`,
  `classnames`, `filesize`, etc.); under pnpm these surface as webpack `Can't resolve` errors or
  missing-type errors from `tsc`. Declare each in the app's own `package.json`, with a spec
  matching hoist-react's to avoid duplicate copies. Apps remaining on yarn classic or npm are
  unaffected.
* webpack-dev-server updated to v6, raising the minimum Node version from 22.11 to 22.15 (repos
  tracking `lts/*` are already well past this). App run scripts and the built-in config are
  unaffected, but apps passing custom `devServerOptions` should review the
  [v6 migration guide](https://github.com/webpack/webpack-dev-server/blob/main/migration-v6.md)
  for removed options.
* `@types/react` and `@types/react-dom` updated to 19.x, matching hoist-react v87's React 19
  baseline (see version note above).

### ⚙️ Technical

* `configureWebpack()` no longer assumes a flat, physically-hoisted `node_modules` layout, making
  the generated build config compatible with isolation-based package managers such as pnpm. Yarn
  classic and npm continue to work unchanged. Built-in loaders, Babel presets, and plugins are now
  resolved via `require.resolve()` from this package's own dependencies, and Babel
  `include`/`exclude` paths (including `@xh/hoist`, in both packaged and `inlineHoist` modes) are
  symlink-resolved to match the real module paths Webpack produces.
* This repo itself is now managed with pnpm: `pnpm-lock.yaml` replaces `yarn.lock`, with the pnpm
  version pinned via the `packageManager` field. No impact on consuming apps.

### 🐞 Bug Fixes

* `inlineHoist` mode now aliases `react-dom` (alongside the existing `react` alias) to the app's
  own copy. React 19 throws at runtime if the two packages' versions differ at all, so patch-level
  drift between the app and hoist-react checkouts would previously break inline development.

### 📚 Libraries

* @babel/plugin-transform-typescript `added @ 7.28` (now `require.resolve()`d directly - was a
  transitive dep of @babel/preset-typescript)
* @types/react `18.x → 19.x`
* @types/react-dom `18.x → 19.x`
* webpack `5.107 → 5.109`
* webpack-cli `7.0 → 7.2`
* webpack-dev-server `5.2 → 6.0`

## 13.0.1 - 2026-06-10

### 🐞 Bug Fixes

* Added a `'process.env': '{}'` fallback to the Webpack `DefinePlugin` config, so libraries that
  ship raw `process.env.X` references in their published browser builds no longer throw at runtime.
  Notably fixes `DashCanvas` drag/resize, broken by `react-draggable` 4.6.0 (a transitive dep of
  `react-grid-layout`). The existing `process.env.NODE_ENV` define still resolves as before.

## 13.0.0 - 2026-06-10

### 💥 Breaking Changes

* `.md` imports now resolve to the file's raw **text content** (Webpack `asset/source`) rather than a
  URL to an emitted file. Apps that previously fetched the imported value to read it
  (`fetch(imported).then(r => r.text())`) should drop the fetch and use the import directly as the
  markdown string (e.g. pass it straight to Hoist's `markdown` component). This aligns the build with
  the `*.md` module declaration (`const content: string`) hoist-react already ships; hoist-react
  itself requires no change, so taking v13 is a strong recommendation for consistency rather than a
  hard requirement.
    * To opt a specific import back into the old URL behavior — for instance a large document loaded
      lazily — append `?url` to the request: `import url from './big.md?url'`.
* Declared a minimum Node version of `>=22.11.0` via the `engines` field in `package.json`. This
  reflects the floor now required by build dependencies (notably `sass-loader` 17) and matches the
  `lts/*` Node policy already used across Hoist repos.
* If your app uses `flex: 1 1 0` or `flex-basis: 0` you should visually verify that the flex layouts
  continue to work as expected and add an explicit unit if they do not
  (e.g. `flex: 1 1 0%` or `flex-basis: 0%`).

### 🎁 New Features

* New `extraModuleRules` config allows apps to add their own Webpack module rules — or override the
  default handling for a given file type (e.g. process `.svg` via `@svgr/webpack`). Rules are
  inserted just before the catch-all asset rule, so they win over it but not over the built-in
  JS/TS/CSS/image rules.

### ⚙️ Technical

* Migrated image and fall-through asset handling from the deprecated `url-loader` / `file-loader` to
  Webpack 5's built-in asset modules (`type: 'asset'` / `'asset/resource'`). Behavior is unchanged:
  small images (< 10kB) still inline as data URIs and all other assets (SVGs, fonts) emit as hashed
  files under `static/media/`.
* Removed two no-longer-needed build dependencies: `rimraf` (build output cleaning is handled by
  Webpack's `output.clean`) and `postcss-flexbugs-fixes` (its flexbox workarounds target IE / old
  browsers outside our supported set).

### 📚 Libraries

* file-loader `removed`
* postcss-flexbugs-fixes `removed`
* rimraf `removed`
* sass-embedded `1.99 → 1.100`
* sass-loader `16.0 → 17.0`
* url-loader `removed`
* webpack `5.106 → 5.107`

## 12.2.0 - 2026-05-26

### 🎁 New Features

* Enabled webpack Hot Module Replacement for CSS/SCSS in development. Style edits now apply in
  place without a full page reload, preserving scroll position and in-app state. JS/TS edits
  continue to trigger a full reload.

## v12.1.1 - 2026-05-19

### ⚙️ Technical

* Removed `html-webpack-tags-plugin` dependency. It was used in a single spot to inject the
  `preflight.js` script tag and has been unmaintained since 2021, pulling in deprecated
  transitive deps (`glob@7`, `inflight`) that surfaced as warnings on install. The preflight
  tag is now emitted directly from the `static/index.html` template, with a `preflightHash`
  template parameter (sourced from the webpack compilation hash) preserving cache-busting.

### 📚 Libraries

* html-webpack-tags-plugin `3.0 → removed`
* terser-webpack-plugin `5.5 → 5.6`

## v12.1.0 - 2026-04-29

### 🎁 New Features

* Replaced the animated PNG on the static loader page with an inline SVG that visually matches
  Hoist React's in-app `Spinner` component (FA `spinner-third` with a CSS rotation). Eliminates a
  style discontinuity at the JS-bundle handoff.
* New `preloadSpinnerColor` config controls the stroke color of the loader spinner. Defaults to
  `#888`. Pairs with the existing `preloadBackgroundColor`.

### 📚 Libraries

* terser-webpack-plugin `5.4 → 5.5`we u

## v12.0.1 - 2026-04-18

### 📚 Libraries

* autoprefixer `10.4 → 10.5`
* lodash `4.17 → 4.x (allows update to 4.18 w/security fixes and future)`
* sass-embedded `1.98 → 1.99`
* webpack `5.105 → 5.106`
* webpack-bundle-analyzer `5.2 → 5.3`

## v12.0.0 - 2026-03-31

### 💥 Breaking Changes

* Requires `hoist-react >= 83.0.2`.
* The webpack dev server now proxies API requests to the Grails backend, serving client resources
  and API responses from the same port. The default `baseUrl` in dev mode changed from the
  cross-origin `//devHost:devGrailsPort/` to `/api/` (matching production). Requests to `/api/...`
  are proxied to Grails with the prefix stripped. This mirrors the production nginx setup, avoids
  CORS issues, and simplifies local development. Apps with an explicit `baseUrl` are unaffected.

### 🐞 Bug Fixes

* Fixed bug in release-related GitHub actions that prevented them from working when used in other repos.

## v11.2.0 - 2026-03-27

### ⚙️ Technical

* Removed `@cerner/duplicate-package-checker-webpack-plugin` dependency. This plugin is no longer
  maintained (Cerner GitHub org archived) and provided limited value. The `checkForDupePackages` and
  `dupePackageCheckExcludes` config options are no longer supported.
* Added GitHub Actions deployment scripts for CI/CD.
* Added `CLAUDE.md` and MCP server configs for AI-assisted development.

### 📚 Libraries

* babel-loader `10.0 → 10.1`
* copy-webpack-plugin `13.0 → 14.0`
* mini-css-extract-plugin `2.9 → 2.10`
* sass-embedded `1.97 → 1.98`
* terser-webpack-plugin `5.3 → 5.4`
* webpack `5.104 → 5.105`
* webpack-bundle-analyzer `5.1 → 5.2`
* webpack-cli `6.0 → 7.0`

## v11.1.0 - 2026-01-02

### 📚 Libraries

* postcss-loader `8.1 → 8.2`
* rimraf `6.0 → 6.1`
* sass-embedded `1.87 → 1.97`
* type-fest `4.41 → 5.3`
* webpack `5.99 → 5.104`
* webpack-bundle-analyzer `4.10 → 5.1`

## v11.0.1 - 2025-10-29

### ⚙️ Technical

* Updated resolution rule needed when developing Hoist inline to ensure AG Grid hooks only resolve to a single instance.

## v11.0.0 - 2025-05-15

### 💥 Breaking Changes

* Requires `hoist-react >= 73.0`.
* Upgrade from `@xh/eslint-config` v6.0 to v7.0 requires changes to Hoist Applications' `eslint` configurations:
  Rename the `.eslintrc` file to `eslint.config.js` and use the configuration found in Toolbox's `eslint.config.js` as
  a new baseline example.

### 📚 Libraries

@xh/eslint-config `6.0 -> 7.0`

## v10.1.0 - 2025-05-01

### 🎁 New Features

* Added new `devServerOptions` config to override defaults passed to the Webpack `devServer`.

### 📚 Libraries

* @babel/* `7.24 → 7.27`
* babel-loader `9.2 → 10.0`
* copy-webpack-plugin `12.0 → 13.0`
* postcss `8.4 → 8.5`
* sass-embedded `1.83 → 1.87`
* webpack `5.97 → 5.99`

## v10.0.0 - 2025-01-08

### 💥 Breaking Changes

* Requires `hoist-react >= 71.0` with workaround for SASS/CSS processing issue caused by bad syntax in the `react-dates`
  library, which started throwing an error after the updates to sass in this dev-utils release.

### 📚 Libraries

* babel-loader `9.1 → 9.2`
* rimraf `5.0 → 6.0`
* sass-embedded `1.77 → 1.83` (swaps out sass for sass-embedded)
* sass-loader `14.2 → 16.0`
* webpack `5.93 → 5.97`
* webpack-cli `5.1 → 6.0`
* webpack-dev-server `5.0 → 5.2`
* webpackbar `6.0 → 7.0`

## v9.0.1 - 2024-08-01

### 📚 Libraries

* type-fest `added @ 4.x` - ensures that apps have a recent version of this library installed as a dev dependency.
  (It's required to compile hoist-react typescript as part of the current combined Hoist + app build.)
* webpack `5.92 → 5.93`

## v9.0.0 - 2024-06-25

### 💥 Breaking Changes

* Requires `hoist-react >= 64.1` with updated static assets within a new `/public` directory. These are now copied at
  build time to the `/public/` output directory, alongside (and deferring to) any app-provided assets.

### 📚 Libraries

* webpack `5.91 → 5.92`

## v8.2.0 - 2024-06-07

### ⚙️ Technical

* Updated the viewport `meta` tag within the static `index.html` template to remove constraints on user scaling.
  (See https://github.com/xh/hoist-react/issues/3651.)
* Default `baseUrl` in development now has an adaptive protocol (http/https) based on browser location.  
  This makes it simpler for developers to configure their local development environment to use https.

### 📚 Libraries

* css-loader `6.10 → 7.1`
* mini-css-extract-plugin `2.8 → 2.9`
* sass `1.72 → 1.77`
* sass-loader `14.1 → 14.2`
* style-loader `3.3 → 4.0`
* webpack `5.90 → 5.91`

## v8.1.1 - 2024-05-10

### ⚙️ Technical

* Added another `resolveAliases` entry to ensure that the same instance of `@ag-grid-community` is used when
  developing inline. This ensures there is only one version of ag-grid's hook contexts.

## v8.1.0 - 2024-03-27

### 🎁 New Features

* Individual manifest.json files are now generated for each clientApp, with their starting URL set to the base URL
  for that app. Intended specifically for mobile apps added to device home screens, so they can load their intended
  client app directly without the need for additional redirects.
* A new `preloadBackgroundColor` config will be applied to the preloader spinner, allowing apps to set a background
  color that matches their app's theme. This can help minimize a flash of white when the app first loads.

### ⚙️ Technical

* The static `index.html` file used as an entry point template has been moved out of hoist-react and into this project,
  to aid in future dev-utils releases where changes to this file are required.

## v8.0.0 - 2024-03-18

### 💥 Breaking Changes

* Requires Hoist React v62+ with updated (and now only) `/static/index.html` HTML entrypoint template.

### ⚙️ Technical

* Chunking of bundled JS and CSS outputs updated to use webpack's default naming and splitting strategy, avoiding issues
  where builds with many client apps could generate bundle names that exceeded filename length limits.
* Builds can now generate more but smaller chunks, allowing browsers to better parallelize the initial download of an
  app's codebase.

### 📚 Libraries

* @babel/* `7.23 → 7.24`
* sass `1.70 → 1.72`
* webpack-dev-server `4.15 → 5.0`

## v7.2.0 - 2024-03-15

### 🎁 New Features

* Adds `xhClientApps` as a global constant for Hoist React v61+.

### 📚 Libraries

* Removed `clean-webpack-plugin` - it is no longer maintained and was causing runtime issues in development.
  Its functionality is replaced by the `clean` option in the `output` section of the webpack config.

## v7.1.0 - 2024-02-05

* Updated to new webpack API for enabling HTTPS on local dev server. Note that the handling of the (rarely used)
  `devHttps` parameter has changed.

### 🐞 Bug Fixes

* Fixed chunk collection so that similarly named apps within a project do not load each other's app chunk.

### 📚 Libraries

* @babel/* `7.22 → 7.23`
* copy-webpack-plugin `11.0 → 12.0`
* css-loader `6.8 → 6.10`
* html-webpack-plugin `5.5 → 5.6`
* mini-css-extract-plugin `2.7 → 2.8`
* postcss-loader `7.3 → 8.1`
* rimraf `4.4 → 5.0`
* sass `1.63 → 1.70`
* sass-loader `13.3 → 14.1`
* webpack `5.88 → 5.90`
* webpack-bundle-analyzer `4.9 → 4.10`
* webpackbar `5.0 → 6.0`

## v7.0.0 - 2023-07-19

* Updated `@xh/eslint-config` to v6.0, for use with Typescript v5.1+ and Hoist React v59+.

### 📚 Libraries

* @xh/eslint-config `5.0 → 6.0`
* webpack `5.84 → 5.87`

## v6.3.0 - 2023-06-15

* Added new `devServerOverlay` config to control full-screen error overlay added by webpack-dev-server. Default to show
  compilation errors only, allowing devs to opt-in to compilation warnings and/or runtime errors.

### 📚 Libraries

* sass `1.62 → 1.63`
* webpack `5.84 → 5.87`
* webpack-bundle-analyzer `4.8 0 → 4.9`

## v6.2.0 - 2023-05-31

* Updated Babel configuration to enable key transforms via preset-env `includes` directive. Resolves issue with outdated
  plugin names in the prior config causing errors like "cannot find package @babel/plugin-proposal-class-properties"
  for apps that updated to Babel 7.22 (several key transforms were released under new names with the 7.22 release -
  see https://github.com/babel/babel/pull/15614).
* Updated special transformations for the FontAwesome icon dependencies to include their "thin" package, which was added
  to hoist-react last year and was not being properly tree-shaken.
* Updated minimal shim for required-only BlueprintJS icons to restore another bundle size reduction that had been lost
  with the update to Blueprint 4.x back in Hoist React v50. Update required a new path for import transformations and
  moved the shim file from hoist-react to this project.

### 📚 Libraries

* @babel/* `7.21 → 7.22`
* css-loader `6.7 → 6.8`
* postcss-loader `7.1 → 7.3`
* sass `1.59 → 1.62`
* sass-loader `13.2 → 13.3`
* webpack `5.76 → 5.84`
* webpack-cli `5.0 → 5.1`
* webpack-dev-server `4.13 → 4.15`

## v6.1.2 - 2023-03-22

### 📚 Libraries

* @babel/* `7.20 → 7.21`
* changelog-parser `2.8 → 3.0`
* postcss-loader `7.0 → 7.1`
* rimraf `3.0 → 4.4`
* sass `1.56 → 1.59`
* webpack `5.75 → 5.76`
* webpack-dev-server `4.11 → 4.13`

## v6.1.1 - 2022-12-07

* Flipped options for Babel plugins related to decorator and class field proposals, reverting to `loose:false` (the
  default) as per latest MobX docs.
    * ⚠️Required for updated implementation of the `@bindable` decorator in Hoist React v54.

## v6.1.0 - 2022-11-21

### 🎁 New Features

* Typescript support for Hoist React v54+ via `@babel/plugin-transform-typescript`.
* Remains compatible for use with JS-only application projects and prior JS-only versions of Hoist React.

### 📚 Libraries

* @babel/* `7.18 → 7.20`
* @xh/eslint-config `4.0 → 5.0`
* babel-loader `8.2 → 9.1`
* mini-css-extract-plugin `2.6 → 2.7`
* sass `1.53 → 1.56`
* sass-loader `13.0 → 13.2`
* webpack `5.73 → 5.75`
* webpack-cli `4.10 → 5.0`
* webpack-dev-server `4.9 → 4.11`

[Commit Log](https://github.com/xh/hoist-dev-utils/compare/v6.0.0...v6.1.0)

## v6.0.0 - 2022-07-19

* This release features a major update to Webpack v5, along with updates to all supporting libraries.

### 💥 Breaking Changes

* Requires Hoist React v48+.
* Imports from `package.json` no longer support default export - you must import the entire package JSON as an object.
  This is most likely to be relevant in `Bootstrap.js` where apps read the Ag-Grid version from its package. See this
  file within the XH Toolbox app for the updated syntax.
* The syntax form passing variables to `yarn` scripts in your package.json has changed - note the removal of the dot:
    * e.g. `webpack --env.prodBuild` > `webpack --env prodBuild`
    * This will likely require updates to automated builds which pass in version / build tags via env args.
* If you have a mobile app, you must provide a wider range of favicons for display on devices.
  See https://github.com/xh/hoist-dev-utils/#favicons for more details.

### 📚 Libraries

* @babel/* `7.16 → 7.18`
* @cerner/duplicate-package-checker-webpack-plugin `added @ 2.3` (fork w/WP5 support)
* @xh/eslint-config `3.1 → 4.0` (includes eslint v8)
* clean-webpack-plugin `3.0 → 4.0`
* copy-webpack-plugin `6.3 → 11.0`
* css-loader `5.2 → 6.7`
* favicons-webpack-plugin `removed`
* html-webpack-plugin `4.5 → 5.5`
* html-webpack-tags-plugin `2.0 → 3.0`
* mini-css-extract-plugin `1.6→ 2.6`
* postcss `8.3 → 8.4`
* postcss-loader `4.1 → 7.0`
* sass `1.37 → 1.49`
* sass-loader `10.1 → 13.0`
* style-loader `2.0 → 3.3`
* terser-webpack-plugin `4.2 → 5.3`
* webpack `4.44 → 5.73`
* webpack-cli `3.3 → 4.10`
* webpack-dev-server `3.11 → 4.9`
* webpackbar `4.0 → 5.0`

[Commit Log](https://github.com/xh/hoist-dev-utils/compare/v5.14.0...v6.0.0)

## v5.14.0 - 2022-06-09

* Supports new `reactProdMode` flag passed to `configureWebpack()`. Use to force React into production mode during local
  development. (Production builds always use prod mode, as before.)

[Commit Log](https://github.com/xh/hoist-dev-utils/compare/v5.13.0...v5.14.0)

## v5.13.0 - 2021-12-17

### 📚 Libraries

* @xh/eslint-config `3.0 → 3.1`

[Commit Log](https://github.com/xh/hoist-dev-utils/compare/v5.12.0...v5.13.0)

## v5.12.0 - 2021-12-15

### 📚 Libraries

* @babel/* `7.15 → 7.16`
* autoprefixer `10.3 → 10.4`
* webpack-bundle-analyzer `4.4 → 4.5`

[Commit Log](https://github.com/xh/hoist-dev-utils/compare/v5.11.1...v5.12.0)

## v5.11.1 - 2021-10-04

* Pass flag to HTML template to indicate if preload spinner is present and should be rendered.
    * Respected by `hoist-react >= v43.0.2`.

[Commit Log](https://github.com/xh/hoist-dev-utils/compare/v5.11.0...v5.11.1)

## v5.11.0 - 2021-09-30

### 🎁 New Features

* Support for copying the animated png used by Hoist React v43+ as a preload spinner into /public,
  so it can be loaded and shown while the JS app downloads and prepares to render.

[Commit Log](https://github.com/xh/hoist-dev-utils/compare/v5.10.0...v5.11.0)

## v5.10.0 - 2021-09-28

### 🎁 New Features

* New `devHttps` config adds support for running the local webpack-dev-server over SSL.

[Commit Log](https://github.com/xh/hoist-dev-utils/compare/v5.9.3...v5.10.0)

## v5.9.3 - 2021-08-10

* Add newly required babel plugin config to avoid console warnings during compilation.

[Commit Log](https://github.com/xh/hoist-dev-utils/compare/v5.9.2...v5.9.3)

## v5.9.2 - 2021-08-10

### 📚 Libraries

* @babel/* `7.14 → 7.15`
* autoprefixer `10.2 → 10.3`
* sass `1.35 → 1.37`

[Commit Log](https://github.com/xh/hoist-dev-utils/compare/v5.9.1...v5.9.2)

## v5.9.1 - 2021-06-24

### 📚 Libraries

* @babel/* `7.13 → 7.14`
* mini-css-extract-plugin `1.4 → 1.6`
* post-css `8.2 → 8.3`
* sass `1.32 → 1.35`

[Commit Log](https://github.com/xh/hoist-dev-utils/compare/v5.9.0...v5.9.1)

## v5.9.0 - 2021-05-04

### ⚙️ Technical

* Updated default `targetBrowsers` config for Babel-based transpiling to replace `Edge >= 18` with
  `last 2 Edge versions` (v89-90 as of this release). This removes a certain amount of transpiled
  code generated to support Edge 18.
    * Edge 18 was the last version released before that browser's switch to the Chromium engine in
      January 2020.
    * ⚠ Any apps that require Edge 18 support and observe issues with this change can specify an
      appropriate set of targets within their `webpack.config.js` file.

[Commit Log](https://github.com/xh/hoist-dev-utils/compare/v5.8.0...v5.9.0)

## v5.8.0 - 2021-04-22

### 🎁 New Features

* New `faviconManifestConfig` option added to `configureWebpack()` build script. Allows
  customization of certain options related to adding a mobile app to a device home screen, as well
  as "installing" an app via Chrome's "create shortcut" option.
    * Default options also improved to properly set application name, version, and non-empty
      description (defaults to appName, but squelches console warning).
    * See https://github.com/itgalaxy/favicons#usage for supported options.

[Commit Log](https://github.com/xh/hoist-dev-utils/compare/v5.7.0...v5.8.0)

## v5.7.0 - 2021-04-09

### 🎁 New Features

* New `parseChangelog` option added to `configureWebpack()` build script. Set to `true` (default) to
  parse an application `CHANGELOG.md` file at the root of your project directory for import by Hoist
  React's `XH.changelogService`, which will make its contents available to app users. (Changelog UI
  features require @xh/hoist v39.1+.)

### ⚙️ Technical

* The `configureWebpack()` build script function is now async, to support internal async calls. This
  is supported out-of-the-box by Webpack, and should not require any application-level changes.

### 📚 Libraries

* changelog-parser `added @ 2.8`
* css-loader `5.0 → 5.2`
* mini-css-extract-plugin `1.3 → 1.4`

[Commit Log](https://github.com/xh/hoist-dev-utils/compare/v5.6.0...v5.7.0)

## v5.6.0 - 2021-02-23

* Includes updated `@xh/eslint-config@3.0` with switch to `@babel/eslint-parser` - fixes
  auto-updates in toolchain dependencies that started to break linting.
* Additional type mapping in `module.rules` to support `.mjs` distros out of the `stylis` library,
  included as a transitive dep by `react-select@v4`.

### 📚 Libraries

* @babel/* `7.12 → 7.13`
* @xh/eslint-config `2.3 → 3.0`
* autoprefixer `10.0 → 10.2`
* case-sensitive-paths-webpack-plugin `2.3 → 2.4`
* postcss `8.1 → 8.2`
* sass `1.29 → 1.32`
* webpack-bundle-analyzer `4.2 → 4.4`

[Commit Log](https://github.com/xh/hoist-dev-utils/compare/v5.5.0...v5.6.0)

## v5.5.0 - 2020-12-04

### 🎁 New Features

* New `sourceMaps` option added to `configureWebpack()` build script. Apps can now control sourceMap
  generation, including specifying `'devOnly'` to disable maps in production (a recommended security
  practice for untrusted environments). Default behavior is unchanged.

### 📚 Libraries

* @babel/* `7.11 → 7.12`
* @types/react `16.9 → 17.0`
* autoprefixer `9.8 → 10.0`
* babel-loader `8.1 → 8.2`
* copy-webpack-plugin `6.1 → 6.3`
* css-loader `4.3 → 5.0`
* file-loader `6.1 → 6.2`
* mini-css-extract-plugin `0.11 → 1.3`
* postcss `added @ 8.1`
* postcss-flexbugs-fixes `4.2 → 5.0`
* postcss-loader `3.0 → 4.1`
* sass `1.26 → 1.29`
* sass-loader `9.0 → 10.1`
* style-loader `1.2 → 2.0`
* webpack-bundle-analyzer `3.9 → 4.2`

[Commit Log](https://github.com/xh/hoist-dev-utils/compare/v5.4.0...v5.5.0)

## v5.4.0 - 2020-09-22

### 🎁 New Features

* When paired with `hoist-react >= v36.1.0`, this release of dev-utils will avoid the use of any
  inline script tags within the `index.html` file generated for each app. Instead, it will copy and
  inject a link to an unbundled copy of the `static/preflight.js` script supplied by hoist-react.
    * This allows for stricter Content Security Policy (CSP) headers - see Toolbox's nginx config @
      `docker/nginx/app.conf` for an example.

### 📚 Libraries

* copy-webpack-plugin `6.0 → 6.1`
* css-loader `4.2 → 4.3`
* file-loader `6.0 → 6.1`
* html-webpack-plugin `4.3 → 4.5`
* html-webpack-tags-plugin `added @ 2.0`
* mini-css-extract-plugin `0.9 → 0.11`
* terser-webpack-plugin `4.1 → 4.2`
* webpack-bundle-analyzer `3.8 → 3.9`

[Commit Log](https://github.com/xh/hoist-dev-utils/compare/v5.3.0...v5.4.0)

## v5.3.0 - 2020-08-20

### 📚 Libraries

Resolutions added for some transitive dependencies that had grown excessively stale and were
triggering console warnings on install/upgrade. Reviewed changelogs for these projects and did not
see any indication that they would be incompatible.

* @babel/core `7.10 → 7.11`
* css-loader `3.6 → 4.2`
* favicons-webpack-plugin `3.0 → 4.2`
* mini-css-extract-plugin `0.9 → 0.10`
* terser-webpack-plugin `3.0 → 4.1`
* webpack `4.43 → 4.44`

[Commit Log](https://github.com/xh/hoist-dev-utils/compare/v5.2.2...v5.3.0)

## v5.2.2 - 2020-07-21

### 🐞 Bug Fixes

* Fix check to detect if replacement stub file for Blueprint icons actually exists.
* (Note v5.2.1 release built but scratched due to error in fix above.)

[Commit Log](https://github.com/xh/hoist-dev-utils/compare/v5.2.0...v5.2.2)

## v5.2.0 - 2020-07-20

### 🎁 New Features

* App builds now load only a handful of `@blueprintjs` icons that are actually used by components.
  This change significantly reduces build size as BP ships a large set of generic SVG icons and
  bundles them all by default, but Hoist already includes FontAwesome as our standard icon library.
    * If the full set of Blueprint icons are required for a special app use-case, `configureWebpack()`
      now supports a new `loadAllBlueprintJsIcons` argument to revert to the previous behavior.
    * Requires Hoist React v35.2+ to supply the more minimal set of icon SVGs. Older
      versions of HR are compatible with this version of dev-utils, but the icons optimization will
      not be activated.

### 📚 Libraries

* @xh/eslint-config `2.2 → 2.3`

[Commit Log](https://github.com/xh/hoist-dev-utils/compare/v5.1.0...v5.2.0)

## v5.1.0 - 2020-07-02

### 📚 Libraries

This version switches to the newly-recommended dart-sass library (aka the `sass` npm package) for
SASS compilation. This replaces the often-problematic usage of node-sass, which required OS-specific
tooling to support building native code on developer workstations.

* css-loader `3.5 → 3.6`
* node-sass `removed`
* sass `added @ 1.26`
* sass-loader `8.0 → 9.0`

[Commit Log](https://github.com/xh/hoist-dev-utils/compare/v5.0.0...v5.1.0)

## v5.0.0 - 2020-06-12

### ⚖️ Licensing Change

As of this release, Hoist is [now licensed](LICENSE.md) under the popular and permissive
[Apache 2.0 open source license](https://www.apache.org/licenses/LICENSE-2.0). Previously, Hoist was
"source available" via our public GitHub repository but still covered by a proprietary license.

We are making this change to align Hoist's licensing with our ongoing commitment to openness,
transparency and ease-of-use, and to clarify and emphasize the suitability of Hoist for use within a
wide variety of enterprise software projects. For any questions regarding this change, please
[contact us](https://xh.io/contact/).

### 📚 Libraries

This release includes updates to a number of tooling dependencies, including some major updates.
However no changes to application code or configs should be required.

* @babel/core `7.9 → 7.10`
* @babel/preset-env `7.9 → 7.10`
* @babel/preset-react `7.9 → 7.10`
* autoprefixer `9.7 → 9.8`
* copy-webpack-plugin `5.1 → 6.0`
* css-loader `3.4 → 3.5`
* favicons-webpack-plugin `2.1 → 3.0`
* html-webpack-plugin `3.2 → 4.3`
* node-sass `4.13 → 4.14`
* style-loader `1.1 → 1.2`
* terser-webpack-plugin `2.3 → 3.0`
* url-loader `4.0 → 4.1`
* webpack `4.42 → 4.43`
* webpack-bundle-analyzer `3.6 → 3.8`
* webpack-dev-server `3.10 → 3.11`

[Commit Log](https://github.com/xh/hoist-dev-utils/compare/v4.6.0...v5.0.0)

## v4.6.0 - 2020-03-29

### 🎁 New Features

* New Babel preset-env `bugfixes` option defaulted to true. Intended to to further minimize
  transpilation to ES5 where not required by targeted browsers. See
  [Babel Docs](https://babeljs.io/docs/en/babel-preset-env#bugfixes).
* New `babelPresetEnvOptions` config accepted to allow direct override / customization of options
  passed to the babel-loader preset-env preset (including disabling the new option above if
  problematic).
* New `dupePackageCheckExcludes` config accepted to suppress duplicate package warnings by name.
  Defaulted to exclude longstanding (but not problematic) warning for `tslib`.

### 📚 Libraries

* @babel/core `7.8 → 7.9`
* @babel/preset-env `7.8 → 7.9`
* @babel/preset-react `7.8 → 7.9`
* babel-loader `8.0 → 8.1`
* file-loader `5.0 → 6.0`
* url-loader `3.0 → 4.0`

[Commit Log](https://github.com/xh/hoist-dev-utils/compare/v4.5.0...v4.6.0)

## 4.5.0 - 2020-03-04

### 🎁 New Features

* The `/client-app/public` directory and its contents are now copied into the build output. Can be
  used to include static assets you wish to link to without using an import to run through the url
  or file-loader.

### 📚 Libraries

* copy-webpack-plugin: `added @ 5.1`
* webpack: `4.41 → 4.42`

[Commit Log](https://github.com/xh/hoist-dev-utils/compare/v4.4.1...v4.5.0)

## 4.4.1 - 2020-02-26

### 🐞 Bug Fixes

* Fixed favicon generation with upgrade of plugin - generated HTML again includes tags for correctly
  sized favicons across a variety of platforms.

### 📚 Libraries

* favicons-webpack-plugin: `1.0 → 2.1`

[Commit Log](https://github.com/xh/hoist-dev-utils/compare/v4.4.0...v4.4.1)

## 4.4.0 - 2020-02-08

### 📚 Libraries

* @babel/core (and related) `7.7 → 7.8`
* css-loader `3.2 → 3.4`
* mini-css-extract-plugin `0.8 → 0.9`
* style-loader `1.0 → 1.1`
* terser-webpack-plugin `2.2 → 2.3`
* webpack-dev-server `3.9 → 3.10`

[Commit Log](https://github.com/xh/hoist-dev-utils/compare/v4.3.7...v4.4.0)

## 4.3.7 - 2019-12-06

### 📚 Libraries

* @babel/plugin-proposal-nullish-coalescing-operator `7.4 → 7.7`
* @babel/plugin-proposal-optional-chaining `7.6 → 7.7`
* file-loader `4.2 → 5.0`
* url-loader `2.2 → 3.0`

[Commit Log](https://github.com/xh/hoist-dev-utils/compare/v4.3.6...v4.3.7)

## 4.3.6 - 2019-11-19

### 🐞 Bug Fixes

* Disable Terser mangling of identifiers / variables due to intermittent and difficult to debug
  issues with it breaking code, especially when run on already-packaged libraries. Disabling does
  increase bundle size, although not by much on a relative basis.

[Commit Log](https://github.com/xh/hoist-dev-utils/compare/v4.3.5...v4.3.6)

## 4.3.5 - 2019-11-15

### 📚 Libraries

* @babel/core (and related) `7.6 → 7.7`
* autoprefixer `9.6 → 9.7`
* node-sass `4.12 → 4.13`
* terser-webpack-plugin `2.1 → 2.2`
* webpack-bundle-analyzer `3.5 → 3.6`
* webpack-dev-server `3.8 → 3.9`
* chalk (removed)

[Commit Log](https://github.com/xh/hoist-dev-utils/compare/v4.3.4...v4.3.5)

## 4.3.4 - 2019-10-14

### ⚙️ Technical

* Bundled `@types/lodash` and `@types/react` as dev dependencies for developer convenience / better
  hinting options from IDEs, including support for types such as `ReactNode` in jsdoc comments.

### 📚 Libraries

* @babel/preset-react `7.0 → 7.6`

[Commit Log](https://github.com/xh/hoist-dev-utils/compare/v4.3.3...v4.3.4)

## 4.3.3 - 2019-10-07

### ⚙️ Technical

* Add new `terserOptions` config as hook for app builds to customize Terser minification directly if
  required, although defaults should continue to be fine as they are. Added `keep_classnames: true`
  to the Terser defaults now that we are emitting classes.

### 📚 Libraries

* url-loader `2.1 → 2.2`

[Commit Log](https://github.com/xh/hoist-dev-utils/compare/v4.3.1...v4.3.3)

(4.3.2 was an accidental no-op build 😞)

## 4.3.1 - 2019-10-02

### 📚 Libraries

* @xh/eslint-config `2.1 → 2.2`

[Commit Log](https://github.com/xh/hoist-dev-utils/compare/v4.3.0...v4.3.1)

## 4.3.0 - 2019-09-27

### ⚙️ Technical

* Removes a previous workaround in `configureWebpack` to always transpile JS code down to ES5
  (implemented by pushing IE11 onto the `targetBrowsers` config passed to `babel/preset-env`). Babel
  will now actually use Hoist's default target browsers (recent versions of Chrome, Safari/iOS, and
  Edge) resulting in a build output with significantly less transformation of the source code.
* Apps or client environments that find they need support for less capable browsers (e.g, a secure
  mobile browser using an older JS engine) can pass a custom `targetBrowsers` array to adjust the
  output.

### 📚 Libraries

* webpack `4.40 → 4.41`

[Commit Log](https://github.com/xh/hoist-dev-utils/compare/v4.2.0...v4.3.0)

## 4.2.0 - 2019-09-23

### 🎁 New Features

* Support for the nullish coalescing operator `let foo = bar ?? 'default'` via the
  `@babel/plugin-proposal-nullish-coalescing-operator` plugin.

[Commit Log](https://github.com/xh/hoist-dev-utils/compare/v4.1.2...v4.2.0)

## 4.1.2 - 2019-09-18

* Tweak to skip logging (spurious) packaged Hoist version when running with Hoist inline.

[Commit Log](https://github.com/xh/hoist-dev-utils/compare/v4.1.1...v4.1.2)

## 4.1.1 - 2019-09-17

### 📚 Libraries

* @xh/eslint-config `2.0 → 2.1.1`
* terser-webpack-plugin `2.0 → 2.1`

[Commit Log](https://github.com/xh/hoist-dev-utils/compare/v4.0.0...v4.1.1)

## 4.0.0 - 2019-09-12

This release includes a number of major/minor updates for the build toolchain. Most notably, it
updates Babel and its plugins from `7.4 → 7.6`, which removes support for the `@babel/polyfill`
plugin we had been using in favor of `core-js@3` for polyfills (as of 7.5).

### 🎁 New Features

* Support for the nullsafe operator `let foo = bar?.baz` via the
  `@babel/plugin-proposal-optional-chaining` plugin.
* Support for `Promise.allSettled()` via the `core-js` polyfills. Hoist v28 will remove its
  dependency on the RSVP library which previously provided this utility.

### 💥 Breaking Changes

* **Requires Hoist React v28+**, which adds a required runtime dependency on `core-js` for polyfills
  as well as a new static import file referenced by `configureWebpack()` to provide a
  once-per-entry-point import of `core-js` and `regenerator-runtime`.

### 📚 Libraries

* @babel `7.4 → 7.6`
* @xh/eslint-config `1.2 → 2.0`
* webpack `4.31 → 4.40`
* *Multiple* other library updates for loaders, plugins, and other utils.

[Commit Log](https://github.com/xh/hoist-dev-utils/compare/v3.8.1...v4.0.0)

## v3.8.1 - 2019-08-19

### ⚙️ Technical

* Ensure react is resolved to a single instance of the library when running in `inlineHoist` mode.
  (Avoids errors when attempting to call hooks that will throw if called across multiple instances
  of the library.)

[Commit Log](https://github.com/xh/hoist-dev-utils/compare/v3.8.0...v3.8.1)

## v3.8.0 - 2019-08-16

### 📚 Libraries

* @xh/eslint-config `1.1.1 → 1.2.0` - react-hooks plugin and linting rules.

[Commit Log](https://github.com/xh/hoist-dev-utils/compare/v3.7.7...v3.8.0)

## v3.7.7 - 2019-08-07

### ⚙️ Technical

* Added new `checkForDupePackages` flag, default true to mirror previous behavior added in 3.7.5.
  Set to false to disable duplicate package checking / warnings if unwanted.

[Commit Log](https://github.com/xh/hoist-dev-utils/compare/v3.7.6...v3.7.7)

## v3.7.6 - 2019-07-25

### 📚 Libraries

* @xh/eslint-config `1.1.0 → 1.1.1` - whitelist WebSocket global.

[Commit Log](https://github.com/xh/hoist-dev-utils/compare/v3.7.5...v3.7.6)

## v3.7.5 - 2019-07-23

### ⚙️ Technical

* Added Webpack `DuplicatePackageCheckerPlugin` to warn on build if non-overlapping dependency
  requirements force the inclusion of a package multiple times. (This was happening with lodash,
  unexpectedly.)

### 📚 Libraries

* Updated lodash to latest patch release (security fixes)

[Commit Log](https://github.com/xh/hoist-dev-utils/compare/v3.7.4...v3.7.5)

## v3.7.4 - 2019-06-25

### 📚 Libraries

* Restored webpack-cli @ 3.3.2

[Commit Log](https://github.com/xh/hoist-dev-utils/compare/v3.7.3...v3.7.4)

## v3.7.3 - 2019-06-25

### 📚 Libraries

* Removed webpack-cli (this made v3.7.3 unusable)

[Commit Log](https://github.com/xh/hoist-dev-utils/compare/v3.7.2...v3.7.3)

## v3.7.2 - 2019-05-14

### 📚 Libraries

* node-sass `4.11 → 4.12`
* webpack `4.30 → 4.31`
* Other minor/patch updates

[Commit Log](https://github.com/xh/hoist-dev-utils/compare/v3.7.1...v3.7.2)

## v3.7.1 - 2019-04-23

### 📚 Libraries

* webpack `4.29 → 4.30`
* webpack-dev-server `3.2 → 3.3`
* Other minor/patch updates

[Commit Log](https://github.com/xh/hoist-dev-utils/compare/v3.7.0...v3.7.1)

## v3.7.0 - 2019-03-27

### 📚 Libraries

* Babel `7.3 → 7.4`
* autoprefixer `9.4 → 9.5`
* webpack-cli `3.2 → 3.3`

[Commit Log](https://github.com/xh/hoist-dev-utils/compare/v3.6.0...v3.7.0)

------------------------------------------

☎️ info@xh.io | <https://xh.io>

Copyright © 2026 Extremely Heavy Industries Inc.
