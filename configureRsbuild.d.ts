/*
 * This file belongs to Hoist, an application development toolkit
 * developed by Extremely Heavy Industries (www.xh.io | info@xh.io)
 *
 * Copyright © 2026 Extremely Heavy Industries Inc.
 */

// Hand-written declarations for configureRsbuild.js. Keep in step with its JSDoc and with
// KNOWN_OPTIONS in lib/common.js - test/declarations.test.js checks the keys.

/**
 * Consolidated Rsbuild (Rspack + SWC) configuration for both dev-time and production builds of
 * Hoist React web applications. Apps consume it from an `rsbuild.config.mjs`:
 *
 *      import {defineConfig} from '@rsbuild/core';
 *      import configureRsbuild from '@xh/hoist-dev-utils/configureRsbuild';
 *      export default defineConfig(({envMode}) => configureRsbuild({appCode: 'myApp', ...}));
 *
 * Build-time overrides flow in as `XH_*` environment variables - see `readCliEnv()`.
 *
 * @returns a complete Rsbuild config object, typed loosely. Rsbuild's `defineConfig()` checks it.
 */
declare function configureRsbuild(env: configureRsbuild.RsbuildEnv): Promise<Record<string, any>>;

declare namespace configureRsbuild {
    /** Also exported by name, for `import {configureRsbuild} from ...`. */
    const configureRsbuild: (env: RsbuildEnv) => Promise<Record<string, any>>;

    /**
     * Read the standard `XH_*` environment variables into env options, for CLI-driven overrides.
     * Spread the result into the config passed to `configureRsbuild()` after the app's own
     * defaults. Rsbuild loads `.env`, `.env.local`, `.env.<mode>` and `.env.<mode>.local` into
     * `process.env` before it evaluates the config, so the variables can live there too.
     *
     * 'true' and 'false' become booleans. Unset variables are omitted, so app defaults win.
     */
    function readCliEnv(processEnv?: Record<string, string | undefined>): Partial<RsbuildEnv>;

    /** Options that `configureRsbuild()` and `configureVitest()` both honor. */
    interface SharedEnv {
        /**
         * Short, internal code for the application - baked into client as `XH.appCode`. Should be
         * lowercase, dash-separated, and should match the Gradle project name (e.g.
         * portfolio-manager).
         */
        appCode: string;
        /**
         * User-facing display name for the application - baked into client as `XH.appName`.
         * Defaults from appCode (portfolio-manager -> Portfolio Manager).
         */
        appName?: string;
        /** Client version - baked into client as `XH.appVersion`. Default '1.0-SNAPSHOT'. */
        appVersion?: string;
        /** Build/git tag - baked into client as `XH.appBuild`. Default 'UNKNOWN'. */
        appBuild?: string;
        /**
         * Root path prepended to all relative URLs called via FetchService. Defaults to `/api/`,
         * which the dev server proxies to the Grails backend at `devHost:devGrailsPort`.
         */
        baseUrl?: string;
        /**
         * True to use a sibling hoist-react checkout at `../../hoist-react` in place of the
         * installed package. Dev-mode only for the build.
         */
        inlineHoist?: boolean;
        /** Additional paths to transpile with the settings used for app and hoist-react code. */
        extraIncludePaths?: string[];
        /** Paths to exclude from transpiling, e.g. a local package's nested node_modules. */
        extraExcludePaths?: string[];
        /** @deprecated renamed to `extraIncludePaths`. */
        babelIncludePaths?: string[];
        /** @deprecated renamed to `extraExcludePaths`. */
        babelExcludePaths?: string[];
        /**
         * Module aliases. When inlineHoist=true, an alias from `@xh/hoist` to the checkout is
         * added.
         */
        resolveAliases?: Record<string, string | string[] | false>;
        /**
         * Overrides for SWC options, applied on top of the defaults - either an object to
         * deep-merge, or a function receiving the options to mutate or replace.
         */
        swcOptions?:
            Record<string, any> | ((options: Record<string, any>) => Record<string, any> | void);
    }

