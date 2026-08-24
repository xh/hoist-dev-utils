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
    webpack = require('webpack'),
    BundleAnalyzerPlugin = require('webpack-bundle-analyzer').BundleAnalyzerPlugin,
    CaseSensitivePathsPlugin = require('case-sensitive-paths-webpack-plugin'),
    CopyWebpackPlugin = require('copy-webpack-plugin'),
    MiniCssExtractPlugin = require('mini-css-extract-plugin'),
    HtmlWebpackPlugin = require('html-webpack-plugin'),
    TerserPlugin = require('terser-webpack-plugin'),
    WebpackBar = require('webpackbar'),
    parseChangelogMarkdown = require('changelog-parser'),
    babelCorePkg = require('@babel/core/package'),
    devUtilsPkg = require('./package'),
    basePath = fs.realpathSync(process.cwd());

// These are not deps of hoist-dev-utils but of the consuming app, so resolve them from the
// app's own directory (basePath) - required under isolated/symlinked node_modules layouts
// (e.g. pnpm), where this package cannot resolve undeclared siblings. Might still be undefined -
// e.g. when running this script locally to debug via `pnpm link` / `yarn link`.
let hoistReactPkg, reactPkg;
try {
    hoistReactPkg = require(require.resolve('@xh/hoist/package.json', {paths: [basePath]}));
} catch (e) {
    hoistReactPkg = {version: 'NOT_FOUND'};
}
try {
    reactPkg = require(require.resolve('react/package.json', {paths: [basePath]}));
} catch (e) {
    reactPkg = {version: 'NOT_FOUND'};
}

