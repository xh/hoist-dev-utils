/*
 * This file belongs to Hoist, an application development toolkit
 * developed by Extremely Heavy Industries (www.xh.io | info@xh.io)
 *
 * Copyright © 2023 Extremely Heavy Industries Inc.
 */
'use strict';

const _ = require('lodash'),
    path = require('path'),
    fs = require('fs'),
    webpack = require('webpack'),
    BundleAnalyzerPlugin = require('webpack-bundle-analyzer').BundleAnalyzerPlugin,
    CaseSensitivePathsPlugin = require('case-sensitive-paths-webpack-plugin'),
    {CleanWebpackPlugin} = require('clean-webpack-plugin'),
    CopyWebpackPlugin = require('copy-webpack-plugin'),
    MiniCssExtractPlugin = require('mini-css-extract-plugin'),
    HtmlWebpackPlugin = require('html-webpack-plugin'),
    HtmlWebpackTagsPlugin = require('html-webpack-tags-plugin'),
    TerserPlugin = require('terser-webpack-plugin'),
    WebpackBar = require('webpackbar'),
    DuplicatePackageCheckerPlugin = require('@cerner/duplicate-package-checker-webpack-plugin'),
    parseChangelogMarkdown = require('changelog-parser'),
    babelCorePkg = require('@babel/core/package'),
    devUtilsPkg = require('./package'),
    basePath = fs.realpathSync(process.cwd());

// These are not direct deps of hoist-dev-utils, so might be undefined - e.g. when running
// this script locally to debug via `yarn link`.
let hoistReactPkg, reactPkg;
try {
    hoistReactPkg = require('@xh/hoist/package');
} catch (e) {
    hoistReactPkg = {version: 'NOT_FOUND'};
}
try {
    reactPkg = require('react');
} catch (e) {
    reactPkg = {version: 'NOT_FOUND'};
}

