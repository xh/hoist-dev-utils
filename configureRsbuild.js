/*
 * This file belongs to Hoist, an application development toolkit
 * developed by Extremely Heavy Industries (www.xh.io | info@xh.io)
 *
 * Copyright © 2026 Extremely Heavy Industries Inc.
 */
'use strict';

const _ = require('lodash'),
    path = require('path'),
    fs = require('fs'),
    zlib = require('zlib'),
    {rspack, version: rsbuildVersion} = require('@rsbuild/core'),
    {pluginReact} = require('@rsbuild/plugin-react'),
    {pluginSass} = require('@rsbuild/plugin-sass'),
    HoistManifestPlugin = require('./lib/HoistManifestPlugin'),
    HoistCompressionPlugin = require('./lib/HoistCompressionPlugin'),
    basePath = fs.realpathSync(process.cwd());

const {
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
    blueprintIconModulePatterns,
    generateBlueprintIconStubs,
    safeRealpath,
    parseFlag,
    warnUnknownOptions,
    logSep,
    logMsg
} = require('./lib/common');

// These are not deps of hoist-dev-utils but of the consuming app, so resolve them from the
// app's own directory (basePath).
const hoistReactPkg = resolveAppPackage('@xh/hoist', basePath),
    reactPkg = resolveAppPackage('react', basePath);

