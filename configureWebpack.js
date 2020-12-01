/*
 * This file belongs to Hoist, an application development toolkit
 * developed by Extremely Heavy Industries (www.xh.io | info@xh.io)
 *
 * Copyright © 2020 Extremely Heavy Industries Inc.
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
    FaviconsWebpackPlugin = require('favicons-webpack-plugin'),
    HtmlWebpackPlugin = require('html-webpack-plugin'),
    HtmlWebpackTagsPlugin = require('html-webpack-tags-plugin'),
    TerserPlugin = require('terser-webpack-plugin'),
    WebpackBar = require('webpackbar'),
    DuplicatePackageCheckerPlugin = require('duplicate-package-checker-webpack-plugin'),
    babelCorePkg = require('@babel/core/package'),
    devUtilsPkg = require('./package'),
    basePath = fs.realpathSync(process.cwd());

// These are not direct deps of hoist-dev-utils, so might be undefined - e.g. when running
// this script locally to debug via `yarn link`.
let hoistReactPkg, reactPkg;
try {hoistReactPkg = require('@xh/hoist/package')} catch (e) {hoistReactPkg = {version: 'NOT_FOUND'}}
try {reactPkg = require('react/package')} catch (e) {reactPkg = {version: 'NOT_FOUND'}}

/**
 * Consolidated Webpack configuration for both dev-time and production builds of Hoist React web applications.
 *
 * Sample commands to run configurations produced by this method include:
 *      `webpack --env.prodBuild --env.appVersion=1.2.3` to trigger a build at version 1.2.3
 *      `webpack-dev-server --env.inlineHoist` to run webpack dev server w/hoist-react in inline mode
 *
 * @param {Object} env - config passed in from app webpack config or the CLI via --env flags.
 * @param {string} env.appCode - short, internal code for the application - baked into client as
 *      XH.appCode. Should be lowercase, dash-separated, and should match the Gradle project name
 *      (e.g. portfolio-manager).
 * @param {string} [env.appName] - user-facing display name for the application - baked into client
 *      as XH.appName. Should be title cased and space-separated. If null, will be defaulted based
 *      on appCode (e.g. portfolio-manager -> Portfolio Manager).
 * @param {string} [env.appVersion] - client version - baked into client as XH.appVersion
 * @param {string} [env.appBuild] - build/git tag - baked into client as XH.appBuild
 * @param {boolean} [env.prodBuild=false] - true to indicate this is a build (as opposed to run of
 *      webpack-dev-server)
 * @param {boolean} [env.inlineHoist=false] - true to use a locally checked-out copy of hoist-react
 *      when running the dev server, as opposed to using the downloaded dependency. This allows
 *      hoist-react developers to test plugin changes. Dev-mode only.
 * @param {boolean} [env.inlineHoistOpenFin=false] - true to use a locally checked-out copy of the
 *      hoist-openfin plugin - as with `inlineHoist` above. Dev-mode only.
 * @param {string} env.agGridLicenseKey - key for ag-Grid enterprise license purchased / supplied
 *      for this application and your organization. Applicable only to Hoist React v34 and prior -
 *      as of v35 license key management is now handled exclusively within the application codebase.
 * @param {Object} [env.resolveAliases] - object mapping for custom webpack module resolution.
 *      When inlineHoist=true, a mapping between @xh/hoist and the local path will be added.
 * @param {boolean} [env.analyzeBundles=false] - true to launch an interactive bundle analyzer to
 *      review output bundles, contents, and sizes.
 * @param {boolean} [env.checkForDupePackages=true] - true (default) to run build through
 *      DuplicatePackageCheckerPlugin and output a build-time console warning if duplicate packages
 *      have been resolved due to non-overlapping dependencies. Set to false to disable if dupe
 *      warnings are not desired / distracting.
 * @param {string[]} [env.dupePackageCheckExcludes] - optional list of string package names to
 *      exclude from dupe package checking. Defaults to ['tslib'].
 * @param {string} [env.baseUrl] - root path prepended to all relative URLs called via FetchService
 *      (the core Hoist service for making Ajax requests). Defaults to `/api/` in production mode to
 *      work with proxy-based deployments and to `$devHost:$devGrailsPort` in dev mode.
 *      This should not typically need to be changed at the app level.
 * @param {string[]} [env.babelIncludePaths] - additional paths to pass Babel for transpiling via
 *      settings shared with app-level and @xh/hoist code. Intended for custom packages.
 * @param {string[]} [env.babelExcludePaths] - paths to exclude from Babel transpilation. An example
 *      use would be a local package with a nested node_modules folder.
 * @param {string} [env.contextRoot] - root path for where the app will be served, used as the base
 *      path for static files.
 * @param {boolean} [env.copyPublicAssets] - true (default) to copy the /client-app/public directory
 *      and its contents into the root of the build. Note that files within this directory will not
 *      be otherwise processed, named with a hash, etc. Use for static assets you wish to link to
 *      without using an import to run through the url or file-loader.
 * @param {string} [env.favicon] - relative path to a favicon source image to be processed.
 * @param {string} [env.stats] - stats output - see https://webpack.js.org/configuration/stats/.
 * @param {string} [env.devHost] - hostname for both local Grails and Webpack dev servers.
 *      Defaults to localhost, but may be overridden to a proper hostname for testing on alternate
 *      workstations or devices. Will be automatically set to lowercase to comply with
 *      webpack-dev-server's host checking. Dev-mode only.
 * @param {number} [env.devGrailsPort] - port of local Grails server. Dev-mode only.
 * @param {number} [env.devWebpackPort] - port on which to start webpack-dev server. Dev-mode only.
 * @param {string} [env.devServerOpenPage] - path to auto-open when webpack-dev-server starts.
 *      Leave null to disable automatic page open on startup.
 * @param {string[]} [env.targetBrowsers] - array of browserslist queries specifying target browsers
 *      for Babel and CSS transpilation and processing.
 * @param {Object} [env.babelPresetEnvOptions] - options to spread onto / override defaults passed
 *      here to the Babel loader preset-env preset config.
 * @param {Object} [env.terserOptions] - options to spread onto / override defaults passed here to
 *      the Terser minification plugin for production builds.
 * @param {boolean} [env.loadAllBlueprintJsIcons] - false (default) to only load the BlueprintJs
 *      icons required by Hoist React components, resulting in a much smaller bundle size. Set to
 *      true if your app wishes to access all the BP icons (but consider FontAwesome instead!).
 */
