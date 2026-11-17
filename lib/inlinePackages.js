/*
 * This file belongs to Hoist, an application development toolkit
 * developed by Extremely Heavy Industries (www.xh.io | info@xh.io)
 *
 * Copyright © 2026 Extremely Heavy Industries Inc.
 */
'use strict';

/**
 * Inline mode: run local checkouts in place of installed packages - hoist-react under `inlineHoist`,
 * and Hoist companion packages (e.g. `@xh/hoist-chat-kit`, `@xh/package-template` or a client's own
 * overlay on hoist-react) under `inlinePackages`. `configureRsbuild()` and `configureVitest()` both
 * build on the plan made here. `resolveHoistPath()` in `lib/hoistCompile.js` still finds the
 * hoist-react checkout, as the build uses that path well beyond module resolution. No bundler API,
 * as for `lib/common.js`.
 *
 * A checkout has its own node_modules, holding its peers (`@xh/hoist`, React) as devDependencies.
 * Resolved from there, they would load a second Hoist and a second React into the app. So every
 * peer of an inline package, plus `@xh/hoist` and the inline Hoist singletons, is "shared": the
 * plan maps each to one directory that every importer gets. The package's own dependencies still
 * resolve from its checkout, as its lockfile lays them out.
 */

const _ = require('lodash'),
    path = require('path'),
    fs = require('fs'),
    semver = require('semver'),
    {safeRealpath} = require('./common'),
    {INLINE_HOIST_SINGLETONS} = require('./hoistCompile');

/** Lists the packages to run inline, as `name` or `name=/abs/path`, comma-separated. */
const INLINE_PACKAGES_VAR = 'XH_INLINE_PACKAGES';

const HOIST = '@xh/hoist';

/**
 * Parse inline package specs from the `inlinePackages` option or `XH_INLINE_PACKAGES`: a
 * comma-separated string or an array, each entry `name` or `name=/abs/path`.
 * @returns {{name: string, path: ?string}[]}
 */
function parseInlinePackages(val) {
    if (val == null || val === false || val === '') return [];
    const entries = _.isString(val) ? val.split(',') : _.castArray(val);
    if (!entries.every(_.isString)) {
        throw `inlinePackages takes package names, as "name" or "name=/abs/path".`;
    }

    const ret = [];
    entries
        .map(it => it.trim())
        .filter(Boolean)
        .forEach(entry => {
            // Split at the first '=' - a scoped name holds no '=', a path may.
            const idx = entry.indexOf('='),
                name = (idx < 0 ? entry : entry.slice(0, idx)).trim(),
                dir = idx < 0 ? null : entry.slice(idx + 1).trim() || null;

            if (!name) throw `inlinePackages entry "${entry}" has no package name.`;
            if (name === HOIST || name.startsWith(HOIST + '/')) {
                throw `inlinePackages cannot hold ${HOIST} - use inlineHoist for hoist-react.`;
            }
            if (dir && !path.isAbsolute(dir)) {
                throw `inlinePackages path for ${name} must be absolute - found "${dir}".`;
            }
            if (ret.some(it => it.name === name)) {
                throw `inlinePackages lists ${name} more than once.`;
            }
            ret.push({name, path: dir});
        });
    return ret;
}

/**
 * Plan inline mode: locate each package checkout, then pick one directory for each shared name.
 * Plans nothing when neither Hoist nor any package is inline. Throws, before the build logs
 * anything, when a checkout or a required peer is missing. Returns warnings for the caller to log.
 *
 * @param {Object} opts
 * @param {string} opts.appRoot - the app's root dir (client-app), a real path.
 * @param {{name: string, path: ?string}[]} opts.specs - from `parseInlinePackages()`.
 * @param {string} opts.hoistPath - hoist-react's real path, inline checkout or installed.
 * @param {boolean} opts.inlineHoist - true when hoistPath is an inline checkout.
 * @param {string[]} [opts.extraSingletons] - more names to share when the app has them.
 * @returns {{packages: Object[], shared: Object[], warnings: string[]}} - `packages` holds
 *      `{name, path, nodeModules, pkg}` per checkout, `shared` holds `{name, dir, source}` per
 *      shared name, where source is 'inline' (a checkout), 'app' or 'hoist' (Hoist's own copy, for
 *      a transitive peer the app does not install).
 */
