/*
 * This file belongs to Hoist, an application development toolkit
 * developed by Extremely Heavy Industries (www.xh.io | info@xh.io)
 *
 * Copyright © 2026 Extremely Heavy Industries Inc.
 */
'use strict';

// Imports nothing from vite or vitest - `vitest/config` does not resolve from this package under
// pnpm. The app wraps the returned object with its own `defineConfig()` / `mergeConfig()`.
const _ = require('lodash'),
    path = require('path'),
    fs = require('fs'),
    {rspack, version: rsbuildVersion} = require('@rsbuild/core');

const {
    MIN_HOIST_REACT_TEST_VERSION,
    KNOWN_OPTIONS,
    devUtilsPkg,
    resolveAppPackage,
    isVersionBelow,
    discoverClientApps,
    safeRealpath,
    parseFlag
} = require('./lib/common');

const {
    INLINE_HOIST_SINGLETONS,
    hoistSwcTransform,
    resolveAppIdentity,
    resolveHoistPath,
    xhDefines
} = require('./lib/hoistCompile');

// Options read by configureVitest() alone.
const TEST_OPTIONS = ['root', 'include', 'setupFiles', 'timeZone', 'selfHost'];

// Build options a test run cannot honor - warned, then ignored. Every other build option is
// accepted silently, so an app can pass one `env` object to both configs.
const IGNORED_BUILD_OPTIONS = {extraModuleRules: 'Rspack rules cannot run under Vite'};

// Singletons beyond the build's for inline test runs: the fake server, React Testing Library (which
// hoist-react's setup cleans up) and MobX for apps that import it. Deduped only when the app has
// its own copy.
const INLINE_TEST_SINGLETONS = ['msw', '@testing-library/react', 'mobx'];

// Matches `@xh/hoist` and its subpaths, for the alias to a checkout.
const HOIST_IMPORT = /^@xh\/hoist(?=\/|$)/;

/**
 * Vitest preset for Hoist unit tests. Compiles app and hoist-react code with the SWC inside Rspack
 * and the same settings `configureRsbuild()` builds with, sets the same `XH` constants, and loads
 * hoist-react's test setup (`@xh/hoist/test`). Apps consume it from a `vitest.config.mts`:
 *
 *      import configureVitest from '@xh/hoist-dev-utils/configureVitest';
 *      import {defineConfig} from 'vitest/config';
 *      export default defineConfig(configureVitest({appCode: 'myApp'}));
 *
 * Import it by package name - Vite bundles a relative import of this CommonJS file, which fails.
 * Wrap the result with `mergeConfig()` to add settings. Note that `mergeConfig()` concatenates
 * arrays, so `include` and `setupFiles` are options here. Requires hoist-react >= 89. Run tests
 * against a sibling hoist-react checkout with `XH_INLINE_HOIST=true vitest`.
 *
 * Takes the same `env` object as `configureRsbuild()`. App identity, `baseUrl`, `inlineHoist`,
 * `extraIncludePaths`, `extraExcludePaths`, `resolveAliases` and `swcOptions` apply as in the
 * build. Other build options are ignored - `extraModuleRules` with a warning.
 *
 * @param {Object} env - config passed in from the app's Vitest config.
 * @param {string} env.appCode - as for configureRsbuild(), baked into tests as XH.appCode.
 * @param {string} [env.appName] - as for configureRsbuild(). Defaults from appCode.
 * @param {string} [env.appVersion] - as for configureRsbuild(). Defaults to '1.0-SNAPSHOT'.
 * @param {string} [env.appBuild] - as for configureRsbuild(). Defaults to 'UNKNOWN'.
 * @param {string} [env.baseUrl] - as for configureRsbuild(). Defaults to '/api/', where the fake
 *      hoist-core in `@xh/hoist/test` serves.
 * @param {boolean} [env.inlineHoist=false] - true to test against a sibling hoist-react checkout at
 *      `../../hoist-react`. Also on when the `XH_INLINE_HOIST` environment variable is 'true'.
 * @param {string[]} [env.extraIncludePaths] - custom packages to compile, as in the build.
 * @param {string[]} [env.extraExcludePaths] - paths not to compile, as in the build.
 * @param {Object} [env.resolveAliases] - module aliases, as in the build. A key ending in `$`
 *      matches that exact import only, and a value starting with `.` is relative to the root.
 * @param {Object|Function} [env.swcOptions] - SWC overrides, as in the build - an object to
 *      deep-merge, or a function receiving the options. Any `env` (preset-env) key is dropped, as
 *      SWC rejects it alongside `jsc.target`.
 * @param {string} [env.root] - project root. Defaults to the current directory.
 * @param {string[]} [env.include] - spec globs. Defaults to `['src/**\/*.spec.{ts,tsx}']`.
 * @param {string[]} [env.setupFiles] - app setup files, run after hoist-react's `test/setup.ts`.
 * @param {?string} [env.timeZone='America/New_York'] - time zone for the run, set as `TZ`. Pass
 *      null to keep the machine's zone.
 * @param {boolean} [env.selfHost=false] - true only for hoist-react's own config. Aliases
 *      `@xh/hoist` to the root and loads its `test/setup.ts`.
 * @returns {Object} a Vite + Vitest config object.
 */
