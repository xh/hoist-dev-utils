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

const {parseInlinePackages, planInlinePackages} = require('../lib/inlinePackages');

//------------------------
// Fixtures - throwaway layouts under the OS temp dir.
//------------------------
const tmpRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'xh-inline-pkgs-')));
let fixtureCount = 0;
after(() => fs.rmSync(tmpRoot, {recursive: true, force: true}));

function writePkg(dir, pkg) {
    fs.mkdirSync(dir, {recursive: true});
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg));
}

/**
 * A workspace dir holding an app at `app/client-app` with Hoist installed pnpm-style (a symlink
 * into a store holding Hoist's own dependencies), a hoist-react checkout, and sibling checkouts of
 * the given packages. Each package holds its peers and @xh/hoist in its own node_modules, as an
 * install of its devDependencies does.
 */
function makeWorkspace({
    hoistVersion = '91.0.0-SNAPSHOT.1794870436776',
    appDeps = {react: '19.3.1', 'react-dom': '19.3.1'},
    appPkgDeps = null,
    packages = {}
} = {}) {
    const ws = path.join(tmpRoot, `ws${++fixtureCount}`),
        appRoot = path.join(ws, 'app', 'client-app'),
        appNm = path.join(appRoot, 'node_modules'),
        store = path.join(appNm, '.pnpm', 'hoist', 'node_modules'),
        hoistInstalled = path.join(store, '@xh', 'hoist'),
        hoistCheckout = path.join(ws, 'hoist-react');

    writePkg(appRoot, {
        name: 'app',
        dependencies: appPkgDeps ?? Object.fromEntries(Object.keys(packages).map(n => [n, '*']))
    });
    Object.entries(appDeps).forEach(([name, version]) =>
        writePkg(path.join(appNm, name), {name, version})
    );
    writePkg(hoistInstalled, {name: '@xh/hoist', version: hoistVersion});
    writePkg(path.join(store, 'mobx'), {name: 'mobx', version: '6.15.0'});
    fs.mkdirSync(path.join(appNm, '@xh'), {recursive: true});
    fs.symlinkSync(hoistInstalled, path.join(appNm, '@xh', 'hoist'));
    writePkg(hoistCheckout, {name: '@xh/hoist', version: '91.0.0-SNAPSHOT'});

    const dirs = {};
    Object.entries(packages).forEach(([name, pkg]) => {
        const dir = path.join(ws, name.split('/').pop());
        writePkg(dir, {name, version: '1.0.0', ...pkg});
        ['@xh/hoist', ...Object.keys(pkg.peerDependencies ?? {})].forEach(dep =>
            writePkg(path.join(dir, 'node_modules', dep), {name: dep, version: '0.0.1-own-copy'})
        );
        dirs[name] = dir;
    });

    return {ws, appRoot, hoistInstalled, hoistCheckout, dirs};
}

const plan = (w, names, {inlineHoist = false, extraSingletons} = {}) =>
    planInlinePackages({
        appRoot: w.appRoot,
        specs: parseInlinePackages(names),
        hoistPath: inlineHoist ? w.hoistCheckout : w.hoistInstalled,
        inlineHoist,
        extraSingletons
    });

const sharedMap = p => Object.fromEntries(p.shared.map(it => [it.name, it]));

const KIT = {
    peerDependencies: {'@xh/hoist': '>=91.0.0-SNAPSHOT', react: '^19.3.0', 'react-dom': '^19.3.0'},
    dependencies: {rxjs: '7.8.1', lodash: '^4.18.1'}
};