function planInlinePackages({appRoot, specs, hoistPath, inlineHoist, extraSingletons = []}) {
    const warnings = [],
        packages = specs.map(spec => locatePackage(appRoot, spec));
    if (!packages.length && !inlineHoist) return {packages, shared: [], warnings};

    // Checkouts first - an import of an inline name always goes to its checkout.
    const inlineDirs = new Map(packages.map(p => [p.name, p.path]));
    if (inlineHoist) inlineDirs.set(HOIST, hoistPath);

    const shared = new Map();
    const share = (name, dir, source) => shared.set(name, {name, dir, source});
    inlineDirs.forEach((dir, name) => share(name, dir, 'inline'));

    // Hoist is a singleton whether or not it is inline - it is our `hoistPath` either way.
    if (!shared.has(HOIST)) share(HOIST, hoistPath, 'app');

    // Peers. A required peer must resolve, an optional one is shared only when found.
    packages.forEach(({name, pkg}) => {
        const optional = pkg.peerDependenciesMeta ?? {};
        Object.keys(pkg.peerDependencies ?? {}).forEach(peer => {
            if (shared.has(peer)) return;
            const found = findSharedCopy(peer, appRoot, hoistPath);
            if (found) return share(peer, found.dir, found.source);
            if (optional[peer]?.optional) return;
            throw (
                `Inline package ${name} needs peer "${peer}", which was not found in ` +
                `${path.join(appRoot, 'node_modules')} or from ${hoistPath}. Add "${peer}" ` +
                `to the app's dependencies.`
            );
        });
    });

    // Singletons, when the app installs them itself. Unlike a peer, a singleton the app lacks is
    // not one the app loads, so the checkouts' copies serve it.
    [...INLINE_HOIST_SINGLETONS, ...extraSingletons].forEach(name => {
        const dir = path.join(appRoot, 'node_modules', name);
        if (!shared.has(name) && fs.existsSync(path.join(dir, 'package.json'))) {
            share(name, safeRealpath(dir), 'app');
        }
    });

    packages.forEach(p => warnings.push(...checkPackage(p, shared, appRoot)));
    return {packages, shared: [...shared.values()], warnings};
}

/**
 * The keys of an app's `resolveAliases` that name a shared package - `react` or `react$`. The plan
 * replaces them, so a hand-written alias to a checkout from before inline packages stops applying.
 */
function replacedAppAliases(resolveAliases, shared) {
    const names = new Set(shared.map(it => it.name));
    return Object.keys(resolveAliases ?? {}).filter(key => names.has(key.replace(/\$$/, '')));
}

/**
 * Add the inline settings to a `buildCache` config's `cacheDigest`, keeping any digest the app
 * passed. Rsbuild keys the persistent cache on that digest, so a run with other inline settings
 * gets a cache of its own, not snapshots that resolve to the wrong copy. A build cache that is off,
 * or a run with nothing inline, is returned as passed.
 */
function withInlineCacheDigest(buildCache, {inlineHoist, hoistPath, packages}) {
    const digest = [
        ...(inlineHoist ? [`inlineHoist:${hoistPath}`] : []),
        ...packages.map(it => `inlinePackage:${it.name}=${it.path}`)
    ];
    if (!buildCache || !digest.length) return buildCache;

    const config = _.isPlainObject(buildCache) ? buildCache : {};
    return {...config, cacheDigest: [...(config.cacheDigest ?? []), ...digest]};
}

