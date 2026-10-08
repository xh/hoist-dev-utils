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
 * Locate hoist-react - a sibling checkout at `../../hoist-react` in inline mode, otherwise the
 * installed package. Symlinks are resolved (a no-op for flat layouts) so the path matches the real
 * module paths bundlers produce, as include rules need under pnpm.
 */
function resolveHoistPath(basePath, inlineHoist) {
    return safeRealpath(
        inlineHoist
            ? path.resolve(basePath, '../../hoist-react')
            : path.resolve(basePath, 'node_modules/@xh/hoist')
    );
}

module.exports = {
    HOIST_SWC,
    hoistSwcTransform,
    resolveAppIdentity,
    xhDefines,
    INLINE_HOIST_SINGLETONS,
    resolveHoistPath
};
