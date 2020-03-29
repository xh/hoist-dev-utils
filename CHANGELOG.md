# Changelog

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

* @babel/core `7.8 -> 7.9`
* @babel/preset-env `7.8 -> 7.9`
* @babel/preset-react `7.8 -> 7.9`
* babel-loader `8.0 -> 8.1`
* file-loader `5.0 -> 6.0`
* url-loader `3.0 -> 4.0`

[Commit Log](https://github.com/xh/hoist-dev-utils/compare/v4.5.0...v4.6.0)

## 4.5.0 - 2020-03-04

### 🎁 New Features

* The `/client-app/public` directory and its contents are now copied into the build output. Can be
  used to include static assets you wish to link to without using an import to run through the url
  or file-loader.

### 📚 Libraries

* copy-webpack-plugin: `added @ 5.1`
* webpack: `4.41 -> 4.42`

[Commit Log](https://github.com/xh/hoist-dev-utils/compare/v4.4.1...v4.5.0)

## 4.4.1 - 2020-02-26

### 🐞 Bug Fixes

* Fixed favicon generation with upgrade of plugin - generated HTML again includes tags for correctly
  sized favicons across a variety of platforms.

### 📚 Libraries

* favicons-webpack-plugin: `1.0 -> 2.1`

[Commit Log](https://github.com/xh/hoist-dev-utils/compare/v4.4.0...v4.4.1)

## 4.4.0 - 2020-02-08

### 📚 Libraries

* @babel/core (and related) `7.7 -> 7.8`
* css-loader `3.2 -> 3.4`
* mini-css-extract-plugin `0.8 -> 0.9`
* style-loader `1.0 -> 1.1`
* terser-webpack-plugin `2.2 -> 2.3`
* webpack-dev-server `3.9 -> 3.10`

[Commit Log](https://github.com/xh/hoist-dev-utils/compare/v4.3.7...v4.4.0)

## 4.3.7 - 2019-12-06

### 📚 Libraries

* @babel/plugin-proposal-nullish-coalescing-operator `7.4 -> 7.7`
* @babel/plugin-proposal-optional-chaining `7.6 -> 7.7`
* file-loader `4.2 -> 5.0`
* url-loader `2.2 -> 3.0`

[Commit Log](https://github.com/xh/hoist-dev-utils/compare/v4.3.6...v4.3.7)

## 4.3.6 - 2019-11-19

### 🐞 Bug Fixes

* Disable Terser mangling of identifiers / variables due to intermittent and difficult to debug
  issues with it breaking code, especially when run on already-packaged libraries. Disabling does
  increase bundle size, although not by much on a relative basis.

[Commit Log](https://github.com/xh/hoist-dev-utils/compare/v4.3.5...v4.3.6)

## 4.3.5 - 2019-11-15

### 📚 Libraries

* @babel/core (and related) `7.6 -> 7.7`
* autoprefixer `9.6 -> 9.7`
* node-sass `4.12 -> 4.13`
* terser-webpack-plugin `2.1 -> 2.2`
* webpack-bundle-analyzer `3.5 -> 3.6`
* webpack-dev-server `3.8 -> 3.9`
* chalk (removed)

[Commit Log](https://github.com/xh/hoist-dev-utils/compare/v4.3.4...v4.3.5)

## 4.3.4 - 2019-10-14

### ⚙️ Technical

* Bundled `@types/lodash` and `@types/react` as dev dependencies for developer convenience / better
  hinting options from IDEs, including support for types such as `ReactNode` in jsdoc comments.

### 📚 Libraries

* @babel/preset-react `7.0 -> 7.6`

[Commit Log](https://github.com/xh/hoist-dev-utils/compare/v4.3.3...v4.3.4)

## 4.3.3 - 2019-10-07

### ⚙️ Technical

* Add new `terserOptions` config as hook for app builds to customize Terser minification directly if
  required, although defaults should continue to be fine as they are. Added `keep_classnames: true`
  to the Terser defaults now that we are emitting classes.

### 📚 Libraries

* url-loader `2.1 -> 2.2`

[Commit Log](https://github.com/xh/hoist-dev-utils/compare/v4.3.1...v4.3.3)

(4.3.2 was an accidental no-op build 😞)

## 4.3.1 - 2019-10-02

### 📚 Libraries

* @xh/eslint-config `2.1 -> 2.2`

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

* webpack `4.40 -> 4.41`

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

* @xh/eslint-config `2.0 -> 2.1.1`
* terser-webpack-plugin `2.0 -> 2.1`

[Commit Log](https://github.com/xh/hoist-dev-utils/compare/v4.0.0...v4.1.1)

## 4.0.0 - 2019-09-12

This release includes a number of major/minor updates for the build toolchain. Most notably, it
updates Babel and its plugins from `7.4 -> 7.6`, which removes support for the `@babel/polyfill`
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

* @babel `7.4 -> 7.6`
* @xh/eslint-config `1.2 -> 2.0`
* webpack `4.31 -> 4.40`
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

* @xh/eslint-config `1.1.1 -> 1.2.0` - react-hooks plugin and linting rules.

[Commit Log](https://github.com/xh/hoist-dev-utils/compare/v3.7.7...v3.8.0)

## v3.7.7 - 2019-08-07

### ⚙️ Technical

* Added new `checkForDupePackages` flag, default true to mirror previous behavior added in 3.7.5.
  Set to false to disable duplicate package checking / warnings if unwanted.

[Commit Log](https://github.com/xh/hoist-dev-utils/compare/v3.7.6...v3.7.7)

## v3.7.6 - 2019-07-25

### 📚 Libraries

* @xh/eslint-config `1.1.0 -> 1.1.1` - whitelist WebSocket global.

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

* node-sass `4.11 -> 4.12`
* webpack `4.30 -> 4.31`
* Other minor/patch updates

[Commit Log](https://github.com/xh/hoist-dev-utils/compare/v3.7.1...v3.7.2)

## v3.7.1 - 2019-04-23

### 📚 Libraries

* webpack `4.29 -> 4.30`
* webpack-dev-server `3.2 -> 3.3`
* Other minor/patch updates

[Commit Log](https://github.com/xh/hoist-dev-utils/compare/v3.7.0...v3.7.1)

## v3.7.0 - 2019-03-27

### 📚 Libraries

* Babel `7.3 -> 7.4`
* autoprefixer `9.4 -> 9.5`
* webpack-cli `3.2 -> 3.3`

[Commit Log](https://github.com/xh/hoist-dev-utils/compare/v3.6.0...v3.7.0)

------------------------------------------

📫☎️🌎 info@xh.io | <https://xh.io/contact>

Copyright © 2020 Extremely Heavy Industries Inc.
