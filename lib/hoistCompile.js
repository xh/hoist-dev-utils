/*
 * This file belongs to Hoist, an application development toolkit
 * developed by Extremely Heavy Industries (www.xh.io | info@xh.io)
 *
 * Copyright © 2026 Extremely Heavy Industries Inc.
 */
'use strict';

/**
 * Compile settings shared by `configureRsbuild()` and `configureVitest()`, so an app's unit tests
 * compile exactly as its build does. Pure values and helpers only - nothing in here may touch a
 * bundler API, the same rule `lib/common.js` follows.
 */

const _ = require('lodash'),
    fs = require('fs'),
    path = require('path'),
    {safeRealpath} = require('./common');

/**
 * Hoist's SWC settings - the one source for builds and tests. TC39 Stage 3 (`2023-11`) decorators
 * with [[Define]] class fields are what hoist-react >= 88 is written against. Pointed back at
 * `legacy`, every `@observable` and `@bindable` silently stops working, with no build error.
 */
const HOIST_SWC = Object.freeze({
    decoratorVersion: '2023-11',
    useDefineForClassFields: true,
    reactRuntime: 'automatic'
});

/** SWC `jsc.transform` options for `HOIST_SWC`. Returns a new object, safe to merge into. */
function hoistSwcTransform() {
    return {
        decoratorVersion: HOIST_SWC.decoratorVersion,
        useDefineForClassFields: HOIST_SWC.useDefineForClassFields,
        react: {runtime: HOIST_SWC.reactRuntime}
    };
}

/**
 * SWC minifier options for production builds, before any `minifyOptions` from the app. Mangling
 * renames locals for smaller bundles. Class names must be kept: Hoist installs and looks up
 * services, and matches model selectors, by class name. Function names are kept for readable
 * errors and stack traces in deployed builds. Returns a new object, safe to merge into.
 *
 * Two Rspack releases mangle wrongly with these options: see `BLOCKED_RSPACK_VERSIONS` in
 * `lib/common.js`. `test/minify.test.js` runs both bugs against the installed Rspack.
 */
function hoistMinifyOptions() {
    return {
        compress: {keep_classnames: true, keep_fnames: true},
        mangle: {keep_classnames: true, keep_fnames: true}
    };
}

/** App identity from `env`, with the `configureRsbuild()` defaults. `appCode` is required. */
function resolveAppIdentity(env) {
    const {appCode} = env;
    if (!appCode) throw 'Missing required "appCode" config - cannot proceed';
    return {
        appCode,
        appName: env.appName || _.startCase(appCode),
        appVersion: env.appVersion || '1.0-SNAPSHOT',
        appBuild: env.appBuild || 'UNKNOWN',
        baseUrl: env.baseUrl || '/api/'
    };
}

/**
 * The `xh*` constants read by hoist-react's `core/XH.ts`, as code strings for the `define` option
 * of both Rspack and Vite. Every value goes through `JSON.stringify()` - Vitest makes a global of a
 * key with no dot only when its value parses as JSON.
 */
function xhDefines({
    appCode,
    appName,
    appVersion,
    appBuild,
    baseUrl,
    buildTimestamp,
    clientApps,
    isDevelopmentMode
}) {
    return _.mapValues(
        {
            xhAppCode: appCode,
            xhAppName: appName,
            xhAppVersion: appVersion,
            xhAppBuild: appBuild,
            xhBaseUrl: baseUrl,
            xhBuildTimestamp: buildTimestamp,
            xhClientApps: clientApps,
            xhIsDevelopmentMode: isDevelopmentMode
        },
        v => JSON.stringify(v)
    );
}

/**
 * Packages that must be one instance when Hoist is a sibling checkout - the app's copy wins. React
 * hooks throw when the hook's React differs from the one that renders the component (always
 * hoist-react's, with element factories). ag-Grid's `useGridMenuItem` hook has the same need.
 */
const INLINE_HOIST_SINGLETONS = Object.freeze([
    'react',
    'react-dom',
    'ag-grid-react',
    'ag-grid-community'
]);

/**
 * The environment variable that points inline mode at a specific hoist-react checkout, e.g. a git
 * worktree on a paired feature branch. Must be an absolute path.
 */
const HOIST_REACT_PATH_VAR = 'XH_HOIST_REACT_PATH';

/**
 * Locate hoist-react. In inline mode, this is the checkout named by `XH_HOIST_REACT_PATH`, else a
 * sibling of the app's repo at `../../hoist-react`. Inline mode fails fast unless the path holds a
 * hoist-react checkout. Otherwise, this is the installed package. Symlinks are resolved (a no-op for
 * flat layouts) so the path matches the real module paths bundlers produce, as include rules need
 * under pnpm.
 */
function resolveHoistPath(basePath, inlineHoist, processEnv = process.env) {
    if (!inlineHoist) return safeRealpath(path.resolve(basePath, 'node_modules/@xh/hoist'));

    const override = processEnv[HOIST_REACT_PATH_VAR];
    if (override && !path.isAbsolute(override)) {
        throw `${HOIST_REACT_PATH_VAR} must be an absolute path - found "${override}".`;
    }

    const hoistPath = safeRealpath(override || path.resolve(basePath, '../../hoist-react'));
    if (readPackageName(hoistPath) !== '@xh/hoist') {
        throw override
            ? `${HOIST_REACT_PATH_VAR} points at ${hoistPath}, which is not a hoist-react checkout.`
            : `Inline Hoist found no hoist-react checkout at ${hoistPath}. Clone hoist-react ` +
                  `there, or set ${HOIST_REACT_PATH_VAR} to the checkout to use.`;
    }
    return hoistPath;
}

function readPackageName(dir) {
    try {
        return JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).name;
    } catch (e) {
        return null;
    }
}

module.exports = {
    HOIST_SWC,
    hoistSwcTransform,
    hoistMinifyOptions,
    resolveAppIdentity,
    xhDefines,
    INLINE_HOIST_SINGLETONS,
    HOIST_REACT_PATH_VAR,
    resolveHoistPath
};
