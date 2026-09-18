/*
 * This file belongs to Hoist, an application development toolkit
 * developed by Extremely Heavy Industries (www.xh.io | info@xh.io)
 *
 * Copyright © 2026 Extremely Heavy Industries Inc.
 */
'use strict';

/**
 * Bundler-agnostic helpers shared by `configureWebpack()` and `configureRsbuild()`: app / library
 * version resolution, entry-point discovery, CHANGELOG parsing, Blueprint icon stubs, manifest
 * content, and the console banner. Nothing in here touches a bundler API - anything that does
 * belongs in the respective `configure*.js` module.
 */

const _ = require('lodash'),
    path = require('path'),
    fs = require('fs'),
    crypto = require('crypto'),
    parseChangelogMarkdown = require('changelog-parser').parseChangelog,
    devUtilsPkg = require('../package');

// Minimum hoist-react version supported by this release, as 'major[.minor]' - review on each
// new major, and keep in sync with CHANGELOG and hoist-react's docs/version-compatibility.md.
const MIN_HOIST_REACT_VERSION = '87.1';

// Browsers targeted by transpilation and CSS processing unless the app overrides `targetBrowsers`.
const DEFAULT_TARGET_BROWSERS = [
    'last 2 Chrome versions',
    'last 2 Safari versions',
    'last 2 iOS versions',
    'last 2 Edge versions'
];

/**
 * Resolve the consuming app's own copy of a package's package.json, from the app's directory.
 * Required under isolated/symlinked node_modules layouts (e.g. pnpm), where this package cannot
 * resolve undeclared siblings. Returns `{version: 'NOT_FOUND'}` when not resolvable - e.g. when
 * running a config locally to debug via `pnpm link` / `yarn link`.
 */
function resolveAppPackage(name, basePath) {
    try {
        return require(require.resolve(`${name}/package.json`, {paths: [basePath]}));
    } catch (e) {
        return {version: 'NOT_FOUND'};
    }
}

/**
 * Fail fast on an unsupported hoist-react pairing with the actual remedy, rather than letting
 * version drift surface as cryptic downstream build errors. Skipped when hoist-react is not
 * resolvable or is a local inline checkout.
 */
function checkHoistReactVersion(hoistReactPkg, inlineHoist) {
    const [minMajor, minMinor = 0] = MIN_HOIST_REACT_VERSION.split('.').map(Number),
        [hrMajor, hrMinor = 0] = hoistReactPkg.version.split('.').map(Number);
    if (
        !inlineHoist &&
        !isNaN(hrMajor) &&
        (hrMajor < minMajor || (hrMajor === minMajor && hrMinor < minMinor))
    ) {
        throw (
            `hoist-dev-utils v${devUtilsPkg.version} requires hoist-react >= ` +
            `${MIN_HOIST_REACT_VERSION} - found v${hoistReactPkg.version}. Upgrade @xh/hoist, ` +
            `or remain on an earlier dev-utils release.`
        );
    }
}

/**
 * Check for and resolve the standard/expected favicons within the app's /public directory,
 * returning the manifest.json `icons` entries for those found plus an apple-touch-icon flag.
 */
function resolveIcons(publicAssetsPath, favicon, copyPublicAssets) {
    const manifestIcons = [];
    if (copyPublicAssets) {
        logSep();
        logMsg('🎨  Icons:');
        if (fs.existsSync(favicon)) {
            logMsg(`  > ${path.basename(favicon)}`);
        }
        [192, 512].forEach(size => {
            if (fs.existsSync(path.resolve(publicAssetsPath, `favicon-${size}.png`))) {
                manifestIcons.push({
                    src: `/public/favicon-${size}.png`,
                    sizes: `${size}x${size}`,
                    type: 'image/png'
                });
                logMsg(`  > favicon-${size}.png`);
            }
        });
    }
    const appleTouchIconExists =
        copyPublicAssets && fs.existsSync(path.resolve(publicAssetsPath, 'apple-touch-icon.png'));
    if (appleTouchIconExists) logMsg(`  > apple-touch-icon.png`);

    return {manifestIcons, appleTouchIconExists};
}

/**
 * Parse the app's CHANGELOG.md and write it as JSON under node_modules/.xhtmp, if requested.
 * Always writes a file - either the parsed changelog or an empty object if disabled or parsing
 * fails - so callers can unconditionally alias the synthetic `@xh/app-changelog.json` import
 * consumed by `XH.changelogService` to the returned path.
 */
