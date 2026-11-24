/*
 * This file belongs to Hoist, an application development toolkit
 * developed by Extremely Heavy Industries (www.xh.io | info@xh.io)
 *
 * Copyright © 2026 Extremely Heavy Industries Inc.
 */
'use strict';

/**
 * Locates a repo's changelog files and resolves its fragment settings, from
 * `changelog.d/config.json` when present, otherwise inferred from CHANGELOG.md itself.
 */

const fs = require('fs'),
    path = require('path'),
    {parseChangelog} = require('./parse');

const CHANGELOG_FILE = 'CHANGELOG.md',
    FRAGMENT_DIR = 'changelog.d',
    CONFIG_FILE = 'config.json',
    NON_FRAGMENT_FILES = ['README.md'],
    INFER_FROM_RELEASES = 20,
    HOUSE_LINE_LENGTH = 100;

/**
 * Find the directory that holds CHANGELOG.md, walking up from `startDir`. Apps keep their
 * changelog at the repo root, one level above `client-app/`, where dev-utils is installed.
 */
function findChangelogRoot(startDir = process.cwd()) {
    let dir = path.resolve(startDir);
    for (;;) {
        if (fs.existsSync(path.join(dir, CHANGELOG_FILE))) return dir;
        const parent = path.dirname(dir);
        if (parent === dir) return null;
        dir = parent;
    }
}

/**
 * Load everything the CLI needs about one repo's changelog.
 *
 * @param {string} root - directory holding CHANGELOG.md.
 */
function loadChangelogContext(root) {
    const changelogPath = path.join(root, CHANGELOG_FILE),
        fragmentDir = path.join(root, FRAGMENT_DIR),
        configPath = path.join(fragmentDir, CONFIG_FILE),
        changelogText = fs.readFileSync(changelogPath, 'utf8'),
        changelog = parseChangelog(changelogText),
        fileConfig = fs.existsSync(configPath) ? readJson(configPath) : null,
        inferred = inferConfig(changelog, changelogText);

    const config = {
        sections: fileConfig?.sections ?? inferred.sections,
        headingFormat: fileConfig?.headingFormat ?? inferred.headingFormat,
        maxLineLength: fileConfig?.maxLineLength ?? null,
        allowOtherSections: fileConfig?.allowOtherSections ?? false,
        compactHeadings: fileConfig?.compactHeadings ?? inferred.compactHeadings,
        bullet: inferred.bullet,
        configured: !!fileConfig
    };

    return {
        root,
        changelogPath,
        changelogText,
        changelog,
        fragmentDir,
        configPath,
        config
    };
}

/** List fragment file names in `changelog.d/`, in name order. */
function listFragmentFiles(fragmentDir) {
    if (!fs.existsSync(fragmentDir)) return [];
    return fs.readdirSync(fragmentDir).filter(isFragmentName).sort();
}

/** True if a file name in `changelog.d/` is a fragment. */
function isFragmentName(name) {
    return name.endsWith('.md') && !name.startsWith('.') && !NON_FRAGMENT_FILES.includes(name);
}

/**
 * List entries in `changelog.d/` that are not fragments and not the tool's own files, such as a
 * fragment saved without `.md` or in a subfolder. A release would leave their entries out.
 */
function listStrayFiles(fragmentDir) {
    if (!fs.existsSync(fragmentDir)) return [];
    return fs
        .readdirSync(fragmentDir)
        .filter(
            f =>
                !isFragmentName(f) &&
                !f.startsWith('.') &&
                f !== CONFIG_FILE &&
                !NON_FRAGMENT_FILES.includes(f)
        )
        .sort();
}

/**
 * Infer sections, heading format, bullet marker and line length from the changelog's recent
 * releases. Section order merges the order each release uses, so a section keeps its place
 * relative to its neighbors.
 *
 * @param {Object} changelog - result of `parseChangelog()`.
 * @param {string} [changelogText] - source, to infer `maxLineLength` from.
 */
