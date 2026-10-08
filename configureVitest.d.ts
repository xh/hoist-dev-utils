/*
 * This file belongs to Hoist, an application development toolkit
 * developed by Extremely Heavy Industries (www.xh.io | info@xh.io)
 *
 * Copyright © 2026 Extremely Heavy Industries Inc.
 */

// Hand-written declarations for configureVitest.js. Keep in step with its JSDoc and with
// TEST_OPTIONS there - test/declarations.test.js checks the keys. No vite or vitest types, as
// `vitest/config` does not resolve from this package under pnpm.

import configureRsbuild = require('./configureRsbuild');

/**
 * Vitest preset for Hoist unit tests. Compiles app and hoist-react code with the same SWC settings
 * as `configureRsbuild()`, sets the same `XH` constants, and loads hoist-react's test setup.
 * Requires hoist-react >= 89. Apps consume it from a `vitest.config.mts`:
 *
 *      import configureVitest from '@xh/hoist-dev-utils/configureVitest';
 *      import {defineConfig} from 'vitest/config';
 *      export default defineConfig(configureVitest({appCode: 'myApp'}));
 *
 * Wrap the result with `mergeConfig()` to add settings. `mergeConfig()` concatenates arrays, so
 * pass `include` and `setupFiles` here.
 *
 * @returns a Vite + Vitest config object, typed loosely. Vitest's `defineConfig()` checks it.
 */
declare function configureVitest(env: configureVitest.VitestEnv): Record<string, any>;

declare namespace configureVitest {
    /** Also exported by name, for `import {configureVitest} from ...`. */
    const configureVitest: (env: VitestEnv) => Record<string, any>;

    /**
     * Options for `configureVitest()`. Build options beyond these are ignored, so an app can share
     * one `env` object between its two configs: `configureVitest({...env, setupFiles: [...]})`.
     */
    interface VitestEnv extends configureRsbuild.SharedEnv {
        /** Project root. Defaults to the current directory. */
        root?: string;
        /** Spec globs. Default `['src/**\/*.spec.{ts,tsx}']`. */
        include?: string[];
        /** App setup files, run after hoist-react's `test-support/setup.ts`. */
        setupFiles?: string | string[];
        /**
         * Time zone for the run, set as `TZ`. Default 'America/New_York'. Null keeps the
         * machine's zone.
         */
        timeZone?: string | null;
        /**
         * True only for hoist-react's own config. Aliases `@xh/hoist` to the root and loads its
         * `test-support/setup.ts`.
         */
        selfHost?: boolean;
    }
}

export = configureVitest;