function configureVitest(env = {}) {
    try {
        return createConfig(env);
    } catch (e) {
        // The shared helpers throw strings, as the build expects. Vite's config loader cannot
        // report one - it fails with "Invalid value used in weak set" and the message is lost.
        throw _.isError(e) ? e : new Error(e);
    }
}

function createConfig(env) {
    const identity = resolveAppIdentity(env),
        selfHost = parseFlag(env.selfHost, false) === true,
        inlineHoist =
            !selfHost &&
            (parseFlag(env.inlineHoist, false) === true || process.env.XH_INLINE_HOIST === 'true'),
        root = safeRealpath(path.resolve(env.root ?? process.cwd())),
        hoistPath = selfHost ? root : resolveHoistPath(root, inlineHoist),
        toRealPath = p => safeRealpath(path.resolve(root, p)),
        extraIncludePaths = (env.extraIncludePaths || env.babelIncludePaths || []).map(toRealPath),
        extraExcludePaths = (env.extraExcludePaths || env.babelExcludePaths || []).map(toRealPath),
        include = env.include ?? ['src/**/*.spec.{ts,tsx}'],
        setupFiles = _.castArray(env.setupFiles ?? []),
        timeZone = env.timeZone === undefined ? 'America/New_York' : env.timeZone,
        hoistSetup = path.join(hoistPath, 'test/setup.ts');

    checkSwcApi();
    if (!fs.existsSync(hoistSetup)) {
        throw new Error(missingTestKitMessage({root, hoistPath, selfHost, inlineHoist}));
    }
    // Packaged mode only - a checkout or hoist-react itself may be mid-way through a vitest bump.
    if (!selfHost && !inlineHoist) checkVitestMajor(root, hoistPath);
    warnIgnoredOptions(env);

    // Set in the main process, so test workers inherit them. `@xh/hoist/test` checks the preset
    // version against its own minimum.
    if (timeZone != null) process.env.TZ = timeZone;
    process.env.XH_VITEST_PRESET_VERSION = devUtilsPkg.version;

    // Inline mode: dedupe singletons the app has its own copy of (listing one it lacks breaks the
    // Node hook), and pass the hook its settings through a private variable. Reusing
    // XH_INLINE_HOIST would leave inline mode on for the rest of a watch session.
    const inlineSingletons = inlineHoist
        ? [...INLINE_HOIST_SINGLETONS, ...INLINE_TEST_SINGLETONS].filter(it =>
              fs.existsSync(path.join(root, 'node_modules', it, 'package.json'))
          )
        : [];
    if (inlineHoist) {
        process.env.XH_VITEST_INLINE_HOIST_CFG = JSON.stringify({
            appRoot: root,
            hoistNodeModules: path.join(hoistPath, 'node_modules'),
            singletons: inlineSingletons
        });
    } else {
        delete process.env.XH_VITEST_INLINE_HOIST_CFG;
    }

    return {
        root,
        plugins: [
            xhSwcPlugin({
                // In selfHost, hoist-react is the root - its source already sits outside
                // node_modules, and listing the root would also compile its dependencies' JS.
                includePaths: selfHost ? extraIncludePaths : [hoistPath, ...extraIncludePaths],
                // As in the build, inline mode skips the checkout's own node_modules.
                excludePaths: inlineHoist
                    ? [path.join(hoistPath, 'node_modules'), ...extraExcludePaths]
                    : extraExcludePaths,
                swcOptions: env.swcOptions || {}
            }),
            xhAppChangelogPlugin(),
            xhSkipStylesPlugin(),
            xhMarkdownPlugin(),
            xhGuardsPlugin()
        ],

        // xh-swc owns the TS transform - Vite's Oxc cannot compile 2023-11 decorators.
        oxc: false,

        define: xhDefines({
            ...identity,
            buildTimestamp: 0,
            clientApps: findClientApps(root),
            isDevelopmentMode: false
        }),

        resolve: {
            alias: [
                ...toViteAliases(env.resolveAliases, root),
                ...(selfHost || inlineHoist ? [{find: HOIST_IMPORT, replacement: hoistPath}] : [])
            ],
            dedupe: inlineSingletons,
            // Vitest externalizes JS in `"type": "module"` packages, so Node would load an opt-in
            // package natively and skip SWC. Absolute paths must be RegExps - strings match names.
            noExternal: extraIncludePaths.map(p => new RegExp('^' + _.escapeRegExp(dirPrefix(p))))
        },

        // Vite serves files outside root only from allowed dirs. Setting this replaces the default,
        // so root is listed again. This package's dir holds the inline-mode setup file.
        server: inlineHoist ? {fs: {allow: [root, hoistPath, __dirname]}} : {},

        // The settings the test kit's isolation contract needs. No `exclude` or `reporters`, so an
        // app's values set through mergeConfig() win.
        test: {
            environment: 'jsdom',
            // The Vitest default, set explicitly so Vitest stops suggesting `isolate: false`,
            // which xh-guards rejects.
            isolate: true,
            include,
            setupFiles: [
                ...(inlineHoist ? [path.join(__dirname, 'lib/vitestInlineHoist.mjs')] : []),
                hoistSetup,
                ...setupFiles
            ],
            // Allow for initTestAppAsync() in beforeAll, which loads the full desktop module graph.
            hookTimeout: 30_000,
            // Show console output only for failing tests - Hoist logs freely.
            silent: 'passed-only',
            restoreMocks: true,
            unstubEnvs: true,
            unstubGlobals: true
        }
    };
}