function inferConfig(changelog, changelogText) {
    const released = changelog.releases.filter(r => !r.unreleased),
        // A changelog with no release yet has only its unreleased block to learn from.
        source = released.length ? released : changelog.releases,
        recent = source.slice(0, INFER_FROM_RELEASES),
        sections = [],
        before = new Map(); // `a\nb` -> number of releases that list a before b

    recent.forEach(release => {
        const titles = [];
        release.sections.forEach(({title}) => {
            if (title == null) return;
            let known = sections.find(it => sameSection(it, title));
            if (!known) sections.push((known = title));
            if (!titles.includes(known)) titles.push(known);
        });
        titles.forEach((a, i) =>
            titles
                .slice(i + 1)
                .forEach(b => before.set(`${a}\n${b}`, (before.get(`${a}\n${b}`) ?? 0) + 1))
        );
    });

    const ordered = orderSections(sections, before),
        latestTitle = source[0]?.title ?? '',
        headingFormat = /^v\d/.test(latestTitle)
            ? '## v{version} - {date}'
            : '## {version} - {date}';

    // The marker the latest entry uses, so a generated bullet matches its neighbors.
    const firstEntry = source
            .flatMap(r => r.sections)
            .flatMap(s => s.blocks)
            .find(b => b.type === 'entry'),
        bullet = /^\s*([*+-])/.exec(firstEntry?.text ?? '')?.[1] ?? '*';

    return {
        sections: ordered,
        headingFormat,
        bullet,
        maxLineLength: inferLineLength(recent, changelogText),
        compactHeadings: inferCompactHeadings(recent, changelogText)
    };
}

/**
 * Order sections the way most releases do. A section goes before every section that most
 * releases put after it, so one release with an odd order does not decide the result. Where the
 * releases do not say, such as for two sections that never share a release, the section that
 * precedes more of the others goes first, and a Libraries section goes last.
 *
 * @param {string[]} sections - titles, in first-seen order.
 * @param {Map} before - `a\nb` -> number of releases that list a before b.
 */
function orderSections(sections, before) {
    const votes = (a, b) => before.get(`${a}\n${b}`) ?? 0,
        beats = (a, b) => votes(a, b) > votes(b, a),
        score = a => sections.reduce((sum, b) => sum + Math.sign(votes(a, b) - votes(b, a)), 0),
        scores = new Map(sections.map(s => [s, score(s)])),
        isLibraries = s => (/librar/i.test(s) ? 1 : 0),
        remaining = [...sections],
        ordered = [];

    while (remaining.length) {
        // If the votes form a cycle, no section is free. Then rank decides alone.
        const free = remaining.filter(s => !remaining.some(o => o !== s && beats(o, s))),
            pool = free.length ? free : remaining,
            [next] = [...pool].sort(
                (a, b) => isLibraries(a) - isLibraries(b) || scores.get(b) - scores.get(a)
            );
        ordered.push(next);
        remaining.splice(remaining.indexOf(next), 1);
    }
    return ordered;
}

// True if most `###` headings in the recent releases have their first line right below them,
// with no blank line between.
function inferCompactHeadings(recent, changelogText) {
    if (!changelogText) return false;
    const lines = changelogText.replace(/^\uFEFF/, '').split(/\r\n?|\n/),
        headings = recent.flatMap(r => r.sections).filter(s => s.title != null && s.blocks.length),
        compact = headings.filter(s => (lines[s.line] ?? '').trim() !== '');
    return headings.length > 0 && compact.length > headings.length / 2;
}

// The house line length if the recent releases keep to it, else null. A changelog that writes
// each bullet as one long line has no limit to enforce.
function inferLineLength(recent, changelogText) {
    if (!changelogText || !recent.length) return null;
    const lines = changelogText
        .split(/\r?\n/)
        .slice(recent[0].startLine, recent.at(-1).endLine)
        .filter(l => l.trim() && !/https?:\/\//.test(l));
    if (lines.length < 20) return null;
    const long = lines.filter(l => l.length > HOUSE_LINE_LENGTH).length;
    return long / lines.length < 0.02 ? HOUSE_LINE_LENGTH : null;
}

/**
 * True if two section titles name the same section. Ignores case, spacing and emoji, so a
 * fragment can write `### Bug Fixes` for the configured `### 🐞 Bug Fixes`.
 */
function sameSection(a, b) {
    return sectionKey(a) === sectionKey(b);
}

/**
 * Find the configured section a short name refers to: its title with or without emoji, or any
 * part of it, such as `fix` for `🐞 Bug Fixes`.
 *
 * @returns {string[]} matching section titles - one if the name is clear.
 */
function findSections(sections, name) {
    const key = sectionKey(name),
        exact = sections.filter(s => sectionKey(s) === key);
    if (exact.length || key.length < 3) return exact;
    // `features` and `fixes` are as natural to type as `feature` and `fix`.
    const stem = key.replace(/(es|s)$/, '');
    return sections.filter(s => sectionKey(s).includes(stem.length >= 3 ? stem : key));
}

function sectionKey(title) {
    return (title ?? '')
        .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, '')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}

function readJson(file) {
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) {
        throw new Error(`Could not read ${file}: ${e.message}`);
    }
}

module.exports = {
    CHANGELOG_FILE,
    FRAGMENT_DIR,
    CONFIG_FILE,
    findChangelogRoot,
    loadChangelogContext,
    listFragmentFiles,
    listStrayFiles,
    isFragmentName,
    inferConfig,
    sameSection,
    findSections
};
