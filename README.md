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

Typical `package.json` scripts:

```json
"start": "pnpm install && rsbuild dev",
"startWithHoist": "(cd ../../hoist-react && pnpm install) && pnpm install && rsbuild dev --env-mode inlineHoist",
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
    "testWithHoist": "(cd ../../hoist-react && pnpm install) && pnpm install && XH_INLINE_HOIST=true vitest"
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
| `inlineHoist`, `extraIncludePaths`, `extraExcludePaths`, `resolveAliases`, `swcOptions` | As in the build. An alias value that starts with `.` is relative to the root. `swcOptions` drops any `env` key, which SWC rejects with `jsc.target`. |
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

`XH_INLINE_HOIST=true` (or `inlineHoist: true`) runs the app's tests against a hoist-react
checkout at `../../hoist-react`, as `startWithHoist` does for the dev server. The preset aliases
`@xh/hoist` to the checkout. It dedupes React, ag-Grid, msw, React Testing Library and MobX to the
app's own copies, if the app has them. A Node resolve hook does the same for the checkout's
dependencies, which Vitest loads outside Vite. Inline mode works under pnpm. It is untested under
yarn and npm.

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

### Generating favicons via `svg-favicon.sh`

You can use the `svg-favicon.sh` script included in this repo to automatically create these favicons from a square SVG.
Note that this script requires inkscape to be installed. Download the latest version
from [https://inkscape.org/](https://inkscape.org/) or install on Mac via Homebrew with `brew install inkscape`.

Inkscape includes a command-line interface which is leveraged by the script. In order for the script to be able to use
it, you must first symlink Inkscape to `/usr/local/bin`. (Note this step is _not_ required if you have installed via
Homebrew.)

```shell
# Not required if installed via Homebrew!
ln -s /Applications/Inkscape.app/Contents/MacOS/inkscape \
/usr/local/bin/inkscape
```

Then run the script, passing a path to the SVG file as the argument. The command below assumes that you have
`hoist-dev-utils` checked out as a sibling of your top-level project directory, and that you are running the command
from within `$projectDir/client-app/public`:

```shell
../../../hoist-dev-utils/svg-favicon.sh favicon.svg
```

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