//------------------------
// Plugins
//------------------------
/**
 * Compile with the SWC inside Rspack - the compiler, version and settings `configureRsbuild()`
 * builds with. File selection mirrors Rsbuild's JS rule: any script outside node_modules, TS, TSX,
 * JSX, MTS and CTS anywhere, and JS under `includePaths` (hoist-react and `extraIncludePaths`),
 * minus `excludePaths`. Vite ids are real paths in posix form, so roots are compared that way.
 */
function xhSwcPlugin({includePaths, excludePaths, swcOptions}) {
    const SCRIPT = /\.(?:[cm]?[jt]s|[jt]sx)$/,
        ALWAYS = /\.(?:ts|tsx|jsx|mts|cts)$/,
        TS = /\.(?:[cm]?ts|tsx)$/,
        DECLARATION = /\.d\.[cm]?ts$/,
        includeRoots = includePaths.map(dirPrefix),
        excludeRoots = excludePaths.map(dirPrefix);

    const shouldCompile = file => {
        if (!SCRIPT.test(file) || DECLARATION.test(file)) return false;
        if (excludeRoots.some(it => file.startsWith(it))) return false;
        return (
            !file.includes('/node_modules/') ||
            ALWAYS.test(file) ||
            includeRoots.some(it => file.startsWith(it))
        );
    };

    const optionsFor = file => {
        const options = {
            filename: file,
            sourceMaps: true,
            swcrc: false,
            configFile: false,
            // Rsbuild's base settings, so `swcOptions` sees the shape it gets in the build - a
            // function that sets `env.mode` or `jsc.experimental.plugins` must not throw.
            isModule: 'unknown',
            env: {},
            jsc: {
                experimental: {keepImportAttributes: true},
                target: 'es2022',
                parser: TS.test(file)
                    ? {syntax: 'typescript', tsx: file.endsWith('x'), decorators: true}
                    : // `accessor` fields in JS need the explicit parser flag.
                      {
                          syntax: 'ecmascript',
                          jsx: file.endsWith('x'),
                          decorators: true,
                          autoAccessors: true
                      },
                transform: hoistSwcTransform()
            }
        };
        const ret = _.isFunction(swcOptions)
            ? (swcOptions(options) ?? options)
            : _.merge(options, swcOptions);
        // SWC rejects `env` alongside `jsc.target`. The build's preset-env serves browsers only.
        delete ret.env;
        return ret;
    };

    return {
        name: 'xh-swc',
        enforce: 'pre',
        async transform(code, id) {
            if (id.startsWith('\0')) return null;
            const [file, query] = id.split('?');
            if (/(?:^|&)(?:raw|url)(?:&|=|$)/.test(query ?? '') || !shouldCompile(file)) {
                return null;
            }
            const out = await rspack.experiments.swc.transform(code, optionsFor(file));
            return {code: out.code, map: out.map ? JSON.parse(out.map) : null};
        }
    };
}

