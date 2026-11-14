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
    checkHoistReactVersion,
    checkRspackVersion,
    discoverClientApps,
    gitBranch,
    isVersionBelow
} = require('../lib/common');

describe('discoverClientApps', () => {
    const src = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'xh-client-apps-')));
    after(() => fs.rmSync(src, {recursive: true, force: true}));

    it('makes an entry of each script in src/apps, skipping spec and test files', () => {
        fs.mkdirSync(path.join(src, 'apps'));
        ['app.ts', 'admin.js', 'app.spec.ts', 'admin.test.js', 'notes.md'].forEach(f =>
            fs.writeFileSync(path.join(src, 'apps', f), '')
        );
        const names = discoverClientApps(src).map(it => it.name);
        assert.deepEqual(names.sort(), ['admin', 'app']);
    });
});

describe('isVersionBelow', () => {
    it("compares a version with a 'major[.minor]' minimum", () => {
        assert.ok(isVersionBelow('88.1.0', '89'));
        assert.ok(isVersionBelow('89.0.0', '89.1'));
        assert.ok(!isVersionBelow('89.0.0', '89'));
        assert.ok(!isVersionBelow('90.0.0', '89.1'));
    });

    it('ignores a snapshot suffix, and never ranks a non-numeric version below', () => {
        assert.ok(!isVersionBelow('89.0.0-SNAPSHOT.1790701102970', '89'));
        assert.ok(isVersionBelow('88.0.0-SNAPSHOT', '89'));
        assert.ok(!isVersionBelow('NOT_FOUND', '89'));
    });
});

describe('checkHoistReactVersion', () => {
    it('fails the build below the floor, except for an inline checkout', () => {
        assert.throws(
            () => checkHoistReactVersion({version: '87.0.0'}, false),
            /requires hoist-react/
        );
        assert.doesNotThrow(() => checkHoistReactVersion({version: '87.0.0'}, true));
        assert.doesNotThrow(() => checkHoistReactVersion({version: '88.0.0'}, false));
        assert.doesNotThrow(() => checkHoistReactVersion({version: 'NOT_FOUND'}, false));
    });
});

describe('checkRspackVersion', () => {
    it('fails on a blocked version', () => {
        assert.throws(() => checkRspackVersion('2.3.2'), /@rspack\/core v2\.3\.2 is not supported/);
    });

    it('allows versions that are not blocked', () => {
        for (const v of ['2.3.0', '2.3.1', '2.3.3']) {
            assert.doesNotThrow(() => checkRspackVersion(v));
        }
    });
});

describe('gitBranch', () => {
    it('returns the branch of a git checkout', () => {
        const branch = gitBranch(path.resolve(__dirname, '..'));
        assert.ok(branch && typeof branch === 'string');
    });

    it('returns null outside a git checkout', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xh-git-branch-'));
        try {
            assert.equal(gitBranch(dir), null);
        } finally {
            fs.rmSync(dir, {recursive: true, force: true});
        }
    });
});