/**
 * Consolidated Rsbuild (Rspack + SWC) configuration for both dev-time and production builds of
 * Hoist React web applications. Replaces the webpack-based `configureWebpack()` of v15 and
 * earlier, accepting the same `env` options wherever the concept carries over - see the per-option
 * notes below for the handful that do not. Apps consume it from an `rsbuild.config.mjs`:
 *
 *      import {defineConfig} from '@rsbuild/core';
 *      import configureRsbuild from '@xh/hoist-dev-utils/configureRsbuild';
 *      export default defineConfig(({envMode}) => configureRsbuild({appCode: 'myApp', ...}));
 *
 * Sample commands to run configurations produced by this method include:
 *      `rsbuild build --env-mode prod` to trigger a production build
 *      `rsbuild dev --env-mode inlineHoist` to run dev server w/hoist-react in inline mode
 *
 * Note that Rsbuild's CLI has no `--env key=value` flag. Build-time overrides (appVersion, appBuild)
 * flow in as environment variables - see the `{@link readCliEnv}` helper, which maps
 * `XH_APP_VERSION`, `XH_APP_BUILD`, `XH_PROD_BUILD`, `XH_INLINE_HOIST`, etc. onto env options.
 *
 * @param {Object} env - config passed in from the app's rsbuild config.
 * @param {string} env.appCode - short, internal code for the application - baked into client as XH.appCode. Should be
 *      lowercase, dash-separated, and should match the Gradle project name (e.g. portfolio-manager).
 * @param {string} [env.appName] - user-facing display name for the application - baked into client as XH.appName.
 *      Title cased and space-separated. If null, defaulted from appCode (portfolio-manager -> Portfolio Manager).
 * @param {string} [env.appVersion] - client version - baked into client as XH.appVersion
 * @param {string} [env.appBuild] - build/git tag - baked into client as XH.appBuild
 * @param {boolean} [env.prodBuild=false] - true to indicate this is a build (as opposed to run of the dev server)
 * @param {boolean} [env.inlineHoist=false] - true to use a locally checked-out copy of hoist-react
 *      when running the dev server, as opposed to using the downloaded dependency. This allows
 *      hoist-react developers to test plugin changes. Dev-mode only.
 * @param {boolean} [env.reactProdMode=false] - true to use the production build of React
 *      when running the dev server.
 * @param {Object} [env.resolveAliases] - object mapping for custom module resolution.
 *      When inlineHoist=true, a mapping between @xh/hoist and the local path will be added.
 * @param {string} [env.baseUrl] - root path prepended to all relative URLs called via FetchService. Defaults to
 *      `/api/`, a root path that will cause the request to be proxied to the Grails backend at `devHost:devGrailsPort`.
 * @param {string[]} [env.extraIncludePaths] - additional paths to transpile via settings shared with app-level and
 *      @xh/hoist code. Intended for custom packages. Accepted as `babelIncludePaths` for back-compat with v15 and
 *      earlier configs - that alias is deprecated and warns, as nothing here runs Babel any longer.
 * @param {string[]} [env.extraExcludePaths] - paths to exclude from transpiling. An example use would be a local
 *      package with a nested node_modules folder. Accepted as `babelExcludePaths` for back-compat, as above.
 * @param {Object[]} [env.extraModuleRules] - additional Rspack module rules, added ahead of the built-in rules so
 *      they can claim app-specific file types. Any loaders referenced should be declared as devDependencies of the
 *      app itself - under isolated node_modules layouts (e.g. pnpm), loaders not declared by the app will fail to
 *      resolve. Note that, unlike webpack's `oneOf` list, Rspack rules are additive - a rule claiming an extension
 *      already handled by a built-in rule (e.g. `.svg`) must also take care to exclude that built-in handling.
 * @param {string} [env.contextRoot] - root path from which app will be served, used as the base path for static files.
 * @param {boolean} [env.copyPublicAssets=true] - true to copy the /client-app/public contents into the root of the
 *      build. Note that files within this directory will not be processed, named with a hash, etc. Use for static
 *      assets you wish to link to without using an import to run through the bundler's asset modules. Required for
 *      favicons.
 * @param {boolean} [env.parseChangelog=true] - true to parse a `CHANGELOG.md` file in the project root directory into
 *      JSON and make available for import by `XH.changelogService`.
 * @param {string} [env.favicon] - relative path to a primary favicon source image.
 * @param {Object} [env.manifestConfig] - override values for manifest.json file. This controls options related to
 *      adding a mobile app to a device home screen, as well as "installing" an app via Chrome's "create shortcut"
 *      option. See https://developer.mozilla.org/en-US/docs/Web/Manifest for options.
 * @param {string} [env.preloadBackgroundColor] - background color to use for the preloader spinner. Defaults to white.
 * @param {string} [env.preloadSpinnerColor] - stroke color for the preloader spinner SVG. Defaults to a neutral gray (#888).
 * @param {string[]} [env.targetBrowsers] - array of browserslist queries specifying target browsers for JS
 *      transpiling, polyfill selection and CSS prefixing.
 * @param {Object|Function} [env.swcOptions] - overrides for Rspack's `builtin:swc-loader` options, applied on top
 *      of the defaults set here - either an object to deep-merge, or a function receiving the options to mutate.
 *      Replaces `babelPresetEnvOptions`, which has no equivalent and is rejected if passed.
 * @param {Object} [env.minifyOptions] - options to deep-merge onto the defaults passed here to the SWC minimizer
 *      for production builds (`compress`, `mangle`, `format` - the same shape as Terser's). Replaces
 *      `terserOptions`, which is rejected if passed to avoid silently dropping Terser-specific settings.
 * @param {(boolean|Object)} [env.precompressAssets=true] - control build-time generation of pre-compressed `.br`
 *      and `.gz` copies of bundled assets, for direct serving by nginx via `brotli_static` / `gzip_static`. Set
 *      to `false` to disable, or provide an object to override the defaults passed to the compression plugin:
 *      `test`, `include`, `exclude` (asset-name matchers), `threshold` (bytes) and `minRatio`. The algorithms,
 *      output names and compression levels are managed here, and the original uncompressed assets are always
 *      retained. Production builds only.
 * @param {(boolean|string)} [env.sourceMaps=true] - control sourceMap generation. Set to `true` to enable defaults
 *      specific to dev vs. prod builds, `false` to disable source maps entirely, special string `'devOnly'` to enable
 *      default for dev and disable in prod, or any other valid Rspack `devtool` string to specify a mode directly.
 * @param {boolean} [env.loadAllBlueprintJsIcons=false] - false to only load the BlueprintJs icons required by Hoist
 *      React, resulting in a much smaller bundle size. Set to true if your app wishes to access all the BP icons.
 * @param {boolean} [env.minify=true] - false to skip JS/CSS minification in production builds - for diagnosing
 *      built-output issues against readable code. Build output is otherwise identical to a minified build.
 * @param {boolean} [env.buildCache=false] - true to enable Rspack's persistent build cache for faster warm dev-server
 *      starts. Experimental within Rspack - off by default pending soak.
 * @param {string} [env.logLevel=info] - Rsbuild log level - 'info' | 'warn' | 'error' | 'silent'. Replaces
 *      the v15 `stats` and `infrastructureLoggingLevel` options, which are rejected if passed.
 * @param {boolean|Object} [env.devClientOverlay] - customize dev-server overlay behavior. Set to show only compilation
 *      errors by default. Accepts webpack-dev-server's `{errors, runtimeErrors}` shape, mapped onto Rsbuild's
 *      `{errors, runtime}` (there is no Rsbuild equivalent of `warnings`). Dev-mode only.
 * @param {string} [env.devHost=localhost] - hostname for both local Grails and dev servers. Override for
 *      testing on alternate workstations or devices. Will be automatically set to lowercase. Dev-mode only.
 * @param {number} [env.devGrailsPort] - port of local Grails server. Dev-mode only.
 * @param {number} [env.devWebpackPort] - port on which to start the dev server. (Historic name retained.) Dev-mode only.
 * @param {string} [env.devServerOpenPage] - path to auto-open when the dev server starts. Leave null to disable
 *      automatic page open on startup. Dev-mode only.
 * @param {boolean} [env.devLiveReload=true] - false to stop the dev server from reloading the page when an edit
 *      cannot be hot-swapped (the equivalent of webpack-dev-server's `--no-live-reload`). Hot-swaps of CSS and
 *      Fast-Refresh-eligible components still apply; other edits are rebuilt but not applied until a manual
 *      reload. Dev-mode only.
 * @param {(boolean|Object)} [env.devHttps] - `true` to run the dev server locally over SSL with an auto-generated
 *      self-signed cert (browser will warn). Or provide an object of Node `https.createServer` options to enable SSL
 *      while specifying a custom cert/key. Default `false` runs locally over HTTP only. Dev-mode only.
 * @param {Object} [env.devServerOptions] - options to spread onto / override defaults passed here to Rsbuild's
 *      `server` config. Dev-mode only.
 * @returns {Promise<Object>} a complete Rsbuild config object.
 */