//------------------------
// Specs
//------------------------
describe('parseInlinePackages', () => {
    it('reads names and name=path pairs from a comma-separated string, trimming blanks', () => {
        assert.deepEqual(parseInlinePackages(' @xh/hoist-chat-kit , acme-hoist=/w/acme ,'), [
            {name: '@xh/hoist-chat-kit', path: null},
            {name: 'acme-hoist', path: '/w/acme'}
        ]);
    });

    it('reads an array, and splits a path at the first "=" only', () => {
        assert.deepEqual(parseInlinePackages(['a', '@x/b=/p/q=r']), [
            {name: 'a', path: null},
            {name: '@x/b', path: '/p/q=r'}
        ]);
    });

    it('reads nothing from an unset, empty or false value', () => {
        [undefined, null, '', false, [], ' , '].forEach(v =>
            assert.deepEqual(parseInlinePackages(v), [])
        );
    });

    it('rejects @xh/hoist, relative paths, repeats, blank names and non-strings', () => {
        assert.throws(() => parseInlinePackages('@xh/hoist'), /use inlineHoist/);
        assert.throws(() => parseInlinePackages('a=../a'), /must be absolute - found "..\/a"/);
        assert.throws(() => parseInlinePackages('a,a=/x'), /lists a more than once/);
        assert.throws(() => parseInlinePackages('=/x'), /has no package name/);
        assert.throws(() => parseInlinePackages([true]), /takes package names/);
    });
});

