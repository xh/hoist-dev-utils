# 🛠️ Hoist Dev Utils

Tooling for building and deploying web applications built on the Hoist React platform. This
repository is made available as the `@xh/hoist-dev-utils`
[package on npm](https://www.npmjs.com/package/@xh/hoist-dev-utils) for import and use by
applications.

## Shared development dependencies

The package.json file in this repository specifies a set of development dependencies required for
building Hoist React applications. Those applications can specify `@xh/hoist-dev-utils` as a dev
dependency and transitively bring in [Rsbuild](https://rsbuild.rs) (Rspack + SWC) and the plugins
used in app builds, including the Rsbuild dev server and Sass. SWC transpiles Hoist's TC39
(`2023-11`) decorators, so no Babel install is needed.

While Hoist Dev Utils provides most essential dev dependencies for Hoist React, apps typically also include:

* `husky` + `lint-staged` for pre-commit linting and other actions, such as running `tsc`.
* `prettier` + `eslint-config-prettier` for opinionated code formatting.
* `stylelint` + `stylelint-config-standard-scss` for SASS/SCSS linting.
* `typescript` + relevant `@types` definitions, specifically `@types/react` + `@types/react-dom`.

See the [Toolbox package.json](https://github.com/xh/toolbox/blob/develop/client-app/package.json) for examples of these
libraries in action.

## Rsbuild configuration

The `configureRsbuild.js` module exports a single `configureRsbuild()` function that returns a
complete [Rsbuild](https://rsbuild.rs) (Rspack + SWC) configuration. This includes transpiling and
bundling multiple client application entry points, styles (CSS/SASS), HTML index file generation,
and pre-compressed assets for production builds. See the docs within `configureRsbuild.js` for
supported arguments and additional details. The package ships type declarations for both config
modules. Add `// @ts-check` to the top of `rsbuild.config.mjs` to have the IDE check its options.

The generated configuration also sets the value of several XH globals within the built JS code, via
Rspack's DefinePlugin. These include `XH.appCode` and `XH.appName` (both required), `XH.appVersion`
(typically set as part of the build) and similar.

The intention is to reduce application build config files to a minimal and manageable subset of
options. An app's `rsbuild.config.mjs`:

```javascript
import configureRsbuild, {readCliEnv} from '@xh/hoist-dev-utils/configureRsbuild';

export default ({envMode}) =>
    configureRsbuild({
        appCode: 'myApp',
        appName: 'My Application',
        appVersion: '1.0-SNAPSHOT',
        favicon: './public/favicon.svg',
        devServerOpenPage: 'app/',
        prodBuild: envMode === 'prod',
        inlineHoist: envMode === 'inlineHoist',
        ...readCliEnv()
    });
```

Run with `rsbuild dev` / `rsbuild build --env-mode prod`. Build-time options reach
`configureRsbuild()` in three layers (Rsbuild's CLI has no `--env key=value` flag, and its own
`--env` means something else):

1. **Mode** - `--env-mode prod` / `--env-mode inlineHoist`, mapped in the app's config onto
   `prodBuild` / `inlineHoist` as above.
2. **CI overrides** - `XH_*` environment variables mapped by `readCliEnv()`, e.g.
   `XH_APP_VERSION=1.2.3 XH_APP_BUILD=abc123 rsbuild build --env-mode prod`.
3. **Per-mode and per-developer defaults** - the same `XH_*` variables in dotenv files, which
   Rsbuild loads into `process.env` before evaluating the config: `.env`, `.env.local`,
   `.env.<mode>` and `.env.<mode>.local` in the app directory. A gitignored `.env.local` is where a
   developer's `XH_DEV_HOST` or `XH_DEV_LIVE_RELOAD=false` belongs, in place of one-off
   `startWith...` script variants. Only `PUBLIC_`-prefixed variables are exposed to client code;
   `XH_*` values stay build-time.

In dev, CSS edits hot-swap and React Fast Refresh hot-swaps components. Two variables change this
for a developer who prefers full reloads:

* `XH_DEV_FAST_REFRESH=false` - every JS/TS edit reloads the page. CSS edits still hot-swap.
* `XH_DEV_HMR=false` - every edit reloads the page, CSS included.

Typical `package.json` scripts:

```json
"start": "pnpm install && rsbuild dev",
"startWithHoist": "(cd ${XH_HOIST_REACT_PATH:-../../hoist-react} && pnpm install) && pnpm install && rsbuild dev --env-mode inlineHoist",
"build": "rsbuild build --env-mode prod",
"buildAndAnalyze": "cross-env RSDOCTOR=true rsbuild build --env-mode prod"
```

Under pnpm, add `@rsbuild/core` to the app's `publicHoistPattern` so the `rsbuild` bin is on the
script path; yarn and npm hoist it with no configuration. Unrecognized options are reported in the
build banner. Options with no equivalent here (`babelPresetEnvOptions`, `terserOptions`, `stats`,
`infrastructureLoggingLevel`, `analyzeBundles`) are rejected with a pointer to their replacements
(`swcOptions`, `minifyOptions`, `logLevel`, `RSDOCTOR=true`).

Bundle analysis ships with Rsbuild, not with this package: add `@rsdoctor/rspack-plugin` to the app
and build with `RSDOCTOR=true`, and Rsbuild registers and launches
[Rsdoctor](https://rsdoctor.rs) for you.

See the [Hoist React docs](https://github.com/xh/hoist-react/blob/develop/docs/build-and-deploy-app.md)
for step-by-step details on the build process.

### Inline Hoist

Inline mode builds the app against a local hoist-react checkout in place of the installed package,
so a library change shows up in the app as you make it. By default the checkout is a sibling of the
app's repo, at `../../hoist-react` from `client-app`.

Set `XH_HOIST_REACT_PATH` to an absolute path to use another checkout. This is how a git worktree of
an app runs against a worktree of hoist-react on a paired branch:

```bash
XH_HOIST_REACT_PATH=~/dev/hoist-react-worktrees/my-feature pnpm startWithHoist
```

Set it in the shell, not in a dotenv file. The `startWithHoist` and `testWithHoist` scripts read it
to install the checkout's dependencies, and Rsbuild's dotenv files do not reach them. Vitest does not
load dotenv files either. A tool such as direnv or mise can set it per worktree.

Inline mode fails fast when the path holds no hoist-react checkout. The Rsbuild build banner shows
the path and branch it builds from.

### Inline packages

Inline packages extend inline mode to Hoist companion packages that ship as source, such as
`@xh/hoist-chat-kit`, `@xh/package-template` or a client library built on hoist-react. The build
runs a local checkout of the package in place of the installed copy, so a change to the package
shows up in the app as you make it.

Set `XH_INLINE_PACKAGES` to a comma-separated list of package names. Add `=/abs/path` to a name to
use a checkout at that path, which cannot contain a comma. Without a path, the checkout is a sibling
of the app's repo, named for the package without its scope:

```bash
# ../../hoist-chat-kit from client-app
XH_INLINE_PACKAGES=@xh/hoist-chat-kit pnpm start

# A worktree, together with inline Hoist
XH_INLINE_PACKAGES=@xh/hoist-chat-kit=$HOME/dev/hoist-chat-kit-worktrees/my-feature pnpm startWithHoist
```

`readCliEnv()` maps the variable onto the `inlinePackages` option, and `configureVitest()` reads it
too. An app config needs no change. Set it in the shell. A dotenv file reaches the build but not
Vitest. Production builds ignore it, with a warning.

A checkout installs its own dependencies, which hold a second copy of Hoist and React for its tests
and type checks. Two copies of either break the app, so the build shares one copy of these with the
app:

- every `peerDependency` of an inline package
- `@xh/hoist`, from the inline hoist-react checkout under inline Hoist
- React, react-dom and ag-Grid, if the app has them

A shared package resolves to an inline checkout if it is one, else to the app's copy. A peer that
the app does not install resolves to Hoist's own copy. All other dependencies of the package resolve
from its checkout, as its lockfile lays them out. A companion package must declare Hoist, React and
any other library it shares with the app as `peerDependencies`.

The build fails fast if a checkout is missing, holds another package, has no `node_modules`, or
lacks a required peer. It warns if a peer range does not match the version the app runs, or if a
shared library is under `dependencies`. The build banner shows the path and branch of each checkout
and the packages it shares.

Bundler aliases do not reach `tsc` or the IDE, which still read the installed package's types. To
type-check against the checkout, add a `paths` entry for the package to the app's `tsconfig.json`,
as for inline Hoist. Do not commit it.

```json
"paths": {
    "@xh/hoist-chat-kit/*": ["../../hoist-chat-kit/*"]
}
```

The build aliases each shared package to its directory, which bypasses the `exports` map in that
package's `package.json`. The directory then resolves through its `main`, `module` or `browser`
field. React, react-dom, ag-Grid and Hoist resolve correctly this way. A peer that has no such
field, or maps subpaths only through `exports`, fails to resolve, and the build reports the error.
Inline Hoist has the same limit.

An app alias for a shared package, such as an older hand-written alias to a checkout, gives way to
the shared copy, under inline Hoist too. The build and `configureVitest()` log a warning that names
it.

Rsbuild compiles TypeScript from any directory, `node_modules` included. An installed companion
package that ships only TypeScript therefore needs no `extraIncludePaths` entry. Add one only for a
package that also ships plain `.js` source.

### Migrating from v15 (webpack)

Dev-utils 16 is Rsbuild only - `configureWebpack()` is gone. To move an app:

1. Take `@xh/hoist-dev-utils` 16 **and `@xh/hoist` 88 together, in one commit** - v16 emits TC39
   (`2023-11`) decorators and v88 is the first hoist-react written against them. See hoist-react's
   v88 upgrade notes for the app-side codemods (`accessor` keywords, `makeObservable(this)`
   removal, `@persist` ordering). Under pnpm, replace the `webpack`, `webpack-cli` and
   `webpack-dev-server` entries in `publicHoistPattern` with `@rsbuild/core`.
2. Replace `webpack.config.js` with an `rsbuild.config.mjs` as above. Options carry over 1:1,
   except: `babelPresetEnvOptions` becomes `swcOptions`, `terserOptions` becomes `minifyOptions`,
   `stats` / `infrastructureLoggingLevel` become `logLevel`, `babelIncludePaths` /
   `babelExcludePaths` become `extraIncludePaths` / `extraExcludePaths` (old names still accepted,
   with a deprecation warning), and `devServerOptions.proxy` entries use http-proxy-middleware v3
   names (`pathFilter`, not `context`). `analyzeBundles` has no replacement option and is rejected -
   drop it and use Rsdoctor as above. The renamed options are rejected too, each with a pointer to
   its replacement, so nothing carries over silently.
3. Update scripts: `webpack-dev-server` becomes `rsbuild dev`, `webpack --env prodBuild` becomes
   `rsbuild build --env-mode prod`, `--env inlineHoist` becomes `--env-mode inlineHoist`, and
   `--no-live-reload` becomes `XH_DEV_LIVE_RELOAD=false` (a gitignored `.env.local` is the place
   for it). Drop the `NODE_OPTIONS=--max_old_space_size=3072` bump - it is no longer needed.
4. Update CI: `pnpm build --env appVersion="$VERSION" --env appBuild="$TAG"` becomes
   `XH_APP_VERSION="$VERSION" XH_APP_BUILD="$TAG" pnpm build`.
5. Build and compare. Output lands in `build/` with the same layout (JS and CSS at the root, media
   under `static/media`, per-app `index.html` and `public/<app>/manifest.json`), plus `.br` / `.gz`
   twins of compressible assets. Chunk boundaries differ from webpack's, so per-file names and sizes
   will not line up.

## Unit tests with Vitest

The `configureVitest.js` module exports `configureVitest()`, a [Vitest](https://vitest.dev) preset
for app unit tests. It compiles specs with the SWC inside Rspack and the same settings as
`configureRsbuild()`, so tests run the code the app ships. It also sets the same `XH` constants and
loads hoist-react's test setup, which starts a fake hoist-core server for each test file.

**Requires hoist-react >= 89.** The preset loads `test-support/setup.ts` from the installed
`@xh/hoist`, and hoist-react ships its `test-support/` folder from v89. With an older hoist-react,
the preset fails with a message that names the version it found. Builds still work with that
version.

This package does not bring the test runners. Add them to the app as devDependencies:

```bash
pnpm add -D vitest jsdom msw @testing-library/react @testing-library/dom
```

Take the latest versions that fit the optional peer ranges in the `package.json` of `@xh/hoist`.
pnpm warns about any version outside those ranges. Then add scripts:

```json
"scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "testWithHoist": "(cd ${XH_HOIST_REACT_PATH:-../../hoist-react} && pnpm install) && pnpm install && XH_INLINE_HOIST=true vitest"
}
```

hoist-react's test setup unmounts rendered components after each test, so it needs React Testing
Library even if the app's specs never render. Then add a `vitest.config.mts` next to
`rsbuild.config.mjs`:

```typescript
import configureVitest from '@xh/hoist-dev-utils/configureVitest';
import {defineConfig} from 'vitest/config';

export default defineConfig(configureVitest({appCode: 'myApp'}));
```

Import the preset by package name. Vite bundles a relative import of this CommonJS file, and the
bundled copy fails. The preset's type declarations let the IDE check its options. Put specs next to the code they test, as `src/**/*.spec.ts`. The build skips
`*.spec.*` and `*.test.*` files in `src/apps/`, so a spec there does not become an app entry.
See hoist-react's `docs/unit-testing.md` for how to write specs.

To add Vitest settings, wrap the result in `mergeConfig()` from `vitest/config`. A scalar setting
from the app wins. `mergeConfig()` joins arrays, so it cannot narrow a list: pass `include` and
`setupFiles` to the preset instead.

`configureVitest()` takes the same `env` object as `configureRsbuild()`, so an app can share one
object between its two configs. Add the test-only keys in the Vitest config alone, as in
`configureVitest({...env, setupFiles: ['./src/test-support/setup.ts']})`. `configureRsbuild()`
warns about keys it does not know.

| Option | In tests |
|---|---|
| `appCode` (required), `appName`, `appVersion`, `appBuild`, `baseUrl` | Set in `XH`, with the build defaults |
| `inlineHoist`, `inlinePackages`, `extraIncludePaths`, `extraExcludePaths`, `resolveAliases`, `swcOptions` | As in the build. An alias value that starts with `.` is relative to the root. `swcOptions` drops any `env` key, which SWC rejects with `jsc.target`. |
| `extraModuleRules` | Ignored, with a warning. Rspack rules cannot run under Vite. |
| Other build options | Ignored |
| `root` | Project root. Default: the current directory. |
| `include` | Spec globs. Default: `['src/**/*.spec.{ts,tsx}']`. |
| `setupFiles` | App setup files, run after hoist-react's `test-support/setup.ts`. Default: `[]`. |
| `timeZone` | Sets `TZ` for the run. Default: `'America/New_York'`. `null` keeps the machine zone. |
| `selfHost` | For hoist-react's own config only. Aliases `@xh/hoist` to the project root. |

The preset gives hoist-react's test kit a fixed setup. `XH.isDevelopmentMode` is false, and client
app names come from `src/apps`, or `['app']` without that folder. Each test file runs isolated in
jsdom, with mocks, env stubs and global stubs restored after each test. Stylesheet imports resolve to
an empty module, and with `?inline`, `?raw` or `?url` to an empty string. `@xh/app-changelog.json`
resolves to `{}`, and a `.md` import to its text.

A run with `--no-isolate`, or in the `vmThreads` or `vmForks` pool, fails, because each test file
boots its own `XH`. If the installed `@xh/hoist` declares a `vitest` peer dependency, the preset also
fails on a Vitest major outside that range.

`XH_INLINE_HOIST=true` (or `inlineHoist: true`) runs the app's tests against a local hoist-react
checkout, as `startWithHoist` does for the dev server. See [Inline Hoist](#inline-hoist) for how the
checkout is found. The preset aliases
`@xh/hoist` to the checkout. It dedupes React, ag-Grid, msw, React Testing Library and MobX to the
app's own copies, if the app has them. A Node resolve hook does the same for the checkout's
dependencies, which Vitest loads outside Vite. Inline mode works under pnpm. It is untested under
yarn and npm.

`XH_INLINE_PACKAGES` (or `inlinePackages`) runs the tests against local checkouts of companion
packages, with the shared copies described in [Inline packages](#inline-packages). The preset does
not collect a checkout's own specs, because `include` globs match under the project root only.

The name matches Vitest's own `configureVitest` plugin hook. The two are unrelated: this one is a
config factory, like `configureRsbuild()`.

## Favicons

To include a favicon with your app, provide the `favicon` option to `configureRsbuild()`. This can be either
a `png` or an `svg` file:

```javascript
return configureRsbuild({
    ...,
    favicon: './public/favicon.svg',
    ...
});
```

If your app is intended to be used on mobile devices, you may want to also include a wider variety of favicons.
The following files will be automatically bundled in your app's `manifest.json` if they are found in your project's
`/client-app/public` folder:

+ `favicon-192.png` (192px x 192px)
+ `favicon-512.png` (512px x 512px)
+ `apple-touch-icon.png` (180px x 180px)

### Generating favicons with the Toolbox Favicon Designer

Use the [Favicon Designer](https://toolbox.xh.io/favicons/) example app in Toolbox to create a
full favicon set. Pick any Font Awesome Pro glyph, choose colors, a backdrop shape and padding, and
preview the result in browser tabs and on a phone home screen. Download a zip of `favicon.svg`,
`favicon-192.png`, `favicon-512.png` and `apple-touch-icon.png`, unzip it into your app's
`client-app/public` folder, and paste the generated `configureRsbuild()` snippet into
`rsbuild.config.mjs`. The design is encoded in the page URL, and in a comment within the generated
`favicon.svg`, so you can reopen and tweak it later.

## ESLint Configuration

✨ This package includes a development dependency on the `@xh/eslint-config` package.
[That package](https://github.com/xh/eslint-config) exports an eslint configuration object with
XH's recommended coding conventions and best practices for Hoist React based development.

Applications that already have `@xh/hoist-dev-utils` as a dependency can use these rules for their
own ESLint config with an `eslint.config.js` file similar to:

```javascript
const {defineConfig, globalIgnores} = require('eslint/config'),
    xhEslintConfig = require('@xh/eslint-config'),
    prettier = require('eslint-config-prettier');

module.exports = defineConfig([
    {
        extends: [xhEslintConfig, prettier]
    },
    globalIgnores(['build/**/*', '.yarn/**/*', 'node_modules/**/*'])
]);
```

This example file:

* Requires and specifies XH's recommended presets.
* Overlays with Prettier-specific linter rules (assuming the project is using Prettier)
* Ignores build outputs, bundled `.yarn` (if included in your project) and `node_modules`.

If required, rules and other settings extended from this base configuration can be overridden at the
app level.

## Changelog fragments

Hoist libraries and apps keep a curated `CHANGELOG.md`. When every pull request edits the top of
that one file, two things go wrong. Parallel pull requests conflict over it. And a pull request
that merges after a release can put its entries under the version that just shipped, because git
merges the lines into the renamed release block without a conflict.

Changelog fragments fix both. Each pull request writes its entries in a new file in `changelog.d/`,
next to `CHANGELOG.md`. A release assembles the fragments into `CHANGELOG.md` under the real version
number and deletes them. People still write and review every entry, and still curate each release
in `CHANGELOG.md` before they commit it.

The `xh-changelog` command in this package does the work. It runs on plain Node with no other
dependencies, from anywhere inside the repo. In an app, run it from `client-app/`. It works on the
nearest `CHANGELOG.md` above the current directory.

### Write a fragment

A fragment is the body of a release without its `##` heading. It uses the same `###` sections and
bullets as `CHANGELOG.md`. Bullets can wrap, and they can hold sub-bullets.

```markdown
### 🎁 New Features

* Added `Callout.dismissible`, which shows a close button. The dismissed state persists with
  `persistWith`.

### 🐞 Bug Fixes

* Fixed `GridModel` losing its sort when its store reloaded with a filter applied.
```

Run `xh-changelog new` to create `changelog.d/<branch>.md` with the valid sections listed in a
comment, or create the file yourself with any name. A pull request can add more than one fragment,
and it can edit a fragment that another pull request added.

Fragments hold entries only. Leave release-level notes out of them: an upgrade difficulty rating in
the `💥 Breaking Changes` heading, an upgrade-notes link, and `####` topic groups. Add those when you
curate the release.

### Commands

| Command | What it does |
|---|---|
| `xh-changelog new [name]` | Creates `changelog.d/<name>.md`. The name defaults to the git branch. |
| `xh-changelog check` | Validates every fragment, and checks that `CHANGELOG.md` has no entries under its unreleased heading. Add `--base <ref>` to warn when the branch adds no fragment, and `--require` to make that an error. |
| `xh-changelog preview` | Prints the next release as it would be assembled. |
| `xh-changelog release <version>` | Assembles the fragments into `CHANGELOG.md` and deletes them. Takes `--date`, `--dry-run` and `--allow-breaking`. |
| `xh-changelog snapshot [--version <v>]` | Writes the assembled fragments under the unreleased heading, for a snapshot build. Never commit the result. |
| `xh-changelog init` | Sets up `changelog.d/` in a repo. |

`check` fails on a version heading in a fragment, a section that is not in the config, a heading
suffix, a `####` group, an empty fragment or bullet, and entries written straight into
`CHANGELOG.md`. It warns on lines longer than `maxLineLength`.

### Set up a repo

1. Run `xh-changelog init`. It creates `changelog.d/config.json` and `changelog.d/README.md`. If
   `CHANGELOG.md` has entries under an unreleased heading, it moves them into
   `changelog.d/unreleased.md`.
2. Check the section list and order in `changelog.d/config.json`. `init` infers them from recent
   releases.
3. Keep a bare unreleased heading, such as `## 92.0.0-SNAPSHOT - unreleased`, at the top of
   `CHANGELOG.md`. It shows the version under development. Nothing is written under it.
4. Add the check to CI. See `check-changelog` in [`.github/README.md`](.github/README.md).
5. Point your contributor docs, `CLAUDE.md` and pull request template at `changelog.d/`.

`changelog.d/config.json` takes these keys:

| Key | Default | Description |
|---|---|---|
| `sections` | Inferred from recent releases | `###` section titles, in release order. Fragments may use only these. |
| `headingFormat` | `## {version} - {date}` | Release heading. `init` uses `## v{version} - {date}` if the latest release heading has a `v`. |
| `maxLineLength` | None | Warn on longer fragment lines. Libraries that hard-wrap set `100`. |
| `allowOtherSections` | `false` | Accept sections that are not in `sections`, for apps that add one-off sections. They go after the listed sections. |

### Release

Run `xh-changelog release 92.1.0`, review and edit the new block in `CHANGELOG.md`, then commit.

- Sections follow the config order. Within a section, prose comes first, then bullets, in fragment
  file name order. Duplicate bullets are dropped, and two bumps of one library in the `Libraries`
  section merge into one bullet.
- The block goes above the newest release with a lower version, so a hotfix to an older line lands
  in version order.
- A `Breaking Changes` section blocks a release that is not a major (`N.0.0` or `N.0`), unless you
  pass `--allow-breaking`.
- Releasing the major that the unreleased heading names rolls the heading forward, for example
  from `92.0.0-SNAPSHOT` to `93.0.0-SNAPSHOT`.
- Entries still written under the unreleased heading join the release, with a warning.

For a hotfix on a release branch, add the fragment there and run `release`. When you merge the
hotfix back, delete the matching fragment on `develop` if the same fix landed there too. Otherwise
the next release lists it twice.

### Snapshot builds

A library's published snapshot should show what it holds. Run `xh-changelog snapshot --version
<snapshot version>` in the snapshot publish job, after checkout and before `npm publish`, so the
package's `CHANGELOG.md` lists the unreleased entries.

## Shared GitHub Actions

This repository provides a set of reusable [composite GitHub Actions](https://docs.github.com/en/actions/sharing-automations/creating-actions/creating-a-composite-action)
for CI/CD across the Hoist ecosystem. These actions standardize release validation, snapshot
versioning, and tag/release creation for all `xh` repositories — including npm-based projects
(hoist-react, hoist-dev-utils) and Gradle-based projects (hoist-core).

Available actions under `.github/actions/`:

* **`validate-release-version`** — Ensures a proposed release version is valid semver and a strict
  single increment from the latest tag. Supports hotfix releases.
* **`prepare-npm-snapshot-version`** — Resolves and writes a SNAPSHOT version to `package.json`
  with an optional uniqueness timestamp.
* **`prepare-gradle-snapshot-version`** — Resolves and writes a SNAPSHOT version to
  `gradle.properties` for Java/Grails projects.
* **`create-tag-and-github-release`** — Tags a commit, pushes the tag, and creates a GitHub Release
  with auto-generated notes.
* **`check-changelog`** - Validates the changelog fragments a pull request adds. See
  [Changelog fragments](#changelog-fragments).

Because this is a public repository, these actions can be referenced by any GitHub repository.
They are used by Hoist ecosystem projects and are available to any Hoist application or library.
Consuming repos reference them at `xh/hoist-dev-utils/.github/actions/<name>@master`. Changes to these actions will be
documented in `CHANGELOG.md` and reflected in semantic versioning alongside other updates to this
package. See [`.github/README.md`](.github/README.md) for full documentation, inputs/outputs, and
usage examples.

## Hoist Dev Utils Development

To develop improvements to this library, clone its repo into your workspace alongside a project
that uses Hoist-React, like [Toolbox](https://github.com/xh/toolbox). Then link this repo into the
app's `node_modules` with your package manager's link command - e.g.
[pnpm link](https://pnpm.io/cli/link) or
[yarn link](https://classic.yarnpkg.com/lang/en/docs/cli/link/), matching whichever package
manager the app itself uses.

This repo itself is managed with [pnpm](https://pnpm.io) - run `pnpm install` to install its
dependencies. The required pnpm version is pinned via the `packageManager` field in `package.json`
and will be provisioned automatically by [corepack](https://nodejs.org/api/corepack.html)
(`corepack enable pnpm`) or by a standalone pnpm install of v10+. Run `pnpm test` for the
`node --test` specs under `test/`.

------------------------------------------

☎️ info@xh.io | <https://xh.io>

Copyright © 2026 Extremely Heavy Industries Inc.