async function writeChangelogJson(basePath, parseChangelog) {
    const tmpPath = path.resolve(basePath, 'node_modules', '.xhtmp'),
        clDestPath = path.resolve(tmpPath, 'changelog.json');
    if (!fs.existsSync(tmpPath)) fs.mkdirSync(tmpPath);
    let clDestUpdated = false;
    if (parseChangelog) {
        logSep();
        logMsg('📜  Changelog:');
        const clSrcPath = path.resolve(basePath, '..', 'CHANGELOG.md');
        if (!fs.existsSync(clSrcPath)) {
            logMsg('  > CHANGELOG.md not found');
        } else {
            try {
                const clJson = await parseChangelogMarkdown(clSrcPath),
                    versions = clJson.versions,
                    latestVer = versions.length > 0 ? versions[0].version : null;
                fs.writeFileSync(clDestPath, JSON.stringify(clJson));
                clDestUpdated = true;
                logMsg(`  > Parsed: ${versions.length} versions`);
                logMsg(`  > Latest: ${latestVer || '???'}`);
            } catch (e) {
                logMsg(`  > ERROR - exception parsing CHANGELOG.md: ${e}`);
            }
        }
    }
    if (!clDestUpdated) fs.writeFileSync(clDestPath, '{}');
    return clDestPath;
}

/**
 * TS-only support: fail fast with a clear error if the app (or any custom package it asks us to
 * transpile) still contains .jsx source. Without this check, .jsx files surface as cryptic
 * module-resolution or parse errors.
 */
function checkNoJsxFiles(roots) {
    const jsxFiles = roots
        .filter(root => fs.existsSync(root))
        .flatMap(root =>
            findJsxFiles(root).map(f => path.join(path.basename(root), path.relative(root, f)))
        );
    if (jsxFiles.length) {
        throw (
            `Found .jsx file(s) - not supported by hoist-dev-utils v15+, which builds TypeScript ` +
            `apps only, with JSX carried by .tsx files. Rename to .tsx to proceed:\n` +
            jsxFiles.map(f => `  > ${f}`).join('\n')
        );
    }
}

/** Resolve app entry points - one for each file within src/apps/. */
function discoverClientApps(srcPath) {
    const appDirPath = path.resolve(srcPath, 'apps');
    return fs
        .readdirSync(appDirPath)
        .filter(f => f.endsWith('.js') || f.endsWith('.ts'))
        .map(f => ({
            name: f.replace('.js', '').replace('.ts', ''),
            path: path.resolve(appDirPath, f)
        }));
}

/**
 * Content for a client-app-specific manifest.json. The icon choices here work with the favicon
 * provided to the HTML plugin to match the spec here:
 * https://evilmartians.com/chronicles/how-to-favicon-in-2021-six-files-that-fit-most-needs
 *
 * Default start_url to the clientApp's root, to bring user back to the clientApp from which they
 * added the bookmark without any need for redirects, respecting possible override.
 */
function manifestContent(
    clientAppName,
    {appName, appVersion, preloadBackgroundColor, icons},
    overrides
) {
    return {
        name: appName,
        short_name: appName,
        description: `${appName} - ${appVersion}`,
        display: 'standalone',
        orientation: 'any',
        background_color: preloadBackgroundColor, // ignored by Safari, but also used within index.html
        theme_color: '#212121', // off-black from default `--xh-black` CSS var
        icons,
        start_url: `/${clientAppName}/`,
        ...overrides
    };
}

/**
 * Short content hash of a file, or null if it does not exist. Used to cache-bust static assets
 * copied into the build unbundled (e.g. hoist-react's preflight.js) from index.html.
 */
function fileHash(p) {
    try {
        return crypto.createHash('md5').update(fs.readFileSync(p)).digest('hex').slice(0, 8);
    } catch (e) {
        return null;
    }
}

//------------------------------------------------------------------------------------
// Blueprint icons
//------------------------------------------------------------------------------------
// Icons required by the Blueprint components used within Hoist React - the per-icon React
// components imported internally by @blueprintjs/core, @blueprintjs/datetime, and
// @blueprintjs/select (a transitive dep of datetime), plus the string-name icons those packages
// render via `<Icon icon="..."/>`. PascalCase, per the @blueprintjs/icons naming convention.
const requiredBlueprintIcons = [
    'ArrowDown',
    'ArrowLeft',
    'ArrowRight',
    'ArrowUp',
    'CaretDown',
    'CaretRight',
    'ChevronDown',
    'ChevronLeft',
    'ChevronRight',
    'ChevronUp',
    'Cross',
    'DoubleCaretVertical',
    'Error',
    'InfoSign',
    'KeyCommand',
    'KeyControl',
    'KeyDelete',
    'KeyEnter',
    'KeyOption',
    'KeyShift',
    'Search',
    'SmallCross',
    'SmallTick',
    'Square',
    'Tick',
    'WarningSign'
];

