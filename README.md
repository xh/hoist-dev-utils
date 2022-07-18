# 🛠️ Hoist Dev Utils

Tooling for building and deploying web applications built on the Hoist React platform. This
repository is made available as the `@xh/hoist-dev-utils`
[package on npm](https://www.npmjs.com/package/@xh/hoist-dev-utils) for import and use by
applications.

### Shared development dependencies

The package.json file in this repository specifies a set of development dependencies required for
building Hoist React applications. Those applications can specify `@xh/hoist-dev-utils` as a dev
dependency and transitively bring in libs for Webpack and all associated plugins used in app builds,
including Webpack Dev Server, Babel, and other essential loaders.

In most cases this package could be the _only_ dev dependency required by Hoist React apps, although
apps might wish to configure additional tooling such as stylelint (for linting SASS files) or
lint-staged (for running linters as a pre-commit git hook). See the
[Toolbox package.json](https://github.com/xh/toolbox/blob/develop/client-app/package.json) for
examples of both of these libraries in action.

### Webpack configuration

The configureWebpack.js module exports a single `configureWebpack()` method that can be used to
output a complete Webpack configuration. This includes support for transpiling and bundling multiple
client application entry points with preconfigured loaders for JS code (Babel), styles
(CSS/SASS/PostCSS) and HTML index file generation. See the docs within that file for supported
arguments and additional details.

The generated Webpack configuration also sets the value of several XH globals within the built JS
code, via the Webpack DefinePlugin. These include `XH.appCode` and `XH.appName` (both required),
`XH.appVersion` (typically set as part of the build) and similar.

The intention is to reduce application webpack config files to a minimal and manageable subset of
options. An example of such a file would be:

```javascript
const configureWebpack = require('@xh/hoist-dev-utils/configureWebpack');

module.exports = (env = {}) => {
    return configureWebpack({
        appCode: 'myApp',
        appName: 'My Application',
        appVersion: env.appVersion || '1.0-SNAPSHOT',
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


### Favicons

To include a favicon with your app, provide the `favicon` option to `configureWebpack()`. This can be either
a `png` or an `svg` file:

```javascript
return configureWebpack({
    ...,
    favicon: './public/favicon.svg',
    ...
});
```

If your app is intended to be used on mobile devices, you may want to also include a wider variety of favicons.
The following files will be automatically bundled in your app's manifest.json if they are found your `/public` folder:

+ `favicon-192.png` (192px x 192px)
+ `favicon-512.png` (512px x 512px)
+ `apple-touch-icon.png` (180px x 180px)

You can use the `svg-favicon.sh` script to automatically create these favicons from a square SVG. Note that this script
requires inkscape to be installed. Download the latest version from [https://inkscape.org/](https://inkscape.org/)

Inkscape includes a command-line interface which is leveraged by the script. In order for the script to be able to use it,
you must first symlink Inkscape to `/usr/local/bin`:

```shell
ln -s /Applications/Inkscape.app/Contents/MacOS/inkscape \
/usr/local/bin/inkscape
```

Then run the script, passing a path to the SVG file as the argument:

```shell
sh svg-favicon.sh ./favicon.svg
```

### ESLint Configuration

✨ This package includes a development dependency on the `@xh/eslint-config` package.
[That package](https://github.com/xh/eslint-config) exports an eslint configuration object with
ExHI's coding conventions and best practices for Hoist React based development.

Applications that already have `@xh/hoist-dev-utils` as a dependency can use these rules for their
own ESLint config by specifying their `.eslintrc` file as simply:

```
{
  "extends": ["@xh/eslint-config"]
}
```

If required, rules and other settings extended from this base configuration can be overridden at the
app level.

------------------------------------------

☎️ info@xh.io | <https://xh.io>

Copyright © 2022 Extremely Heavy Industries Inc.