async function configureRsbuild(env) {
    if (!env.appCode) throw 'Missing required "appCode" config - cannot proceed';
    rejectUnsupported(env);

    const appCode = env.appCode,
        appName = env.appName || _.startCase(appCode),
        appVersion = env.appVersion || '1.0-SNAPSHOT',
        appBuild = env.appBuild || 'UNKNOWN',
        prodBuild = parseFlag(env.prodBuild, false) === true,
        inlineHoist = !prodBuild && parseFlag(env.inlineHoist, false) === true,
        reactProdMode = prodBuild || parseFlag(env.reactProdMode, false) === true,
        resolveAliases = Object.assign({}, env.resolveAliases),
        buildCache = parseFlag(env.buildCache, false) === true,
        minify = parseFlag(env.minify, true) === true,
        devClientOverlay = env.devClientOverlay ?? {errors: true, runtimeErrors: false},
        devLiveReload = parseFlag(env.devLiveReload, true) === true,
        devHost = env.devHost ? env.devHost.toLowerCase() : 'localhost',
        devHttps = prodBuild ? null : _.isPlainObject(env.devHttps) ? env.devHttps : !!env.devHttps,
        devGrailsPort = env.devGrailsPort || 8080,
        devWebpackPort = env.devWebpackPort || 3000,
        devServerOptions = env.devServerOptions || {},
        baseUrl = env.baseUrl || '/api/',
        extraIncludePaths = (env.extraIncludePaths || env.babelIncludePaths || []).map(
            safeRealpath
        ),
        extraExcludePaths = (env.extraExcludePaths || env.babelExcludePaths || []).map(
            safeRealpath
        ),
        extraModuleRules = env.extraModuleRules || [],
        contextRoot = env.contextRoot || '/',
        copyPublicAssets = parseFlag(env.copyPublicAssets, true),
        parseChangelog = parseFlag(env.parseChangelog, true),
        favicon = env.favicon || null,
        manifestConfig = env.manifestConfig || {},
        preloadBackgroundColor = env.preloadBackgroundColor || 'white',
        preloadSpinnerColor = env.preloadSpinnerColor || '#888',
        logLevel = env.logLevel || 'info',
        targetBrowsers = env.targetBrowsers || DEFAULT_TARGET_BROWSERS,
        swcOptions = env.swcOptions || {},
        minifyOptions = env.minifyOptions || {},
        precompressAssets = parseFlag(env.precompressAssets, true),
        sourceMaps = parseFlag(env.sourceMaps, true),
        buildDate = new Date();

    for (const [oldName, newName] of [
        ['babelIncludePaths', 'extraIncludePaths'],
        ['babelExcludePaths', 'extraExcludePaths']
    ]) {
        if (env[oldName] && !env[newName]) {
            logMsg(`⚠️  "${oldName}" is deprecated - rename it to "${newName}".`);
        }
    }
    checkHoistReactVersion(hoistReactPkg, inlineHoist);

    process.env.NODE_ENV = prodBuild ? 'production' : 'development';
    process.env.REACT_NODE_ENV = reactProdMode ? 'production' : 'development';

    logSep();
    logMsg(`Building ${appName} v${appVersion}`);
    if (appBuild !== 'UNKNOWN') logMsg(`  Build ${appBuild}`);
    logMsg(`  ${buildDate.toISOString()}`);
    logSep();
    if (prodBuild) logMsg('🚀  Production build enabled');
    if (!prodBuild) logMsg('💻  Development mode enabled');
    if (inlineHoist) logMsg('🏗️   Inline Hoist enabled');
    if (reactProdMode) logMsg('⚛️   React Production mode enabled');
    if (buildCache) logMsg('💾  Persistent build cache enabled');
    if (prodBuild && precompressAssets) logMsg('🗜️   Asset pre-compression enabled');
    logSep();
    logMsg('📚  Key libraries:');
    logMsg(`  > @xh/hoist ${inlineHoist ? 'INLINE' : 'v' + hoistReactPkg.version}`);
    logMsg(`  > @xh/hoist-dev-utils v${devUtilsPkg.version}`);
    logMsg(`  > react v${reactPkg.version}`);
    logMsg(`  > @rsbuild/core v${rsbuildVersion}`);
    logMsg(`  > @rspack/core v${rspack.rspackVersion}`);
    logMsg(`  > node ${process.version}`);
    logSep();
    logMsg('🎯  Targets:');
    targetBrowsers.forEach(it => logMsg(`  > ${it}`));

    const srcPath = path.resolve(basePath, 'src'),
        outPath = path.resolve(basePath, 'build'),
        publicAssetsPath = path.resolve(basePath, 'public'),
        // This very file lives within the dev-utils package, wherever it has been installed or
        // linked - avoids assuming the package is physically within the app's node_modules.
        hoistDevUtilsPath = __dirname;

    // Resolve Hoist as either a sibling (inline, checked-out) project or a downloaded package.
    // Resolve symlinks (a no-op for flat layouts) so the path matches the real module paths
    // Rspack produces via its default resolve.symlinks behavior - required for the transpile
    // include below to match under symlinking package managers (e.g. pnpm).
    const hoistPath = safeRealpath(
        inlineHoist
            ? path.resolve(basePath, '../../hoist-react')
            : path.resolve(basePath, 'node_modules/@xh/hoist')
    );

    // Check for and resolve standard/expected favicons.
    const {manifestIcons, appleTouchIconExists} = resolveIcons(
        publicAssetsPath,
        favicon,
        copyPublicAssets
    );

    // Generate lightweight stub modules for Blueprint icons, unless app opts into the full set.
    const loadAllBlueprintJsIcons = parseFlag(env.loadAllBlueprintJsIcons, false) === true,
        bpIconStubs = loadAllBlueprintJsIcons
            ? null
            : generateBlueprintIconStubs(basePath, hoistPath);

    // Tell the bundler where to look for modules when resolving imports - this is the key to
    // getting inlineHoist mode to look in within the checked-out hoist-react project at hoistPath.
    if (inlineHoist) {
        resolveAliases['@xh/hoist'] = hoistPath;

        // This ensures that we use the same instance of libs in hoist-react as in the app - needed
        // to get hooks working since they will throw an error if the lib instance that the hook
        // was imported from is different than the instance that was used to render the component
        // (which will always be the instance hoist-react has when using element factories)
        resolveAliases['react'] = path.resolve('./node_modules/react');
        resolveAliases['react-dom'] = path.resolve('./node_modules/react-dom');

        // Also ensure a single instance of ag-Grid when Hoist is inline, needed to support use of
        // `useGridMenuItem` hook.
        resolveAliases['ag-grid-react'] = path.resolve('./node_modules/ag-grid-react');
        resolveAliases['ag-grid-community'] = path.resolve('./node_modules/ag-grid-community');
    }

    // When running inline, resolve inline Hoist's own node_modules so we can exclude them.
    const hoistNodeModulesPath = inlineHoist ? path.resolve(hoistPath, 'node_modules') : null;

    // Determine source map (devtool) mode.
    let devtool;
    if (!sourceMaps) {
        devtool = false;
    } else if (sourceMaps === true) {
        devtool = prodBuild ? 'source-map' : 'eval-source-map';
    } else if (sourceMaps === 'devOnly') {
        devtool = prodBuild ? false : 'eval-source-map';
    } else {
        devtool = sourceMaps;
    }

    // Parse CHANGELOG.md to JSON (or write an empty fallback), then install a resolver alias to
    // the synthetic import path used by XH.changelogService.
    resolveAliases['@xh/app-changelog.json'] = await writeChangelogJson(basePath, parseChangelog);

    // TS-only support - fail fast on any .jsx source.
    checkNoJsxFiles([srcPath, ...extraIncludePaths]);

    // Resolve app entry points - one for each file within src/apps/ - to create bundles below.
    const clientApps = discoverClientApps(srcPath),
        clientAppNames = clientApps.map(it => it.name),
        appEntryPoints = Object.fromEntries(clientApps.map(it => [it.name, it.path]));

    // Hoist-react's polyfills.js (a single `core-js/stable` import) is prepended to every app
    // entry. With SWC's preset-env in `entry` mode (see `tools.swc` below), that import is
    // rewritten into the specific polyfills needed for the configured target browsers.
    const polyfillsPath = path.resolve(hoistPath, 'static/polyfills.js'),
        // core-js version for SWC's entry-mode rewrite. Pinned to the 3.0 feature set, exactly as
        // the v15 webpack build's Babel preset-env always was (`corejs: {version: 3}`) - so the
        // emitted polyfills are unchanged. Raising this to the installed minor
        // (`coreJsPkg.version`) would add a dozen-plus shims for post-3.0 additions (explicit
        // resource management, iterator helpers, `Promise.try`, ...) that core-js-compat reports
        // current Safari as lacking - a deliberate policy change to make separately, not here.
        coreJsVersion = '3.0';

    // Content hash of hoist-react's preflight.js, copied into the build unbundled and referenced
    // from index.html - used to cache-bust it across releases.
    const preflightHash = fileHash(path.resolve(hoistPath, 'public/preflight.js')) ?? 'x';

    logSep();
    logMsg('🎁  App bundle entry points:');
    clientAppNames.forEach(it => logMsg(`  > ${it}`));
    logSep();
    warnUnknownOptions(env);
    logMsg('🤕  Something going wrong?');
    logMsg('  > support@xh.io');
    logMsg('  > https://xh.io/contact/');
    logSep();

    return {
        mode: prodBuild ? 'production' : 'development',
        root: basePath,
        logLevel,

        plugins: [
            // React via SWC - automatic JSX runtime, plus React Fast Refresh in dev. Note Fast
            // Refresh hot-swaps only modules whose exports it recognizes as React components (e.g.
            // `export const AppComponent = hoistCmp({...})`) - Hoist's camelCase element-factory
            // exports and model classes fall back to a (sub-second) full reload of the page.
            pluginReact({
                swcReactOptions: {runtime: 'automatic'},
                // Rsbuild's React-specific vendor chunking is tied to its own split presets.
                splitChunks: false,
                reactRefreshOptions: {
                    // Refresh app source, hoist-react (raw TS in node_modules) and custom packages.
                    include: [srcPath, hoistPath, ...extraIncludePaths],
                    exclude: hoistNodeModulesPath ? [hoistNodeModulesPath] : []
                }
            }),

            // SASS via sass-embedded. Vendor prefixing is handled downstream by Rspack's built-in
            // Lightning CSS loader, driven by the same browserslist targets as SWC - so no
            // postcss/autoprefixer stage is needed here.
            pluginSass(),

            // Self-signed cert for `devHttps: true`, mirroring webpack-dev-server's built-in behavior.
            ...(devHttps === true ? [require('@rsbuild/plugin-basic-ssl').pluginBasicSsl()] : [])
        ],

        source: {
            // One named entry chunk per app, as above.
            entry: appEntryPoints,
            preEntry: [polyfillsPath],

            // Always transpile Hoist - even when "packaged" we have the raw source as we are not
            // currently transpiling anything in hoist-react on its own. (Rsbuild's default include
            // also compiles every .ts/.tsx it encounters, so this is largely belt-and-braces for
            // hoist's plain-JS `polyfills.js` and any custom packages.)
            include: [srcPath, hoistPath, ...extraIncludePaths],
            // In inline mode also *avoid* transpiling inline hoist's own node_modules libraries.
            exclude: inlineHoist ? [hoistNodeModulesPath, ...extraExcludePaths] : extraExcludePaths,

            // TC39 Stage 3 (2023-11) decorators, transformed by SWC alone - no Babel pass. This is
            // the emit hoist-react >= 88 is written against: `@observable accessor` / `@bindable
            // accessor` fields, `@persist` composing via the accessor `init` chain, and `@managed` /
            // `@lookup` returning a field initializer. Also Rsbuild's own default, set explicitly
            // here because it is load-bearing: pointed at `legacy`, every `@observable` and
            // `@bindable` in a v88 app silently stops working.
            decorators: {version: '2023-11'},

            // Avoid importing every FA icon ever made - rewrite named imports from the FontAwesome
            // icon packs to per-icon deep imports. See https://github.com/FortAwesome/react-fontawesome/issues/70
            transformImport: [
                '@fortawesome/pro-light-svg-icons',
                '@fortawesome/pro-regular-svg-icons',
                '@fortawesome/pro-solid-svg-icons',
                '@fortawesome/pro-thin-svg-icons',
                '@fortawesome/free-brands-svg-icons'
            ].map(libraryName => ({
                libraryName,
                customName: `${libraryName}/{{ member }}`,
                transformToDefaultImport: false
            })),

            // Inject global constants at compile time.
            define: {
                'process.env.NODE_ENV': JSON.stringify(process.env.REACT_NODE_ENV),
                // Fallback for any other `process.env.*` reference - some libraries (e.g.
                // react-draggable >= 4.5) ship raw `process.env.X` debug gates in their published
                // browser builds, which otherwise throw a ReferenceError at runtime (browsers
                // have no `process` global). Most-specific keys win, so NODE_ENV above still
                // resolves to its real value.
                'process.env': '{}',
                xhAppCode: JSON.stringify(appCode),
                xhAppName: JSON.stringify(appName),
                xhAppVersion: JSON.stringify(appVersion),
                xhAppBuild: JSON.stringify(appBuild),
                xhBaseUrl: JSON.stringify(baseUrl),
                xhBuildTimestamp: buildDate.getTime(),
                xhClientApps: JSON.stringify(clientAppNames),
                xhIsDevelopmentMode: !prodBuild
            }
        },

        resolve: {
            alias: resolveAliases,
            // Our aliases (notably inlineHoist's) win over any `paths` in the app's tsconfig.
            aliasStrategy: 'prefer-alias',
            // Extensions tried, in order, for imports that do not specify one. Imports that
            // *do* include an extension (e.g. `import './foo.png'`) always resolve as written.
            // Note no `.jsx` - apps must be TS, with JSX carried solely by `.tsx` files.
            extensions: ['.js', '.ts', '.tsx', '.json']
        },

        output: {
            // Match webpack output layout: JS/CSS at the build root, media under static/media,
            // one nested `<app>/index.html` per entry, and hoist + app /public dirs copied in.
            distPath: {
                root: outPath,
                js: '',
                jsAsync: '',
                css: '',
                cssAsync: '',
                html: '',
                favicon: '',
                image: 'static/media',
                svg: 'static/media',
                font: 'static/media',
                media: 'static/media',
                assets: 'static/media'
            },
            // Hash JS/CSS filenames in production only (Rsbuild's own default). In dev, CSS is
            // extracted to real files and hot-swapped by re-fetching the `<link>` the page already
            // holds - a hashed dev filename breaks that, leaving the browser re-reading the stale
            // pre-edit file while the rebuild lands under a new name.
            filename: {
                js: prodBuild ? '[name].[contenthash:8].js' : '[name].js',
                css: prodBuild ? '[name].[contenthash:8].css' : '[name].css',
                image: '[name].[contenthash:8][ext]',
                svg: '[name].[contenthash:8][ext]',
                font: '[name].[contenthash:8][ext]',
                media: '[name].[contenthash:8][ext]',
                assets: '[name].[contenthash:8][ext]'
            },
            // (URL) path on which fully built app is served - i.e. root context
            assetPrefix: contextRoot,
            cleanDistPath: true,
            // Same browserslist drives SWC syntax lowering + polyfill selection and CSS prefixing.
            overrideBrowserslist: targetBrowsers,
            // Polyfilling is handled by hoist's polyfills.js preEntry + SWC entry mode, not Rsbuild.
            polyfill: 'off',
            // Inline small raster images as data URIs (as webpack did); emit everything else.
            dataUriLimit: {image: 10000, svg: 0, font: 0, media: 0, assets: 0},
            sourceMap: {js: devtool, css: !!devtool},
            // Copy /public directories from HR and App into the output - App files should win.
            // Note that this includes preflight.js from HR, referenced from index.html. Copied
            // files are flagged `minimized` so the JS/CSS minimizers leave them byte-for-byte
            // intact (as webpack does) - they were never compiled here, and some are shipped
            // pre-minified.
            copy: _.compact([
                {from: path.resolve(hoistPath, 'public'), to: 'public', info: {minimized: true}},
                copyPublicAssets
                    ? {from: publicAssetsPath, to: 'public', info: {minimized: true}}
                    : undefined
            ]),
            minify: {
                js: prodBuild && minify,
                css: prodBuild && minify,
                jsOptions: {
                    minimizerOptions: _.merge(
                        {
                            // Mangling renames local identifiers for meaningfully smaller bundles.
                            // Function and class names are kept - relied upon for error messages,
                            // logging, and debugging of deployed builds.
                            compress: {keep_classnames: true, keep_fnames: true},
                            mangle: {keep_classnames: true, keep_fnames: true}
                        },
                        minifyOptions
                    )
                }
            }
        },

        // Produce chunks for any shared imports across JS apps - plain Rspack splitChunks, without
        // Rsbuild's opinionated vendor/react presets, for parity with the webpack config.
        splitChunks: {preset: 'none', chunks: 'all'},

        html: {
            template: path.resolve(hoistDevUtilsPath, 'static/index.html'),
            // Template supplies its own charset + viewport tags.
            meta: {charset: false, viewport: false},
            title: appName,
            favicon: favicon ?? undefined,
            // `<app>/index.html` per entry.
            outputStructure: 'nested',
            // Emit `<script defer>` tags at the end of body, as the webpack template did.
            inject: 'body',
            templateParameters: (params, {entryName}) => ({
                ...params,
                title: appName,
                publicPath: contextRoot,
                includeAppleIcon: appleTouchIconExists,
                // Rsbuild injects the per-entry style and script tags itself.
                styleTags: '',
                scriptTags: '',
                clientAppName: entryName,
                preloadBackgroundColor,
                preloadSpinnerColor,
                preflightHash
            })
        },

        performance: {
            buildCache,
            printFileSize: prodBuild ? {detail: false} : false
        },

        dev: prodBuild
            ? undefined
            : {
                  progressBar: true,
                  // Full-page fallback when an update cannot be hot-applied (models, element-factory
                  // modules) - off for webpack-dev-server's `--no-live-reload` workflow.
                  liveReload: devLiveReload,
                  client: {
                      overlay:
                          devClientOverlay === false
                              ? false
                              : devClientOverlay === true
                                ? true
                                : {
                                      errors: devClientOverlay.errors ?? true,
                                      runtime: devClientOverlay.runtimeErrors ?? false
                                  }
                  }
              },

        // Inline dev-time configuration for the dev server.
        server: {
            // We copy /public ourselves (into `build/public`, not the dist root) via output.copy.
            publicDir: false,
            ...(prodBuild
                ? {}
                : {
                      host: devHost,
                      port: devWebpackPort,
                      https: _.isPlainObject(devHttps) ? devHttps : undefined,
                      open: env.devServerOpenPage ? [env.devServerOpenPage] : false,
                      // Support HTML5 history routes for apps, with /appName/ as the base route for each
                      historyApiFallback: {
                          rewrites: clientAppNames.map(appName => ({
                              from: new RegExp(`^/${appName}`),
                              to: `/${appName}/index.html`
                          }))
                      },
                      // Proxy API requests to the Grails backend, mirroring the production nginx setup.
                      // Only needed when baseUrl is a relative path (default '/api/') - if baseUrl is
                      // an absolute URL, the app will call the remote server directly. Note the
                      // http-proxy-middleware v3 option name `pathFilter` - webpack-dev-server's
                      // `context` is silently ignored here, and a filterless entry proxies *every*
                      // request, the app's own pages included.
                      proxy: baseUrl.startsWith('/')
                          ? [
                                {
                                    pathFilter: baseUrl.slice(0, -1),
                                    target: `http://${devHost}:${devGrailsPort}`,
                                    pathRewrite: {[`^${baseUrl.slice(0, -1)}`]: ''},
                                    changeOrigin: true,
                                    secure: false,
                                    ws: true
                                }
                            ]
                          : [],
                      ...devServerOptions
                  })
        },

        tools: {
            // SWC (builtin:swc-loader) options, layered onto Rsbuild's defaults.
            swc: config => {
                const jsc = (config.jsc ??= {}),
                    transform = (jsc.transform ??= {});

                // Class fields use [[Define]] semantics, matching hoist-react's tsconfig
                // (`useDefineForClassFields: true`) and what TC39 decorators assume - `accessor`
                // fields desugar to a getter/setter pair over private storage, and plain fields
                // must still define rather than assign so they do not trip inherited setters.
                transform.useDefineForClassFields = true;

                // Rewrite the `core-js/stable` import in hoist-react's polyfills.js (prepended to
                // every app entry above) into the polyfills needed for the target browsers.
                config.env = {
                    ...config.env,
                    mode: 'entry',
                    coreJs: coreJsVersion,
                    targets: targetBrowsers
                };

                return _.isFunction(swcOptions)
                    ? (swcOptions(config) ?? config)
                    : _.merge(config, swcOptions);
            },

            // Direct Rspack config beyond Rsbuild's surface.
            rspack: (config, {addRules, appendPlugins, isDev, isProd}) => {
                // Flag missing exports as a failure vs. warning
                config.module.parser = _.merge(config.module.parser, {
                    javascript: {exportsPresence: 'error'}
                });

                config.optimization = {
                    ...config.optimization,
                    // Disable package.json `sideEffects` based module pruning. Eliding hoist-react's
                    // barrel modules removes the source-order evaluation guarantee its internally
                    // circular imports rely on - see hoist-react #4640.
                    sideEffects: false,
                    // Also skip scope hoisting (module concatenation), for the same reason. It
                    // merges modules into one function scope, so a circular import can reach a
                    // `const` binding before its defining statement has run - a TDZ ReferenceError
                    // at startup. The v15 webpack build never concatenated (`mode: 'none'`), and
                    // hoist-react's module graph has only been proven against that.
                    concatenateModules: false,
                    // Improved debugging with readable module/chunk names.
                    chunkIds: 'named',
                    moduleIds: 'named'
                };

                // Ignore DefinePlugin warnings on mis-matched process.env when reactProdMode
                // enabled during local development.
                if (prodBuild !== reactProdMode) {
                    config.ignoreWarnings = [
                        ...(config.ignoreWarnings ?? []),
                        {message: /Conflicting values for 'process.env.NODE_ENV'/}
                    ];
                }

                addRules([
                    // App-supplied rules, ahead of the built-in rules.
                    ...extraModuleRules,

                    // Markdown - import resolves to the file's raw text content (asset/source), so
                    // it can be rendered directly - e.g. via Hoist's `markdown` component - without
                    // a fetch. Append `?url` to a specific import to get an emitted-file URL instead
                    // (e.g. for a large doc to be loaded lazily): `import url from './big.md?url'`.
                    {
                        test: /\.md$/,
                        oneOf: [
                            {
                                resourceQuery: /url/,
                                type: 'asset/resource',
                                generator: {filename: 'static/media/[name].[contenthash:8][ext]'}
                            },
                            {type: 'asset/source'}
                        ]
                    }
                ]);

                appendPlugins(
                    _.compact([
                        // Load only the BlueprintJS icons used by Hoist-React components - swap the
                        // icon package entry and path barrels for generated stubs.
                        ...(bpIconStubs
                            ? ['entry', 'paths16', 'paths20'].map(
                                  key =>
                                      new rspack.NormalModuleReplacementPlugin(
                                          blueprintIconModulePatterns[key],
                                          bpIconStubs[key]
                                      )
                              )
                            : []),

                        // Avoid bundling all moment.js locales and blowing up the bundle size
                        // See https://github.com/jmblog/how-to-optimize-momentjs-with-webpack
                        new rspack.IgnorePlugin({
                            resourceRegExp: /^\.\/locale$/,
                            contextRegExp: /moment$/
                        }),

                        // Create a manifest.json for each app - see manifestContent() for the icon scheme.
                        ...clientAppNames.map(
                            clientAppName =>
                                new HoistManifestPlugin(
                                    clientAppName,
                                    manifestContent(
                                        clientAppName,
                                        {
                                            appName,
                                            appVersion,
                                            preloadBackgroundColor,
                                            icons: manifestIcons
                                        },
                                        manifestConfig
                                    )
                                )
                        ),

                        // Avoid dev-time errors with mis-matched casing in imports (where a less
                        // case-sensitive OS will resolve OK, but import could fail at build time
                        // with strict case sensitivity).
                        isDev ? new rspack.CaseSensitivePlugin() : null,

                        ...(isProd ? compressionPlugins(precompressAssets) : [])
                    ])
                );
            }
        }
    };
}

