# Rsbuild / Rspack Migration Spike (September 2026)

Results of the Phase 2 spike tracked in [#73](https://github.com/xh/hoist-dev-utils/issues/73):
a `configureRsbuild()` counterpart to `configureWebpack()`, validated against Toolbox. Background
and the option analysis that led here: [bundler-migration-analysis.md](./bundler-migration-analysis.md).

Everything below was measured on one 4-core / 15 GB Linux container, Node 22.22, against Toolbox
`11.0-SNAPSHOT` (10 entry points), hoist-dev-utils `16.0.0-SNAPSHOT` (webpack 5.110 / Babel 7.29;
Rsbuild 2.2.5 / Rspack 2.2.3), hoist-react 87.3.0 unless stated. Numbers are single runs on a shared
box - treat ratios as the signal, not the third digit.

## Recommendation: GO

Port confirmed. `configureRsbuild()` builds all ten Toolbox apps with the same feature set from the
same options, the three main apps boot to the same point as the webpack build, 34 of 34 runtime
parity gates pass **against the published hoist-react 87.3.0 with no framework change**, and the
payoff is large. Two Rsbuild columns: the shipping default lowers Hoist's legacy decorators with
Babel ahead of SWC (`decoratorTransform: 'babel'`, see Finding 1); the SWC-only column is what the
same config yields once hoist-react's decorators no longer depend on Babel's emit.

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

One expectation from the analysis did *not* materialize yet: React Fast Refresh never engaged for
Toolbox edits - every JS/TS change fell back to a full reload. The fallback is a 0.4 s
edit-to-reloaded cycle, so the dev-experience win is delivered regardless, but true hot-swapping of
Hoist components is a follow-up (see Dev server measurements).

The decorators migration (hoist-react #4333) is **not** a prerequisite: with Babel still lowering
decorators, Rspack-first touches neither app source nor hoist-react. The TC39 flip later is two
lines here (`source.decorators.version` and the `decoratorTransform` default), shipping in its own
release window - and it is what unlocks the right-hand column above.

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
| Raw-TS transpilation of `@xh/hoist` + `@xh/package-template` (pnpm parity) | ✅ | `source.include` of realpath'd `srcPath`, `hoistPath`, `babelIncludePaths`; SWC via `builtin:swc-loader`. Rsbuild also compiles every `.ts/.tsx` it meets by default, so this is belt-and-braces. |
| `inlineHoist` alias mechanics | ✅ | Same aliases (`@xh/hoist`, `react`, `react-dom`, `ag-grid-react`), `resolve.aliasStrategy: 'prefer-alias'` so they beat any tsconfig `paths`. Validated: dev-mode inline build boots; 34/34 gates. |
| Decorator parity gates, legacy mode; class-field semantics set explicitly | ✅ | 34 runtime gates, both bundlers, published 87.3 production and inline dev/prod - see below. Default mode reuses Babel's decorator lowering outright. For `'swc'` mode, `useDefineForClassFields: true` and `decoratorMetadata: false` are asserted in `tools.swc` (Rsbuild's legacy preset flips define-semantics *off*, which would diverge from tsconfig and Babel). |
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
   available behind a hoist-react >= 88 floor for the post-TC39 world.
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
- **Bundle analysis** still uses `webpack-bundle-analyzer` (works on Rspack); Rsdoctor is the native
  alternative worth trying later.
- **Decorator metadata**: Rsbuild's legacy preset turns on `emitDecoratorMetadata`-style output;
  explicitly disabled (Hoist uses none, and it bloats every decorated class).
- **`--env` flags** → `XH_*` environment variables / `--env-mode`. Release workflows will need the
  `appVersion` / `appBuild` overrides rewritten accordingly.
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
| Edit SCSS (`Toolbox.scss`) | rebuild 2.2 s, no reload observed (CSS hot-swapped) | rebuild 0.3 s, no reload observed (CSS hot-swapped) |
| Peak RSS (process tree) | 2.1 GB | 1.3 GB |

Notes:

- **Fast Refresh did not engage** for any of the three JS/TS edits. Rsbuild's client logged
  `HMR update failed, performing full reload: Error: Aborted because <module> is not accepted` -
  the react-refresh runtime registers only modules whose exports are recognizable React
  components, and Hoist's `hoistCmp.factory(...)` element-factory exports (functions returning
  elements, not components) and model classes are not. The update therefore bubbles to the entry
  and reloads the page - in 0.4 s, which is why this still reads as an order-of-magnitude
  improvement over webpack's 2.6-4.2 s live reloads. Getting genuine hot-swapping for Hoist
  components means teaching react-refresh about factory exports (e.g. registering the underlying
  component from `hoistCmp.factory` via `$RefreshReg$`, or exporting the component alongside the
  factory) - worth a small follow-up spike, not a blocker.