// Resolved-path patterns for the three @blueprintjs/icons modules the stubs replace.
const blueprintIconModulePatterns = {
    entry: /@blueprintjs[\\/]icons[\\/]lib[\\/]esm[\\/]generated[\\/]index\.js$/,
    paths16:
        /@blueprintjs[\\/]icons[\\/]lib[\\/]esm[\\/]generated[\\/]16px[\\/]paths[\\/]index\.js$/,
    paths20:
        /@blueprintjs[\\/]icons[\\/]lib[\\/]esm[\\/]generated[\\/]20px[\\/]paths[\\/]index\.js$/
};

/**
 * Generate stub modules that re-export only the Blueprint icons required by Hoist React
 * components. Swapped in via NormalModuleReplacementPlugin for:
 *
 *   1) The @blueprintjs/icons package entry point (`lib/esm/generated/index.js`), which
 *      statically re-exports all ~700 per-icon React components.
 *   2) The 16px and 20px icon path barrels (`lib/esm/generated/{16px,20px}/paths/index.js`),
 *      statically imported by the entry point via its `allPaths` re-export and dynamically
 *      imported by the package's lazy path loaders.
 *
 * Without these stubs, the entire icon set (~2.4MB pre-minification) lands in the initial
 * bundle of every app. Blueprint marks its JS side-effect-free, but our configs disable
 * `sideEffects`-based module pruning (see hoist-react #4640), so the unused re-exports ride the
 * static import graph into the bundle.
 *
 * Stubs are generated at build time with absolute-path imports resolved against the app's own
 * copy of @blueprintjs/icons, so they remain correct across package managers (including pnpm's
 * isolated layout, where this package cannot resolve undeclared siblings) and across icon
 * package versions. Any Blueprint component importing an icon outside the whitelist will fail
 * the build loudly (strict export presence) - extend the list above, or have the app opt out
 * via `env.loadAllBlueprintJsIcons`.
 */
const generateBlueprintIconStubs = (basePath, hoistPath) => {
    const iconsPath = resolveBlueprintIconsPath(basePath, hoistPath);
    if (!iconsPath) {
        logMsg('⚠️  Could not resolve @blueprintjs/icons - Blueprint icon stubs disabled.');
        return null;
    }

    // Forward slashes in import specifiers, valid on all platforms.
    const esmPath = p => path.join(iconsPath, 'lib/esm', p).split(path.sep).join('/'),
        outDir = path.join(basePath, 'node_modules', '.cache', 'hoist-dev-utils'),
        writeStub = (filename, lines) => {
            const ret = path.join(outDir, filename);
            fs.writeFileSync(ret, lines.join('\n') + '\n');
            return ret;
        };

    fs.mkdirSync(outDir, {recursive: true});

    const componentExports = requiredBlueprintIcons.map(it => {
            const mod = esmPath(`generated/components/${_.kebabCase(it)}.js`);
            return `export {${it}Icon, ${it}} from '${mod}';`;
        }),
        pathExports = size =>
            requiredBlueprintIcons.map(it => {
                const mod = esmPath(`generated/${size}/paths/${_.kebabCase(it)}.js`);
                return `export {default as ${it}} from '${mod}';`;
            });

    return {
        entry: writeStub('bpIconsEntryStub.mjs', [
            `export * from '${esmPath('index.js')}';`,
            ...componentExports
        ]),
        paths16: writeStub('bpIconsPaths16Stub.mjs', pathExports('16px')),
        paths20: writeStub('bpIconsPaths20Stub.mjs', pathExports('20px'))
    };
};

/**
 * Locate the app's effective copy of @blueprintjs/icons. Tried first from the app root, which
 * works for flat layouts and under `pnpm run` / `pnpm exec` (pnpm points NODE_PATH at its hidden
 * hoist directory) - then, since the app does not itself depend on the icons, by walking the real
 * dependency chain: hoist-react -> @blueprintjs/core -> @blueprintjs/icons. The latter holds under
 * any layout and invocation, including a bundler CLI launched directly rather than via pnpm.
 */
function resolveBlueprintIconsPath(basePath, hoistPath) {
    const resolveDir = (name, from) => {
        try {
            return path.dirname(require.resolve(`${name}/package.json`, {paths: [from]}));
        } catch (e) {
            return null;
        }
    };
    const direct = resolveDir('@blueprintjs/icons', basePath);
    if (direct) return direct;
    const core = hoistPath && resolveDir('@blueprintjs/core', hoistPath);
    return core ? resolveDir('@blueprintjs/icons', core) : null;
}

