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
    {after, afterEach, beforeEach, describe, it, mock} = require('node:test');

const configureVitest = require('../configureVitest'),
    devUtilsPkg = require('../package.json'),
    devUtilsDir = path.resolve(__dirname, '..');

//------------------------
// Fixtures - throwaway app layouts under the OS temp dir.
//------------------------
const tmpRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'xh-vitest-preset-')));
let fixtureCount = 0;
after(() => fs.rmSync(tmpRoot, {recursive: true, force: true}));

function write(file, content = '') {
    fs.mkdirSync(path.dirname(file), {recursive: true});
    fs.writeFileSync(file, content);
}

function writePkg(dir, pkg) {
    write(path.join(dir, 'package.json'), JSON.stringify(pkg));
}

/**
 * An app at `<project>/client-app`, with @xh/hoist installed unless `hoist` is null, and a sibling
 * checkout at `<project>/../hoist-react` when `checkout` is set.
 */
function makeApp({
    hoist = {version: '89.0.0'},
    kit = true,
    apps = ['app.ts', 'admin.ts'],
    deps = [],
    checkout = null
} = {}) {
    const project = path.join(tmpRoot, `p${++fixtureCount}`, 'project'),
        root = path.join(project, 'client-app');
    writePkg(root, {name: 'app', version: '1.0.0'});
    apps?.forEach(f => write(path.join(root, 'src', 'apps', f), 'export {};'));
    if (hoist) {
        const hoistDir = path.join(root, 'node_modules', '@xh', 'hoist');
        writePkg(hoistDir, {name: '@xh/hoist', ...hoist});
        if (kit) write(path.join(hoistDir, 'test', 'setup.ts'));
    }
    deps.forEach(([name, version = '1.0.0']) =>
        writePkg(path.join(root, 'node_modules', name), {name, version})
    );
    if (checkout) {
        const checkoutDir = path.join(project, '..', 'hoist-react');
        writePkg(checkoutDir, {name: '@xh/hoist', ...checkout});
        if (kit) write(path.join(checkoutDir, 'test', 'setup.ts'));
    }
    return root;
}

const plugin = (config, name) => config.plugins.find(it => it.name === name);

// Keep the env vars the preset sets from leaking between tests.
const ENV_KEYS = [
    'TZ',
    'XH_INLINE_HOIST',
    'XH_VITEST_PRESET_VERSION',
    'XH_VITEST_INLINE_HOIST_CFG'
];
let savedEnv, warnings;
beforeEach(() => {
    savedEnv = Object.fromEntries(ENV_KEYS.map(k => [k, process.env[k]]));
    warnings = [];
    mock.method(console, 'warn', msg => warnings.push(msg));
});
afterEach(() => {
    ENV_KEYS.forEach(k => {
        if (savedEnv[k] === undefined) delete process.env[k];
        else process.env[k] = savedEnv[k];
    });
    mock.restoreAll();
});