//------------------------
// Implementation
//------------------------
function locatePackage(appRoot, {name, path: explicitPath}) {
    // Default to a sibling of the app's repo, named for the package without its scope - as
    // hoist-react's default checkout is `../../hoist-react`.
    const dir = safeRealpath(explicitPath || path.resolve(appRoot, '../..', name.split('/').pop())),
        pkg = readJson(path.join(dir, 'package.json'));

    if (!pkg) {
        throw explicitPath
            ? `Inline package ${name} points at ${dir}, which holds no package.json.`
            : `Inline package ${name} found no checkout at ${dir}. Clone it there, or pass its ` +
                  `path as "${name}=/abs/path" in ${INLINE_PACKAGES_VAR}.`;
    }
    if (pkg.name !== name) {
        throw `Inline package ${name} points at ${dir}, which holds "${pkg.name}" instead.`;
    }
    // Its dependencies resolve from the checkout, so they must be installed there. Peers come
    // from the app, so a package with none of its own needs no install.
    const nodeModules = path.join(dir, 'node_modules');
    if (!_.isEmpty(pkg.dependencies) && !fs.existsSync(nodeModules)) {
        throw (
            `Inline package ${name} at ${dir} has no node_modules - install its dependencies ` +
            `there first (e.g. \`pnpm install\`).`
        );
    }
    return {name, path: dir, nodeModules, pkg};
}

/**
 * The copy of a shared name that every importer gets: the app's own, else the one Hoist loads -
 * e.g. MobX, which an app takes through `@xh/hoist/mobx` and does not install itself.
 */
function findSharedCopy(name, appRoot, hoistPath) {
    const appDir = findInNodeModules(name, appRoot);
    if (appDir) return {dir: appDir, source: 'app'};
    const hoistDir = findInNodeModules(name, hoistPath);
    return hoistDir ? {dir: hoistDir, source: 'hoist'} : null;
}

/**
 * Find a package's directory as Node would from `fromDir` - each node_modules up the tree - by its
 * package.json. A plain lookup, as `require.resolve('x/package.json')` fails on packages whose
 * `exports` field hides their package.json. Returns the real path, or null.
 */
function findInNodeModules(name, fromDir) {
    for (let dir = fromDir; ; dir = path.dirname(dir)) {
        const candidate = path.join(dir, 'node_modules', name);
        if (fs.existsSync(path.join(candidate, 'package.json'))) return safeRealpath(candidate);
        if (path.dirname(dir) === dir) return null;
    }
}

/** Warnings for one inline package: app pairing, peer ranges and misplaced dependencies. */
function checkPackage({name, pkg}, shared, appRoot) {
    const ret = [],
        appPkg = readJson(path.join(appRoot, 'package.json')) ?? {};

    if (!appPkg.dependencies?.[name] && !appPkg.devDependencies?.[name]) {
        ret.push(`${name} is not in the app's package.json - running it inline anyway.`);
    }

    // Warn only - a mismatch may be deliberate mid-way through a paired upgrade. Prereleases count,
    // or every Hoist snapshot would fail a plain floor such as ">=89.3.1".
    _.forEach(pkg.peerDependencies, (range, peer) => {
        const dir = shared.get(peer)?.dir,
            version = dir && readJson(path.join(dir, 'package.json'))?.version;
        if (!version || !semver.validRange(range)) return;
        if (!semver.satisfies(version, range, {includePrerelease: true})) {
            ret.push(`${name} wants ${peer} "${range}", but the app will run ${version}.`);
        }
    });

    // A shared name under `dependencies` still gets the shared copy here, but an install from npm
    // gives the package its own - declare it a peer so both agree. Other @xh packages are flagged
    // too: a second copy of a companion package would not be shared.
    Object.keys(pkg.dependencies ?? {}).forEach(dep => {
        if (shared.has(dep) || dep.startsWith('@xh/')) {
            ret.push(`${name} lists "${dep}" in dependencies - it should be a peerDependency.`);
        }
    });
    return ret;
}

function readJson(file) {
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) {
        return null;
    }
}

module.exports = {
    INLINE_PACKAGES_VAR,
    parseInlinePackages,
    planInlinePackages,
    replacedAppAliases,
    withInlineCacheDigest
};
