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
    INFER_FROM_RELEASES = 20;

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
        inferred = inferConfig(changelog);

    const config = {
        sections: fileConfig?.sections ?? inferred.sections,
        headingFormat: fileConfig?.headingFormat ?? inferred.headingFormat,
        maxLineLength: fileConfig?.maxLineLength ?? null,
        allowOtherSections: fileConfig?.allowOtherSections ?? false,
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
    return fs
        .readdirSync(fragmentDir)
        .filter(f => f.endsWith('.md') && !f.startsWith('.') && !NON_FRAGMENT_FILES.includes(f))
        .sort();
}

/**
 * Infer sections and heading format from the changelog's recent releases. Section order merges
 * the order each release uses, so a section keeps its place relative to its neighbors.
 */
function inferConfig(changelog) {
    const released = changelog.releases.filter(r => !r.unreleased),
        recent = released.slice(0, INFER_FROM_RELEASES),
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

    // Rank each section by how many others it usually precedes, so one release with an odd
    // order does not decide the result. Ties keep first-seen order.
    const votes = (a, b) => before.get(`${a}\n${b}`) ?? 0,
        score = a => sections.reduce((sum, b) => sum + Math.sign(votes(a, b) - votes(b, a)), 0),
        scores = new Map(sections.map(s => [s, score(s)]));
    sections.sort((a, b) => scores.get(b) - scores.get(a));

    const latestTitle = released[0]?.title ?? '',
        headingFormat = /^v\d/.test(latestTitle)
            ? '## v{version} - {date}'
            : '## {version} - {date}';

    return {sections, headingFormat};
}

/**
 * True if two section titles name the same section. Ignores case, spacing and emoji variation
 * selectors, so `⚙ Technical` matches `⚙️ Technical`.
 */
function sameSection(a, b) {
    return sectionKey(a) === sectionKey(b);
}

function sectionKey(title) {
    return (title ?? '').replace(/️/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
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
    inferConfig,
    sameSection
};
