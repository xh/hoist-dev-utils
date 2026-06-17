#!/usr/bin/env node
// Diff this package's package.json dependency *specs* and emit CHANGELOG-ready lines.
//
// Why specs, not resolved versions: the CHANGELOG answers one question for an app dev taking a new
// @xh/hoist-dev-utils release — "what does this release change for me?" The answer is exactly the
// set of semver specs we newly allow or require. A `yarn upgrade` that bumps a dep *within* an
// unchanged range (say a `5.x` dep going 5.6 → 5.7) is NOT something this release delivers — an app
// could resolve that on its own with its own `yarn upgrade`. So that drift must NOT appear in the
// CHANGELOG. Only a change to a spec in package.json does. That is what this script compares.
//
// "Before" defaults to the committed package.json (`git show HEAD:package.json`), which is the
// pre-refresh baseline as long as the refresh hasn't been committed yet. "After" is the working
// tree. The skill requires a clean tree at the start, so HEAD is the correct baseline.
//
// Usage:
//   node spec-diff.mjs                       Compare HEAD:package.json → working package.json.
//   node spec-diff.mjs before.json after.json  Compare two explicit package.json files instead.

import {readFileSync, existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {dirname, resolve} from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = findRepoRoot(here);

function findRepoRoot(start) {
    let dir = start;
    for (let i = 0; i < 10; i++) {
        if (existsSync(resolve(dir, 'package.json')) && existsSync(resolve(dir, 'configureWebpack.js'))) {
            return dir;
        }
        const parent = dirname(dir);
        if (parent === dir) break;
        dir = parent;
    }
    return process.cwd();
}

// All direct deps (runtime + dev) keyed by name → spec string.
function specsFromPkg(pkgJsonText) {
    const pkg = JSON.parse(pkgJsonText);
    return {...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {})};
}

// Render a spec to the token the CHANGELOG uses: strip the range operator, keep major.minor.
//   ~5.106.2 → 5.106    ^7.28.5 → 7.28    4.x → 4.x    5.x → 5.x    18.x → 18.x
function specToken(spec) {
    const cleaned = String(spec).replace(/^[\^~>=<\s]+/, '');
    return cleaned.split('.').slice(0, 2).join('.');
}

// Leading numeric major of a spec, for detecting major-version crossings.
function specMajor(spec) {
    return String(spec).replace(/^[\^~>=<\s]+/, '').split('.')[0];
}

let beforeText, afterText;
const args = process.argv.slice(2);
if (args.length === 2) {
    beforeText = readFileSync(args[0], 'utf8');
    afterText = readFileSync(args[1], 'utf8');
} else {
    beforeText = execFileSync('git', ['show', 'HEAD:package.json'], {cwd: repoRoot, encoding: 'utf8'});
    afterText = readFileSync(resolve(repoRoot, 'package.json'), 'utf8');
}

const before = specsFromPkg(beforeText);
const after = specsFromPkg(afterText);

const names = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
const changelog = []; // spec changes that crossed a minor/major — these go in the CHANGELOG
const majors = []; // subset that crossed a major — need breaking-change review
const ignored = []; // spec edits that didn't cross a minor (e.g. patch-floor) — not changelogged

for (const name of names) {
    const b = before[name];
    const a = after[name];

    if (b && !a) {
        changelog.push(`* ${name} \`removed\``);
        continue;
    }
    if (!b && a) {
        changelog.push(`* ${name} \`added @ ${specToken(a)}\``);
        continue;
    }
    if (b === a) continue; // spec untouched — nothing this release changes for the dep

    const [bt, at] = [specToken(b), specToken(a)];
    if (bt !== at) {
        changelog.push(`* ${name} \`${bt} → ${at}\``);
        if (specMajor(b) !== specMajor(a)) majors.push(`${name}: ${b} → ${a}`);
    } else {
        ignored.push(`${name}: ${b} → ${a}  (same major.minor — not changelogged)`);
    }
}

console.log('=== CHANGELOG 📚 Libraries entries (spec changes — copy these) ===');
console.log(changelog.length ? changelog.join('\n') : '(none — no spec changes; nothing to changelog)');

console.log('\n=== ⚠️  MAJOR spec bumps — review breaking changes + note hoist-react/Node impact ===');
console.log(majors.length ? majors.join('\n') : '(none)');

console.log('\n=== Spec edits below minor granularity (NOT changelogged) ===');
console.log(ignored.length ? ignored.join('\n') : '(none)');