//------------------------
// Implementation
//------------------------
// Emit pre-compressed `.br` and `.gz` copies of bundled assets alongside the originals, for direct
// serving by nginx via `brotli_static` / `gzip_static`. Doing this at build time is what makes
// brotli quality 11 usable at all - it is far too slow to run per-request - and it drops the cost of
// re-compressing the same immutable bundles on every request.
const compressionPlugins = precompressAssets => {
    if (!precompressAssets) return [];

    // Originals are never deleted (the plugin has no option to). If only the `.br` and `.gz`
    // remained, nginx would still serve them to any client that advertises the matching encoding -
    // but a client that advertises neither (a plain curl, a health check, an old proxy) would have
    // no file left to read and get a 404.
    const shared = {
        // Source maps are deliberately excluded - they are large, fetched only with devtools
        // open, and already compressed on the fly by xh-nginx (which serves them as
        // `application/json`).
        test: /\.(js|css|html|svg)$/,
        threshold: 1024,
        minRatio: 0.8,
        ..._.pick(
            _.isPlainObject(precompressAssets) ? precompressAssets : {},
            'test',
            'include',
            'exclude',
            'threshold',
            'minRatio'
        )
    };

    return [
        new HoistCompressionPlugin({
            ...shared,
            extension: '.br',
            algorithm: 'brotliCompress',
            compressionOptions: {params: {[zlib.constants.BROTLI_PARAM_QUALITY]: 11}}
        }),
        new HoistCompressionPlugin({
            ...shared,
            extension: '.gz',
            algorithm: 'gzip',
            compressionOptions: {level: 9}
        })
    ];
};

