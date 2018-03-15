'use strict';

const _ = require('lodash'),
    path = require('path'),
    fs = require('fs'),
    chalk = require('chalk'),
    webpack = require('webpack'),
    autoprefixer = require('autoprefixer'),
    BundleAnalyzerPlugin = require('webpack-bundle-analyzer').BundleAnalyzerPlugin,
    CaseSensitivePathsPlugin = require('case-sensitive-paths-webpack-plugin'),
    CleanWebpackPlugin = require('clean-webpack-plugin'),
    ExtractTextPlugin = require('extract-text-webpack-plugin'),
    FaviconsWebpackPlugin = require('favicons-webpack-plugin'),
    HtmlWebpackPlugin = require('html-webpack-plugin'),
    UglifyJsPlugin = require('uglifyjs-webpack-plugin'),
    basePath = fs.realpathSync(process.cwd());

/**
 * Consolidated Webpack configuration for both dev-time and production builds. Built largely from the example generated
 * by an ejected create-react-app (~v1.5 aka "CRA") project, simplified as much as possible to provide what we need.
 *
 * Two custom environment variables are checked and can be passed into webpack / webpack-dev-server via --env flags.
 *      + prodBuild - true to indicate this is a build (as opposed to startup of webpack-dev-server)
 *      + inlineHoist - true to use an inline (checked-out) copy of hoist-react when running the dev server, as opposed
 *                    to using the downloaded dependency. This allows hoist-react developers to test plugin changes.
 *                    Has no effect (i.e. always set to false) for builds.
 *      + analyzeBundles - true to launch an interactive bundle analyzer to review output bundles, contents, and sizes.
 *      + appName - user-facing display name of overall web application - baked into client as XH.appName
 *      + appVersion - client version - baked into client as XH.appVersion
 *      + appBuild - build number / tag - baked into client as XH.appBuild
 *
 * This project's package.json file defines simple script entry points to either build or run the dev-server.
 *      + yarn build - run a production build
 *      + yarn start - start webpack-dev-server w/the packaged version of hoist-react
 *      + yarn startWithHoist - as above, w/inline version of hoist-react
 */