//------------------------------------------------------------------------------------
// Misc utils
//------------------------------------------------------------------------------------
// Recursively find .jsx files under a directory, skipping symlinks (which can cycle, or lead
// into package-manager stores) and nested node_modules (not the scanned package's own source).
function findJsxFiles(dir) {
    return fs.readdirSync(dir, {withFileTypes: true}).flatMap(e => {
        if (e.isSymbolicLink() || e.name === 'node_modules') return [];
        const p = path.join(dir, e.name);
        if (e.isDirectory()) return findJsxFiles(p);
        return e.isFile() && e.name.endsWith('.jsx') ? [p] : [];
    });
}

// Resolve any symlinks to a real path, falling back to the given path if it does not (yet)
// exist. No-op for flat/hoisted node_modules layouts. Required so that paths used within
// loader include/exclude rules match the real module paths produced by the bundler's default
// resolve.symlinks behavior under symlinking package managers (e.g. pnpm).
function safeRealpath(p) {
    try {
        return fs.realpathSync(p);
    } catch (e) {
        return p;
    }
}

// Normalize a boolean-ish env param. Params supplied via the CLI as `--env foo=false` arrive as
// the *string* 'false', which a bare truthiness check would read as enabled. (A bare `--env foo`
// does arrive as a real boolean, which is why simple `=== true` checks work elsewhere.) Any other
// value - notably a config object - is passed through untouched.
function parseFlag(val, dflt) {
    if (val === undefined) return dflt;
    if (val === 'true') return true;
    if (val === 'false') return false;
    return val;
}

/**
 * Every `env` option either config understands - the union of both configs' documented options, so
 * an app can share one options object across `configureWebpack()` and `configureRsbuild()` without
 * each warning about the other's keys. Keep in step with the JSDoc in both config files.
 */
const KNOWN_OPTIONS = [
    // App identity + build mode
    'appCode',
    'appName',
    'appVersion',
    'appBuild',
    'prodBuild',
    'inlineHoist',
    'reactProdMode',
    'analyzeBundles',
    'sourceMaps',
    'targetBrowsers',
    'minify',
    'buildCache',
    'logLevel',
    'stats',
    'infrastructureLoggingLevel',
    // Transpiler / minifier options
    'babelIncludePaths',
    'babelExcludePaths',
    'babelPresetEnvOptions',
    'terserOptions',
    'swcOptions',
    'minifyOptions',
    'decoratorTransform',
    'resolveAliases',
    'extraModuleRules',
    'loadAllBlueprintJsIcons',
    // Output
    'contextRoot',
    'baseUrl',
    'copyPublicAssets',
    'parseChangelog',
    'precompressAssets',
    'favicon',
    'manifestConfig',
    'preloadBackgroundColor',
    'preloadSpinnerColor',
    // Dev server
    'devClientOverlay',
    'devHost',
    'devGrailsPort',
    'devWebpackPort',
    'devServerOpenPage',
    'devHttps',
    'devLiveReload',
    'devServerOptions'
];

/**
 * Warn about `env` keys neither config recognizes. A misspelled or long-removed option is otherwise
 * ignored without a trace - one app carried a dead option for months this way. A warning rather than
 * an error: the build is not wrong, the developer just has not been told.
 */
function warnUnknownOptions(env) {
    const unknown = Object.keys(env).filter(key => !KNOWN_OPTIONS.includes(key));
    if (!unknown.length) return;
    logMsg(
        '⚠️  Unrecognized options - ignored (check for typos or options removed in a prior release):'
    );
    unknown.forEach(key => logMsg(`  > ${key}`));
    logSep();
}

function logSep() {
    console.log(':------------------------------------');
}

function logMsg(msg) {
    console.log(`: ${msg}`);
}

module.exports = {
    MIN_HOIST_REACT_VERSION,
    DEFAULT_TARGET_BROWSERS,
    devUtilsPkg,
    resolveAppPackage,
    checkHoistReactVersion,
    resolveIcons,
    writeChangelogJson,
    checkNoJsxFiles,
    discoverClientApps,
    manifestContent,
    fileHash,
    requiredBlueprintIcons,
    blueprintIconModulePatterns,
    resolveBlueprintIconsPath,
    generateBlueprintIconStubs,
    findJsxFiles,
    safeRealpath,
    parseFlag,
    warnUnknownOptions,
    logSep,
    logMsg
};
