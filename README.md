# Hoist Dev Utils

Tooling for building and deploying web applications built on the Hoist React platform. This repository is made 
available as the `@xh/hoist-dev-utils` package on repo.xh.io for import and use by applications. It also hosts 
Dockerfiles for base xh-tomcat and xh-nginx deployment containers.

### Shared development dependencies

The package.json file in this repository specifies a set of development dependencies required for building Hoist React 
applications. Those applications can specify `@xh/hoist-dev-utils` as a dev dependency and transitively bring in libs 
for Webpack and all associated plugins used in app builds, including Webpack Dev Server, Babel, and other essential 
loaders.

In most cases it is expected that this can be the _only_ dev dependency required by Hoist React apps.

### Webpack configuration

The configureWebpack.js module exports a single `configureWebpack()` method that can be used to output a complete 
Webpack configuration. This includes support for transpiling and bundling multiple client application entry points with 
preconfigured loaders for JS code (Babel), styles (CSS/SASS/PostCSS) and HTML index file generation. See the docs
within that file for further details. 

The generated Webpack configuration also sets the value of several XH globals within the built JS code, via the Webpack
DefinePlugin. These include `XH.appName` (required), `XH.appVersion` and similar. 

The intention is to reduce application webpack config files to a minimal and manageable subset of options. 
An example of such a file would be:
```
const configureWebpack = require('@xh/hoist-dev-utils/configureWebpack');

module.exports = (env = {}) => {
    return configureWebpack({
        appName: 'My App',
        appVersion: env.appVersion || '1.0-SNAPSHOT',
        favicon: './public/app-logo.png'
        ...env
    });
};
```

Note that additional env variables can be provided at build time, so the application file can specify initial defaults
(such as appVersion above, checked in as a SNAPSHOT) that are then overridden for particular builds (e.g. via `webpack 
--env.prodBuild --env.appVersion=1.2.3` to cut a versioned 1.2.3 release).

### ESLint Configuration

This top-level hoist-dev-utils package includes a dependency on the `@xh/eslint-config` package nested within this 
repository. That package exports an eslint configuration object with ExHI's coding conventions and best practices for 
Hoist React based development. 

Applications can use these rules for their own ESLint config by specifying their `.eslintrc` file as simply:
```
{
  "extends": ["@xh/eslint-config"]
}
```

If required, rules and other settings extended from this base configuration can be overridden at the app level.

### Docker base images

Hoist React apps can be deployed via Docker containers running Tomcat (for Hoist's Grails based back-end) and nginx
(to serve compiled client JS/CSS and other assets). This repo contains the minimal Dockerfiles and associated configs
to build our xh-tomcat and xh-nginx container images, which can then be used as the base for app Docker deployments 
with additional, app specific configurations.

These base images are built via [ExHI's Teamcity](build.xh.io) and stored in our [Nexus repository](repo.xh.io), 
which acts as a private Docker registry.  