    /** Options for `configureRsbuild()`. */
    interface RsbuildEnv extends SharedEnv {
        /** True for a production build, as opposed to a run of the dev server. */
        prodBuild?: boolean;
        /** True to use the production build of React when running the dev server. */
        reactProdMode?: boolean;
        /**
         * Source map generation. `true` for defaults specific to dev vs. prod builds, `false` to
         * disable, `'devOnly'` for the dev default only, or any valid Rspack `devtool` string.
         * Default true.
         */
        sourceMaps?: boolean | string;
        /**
         * Browserslist queries for the target browsers, driving JS transpiling, polyfill
         * selection and CSS prefixing.
         */
        targetBrowsers?: string[];
        /** False to skip JS/CSS minification in production builds. Default true. */
        minify?: boolean;
        /**
         * True to enable Rspack's persistent build cache, or Rsbuild's options object
         * (`cacheDirectory`, `cacheDigest`, `buildDependencies`). Default false.
         */
        buildCache?: boolean | Record<string, any>;
        /** Rsbuild log level. Default 'info'. */
        logLevel?: 'info' | 'warn' | 'error' | 'silent';
        /**
         * Options to deep-merge onto the defaults for the SWC minimizer in production builds -
         * `compress`, `mangle` and `format`, in the same shape as Terser's.
         */
        minifyOptions?: Record<string, any>;
        /**
         * Additional Rspack module rules, added ahead of the built-in rules. Declare any loaders
         * they use as devDependencies of the app.
         */
        extraModuleRules?: Record<string, any>[];
        /**
         * True to load all BlueprintJs icons. Default false loads only the icons Hoist React
         * needs, for a much smaller bundle.
         */
        loadAllBlueprintJsIcons?: boolean;
        /** Root path from which the app will be served, used as the base path for static files. */
        contextRoot?: string;
        /**
         * True to copy the `/client-app/public` contents into the root of the build, unprocessed.
         * Required for favicons. Default true.
         */
        copyPublicAssets?: boolean;
        /**
         * True to parse a `CHANGELOG.md` in the project root into JSON for
         * `XH.changelogService`. Default true.
         */
        parseChangelog?: boolean;
        /**
         * Pre-compressed `.br` and `.gz` copies of bundled assets, for nginx. `false` to disable,
         * or an object to override the compression plugin defaults. Production builds only.
         * Default true.
         */
        precompressAssets?:
            | boolean
            | {
                  test?: RegExp | string | (RegExp | string)[];
                  include?: RegExp | string | (RegExp | string)[];
                  exclude?: RegExp | string | (RegExp | string)[];
                  threshold?: number;
                  minRatio?: number;
              };
        /** Relative path to a primary favicon source image, `png` or `svg`. */
        favicon?: string;
        /** Override values for each app's manifest.json. */
        manifestConfig?: Record<string, any>;
        /** Background color for the preloader spinner. Default white. */
        preloadBackgroundColor?: string;
        /** Stroke color for the preloader spinner SVG. Default '#888'. */
        preloadSpinnerColor?: string;
        /**
         * Dev-server overlay behavior, in webpack-dev-server's `{errors, runtimeErrors}` shape.
         * Default shows compilation errors only. Dev-mode only.
         */
        devClientOverlay?: boolean | {errors?: boolean; runtimeErrors?: boolean};
        /** Hostname for both the local Grails and dev servers. Default 'localhost'. Dev-mode only. */
        devHost?: string;
        /** Port of the local Grails server. Default 8080. Dev-mode only. */
        devGrailsPort?: number | string;
        /** Port on which to start the dev server (historic name). Default 3000. Dev-mode only. */
        devWebpackPort?: number | string;
        /** Path to open when the dev server starts. Unset to open nothing. Dev-mode only. */
        devServerOpenPage?: string;
        /**
         * `true` to run the dev server over SSL with a self-signed cert, or Node
         * `https.createServer` options for a custom cert/key. Default false. Dev-mode only.
         */
        devHttps?: boolean | Record<string, any>;
        /**
         * False to stop the dev server reloading the page when an edit cannot be hot-swapped.
         * Default true. Dev-mode only.
         */
        devLiveReload?: boolean;
        /** Options to spread onto the defaults for Rsbuild's `server` config. Dev-mode only. */
        devServerOptions?: Record<string, any>;
    }
}

export = configureRsbuild;