/**
 * Consolidated Webpack configuration for both dev-time and production builds of Hoist React web
 * applications.
 *
 * Sample commands to run configurations produced by this method include:
 *      `webpack --env prodBuild --env appVersion=1.2.3` to trigger a build at version 1.2.3
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
 * @param {string} [env.baseUrl] - root path prepended to all relative URLs called via FetchService. Defaults to
 *      `/api/`, a root path that will cause the request to be proxied to the Grails backend at `devHost:devGrailsPort`.
 * @param {string[]} [env.babelIncludePaths] - additional paths to pass Babel for transpiling via settings shared with
 *      app-level and @xh/hoist code. Intended for custom packages.
 * @param {string[]} [env.babelExcludePaths] - paths to exclude from Babel transpiling. An example use would be a local
 *      package with a nested node_modules folder.
 * @param {Object[]} [env.extraModuleRules] - additional Webpack module rules, inserted into the build's `oneOf` list
 *      before the built-in markdown and catch-all asset rules. Use to handle app-specific file types, or to override
 *      default asset handling for a given extension (e.g. process `.svg` via `@svgr/webpack`, or `.md` via a markdown
 *      loader). Since `oneOf` is first-match-wins, rules here take precedence over the markdown and catch-all asset
 *      rules, but not over the built-in JS/TS/CSS/image rules. Any loaders referenced by these rules should be
 *      declared as devDependencies of the app itself - under isolated node_modules layouts (e.g. pnpm), loaders
 *      not declared by the app will fail to resolve.
 * @param {string} [env.contextRoot] - root path from which app will be served, used as the base path for static files.
 * @param {boolean} [env.copyPublicAssets=true] - true to copy the /client-app/public contents into the root of the
 *      build. Note that files within this directory will not be processed, named with a hash, etc. Use for static
 *      assets you wish to link to without using an import to run through Webpack's asset modules. Required for favicons.
 * @param {boolean} [env.parseChangelog=true] - true to parse a `CHANGELOG.md` file in the project root directory into
 *      JSON and make available for import by `XH.changelogService`.
 * @param {string} [env.favicon] - relative path to a primary favicon source image.
 * @param {Object} [env.manifestConfig] - override values for manifest.json file. This controls options related to
 *      adding a mobile app to a device home screen, as well as "installing" an app via Chrome's "create shortcut"
 *      option. See https://developer.mozilla.org/en-US/docs/Web/Manifest for options.
 * @param {string} [env.preloadBackgroundColor] - background color to use for the preloader spinner. Defaults to white.
 * @param {string} [env.preloadSpinnerColor] - stroke color for the preloader spinner SVG. Defaults to a neutral gray (#888).
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
 * @param {number} [env.devWebpackPort] - port on which to start webpack-dev-server. Dev-mode only.
 * @param {string} [env.devServerOpenPage] - path to auto-open when webpack-dev-server starts. Leave null to disable
 *      automatic page open on startup. Dev-mode only.
 *  @param {(boolean|Object)} [env.devHttps] - `true` to run webpack-dev-server locally over SSL w/o providing a cert
 *      (browser will warn). Or provide an object that will be passed to `devServer.server.options` to enable SSL and
 *      while specifying a custom cert/key. Default `false` runs locally over HTTP only. Dev-mode only.
 *  @param {Object} [env.devServerOptions] - options to spread onto / override defaults passed here to the devServer.
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
        devClientOverlay = env.devClientOverlay ?? {
            errors: true,
            warnings: false,
            runtimeErrors: false
        },
        devHost = env.devHost ? env.devHost.toLowerCase() : 'localhost',
        devHttps = prodBuild ? null : _.isPlainObject(env.devHttps) ? env.devHttps : !!env.devHttps,
        devGrailsPort = env.devGrailsPort || 8080,
        devWebpackPort = env.devWebpackPort || 3000,
        devServerOptions = env.devServerOptions || {},
        baseUrl = env.baseUrl || '/api/',
        babelIncludePaths = (env.babelIncludePaths || []).map(safeRealpath),
        babelExcludePaths = (env.babelExcludePaths || []).map(safeRealpath),
        extraModuleRules = env.extraModuleRules || [],
        contextRoot = env.contextRoot || '/',
        copyPublicAssets = env.copyPublicAssets !== false,
        parseChangelog = env.parseChangelog !== false,
        favicon = env.favicon || null,
        manifestConfig = env.manifestConfig || {},
        preloadBackgroundColor = env.preloadBackgroundColor || 'white',
        preloadSpinnerColor = env.preloadSpinnerColor || '#888',
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
        // This very file lives within the dev-utils package, wherever it has been installed or
        // linked - avoids assuming the package is physically within the app's node_modules.
        hoistDevUtilsPath = __dirname;

    // Resolve Hoist as either a sibling (inline, checked-out) project or a downloaded package.
    // Resolve symlinks (a no-op for flat layouts) so the path matches the real module paths
    // Webpack produces via its default resolve.symlinks behavior - required for the babel-loader
    // include below to match under symlinking package managers (e.g. pnpm).
    const hoistPath = safeRealpath(
        inlineHoist
            ? path.resolve(basePath, '../../hoist-react')
            : path.resolve(basePath, 'node_modules/@xh/hoist')
    );

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

    // Generate lightweight stub modules for Blueprint icons, unless app opts into the full set.
    const loadAllBlueprintJsIcons = env.loadAllBlueprintJsIcons === true,
        bpIconStubs = loadAllBlueprintJsIcons ? null : generateBlueprintIconStubs();

    // Tell webpack where to look for modules when resolving imports - this is the key to getting
    // inlineHoist mode to look in within the checked-out hoist-react project at hoistPath.
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
        clientApps = fs
            .readdirSync(appDirPath)
            .filter(f => f.endsWith('.js') || f.endsWith('.ts'))
            .map(f => {
                return {
                    name: f.replace('.js', '').replace('.ts', ''),
                    path: path.resolve(appDirPath, f)
                };
            }),
        clientAppNames = clientApps.map(it => it.name);

    // Build Webpack entry config, with keys for each JS app to be bundled.
    const appEntryPoints = {};
    clientApps.forEach(clientApp => {
        // Ensure core-js and regenerator-runtime both imported for every app bundle - they are
        // specified as dependencies by Hoist and imported once in its polyfills.js file.
        appEntryPoints[clientApp.name] = [
            path.resolve(hoistPath, 'static/polyfills.js'),
            clientApp.path
        ];
    });

    logSep();
    logMsg('🎁  App bundle entry points:');
    clientAppNames.forEach(it => logMsg(`  > ${it}`));
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
            filename: '[name].[chunkhash:8].js',
            path: outPath,
            // (URL) path on which fully built app is served - i.e. root context
            publicPath: contextRoot,
            pathinfo: !prodBuild,
            clean: true
        },

        optimization: {
            // Disabled for performance, and to take upcoming default in next major version (as per
            // https://webpack.js.org/configuration/optimization/#optimizationremoveavailablemodules)
            removeAvailableModules: false,

            // Disable package.json `sideEffects` based tree-shaking - was getting inconsistent
            // results, with imports being dropped seemingly at random.
            sideEffects: false,

            // Produce chunks for any shared imports across JS apps.
            splitChunks: {
                chunks: 'all'
            },

            // Improved debugging with readable module/chunk names.
            chunkIds: 'named',
            moduleIds: 'named'
        },

        resolve: {
            alias: resolveAliases,
            // Extensions tried, in order, for imports that do not specify one. Imports that
            // *do* include an extension (e.g. `import './foo.png'`) always resolve as written.
            extensions: ['.js', '.ts', '.jsx', '.tsx', '.json']
        },

        // Fallback resolution for any loaders referenced by bare name (e.g. via app-supplied
        // extraModuleRules) - checks the app's top-level node_modules (standard case) and any
        // nested dev-utils node_modules (in case of version conflict - triggered for us in Dec
        // 2020 by postcss-loader version bump). Built-in loaders above are require.resolve()d to
        // absolute paths and do not rely on this.
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
                        // Inline as a data URI when small enough, otherwise emit a hashed file.
                        // Uses Webpack 5 asset modules (replaces the deprecated url-loader).
                        //------------------------
                        {
                            test: [/\.bmp$/, /\.gif$/, /\.jpe?g$/, /\.png$/],
                            type: 'asset',
                            parser: {dataUrlCondition: {maxSize: 10000}},
                            generator: {filename: 'static/media/[name].[hash:8][ext]'}
                        },

                        //------------------------
                        // JS/TS processing
                        // Transpile via Babel, with presets/plugins to support Hoist's use of modern / staged JS features.
                        //------------------------
                        {
                            test: /\.(jsx?)$|\.(tsx?)$/,
                            use: {
                                // Loaders, presets and plugins below are deps of this package and
                                // resolved from here via require.resolve() - apps do not get them
                                // hoisted to their own node_modules under all layouts (e.g. pnpm).
                                loader: require.resolve('babel-loader'),
                                options: {
                                    presets: [
                                        require.resolve('@babel/preset-typescript'),
                                        require.resolve('@babel/preset-react'),
                                        [
                                            require.resolve('@babel/preset-env'),
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

                                                // Interop transforms required while legacy
                                                // decorators are in use - Babel must compile the
                                                // class elements it decorates. Remove when Hoist
                                                // moves off `version: 'legacy'` decorators.
                                                include: [
                                                    'transform-class-properties',
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
                                            require.resolve('@babel/plugin-transform-typescript'),
                                            {allowDeclareFields: true, isTSX: true}
                                        ],

                                        // Support our current decorator syntax, for MobX and Hoist decorators.
                                        // See notes @ https://babeljs.io/docs/en/babel-plugin-proposal-decorators#legacy
                                        // and https://mobx.js.org/enabling-decorators.html#babel-7
                                        [
                                            require.resolve('@babel/plugin-proposal-decorators'),
                                            {version: 'legacy'}
                                        ],

                                        // Avoid importing every FA icon ever made.
                                        // See https://github.com/FortAwesome/react-fontawesome/issues/70
                                        [
                                            require.resolve('babel-plugin-transform-imports'),
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
                                prodBuild
                                    ? MiniCssExtractPlugin.loader
                                    : {
                                          loader: require.resolve('style-loader'),
                                          options: {esModule: false}
                                      },

                                // 2) Resolve @imports within CSS, similar to module support in JS.
                                {
                                    loader: require.resolve('css-loader'),
                                    options: {
                                        importLoaders: 2, // Indicate how many prior loaders (postCssLoader/sassLoader) to also run on @imported resources.
                                        sourceMap: true,
                                        esModule: false
                                    }
                                },

                                // 1) Pre-process CSS to install vendor-specific prefixes for the configured browsers.
                                //    Note that the "post" in the loader name refers to http://postcss.org/ - NOT the processing order within Webpack.
                                {
                                    loader: require.resolve('postcss-loader'),
                                    options: {
                                        postcssOptions: {
                                            plugins: [
                                                [
                                                    require.resolve('autoprefixer'),
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
                                {loader: require.resolve('sass-loader')}
                            ]
                        },

                        // App-supplied rules, ahead of the built-in markdown and catch-all rules so
                        // they can claim specific file types (or override default asset handling).
                        ...extraModuleRules,

                        //------------------------
                        // Markdown
                        // Import resolves to the file's raw text content (asset/source), so it can be
                        // rendered directly - e.g. via Hoist's `markdown` component - without a fetch.
                        // Append `?url` to a specific import to get an emitted-file URL instead (e.g.
                        // for a large doc to be loaded lazily): `import url from './big.md?url'`.
                        //------------------------
                        {
                            test: /\.md$/,
                            resourceQuery: /url/,
                            type: 'asset/resource',
                            generator: {filename: 'static/media/[name].[hash:8][ext]'}
                        },
                        {
                            test: /\.md$/,
                            type: 'asset/source'
                        },

                        //------------------------
                        // Fall-through entry to emit all other assets (e.g. SVGs, fonts) as hashed
                        // files. Uses Webpack 5 asset modules (replaces the deprecated file-loader).
                        // (Exclude config here is from CRA source config - commented there, but didn't understand).
                        //------------------------
                        {
                            exclude: [/\.jsx?$/, /\.html$/, /\.json$/],
                            type: 'asset/resource',
                            generator: {filename: 'static/media/[name].[hash:8][ext]'}
                        }
                    ]
                }
            ].filter(Boolean)
        },

        plugins: [
            // Load only the BlueprintJS icons used by Hoist-React components - swap the icon
            // package entry and path barrels for generated stubs. See generateBlueprintIconStubs().
            ...(bpIconStubs
                ? [
                      new webpack.NormalModuleReplacementPlugin(
                          /@blueprintjs[\\/]icons[\\/]lib[\\/]esm[\\/]generated[\\/]index\.js$/,
                          bpIconStubs.entry
                      ),
                      new webpack.NormalModuleReplacementPlugin(
                          /@blueprintjs[\\/]icons[\\/]lib[\\/]esm[\\/]generated[\\/]16px[\\/]paths[\\/]index\.js$/,
                          bpIconStubs.paths16
                      ),
                      new webpack.NormalModuleReplacementPlugin(
                          /@blueprintjs[\\/]icons[\\/]lib[\\/]esm[\\/]generated[\\/]20px[\\/]paths[\\/]index\.js$/,
                          bpIconStubs.paths20
                      )
                  ]
                : []),

            // Inject global constants at compile time.
            new webpack.DefinePlugin({
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
            }),

            // Avoid bundling all moment.js locales and blowing up the bundle size
            // See https://github.com/jmblog/how-to-optimize-momentjs-with-webpack
            new webpack.IgnorePlugin({
                resourceRegExp: /^\.\/locale$/,
                contextRegExp: /moment$/
            }),

            // Copy /public directories from HR and App into the output - App files should win.
            // Note that this includes preflight.js from HR, injected into index.html below.
            new CopyWebpackPlugin({
                patterns: _.compact([
                    {from: path.resolve(hoistPath, 'public'), to: 'public'},
                    copyPublicAssets
                        ? {from: path.resolve(basePath, 'public'), to: 'public'}
                        : undefined
                ])
            }),

            // Generate HTML index pages - one per JS app.
            ...clientAppNames.map(clientAppName => {
                return new HtmlWebpackPlugin({
                    title: appName,
                    favicon: favicon,
                    template: path.resolve(hoistDevUtilsPath, `static/index.html`),
                    filename: `${clientAppName}/index.html`,

                    // Take 0 chunks from plugin, because we collect just the ones for the jsAppName
                    // below in templateParameters
                    chunks: [],

                    // No need to ever cache here, either in production or development
                    cache: false,

                    // This will provide the html tag strings for just the css and js that jsAppName uses.
                    templateParameters: (compilation, assets, assetTags, options) => {
                        const {styleTags, scriptTags} = getFileDependenciesByEntrypoint(
                            compilation,
                            clientAppName
                        );

                        return {
                            // Base output recommended by plugin example:
                            // https://github.com/jantimon/html-webpack-plugin/blob/main/examples/template-parameters/webpack.config.js
                            compilation,
                            webpackConfig: compilation.options,
                            htmlWebpackPlugin: {
                                tags: assetTags,
                                files: assets,
                                options
                            },
                            // XH additions
                            styleTags,
                            scriptTags,
                            clientAppName,
                            preloadBackgroundColor,
                            preloadSpinnerColor,
                            // Compilation hash used to cache-bust the (unbundled) preflight script
                            // copied in from hoist-react via CopyWebpackPlugin.
                            preflightHash: compilation.hash
                        };
                    },
                    // No need to minify the HTML itself
                    minify: false,
                    // Flag read within template file to include apple icon.
                    includeAppleIcon: appleTouchIconExists
                });
            }),

            // Create a manifest.json for each app. The icon choices here work with the favicon provided
            // to HtmlWebpackPlugin above to match the spec here:
            // https://evilmartians.com/chronicles/how-to-favicon-in-2021-six-files-that-fit-most-needs
            ...clientAppNames.map(clientAppName => {
                return new HoistManifestPlugin(clientAppName, {
                    name: appName,
                    short_name: appName,
                    description: `${appName} - ${appVersion}`,
                    display: 'standalone',
                    orientation: 'any',
                    background_color: preloadBackgroundColor, // ignored by Safari, but also used within index.html
                    theme_color: '#212121', // off-black from default `--xh-black` CSS var
                    icons: manifestIcons,
                    ...manifestConfig
                });
            }),

            // Support an optional post-build/run interactive treemap of output bundles and their sizes / contents.
            analyzeBundles
                ? new BundleAnalyzerPlugin({
                      analyzerMode: 'server'
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
                  host: devHost,
                  port: devWebpackPort,
                  hot: true, // Hot module replacement is only supported for SCSS. JS/TS files trigger live reload.
                  client: {overlay: devClientOverlay},
                  server:
                      devHttps === true
                          ? {type: 'https'}
                          : _.isPlainObject(devHttps)
                            ? {type: 'https', options: {...devHttps}}
                            : undefined,
                  open: env.devServerOpenPage ? [env.devServerOpenPage] : false,
                  // Support HTML5 history routes for apps, with /appName/ as the base route for each
                  historyApiFallback: {
                      rewrites: clientAppNames.map(appName => {
                          return {
                              from: new RegExp(`^/${appName}`),
                              // helps cache busting during live reload in development
                              to: `/${appName}/index.html?_=${Date.now()}`
                          };
                      })
                  },
                  // Proxy API requests to the Grails backend, mirroring the production nginx setup.
                  // Only needed when baseUrl is a relative path (default '/api/') — if baseUrl is
                  // an absolute URL, the app will call the remote server directly.
                  proxy: baseUrl.startsWith('/')
                      ? [
                            {
                                context: baseUrl.slice(0, -1),
                                target: `http://${devHost}:${devGrailsPort}`,
                                pathRewrite: {[`^${baseUrl.slice(0, -1)}`]: ''},
                                changeOrigin: true,
                                secure: false,
                                ws: true
                            }
                        ]
                      : [],
                  ...devServerOptions
              }
    };
}

//------------------------
// Implementation
//------------------------
class HoistManifestPlugin {
    constructor(clientAppName, content = {}) {
        this.clientAppName = clientAppName;

        // We create one of these per clientApp. Default start_url to the clientApp's root, to bring user back to the
        // clientApp from which they added the bookmark without any need for redirects, respecting possible override.
        if (!content.start_url) {
            content = {...content, start_url: `/${clientAppName}/`};
        }

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
                    // Emit client-app specific manifest.json within /public, to avoid issues with deeper routes
                    // and relative paths. This is picked up by this project's /static/index.html template.
                    compilation.emitAsset(
                        `/public/${this.clientAppName}/manifest.json`,
                        new RawSource(JSON.stringify(this.content, null, 2))
                    );
                }
            );
        });
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
 * bundle of every app. Blueprint marks its JS side-effect-free, but this config disables
 * webpack's `sideEffects`-based module pruning (see `optimization` above), so the unused
 * re-exports ride the static import graph into the bundle.
 *
 * Stubs are generated at build time with absolute-path imports resolved against the app's own
 * copy of @blueprintjs/icons, so they remain correct across package managers (including pnpm's
 * isolated layout, where this package cannot resolve undeclared siblings) and across icon
 * package versions. Any Blueprint component importing an icon outside the whitelist will fail
 * the build loudly (`strictExportPresence`) - extend the list above, or have the app opt out
 * via `env.loadAllBlueprintJsIcons`.
 */