/**
 * Consolidated Webpack configuration for both dev-time and production builds of Hoist React web
 * applications.
 *
 * Sample commands to run configurations produced by this method include:
 *      `webpack --env.prodBuild --env appVersion=1.2.3` to trigger a build at version 1.2.3
 *      `webpack-dev-server --env inlineHoist` to run dev server w/hoist-react in inline mode
 *
 * @param {Object} env - config passed in from app webpack config or the CLI via --env flags.
 * @param {string} env.appCode - short, internal code for the application - baked into client as XH.appCode. Should be
 *      lowercase, dash-separated, and should match the Gradle project name (e.g. portfolio-manager).
 * @param {string} [env.appName] - user-facing display name for the application - baked into client as XH.appName.
 *      Title cased and space-separated. If null, defaulted from appCode (portfolio-manager -> Portfolio Manager).
 * @param {string} [env.appVersion] - client version - baked into client as XH.appVersion
 * @param {string} [env.appBuild] - build/git tag - baked into client as XH.appBuild
 * @param {boolean} [env.prodBuild=false] - true to indicate this is a build (as opposed to run of webpack-dev-server)
 * @param {boolean} [env.inlineHoist=false] - true to use a locally checked-out copy of hoist-react
 *      when running the dev server, as opposed to using the downloaded dependency. This allows
 *      hoist-react developers to test plugin changes. Dev-mode only.
 * @param {boolean} [env.reactProdMode=false] - true to use the production build of React
 *      when running the dev server.
 * @param {Object} [env.resolveAliases] - object mapping for custom webpack module resolution.
 *      When inlineHoist=true, a mapping between @xh/hoist and the local path will be added.
 * @param {boolean} [env.checkForDupePackages=true] - true to run build throughDuplicatePackageCheckerPlugin and output
 *      a build-time warning if duplicate packages have been resolved due to non-overlapping dependencies.
 * @param {string[]} [env.dupePackageCheckExcludes] - optional list of string package names to exclude from dupe package
 *      checking. Defaults to ['tslib'].
 * @param {string} [env.baseUrl] - root path prepended to all relative URLs called via FetchService. Defaults to
 *      `/api/` in production mode to work with proxy-based deployments and to `$devHost:$devGrailsPort` in dev mode.
 * @param {string[]} [env.babelIncludePaths] - additional paths to pass Babel for transpiling via settings shared with
 *      app-level and @xh/hoist code. Intended for custom packages.
 * @param {string[]} [env.babelExcludePaths] - paths to exclude from Babel transpiling. An example use would be a local
 *      package with a nested node_modules folder.
 * @param {string} [env.contextRoot] - root path from which app will be served, used as the base path for static files.
 * @param {boolean} [env.copyPublicAssets=true] - true to copy the /client-app/public contents into the root of the
 *      build. Note that files within this directory will not be processed, named with a hash, etc. Use for static
 *      assets you wish to link to without using an import to run through the url or file-loader. Required for favicons.
 * @param {boolean} [env.parseChangelog=true] - true to parse a `CHANGELOG.md` file in the project root directory into
 *      JSON and make available for import by `XH.changelogService`.
 * @param {string} [env.favicon] - relative path to a primary favicon source image.
 * @param {Object} [env.manifestConfig] - override values for manifest.json file. This controls options related to
 *      adding a mobile app to a device home screen, as well as "installing" an app via Chrome's "create shortcut"
 *      option. See https://developer.mozilla.org/en-US/docs/Web/Manifest for options.
 * @param {string[]} [env.targetBrowsers] - array of browserslist queries specifying target browsers for Babel and CSS
 *      transpiling and processing.
 * @param {Object} [env.babelPresetEnvOptions] - options to spread onto / override defaults passed here to the Babel
 *      loader preset-env preset config.
 * @param {Object} [env.terserOptions] - options to spread onto / override defaults passed here to the Terser
 *      minification plugin for production builds.
 * @param {(boolean|string)} [env.sourceMaps=true] - control sourceMap generation. Set to `true` to enable defaults
 *      specific to dev vs. prod builds, `false` to disable source maps entirely, special string `'devOnly'` to enable
 *      default for dev and disable in prod, or any other valid Webpack `devtool` string to specify a mode directly.
 * @param {boolean} [env.loadAllBlueprintJsIcons=false] - false to only load the BlueprintJs icons required by Hoist
 *      React, resulting in a much smaller bundle size. Set to true if your app wishes to access all the BP icons.
 * @param {string} [env.stats] - stats output - see https://webpack.js.org/configuration/stats/.
 * @param {boolean} [env.analyzeBundles] - true to launch an interactive bundle analyzer to review output bundle sizes.
 * @param {string} [env.infrastructureLoggingLevel=error] - logging level for devServer.
 * @param {boolean|Object} [env.devClientOverlay] - customize devServer overlay behavior. Set to show only compilation
 *      errors by default. See https://webpack.js.org/configuration/dev-server/#overlay. Dev-mode only.
 * @param {string} [env.devHost=localhost] - hostname for both local Grails and Webpack dev servers. Override for
 *      testing on alternate workstations or devices. Will be automatically set to lowercase to comply with
 *      webpack-dev-server's host checking. Dev-mode only.
 * @param {number} [env.devGrailsPort] - port of local Grails server. Dev-mode only.
 * @param {number} [env.devWebpackPort] - port on which to start webpack-dev server. Dev-mode only.
 * @param {string} [env.devServerOpenPage] - path to auto-open when webpack-dev-server starts. Leave null to disable
 *      automatic page open on startup. Dev-mode only.
 *  @param {(Object|boolean)} [env.devHttps] - Object of the form `{ca, cert, key}`, with each key pointing to the
 *      required resource for a full SSL config. Pass `true` to serve locally over SSL w/o providing a cert (browser
 *      will warn). Dev-mode only.
 */