// v15 (webpack / Babel / Terser) options with no direct equivalent here. Rejected loudly rather
// than ignored, so a config ported from a `webpack.config.js` does not silently lose settings it
// relied upon.
function rejectUnsupported(env) {
    const rejected = {
        babelPresetEnvOptions: 'use `swcOptions` to adjust SWC / preset-env behavior',
        terserOptions:
            'use `minifyOptions` (same `compress` / `mangle` / `format` shape) for the SWC minimizer',
        stats: 'use `logLevel`',
        infrastructureLoggingLevel: 'use `logLevel`',
        analyzeBundles:
            'install `@rsdoctor/rspack-plugin` in the app and build with `RSDOCTOR=true` ' +
            '(Rsbuild registers and launches Rsdoctor natively)'
    };
    Object.entries(rejected).forEach(([key, remedy]) => {
        if (env[key] !== undefined) {
            throw `Option "${key}" is not supported by configureRsbuild() - ${remedy}.`;
        }
    });
}

/**
 * Read the standard `XH_*` environment variables into env options, for CLI-driven overrides
 * (Rsbuild's CLI has no `--env key=value` flag, and we deliberately do not emulate one - the name is
 * taken by Rsbuild's own dotenv toggle). Spread the result into the config passed to
 * `configureRsbuild()` after the app's own defaults, e.g.:
 *
 *      XH_PROD_BUILD=true XH_APP_VERSION=1.2.3 rsbuild build
 *      XH_INLINE_HOIST=true rsbuild dev
 *
 * The same variables can live in dotenv files, which Rsbuild's CLI loads into `process.env` before
 * it evaluates the config file: `.env`, `.env.local`, `.env.<mode>` and `.env.<mode>.local` in the
 * app directory, with `<mode>` from `--env-mode`. So `XH_PROD_BUILD=true` in `.env.prod` applies to
 * every `rsbuild build --env-mode prod`, and a gitignored `.env.local` is the place for a developer's
 * own `XH_DEV_HOST` or `XH_DEV_LIVE_RELOAD=false`. Only `PUBLIC_`-prefixed variables are exposed to
 * client code by Rsbuild; `XH_*` values stay build-time.
 *
 * Boolean-ish values ('true' / 'false') are normalized; unset variables are omitted so app
 * defaults win.
 */
function readCliEnv(processEnv = process.env) {
    const mapping = {
        XH_APP_VERSION: 'appVersion',
        XH_APP_BUILD: 'appBuild',
        XH_PROD_BUILD: 'prodBuild',
        XH_INLINE_HOIST: 'inlineHoist',
        XH_REACT_PROD_MODE: 'reactProdMode',
        XH_BUILD_CACHE: 'buildCache',
        XH_MINIFY: 'minify',
        XH_DEV_HOST: 'devHost',
        XH_DEV_HTTPS: 'devHttps',
        XH_DEV_GRAILS_PORT: 'devGrailsPort',
        XH_DEV_PORT: 'devWebpackPort',
        XH_DEV_LIVE_RELOAD: 'devLiveReload',
        XH_LOG_LEVEL: 'logLevel'
    };
    const ret = {};
    Object.entries(mapping).forEach(([envVar, key]) => {
        const val = processEnv[envVar];
        if (val !== undefined && val !== '') ret[key] = parseFlag(val, undefined);
    });
    return ret;
}

module.exports = configureRsbuild;
module.exports.configureRsbuild = configureRsbuild;
module.exports.readCliEnv = readCliEnv;
