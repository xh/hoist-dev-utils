# Rsbuild / Rspack Migration (September 2026)

> ## 📋 Historical record - not a migration guide
>
> **This document is the engineering record of how dev-utils moved from webpack to Rsbuild: the
> spike, the measurements, the findings and the dead ends. It is not instructions, and following it
> will not migrate an app.**
>
> **To migrate an app, use the [README](../README.md) and the v16
> [CHANGELOG](../CHANGELOG.md) entry.** Those are maintained; this is not.
>
> It is kept because the reasoning behind non-obvious config choices is hard to reconstruct, and
> because the measurements justify the change. Read it for *why*, never for *how*.
>
> **What shipped differs from what is proposed below**, in three ways that matter if you read on:
>
> | Below | What shipped in v16 |
> |---|---|
> | `configureRsbuild()` alongside `configureWebpack()` | Rsbuild only - `configureWebpack()` removed. Apps staying on webpack stay on dev-utils 15.x. |
> | Babel transforms decorators ahead of SWC, via a `decoratorTransform` option | SWC alone, `source.decorators.version: '2023-11'`. No Babel, and no such option. |
> | hoist-react floor unchanged at 87.1 | Requires hoist-react >= 88. |
>
> So wherever the text speaks of "both configs", a webpack column, or a Babel default, it is
> describing the v15 baseline the port was measured against and the hybrid the spike assumed - not
> the shipped release.

