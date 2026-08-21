# configureWebpack Audit: What Earns Its Place (August 2026)

A pre-migration sweep of everything in `configureWebpack.js` (and its supporting deps), binned by
whether it still has a clear reason to exist - so nothing gets carried to Rspack cargo-cult style.
Companion to [bundler-migration-analysis.md](./bundler-migration-analysis.md).

Context that moved under this config since it was written: target browsers are now
last-2-evergreen only (ES2022+ native everywhere), webpack 5 asset modules replaced the loader
zoo, hoist-react finished its TypeScript migration (zero `.jsx` files anywhere in the ecosystem),
and hoist-react now declares its own runtime deps (`sass-material-colors`, `@types/*`) rather than
relying on hoisting from this package.

Legend: 🟢 clearly current, required · 🟡 look closely - may be reducible, conditional, or
simplifiable · 🔴 obsolete / legacy noise - drop or fix, don't port.

## 1. JS/TS transpilation (the babel-loader rule)

| Item | Bin | Notes |
|---|---|---|
| `@babel/preset-react` / JSX support generally | 🟢 | JSX stays a standard, always-on capability of the stack - some clients insist on it, and `.tsx`/`.jsx` handling is free in every candidate toolchain (SWC/Babel alike). Three separable tiers: JSX in `.tsx` (🟢 standard, e.g. Toolbox `AppComponent.tsx`), `.jsx` files (🟢 keep - default extension handling everywhere), JSX in plain `.js` (🟡 the nonstandard tier - see isTSX row; opt-in). Optional modernization: `runtime: 'automatic'` (jsx-runtime) instead of classic `createElement`. |
| `@babel/plugin-proposal-decorators` (legacy) | 🟢 | Required until #4333 lands; then flips version. The bundler-spike equivalent is SWC `decoratorVersion`. |
| `babel-plugin-transform-imports` (5 FontAwesome pkgs) | 🟢 | Real, large win while `sideEffects` pruning is disabled (see §4). Maps to SWC/Rsbuild `transformImport`. Could become unnecessary if tree-shaking is fixed - retest then. |
| Forced `include`: `transform-class-properties`, `private-methods`, `private-property-in-object` | 🟢→🔴 | Required *interop* while legacy decorators are used (Babel must compile class elements it decorates). Obsolete the day #4333 lands - do not port past that point. |
| Forced `include`: `nullish-coalescing`, `optional-chaining` | 🔴 | 2020-era guards against downstream parsers choking on `?.`/`??`. Native in every target for years; Terser parses them fine. Transpiling them today is pure wasted work and output bloat. |
| `@babel/preset-env` as a *syntax transpiler* | 🟡 | With last-2-evergreen targets it transpiles almost nothing. Its remaining jobs are (a) the polyfill entry rewrite and (b) hosting the forced includes above. Once both go, preset-env itself may have no job. `bugfixes: true` is default since Babel 8-era anyway. |
| Polyfill layer: `useBuiltIns: 'entry'` + `corejs: {version 3, proposals: true}` + prepending hoist's `static/polyfills.js` to every entry + app-level `core-js` dep | 🟡 - with history | For last-2-evergreen targets the entry rewrite emits a near-empty residue, and `proposals: true` ships proposal polyfills to evergreen browsers. **But this was already tried and walked back**: hoist-react #4334 (2026-04-17) removed core-js as part of a dep shed; #4339 restored it *the same day* after review caught that (a) the removal was made in hoist-react alone while the entry-prepend and `useBuiltIns` machinery live here in dev-utils, and (b) some clients' secure mobile browsers (ancient-webkit webviews, e.g. Blackberry Access) are exactly what the layer insures against - the default targets are evergreen, but the client matrix is not uniformly so. **Action: confirm the legacy-webview story across client apps first; then either remove as a coordinated hoist-react + dev-utils change, or keep the layer available per-app via `targetBrowsers`/`babelPresetEnvOptions` overrides while removing it from the default path.** The preset-env `debug: true` audit of actual emitted polyfills is still the right first step. |
| Stale comment: "core-js and regenerator-runtime both imported... in its polyfills.js" | 🔴 | `polyfills.js` is now a single `import 'core-js'`. regenerator-runtime is long gone (async/generators are native in targets; nothing transpiles them). Doc rot. |
| `@babel/preset-typescript` **and** explicit `@babel/plugin-transform-typescript` (`isTSX: true`, `allowDeclareFields`) | 🟡 | Duplication - the preset wraps the same plugin. Note JSX support *per se* is not in question - clients use it, and it stays standard (see JSX row below). The nonstandard part this arrangement enables is JSX inside plain `.js` files; make that an opt-in flag in the successor config rather than default-on, and collapse to one preset/parser config otherwise. |
| `cacheDirectory` / `cacheCompression: false` | 🟢 | Correct for webpack today; moot after SWC. |

## 2. Module rules (non-JS)

