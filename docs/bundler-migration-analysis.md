# Bundler Migration Analysis: Webpack → ? (August 2026)

An analysis of options for moving Hoist's centralized build tooling off Webpack, with
recommendations. Prepared against the current state of `configureWebpack.js` (dev-utils
v15.0.0-SNAPSHOT, webpack ~5.109), hoist-react v87.0.0-SNAPSHOT, and Toolbox as the reference
consumer.

## TL;DR / Recommendation

**Recommended path: Rspack (likely via its Rsbuild wrapper), not Vite — and land the TC39
modern-decorators migration first.**

1. **Sequence the TC39 modern-decorators migration deliberately** (hoist-react
   [#4333](https://github.com/xh/hoist-react/pull/4333) + dev-utils
   [#66](https://github.com/xh/hoist-dev-utils/pull/66)) — but note it is **not a blocker for the
   bundler move in either direction** (see §8a). SWC handles legacy decorators natively (its
   default mode, heavily battle-tested by the NestJS ecosystem), so Rspack works before or after
   #4333. Decorators-first validates only one transpiler×decorator combination; bundler-first
   spends far less app-facing change budget now. Either order is sound — the one hard rule is not
   to ship both in the same release window. MobX 7 (July 2026) has *removed* legacy-decorator
   support, so decorators remain a "when", not an "if".
2. **Migrate the build to Rspack**, prototyping first with **Rsbuild** (its higher-level wrapper).
   Rspack is a Rust-based, webpack-API-compatible bundler: our config model, loaders, plugins,
   dev-server/proxy setup, and — critically — our "transpile raw hoist-react TS from node_modules
   alongside the app" distribution model all carry over nearly unchanged, while SWC replaces Babel
   for a ~5–10x transpile speedup and true React HMR replaces today's full live reloads.
3. **Do not adopt Vite today; re-evaluate in ~12 months.** Vite is where the ecosystem's center of
   gravity is, but as of August 2026 it has three concrete mismatches with our architecture, the
   worst being that Vite 8's new Oxc transformer *cannot yet lower TC39 stage-3 decorators* —
   a direct collision with the decorators migration. All three gaps are being actively closed;
   Rspack config knowledge and the migration inventory below transfer if we switch later.
4. **Keep hoist-react's raw-TS source distribution for now.** It is fully compatible with the
   Rspack model (unchanged, in fact). Pre-built ESM packaging has become dramatically more
   tractable (see §7) and is worth a future spike, but it is not required for — and should not be
   coupled to — the bundler move.

Confidence: high on Rspack-over-Vite-today and on the two projects being independent; the
decorators/bundler ordering is a change-budget call, not a technical one (§8a); medium on
Rsbuild vs. raw Rspack config (a spike question); the packaging question (§7) is deliberately left
open.

---

## 1. Why we're looking, and what "better" means here

Goals, in priority order:

- **Faster local dev**: cold dev-server startup and, especially, edit-to-refresh cycles. Today
  `hot: true` only actually hot-swaps SCSS - every JS/TS edit triggers a full live reload of the
  page. Toolbox needs `NODE_OPTIONS=--max_old_space_size=3072` just to run the dev server.
- **Stay current-looking and current-in-fact** without chasing fashion.
- **Preserve the DRY, centralized model**: one `configureX()` function in dev-utils that every
  Hoist app consumes, with the same ~30 escape-hatch options.
- CI build speed is a bonus, not a driver.

### The pnpm precedent

This effort is consciously modeled on the yarn 1 → pnpm migration. There, the feared cost was
absorbing an architectural change — yarn Berry's flagship bet (PnP virtual resolution) looked
incompatible with our raw-TS source distribution, and that fear kept us on yarn 1 for years. The
actual unlock was recognizing we could take the modern, faster, security-conscious option *without*
the architecture bet: pnpm keeps a real `node_modules`, required only targeted compatibility work
(the dev-utils v14 symlink/`require.resolve` overhaul), and paid off immediately.

The bundler decision has the same shape, with the same trap and the same escape:

- **Vite is the yarn-Berry-shaped option**: the flagship modern choice whose defining architectural
  bet (unbundled ESM dev + dependency pre-bundling, HTML-as-input) is precisely the part that
  collides with our raw-TS distribution and multi-app generation model.
- **Rspack is the pnpm-shaped option**: the full modernization payoff (Rust speed, real HMR, an
  ascendant ecosystem) while preserving the existing mental model (the webpack config surface),
  requiring a port rather than a rearchitecture.

The pnpm work has also already paid a down payment on this migration: v14's realpath'd include
paths and `require.resolve()`d loaders are exactly the resolution discipline a replacement bundler
needs under pnpm's isolated layout, and that hardening carries straight over.

Counter-consideration, stated fairly: webpack 5 is not broken for us. We are on a current version
(~5.109), the config is battle-tested across every customer app, and dev-utils v14 just completed
a significant pnpm/symlink-resolution overhaul. The cost of *any* migration is re-validating that
accumulated correctness.

## 2. What we actually have (inventory of webpack-coupled behavior)

Everything a replacement must reproduce, from `configureWebpack.js`:

| Feature | Mechanism today | Portability |
|---|---|---|
| Entry discovery from `src/apps/*.{js,ts}` | Plain fs code building `entry` map | Trivial anywhere |
| Polyfills prepended to every entry | Entry arrays w/ `static/polyfills.js` | Trivial |
| App + **raw hoist-react TS** transpilation | `babel-loader` incl. `node_modules/@xh/hoist` (777 `.ts` files), plus `@xh/package-template`, plus `babelIncludePaths` | Webpack-model bundlers: same. Vite: different model (§5) |
| Legacy decorators | `@babel/plugin-proposal-decorators` `{version: 'legacy'}` + `experimentalDecorators` | SWC: native. esbuild: native. Oxc: native. Babel: native |
| FontAwesome import rewriting | `babel-plugin-transform-imports` | SWC `rspackExperiments.import` / Rsbuild `source.transformImport`; Vite needs a plugin |
| `xhAppCode` etc. — 6 bare-identifier globals | `webpack.DefinePlugin` | `rspack.DefinePlugin` identical; Vite `define` identical |
| `@xh/app-changelog.json` import | **Not** a virtual module: changelog parsed to a real file under `node_modules/.xhtmp`, then `resolve.alias` | Portable to any bundler with aliases (all of them) |
| Blueprint icon stubs (~0.5MB gzip savings) | Generated stub files + `NormalModuleReplacementPlugin` on 3 exact paths | Rspack implements NMRP; could also become 3 `resolve.alias` entries. Vite: alias or resolveId plugin |
| Per-app HTML generation | `HtmlWebpackPlugin` × N apps, custom `templateParameters` fn pulling per-entrypoint style/script tags from the compilation; EJS template reads `webpackConfig.output.publicPath` | Rspack: html-webpack-plugin compatible (template needs spike validation). Vite: inverted model — HTML is the *input* (§5) |
| Per-app `manifest.json` | Custom `HoistManifestPlugin` via `compilation.emitAsset` | Rspack supports these compilation hooks; trivial to rewrite anywhere |
| Copy hoist + app `/public` dirs | `CopyWebpackPlugin` | `CopyRspackPlugin` drop-in; Vite `publicDir` + plugin |
| SCSS pipeline (incl. 157 side-effect `.scss` imports inside hoist-react source) | sass-embedded → postcss/autoprefixer → css-loader → style-loader / MiniCssExtract | Loaders work on Rspack unchanged; Vite has built-in Sass/PostCSS |
| Markdown as raw text (+ `?url` variant) | `asset/source` + `asset/resource` w/ `resourceQuery` | Rspack: identical asset modules. Vite: `?raw` / `?url` suffixes (import-site convention differs) |
| Image inlining <10KB | `asset` + `dataUrlCondition` | Rspack identical; Vite `build.assetsInlineLimit` |
| moment locale stripping | `webpack.IgnorePlugin` | `rspack.IgnorePlugin` |
| Dev proxy to Grails + `historyApiFallback` per app + HTTPS opts | `webpack-dev-server` v6 | `@rspack/dev-server` API-compatible; Vite `server.proxy` + small middleware |
| Prod minify, mangle off, `keep_fnames` | Terser | SWC minifier has equivalent flags; Vite/Rolldown minifier ditto |
| Bundle analysis | `webpack-bundle-analyzer` | Rsdoctor (Rspack-native) or same plugin; Vite: rollup-plugin-visualizer |
| Central browser targets | Hard-coded array → preset-env + autoprefixer | Same array feeds SWC `env.targets` / browserslist everywhere |
| `inlineHoist` sibling-checkout mode | `resolve.alias` for `@xh/hoist`, `react`, `react-dom`, `ag-grid-react` + Babel include/exclude | Pure alias mechanics — portable everywhere |
| CHANGELOG parsing, changelog.json emit | Node code, bundler-agnostic | Trivial |

Two hoist-react-side facts that constrain everything:

- **hoist-react ships raw TS**: no `main`/`module`/`exports`/`types` in package.json; consumers
  deep-import against the literal file tree (96 `index.ts` barrels + direct file paths, e.g.
  `@xh/hoist/icon/Icon`). `docs/compilation-notes.md` documents this deliberately. Any bundler we
  choose must be configured to transpile this package from `node_modules`.
- **Zero webpack-proprietary constructs in hoist-react browser source.** No `require.context`, no
  `import.meta` (outside Node-side MCP tooling), no `process.env`. The only build couplings are the
  6 `declare const xh*` globals, the `@xh/app-changelog.json` aliased import, 4 image imports, and
  the side-effect `.scss` imports. This is a *clean* migration surface — years of restraint paying
  off.

## 3. The ecosystem in August 2026 (research summary)

- **Vite 8** (Mar 2026) made **Rolldown** (Rust) its single bundler for dev + prod, replacing both
  esbuild and Rollup, with **Oxc** replacing Babel for transforms. Vite 8.1 (June 2026) shipped
  experimental **Bundled Dev Mode** (~15x faster dev startup on a 10k-component benchmark; Linear
  reports 3x faster cold starts), which addresses Vite's long-standing large-app weakness — the
  unbundled-ESM request waterfall — but it is explicitly experimental and plugin compatibility is
  not guaranteed yet. Rolldown hit 1.0 (May 2026). Cloudflare acquired VoidZero (Evan You's
  company: Vite/Vitest/Rolldown/Oxc) in June 2026, resolving the sustainability question. Vite
  passed webpack in npm downloads in July 2025 and the gap is widening.
- **Rspack 2.0** (Apr 2026): Rust, webpack-API-compatible, ~2x faster than Rspack 1.0 (which was
  already ~10x+ webpack with SWC), used by ByteDance/Microsoft/Amazon/Discord, ~5M weekly
  downloads, official Next.js alternative-bundler partnership. **Rsbuild 2.0** (Apr 2026) is its
  CRA-like wrapper with batteries included. Webpack loaders (`sass-loader`, `babel-loader`) and
  major plugins (`html-webpack-plugin`, `copy-webpack-plugin`) run on it; faster Rust-native
  equivalents exist for most.
- **webpack itself**: active maintenance, but the Feb 2026 roadmap puts webpack 6 in **late 2027**,
  and its own roadmap studies Rspack for performance ideas. Tobias Koppers works on Turbopack.
  CRA was formally deprecated Feb 2025; Angular, Vue, Storybook et al. have all moved to
  esbuild/Vite-class tooling. Webpack is not falling apart — but the center of gravity has left.
- **Turbopack**: still Next.js-only. Not a candidate.
- **Decorators** (the pivotal detail):
  - **SWC** (Rspack's transpiler): supports legacy *and* stage-3 (`2022-03` and `2023-11`)
    natively. Rsbuild 2.0 defaults to `2023-11`.
  - **esbuild**: legacy since 2023, stage-3 since v0.21 (May 2024). (No `emitDecoratorMetadata`,
    which we don't use.)
  - **Oxc / Vite 8**: legacy decorators — yes; **TC39 stage-3 decorators — not yet**
    ([oxc#9170](https://github.com/oxc-project/oxc/issues/9170), no timeline; active Vite
    discussion with Babel-plugin workarounds). Since no browser ships decorators natively,
    lowering is mandatory — on Vite 8 today, stage-3 decorators mean re-adding a Babel/SWC plugin
    into the hot path.
  - **MobX 7** (July 2026) removed legacy-decorator support entirely; MobX 6 is now the legacy
    line. Modern decorators are the ecosystem's settled direction.

## 4. Option A — Stay on webpack (and tune it)

What we could do without migrating:

- **Add React Fast Refresh** (`@pmmmwh/react-refresh-webpack-plugin`): the single biggest
  dev-experience gap today (JS/TS edits = full reload) is fixable *within* webpack. Worth
  considering as a near-term quality-of-life patch regardless of the migration.
- Swap `babel-loader` → `swc-loader` inside webpack for faster transpiles (post-decorators).
- Enable webpack 5 persistent filesystem caching (we currently only cache Babel output).

Assessment: this closes maybe half the speed gap at a third of the effort, and it's all
throwaway-compatible with a later Rspack move (same config surface). But it leaves us on a bundler
whose ecosystem is visibly draining, does nothing for the "current and modern" positioning goal,
and webpack 6 is a late-2027 promise. **Reasonable as an interim patch; wrong as the destination.**

## 5. Option B — Vite

The case for: it is the de facto standard (the "modern and well-informed" optics are unmatched),
Vitest would come along naturally, the Rolldown/Oxc stack is genuinely excellent, and Cloudflare
backing removes sustainability risk. Multi-page apps, SCSS, and dev proxying are all first-class.

The case against — three concrete, current mismatches:

1. **The decorator collision.** Our stage-3 decorators migration (#4333) is queued, MobX 7
   requires it, and Vite 8's Oxc cannot lower stage-3 decorators yet. The workaround is bolting
   Babel or SWC back onto the pipeline via plugin — for *every* file of hoist-react and app source,
   i.e. precisely the hot path we're trying to speed up, and precisely the dependency we'd hope to
   shed. This is temporary (Oxc will ship it), but it's the reality today.
2. **Architecture inversion for our two core patterns.**
   - *HTML*: Vite treats real `.html` files as build inputs; we generate N per-app HTML files from
     one EJS template at build time. Replicating `src/apps/*` discovery + per-app HTML + per-app
     manifest + per-app history fallback means writing a nontrivial custom Vite plugin (virtual
     HTML entries) rather than configuring a stock one.
   - *Raw-TS framework dependency*: Vite's dev model wants node_modules pre-bundled
     (`optimizeDeps`). A raw-TS `@xh/hoist` either gets pre-bundled (works, but then framework-file
     edits in `inlineHoist` mode need dep-cache invalidation care) or excluded and served as
     unbundled source — adding ~800 modules to the dev request waterfall, the exact known weak spot
     for large apps. Bundled Dev Mode fixes this class of problem but is experimental (Phase 1 of 4
     shipped as of 8.1).
3. **Dev/prod consistency caveats during the transition.** Vite 8 unified on one bundler, which
   helps, but until Bundled Dev Mode is default we'd run unbundled dev vs. bundled prod — a
   consistency regression vs. webpack (and Rspack), which bundle identically in both modes. Our
   Blueprint icon stubs, `sideEffects: false` behavior, and chunking assumptions would all need
   re-verification under two serving models instead of one.

Assessment: **right destination-shaped tool, wrong timing for this specific architecture.** In
~12 months, with Oxc decorators shipped, Bundled Dev Mode stable, and our decorators migration
long-landed, most of this table flips. Re-evaluate then — nothing in the Rspack path below forecloses
it.

## 6. Option C — Rspack / Rsbuild (recommended)

Why it fits us unusually well:

- **It is a webpack-API reimplementation in Rust.** `configureWebpack()`'s output — entry maps,
  `module.rules`, `oneOf`, asset modules, `resolve.alias`, DefinePlugin/IgnorePlugin, dev-server
  config incl. proxy and `historyApiFallback` — is largely valid Rspack config as-is. Our migration
  is a port, not a rewrite; 15+ years of collective webpack intuition at XH stays useful.
- **The raw-TS distribution model carries over unchanged**: point the `builtin:swc-loader` rule's
  `include` at `srcPath`, `hoistPath`, and `babelIncludePaths`, exactly like today's babel-loader
  rule. No `optimizeDeps` negotiation, no request waterfall, dev and prod bundle identically.
  `inlineHoist` remains pure alias mechanics.
- **Decorators are a non-issue in both directions.** SWC handles legacy today and `2023-11`
  stage-3 after #4333 lands — the bundler migration and the decorators migration are fully
  decoupled (though sequencing decorators first means we only validate one transpiler+decorator
  combination instead of two).
- **The speed win is where we need it.** SWC replaces Babel for the ~800-file hoist-react +
  app-source transpile on every cold start and rebuild (typical reports: 5–10x on transpile-bound
  builds; Rspack markets ~10x+ vs. webpack overall). React Fast Refresh is built in
  (`@rspack/plugin-react-refresh` / automatic in Rsbuild), replacing today's full-page live
  reloads with sub-second hot updates. Rust-side memory behavior should also relieve the 3GB
  Node-heap requirement.
- **Credibly modern.** Rust core, 2.0 in April 2026, ByteDance/Microsoft/Amazon/Discord in
  production, an official Next.js partnership, ~5M weekly downloads and climbing. This is not a
  legacy-compatibility hedge; it's one of the two winners of the post-webpack era.

Honest risks and open questions:

- **Ecosystem #2, not #1.** Vite has the mindshare crown. Mitigation: the Rspack↔webpack↔Vite
  config concepts overlap heavily, and this analysis + the ported config double as the work plan
  for a later Vite move if the calculus changes.
- **Single-vendor stewardship (ByteDance web-infra team).** Comparable in kind to Vite's
  Cloudflare/VoidZero situation; the Next.js partnership and MIT license mitigate.
- **Supply-chain history.** In December 2024, `@rspack/core`/`@rspack/cli` 1.1.7 were published
  with an XMRig cryptominer via a stolen npm token, delivered through a `postinstall` script;
  the project unpublished and shipped a clean 1.1.8 the same day and rotated credentials. Two
  mitigations already in place on our side: pnpm's default build-script blocking (our explicit
  `onlyBuiltDependencies` allowlists) neutralizes exactly this postinstall vector, and our `~`
  version ranges + lockfile discipline limit exposure windows. Not disqualifying — this attack
  class has hit much of npm — but worth naming.
- **Plugin-compat edges need a spike**, specifically: our `HtmlWebpackPlugin`
  `templateParameters`-function + EJS template (may be cleaner to move to Rspack's native
  `HtmlRspackPlugin` or generate tags ourselves), `NormalModuleReplacementPlugin` for Blueprint
  stubs (supported, but plain `resolve.alias` on the three exact file paths may be simpler),
  `webpackbar` (cosmetic; Rspack has its own progress), and SWC-minifier parity for our
  `mangle: false` / `keep_fnames` Terser stance.
- **Fast Refresh vs. Hoist idioms.** Fast Refresh preserves state only for modules exporting
  React components; Hoist's `hoistCmp.factory` element-factory exports and model classes may fall
  back to full reloads for those modules. Even the fallback (fast incremental rebuild + reload)
  is a large improvement over today, but the spike should measure real-world behavior in Toolbox.
- **FontAwesome import rewriting** moves from `babel-plugin-transform-imports` to
  `rspackExperiments.import` / Rsbuild `source.transformImport` (same babel-plugin-import
  semantics). Keeping babel-loader in the chain remains available as a fallback, at a speed cost.

**Rsbuild vs. raw Rspack config**: Rsbuild is the higher-level wrapper (think: what CRA should
have become) — React plugin, Sass, dev server, transformImport, decorator version, MPA/multi-entry
with per-entry HTML all as declarative config. A `configureRsbuild()` could plausibly be *much*
smaller than today's 1,000 lines, which serves the DRY/standardization goal directly. Risk: another
abstraction layer to fight when we need webpack-grade escape hatches (Rsbuild does expose raw
Rspack config via `tools.rspack`). Recommendation: **spike Rsbuild first**; drop to raw Rspack
only if its conventions fight the multi-app model.

## 7. In-scope side question: revisit hoist-react's raw-TS packaging?

Short answer: **not now, and not as part of this migration — but the historic blockers have eroded
and a future spike is warranted.**

- The two original rationales still hold: we control the one blessed pipeline, and Hoist apps use
  a large fraction of the library surface (limiting tree-shaking upside — note we already run with
  `sideEffects: false` semantics disabled in webpack because of inconsistent results).
- The historic fear — hand-authoring exports maps and rewriting deep imports across every app in
  the ecosystem — has genuinely shrunk. Modern library bundlers (**tsdown**, from the Rolldown
  team, is the 2026 standard; successor to tsup) handle multi-entry builds natively, and our 96
  existing `index.ts` barrels *are* the entry-point map — an `exports` field covering
  `@xh/hoist/*` subpaths can be generated mechanically, and existing deep imports would keep
  working unchanged. No ecosystem-wide import rewrite is required anymore.
- What pre-building would buy: faster cold starts for consuming apps (skip transpiling ~800 files),
  independence from any particular consumer-side bundler (apps could use stock Vite/Rspack/whatever
  with near-zero Hoist-specific config), and removal of the "apps must transpile node_modules"
  oddity that makes tooling assume things about us. What it costs: hoist-react grows a real build
  step + CI packaging complexity, `inlineHoist` needs a watch-mode story, and source-level
  debuggability in node_modules (a real, stated benefit) is traded for sourcemaps.
- Sequencing matters: the decorators migration (removing our dependence on exotic shared Babel
  config) is itself the biggest enabler of pre-built distribution. After #4333 and the Rspack move
  settle, a tsdown packaging spike becomes a well-contained experiment rather than a delicate
  ecosystem-wide change.

## 8. Proposed sequencing

### 8a. Decorators before or after? A change-budget call, not a technical dependency

The bundler move does **not** require the decorators migration in either direction. SWC's legacy
mode (`decoratorVersion: 'legacy'`, its default) exists precisely for TS `experimentalDecorators`
compatibility and is exercised at enormous scale (the NestJS ecosystem runs on it) — arguably
better-trodden today than SWC's `2023-11` mode. The honest ledger for each order:

**Decorators-first** (the ordering below): validates only one transpiler×decorator combination
(SWC×TC39); #4333/#66 ship as planned with no rework. Cost: spends a large app-facing breaking
change — a codemod touching every model class in every app codebase — before delivering any speed
payoff, on top of whatever change budget v87 has already consumed.

**Bundler-first**: delivers the multiple-x dev-speed win while touching **zero app source** — the
swap is a dev-utils major plus replacing each app's `webpack.config.js` with an equivalent config
and updating npm scripts. The two projects largely spend from different budgets (tooling vs.
app code). Costs and risks:

- **Decorator behavior gets validated twice** (Babel-legacy→SWC-legacy now, SWC-legacy→SWC-TC39
  later). Mitigation: #4333's Phase 0 spike runner and its 22 runtime gates are reusable as-is for
  the SWC-legacy parity check.
- **One real technical gate for the spike**: Babel↔SWC semantic parity for legacy decorators
  interacting with class-field semantics (define-vs-set; tsconfig declares
  `useDefineForClassFields: true` but Babel performs the emit today). SWC exposes equivalent
  knobs — set them explicitly and prove `@bindable`/`@managed`/`@computed`/`@persist` behavior
  via the spike gates, don't assume.
- **PR shelf-life**: #4333 is codemod-generated, so regenerating against a moved target is cheap.
  Dev-utils #66 (the Babel decorator flip) is largely superseded if Rspack lands first — the
  eventual decorators flip becomes a one-line SWC config change in the new config function.

Two rules that hold under either order: **never ship both changes in the same release window**
(two transpiler-level variables at once makes app-side regressions unattributable — sequence as
separate dev-utils majors with soak time between), and **don't let decorators drift indefinitely**
(MobX 6 is now the legacy maintenance line; MobX 7 requires modern decorators and claims ~30%
lower observable overhead, and deleting `makeObservable(this)` boilerplate is a real ergonomics
win — a soft deadline, but a deadline).

### 8b. Steps (decorators-first shown; swap 1 and 2 for bundler-first)

1. **Now**: Land #4333 + dev-utils #66 (modern decorators, coordinated release — already planned).
   Optionally cherry-pick the cheap webpack win (React Fast Refresh plugin) into a dev-utils minor
   for immediate relief.
2. **Next**: Spike `configureRsbuild()` (fallback: raw Rspack) in dev-utils against Toolbox:
   all 10 entry points, `inlineHoist`, Blueprint stubs, changelog import, per-app HTML/manifests,
   proxy, prod-build output diff vs. webpack, and measured cold-start / rebuild / HMR timings.
   Target: a go/no-go with real numbers in ~1–2 weeks of effort.
3. **Then**: Ship as a new dev-utils major exporting both `configureWebpack` (frozen, maintenance)
   and the new function; migrate Toolbox, then customer apps opportunistically. The env-options
   surface should stay recognizably the same (~30 options, most portable 1:1).
4. **~Mid-2027**: Re-evaluate Vite once Oxc ships stage-3 decorator lowering and Bundled Dev Mode
   stabilizes. Adopt only if it then offers something Rspack doesn't — otherwise Rspack is a
   perfectly current place to simply stay.

## Appendix: key sources

- Vite 8 announcement (Rolldown default, Oxc transforms), 2026-03-12 — vite.dev/blog/announcing-vite8
- Vite 8.1 (experimental Bundled Dev Mode; Linear numbers), 2026-06-23 — vite.dev/blog/announcing-vite8-1
- Rolldown 1.0, 2026-05-07 — voidzero.dev/posts/announcing-rolldown-1-0
- Cloudflare acquires VoidZero, 2026-06-04 — cloudflare.com press release
- Oxc stage-3 decorators gap — github.com/oxc-project/oxc/issues/9170; vitejs/vite discussion #21891
- Rspack 2.0, ~2026-04 — rspack.dev/blog/announcing-2-0; Rsbuild 2.0, 2026-04-22 — rsbuild.rs/blog/v2-0
- Rspack webpack-migration + plugin/loader compatibility — rspack.rs/guide/migration/webpack
- Rsbuild decorators default `2023-11` — rsbuild.rs/config/source/decorators
- esbuild decorators: legacy v0.18 (2023-06), stage-3 v0.21 (2024-05) — esbuild release notes
- MobX 7 removes legacy decorators (7.0.3 published 2026-08-19) — mobx.js.org/enabling-decorators
- webpack 2026 roadmap (webpack 6 targeted late 2027), 2026-02-04 — webpack.js.org/blog
- CRA deprecation, 2025-02-14 — react.dev/blog/2025/02/14/sunsetting-create-react-app
- npm trends: Vite passed webpack July 2025 — npmtrends.com/vite-vs-webpack
- Rspack 1.1.7 supply-chain incident (2024-12-20, fixed same day in 1.1.8) —
  bleepingcomputer.com, thehackernews.com, socket.dev coverage
- Local facts: `configureWebpack.js` (dev-utils), `docs/compilation-notes.md` (hoist-react),
  hoist-react/toolbox `package.json` + `tsconfig.json` as of this branch date.