/** Stand in for the changelog JSON that configureRsbuild() generates. */
function xhAppChangelogPlugin() {
    const ID = '\0xh-app-changelog';
    return {
        name: 'xh-app-changelog',
        resolveId: source => (source === '@xh/app-changelog.json' ? ID : null),
        load: id => (id === ID ? 'export default {};' : null)
    };
}

/**
 * Skip stylesheets - tests do not render styles. A style import resolves to an empty virtual
 * module, so Vite's CSS plugin never sees a `.scss` id and apps need no Sass compiler. `?inline`,
 * `?raw` and `?url` give an empty string, as Vitest does for CSS it skips. The build gives CSS text
 * or a URL for those.
 */
function xhSkipStylesPlugin() {
    const STYLE = /\.s?css(?:\?|$)/,
        ID = '\0xh-skip-style',
        STRING_ID = '\0xh-skip-style-string';
    return {
        name: 'xh-skip-styles',
        enforce: 'pre',
        resolveId(source) {
            if (!STYLE.test(source)) return null;
            const params = new URLSearchParams(source.split('?')[1]);
            return ['inline', 'raw', 'url'].some(it => params.has(it)) ? STRING_ID : ID;
        },
        load(id) {
            if (id === ID) return 'export default {};';
            if (id === STRING_ID) return "export default '';";
            return null;
        }
    };
}

/** A bare `.md` import gives the raw text, as in the build. `?url` and `?raw` fall to Vite. */
function xhMarkdownPlugin() {
    return {
        name: 'xh-markdown',
        enforce: 'pre',
        load(id) {
            if (id.startsWith('\0')) return null;
            const [file, query] = id.split('?');
            if (!file.endsWith('.md') || query) return null;
            return `export default ${JSON.stringify(fs.readFileSync(file, 'utf8'))};`;
        }
    };
}

/**
 * Fail the run when test files are not isolated. Each file boots its own `XH` and fake hoist-core,
 * and module state shared across files would leak between them.
 */
function xhGuardsPlugin() {
    return {
        name: 'xh-guards',
        // A named function, so a stack trace does not read as the configureVitest() factory.
        configureVitest: function checkIsolation({project}) {
            const {isolate, pool} = project.config;
            if (isolate !== false) return;
            // Vitest turns isolation off for its vm pools, whatever the isolate setting says.
            const remedy = ['vmThreads', 'vmForks'].includes(pool)
                ? `The \`${pool}\` pool runs without it - use the \`forks\` or \`threads\` pool.`
                : 'Remove `--no-isolate` or `isolate: false`.';
            throw new Error(
                'Hoist unit tests need `isolate: true` (the Vitest default) - each test file ' +
                    `boots its own XH and fake hoist-core. ${remedy}`
            );
        }
    };
}

//------------------------
// Checks
//------------------------
// The SWC API sits under Rspack's `experiments`, with no semver promise.
function checkSwcApi() {
    if (_.isFunction(rspack?.experiments?.swc?.transform)) return;
    throw new Error(
        `configureVitest() compiles with rspack.experiments.swc.transform, which is missing from ` +
            `@rspack/core v${rspack?.rspackVersion} (via @rsbuild/core v${rsbuildVersion}). ` +
            `hoist-dev-utils v${devUtilsPkg.version} expects @rsbuild/core ` +
            `${devUtilsPkg.dependencies['@rsbuild/core']} - reinstall to restore it.`
    );
}

