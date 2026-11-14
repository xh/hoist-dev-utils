/*
 * This file belongs to Hoist, an application development toolkit
 * developed by Extremely Heavy Industries (www.xh.io | info@xh.io)
 *
 * Copyright © 2026 Extremely Heavy Industries Inc.
 */
'use strict';

const assert = require('node:assert/strict'),
    fs = require('node:fs'),
    os = require('node:os'),
    path = require('node:path'),
    {after, describe, it} = require('node:test');

const {
    HOIST_SWC,
    INLINE_HOIST_SINGLETONS,
    hoistSwcTransform,
    resolveAppIdentity,
    resolveHoistPath,
    xhDefines
} = require('../lib/hoistCompile');

describe('HOIST_SWC', () => {
    it('holds the 2023-11 decorator, [[Define]] field and automatic JSX settings', () => {
        assert.deepEqual(
            {...HOIST_SWC},
            {decoratorVersion: '2023-11', useDefineForClassFields: true, reactRuntime: 'automatic'}
        );
        assert.ok(Object.isFrozen(HOIST_SWC));
    });

    it('maps onto SWC transform options, in a new object on each call', () => {
        const transform = hoistSwcTransform();
        assert.deepEqual(transform, {
            decoratorVersion: '2023-11',
            useDefineForClassFields: true,
            react: {runtime: 'automatic'}
        });
        transform.react.development = true;
        assert.equal(hoistSwcTransform().react.development, undefined);
    });
});

describe('resolveAppIdentity', () => {
    it('defaults appName from appCode, and appVersion, appBuild and baseUrl as the build does', () => {
        assert.deepEqual(resolveAppIdentity({appCode: 'portfolio-manager'}), {
            appCode: 'portfolio-manager',
            appName: 'Portfolio Manager',
            appVersion: '1.0-SNAPSHOT',
            appBuild: 'UNKNOWN',
            baseUrl: '/api/'
        });
    });

    it('keeps explicit values, and treats empty strings as unset', () => {
        const env = {appCode: 'x', appName: 'X App', appVersion: '2.1', appBuild: 'abc'};
        assert.deepEqual(resolveAppIdentity({...env, baseUrl: 'https://h/api/'}), {
            ...env,
            baseUrl: 'https://h/api/'
        });
        assert.equal(resolveAppIdentity({appCode: 'x', appVersion: ''}).appVersion, '1.0-SNAPSHOT');
    });

    it('throws the build message when appCode is missing', () => {
        assert.throws(() => resolveAppIdentity({}), /Missing required "appCode" config/);
    });
});

describe('xhDefines', () => {
    const defines = xhDefines({
        appCode: 'myApp',
        appName: 'My App',
        appVersion: '1.0.0',
        appBuild: 'abc',
        baseUrl: '/api/',
        buildTimestamp: 0,
        clientApps: ['admin', 'app'],
        isDevelopmentMode: false
    });

    it('emits every constant core/XH.ts reads, in the build order', () => {
        assert.deepEqual(Object.keys(defines), [
            'xhAppCode',
            'xhAppName',
            'xhAppVersion',
            'xhAppBuild',
            'xhBaseUrl',
            'xhBuildTimestamp',
            'xhClientApps',
            'xhIsDevelopmentMode'
        ]);
    });

    it('gives each value as a JSON code string', () => {
        assert.equal(defines.xhAppCode, '"myApp"');
        assert.equal(defines.xhBuildTimestamp, '0');
        assert.equal(defines.xhClientApps, '["admin","app"]');
        assert.equal(defines.xhIsDevelopmentMode, 'false');
        Object.values(defines).forEach(v => assert.doesNotThrow(() => JSON.parse(v)));
    });
});

describe('INLINE_HOIST_SINGLETONS', () => {
    it('lists React and ag-Grid, frozen', () => {
        assert.deepEqual(
            [...INLINE_HOIST_SINGLETONS],
            ['react', 'react-dom', 'ag-grid-react', 'ag-grid-community']
        );
        assert.ok(Object.isFrozen(INLINE_HOIST_SINGLETONS));
    });
});

describe('resolveHoistPath', () => {
    const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'xh-hoist-path-'))),
        base = path.join(tmp, 'app', 'client-app'),
        checkout = path.join(tmp, 'hoist-react'),
        worktree = path.join(tmp, 'hoist-react-worktrees', 'my-feature'),
        notHoist = path.join(tmp, 'other-lib'),
        store = path.join(tmp, 'store', '@xh', 'hoist'),
        writePkg = (dir, name) => {
            fs.mkdirSync(dir, {recursive: true});
            fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({name}));
        };
    fs.mkdirSync(path.join(base, 'node_modules', '@xh'), {recursive: true});
    writePkg(checkout, '@xh/hoist');
    writePkg(worktree, '@xh/hoist');
    writePkg(notHoist, 'other-lib');
    fs.mkdirSync(store, {recursive: true});
    fs.symlinkSync(store, path.join(base, 'node_modules', '@xh', 'hoist'));

    after(() => fs.rmSync(tmp, {recursive: true, force: true}));

    it('resolves the installed package to its real path', () => {
        assert.equal(resolveHoistPath(base, false, {}), store);
    });

    it('ignores XH_HOIST_REACT_PATH outside inline mode', () => {
        assert.equal(resolveHoistPath(base, false, {XH_HOIST_REACT_PATH: worktree}), store);
    });

    it('resolves a sibling checkout at ../../hoist-react in inline mode', () => {
        assert.equal(resolveHoistPath(base, true, {}), checkout);
    });

    it('resolves the checkout named by XH_HOIST_REACT_PATH in inline mode', () => {
        assert.equal(resolveHoistPath(base, true, {XH_HOIST_REACT_PATH: worktree}), worktree);
    });

    it('resolves a symlinked checkout to its real path', () => {
        const link = path.join(tmp, 'linked-hoist');
        fs.symlinkSync(worktree, link);
        assert.equal(resolveHoistPath(base, true, {XH_HOIST_REACT_PATH: link}), worktree);
    });

    it('rejects a relative XH_HOIST_REACT_PATH', () => {
        assert.throws(
            () => resolveHoistPath(base, true, {XH_HOIST_REACT_PATH: '../hoist-react'}),
            /must be an absolute path/
        );
    });

    it('fails when XH_HOIST_REACT_PATH holds no hoist-react checkout', () => {
        for (const p of [notHoist, path.join(tmp, 'missing')]) {
            assert.throws(
                () => resolveHoistPath(base, true, {XH_HOIST_REACT_PATH: p}),
                /not a hoist-react checkout/
            );
        }
    });

    it('fails when inline mode finds no sibling checkout', () => {
        const other = path.join(tmp, 'deeper', 'none', 'client-app');
        assert.throws(() => resolveHoistPath(other, true, {}), /found no hoist-react checkout/);
    });

    it('returns the expected path when no package is installed', () => {
        const other = path.join(tmp, 'none', 'client-app');
        assert.equal(
            resolveHoistPath(other, false, {}),
            path.join(other, 'node_modules', '@xh', 'hoist')
        );
    });
});