function configureWebpack(env = {}) {
    const prodBuild = !!env.prodBuild,
        inlineHoist = !prodBuild && !!env.inlineHoist,
        analyzeBundles = !!env.analyzeBundles,
        appName = env.appName,
        appVersion = env.appVersion || 'UNKNOWN',
        appBuild = env.appBuild || 'UNKNOWN',
        favicon = env.favicon || null,
        devServerPort = env.devServerPort || 3000;

    // CRA depends on these env. variables being set. Specifically, the babel-preset-react-app we still use checks them
    // to switch React transpilation between dev and prod modes. (Might be other reasons why we want them defined.)
    process.env.BABEL_ENV = prodBuild ? 'production' : 'development';
    process.env.NODE_ENV = prodBuild ? 'production' : 'development';

    console.log('/-----------------------------------------------/');
    console.log(`Configuring ${appName} v${appVersion}`);
    console.log('/-----------------------------------------------/');
    console.log(`🚀  Production build: ${printBool(prodBuild)}`);
    console.log(`🏗️  Inline Hoist: ${printBool(inlineHoist)}`);
    if (analyzeBundles) console.log('🎁  Bundle analysis enabled - will launch after webpack completes.');
    console.log('/-----------------------------------------------/');

    const srcPath = path.resolve(basePath, 'src'),
        outPath = path.resolve(basePath, 'build'),
        publicPath = '/';  // Path on which fully built app is served - i.e. root context

    // Resolve Hoist as either a sibling (inline, checked-out) project or a downloaded package dependency
    const hoistPath = inlineHoist ?
        path.resolve(basePath, '../../hoist-react') :
        path.resolve(basePath, 'node_modules/@xh/hoist');

    // When running inline, resolve inline Hoist's own node_modules package so we can tell Babel to exclude
    const hoistNodeModulesPath = inlineHoist ?
        path.resolve(hoistPath, 'node_modules') :
        null;

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
            });

    return {

        // One named entry chunk per app, as above.
        entry: {
            ..._.chain(apps)
                .keyBy('name')
                .mapValues(app => [app.path])
                .value()
        },

        output: {
            // Output built assets in directories per entry point / chunk.
            // Use chunkhash in prod to get distinct hashes for app vs. common chunks (throws error in dev - investigate)
            filename: prodBuild ? '[name]/[name].[chunkhash:8].js' : '[name]/[name].[hash:8].js',
            path: outPath,
            publicPath: publicPath,
            pathinfo: !prodBuild,
            // From CRA - related to file paths for sourcemaps, esp. on Windows - review if necessary / helpful
            devtoolModuleFilenameTemplate: info => path.resolve(info.absoluteResourcePath).replace(/\\/g, '/')
        },

        // Tell webpack where to look for modules when resolving imports - this is the key to getting
        // inlineHoist mode to look in within the checked-out hoist-react project at hoistPath.
        // In bundled (non inline) mode, this allows `import {Foo} from hoist` vs `import {Foo} from @xh/hoist`
        resolve: {
            alias: {
                hoist: inlineHoist ? hoistPath : '@xh/hoist'
            }
        },

        module: {
            // From CRA - flags missing exports as a failure vs. warning
            strictExportPresence: true,

            rules: [
                // Production builds run eslint before anything.
                // Currently only for builds to avoid dev-time friction with small in-flight changes breaking build.
                prodBuild ? {
                    test: /\.(js)$/,
                    enforce: 'pre',
                    use: [
                        {
                            loader: 'eslint-loader',
                            options: {
                                eslintPath: require.resolve('eslint')
                            }
                        }
                    ],
                    // If we do run during dev-time (in future, maybe with flag?), lint Hoist when running inline.
                    // Note that we'll need to rely on the Teamcity build to ensure Hoist gets linted.
                    include: inlineHoist ? [hoistPath, srcPath] : srcPath,
                    exclude: inlineHoist ? [hoistNodeModulesPath] : undefined
                } : undefined,

                // Core loaders for all assets
                {
                    oneOf: [

                        // Encode small-enough images into inline data URLs
                        {
                            test: [/\.bmp$/, /\.gif$/, /\.jpe?g$/, /\.png$/],
                            loader: 'url-loader',
                            options: {
                                limit: 10000,
                                name: 'static/media/[name].[hash:8].[ext]'
                            }
                        },

                        // Transpile JS via Babel
                        {
                            test: /\.(js)$/,
                            use: {
                                loader: 'babel-loader',
                                options: {
                                    presets: ['react-app'],
                                    plugins: ['transform-decorators-legacy'],
                                    compact: true,
                                    cacheDirectory: !prodBuild
                                }
                            },

                            // Always transpile Hoist - even when "packaged" we have the raw source as we are not
                            // currently transpiling anything in hoist-react on its own.
                            include: [srcPath, hoistPath],
                            // In inline mode also *avoid* transpiling inline hoist's own node_modules libraries.
                            exclude: inlineHoist ? [hoistNodeModulesPath] : undefined
                        },

                        // Process CSS and SASS - distinct workflows for prod build vs. dev-time
                        prodBuild ? cssConfProd() : cssConfDev(),
                        prodBuild ? sassConfProd() : sassConfDev(),

                        // Fall-through entry to process all other assets via a file-loader.
                        // Exclude config here is from CRA source config (commented there, but didn't understand).
                        {
                            exclude: [/\.js$/, /\.html$/, /\.json$/],
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
            new CleanWebpackPlugin([outPath], {verbose: false}),

            // Inject global constants at compile time.
            // process.env is a recommended export due to use within libs to determine prod vs. dev-time behavior.
            // xhIsLocalDevelopment is referenced within FetchService to prepend localhost:8080 to all URLs.
            // We can discuss if this is a useful pattern for XH apps or if we want to go another route.
            new webpack.DefinePlugin({
                'process.env': {NODE_ENV: JSON.stringify(process.env.NODE_ENV)},
                xhIsLocalDevelopment: JSON.stringify(!prodBuild),
                xhInlineHoist: JSON.stringify(inlineHoist),
                xhAppName: JSON.stringify(appName),
                xhAppVersion: JSON.stringify(appVersion),
                xhAppBuild: JSON.stringify(appBuild)
            }),

            // Extract common (i.e. library, vendor) code into a dedicated chunk for re-use across app updates
            // and multiple entry points. This is the simplest configuration of this plugin - an alternative would
            // be for us to define explicit vendor dependencies within an entry point to break out as common.
            // By default, if a module is called by >=2 entry points, it gets bundled into common.
            // We should evaluate once we have a more fully built set of example apps!
            new webpack.optimize.CommonsChunkPlugin({
                name: ['common']
            }),

            // This second invocation of the plugin extracts the webpack runtime into its own chunk to avoid
            // changes to our app-level code and modules modifying the common chunk hash as well and preventing caching.
            // See https://medium.com/webpack/predictable-long-term-caching-with-webpack-d3eee1d3fa31
            new webpack.optimize.CommonsChunkPlugin({
                name: ['runtime']
            }),

            // More plugins to avoid unwanted hash changes and support better caching - uses paths to identify
            // modules vs. numeric IDs, helping to keep generated chunks (specifically their hashes) stable.
            // Also required for HMR to work.
            new webpack.NamedChunksPlugin(),
            new webpack.NamedModulesPlugin(),

            // Avoid bundling all moment.js locales and blowing up the bundle size
            // See https://github.com/jmblog/how-to-optimize-momentjs-with-webpack
            new webpack.IgnorePlugin(/^\.\/locale$/, /moment$/),

            // Generate favicons from a single source image if provided - injected into HTML generated below
            favicon ? new FaviconsWebpackPlugin({
                logo: favicon,
                prefix: 'icons-[hash:8]/',
                icons: {
                    android: true,
                    appleIcon: true,
                    favicons: true,
                    appleStartup: false,
                    coast: false,
                    firefox: false,
                    opengraph: false,
                    twitter: false,
                    yandex: false,
                    windows: false
                }
            }) : undefined,

            // Generate HTML index pages - one per app.
            ...apps.map(app => {
                return new HtmlWebpackPlugin({
                    inject: true,
                    title: appName,
                    template: 'public/index.html',
                    filename: `${app.name}/index.html`,
                    // Ensure common chunks are included!
                    chunks: [app.name, 'common', 'runtime']
                });
            }),

            // Support an optional post-build/run interactive treemap of output bundles and their sizes / contents.
            analyzeBundles ? new BundleAnalyzerPlugin({
                analyzerMode: 'server'
            }) : undefined,

            // Who wants errors? Not us.
            new webpack.NoEmitOnErrorsPlugin(),

            // Environment-specific plugins
            ...(prodBuild ? extraPluginsProd() : extraPluginsDev())

        ].filter(Boolean),

        devtool: prodBuild ? 'source-map' : 'eval-source-map',

        // Inline dev-time configuration for webpack-dev-server.
        devServer: prodBuild ? undefined : {
            host: 'localhost',
            port: devServerPort,
            overlay: true,
            compress: true,
            hot: true,
            historyApiFallback: {
                disableDotRule: true  // from CRA - unclear if needed
            }
        }
    };
}


//------------------------
// Implementation
//------------------------

// Production builds use ExtractTextPlugin to break built styles into dedicated CSS output files (vs. tags injected
// into DOM) for production builds. Note relies on ExtractTextPlugin being called within the prod plugins section.
const cssConfProd = () => {
    return {
        test: /\.css$/,
        loader: ExtractTextPlugin.extract(
            {
                fallback: {
                    // For CSS that does not end up extracted into a dedicated file - inject inline.
                    loader: 'style-loader',
                    options: {hmr: false}
                },
                use: [
                    cssLoader(1),
                    postCssLoader()
                ]
            }
        )
    };
};

const sassConfProd = () => {
    return {
        test: /\.scss$/,
        loader: ExtractTextPlugin.extract(
            {
                fallback: {
                    loader: 'style-loader',
                    options: {hmr: false}
                },
                use: [
                    cssLoader(2),
                    postCssLoader(),
                    sassLoader()
                ]
            }
        )
    };
};

// Dev-time CSS/SASS configs do not extract CSS into dedicated files - keeping it inline via default style-loader.
// This is a common dev setup, and is compatible with HMR.
const cssConfDev = () => {
    return {
        test: /\.css$/,
        use: [
            'style-loader',
            cssLoader(1),
            postCssLoader()
        ]
    };
};

const sassConfDev = () => {
    return {
        test: /\.scss$/,
        use: [
            'style-loader',
            cssLoader(2),
            postCssLoader(),
            sassLoader()
        ]
    };
};

// CSS loader resolves @imports within CSS, similar to module support in JS.
const cssLoader = (importLoaders) => {
    return {
        loader: 'css-loader',
        options: {
            // Indicate how many prior loaders (postCssLoader/sassLoader) to also run on @imported resources.
            importLoaders: importLoaders,
            // Generate CSS sourcemaps
            sourceMap: true
        }
    };
};


// Pre-process CSS to install flexbox bug workarounds + vendor-specific prefixes for the configured browsers
// Note that the "post" in the loader name refers to http://postcss.org/ - NOT the processing order within Webpack.
// (In fact this is the first loader that gets our CSS, as loaders run R-L or bottom-to-top.
// Inclusion of postcss-flexbugs-fixes is from CRA.
const postCssLoader = () => {
    return {
        loader: 'postcss-loader',
        options: {
            ident: 'postcss',
            plugins: () => [
                require('postcss-flexbugs-fixes'),
                autoprefixer({
                    // TODO - Can continue to tune via http://browserl.ist/
                    browsers: [
                        '>1%',
                        'last 2 versions',
                        'not ie < 11',
                        'not opera > 0',
                        'not op_mob > 0',
                        'not op_mini all'
                    ],
                    flexbox: 'no-2009'
                })
            ]
        }
    };
};

const sassLoader =  () => {
    return {
        loader: 'sass-loader'
    };
};

const extraPluginsProd = () => {
    return [
        // Extract built CSS files into sub-directories by chunk / entry point name.
        new ExtractTextPlugin({
            filename: '[name]/[name].[contenthash:8].css',
            // Required by CommonsChunkPlugin to ensure we extract CSS from common chunk as well as app entry points.
            allChunks: true
        }),

        // Enable JS minification and tree-shaking.
        new UglifyJsPlugin({
            sourceMap: true,
            parallel: true,
            uglifyOptions: {
                // Options here sourced from CRA config
                compress: {comparisons: false},
                mangle: {safari10: true},
                output: {comments: false}
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

const printBool = v => {
    const oks = ['yes', 'yep', 'sure', 'ok'],
        nos = ['no', 'nope', 'nah', 'never'],
        rand = Math.floor(Math.random()*4);

    return v ?
        chalk.whiteBright.bgGreen(` ${oks[rand]} `) :
        chalk.whiteBright.bgRed(` ${nos[rand]} `);
};

module.exports = configureWebpack;