async function configureWebpack(env) {
    if (!env.appCode) throw 'Missing required "appCode" config - cannot proceed';

    const appCode = env.appCode,
        appName = env.appName || _.startCase(appCode),
        appVersion = env.appVersion || '1.0-SNAPSHOT',
        appBuild = env.appBuild || 'UNKNOWN',
        prodBuild = env.prodBuild === true,
        inlineHoist = !prodBuild && env.inlineHoist === true,
        reactProdMode = prodBuild || env.reactProdMode === true,
        resolveAliases = Object.assign({}, env.resolveAliases),
        analyzeBundles = env.analyzeBundles === true,
        checkForDupePackages = env.checkForDupePackages !== false,
        dupePackageCheckExcludes = env.dupePackageCheckExcludes || ['tslib'],
        devClientOverlay = env.devClientOverlay ?? {
            errors: true,
            warnings: false,
            runtimeErrors: false
        },
        devHost = env.devHost ? env.devHost.toLowerCase() : 'localhost',
        devHttps = prodBuild
            ? null
            : _.isPlainObject(env.devHttps)
            ? {
                  ca: fs.readFileSync(env.devHttps.ca),
                  cert: fs.readFileSync(env.devHttps.cert),
                  key: fs.readFileSync(env.devHttps.key)
              }
            : !!env.devHttps,
        devGrailsPort = env.devGrailsPort || 8080,
        devWebpackPort = env.devWebpackPort || 3000,
        baseUrl = env.baseUrl || (prodBuild ? '/api/' : `http://${devHost}:${devGrailsPort}/`),
        babelIncludePaths = env.babelIncludePaths || [],
        babelExcludePaths = env.babelExcludePaths || [],
        contextRoot = env.contextRoot || '/',
        copyPublicAssets = env.copyPublicAssets !== false,
        parseChangelog = env.parseChangelog !== false,
        favicon = env.favicon || null,
        manifestConfig = env.manifestConfig || {},
        stats = env.stats || 'errors-only',
        infrastructureLoggingLevel = env.infrastructureLoggingLevel || 'error',
        targetBrowsers = env.targetBrowsers || [
            'last 2 Chrome versions',
            'last 2 Safari versions',
            'last 2 iOS versions',
            'last 2 Edge versions'
        ],
        babelPresetEnvOptions = env.babelPresetEnvOptions || {},
        terserOptions = env.terserOptions || {},
        sourceMaps = env.sourceMaps === undefined ? true : env.sourceMaps,
        buildDate = new Date();

    process.env.BABEL_ENV = prodBuild ? 'production' : 'development';
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
    if (analyzeBundles) logMsg('🎁  Bundle analysis enabled');
    logSep();
    logMsg('📚  Key libraries:');
    logMsg(`  > @xh/hoist ${inlineHoist ? 'INLINE' : 'v' + hoistReactPkg.version}`);
    logMsg(`  > @xh/hoist-dev-utils v${devUtilsPkg.version}`);
    logMsg(`  > @babel/core v${babelCorePkg.version}`);
    logMsg(`  > react v${reactPkg.version}`);
    logMsg(`  > webpack v${webpack.version}`);
    logMsg(`  > node ${process.version}`);
    logSep();
    logMsg('🎯  Targets:');
    targetBrowsers.forEach(it => logMsg(`  > ${it}`));

    const srcPath = path.resolve(basePath, 'src'),
        outPath = path.resolve(basePath, 'build'),
        publicAssetsPath = path.resolve(basePath, 'public'),
        hoistDevUtilsPath = path.resolve(basePath, 'node_modules/@xh/hoist-dev-utils');

    // Resolve Hoist as either a sibling (inline, checked-out) project or a downloaded package
    const hoistPath = inlineHoist
        ? path.resolve(basePath, '../../hoist-react')
        : path.resolve(basePath, 'node_modules/@xh/hoist');

    // Check for and resolve standard/expected favicons.
    const manifestIcons = [];
    if (copyPublicAssets) {
        logSep();
        logMsg('🎨  Icons:');
        if (fs.existsSync(favicon)) {
            logMsg(`  > ${path.basename(favicon)}`);
        }
        if (fs.existsSync(path.resolve(publicAssetsPath, 'favicon-192.png'))) {
            manifestIcons.push({
                src: '/public/favicon-192.png',
                sizes: '192x192',
                type: 'image/png'
            });
            logMsg(`  > favicon-192.png`);
        }
        if (fs.existsSync(path.resolve(publicAssetsPath, 'favicon-512.png'))) {
            manifestIcons.push({
                src: '/public/favicon-512.png',
                sizes: '512x512',
                type: 'image/png'
            });
            logMsg(`  > favicon-512.png`);
        }
    }
    const appleTouchIconExists =
        copyPublicAssets && fs.existsSync(path.resolve(publicAssetsPath, 'apple-touch-icon.png'));
    if (appleTouchIconExists) logMsg(`  > apple-touch-icon.png`);

    // Resolve path to lightweight shim for Blueprint icons bundled with this project.
    const bpIconStubsPath = path.resolve(hoistDevUtilsPath, 'static/requiredBlueprintIcons.js'),
        loadAllBlueprintJsIcons = env.loadAllBlueprintJsIcons === true;

    // Resolve path to script for preflight checks. With HR >= v36.1 this routine has been broken
    // out into a standalone JS file to avoid the use of inline script tags. Script will be left
    // unprocessed/unbundled and injected into HTML index files prior to any bundles.
    const preflightScriptPath = path.resolve(hoistPath, 'static/preflight.js');

    // Resolve path to spinner image included in HR >= 43 to prep for copy into public assets.
    // Displayed by generated HTML index page while JS app downloads and starts.
    const preloadSpinnerPath = path.resolve(hoistPath, 'static/spinner.png');

    // Tell webpack where to look for modules when resolving imports - this is the key to getting
    // inlineHoist mode to look in within the checked-out hoist-react project at hoistPath.
    if (inlineHoist) {
        resolveAliases['@xh/hoist'] = hoistPath;

        // This ensures that we use the same instance of react in hoist-react as in the app - needed
        // to get hooks working since they will throw an error if the react instance that the hook
        // was imported from is different than the instance that was used to render the component
        // (which will always be the instance hoist-react has when using element factories)
        resolveAliases.react = path.resolve('./node_modules/react');
    }

    // When running inline, resolve inline Hoist's own node_modules package so we can tell Babel to exclude
    const hoistNodeModulesPath = inlineHoist ? path.resolve(hoistPath, 'node_modules') : null;

    // Also get a handle on the nested @xh/hoist-dev-utils/node_modules path - dev-utils dependencies
    // (namely loaders) can be installed here due to the vagaries of node module version / conflict resolution.
    const devUtilsNodeModulesPath = path.resolve(hoistDevUtilsPath, 'node_modules');

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

    // Ignore DefinePlugin warnings on mis-matched process.env when reactProdMode enabled during local development.
    const ignoreWarnings =
        prodBuild !== reactProdMode
            ? [{message: /Conflicting values for 'process.env.NODE_ENV'/}]
            : [];

    // Parse CHANGELOG.md and write to tmp .json file, if requested. Write fallback file if disabled
    // or parsing fails, then install a resolver alias to support import from XH.changelogService.
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
    // Write dummy file if CL disabled or has failed to parse/write changelog.json.
    // Ensures we always have a file with either updated or appropriately empty JSON to alias.
    if (!clDestUpdated) fs.writeFileSync(clDestPath, '{}');
    // Setup resolver alias to synthetic import path used by XH.changelogService.
    resolveAliases['@xh/app-changelog.json'] = clDestPath;

    // Resolve app entry points - one for each file within src/apps/ - to create bundles below.
    const appDirPath = path.resolve(srcPath, 'apps'),
        apps = fs
            .readdirSync(appDirPath)
            .filter(f => f.endsWith('.js') || f.endsWith('.ts'))
            .map(f => {
                return {
                    name: f.replace('.js', '').replace('.ts', ''),
                    path: path.resolve(appDirPath, f)
                };
            }),
        appNames = apps.map(it => it.name),
        chunkNames = getChunkCombinations(appNames.sort());

    // Build Webpack entry config, with keys for each JS app to be bundled.
    const appEntryPoints = {};
    apps.forEach(app => {
        // Ensure core-js and regenerator-runtime both imported for every app bundle - they are
        // specified as dependencies by Hoist and imported once in its polyfills.js file.
        appEntryPoints[app.name] = [path.resolve(hoistPath, 'static/polyfills.js'), app.path];
    });

    logSep();
    logMsg('🎁  App bundle entry points:');
    appNames.forEach(it => logMsg(`  > ${it}`));
    logSep();
    logMsg('🤕  Something going wrong?');
    logMsg('  > support@xh.io');
    logMsg('  > https://xh.io/contact/');
    logSep();

    return {
        mode: prodBuild ? 'none' : 'development',

        // One named entry chunk per app, as above.
        entry: appEntryPoints,

        output: {
            // Output built assets in directories per entry point / chunk.
            // Use chunkhash in prod to get distinct hashes for app vs. common chunks (throws error in dev - investigate)
            filename: prodBuild
                ? '[name]/[name].[chunkhash:8].js'
                : '[name]/[name].[fullhash:8].js',
            path: outPath,
            // (URL) path on which fully built app is served - i.e. root context
            publicPath: contextRoot,
            pathinfo: !prodBuild
        },

        optimization: {
            // Disabled for performance, and to take upcoming default in next major version (as per
            // https://webpack.js.org/configuration/optimization/#optimizationremoveavailablemodules)
            removeAvailableModules: false,

            // Disable package.json `sideEffects` based tree-shaking - was getting inconsistent
            // results, with imports being dropped seemingly at random.
            sideEffects: false,

            // Produce chunks for any shared imports across JS apps.
            // Chunks are named by the JS app entry points to which they belong, concatenated with '~',
            // e.g. `app.js`, `admin.js`, and `admin~app.js` for code shared by both apps.
            splitChunks: {
                chunks: 'all',
                name: (module, chunks) =>
                    chunks
                        .sort()
                        .map(it => it.name)
                        .join('~')
            },

            // Improved debugging with readable module/chunk names.
            chunkIds: 'named',
            moduleIds: 'named'
        },

        resolve: {
            alias: resolveAliases,
            // Add JSX to support imports from .jsx source w/o needing to add the extension.
            // Include "*" to continue supporting other imports that *do* specify an extension
            // within the import statement (i.e. `import './foo.png'`). Yes, it's confusing.
            extensions: ['*', '.js', '.ts', '.jsx', '.tsx', '.json']
        },

        // Ensure Webpack can find loaders installed both within the top-level node_modules dir for
        // an app that's building (standard case) or nested within dev-utils node_modules (in case
        // of version conflict - triggered for us in Dec 2020 by postcss-loader version bump).
        resolveLoader: {
            modules: ['node_modules', devUtilsNodeModulesPath]
        },

        stats: stats,

        infrastructureLogging: {
            level: infrastructureLoggingLevel
        },

        module: {
            // Flag missing exports as a failure vs. warning
            strictExportPresence: true,

            rules: [
                {
                    oneOf: [
                        //------------------------
                        // Type mapping for .mjs files, used by the stylis library distribution.
                        // We have a transitive dep on stylis via: react-select > emotion > stylis
                        // Without this rule in place, builds fail with errors throw from emotion
                        // re. exports not found in stylis. Another user reported the same issue
                        // and provided this pointer @  https://github.com/thysultan/stylis.js/issues/254
                        //------------------------
                        {
                            test: /\.mjs$/,
                            type: 'javascript/auto'
                        },

                        //------------------------
                        // Image processing
                        // Encodes `url()` references directly when small enough.
                        //------------------------
                        {
                            test: [/\.bmp$/, /\.gif$/, /\.jpe?g$/, /\.png$/],
                            loader: 'url-loader',
                            options: {
                                limit: 10000,
                                name: 'static/media/[name].[hash:8].[ext]'
                            }
                        },

                        //------------------------
                        // JS/TS processing
                        // Transpile via Babel, with presets/plugins to support Hoist's use of modern / staged JS features.
                        //------------------------
                        {
                            test: /\.(jsx?)$|\.(tsx?)$/,
                            use: {
                                loader: 'babel-loader',
                                options: {
                                    presets: [
                                        '@babel/preset-typescript',
                                        '@babel/preset-react',
                                        [
                                            '@babel/preset-env',
                                            {
                                                targets: targetBrowsers.join(', '),

                                                // Specify use of corejs and allow it to polyfill proposals (e.g. object rest spread).
                                                corejs: {version: 3, proposals: true},

                                                // Note that we force import of core-js and regen-runtime in the `entry` config produced by this file.
                                                // This should be replaced by a set of polyfills based on our target browsers as per this setting.
                                                useBuiltIns: 'entry',

                                                // Recently (Mar 2020) added optimization to preset-env to further minimize transpilation to ES5 where
                                                // not required. See https://babeljs.io/docs/en/babel-preset-env#bugfixes.
                                                bugfixes: true,

                                                // Ensure expected transform plugins are enabled for latest features.
                                                // (Note these plugins are all generally bundled with preset-env.)
                                                include: [
                                                    'transform-class-properties',
                                                    'transform-nullish-coalescing-operator',
                                                    'transform-optional-chaining',
                                                    'transform-private-methods',
                                                    'transform-private-property-in-object'
                                                ],

                                                // Allow direct overrides from env config.
                                                ...babelPresetEnvOptions
                                            }
                                        ]
                                    ],
                                    plugins: [
                                        // Support Typescript via Babel. `isTSX` option allows use of JSX inline with
                                        // .js files for older JS apps. Typescript apps must use the .tsx extension for
                                        // any files containing JSX syntax.
                                        [
                                            '@babel/plugin-transform-typescript',
                                            {allowDeclareFields: true, isTSX: true}
                                        ],

                                        // Support our current decorator syntax, for MobX and Hoist decorators.
                                        // See notes @ https://babeljs.io/docs/en/babel-plugin-proposal-decorators#legacy
                                        // and https://mobx.js.org/enabling-decorators.html#babel-7
                                        ['@babel/plugin-proposal-decorators', {version: 'legacy'}],

                                        // Avoid importing every FA icon ever made.
                                        // See https://github.com/FortAwesome/react-fontawesome/issues/70
                                        [
                                            require('babel-plugin-transform-imports'),
                                            {
                                                '@fortawesome/pro-light-svg-icons': {
                                                    transform:
                                                        '@fortawesome/pro-light-svg-icons/${member}',
                                                    skipDefaultConversion: true
                                                },
                                                '@fortawesome/pro-regular-svg-icons': {
                                                    transform:
                                                        '@fortawesome/pro-regular-svg-icons/${member}',
                                                    skipDefaultConversion: true
                                                },
                                                '@fortawesome/pro-solid-svg-icons': {
                                                    transform:
                                                        '@fortawesome/pro-solid-svg-icons/${member}',
                                                    skipDefaultConversion: true
                                                },
                                                '@fortawesome/pro-thin-svg-icons': {
                                                    transform:
                                                        '@fortawesome/pro-thin-svg-icons/${member}',
                                                    skipDefaultConversion: true
                                                },
                                                '@fortawesome/free-brands-svg-icons': {
                                                    transform:
                                                        '@fortawesome/free-brands-svg-icons/${member}',
                                                    skipDefaultConversion: true
                                                }
                                            }
                                        ]
                                    ],
                                    // Cache for dev builds, don't bother compressing.
                                    cacheDirectory: !prodBuild,
                                    cacheCompression: false
                                }
                            },

                            // Always transpile Hoist - even when "packaged" we have the raw source as we are not
                            // currently transpiling anything in hoist-react on its own.
                            include: [srcPath, hoistPath, ...babelIncludePaths],
                            // In inline mode also *avoid* transpiling inline hoist's own
                            // node_modules libraries.
                            exclude: inlineHoist
                                ? [hoistNodeModulesPath, ...babelExcludePaths]
                                : babelExcludePaths
                        },

                        //------------------------
                        // SASS/CSS processing
                        // NOTE these loaders are applied in bottom-to-top (reverse) order.
                        //------------------------
                        {
                            test: /\.(sa|sc|c)ss$/,
                            use: [
                                // 3) Production builds use MiniCssExtractPlugin to break built styles into dedicated output files
                                //    (vs. tags injected into DOM) for production builds. Note relies on MiniCssExtractPlugin being
                                //    called within the prod plugins section.
                                prodBuild ? MiniCssExtractPlugin.loader : 'style-loader',

                                // 2) Resolve @imports within CSS, similar to module support in JS.
                                {
                                    loader: 'css-loader',
                                    options: {
                                        importLoaders: 2, // Indicate how many prior loaders (postCssLoader/sassLoader) to also run on @imported resources.
                                        sourceMap: true,
                                        esModule: false
                                    }
                                },

                                // 1) Pre-process CSS to install flexbox bug workarounds + vendor-specific prefixes for the configured browsers
                                //    Note that the "post" in the loader name refers to http://postcss.org/ - NOT the processing order within Webpack.
                                {
                                    loader: 'postcss-loader',
                                    options: {
                                        postcssOptions: {
                                            plugins: [
                                                require('postcss-flexbugs-fixes'), // Inclusion of postcss-flexbugs-fixes is from CRA.
                                                [
                                                    'autoprefixer',
                                                    {
                                                        // We still want to provide an array of target browsers
                                                        // that can be passed to / managed centrally by this script.
                                                        overrideBrowserslist: targetBrowsers,
                                                        flexbox: 'no-2009'
                                                    }
                                                ]
                                            ]
                                        }
                                    }
                                },

                                // 0) Process source SASS -> CSS
                                {loader: 'sass-loader'}
                            ]
                        },

                        //------------------------
                        // Fall-through entry to process all other assets via a file-loader.
                        // (Exclude config here is from CRA source config - commented there, but didn't understand).
                        //------------------------
                        {
                            exclude: [/\.jsx?$/, /\.html$/, /\.json$/],
                            loader: 'file-loader',
                            options: {
                                name: 'static/media/[name].[hash:8].[ext]'
                            }
                        }
                    ]
                }
            ].filter(Boolean)
        },

        plugins: [
            // Clean (remove) the output directory before each run.
            new CleanWebpackPlugin(),

            // Load only the BlueprintJS icons used by Hoist-React components.
            !loadAllBlueprintJsIcons
                ? new webpack.NormalModuleReplacementPlugin(
                      /.*\/@blueprintjs\/icons\/lib\/esm\/iconSvgPaths.*/,
                      bpIconStubsPath
                  )
                : undefined,

            // Inject global constants at compile time.
            new webpack.DefinePlugin({
                'process.env.NODE_ENV': JSON.stringify(process.env.REACT_NODE_ENV),
                xhAppCode: JSON.stringify(appCode),
                xhAppName: JSON.stringify(appName),
                xhAppVersion: JSON.stringify(appVersion),
                xhAppBuild: JSON.stringify(appBuild),
                xhBaseUrl: JSON.stringify(baseUrl),
                xhBuildTimestamp: buildDate.getTime(),
                xhIsDevelopmentMode: !prodBuild
            }),

            // Avoid bundling all moment.js locales and blowing up the bundle size
            // See https://github.com/jmblog/how-to-optimize-momentjs-with-webpack
            new webpack.IgnorePlugin({
                resourceRegExp: /^\.\/locale$/,
                contextRegExp: /moment$/
            }),

            // Copy preflight script and spinner provided by HR, plus entire /client-app/public
            // directory into the build output.
            new CopyWebpackPlugin({
                patterns: _.compact([
                    {from: preflightScriptPath, to: 'public'},
                    {from: preloadSpinnerPath, to: 'public'},
                    copyPublicAssets
                        ? {from: path.resolve(basePath, 'public'), to: 'public'}
                        : undefined
                ])
            }),

            // Generate HTML index pages - one per JS app.
            ...appNames.map(jsAppName => {
                return new HtmlWebpackPlugin({
                    title: appName,
                    favicon: favicon,
                    // Note: HTML template is sourced from hoist-react.
                    template: path.resolve(hoistPath, `static/index-manifest.html`),
                    filename: `${jsAppName}/index.html`,
                    // Only include chunks that contain the js app name
                    chunks: chunkNames.filter(it => it.startsWith(jsAppName) || it.includes('~' + jsAppName)),
                    // No need to minify the HTML itself
                    minify: false,
                    // Flag read within template file to include apple icon.
                    includeAppleIcon: appleTouchIconExists
                });
            }),

            // Create a manifest.json. The icon choices here work with the favicon provided
            // to HtmlWebpackPlugin above to match the spec here:
            // https://evilmartians.com/chronicles/how-to-favicon-in-2021-six-files-that-fit-most-needs
            new HoistManifestPlugin({
                name: appName,
                short_name: appName,
                description: `${appName} - ${appVersion}`,
                display: 'standalone',
                orientation: 'any',
                start_url: '/',
                background_color: '#ffffff',
                theme_color: '#212121', // off-black from default `--xh-black` CSS var
                icons: manifestIcons,
                ...manifestConfig
            }),

            // Insert a script tag for the (unbundled) preflight script, before all other scripts.
            new HtmlWebpackTagsPlugin({
                // Script available at this path via CopyWebpackPlugin above.
                scripts: ['public/preflight.js'],
                append: false,
                hash: true
            }),

            // Support an optional post-build/run interactive treemap of output bundles and their sizes / contents.
            analyzeBundles
                ? new BundleAnalyzerPlugin({
                      analyzerMode: 'server'
                  })
                : undefined,

            // Warn on dupe package included in bundle due to multiple, conflicting versions.
            checkForDupePackages
                ? new DuplicatePackageCheckerPlugin({
                      verbose: true,
                      showHelp: false,
                      strict: false,
                      exclude: instance => dupePackageCheckExcludes.includes(instance.name)
                  })
                : undefined,

            // Display build progress - enable profile for per-loader/file type stats.
            new WebpackBar({
                color: '#ec7316',
                profile: true
            }),

            // Environment-specific plugins.
            ...(prodBuild ? extraPluginsProd(terserOptions) : extraPluginsDev())
        ].filter(Boolean),

        devtool: devtool,

        ignoreWarnings: ignoreWarnings,

        // Inline dev-time configuration for webpack-dev-server.
        devServer: prodBuild
            ? undefined
            : {
                  https: devHttps,
                  host: devHost,
                  port: devWebpackPort,
                  hot: true,
                  client: {overlay: devClientOverlay},
                  open: env.devServerOpenPage ? [env.devServerOpenPage] : false,
                  // Support HTML5 history routes for apps, with /appName/ as the base route for each
                  historyApiFallback: {
                      rewrites: appNames.map(appName => {
                          return {
                              from: new RegExp(`^/${appName}`),
                              to: `/${appName}/index.html`
                          };
                      })
                  }
              }
    };
}