| Item | Bin | Notes |
|---|---|---|
| `.mjs` → `javascript/auto` (stylis/emotion fix) | 🟡 | Workaround for a 2020-era stylis packaging bug via react-select → emotion. react-select is still in the graph, but emotion/stylis have shipped proper `exports` maps for years. Test-remove now; do not port untested. |
| Image `asset` rule, 10KB inline threshold | 🟢 | Fine. Threshold is arbitrary but harmless. |
| Markdown `asset/source` + `?url` variant | 🟢 | Product feature (Hoist `markdown` component). Port (Rspack: identical; Vite: `?raw`). |
| Catch-all `asset/resource` with exclude list copied from CRA ("commented there, but didn't understand") | 🟡 | Works, but this is the literal definition of cargo cult - the config says so itself. Rewrite consciously at migration (a plain "everything else is a hashed asset" rule). |
| `resolve.extensions` including `'*'` | 🔴 | Webpack-4-ism. In webpack 5, imports with explicit extensions always work; `'*'` does nothing. |
| `resolve.extensions` including `.jsx` | 🟢 | Keep - JSX is a supported first-class style for client apps (even though XH's own code has zero `.jsx` files), and `.jsx` is in every bundler's default extension set anyway. Only the JSX-in-`.js` tier moves to opt-in (isTSX row above). |
| `strictExportPresence` | 🟢 | Good guard (it's what makes Blueprint icon-stub misses fail loudly). Note: deprecated spelling - modern form is `module.parser.javascript.exportsPresence: 'error'`. |

## 3. CSS pipeline

| Item | Bin | Notes |
|---|---|---|
| sass-embedded + sass-loader | 🟢 | 149 SCSS files in hoist-react alone. Core requirement. |
| postcss-loader + autoprefixer | 🟡 | For last-2-evergreen targets, autoprefixer emits close to nothing in 2026. **Action: diff a build with the postcss stage removed** - if output CSS is byte-identical or trivially different, drop the stage (two fewer deps, one less loader hop). |
| autoprefixer `flexbox: 'no-2009'` | 🔴 | Guards against emitting 2009-spec flexbox syntax for ancient mobile WebKit. A fossil either way - if autoprefixer stays, this option is a no-op for our targets. |
| css-loader (`importLoaders: 2`, `esModule: false`) | 🟢/🟡 | Required while the chain exists. `esModule: false` (also on style-loader) is legacy CommonJS-interop - revisit at migration rather than porting reflexively. |
| style-loader (dev) / MiniCssExtractPlugin (prod) | 🟢 | Standard split. |
| Tilde imports *inside hoist-react SCSS* (3: `~sass-material-colors`, `~inter-ui`, `~@blueprintjs/core/src/...`) | 🔴 | `~` is a webpack/sass-loader convention, deprecated for years and unsupported elsewhere (breaks under Vite). Modern sass-loader resolves the same bare module paths without the tilde. Cheap hoist-react fix; do it before the spike so the spike doesn't need tilde shims. |

## 4. Optimization / output

| Item | Bin | Notes |
|---|---|---|
| `optimization.sideEffects: false` (tree-shaking disabled, "inconsistent results... imports dropped seemingly at random") | 🟡 **root-cause found** | The likely culprit for those historical inconsistencies is hoist-react's own metadata: its `sideEffects: ["./static/polyfills.js"]` declares the 157 modules that side-effect-import `.scss` as *pure* - so pruning could legitimately drop styles "at random". **Action: fix hoist-react's declaration (add `"**/*.scss"` and audit other side-effect modules), then trial re-enabling pruning in the spike.** Payoff: smaller bundles and possibly retiring the Blueprint stub machinery and FA import-rewriting. |
| Blueprint icon stubs + `NormalModuleReplacementPlugin` | 🟢 today / 🟡 mechanism | Real ~0.5MB-gzip win, just repaired (v14.0.1). But it exists *because* `sideEffects` pruning is off (Blueprint marks itself side-effect-free). If §above lands, this whole apparatus may retire; otherwise port as 3 plain `resolve.alias` entries - simpler than NMRP. |
| Terser `mangle: false` | 🟡 | Meaningful bundle-size cost. Rationale ("intermittent issues... especially on already-packaged libraries") dates back years; modern minifiers mangle safely and the library mix has changed. Trial re-enabling (keep `keep_classnames`/`keep_fnames` if error-message readability is the concern). |
| Terser `compress: {comparisons: false, collapse_vars: false}` | 🔴 | CRA-2018 and FontAwesome-2018 workarounds respectively, for bugs in tools we no longer run in versions long gone. Do not port. |
| `chunkIds/moduleIds: 'named'` | 🟡 | Great for debugging; in prod it embeds readable module paths and costs bytes (compounded by mangle-off). Consider named-in-dev / numeric-in-prod. |
| `removeAvailableModules: false` | 🟢 | Harmless perf tweak; moot after migration. |
| `splitChunks: {chunks: 'all'}`, hashed filenames, `output.clean` | 🟢 | Standard, correct. |

## 5. Plugins & dev server

| Item | Bin | Notes |
|---|---|---|
| DefinePlugin: 6 `xh*` globals, `NODE_ENV`, `'process.env': '{}'` fallback | 🟢 | Core contract with hoist-react (`declare const` sites in `XH.ts`/`HoistBase.ts`); the process.env fallback is recent and load-bearing (react-draggable). |
| `reactProdMode` / `REACT_NODE_ENV` knob + the matching `ignoreWarnings` entry | 🟡 | Niche tool for testing prod-React behavior in dev. Keep or drop consciously; if dropped, the ignoreWarnings entry goes with it. |
| IgnorePlugin (moment locales) | 🟢 | Required while moment is in the graph. Separate flag: moment itself is a frozen project - a future dayjs/Temporal move would retire this row, but that's app-facing work, not build config. |
| CopyWebpackPlugin (hoist + app `/public`) | 🟢 | Product feature (preflight.js, favicons, static assets). |
| HtmlWebpackPlugin × N apps + custom `templateParameters` + EJS template | 🟢 feature / 🟡 implementation | The per-app HTML generation is core. The custom per-entrypoint tag collection (reaching into `compilation.entrypoints`) predates webpack 5's solid `chunks: [entryName]` handling - the stock option may now do the same job. Simplify at migration rather than porting the custom code. |
| HoistManifestPlugin (per-app manifest.json) | 🟢 | Product feature (home-screen/PWA install). Trivial to port. |
| CaseSensitivePathsPlugin | 🟡 | Dev-QoL guard for macOS case-insensitivity; costs some fs overhead per rebuild, and Linux CI catches the same bugs at PR time. Keep or drop consciously (Rspack: check for a native equivalent before porting a plugin). |
| WebpackBar, BundleAnalyzer (opt-in) | 🟢 | Cosmetic / diagnostic. Rspack equivalents: built-in progress, Rsdoctor. |
| devServer: proxy, per-app historyApiFallback, HTTPS opts, overlay, open | 🟢 | All product features, all portable. |
| `hot: true` (SCSS-only HMR; JS/TS = full live reload) | 🟡 | The motivating pain. Either bolt on React Fast Refresh now (webpack minor) or let the migration deliver it. |
| Changelog parse → `node_modules/.xhtmp` file + alias | 🟢 | Product feature; already bundler-agnostic (real file + alias). |
| `inlineHoist` aliasing (`@xh/hoist`, react, react-dom, ag-grid-react) | 🟢 | Core dev workflow; pure alias mechanics. |
| Blueprint-stub/`.xhtmp`/realpath/`require.resolve` pnpm-resolution work (v14) | 🟢 | Recent, deliberate, carries straight into any successor. |

## 6. Package-level (dev-utils dependencies)

| Item | Bin | Notes |
|---|---|---|
| webpack, webpack-cli, webpack-dev-server, loaders, HtmlWebpackPlugin, etc. | 🟢 | The platform itself (until replaced). |
| `sass-material-colors` | 🔴 | Vestigial. Consumed only by hoist-react's `styles/vars.scss`, and hoist-react now declares its own copy (v87 package.json); resolution happens from hoist-react under both flat and pnpm layouts. Only risk: a flat-layout app importing it directly in its own SCSS without declaring it - a breaking-changes note covers that. |
| `@types/react`, `@types/react-dom`, `@types/lodash`, `type-fest` | 🟡 | Transitional hoisting shims for flat-layout (yarn/npm) apps; hoist-react now declares all of these itself, and pnpm apps must too (per v14 notes). Plan removal when flat-layout support sunsets; pointless to carry into a new-config major aimed at the pnpm era. |
| `@xh/eslint-config` | 🟡 | Deliberate "shared dev dependency" distribution channel, but it functions under pnpm only via pnpm's default `public-hoist-pattern` for `*eslint*` - an accident, not a design. Prefer apps declaring it directly; decide before the new major. |
| `lodash`, `changelog-parser` | 🟢 | Used directly by the config itself. |
| `engines.node >= 22.15` | 🟢 | Current. |

## 7. Suggested pre-spike cleanup (cheap, de-risks the port)

Each of these shrinks the surface the spike must reproduce, and is independently shippable:

1. **hoist-react**: fix the `sideEffects` declaration (add SCSS side-effect coverage); drop the 3
   tilde SCSS imports. Both are small PRs with no app-facing impact.
2. **dev-utils (webpack, minor/patch)**: delete the two 🔴 forced Babel includes, the stale
   regenerator comment, `'*'` from resolve.extensions, and the two 🔴 Terser compress options.
   Run the preset-env `debug: true` polyfill audit; treat actual polyfill-layer removal as its own
   gated, coordinated two-repo change per the history noted in §1 (hoist-react #4334/#4339) - not
   a casual line item.
3. **Experiments to run on webpack before porting** (so results transfer as requirements, not
   guesses): remove the `.mjs` rule; remove the postcss stage and diff CSS output; trial
   `sideEffects` pruning with fixed metadata; trial mangling on.

Result: the config that actually gets ported is materially smaller than today's, and every line of
it has a re-verified reason to exist.
