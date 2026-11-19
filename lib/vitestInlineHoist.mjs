/*
 * This file belongs to Hoist, an application development toolkit
 * developed by Extremely Heavy Industries (www.xh.io | info@xh.io)
 *
 * Copyright © 2026 Extremely Heavy Industries Inc.
 */

/**
 * First setup file of an inline test run - inline Hoist, inline packages or both - added by
 * `configureVitest()`.
 *
 * Vite's `resolve.dedupe` and aliases reach only the modules Vite resolves. Vitest externalizes a
 * checkout's own dependencies (e.g. mobx-react-lite, ag-grid-react, @ag-ui/client), so
 * Node loads them and resolves their `react` from the checkout's node_modules - a second React,
 * and hooks fail. This hook sends imports of each shared name made from a checkout's node_modules
 * to the one copy the build uses, as the build's aliases do. A shared name that is itself a
 * checkout (`@xh/hoist` under inline Hoist) is not redirected - a library a checkout installs does
 * not import its host.
 *
 * Settings arrive in `XH_VITEST_INLINE_HOIST_CFG`, set by `configureVitest()`: `fromDirs`, the
 * checkouts' node_modules dirs, and `singletons`, each `{name, from}` with the dir to resolve that
 * name from. `module.registerHooks()` needs Node >= 22.15.
 */
import {createRequire, registerHooks} from 'node:module';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const cfg = JSON.parse(process.env.XH_VITEST_INLINE_HOIST_CFG ?? 'null');

if (cfg?.singletons?.length && cfg.fromDirs?.length) {
    const fromUrls = cfg.fromDirs.map(it => pathToFileURL(path.join(it, '/')).href),
        escape = it => it.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&'),
        targets = cfg.singletons.map(({name, from}) => {
            const parentUrl = pathToFileURL(path.join(from, 'package.json')).href;
            return {
                re: new RegExp(`^${escape(name)}(?:/|$)`),
                parentUrl,
                require: createRequire(parentUrl)
            };
        });

    registerHooks({
        resolve(specifier, context, nextResolve) {
            const parent = context.parentURL,
                target =
                    parent && fromUrls.some(it => parent.startsWith(it))
                        ? targets.find(it => it.re.test(specifier))
                        : null;
            if (!target) return nextResolve(specifier, context);

            // An ESM import resolves from the shared copy's location with its own conditions, so
            // it still gets a package's ESM build (ag-Grid ships both). A changed parentURL does
            // not redirect a CJS require(), so that resolves through a require from there instead.
            if (context.conditions?.includes('import')) {
                return nextResolve(specifier, {...context, parentURL: target.parentUrl});
            }
            return {
                url: pathToFileURL(target.require.resolve(specifier)).href,
                shortCircuit: true
            };
        }
    });
}