function configureWebpack(env) {
    if (!env.appCode) throw 'Missing required "appCode" config - cannot proceed';

    const appCode = env.appCode,
        appName = env.appName || _.startCase(appCode),
        appVersion = env.appVersion || '1.0-SNAPSHOT',
        appBuild = env.appBuild || 'UNKNOWN',
        prodBuild = env.prodBuild === true,
        inlineHoist = !prodBuild && env.inlineHoist === true,
        inlineHoistOpenFin = !prodBuild && env.inlineHoistOpenFin === true,
        resolveAliases = Object.assign({}, env.resolveAliases),
        analyzeBundles = env.analyzeBundles === true,
        checkForDupePackages = env.checkForDupePackages !== false,
        dupePackageCheckExcludes = env.dupePackageCheckExcludes || ['tslib'],
        devHost = (env.devHost ? env.devHost.toLowerCase() : 'localhost'),
        devGrailsPort = env.devGrailsPort || 8080,
        devWebpackPort = env.devWebpackPort || 3000,
        baseUrl = env.baseUrl || (prodBuild ? '/api/' : `http://${devHost}:${devGrailsPort}/`),
        babelIncludePaths = env.babelIncludePaths || [],
        babelExcludePaths = env.babelExcludePaths || [],
        contextRoot = env.contextRoot || '/',
        copyPublicAssets = env.copyPublicAssets !== false,
        favicon = env.favicon || null,
        stats = env.stats || 'errors-only',
        targetBrowsers = env.targetBrowsers || [
            'last 2 Chrome versions',
            'last 2 Safari versions',
            'last 2 iOS versions',
            // TODO - review the specific Edge versions we need to support.
            //  Edge 17 triggered installation of numerous additional polyfills, hence this
            //  specification of v18+ vs "last two versions".
            'Edge >= 18'
        ],
        babelPresetEnvOptions = env.babelPresetEnvOptions || {},
        terserOptions = env.terserOptions || {},
        buildDate = new Date();

    process.env.BABEL_ENV = prodBuild ? 'production' : 'development';
    process.env.NODE_ENV = prodBuild ? 'production' : 'development';

    logSep();
    logMsg(`Building ${appName} v${appVersion}`);
    if (appBuild != 'UNKNOWN') logMsg(`  Build ${appBuild}`);
    logMsg(`  ${buildDate.toISOString()}`);
    logSep();
    if (prodBuild) logMsg('🚀  Production build enabled');
    if (!prodBuild) logMsg('💻  Development mode enabled');
    if (inlineHoist) logMsg('🏗️   Inline Hoist enabled');
    if (inlineHoistOpenFin) logMsg('🏗️   Inline Hoist-OpenFin enabled');
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
    logSep();

    const srcPath = path.resolve(basePath, 'src'),
        outPath = path.resolve(basePath, 'build'),
        publicPath = contextRoot;  // Path on which fully built app is served - i.e. root context

    // Resolve Hoist as either a sibling (inline, checked-out) project or a downloaded package dependency
    const hoistPath = inlineHoist ?
        path.resolve(basePath, '../../hoist-react') :
        path.resolve(basePath, 'node_modules/@xh/hoist');

    // Resolve Hoist-based path to replacement Blueprint icons (if available, requires HR >= v35.2.
    const bpIconStubsPath = path.resolve(hoistPath, 'static/requiredBlueprintIcons.js'),
        bpIconStubsExist = fs.existsSync(bpIconStubsPath),
        loadAllBlueprintJsIcons = env.loadAllBlueprintJsIcons === true || !bpIconStubsExist;

    // Resolve path to script for preflight checks. With HR >= v36.1 this routine has been broken
    // out into a standalone JS file to avoid the use of inline script tags. Script will be left
    // unprocessed/unbundled and injected into HTML index files prior to any bundles.
    const preflightScriptPath = path.resolve(hoistPath, 'static/preflight.js'),
        preflightScriptExists = fs.existsSync(preflightScriptPath);

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
    const hoistNodeModulesPath = inlineHoist ?
        path.resolve(hoistPath, 'node_modules') :
        null;

    // Also get a handle on the nested @xh/hoist-dev-utils/node_modules path - dev-utils dependencies
    // (namely loaders) can be installed here due to the vagaries of node module version / conflict resolution.
    const devUtilsNodeModulesPath = path.resolve(basePath, 'node_modules/@xh/hoist-dev-utils/node_modules');

    // Resolve app entry points - one for each file within src/apps/ - to create bundle entries below.
    const appDirPath = path.resolve(srcPath, 'apps'),
        apps = fs
            .readdirSync(appDirPath)
            .filter(f => f.endsWith('.js'))
            .map(f => {
                return {
                    name: f.replace('.js', ''),
                    path: path.resolve(appDirPath, f)
                };
            }),
        appNames = apps.map(it => it.name);

    // Build Webpack entry config, with keys for each JS app to be bundled.
    const appEntryPoints = {};
    apps.forEach(app => {
        // Ensure core-js and regenerator-runtime both imported for every app bundle - they are
        // specified as dependencies by Hoist and imported once in its polyfills.js file.
        appEntryPoints[app.name] = [
            path.resolve(hoistPath, 'static/polyfills.js'),
            app.path
        ];
    });

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
            filename: prodBuild ? '[name]/[name].[chunkhash:8].js' : '[name]/[name].[hash:8].js',
            path: outPath,
            publicPath: publicPath,
            pathinfo: !prodBuild,
            // Point sourcemap entries to original disk location (format as URL on Windows) - from CRA.
            devtoolModuleFilenameTemplate: info => path.resolve(info.absoluteResourcePath).replace(/\\/g, '/')
        },

        optimization: {
            noEmitOnErrors: true,

            // Aggressive chunking strategy - produces chunks for any shared imports across JS apps.
            splitChunks: {
                chunks: 'all',
                minSize: 0
            },

            // Improved debugging with readable module/chunk names.
            namedChunks: true,
            namedModules: true
        },

        resolve: {
            alias: resolveAliases,
            // Add JSX to support imports from .jsx source w/o needing to add the extension.
            // Include "*" to continue supporting other imports that *do* specify an extension
            // within the import statement (i.e. `import './foo.png'`). Yes, it's confusing.
            extensions: ['*', '.js', '.jsx', '.json']
        },

        // Ensure Webpack can find loaders installed both within the top-level node_modules dir for
        // an app that's building (standard case) or nested within dev-utils node_modules (in case
        // of version conflict - triggered for us in Dec 2020 by postcss-loader version bump).
        resolveLoader: {
            modules: ['node_modules', devUtilsNodeModulesPath]
        },

        stats: stats,

        module: {
            // Flag missing exports as a failure vs. warning
            strictExportPresence: true,

            rules: [
                {
                    oneOf: [

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
                        // JS processing
                        // Transpile via Babel, with presets/plugins to support Hoist's use of modern / staged JS features.
                        //------------------------
                        {
                            test: /\.(jsx?)$/,
                            use: {
                                loader: 'babel-loader',
                                options: {
                                    presets: [
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

                                                // Allow direct overrides from env config.
                                                ...babelPresetEnvOptions
                                            }
                                        ]
                                    ],
                                    plugins: [
                                        // Support our current decorator syntax, for MobX and Hoist decorators.
                                        // See notes @ https://babeljs.io/docs/en/babel-plugin-proposal-decorators#legacy
                                        ['@babel/plugin-proposal-decorators', {legacy: true}],

                                        // Support classes level fields - must come after decorators plugin and be loose.
                                        ['@babel/plugin-proposal-class-properties', {loose: true}],

                                        // Support `let x = foo?.bar`.
                                        ['@babel/plugin-proposal-optional-chaining'],

                                        // Support `let x = foo.bar ?? 'default'`.
                                        ['@babel/plugin-proposal-nullish-coalescing-operator'],

                                        // Avoid importing every FA icon ever made.
                                        // See https://github.com/FortAwesome/react-fontawesome/issues/70
                                        [require('babel-plugin-transform-imports'), {
                                            '@fortawesome/pro-light-svg-icons': {
                                                transform: '@fortawesome/pro-light-svg-icons/${member}',
                                                skipDefaultConversion: true
                                            },
                                            '@fortawesome/pro-regular-svg-icons': {
                                                transform: '@fortawesome/pro-regular-svg-icons/${member}',
                                                skipDefaultConversion: true
                                            },
                                            '@fortawesome/pro-solid-svg-icons': {
                                                transform: '@fortawesome/pro-solid-svg-icons/${member}',
                                                skipDefaultConversion: true
                                            },
                                            '@fortawesome/free-brands-svg-icons': {
                                                transform: '@fortawesome/free-brands-svg-icons/${member}',
                                                skipDefaultConversion: true
                                            }
                                        }]
                                    ],
                                    // Cache for dev builds, don't bother compressing.
                                    cacheDirectory: !prodBuild,
                                    cacheCompression: false
                                }
                            },

                            // Always transpile Hoist - even when "packaged" we have the raw source as we are not
                            // currently transpiling anything in hoist-react on its own.
                            include: [srcPath, hoistPath, ...babelIncludePaths],
                            // In inline mode also *avoid* transpiling inline hoist's own node_modules libraries.
                            exclude: inlineHoist ? [hoistNodeModulesPath, ...babelExcludePaths] : babelExcludePaths
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
                                        sourceMap: true
                                    }
                                },

                                // 1) Pre-process CSS to install flexbox bug workarounds + vendor-specific prefixes for the configured browsers
                                //    Note that the "post" in the loader name refers to http://postcss.org/ - NOT the processing order within Webpack.
                                {
                                    loader: 'postcss-loader',
                                    options: {
                                        postcssOptions: {
                                            plugins: [
                                                require('postcss-flexbugs-fixes'),  // Inclusion of postcss-flexbugs-fixes is from CRA.
                                                ['autoprefixer', {
                                                    // We still want to provide an array of target browsers
                                                    // that can be passed to / managed centrally by this script.
                                                    overrideBrowserslist: targetBrowsers,
                                                    flexbox: 'no-2009'
                                                }]
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
            !loadAllBlueprintJsIcons ? new webpack.NormalModuleReplacementPlugin(
                /.*\/generated\/iconSvgPaths.*/,
                bpIconStubsPath,
            ) : undefined,

            // Inject global constants at compile time.
            new webpack.DefinePlugin({
                'process.env': {NODE_ENV: JSON.stringify(process.env.NODE_ENV)},
                xhAppCode: JSON.stringify(appCode),
                xhAppName: JSON.stringify(appName),
                xhAppVersion: JSON.stringify(appVersion),
                xhAppBuild: JSON.stringify(appBuild),
                xhBaseUrl: JSON.stringify(baseUrl),
                xhAgGridLicenseKey: JSON.stringify(env.agGridLicenseKey),
                xhBuildTimestamp: buildDate.getTime(),
                xhIsDevelopmentMode: !prodBuild
            }),

            // Avoid bundling all moment.js locales and blowing up the bundle size
            // See https://github.com/jmblog/how-to-optimize-momentjs-with-webpack
            new webpack.IgnorePlugin(/^\.\/locale$/, /moment$/),


            // Copy the /client-app/public directory and any contents into the build output if so
            // configured. Also copy static preflight script if available.
            new CopyWebpackPlugin({
                patterns: _.compact([
                    copyPublicAssets ? {from: path.resolve(basePath, 'public'), to: 'public'} : undefined,
                    preflightScriptExists ? {from: preflightScriptPath, to: 'public'} : undefined
                ])
            }),

            // Generate HTML index pages - one per JS app.
            ...appNames.map(jsAppName => {
                // Exclude all chunk combos not containing this app, which we currently generate as
                // plugin doesn't have an include-by-regex feature (at least not one we have found).
                const otherAppNames = appNames.filter(it => it !== jsAppName),
                    excludeAssets = getChunkCombinations(otherAppNames),
                    // Presence of preflight script indicates we can use the index template variant
                    // supplied by hoist-react *without* any inline scripts.
                    templateFilename = preflightScriptExists ? 'index-no-inline.html' : 'index.html';

                return new HtmlWebpackPlugin({
                    title: appName,
                    // Note: HTML template is sourced from hoist-react.
                    template: path.resolve(hoistPath, `static/${templateFilename}`),
                    filename: `${jsAppName}/index.html`,
                    excludeChunks: excludeAssets,
                    minify: false  // no need to minify the HTML itself
                });
            }),

            // Insert a script tag for the (unbundled) preflight script, before all other scripts.
            preflightScriptExists ? new HtmlWebpackTagsPlugin({
                // Script available at this path via CopyWebpackPlugin above.
                scripts: ['public/preflight.js'],
                append: false,
                hash: true
            }) : undefined,

            // Generate favicons from source image if provided - injected into generated HTML.
            favicon ? new FaviconsWebpackPlugin({
                logo: favicon,
                prefix: 'icons-[hash:8]/',
                inject: true,
                mode: 'webapp',
                favicons: {
                    icons: {
                        android: true,
                        appleIcon: true,
                        appleStartup: false,
                        coast: false,
                        favicons: true,
                        firefox: false,
                        windows: true,
                        yandex: false
                    }
                }
            }) : undefined,

            // Support an optional post-build/run interactive treemap of output bundles and their sizes / contents.
            analyzeBundles ? new BundleAnalyzerPlugin({
                analyzerMode: 'server'
            }) : undefined,

            // Warn on dupe package included in bundle due to multiple, conflicting versions.
            checkForDupePackages ? new DuplicatePackageCheckerPlugin({
                verbose: true,
                showHelp: false,
                strict: false,
                exclude: (instance) => dupePackageCheckExcludes.includes(instance.name)
            }) : undefined,

            // Display build progress - enable profile for per-loader/file type stats.
            new WebpackBar({
                color: '#ec7316',
                profile: true
            }),

            // Environment-specific plugins.
            ...(prodBuild ? extraPluginsProd(terserOptions) : extraPluginsDev())

        ].filter(Boolean),

        devtool: prodBuild ? 'source-map' : 'eval-source-map',

        // Inline dev-time configuration for webpack-dev-server.
        devServer: prodBuild ? undefined : {
            host: devHost,
            port: devWebpackPort,
            overlay: true,
            compress: true,
            hot: true,
            noInfo: true,
            stats: stats,
            open: env.devServerOpenPage != null,
            openPage: env.devServerOpenPage,
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
const extraPluginsProd = (terserOptions) => {
    return [
        // Extract built CSS files into sub-directories by chunk / entry point name.
        new MiniCssExtractPlugin({
            filename: '[name]/[name].[contenthash:8].css'
        }),

        // Minify and tree-shake via Terser - https://github.com/terser/terser#readme
        new TerserPlugin({
            sourceMap: true,
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
        // Avoid dev-time errors with mis-matched casing in imports (where a less case sensitive OS
        // will resolve OK, but import could fail at build time with strict case sensitivity).
        new CaseSensitivePathsPlugin(),

        // For HMR
        new webpack.HotModuleReplacementPlugin()
    ];
};

// Generate combinations for given chunkNames so we can pass them as excludes to HtmlWebpackPlugin
// where this is called. This will be passed the names of all the apps we *do not* want to load
// from the HTML index page we are building and will output their possible chunk combos to exclude.
//
// Unclear if this is really a valid approach, but it seems to work. Relies on the fact that chunk
// combos are named according to alpha-ordered entry points included (as well as "vendors" for
// library dependencies). So given a list of apps such as [admin, app, mobile], possible chunk
// combos will be of the form vendors~admin, vendors~admin~app, vendors~app~mobile, and so on...
//
function getChunkCombinations(chunkNames) {
    // Add 'vendors' to also generate 'vendors~fooApp~barApp' chunk paths for exclusion.
    chunkNames = ['vendors', ...chunkNames];

    let result = [];
    let f = function(path, chunkNames) {
        for (let i = 0; i < chunkNames.length; i++) {
            const sep = path === '' ? '' : '~',
                newPath = path + sep + chunkNames[i];
            result.push(newPath);
            f(newPath, chunkNames.slice(i + 1));
        }
    };
    f('', chunkNames);
    return result.filter(chunk => chunk !== 'vendors');
}

function logSep() {console.log(':------------------------------------')}
function logMsg(msg) {console.log(`: ${msg}`)}

module.exports = configureWebpack;
