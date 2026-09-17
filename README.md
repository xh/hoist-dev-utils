# 🛠️ Hoist Dev Utils

Tooling for building and deploying web applications built on the Hoist React platform. This
repository is made available as the `@xh/hoist-dev-utils`
[package on npm](https://www.npmjs.com/package/@xh/hoist-dev-utils) for import and use by
applications.

## Shared development dependencies

The package.json file in this repository specifies a set of development dependencies required for
building Hoist React applications. Those applications can specify `@xh/hoist-dev-utils` as a dev
dependency and transitively bring in libs for Webpack and all associated plugins used in app builds,
including Webpack Dev Server, Babel, and other essential loaders.

While Hoist Dev Utils provides most essential dev dependencies for Hoist React, apps typically also include:

* `husky` + `lint-staged` for pre-commit linting and other actions, such as running `tsc`.
* `prettier` + `eslint-config-prettier` for opinionated code formatting.
* `stylelint` + `stylelint-config-standard-scss` for SASS/SCSS linting.
* `typescript` + relevant `@types` definitions, specifically `@types/react` + `@types/react-dom`.

See the [Toolbox package.json](https://github.com/xh/toolbox/blob/develop/client-app/package.json) for examples of these
libraries in action.

## Webpack configuration

The `configureWebpack.js` module exports a single `configureWebpack()` method that can be used to
output a complete Webpack configuration. (See below for `configureRsbuild()`, its Rspack-based
successor-in-evaluation.) This includes support for transpiling and bundling multiple
client application entry points with preconfigured loaders for JS code (Babel), styles
(CSS/SASS/PostCSS) and HTML index file generation. See the docs within `configureWebpack.js` for supported
arguments and additional details.

The generated Webpack configuration also sets the value of several XH globals within the built JS
code, via the Webpack DefinePlugin. These include `XH.appCode` and `XH.appName` (both required),
`XH.appVersion` (typically set as part of the build) and similar.

The intention is to reduce application webpack config files to a minimal and manageable subset of
options. An example of such a file would be:

```typescript
const configureWebpack = require('@xh/hoist-dev-utils/configureWebpack');

module.exports = (env = {}) => {
    return configureWebpack({
        appCode: 'myApp',
        appName: 'My Application',
        appVersion: '1.0-SNAPSHOT',
        favicon: './public/favicon.svg',
        devServerOpenPage: 'app/',
        ...env
    });
};
```

Note that additional env variables can be provided at build time, so the application file can
specify initial defaults (such as appVersion above, checked in as a SNAPSHOT) that are then
overridden for particular builds (e.g. via `webpack --env prodBuild --env appVersion=1.2.3` to cut a
versioned 1.2.3 release).

See the [Hoist React docs](https://github.com/xh/hoist-react/blob/develop/docs/build-and-deploy.md)
for step-by-step details on the build process.

## Rsbuild configuration (Rspack + SWC)

As of v16 the package also exports `configureRsbuild()`, an [Rsbuild](https://rsbuild.rs)-based
equivalent of `configureWebpack()` producing the same build features from the same options, with
Rspack replacing webpack and SWC replacing Babel. Builds are several times faster, need far less
memory, and the dev server hot-swaps stylesheet edits and modules exporting React components
(`hoistCmp({...})`) in place, with element-factory modules falling back to a sub-second reload. It
shares `configureWebpack()`'s hoist-react floor - by default Hoist's legacy decorators
are still transformed by Babel (ahead of SWC), so no framework change is needed to adopt it. An app
opts in with an `rsbuild.config.mjs`:

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
`configureRsbuild()` in three layers, none of them webpack's `--env key=value` (Rsbuild's CLI has
no such flag, and its own `--env` means something else):

1. **Mode** - `--env-mode prod` / `--env-mode inlineHoist`, mapped in the app's config onto
   `prodBuild` / `inlineHoist` as above.
2. **CI overrides** - `XH_*` environment variables mapped by `readCliEnv()`, e.g.
   `XH_APP_VERSION=1.2.3 XH_APP_BUILD=abc123 rsbuild build --env-mode prod`.
3. **Per-mode and per-developer defaults** - the same `XH_*` variables in dotenv files, which
   Rsbuild loads into `process.env` before evaluating the config: `.env`, `.env.local`,
   `.env.<mode>` and `.env.<mode>.local` in the app directory. A gitignored `.env.local` is where a
   developer's `XH_DEV_HOST` or `XH_DEV_LIVE_RELOAD=false` belongs, replacing the one-off
   `startWith...` script variants of the webpack era. Only `PUBLIC_`-prefixed variables are exposed
   to client code; `XH_*` values stay build-time.

Under pnpm, add `@rsbuild/core` to the app's `publicHoistPattern` so the `rsbuild` bin is on the
script path (as Toolbox does for `webpack`); yarn and npm hoist it with no configuration. Options that have no SWC equivalent (`babelPresetEnvOptions`,
`terserOptions`) are rejected with a pointer to their replacements (`swcOptions`, `minifyOptions`).
See [`docs/rsbuild-spike.md`](docs/rsbuild-spike.md) for the parity table, Toolbox measurements
and known differences.

## Favicons

To include a favicon with your app, provide the `favicon` option to `configureWebpack()`. This can be either
a `png` or an `svg` file:

```typescript
return configureWebpack({
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
