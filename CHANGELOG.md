# Changelog

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