- The CSS edits produced no console signal in either bundler, so the harness could not time the
  swap; both servers rebuilt and neither reloaded the page, consistent with style hot-swapping.
- Both servers were launched from the dev-utils checkout's own `node_modules`; webpack with the
  `NODE_OPTIONS=--max_old_space_size=3072` Toolbox's scripts require, Rsbuild with defaults.
- The Rsbuild dev server logs an error when no browser opener is available for
  `devServerOpenPage` (`spawn xdg-open ENOENT`); harmless, but noisier than webpack-dev-server.

## Risk ledger (post-spike)

| Risk | Status |
|---|---|
| Babel↔SWC legacy decorator semantics | Moot in the default mode: Babel still lowers decorators, so semantics are identical by construction (34/34 on published 87.3). For the later `'swc'` flip, 34/34 gates were identical wherever `@persist` was not the blocker; the class-field define/set question is settled explicitly in config. |
| hoist-react module-graph fragility (#4640) | Contained, not fixed: `sideEffects: false` + `concatenateModules: false` reproduce webpack's regime. Bundle-size upside deferred until #4640 lands. |
| Fast Refresh vs element-factory modules | Confirmed limitation: updates bubble to a full reload (0.4 s). Follow-up spike to register factory-wrapped components with react-refresh. |
| pnpm resolution parity | Improved (Blueprint stubs no longer NODE_PATH-dependent). Loaders/plugins are all resolved from within dev-utils. |
| Third-party webpack plugins on Rspack | `compression-webpack-plugin`, `webpack-bundle-analyzer`, html template all worked unchanged. `HoistManifestPlugin` runs on both. |
| SWC preset-env compat data vs Babel's | Minor drift (`es.array.includes`); pinned core-js 3.0 keeps parity. |
| Release tooling | `--env appVersion=…` must become `XH_APP_VERSION=…`; Toolbox `buildRelease.yml` / `buildSnapshot.yml` untouched in this spike (still webpack). |
| Decorators migration (#4333) interaction | Independent. After it lands: flip `source.decorators.version` to `2023-11`, default `decoratorTransform` to `'swc'`, drop `@rsbuild/plugin-babel` - and re-run the gate matrix in `2023-11` mode under both transpilers first (the TC39 branch already carries one Babel-specific workaround in `@managed`). Separate release window, per the analysis. |

## Suggested next steps (Ship phase)

1. Publish dev-utils 16 SNAPSHOT with both configs; no hoist-react release is required.
2. Switch Toolbox's default `start` / `build` scripts and CI to Rsbuild once a week or two of
   `startWithHoist:rsbuild` soak is clean; keep `webpack.config.js` through the transition.
3. Tune `splitChunks` (or accept the current grouping), then revisit `concatenateModules` /
   `sideEffects` together with #4640.
4. Migrate customer apps opportunistically: swap `webpack.config.js` for `rsbuild.config.mjs`, add
   `@rsbuild/core` to `publicHoistPattern`, rewrite release `--env` flags as `XH_*` variables.
5. Update `docs/version-compatibility.md` in hoist-react (done for the 16.0 row; floor unchanged at 87.1).
6. Validate on client apps, not just Toolbox - the `sideEffects: false` episode showed Toolbox is not
   representative of the option surface client apps exercise (`extraModuleRules`, `resolveAliases`,
   `targetBrowsers`, release `--env` plumbing).