// The kit is found by path, so explain why it is missing in terms of the version installed.
function missingTestKitMessage({root, hoistPath, selfHost, inlineHoist}) {
    const MIN = MIN_HOIST_REACT_TEST_VERSION;
    if (selfHost) {
        return (
            `configureVitest() found no test/setup.ts in ${hoistPath} - selfHost is for ` +
            `hoist-react's own config.`
        );
    }
    if (inlineHoist) {
        return (
            `Inline hoist-react at ${hoistPath} has no test/setup.ts - pull a hoist-react that ` +
            `has the unit test kit.`
        );
    }

    const {version} = resolveAppPackage('@xh/hoist', root);
    if (version === 'NOT_FOUND') {
        return `configureVitest() found no @xh/hoist in ${root} - install @xh/hoist >= ${MIN}.`;
    }
    if (isVersionBelow(version, MIN)) {
        return (
            `configureVitest() needs hoist-react >= ${MIN} - found v${version}. Upgrade ` +
            `@xh/hoist to run unit tests. Builds still work with this version.`
        );
    }
    return version.includes('SNAPSHOT')
        ? `@xh/hoist v${version} has no test/setup.ts - it predates the unit test kit. Update ` +
              `to a newer snapshot.`
        : `@xh/hoist v${version} has no test/setup.ts - the installed package is missing its ` +
              `unit test kit.`;
}

// Compare majors with the vitest peer range hoist-react declares, when it declares one. A
// major-only compare needs no semver package.
function checkVitestMajor(root, hoistPath) {
    const hoistPkg = readPackageJson(hoistPath),
        range = hoistPkg?.peerDependencies?.vitest,
        vitestVersion = resolveAppPackage('vitest', root).version,
        found = parseInt(vitestVersion);
    if (!range || isNaN(found)) return;

    if (!range.split('||').some(it => majorSatisfies(found, it))) {
        throw new Error(
            `@xh/hoist v${hoistPkg.version} supports vitest ${range} - found vitest ` +
                `v${vitestVersion}. Install a vitest major that @xh/hoist supports.`
        );
    }
}

function warnIgnoredOptions(env) {
    _.forEach(IGNORED_BUILD_OPTIONS, (reason, key) => {
        if (!_.isEmpty(env[key])) warn(`configureVitest() ignores "${key}" - ${reason}.`);
    });
    const unknown = Object.keys(env).filter(
        key => !KNOWN_OPTIONS.includes(key) && !TEST_OPTIONS.includes(key)
    );
    if (unknown.length) {
        warn(`configureVitest() ignores unknown options (check for typos): ${unknown.join(', ')}`);
    }
}

//------------------------
// Helpers
//------------------------
// Client apps from src/apps, as in the build - or the single default 'app' when there is none.
function findClientApps(root) {
    const srcPath = path.join(root, 'src');
    return fs.existsSync(path.join(srcPath, 'apps'))
        ? discoverClientApps(srcPath).map(it => it.name)
        : ['app'];
}

// Rspack-style aliases as a Vite alias array. Rspack matches a key and its subpaths, as Vite does
// for a string - except a key ending in `$`, which matches that exact import only. A value starting
// with `.` is relative to the root, as Rsbuild resolves it - Vite would take it per importer.
function toViteAliases(resolveAliases, root) {
    return _.compact(
        _.map(resolveAliases, (value, key) => {
            if (!_.isString(value)) {
                warn(`configureVitest() ignores alias "${key}" - Vite takes a path string only.`);
                return null;
            }
            const replacement = value.startsWith('.') ? path.resolve(root, value) : value;
            return key.endsWith('$')
                ? {find: new RegExp(`^${_.escapeRegExp(key.slice(0, -1))}$`), replacement}
                : {find: key, replacement};
        })
    );
}

// A directory path in posix form with a trailing slash, for prefix matches against Vite ids.
function dirPrefix(p) {
    return p.split(path.sep).join('/').replace(/\/?$/, '/');
}

// True if a major version satisfies one `||` alternative of a semver range, by majors alone. A
// `>=` or `>` alternative takes its major and up, any other its first major (`^5.0.3`, `~5.1`,
// `5.x`), and one with no number (`*`) any major. Upper bounds and hyphen ranges are not read.
function majorSatisfies(major, alternative) {
    const min = alternative.match(/\d+/)?.[0];
    if (min == null) return true;
    return /^\s*>/.test(alternative) ? major >= Number(min) : major === Number(min);
}

function readPackageJson(dir) {
    try {
        return JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    } catch (e) {
        return null;
    }
}

function warn(msg) {
    console.warn(`⚠️  ${msg}`);
}

module.exports = configureVitest;
module.exports.configureVitest = configureVitest;