//------------------------
// Specs
//------------------------
describe('configureVitest', () => {
    describe('emitted config', () => {
        it('defines the XH constants with build defaults, discovered apps and test values', () => {
            const root = makeApp(),
                {define} = configureVitest({appCode: 'my-app', root});
            assert.equal(define.xhAppCode, '"my-app"');
            assert.equal(define.xhAppName, '"My App"');
            assert.equal(define.xhAppVersion, '"1.0-SNAPSHOT"');
            assert.equal(define.xhAppBuild, '"UNKNOWN"');
            assert.equal(define.xhBaseUrl, '"/api/"');
            assert.deepEqual(JSON.parse(define.xhClientApps).sort(), ['admin', 'app']);
            assert.equal(define.xhIsDevelopmentMode, 'false');
            assert.equal(define.xhBuildTimestamp, '0');
        });

        it('leaves spec and test files in src/apps out of the client apps', () => {
            const root = makeApp({apps: ['app.ts', 'app.spec.ts', 'admin.ts', 'admin.test.ts']}),
                {define} = configureVitest({appCode: 'x', root});
            assert.deepEqual(JSON.parse(define.xhClientApps).sort(), ['admin', 'app']);
        });

        it("defaults client apps to ['app'] when src/apps is missing", () => {
            const root = makeApp({apps: null});
            assert.equal(configureVitest({appCode: 'x', root}).define.xhClientApps, '["app"]');
        });

        it("runs hoist-react's setup before the app's, with the isolation defaults", () => {
            const root = makeApp(),
                {test, root: configRoot} = configureVitest({
                    appCode: 'x',
                    root,
                    setupFiles: 'src/test/setup.ts'
                });
            assert.equal(configRoot, root);
            assert.deepEqual(test.setupFiles, [
                path.join(root, 'node_modules/@xh/hoist/test/setup.ts'),
                'src/test/setup.ts'
            ]);
            assert.deepEqual(test.include, ['src/**/*.spec.{ts,tsx}']);
            assert.equal(test.environment, 'jsdom');
            assert.equal(test.isolate, true);
            assert.equal(test.hookTimeout, 30_000);
            assert.equal(test.silent, 'passed-only');
            assert.ok(test.restoreMocks && test.unstubEnvs && test.unstubGlobals);
            assert.equal(test.exclude, undefined);
            assert.equal(test.reporters, undefined);
        });

        it('leaves @xh/hoist unaliased in packaged mode', () => {
            const {resolve, server} = configureVitest({appCode: 'x', root: makeApp()});
            assert.deepEqual(resolve.alias, []);
            assert.deepEqual(resolve.dedupe, []);
            assert.deepEqual(server, {});
        });

        it('converts resolveAliases, matching a key ending in $ exactly', () => {
            const {resolve} = configureVitest({
                appCode: 'x',
                root: makeApp(),
                resolveAliases: {'foo.bar$': '/x/foo', baz: '/x/baz', off: false}
            });
            const [exact, prefix] = resolve.alias;
            assert.equal(resolve.alias.length, 2);
            assert.ok(exact.find.test('foo.bar'));
            assert.ok(!exact.find.test('foo.bar/sub'));
            assert.ok(!exact.find.test('fooxbar'));
            assert.equal(exact.replacement, '/x/foo');
            assert.deepEqual(prefix, {find: 'baz', replacement: '/x/baz'});
            assert.match(warnings.join('\n'), /ignores alias "off"/);
        });

        it('resolves a relative alias against the root, as Rsbuild does', () => {
            const root = makeApp(),
                {resolve} = configureVitest({
                    appCode: 'x',
                    root,
                    resolveAliases: {shared: './src/shared', '@pkg': '../lib/pkg'}
                });
            assert.deepEqual(resolve.alias, [
                {find: 'shared', replacement: path.join(root, 'src/shared')},
                {find: '@pkg', replacement: path.join(root, '../lib/pkg')}
            ]);
        });

        it('keeps opt-in packages away from Node by their real directory', () => {
            const root = makeApp({deps: [['@xh/package-template']]}),
                pkgDir = path.join(root, 'node_modules/@xh/package-template'),
                {resolve} = configureVitest({appCode: 'x', root, extraIncludePaths: [pkgDir]});
            const [re] = resolve.noExternal;
            assert.ok(re.test(`${pkgDir}/index.js`));
            assert.ok(!re.test(`${pkgDir}-other/index.js`));
        });

        it('sets TZ and the preset version for workers to inherit', () => {
            process.env.TZ = 'UTC';
            configureVitest({appCode: 'x', root: makeApp()});
            assert.equal(process.env.TZ, 'America/New_York');
            assert.equal(process.env.XH_VITEST_PRESET_VERSION, devUtilsPkg.version);

            configureVitest({appCode: 'x', root: makeApp(), timeZone: 'Asia/Tokyo'});
            assert.equal(process.env.TZ, 'Asia/Tokyo');

            process.env.TZ = 'UTC';
            configureVitest({appCode: 'x', root: makeApp(), timeZone: null});
            assert.equal(process.env.TZ, 'UTC');
        });
    });

    describe('selfHost', () => {
        it('aliases @xh/hoist to the root and loads its test/setup.ts', () => {
            const root = makeApp({hoist: null, apps: null});
            write(path.join(root, 'test', 'setup.ts'));
            const {resolve, test, server} = configureVitest({appCode: 'x', root, selfHost: true});
            const [{find, replacement}] = resolve.alias;
            assert.equal(replacement, root);
            assert.ok(find.test('@xh/hoist') && find.test('@xh/hoist/core'));
            assert.ok(!find.test('@xh/hoist-dev-utils'));
            assert.deepEqual(test.setupFiles, [path.join(root, 'test/setup.ts')]);
            assert.deepEqual(resolve.dedupe, []);
            assert.deepEqual(server, {});
        });

        it("compiles hoist-react's source but not its dependencies' JS", async () => {
            const root = makeApp({hoist: null, apps: null});
            write(path.join(root, 'test', 'setup.ts'));
            const swc = plugin(configureVitest({appCode: 'x', root, selfHost: true}), 'xh-swc'),
                js = 'export const x = 1;',
                compiled = async file => (await swc.transform(js, file)) !== null;
            assert.ok(await compiled(path.join(root, 'core/a.js')), 'own JS');
            assert.ok(await compiled(path.join(root, 'node_modules/dep/a.ts')), 'TS anywhere');
            assert.ok(!(await compiled(path.join(root, 'node_modules/dep/a.js'))), 'dependency JS');
        });

        it('skips the vitest major check', () => {
            const root = makeApp({hoist: null, apps: null, deps: [['vitest', '5.0.3']]});
            write(path.join(root, 'test', 'setup.ts'));
            writePkg(root, {
                name: '@xh/hoist',
                version: '89.0.0',
                peerDependencies: {vitest: '^4'}
            });
            assert.doesNotThrow(() => configureVitest({appCode: 'x', root, selfHost: true}));
        });
    });

    describe('inline hoist', () => {
        it('turns on with XH_INLINE_HOIST and dedupes only the singletons the app has', () => {
            process.env.XH_INLINE_HOIST = 'true';
            const root = makeApp({
                    checkout: {version: '89.0.0-SNAPSHOT'},
                    deps: [['react'], ['msw'], ['mobx']]
                }),
                checkout = path.resolve(root, '../../hoist-react'),
                {resolve, server, test} = configureVitest({appCode: 'x', root});

            assert.deepEqual(resolve.alias.at(-1).replacement, checkout);
            assert.deepEqual(resolve.dedupe, ['react', 'msw', 'mobx']);
            assert.deepEqual(server.fs.allow, [root, checkout, devUtilsDir]);
            assert.deepEqual(test.setupFiles, [
                path.join(devUtilsDir, 'lib/vitestInlineHoist.mjs'),
                path.join(checkout, 'test/setup.ts')
            ]);
            assert.deepEqual(JSON.parse(process.env.XH_VITEST_INLINE_HOIST_CFG), {
                appRoot: root,
                hoistNodeModules: path.join(checkout, 'node_modules'),
                singletons: ['react', 'msw', 'mobx']
            });
        });

        it('skips the vitest major check against the checkout', () => {
            const peer = {peerDependencies: {vitest: '^6.0.0'}},
                root = makeApp({
                    checkout: {version: '89.0.0', ...peer},
                    deps: [['vitest', '5.0.3']]
                });
            assert.doesNotThrow(() => configureVitest({appCode: 'x', root, inlineHoist: true}));
        });

        it('clears the hook settings on a later packaged run', () => {
            const root = makeApp({checkout: {version: '89.0.0'}});
            configureVitest({appCode: 'x', root, inlineHoist: true});
            assert.ok(process.env.XH_VITEST_INLINE_HOIST_CFG);
            configureVitest({appCode: 'x', root});
            assert.equal(process.env.XH_VITEST_INLINE_HOIST_CFG, undefined);
        });
    });

    describe('fails fast', () => {
        it('without appCode, as an Error that Vite can report', () => {
            assert.throws(
                () => configureVitest({root: makeApp()}),
                e => e instanceof Error && /Missing required "appCode"/.test(e.message)
            );
        });

        it('on a hoist-react older than 89, noting that builds still work', () => {
            const root = makeApp({hoist: {version: '88.1.0'}, kit: false});
            assert.throws(() => configureVitest({appCode: 'x', root}), {
                message:
                    'configureVitest() needs hoist-react >= 89 - found v88.1.0. Upgrade ' +
                    '@xh/hoist to run unit tests. Builds still work with this version.'
            });
        });

        it('on a hoist-react 89 snapshot from before the test kit', () => {
            const root = makeApp({hoist: {version: '89.0.0-SNAPSHOT.1790701102970'}, kit: false});
            assert.throws(
                () => configureVitest({appCode: 'x', root}),
                /v89\.0\.0-SNAPSHOT\.1790701102970 has no test\/setup\.ts - it predates the unit test kit\. Update to a newer snapshot\./
            );
        });

        it('on an inline checkout without the test kit', () => {
            const root = makeApp({checkout: {version: '88.0.0'}, kit: false});
            assert.throws(
                () => configureVitest({appCode: 'x', root, inlineHoist: true}),
                /^Error: Inline hoist-react at .*hoist-react has no test\/setup\.ts/
            );
        });

        it('when @xh/hoist is not installed', () => {
            const root = makeApp({hoist: null});
            assert.throws(() => configureVitest({appCode: 'x', root}), /found no @xh\/hoist/);
        });

        it('on a vitest major that @xh/hoist does not declare as a peer', () => {
            const peer = {peerDependencies: {vitest: '^4.1.0 || ^6.0.0'}},
                root = makeApp({hoist: {version: '89.0.0', ...peer}, deps: [['vitest', '5.0.3']]});
            assert.throws(
                () => configureVitest({appCode: 'x', root}),
                /supports vitest \^4\.1\.0 \|\| \^6\.0\.0 - found vitest v5\.0\.3/
            );

            const ok = makeApp({
                hoist: {version: '89.0.0', peerDependencies: {vitest: '^5.0.3'}},
                deps: [['vitest', '5.1.0']]
            });
            assert.doesNotThrow(() => configureVitest({appCode: 'x', root: ok}));
        });

        it('reads a >= peer range as that major and up', () => {
            const app = (range, vitest) =>
                makeApp({
                    hoist: {version: '89.0.0', peerDependencies: {vitest: range}},
                    deps: [['vitest', vitest]]
                });
            assert.doesNotThrow(() =>
                configureVitest({appCode: 'x', root: app('>=4.0.0', '5.0.3')})
            );
            assert.doesNotThrow(() => configureVitest({appCode: 'x', root: app('*', '5.0.3')}));
            assert.throws(
                () => configureVitest({appCode: 'x', root: app('>=6', '5.0.3')}),
                /supports vitest >=6/
            );
        });
    });

    describe('options', () => {
        it('accepts build-only options silently, and warns on extraModuleRules and unknowns', () => {
            const root = makeApp();
            configureVitest({appCode: 'x', root, prodBuild: true, favicon: 'f.svg'});
            assert.deepEqual(warnings, []);

            configureVitest({appCode: 'x', root, extraModuleRules: [{test: /x/}], bogus: 1});
            assert.equal(warnings.length, 2);
            assert.match(warnings[0], /ignores "extraModuleRules"/);
            assert.match(warnings[1], /ignores unknown options .*: bogus/);
        });
    });

    describe('plugins', () => {
        const root = makeApp({deps: [['some-lib']]}),
            hoistPath = path.join(root, 'node_modules/@xh/hoist'),
            excluded = path.join(root, 'src/vendor');

        const swc = (env = {}) =>
            plugin(
                configureVitest({appCode: 'x', root, extraExcludePaths: [excluded], ...env}),
                'xh-swc'
            );

        const SOURCE = `
            const tag = (value: any, ctx: ClassAccessorDecoratorContext) => value;
            export class Model {
                @tag accessor count = 1;
            }`;

        it('compiles 2023-11 decorators and TS with source maps', async () => {
            const out = await swc().transform(SOURCE, path.join(root, 'src/Model.ts'));
            assert.ok(!out.code.includes('@tag'), 'decorator compiled');
            assert.ok(!out.code.includes(': any'), 'types erased');
            assert.ok(out.map?.mappings, 'source map returned');
        });

        it('picks files as the build JS rule does', async () => {
            const plugin = swc(),
                js = 'export const x = 1;',
                nm = path.join(root, 'node_modules');
            const compiled = async file => (await plugin.transform(js, file)) !== null;

            assert.ok(await compiled(path.join(root, 'src/a.js')), 'app JS');
            assert.ok(await compiled(path.join(nm, 'some-lib/a.ts')), 'TS anywhere');
            assert.ok(await compiled(path.join(hoistPath, 'static/a.js')), 'JS under hoist');
            assert.ok(!(await compiled(path.join(nm, 'some-lib/a.js'))), 'other packages');
            assert.ok(!(await compiled(path.join(root, 'src/a.d.ts'))), 'declarations');
            assert.ok(!(await compiled(path.join(excluded, 'a.ts'))), 'extraExcludePaths');
            assert.ok(!(await compiled(path.join(root, 'src/a.ts?raw'))), '?raw imports');
            assert.ok(!(await compiled(path.join(root, 'src/a.css'))), 'non-scripts');
        });

        it("applies the app's swcOptions and drops the build's preset-env settings", async () => {
            let seen;
            const fn = swc({
                swcOptions: opts => {
                    seen = opts;
                    opts.env = {targets: 'chrome 100'};
                }
            });
            await fn.transform(SOURCE, path.join(root, 'src/Model.ts'));
            assert.equal(seen.jsc.transform.decoratorVersion, '2023-11');

            // A function written for the build may set keys under `env` and `jsc.experimental`.
            const buildFn = swc({
                swcOptions: c => {
                    c.env.mode = 'entry';
                    c.jsc.experimental.plugins = [];
                }
            });
            assert.ok(await buildFn.transform(SOURCE, path.join(root, 'src/Model.ts')));

            const obj = swc({
                swcOptions: {env: {mode: 'entry'}, jsc: {transform: {react: {development: true}}}}
            });
            assert.ok(await obj.transform(SOURCE, path.join(root, 'src/Model.ts')));
        });

        it('stubs the changelog and stylesheets, and reads markdown as text', () => {
            const config = configureVitest({appCode: 'x', root}),
                changelog = plugin(config, 'xh-app-changelog'),
                styles = plugin(config, 'xh-skip-styles'),
                markdown = plugin(config, 'xh-markdown'),
                mdFile = path.join(root, 'src/README.md');
            write(mdFile, '# Hi "there"');

            assert.equal(
                changelog.load(changelog.resolveId('@xh/app-changelog.json')),
                'export default {};'
            );
            assert.equal(styles.load(styles.resolveId('./a.scss')), 'export default {};');
            assert.equal(styles.resolveId('./a.scss'), styles.resolveId('b.css'));
            ['b.scss?inline', 'b.scss?raw', 'b.css?url'].forEach(it =>
                assert.equal(styles.load(styles.resolveId(it)), "export default '';", it)
            );
            assert.equal(styles.resolveId('./a.ts'), null);
            assert.equal(styles.resolveId('./a.scss.ts'), null);
            assert.equal(markdown.load(mdFile), 'export default "# Hi \\"there\\"";');
            assert.equal(markdown.load(`${mdFile}?url`), null);
        });

        it('fails a run that turns off isolation', () => {
            const guards = plugin(configureVitest({appCode: 'x', root}), 'xh-guards');
            const check = config => () => guards.configureVitest({project: {config}});
            assert.throws(check({isolate: false, pool: 'forks'}), /Remove `--no-isolate`/);
            assert.throws(check({isolate: false, pool: 'vmThreads'}), /`vmThreads` pool runs/);
            assert.doesNotThrow(check({isolate: true, pool: 'threads'}));
        });
    });
});