const generateBlueprintIconStubs = () => {
    let iconsPath;
    try {
        iconsPath = path.dirname(
            require.resolve('@blueprintjs/icons/package.json', {paths: [basePath]})
        );
    } catch (e) {
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

const extraPluginsProd = terserOptions => {
    return [
        // Extract built CSS files into subdirectories by chunk / entry point name.
        new MiniCssExtractPlugin({
            filename: '[name].[contenthash:8].css'
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

// Resolves the specific script + style chunks required by a given client app entry point, to be injected into
// the generated HTML index page for that client app.
function getFileDependenciesByEntrypoint(compilation, clientAppName) {
    const ret = {scriptTags: '', styleTags: ''};
    compilation.entrypoints
        .get(clientAppName)
        .getFiles()
        .forEach(file => {
            const ext = path.extname(file).slice(1);
            if (ext === 'js') {
                ret.scriptTags += `<script defer src="/${file}"></script>`;
            } else if (ext === 'css') {
                ret.styleTags += `<link rel="stylesheet" href="/${file}" />`;
            }
        });

    return ret;
}

// Resolve any symlinks to a real path, falling back to the given path if it does not (yet)
// exist. No-op for flat/hoisted node_modules layouts. Required so that paths used within
// loader include/exclude rules match the real module paths produced by Webpack's default
// resolve.symlinks behavior under symlinking package managers (e.g. pnpm).
function safeRealpath(p) {
    try {
        return fs.realpathSync(p);
    } catch (e) {
        return p;
    }
}

function logSep() {
    console.log(':------------------------------------');
}

function logMsg(msg) {
    console.log(`: ${msg}`);
}

module.exports = configureWebpack;