Record of the move from webpack to Rsbuild, shipped in dev-utils 16. It began as the Phase 2 spike
tracked in [#73](https://github.com/xh/hoist-dev-utils/issues/73): a `configureRsbuild()`
counterpart to `configureWebpack()`, validated against Toolbox and two client apps. Background and
the option analysis that led here:
[bundler-migration-analysis.md](https://github.com/xh/hoist-dev-utils/blob/claude/webpack-vite-migration-2mcey2/docs/bundler-migration-analysis.md)
(on its own branch).

Everything below was measured on one 4-core / 15 GB Linux container, Node 22.22, against Toolbox
`11.0-SNAPSHOT` (10 entry points), hoist-dev-utils `16.0.0-SNAPSHOT` (webpack 5.110 / Babel 7.29;
Rsbuild 2.2.5 / Rspack 2.2.3), hoist-react 87.3.0 unless stated. Numbers are single runs on a shared
box - treat ratios as the signal, not the third digit.

## Recommendation: GO

Port confirmed. `configureRsbuild()` builds all ten Toolbox apps with the same feature set from the
same options, the three main apps boot to the same point as the webpack build, 34 of 34 runtime
parity gates pass **against the published hoist-react 87.3.0 with no framework change**, and the
payoff is large. Two Rsbuild columns: at the time of the spike the shipping default transformed
Hoist's legacy decorators with Babel ahead of SWC (`decoratorTransform: 'babel'`, see Finding 1);
the SWC-only column is what the same config yields once hoist-react's decorators no longer depend
on Babel's emit.

> **What shipped is the right-hand column.** hoist-react 88 landed the TC39 decorators migration
> (#4333), so v16 is SWC-only with no Babel pass - see the header box.

| | webpack (`configureWebpack`) | Rsbuild, Babel decorators (default) | Rsbuild, SWC decorators (post-TC39) |
|---|---|---|---|
| Production build, wall clock | 114-138 s across four runs | 46-48 s (**~2.6x faster**) | 29-37 s (**~4x faster**) |
| Production build, peak RSS (process tree) | 4.6-5.7 GB | 2.2-2.3 GB (**~2.3x less**) | 1.4-1.6 GB (**~3.5x less**) |
| Dev server cold start to first served bundle (inline hoist) | 32.5 s (42.7 s on a second run) | 16.7 s (**~2x faster**) | 5.0 s (**~6x faster**) |
| Dev incremental rebuild, app model edit | 2.8 s rebuild, 4.2 s edit-to-reloaded | 0.4 s rebuild, 0.5 s edit-to-reloaded | 0.3 s rebuild, 0.4 s edit-to-reloaded |
| Dev incremental rebuild, component edit | 1.7 s rebuild, 2.6 s edit-to-reloaded | 0.3 s rebuild, 0.4 s edit-to-reloaded | 0.3 s rebuild, 0.4 s edit-to-reloaded |
| Dev server peak RSS | 2.1 GB (needs `--max_old_space_size=3072`) | 1.6 GB (default heap) | 1.3 GB (default heap) |
| Total emitted JS (10 apps, minified) | 22.0 MB / 3.88 MB brotli | 18.3 MB / 3.67 MB brotli (-17% / -5%) | same |
| Total emitted CSS | 2.08 MB | 1.66 MB (-20%) | same |
| Initial JS payload, `/app/` | 14.3 MB / 2.44 MB brotli | 11.7 MB / 2.19 MB brotli (-18% / -10%) | same |

The Babel pass costs about 15 s on a cold compile (it is the same ~800-file transpile webpack pays)
and nothing measurable on incremental rebuilds, where only the edited file is re-transpiled. It is
the price of leaving hoist-react's decorator code untouched until the TC39 migration, and it still
leaves every dev-loop metric an order of magnitude better than today.

Nothing found argues against Rspack as the destination; the remaining work is soak, tuning and app
migration. **`configureRsbuild()` shares `configureWebpack()`'s hoist-react floor (87.1).**

React Fast Refresh engages for modules whose exports react-refresh recognizes as components -
`export const AppComponent = hoistCmp({...})` hot-swapped in place on JobSite - but not for Hoist's
camelCase `hoistCmp.factory(...)` element-factory exports or model classes, which fall back to a
sub-second full reload. Toolbox's edited files were all of the latter kind, which is why the first
cut of this doc reported Fast Refresh as never engaging (see Dev server measurements).

Validation against a real client app (JobSite, see below) found two defects Toolbox's checks had
missed - stale CSS under dev HMR and minification of copied `public/` files - both since fixed in
`configureRsbuild.js` and re-verified here.

The decorators migration (hoist-react #4333) was **not** a prerequisite: with Babel still
transforming decorators, Rspack-first touched neither app source nor hoist-react. In the event the
two landed together - #4333 shipped as hoist-react 88 before v16 was released, so the TC39 flip was
folded into this same release rather than a later one, and v16 ships the right-hand column.

## What was built

- `configureRsbuild.js` - same `env` option surface as `configureWebpack()` (see the JSDoc for the
  handful of renames: `swcOptions` for `babelPresetEnvOptions`, `minifyOptions` for `terserOptions`,
  `logLevel` for `stats` / `infrastructureLoggingLevel`, plus new `minify` and `buildCache`). Babel-era
  options with no SWC equivalent are rejected with a pointer, never silently dropped.
- `readCliEnv()` - Rsbuild's CLI has no `--env key=value`; build-time overrides arrive as `XH_*`
  environment variables (`XH_APP_VERSION`, `XH_APP_BUILD`, `XH_PROD_BUILD`, `XH_INLINE_HOIST`, ...).
  Toolbox maps Rsbuild's `--env-mode prod|inlineHoist` onto `prodBuild` / `inlineHoist` as well.
- `lib/common.js` + `lib/HoistManifestPlugin.js` - the bundler-agnostic ~40% of the old file, now
  shared. `configureWebpack()` was re-pointed at them and its build output verified identical
  (same file set, byte-identical sizes for every JS/CSS asset, HTML/manifests identical modulo
  content hashes) against the pre-refactor config built from the same checkout.
- Toolbox: `rsbuild.config.mjs`, `build:rsbuild` / `start:rsbuild` / `startWithHoist:rsbuild`
  scripts, `@rsbuild/core` in `publicHoistPattern` for the `rsbuild` bin. Webpack stays the default.
- No hoist-react change. A candidate `@persist` change was written, reviewed and **reverted** - see
  Finding 1 for why.

## Feature parity checklist (issue #73 spike scope)

| Item | Status | Notes |
|---|---|---|
| All 10 entry points from `src/apps/*`, per-app HTML + manifest.json | ✅ | `source.entry` map + `html.outputStructure: 'nested'` + shared `static/index.html` template (parameters flattened to bundler-neutral names). Same `HoistManifestPlugin` on both compilers (`compiler.webpack` is aliased on Rspack). |
| Raw-TS transpilation of `@xh/hoist` + `@xh/package-template` (pnpm parity) | ✅ | `source.include` of realpath'd `srcPath`, `hoistPath`, `extraIncludePaths`; SWC via `builtin:swc-loader`. Rsbuild also compiles every `.ts/.tsx` it meets by default, so this is belt-and-braces. |
| `inlineHoist` alias mechanics | ✅ | Same aliases (`@xh/hoist`, `react`, `react-dom`, `ag-grid-react`), `resolve.aliasStrategy: 'prefer-alias'` so they beat any tsconfig `paths`. Validated: dev-mode inline build boots; 34/34 gates. |
| Decorator parity gates, legacy mode; class-field semantics set explicitly | ✅ | 34 runtime gates, both bundlers, published 87.3 production and inline dev/prod - see below. Default mode reuses Babel's decorator transform outright. For `'swc'` mode, `useDefineForClassFields: true` and `decoratorMetadata: false` are asserted in `tools.swc` (Rsbuild's legacy preset flips define-semantics *off*, which would diverge from tsconfig and Babel). |
| `xh*` globals | ✅ | `source.define`; `process.env` fallback retained. |
| Changelog `.xhtmp` alias | ✅ | Shared `writeChangelogJson()`; gate reads the parsed versions. |
| Blueprint icon stubs | ✅ | `rspack.NormalModuleReplacementPlugin` with the same three resolved-path regexes (matches after resolve, as webpack's does). Plain `resolve.alias` would *not* work - the barrel imports are relative. |
| FontAwesome via `transformImport` | ✅ | `source.transformImport` with `customName: '<pkg>/{{ member }}'`, `transformToDefaultImport: false`; 970 distinct deep imports in the Toolbox bundle, gate confirms `faCheck`. |
| SCSS pipeline | ✅ | `@rsbuild/plugin-sass` (sass-embedded). Vendor prefixing moves from postcss/autoprefixer to Rspack's built-in Lightning CSS loader, driven by the same browserslist. CSS is extracted in dev as well as prod (Rsbuild default; HMR-capable). |
| Markdown as text + `?url` | ✅ | Explicit `.md` rule (`asset/source`, `resourceQuery: /url/` → `asset/resource`). Gate checks both. |
| moment `IgnorePlugin` | ✅ | `rspack.IgnorePlugin`; gate: `moment.locales().length === 1`. |
| Public-dir copy (hoist + app, app wins) | ✅ | `output.copy` (CopyRspackPlugin); Rsbuild's own `server.publicDir` disabled. `preflight.js` cache-busted by a content hash rather than the compilation hash. |
| Dev server: Grails proxy, per-app `historyApiFallback`, HTTPS, overlay | ✅ (HTTPS untested) | http-proxy-middleware v3 options - note `pathFilter`, not webpack-dev-server's `context` (see Known differences); rewrites per app; `devHttps: true` uses `@rsbuild/plugin-basic-ssl` for a self-signed cert, object form passes through to `server.https`. Overlay maps `{errors, runtimeErrors}` → `{errors, runtime}`; there is no `warnings` equivalent. |
| React Fast Refresh with Hoist idioms | measured | See dev-server results. |
| `--no-live-reload` workflow | ✅ | New `devLiveReload` option on both configs (`XH_DEV_LIVE_RELOAD` on the CLI side): `dev.liveReload` on Rsbuild, `devServer.liveReload` on webpack. Rsbuild's client still logs "performing full reload" on a non-accepted update, but its `fullReload()` is gated on the flag and no navigation occurs - verified with a model edit against Toolbox. |
| SWC minifier parity with the Terser stance | ✅ | `keep_classnames` / `keep_fnames` on both `compress` and `mangle`; gates confirm `constructor.name` survives (hoist's `@abstract` message and `xhName` depend on it). |
| Prod output diff vs webpack | ✅ | Same layout (`<app>/index.html`, JS/CSS at root, `static/media/*`, `public/**`, `.br`/`.gz` twins, `.LICENSE.txt`, source maps). Chunk *composition* differs - see Known differences. |
| Measurements | ✅ | Table above and below. |

## Runtime parity gates

`configureWebpack.js` and the decorator layer had never been exercised by any transpiler other than
Babel, so the spike built a small harness app (kept out of the repos - it lives with the bench
scripts) with 34 gates run in headless Chromium against each bundler's *built* output:

- MobX 6 / Hoist legacy decorators: `@observable`, `@observable.ref`, `@bindable`, `@bindable.ref`
  (getter/setter, generated `setX()`, action-wrapping, inheritance across two levels), `@computed`,
  `@action` + MobX `@override`, `@managed` (inherited lists, destroy propagation), `@lookup`
  registration, `@persist` / `@persist.with` (synchronous initial read, write-back), hoist's
  `checkMakeObservable` error path.
- Class-field semantics: `[[Define]]` shadowing a base accessor, a re-declared field resetting a
  base-constructor value to `undefined`, `declare` fields emitting nothing, arrow fields, statics,
  `#private`.
- `utils/js` decorators: `@debounced`, `@computeOnce` (getter + method), `@logWithDebug`,
  `@enumerable`, `@abstract` (message names the class - needs `keep_classnames`),
  `@sharePendingPromise`.
- Build integration: `xh*` globals, `process.env`, changelog alias, markdown raw + `?url`, image
  inline vs URL, FontAwesome rewrite, moment locales, SCSS applied, element factory rendering.

| Run | webpack (Babel legacy) | Rsbuild, `decoratorTransform: 'babel'` (default) | Rsbuild, `decoratorTransform: 'swc'` |
|---|---|---|---|
| Published hoist-react 87.3.0, production | 34/34 (one gate is dev-only, skipped) | **34/34** | **bundle fails to load** - `TypeError: Cannot read properties of undefined (reading 'get')` from `@persist` |
| Local hoist-react with an experimental emit-agnostic `@persist` (since reverted), inline dev | 34/34 | n/a | 34/34 |
| Same, production | 34/34 | n/a | 34/34 |

Every gate produced the same result under both transpilers wherever the bundle loaded at all -
including the class-field cases that the issue flagged as the one real technical gate. The SWC
column is the evidence that SWC's legacy mode is otherwise a faithful stand-in for Babel's, which
is what makes the eventual `'swc'` flip low-risk once `@persist` is emit-agnostic.

## Findings and fixes

1. **`@persist` is Babel-coupled; resolved on the dev-utils side, not in hoist-react.** Babel's
   legacy decorator emit passes field decorators a descriptor carrying a non-standard
   `initializer`, which `@persist` wraps to make the persisted value the property's initial value.
   TypeScript-style emit (SWC, `tsc`) passes field decorators **no descriptor at all**, so
   `descriptor.get` throws at class definition time - taking down the whole hoist-react bundle, in
   both the harness and Toolbox (`@persist` is used inside hoist-react itself). `@bindable`,
   `@managed`, `@lookup` and MobX's own decorators are already emit-agnostic.

   A hoist-react change making `@persist` work under both emits was written and put through an
   adversarial review. Its Babel path was a provably inert refactor, but its SWC path was a second
   semantic model - persisted values applied at `makeObservable(this)` rather than at field
   initialization - with three observable divergences: sibling field initializers reading the
   code default instead of the persisted value (Toolbox's `GridTestModel` does exactly this), a
   silent no-op for classes that never call `makeObservable(this)` (the canonical doc example),
   and looser `persistWith` ordering than Babel accepts. That is not a change to argue for right
   before the TC39 migration rewrites the same decorator on the spec `init` hook, which gives
   field-init timing on every transpiler. **It was reverted.**

   Instead, `configureRsbuild()` defaults to `decoratorTransform: 'babel'`: `@rsbuild/plugin-babel`
   runs `@babel/plugin-proposal-decorators` (legacy) with the same per-extension TypeScript
   handling as `configureWebpack()` ahead of SWC, so decorated classes compile through the very
   same plugin under both configs. Cost and payoff are in the table above. `'swc'` mode stays
   selectable for measurement, warning at build time that SWC's legacy emit breaks `@persist` on
   current hoist-react releases.

   **Resolved.** hoist-react 88 rewrote `@persist` on the TC39 accessor-decorator `init` chain,
   which gives field-init timing on every transpiler and removes the Babel coupling this finding
   was about. v16 therefore ships `source.decorators.version: '2023-11'` with no Babel pass and no
   `decoratorTransform` option, and raises the hoist-react floor to 88. The decorator shapes
   hoist-react 88 depends on - `addInitializer` on accessor decorators (`@bindable`), an `{init}`
   return composing under a MobX decorator (`@persist`), a field-decorator initializer return
   (`@managed`, `@lookup`) and plain method decorators - were each verified against SWC's
   `2023-11` emit before the flip. Note that hoist-react's `@managed` / `@lookup` carry a comment
   attributing the initializer-return pattern to a *Babel* `addInitializer` bug; the pattern is
   spec-standard and works under SWC too, so the comment is stale but the code is correct.
2. **Module concatenation trips hoist-react's import cycles.** Rsbuild's production preset enables
   scope hoisting (`optimization.concatenateModules`), which merges modules into one function scope -
   so a circular import that webpack tolerated became `ReferenceError: Cannot access 'span' before
   initialization`. `configureWebpack()` never concatenated (`mode: 'none'`), and hoist-react's graph
   has only been proven in that regime, so `configureRsbuild()` disables it alongside
   `sideEffects: false` (the same class of hazard as hoist-react #4640). Re-enabling both is a bundle
   size/perf win to chase *after* #4640 is resolved.
3. **Blueprint icon stubs silently depended on pnpm's bin shims.** `@blueprintjs/icons` is not a
   dependency of any app, and under pnpm's isolated layout it is not resolvable from the app root.
   The webpack path only found it because pnpm's generated `node_modules/.bin/*` shims export a
   `NODE_PATH` pointing at pnpm's hidden hoist directory - launching the bundler CLI any other way
   (as the first Rsbuild runs did) disabled the stubs with a one-line warning and shipped the full
   ~2.4 MB icon set. `lib/common.js` now walks the real chain hoist-react → `@blueprintjs/core` →
   `@blueprintjs/icons`, fixing both configs.
4. **Polyfill selection.** SWC's `env.mode: 'entry'` rewrites hoist-react's `core-js/stable` import
   just as Babel's `useBuiltIns: 'entry'` did. Note that `configureWebpack()` declares
   `corejs: {version: 3}`, i.e. **3.0**, so Babel has only ever considered the 3.0 feature set - four
   modules for current targets. Pointing SWC at the installed 3.50 instead injected 16 (explicit
   resource management, iterator helpers, `Promise.try`, ...) that core-js-compat reports current
   Safari as lacking. The port pins 3.0 for parity; whether to track the installed minor is a
   separate policy decision. Residual difference: SWC's compat data omits `es.array.includes`
   (Babel includes it on a spec-conformance technicality); natively supported everywhere we target.
5. **Harness import order.** Importing a leaf barrel (`@xh/hoist/cmp/layout`) before
   `@xh/hoist/core` fails identically under *both* bundlers with a cycle TDZ - a pre-existing
   hoist-react property, not a port issue, but a useful reminder of what #4640 is about.

## Known differences (accepted for the spike)

- **Chunk composition.** Same `chunks: 'all'` intent, but Rspack's grouping differs: per-entry chunks
  are larger (admin 580 KB vs 274 KB) while total initial payload per app is ~18% smaller raw / ~10%
  smaller brotli. `splitChunks` tuning is a follow-up, not a blocker.
- **CSS in dev is extracted** to files (Rsbuild default, HMR-capable) rather than injected by
  style-loader. Dev filenames are unhashed (`[name].js`); prod hashing matches (`[name].[contenthash:8]`).
- **Minifier**: SWC replaces Terser; CSS minified by Lightning CSS (accounts for most of the CSS
  size drop). Vendor prefixing by Lightning CSS instead of autoprefixer - same browserslist.
- **`resolve.extensions`** kept at `['.js', '.ts', '.tsx', '.json']` (no `.mjs` / `.jsx`), as before.
- **Dev overlay** has no `warnings` toggle. `stats` / `infrastructureLoggingLevel` collapse to
  `logLevel`. `webpackbar` replaced by Rsbuild's progress bar. `CaseSensitivePathsPlugin` replaced by
  Rspack's built-in `CaseSensitivePlugin` (dev only, as before).
- **Bundle analysis** moves to Rsdoctor as an app-level opt-in (`RSDOCTOR=true`). The spike verified
  `webpack-bundle-analyzer` still works on Rspack stats, but Rsbuild ships a built-in Rsdoctor
  integration, so the option and the dependency were dropped rather than kept.
- **Decorator metadata**: Rsbuild's legacy preset turns on `emitDecoratorMetadata`-style output;
  explicitly disabled (Hoist uses none, and it bloats every decorated class).
- **No `.LICENSE.txt` sidecar for copied `public/` JS.** webpack's Terser pass minifies hoist's
  `msal-redirect-bridge.min.js` and extracts its license banner to `msal-redirect-bridge.min.js.LICENSE.txt`;
  Rsbuild now copies the file byte-for-byte with the banner inline and emits no sidecar. Not a copy
  failure - the Rsbuild output is the more faithful of the two. Same root, opposite direction:
  Rsbuild emits `.br` / `.gz` twins for `public/preflight.js` and webpack does not, because the
  verbatim 1895 B file clears the 1024 B compression threshold while webpack's minified 1020 B copy
  does not.
- **`--env` flags** → `--env-mode` for the build mode, `XH_*` environment variables for CI
  overrides, and the same variables in `.env` / `.env.local` / `.env.<mode>` files (loaded by
  Rsbuild's CLI into `process.env` before the config runs - verified: `XH_APP_VERSION` in
  `.env.probe` reached the banner via `--env-mode probe`) for per-mode and per-developer defaults.
  Release workflows need their `appVersion` / `appBuild` overrides rewritten as variables. A
  dev-utils bin re-introducing `--env key=value` was considered and rejected: Rsbuild's own `--env`
  is a dotenv toggle, so the name would carry two meanings, the concept is webpack-cli-specific,
  and the script lines change anyway with the command name.
- **Dev proxy option names** follow http-proxy-middleware v3 (`pathFilter`), not webpack-dev-server's
  `context` - the first dev-server run proxied *every* request to Grails because of exactly this.
  Anything an app passes via `devServerOptions.proxy` needs the same translation.

## Dev server measurements

Toolbox `/app/`, inline hoist-react (the `startWithHoist` case XH developers live in), headless
Chromium attached over CDP, no Grails backend (the app boots to its first failed `/api/` call, which
is enough to exercise the full module graph). "Edit → reloaded" is wall clock from the file write
to the `load` event of the resulting page reload; "rebuild" is the server's own reported time.

| | webpack-dev-server 6 | Rsbuild dev |
|---|---|---|
| Cold start (server up + first compile served) | 32.5 s | 5.0 s |
| First page load (after compile) | 5.5 s | 2.8 s |
| Edit app model (`AppModel.ts`) | rebuild 2.8 s → full reload, 4.2 s | rebuild 0.3 s → full reload, 0.4 s |
| Edit app component (`HomeTab.ts`, `hoistCmp.factory`) | rebuild 1.7 s → full reload, 2.6 s | rebuild 0.3 s → full reload, 0.4 s |
| Edit hoist-react component (`Button.ts`, inline) | rebuild 2.0 s → full reload, 3.5 s | rebuild 0.3 s → full reload, 0.4 s |
| Edit SCSS (`Toolbox.scss`), computed style asserted, published hoist-react rather than inline | rebuild 1.1 s → hot-swapped, 1.34 s | rebuild 0.2 s → hot-swapped, 0.41 s (after the dev filename fix - see Notes) |
| Peak RSS (process tree) | 2.1 GB | 1.3 GB |

Notes:

- **Fast Refresh did not engage** for any of the three Toolbox JS/TS edits. Rsbuild's client logged
  `HMR update failed, performing full reload: Error: Aborted because <module> is not accepted` -
  the react-refresh runtime registers only modules whose exports are recognizable React
  components (PascalCase bindings, including call results such as `hoistCmp({...})`), and Hoist's
  camelCase `hoistCmp.factory(...)` element-factory exports and model classes are not. The update
  therefore bubbles to the entry and reloads the page - in 0.4 s, which is why this still reads as
  an order-of-magnitude improvement over webpack's 2.6-4.2 s live reloads. JobSite's
  `AppComponent.ts` (`export const AppComponent = hoistCmp({...})`) *did* hot-swap in place, so the
  limitation is per-module, not per-bundler. Getting hot-swapping for factory modules means
  teaching react-refresh about them (e.g. registering the underlying component from
  `hoistCmp.factory` via `$RefreshReg$`, or exporting the component alongside the factory) - worth
  a small follow-up spike, not a blocker.
- **CSS HMR was broken in the first cut, and this doc mis-reported it.** The benchmark harness only
  watched for reloads and console messages; the CSS edit produced neither, and "no reload" was
  written up as "hot-swapped". The JobSite validation asserted the computed style instead and found
  the Rsbuild page keeping stale styles indefinitely. Root cause: `output.filename.css` was
  `[name].[contenthash:8].css` in dev as well as prod. Rsbuild extracts CSS to real files in dev and
  hot-swaps by re-fetching the `<link>` the page already holds with a cache-busting query - so the
  browser re-read the *old* hashed file (still served from memory) while the rebuild landed under a
  new hash. Fix: JS/CSS filenames are hashed in production only (Rsbuild's own default). Re-verified
  by asserting a custom property from the edited SCSS in the live page: applied in 0.41 s, no
  reload. webpack (style-loader in dev, CSS rides JS HMR) was never affected.
- Both servers were launched from the dev-utils checkout's own `node_modules`; webpack with the
  `NODE_OPTIONS=--max_old_space_size=3072` Toolbox's scripts require, Rsbuild with defaults.
- The Rsbuild dev server logs an error when no browser opener is available for
  `devServerOpenPage` (`spawn xdg-open ENOENT`); harmless, but noisier than webpack-dev-server.

## Risk ledger (post-spike)

| Risk | Status |
|---|---|
| Babel↔SWC legacy decorator semantics | Moot in the default mode: Babel still transforms decorators, so semantics are identical by construction (34/34 on published 87.3). For the later `'swc'` flip, 34/34 gates were identical wherever `@persist` was not the blocker; the class-field define/set question is settled explicitly in config. |
| hoist-react module-graph fragility (#4640) | Contained, not fixed: `sideEffects: false` + `concatenateModules: false` reproduce webpack's regime. Bundle-size upside deferred until #4640 lands. |
| Fast Refresh vs element-factory modules | Per-module limitation: modules exporting `hoistCmp({...})` components hot-swap (JobSite); camelCase `hoistCmp.factory` exports and models bubble to a full reload (0.4 s). Follow-up spike to register factory-wrapped components with react-refresh. |
| Dev CSS HMR delivery | Was broken (stale hashed file re-fetched) and missed by the Toolbox harness; fixed (unhashed dev filenames) and verified by asserting computed style. |
| `public/` files altered by minimizers | Rspack's SWC / Lightning CSS minimizers processed `output.copy` assets. Fixed with `info: {minimized: true}` on the copy patterns; every copied file is now byte-identical to its source (verified on Toolbox, JobSite and a yarn v1 client app). Note webpack has never been clean here either: Terser processes every emitted `.js`, so it minifies hoist's `preflight.js` (1895 → 1020 B) and `msal-redirect-bridge.min.js` and extracts the latter's banner to a `.LICENSE.txt`; only CSS was untouched, because the webpack config has no CSS minimizer at all. The Rsbuild output is the one that honors the `copyPublicAssets` contract. |
| Package-manager layouts | pnpm (strict) is where the config was built; Toolbox and JobSite validated on it. yarn v1 (hoisted) validated on a client app: native optional deps install, the `rsbuild` bin is on the script path with no configuration, singletons dedupe. npm is untested but shares yarn's hoisting model. One yarn/npm-only wrinkle: `sass-embedded` duplicates (see the yarn v1 section). |
| Missing-export strictness | Both configs treat a missing named export as an error (`strictExportPresence` / `exportsPresence: 'error'`), but webpack still emits a bundle while Rspack emits nothing. Fail-fast, and a workflow change when working through framework drift in `inlineHoist` mode. |
| pnpm resolution parity | Improved (Blueprint stubs no longer NODE_PATH-dependent). Loaders/plugins are all resolved from within dev-utils. |
| Third-party webpack plugins on Rspack | `compression-webpack-plugin`, `webpack-bundle-analyzer`, html template all worked unchanged. `HoistManifestPlugin` runs on both. |
| SWC preset-env compat data vs Babel's | Minor drift (`es.array.includes`); pinned core-js 3.0 keeps parity. |
| Release tooling | `--env appVersion=…` must become `XH_APP_VERSION=…`; Toolbox `buildRelease.yml` / `buildSnapshot.yml` untouched in this spike (still webpack). |
| Decorators migration (#4333) interaction | **Done, in this release.** #4333 shipped as hoist-react 88, so v16 flipped `source.decorators.version` to `2023-11`, dropped `@rsbuild/plugin-babel` and the `@babel/*` deps, removed `decoratorTransform`, and raised the hoist-react floor to 88. Remaining gate: re-run the runtime parity matrix on Toolbox against `2023-11`. |

## Suggested next steps (Ship phase)

1. Publish dev-utils 16 SNAPSHOT - Rsbuild only, per the outcome note at the top; no hoist-react
   release is required.
2. Migrate Toolbox: replace `webpack.config.js` with `rsbuild.config.mjs`, switch the `start` /
   `build` scripts and CI (the README lists the steps). The fallback during soak is pinning
   dev-utils 15.x, not a second config.
3. Tune `splitChunks` (or accept the current grouping), then revisit `concatenateModules` /
   `sideEffects` together with #4640.
4. Migrate customer apps opportunistically: swap `webpack.config.js` for `rsbuild.config.mjs`, add
   `@rsbuild/core` to `publicHoistPattern` (pnpm only), rewrite release `--env` flags as `XH_*`
   variables, and fold `startWith...` script variants into a gitignored `.env.local`.
5. Update `docs/version-compatibility.md` in hoist-react. Done on hoist-react branch `rsbuild-spike`:
   a 16.0 row recording the webpack removal, the floor unchanged at 87.1, and `'swc'` mode as
   measurement-only until the TC39 migration. Merge with hoist-react's next release.
6. Validate on more client apps, not just Toolbox - the `sideEffects: false` episode showed Toolbox is
   not representative of the option surface client apps exercise (`extraModuleRules`,
   `resolveAliases`, `targetBrowsers`, release `--env` plumbing). JobSite is done (below) and
   should be re-run against the two fixes; apps using `extraModuleRules` / `resolveAliases` are the
   next most valuable targets.
7. Record a package-manager support statement in hoist-react's `docs/version-compatibility.md`
   row for dev-utils 16: pnpm recommended and primary, yarn v1 validated, npm expected to behave as
   yarn (hoisted) but untested. Migrating an app's package manager is independent of the bundler
   switch and should land as its own commit first, so that a regression is attributable.
8. Done: both configs warn on unrecognized `env` keys (`warnUnknownOptions()` in `lib/common.js`,
   against the union of both configs' options). Prompted by a client app passing
   `dupePackageCheckExcludes`, dead since the duplicate-package checker was removed in 15.x, with no
   signal from either config.
9. File the pre-existing webpack JS HMR failure JobSite exhibits
   (`self.webpackHotUpdatejobsite is not a function`, reproduced on published dev-utils 15.0.1) as
   its own issue - unrelated to this work, but it means JobSite developers have had no JS HMR under
   webpack at all.

## Client-app validation: JobSite

Run by a local agent against JobSite (2 entry points, pnpm, 6 `webpack.config.js` options, 12 SCSS
files) on an M1 Max, with sibling `../hoist-react` and `../hoist-dev-utils` checkouts on the spike
branch, *before* the two fixes above. Single runs.

| | webpack | Rsbuild |
|---|---|---|
| Production build wall clock | 42.2 s | 22.2 s |
| Production build peak RSS | 4.12 GiB | 1.60 GiB |
| JS / CSS emitted (raw) | 15.92 MB / 1.36 MB | 15.01 MB / 1.16 MB |
| Initial payload `/app/` (raw / brotli) | 13.26 / 2.06 MB | 11.77 / 1.91 MB |
| Dev cold start → first served page | 10.6 s | 4.4 s |
| Dev peak RSS at ready | 1.69 GiB (needs `--max_old_space_size=3072`) | 1.42 GiB (default heap) |
| Edit model (`AppModel.ts`) | rebuild 464 ms → full reload, 526 ms | rebuild 90 ms → full reload, 76 ms |
| Edit component (`AppComponent.ts`, `hoistCmp({...})`) | rebuild 397 ms → full reload, 464 ms | rebuild 70 ms → hot-swap, 183 ms |
| Edit SCSS (`App.scss`) | hot-swapped, verified | never reached the browser (fixed since, see above) |

Runtime parity of the production builds, served behind an nginx-equivalent static server against a
live Grails backend: identical across the login → dashboard flow, five data screens (row/column
counts, grid totals down to money and date formatting, Highcharts, FontAwesome icon counts), the
Blueprint app menu (21 stubbed icons, no full set), the markdown changelog dialog, an `@persist`
round-trip surviving reload, money masking, fonts (all woff2 byte-identical) and the admin console
with a deep link. Console output identical (17 distinct message shapes on both). Tilde SCSS imports
(`url('~@ibm/plex-sans/...')`) resolved under `@rsbuild/plugin-sass`. `manifest.json` identical
modulo hashes; `public/**` file sets identical with app files winning over hoist's.

The only migration work was the `--env` → `XH_*` rewrite: two workflow lines
(`buildRelease.yml`, `buildSnapshot.yml`), verified by building with `XH_APP_VERSION` /
`XH_APP_BUILD` and finding both baked into the vendor chunk and `manifest.json` exactly as the
webpack `--env` control run did.

Findings, all now recorded in the risk ledger: dev CSS HMR broken (fixed); `public/` files
minified (fixed); Rspack emits nothing on a missing export where webpack emits with errors (kept as
a documented difference); JobSite's webpack JS HMR is broken independently of this work.

**Re-validation at `38fa4ff` (both fixes): PASS, no regressions.** Dev filenames unhashed
(`app.js` / `app.css`; prod still `app.<hash>.js`). SCSS edits asserted via computed style: entry
chunk `App.scss` applied in 80 ms, non-entry chunk `ClientReport.scss` in 76 ms, no reload either
time; dev cold start 4.7 s. Prod build 19.6 s, 0 warnings / 0 errors; every file under
`build/public/` with a source is byte-identical to it (`error-pages.css` 676 B, `msal-redirect-bridge.min.js`
6460 B), while entry chunks remain single-line minified. Login → dashboard, a data screen with grid
totals, the Blueprint menu (21 stubbed icons) and the changelog dialog identical to webpack's build
against live Grails, console identical.

## Client-app validation: a yarn v1 client app

Run by a local agent against a private client app (4 entry points, yarn 1.22 classic, 8 `webpack.config.js`
options, 89 SCSS files, `@xh/hoist` 87.3) on an M1 Mac at `38fa4ff`, with no backend available.
Purpose: does a hoisted, non-pnpm layout adopt `configureRsbuild()` as published, and what are a
yarn app's migration steps. **Yes, with no dev-utils packaging change.** Single runs.

| | webpack | Rsbuild |
|---|---|---|
| Production build wall clock | 59.5 s | 29.1 s |
| Production build peak RSS | 5.11 GiB | 2.39 GiB |
| JS / CSS emitted (raw) | 21.61 MB / 1.58 MB | 20.60 MB / 1.35 MB |
| Initial payload `/app/` (raw / brotli) | 16.84 / 2.84 MB | 14.99 / 2.64 MB |
| Dev cold start → first served page | not run | 6.9 s, default Node heap (webpack script needs 3 GB) |
| Edit SCSS (`core.scss`), computed style asserted | not run | hot-swapped, 1.02 s, no reload |
| Edit component (`App.ts`, `hoistCmp({...})`) | not run | rebuild 0.10 s → hot-swap, no reload |
| Edit model (`AppModel.ts`) | not run | rebuild 0.13 s → full reload, 203 ms |

Install shape under yarn: the host-platform `@rspack/binding-*` and `sass-embedded-*` optional
dependencies installed with no `optional dependency skipped` or `engines` warning; the `rsbuild` bin
landed in `node_modules/.bin` with no configuration (pnpm needs `publicHoistPattern` because it
links only direct dependencies' bins); `@rsbuild/core`, `@rspack/core`, `@rspack/binding`, `react`
and `react-dom` each resolved to exactly one copy; a repeat `yarn install` left `yarn.lock`
byte-identical. Static output parity: `manifest.json` byte-identical on all four entries; every
`public/**` file byte-identical to source on the Rsbuild side (webpack's are not - see the risk
ledger); the pre-login console identical for both builds served statically (one message each,
Hoist's exception handler reporting the missing backend).

Yarn-specific findings:

- **Testing a local dev-utils checkout from a yarn app: use a tarball.** `yarn add -D file:<dir>`
  copies the whole working tree, `node_modules` included (296 MB against the published package's 42
  KB), and the nested pnpm store then *wins* resolution for dev-utils' dependencies - exactly the
  shadowing the exercise is meant to avoid. `npm pack --pack-destination <tmp>` in the checkout
  (which honors `files`) followed by `yarn add -D file:<tmp>/<tarball>.tgz` is the correct method.
- **`sass-embedded` duplicates under a hoisted layout.** dev-utils pins `~1.103.1` (for the webpack
  path's `sass-loader`); `@rsbuild/plugin-sass` declares `^1.100.0`, which yarn resolved to 1.104.1
  and nested under the plugin. Two ~10 MB native binaries, both genuinely used, builds clean. pnpm
  dedupes onto one. Resolved on the dev-utils side: `sass-embedded` is now `^1.103.1`, so both
  specs resolve to a single version at install time under any package manager.
- **One option with no translation:** the app's `startWithoutReload` script
  (`webpack-dev-server --no-live-reload`). Closed by the new `devLiveReload` option /
  `XH_DEV_LIVE_RELOAD` on both configs.
- **CI lives outside the app repo** (a shared organization workflow), so the `--env` → `XH_*`
  rewrite has to be audited there. Expect this pattern at other clients.
- Install warnings were all pre-existing (React 19 peers on `^18` libraries, yarn workspaces notice).
