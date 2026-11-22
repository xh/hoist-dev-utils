/*
 * This file belongs to Hoist, an application development toolkit
 * developed by Extremely Heavy Industries (www.xh.io | info@xh.io)
 *
 * Copyright © 2026 Extremely Heavy Industries Inc.
 */
'use strict';

/**
 * Reads a repo's changelog fragments and assembles them. Shared by the `xh-changelog` CLI and by
 * app builds, which show unreleased fragments in-app as the version under development.
 */

const fs = require('fs'),
    path = require('path'),
    {FRAGMENT_DIR, loadChangelogContext, listFragmentFiles} = require('./config'),
    {parseFragment} = require('./parse'),
    {validateFragment, assembleBody, insertUnreleased} = require('./assemble');

/**
 * Validate and assemble every fragment in `changelog.d/`, in file name order.
 *
 * @param {Object} ctx - from `loadChangelogContext()`.
 * @param {Object} [opts]
 * @param {{name: string, text: string}[]} [opts.extra] - more fragments to append, taken as
 *      written without fragment checks.
 * @param {string[]} [opts.only] - fragment file names to keep. Default is all of them.
 * @returns {{markdown: string, sectionTitles: string[], files: string[], count: number,
 *      problems: Object[]}} - each problem has `file` (relative to the changelog's directory),
 *      `line`, `level` and `message`.
 */
function assembleFragments(ctx, {extra = [], only = null} = {}) {
    const files = listFragmentFiles(ctx.fragmentDir).filter(f => !only || only.includes(f)),
        problems = [],
        fragments = [];

    files.forEach(name => {
        const text = fs.readFileSync(path.join(ctx.fragmentDir, name), 'utf8'),
            result = validateFragment(text, ctx.config);
        result.problems.forEach(p => problems.push({file: path.join(FRAGMENT_DIR, name), ...p}));
        fragments.push({name, sections: result.sections});
    });
    extra.forEach(({name, text}) => fragments.push({name, sections: parseFragment(text).sections}));

    const {markdown, sectionTitles} = assembleBody(fragments, ctx.config);
    return {markdown, sectionTitles, files, count: fragments.length, problems};
}

/**
 * CHANGELOG.md text with any fragments assembled under its unreleased heading. If the changelog
 * has no unreleased heading, adds `## <version> - unreleased`. The file itself is not changed.
 *
 * @param {string} root - directory holding CHANGELOG.md.
 * @param {Object} opts
 * @param {string} opts.version - version for a new unreleased heading.
 * @returns {{text: string, count: number, problems: Object[]}}
 */
function changelogWithUnreleased(root, {version}) {
    const ctx = loadChangelogContext(root),
        {markdown, count, problems} = assembleFragments(ctx);
    if (!count) return {text: ctx.changelogText, count, problems};

    const heading = `## ${version} - unreleased`;
    return {text: insertUnreleased(ctx.changelogText, {body: markdown, heading}), count, problems};
}

module.exports = {assembleFragments, changelogWithUnreleased};
