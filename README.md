# 🛠️ Hoist Dev Utils

Tooling for building and deploying web applications built on the Hoist React platform. This
repository is made available as the `@xh/hoist-dev-utils`
[package on npm](https://www.npmjs.com/package/@xh/hoist-dev-utils) for import and use by
applications.

## Shared development dependencies

The package.json file in this repository specifies a set of development dependencies required for
building Hoist React applications. Those applications can specify `@xh/hoist-dev-utils` as a dev
dependency and transitively bring in [Rsbuild](https://rsbuild.rs) (Rspack + SWC) and the plugins
used in app builds, including the Rsbuild dev server, Sass, and Babel (for Hoist's legacy
decorators).

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
supported arguments and additional details.

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
"buildAndAnalyze": "cross-env XH_ANALYZE_BUNDLES=true rsbuild build --env-mode prod"
```

Under pnpm, add `@rsbuild/core` to the app's `publicHoistPattern` so the `rsbuild` bin is on the
script path; yarn and npm hoist it with no configuration. Unrecognized options are reported in the
build banner. Options with no equivalent here (`babelPresetEnvOptions`, `terserOptions`, `stats`,
`infrastructureLoggingLevel`) are rejected with a pointer to their replacements (`swcOptions`,
`minifyOptions`, `logLevel`).

See the [Hoist React docs](https://github.com/xh/hoist-react/blob/develop/docs/build-and-deploy-app.md)
for step-by-step details on the build process, and [`docs/rsbuild-spike.md`](docs/rsbuild-spike.md)
for the measurements against the v15 webpack build and the known differences in output.

### Migrating from v15 (webpack)

Dev-utils 16 is Rsbuild only - `configureWebpack()` is gone. To move an app:

1. Take `@xh/hoist-dev-utils` 16. It requires hoist-react >= 87.1, unchanged from v15. Under pnpm,
   replace the `webpack`, `webpack-cli` and `webpack-dev-server` entries in `publicHoistPattern`
   with `@rsbuild/core`.
2. Replace `webpack.config.js` with an `rsbuild.config.mjs` as above. Options carry over 1:1,
   except: `babelPresetEnvOptions` becomes `swcOptions`, `terserOptions` becomes `minifyOptions`,
   `stats` / `infrastructureLoggingLevel` become `logLevel`, and `devServerOptions.proxy` entries
   use http-proxy-middleware v3 names (`pathFilter`, not `context`).
3. Update scripts: `webpack-dev-server` becomes `rsbuild dev`, `webpack --env prodBuild` becomes
   `rsbuild build --env-mode prod`, `--env inlineHoist` becomes `--env-mode inlineHoist`, and
   `--no-live-reload` becomes `XH_DEV_LIVE_RELOAD=false` (a gitignored `.env.local` is the place
   for it). Drop the `NODE_OPTIONS=--max_old_space_size=3072` bump - it is no longer needed.
4. Update CI: `pnpm build --env appVersion="$VERSION" --env appBuild="$TAG"` becomes
   `XH_APP_VERSION="$VERSION" XH_APP_BUILD="$TAG" pnpm build`.
5. Build and compare. Output lands in `build/` with the same layout (JS and CSS at the root, media
   under `static/media`, per-app `index.html` and `public/<app>/manifest.json`), plus `.br` / `.gz`
   twins of compressible assets. Chunk boundaries differ from webpack's; total payload is smaller.

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
(`corepack enable pnpm`) or by a standalone pnpm install of v10+.

------------------------------------------

☎️ info@xh.io | <https://xh.io>

Copyright © 2026 Extremely Heavy Industries Inc.