describe('planInlinePackages', () => {
    describe('locating checkouts', () => {
        it('plans nothing without packages, even with inline Hoist', () => {
            const w = makeWorkspace();
            assert.deepEqual(plan(w, '', {inlineHoist: true}), {
                packages: [],
                shared: [],
                warnings: []
            });
        });

        it('defaults to a sibling of the app repo, named without the scope', () => {
            const w = makeWorkspace({packages: {'@xh/hoist-chat-kit': KIT}}),
                [kit] = plan(w, '@xh/hoist-chat-kit').packages;
            assert.equal(kit.path, w.dirs['@xh/hoist-chat-kit']);
            assert.equal(kit.nodeModules, path.join(kit.path, 'node_modules'));
        });

        it('takes an explicit path, e.g. a worktree, as its real path', () => {
            const w = makeWorkspace({packages: {'@xh/hoist-chat-kit': KIT}}),
                link = path.join(w.ws, 'kit-link');
            fs.symlinkSync(w.dirs['@xh/hoist-chat-kit'], link);
            const [kit] = plan(w, `@xh/hoist-chat-kit=${link}`).packages;
            assert.equal(kit.path, w.dirs['@xh/hoist-chat-kit']);
        });

        it('fails fast on a missing checkout, naming where it looked and the override', () => {
            const w = makeWorkspace();
            assert.throws(
                () => plan(w, '@xh/hoist-chat-kit'),
                e =>
                    e.includes(`no checkout at ${path.join(w.ws, 'hoist-chat-kit')}`) &&
                    e.includes('"@xh/hoist-chat-kit=/abs/path" in XH_INLINE_PACKAGES')
            );
            assert.throws(
                () => plan(w, '@xh/hoist-chat-kit=/no/such/dir'),
                /points at \/no\/such\/dir, which holds no package.json/
            );
        });

        it('fails fast on a checkout with dependencies but no node_modules', () => {
            const w = makeWorkspace({packages: {'@xh/hoist-chat-kit': KIT, 'acme-hoist': {}}});
            fs.rmSync(path.join(w.dirs['@xh/hoist-chat-kit'], 'node_modules'), {recursive: true});
            fs.rmSync(path.join(w.dirs['acme-hoist'], 'node_modules'), {recursive: true});
            assert.throws(
                () => plan(w, '@xh/hoist-chat-kit'),
                e => e.includes('has no node_modules') && e.includes('`pnpm install`')
            );
            // No dependencies of its own, nothing to install.
            assert.equal(plan(w, 'acme-hoist').packages.length, 1);
        });

        it('fails fast when the checkout holds another package', () => {
            const w = makeWorkspace({packages: {'@xh/other': {}}});
            assert.throws(
                () => plan(w, `@xh/hoist-chat-kit=${w.dirs['@xh/other']}`),
                /holds "@xh\/other" instead/
            );
        });
    });

    describe('shared copies', () => {
        it("sends the kit's peers and Hoist to the app's copies, not the checkout's", () => {
            const w = makeWorkspace({packages: {'@xh/hoist-chat-kit': KIT}}),
                p = plan(w, '@xh/hoist-chat-kit'),
                shared = sharedMap(p);

            assert.deepEqual(shared['@xh/hoist-chat-kit'], {
                name: '@xh/hoist-chat-kit',
                dir: w.dirs['@xh/hoist-chat-kit'],
                source: 'inline'
            });
            // The installed Hoist, by its real path in the store - not the kit's devDependency.
            assert.deepEqual(shared['@xh/hoist'], {
                name: '@xh/hoist',
                dir: w.hoistInstalled,
                source: 'app'
            });
            assert.equal(shared.react.dir, path.join(w.appRoot, 'node_modules', 'react'));
            assert.equal(shared['react-dom'].source, 'app');
            // The kit's own dependencies are left to resolve from its checkout.
            assert.equal(shared.rxjs, undefined);
            assert.equal(shared.lodash, undefined);
            assert.deepEqual(p.warnings, []);
        });

        it('sends Hoist to the inline checkout under inline Hoist', () => {
            const w = makeWorkspace({packages: {'@xh/hoist-chat-kit': KIT}}),
                shared = sharedMap(plan(w, '@xh/hoist-chat-kit', {inlineHoist: true}));
            assert.deepEqual(shared['@xh/hoist'], {
                name: '@xh/hoist',
                dir: w.hoistCheckout,
                source: 'inline'
            });
        });

        it('shares the singletons and extras the app has, and skips those it lacks', () => {
            const w = makeWorkspace({
                    appDeps: {react: '19.3.1', 'react-dom': '19.3.1', 'ag-grid-react': '36.3.0'},
                    packages: {'@xh/hoist-chat-kit': KIT}
                }),
                shared = sharedMap(
                    plan(w, '@xh/hoist-chat-kit', {extraSingletons: ['msw', 'ag-grid-react']})
                );
            assert.equal(shared['ag-grid-react'].source, 'app');
            assert.equal(shared['ag-grid-community'], undefined);
            assert.equal(shared.msw, undefined);
        });

        it("takes a peer the app does not install from Hoist's own dependencies", () => {
            const w = makeWorkspace({
                    packages: {'acme-hoist': {peerDependencies: {mobx: '^6'}}}
                }),
                shared = sharedMap(plan(w, 'acme-hoist'));
            assert.deepEqual(shared.mobx, {
                name: 'mobx',
                dir: path.join(path.dirname(path.dirname(w.hoistInstalled)), 'mobx'),
                source: 'hoist'
            });
        });

        it('fails fast on a missing required peer, naming package, peer and where it looked', () => {
            const w = makeWorkspace({
                packages: {'acme-hoist': {peerDependencies: {'acme-charts': '^2'}}}
            });
            assert.throws(
                () => plan(w, 'acme-hoist'),
                e =>
                    e.startsWith('Inline package acme-hoist needs peer "acme-charts"') &&
                    e.includes(path.join(w.appRoot, 'node_modules')) &&
                    e.includes(w.hoistInstalled)
            );
        });

        it('skips a missing optional peer', () => {
            const w = makeWorkspace({
                    packages: {
                        'acme-hoist': {
                            peerDependencies: {'acme-charts': '^2'},
                            peerDependenciesMeta: {'acme-charts': {optional: true}}
                        }
                    }
                }),
                shared = sharedMap(plan(w, 'acme-hoist'));
            assert.equal(shared['acme-charts'], undefined);
        });
    });

    describe('an overlay that peers on the kit, both inline', () => {
        const overlay = {
            peerDependencies: {'@xh/hoist': '>=91', '@xh/hoist-chat-kit': '>=2', react: '^19'}
        };

        [false, true].forEach(inlineHoist => {
            it(`shares one Hoist and one kit, ${inlineHoist ? 'inline' : 'installed'} Hoist`, () => {
                const w = makeWorkspace({
                        appDeps: {
                            react: '19.3.1',
                            'react-dom': '19.3.1',
                            '@xh/hoist-chat-kit': '2.1.0'
                        },
                        packages: {
                            '@xh/hoist-chat-kit': {...KIT, version: '2.1.0'},
                            'acme-hoist-react': overlay
                        }
                    }),
                    // Listed overlay first - its peer on the kit must still reach the checkout.
                    p = plan(w, 'acme-hoist-react,@xh/hoist-chat-kit', {inlineHoist}),
                    shared = sharedMap(p);

                assert.deepEqual(
                    p.packages.map(it => it.name),
                    ['acme-hoist-react', '@xh/hoist-chat-kit']
                );
                assert.equal(shared['@xh/hoist-chat-kit'].dir, w.dirs['@xh/hoist-chat-kit']);
                assert.equal(shared['@xh/hoist-chat-kit'].source, 'inline');
                assert.equal(shared['acme-hoist-react'].dir, w.dirs['acme-hoist-react']);
                assert.equal(
                    shared['@xh/hoist'].dir,
                    inlineHoist ? w.hoistCheckout : w.hoistInstalled
                );
                assert.equal(shared.react.dir, path.join(w.appRoot, 'node_modules', 'react'));
                // Nothing shared from a checkout's own node_modules.
                p.shared.forEach(({dir}) =>
                    Object.values(w.dirs).forEach(d =>
                        assert.ok(!dir.startsWith(path.join(d, 'node_modules')), dir)
                    )
                );
                assert.deepEqual(p.warnings, []);
            });
        });
    });

    describe('warnings', () => {
        it('accepts a Hoist snapshot against a release floor and a snapshot floor', () => {
            ['>=89.3.1', '>=91.0.0-SNAPSHOT', '^91.0.0-SNAPSHOT'].forEach(range => {
                const w = makeWorkspace({
                    packages: {'@xh/hoist-chat-kit': {peerDependencies: {'@xh/hoist': range}}}
                });
                assert.deepEqual(plan(w, '@xh/hoist-chat-kit').warnings, [], range);
            });
        });

        it("warns when a peer range misses the version the app will run, inline Hoist's too", () => {
            const w = makeWorkspace({
                packages: {
                    '@xh/hoist-chat-kit': {
                        peerDependencies: {'@xh/hoist': '>=92', react: '^18 || ^19.4'}
                    }
                }
            });
            assert.deepEqual(plan(w, '@xh/hoist-chat-kit').warnings, [
                '@xh/hoist-chat-kit wants @xh/hoist ">=92", but the app will run ' +
                    '91.0.0-SNAPSHOT.1794870436776.',
                '@xh/hoist-chat-kit wants react "^18 || ^19.4", but the app will run 19.3.1.'
            ]);
            assert.match(
                plan(w, '@xh/hoist-chat-kit', {inlineHoist: true}).warnings[0],
                /will run 91.0.0-SNAPSHOT\.$/
            );
        });

        it('warns on a shared name or @xh package listed under dependencies', () => {
            const w = makeWorkspace({
                packages: {
                    'acme-hoist': {
                        peerDependencies: {'@xh/hoist': '*'},
                        dependencies: {react: '^19', '@xh/hoist-chat-kit': '^2', zod: '^4'}
                    }
                }
            });
            assert.deepEqual(plan(w, 'acme-hoist').warnings, [
                'acme-hoist lists "react" in dependencies - it should be a peerDependency.',
                'acme-hoist lists "@xh/hoist-chat-kit" in dependencies - it should be a peerDependency.'
            ]);
        });

        it("warns when the app's package.json does not list the package", () => {
            const w = makeWorkspace({appPkgDeps: {}, packages: {'@xh/hoist-chat-kit': KIT}});
            assert.deepEqual(plan(w, '@xh/hoist-chat-kit').warnings, [
                "@xh/hoist-chat-kit is not in the app's package.json - running it inline anyway."
            ]);
        });
    });
});