//------------------------
// Implementation
//------------------------
class HoistManifestPlugin {
    constructor(content = {}) {
        this.content = content;
    }

    apply(compiler) {
        const pluginName = HoistManifestPlugin.name,
            {Compilation} = compiler.webpack,
            {RawSource} = compiler.webpack.sources;

        // Tap into compilation hook which gives compilation as argument to the callback function
        compiler.hooks.compilation.tap(pluginName, compilation => {
            compilation.hooks.processAssets.tap(
                {
                    name: pluginName,
                    stage: Compilation.PROCESS_ASSETS_STAGE_SUMMARIZE
                },
                () => {
                    compilation.emitAsset(
                        '/public/manifest.json',
                        new RawSource(JSON.stringify(this.content))
                    );
                }
            );
        });
    }
}

const extraPluginsProd = terserOptions => {
    return [
        // Extract built CSS files into subdirectories by chunk / entry point name.
        new MiniCssExtractPlugin({
            filename: '[name]/[name].[contenthash:8].css'
        }),

        // Minify and tree-shake via Terser - https://github.com/terser/terser#readme
        new TerserPlugin({
            terserOptions: {
                // Mangling disabled due to intermittent / difficult to debug issues with it
                // breaking code, especially when run on already-packaged libraries. Disabling does
                // increase bundle size, although not by much on a relative basis.
                mangle: false,
                // As per docs "prevent discarding or mangling of function names" - most likely not
                // necessary w/mangling off, but leaving here as docs are a bit vague, and in case
                // we re-enable. We want to maintain function/class names for error messages.
                keep_fnames: true,

                compress: {
                    comparisons: false,
                    // See https://fontawesome.com/how-to-use/with-the-api/other/tree-shaking
                    collapse_vars: false
                },
                ...terserOptions
            }
        })
    ];
};

const extraPluginsDev = () => {
    return [
        // Avoid dev-time errors with mis-matched casing in imports (where a less case-sensitive OS
        // will resolve OK, but import could fail at build time with strict case sensitivity).
        new CaseSensitivePathsPlugin()
    ];
};

// Generate combinations for given chunkNames. Given a list of apps such as [admin, app, mobile],
// possible chunk combos will be of the form admin, admin~app, app~mobile, and so on...
function getChunkCombinations(appNames) {
    let ret = [];
    const combineRecursiveFn = (path, arr, sep) => {
        for (let i = 0; i < arr.length; i++) {
            const newPath = path + sep + arr[i];
            ret.push(newPath);
            combineRecursiveFn(newPath, arr.slice(i + 1), '~');
        }
    };
    combineRecursiveFn('', appNames, '');
    return ret;
}

function logSep() {
    console.log(':------------------------------------');
}

function logMsg(msg) {
    console.log(`: ${msg}`);
}

module.exports = configureWebpack;
