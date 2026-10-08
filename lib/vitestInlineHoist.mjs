/*
 * This file belongs to Hoist, an application development toolkit
 * developed by Extremely Heavy Industries (www.xh.io | info@xh.io)
 *
 * Copyright © 2026 Extremely Heavy Industries Inc.
 */

/**
 * First setup file of an inline-hoist test run, added by `configureVitest()`.
 *
 * Vite's `resolve.dedupe` reaches only the modules Vite resolves. Vitest externalizes the
 * checkout's own dependencies (e.g. mobx-react-lite, Blueprint, ag-grid-react), so Node loads them
 * and resolves their `react` from the checkout's node_modules - a second React, and hooks fail.
 * This hook sends those imports to the app's copies instead, as the build's aliases do.
 *
 * Settings arrive in `XH_VITEST_INLINE_HOIST_CFG`, set by `configureVitest()`.
 * `module.registerHooks()` needs Node >= 22.15.
 */
import {createRequire, registerHooks} from 'node:module';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const cfg = JSON.parse(process.env.XH_VITEST_INLINE_HOIST_CFG ?? 'null');

if (cfg?.singletons?.length) {
    const fromUrl = pathToFileURL(path.join(cfg.hoistNodeModules, '/')).href,
        appParentUrl = pathToFileURL(path.join(cfg.appRoot, 'package.json')).href,
        appRequire = createRequire(appParentUrl),
        names = cfg.singletons.map(it => it.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')).join('|'),
        singletonRe = new RegExp(`^(?:${names})(?:/|$)`);

    registerHooks({
        resolve(specifier, context, nextResolve) {
            if (!singletonRe.test(specifier) || !context.parentURL?.startsWith(fromUrl)) {
                return nextResolve(specifier, context);
            }
            // An ESM import resolves from the app with its own conditions, so it still gets a
            // package's ESM build (ag-Grid ships both). A changed parentURL does not redirect a
            // CJS require(), so that resolves through the app's require instead.
            if (context.conditions?.includes('import')) {
                return nextResolve(specifier, {...context, parentURL: appParentUrl});
            }
            return {url: pathToFileURL(appRequire.resolve(specifier)).href, shortCircuit: true};
        }
    });
}
