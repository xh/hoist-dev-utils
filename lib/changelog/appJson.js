/*
 * This file belongs to Hoist, an application development toolkit
 * developed by Extremely Heavy Industries (www.xh.io | info@xh.io)
 *
 * Copyright © 2026 Extremely Heavy Industries Inc.
 */
'use strict';

/**
 * Builds the JSON that hoist-react's `ChangelogService` imports as `@xh/app-changelog.json`, from
 * an app's CHANGELOG.md.
 *
 * The output keeps the shape of the `changelog-parser` package that earlier releases used, so that
 * every hoist-react version can read it:
 *
 *  {
 *      title: 'Changelog',
 *      versions: [{
 *          version: '2.1.0',
 *          title: 'v2.1.0 - 2026-10-01',
 *          date: '2026-10-01',
 *          body: '### New Features\n* Added ...',          // source markdown of the release
 *          parsed: {                                       // plain text, markdown stripped
 *              _: ['Added `Foo` ...', ...],                // every entry in the release
 *              'New Features': ['Added Foo ...']           // entries per `###` heading
 *          },
 *          sections: [                                     // markdown, for newer hoist-react
 *              {title: 'New Features', items: ['Added `Foo` ...']}
 *          ]
 *      }]
 *  }
 *
 * Each item holds a whole bullet, wrapped lines and sub-bullets included:
 *  - In `sections`, an item is the bullet's markdown without its leading `* ` marker, with its
 *    other lines dedented to match. Sub-bullets stay a nested markdown list.
 *  - In `parsed`, an item is one line of plain text. Wrapped lines join with a space, and each
 *    sub-bullet follows as ` • ` plus its text. A bullet's first line strips to the same text that
 *    `changelog-parser` produced, so old items are a prefix of new ones.
 *
 * `sections` lists only `###` sections with at least one entry, in source order. Entries above any
 * `###` heading go in a section with a null title. `parsed` keeps a key for every `###` heading,
 * empty or not, as `changelog-parser` did.
 */

const removeMarkdown = require('remove-markdown'),
    {parseChangelog} = require('./parse');

const TITLE = /^# ?([^#].*)$/m,
    LINK_DEFINITION = /^\[([^[\]]*)\] *?:/,
    STANDALONE_BRACKET = /\[([^\][]*)\](?![([])/g,
    LIST_MARKER = /^\s*(?:[*+-]|\d+[.)])\s+/,
    SUB_BULLET = /^\s+(?:[*+-]|\d+[.)])\s+/;

/**
 * Build the app changelog JSON from the text of a CHANGELOG.md.
 *
 * @param {string} changelogText
 * @returns {{title: ?string, versions: Object[]}}
 */
function buildAppChangelogJson(changelogText) {
    const {preamble, releases} = parseChangelog(changelogText),
        lines = stripComments(changelogText.replace(/\r\n?/g, '\n')).split('\n'),
        linkLabels = new Set();

    lines.forEach(line => {
        const def = LINK_DEFINITION.exec(line);
        if (def?.[1]) linkLabels.add(normalizeLabel(def[1]));
    });

    return {
        title: TITLE.exec(preamble)?.[1].trim() ?? null,
        versions: releases.map(release => {
            const bodyLines = lines
                .slice(release.startLine + 1, release.endLine)
                .filter(l => !LINK_DEFINITION.test(l));
            return toVersionJson(release, {body: bodyLines.join('\n'), linkLabels});
        })
    };
}

/**
 * Build the JSON for one release, as returned by `parseChangelog()`.
 *
 * @param {Object} release - a release from `parseChangelog()`, or any object with its `title`,
 *      `version`, `date` and `sections`.
 * @param {Object} [opts]
 * @param {string} [opts.body] - source markdown of the release, without its heading.
 * @param {Set<string>} [opts.linkLabels] - normalized labels of the changelog's link reference
 *      definitions, so `[label]` strips to its text. Other `[text]` stays as written.
 */
function toVersionJson(release, {body = '', linkLabels = new Set()} = {}) {
    const parsed = {_: []},
        sections = [];

    release.sections.forEach(section => {
        const key = section.heading,
            entries = section.blocks.filter(b => b.type === 'entry');
        if (key != null) parsed[key] ??= [];

        const items = entries.map(entry => {
            const text = toPlainText(entry.text, linkLabels);
            parsed._.push(text);
            if (key != null) parsed[key].push(text);
            return toMarkdownItem(entry.text);
        });

        if (!items.length) return;
        const existing = sections.find(s => s.title === key);
        if (existing) {
            existing.items.push(...items);
        } else {
            sections.push({title: key, items});
        }
    });

    return {
        version: release.version,
        title: release.title,
        date: release.date,
        body: body.trim(),
        parsed,
        sections
    };
}

//------------------------
// Implementation
//------------------------
// Drop the leading marker and dedent the following lines by the marker's width.
function toMarkdownItem(entryText) {
    const [first, ...rest] = entryText.split('\n'),
        width = LIST_MARKER.exec(first)[0].length,
        dedent = new RegExp(`^ {0,${width}}`);
    return [first.slice(width), ...rest.map(l => l.replace(dedent, ''))].join('\n');
}

// One line of plain text: the bullet's own text, then ` • ` and the text of each sub-bullet.
function toPlainText(entryText, linkLabels) {
    const runs = [];
    entryText.split('\n').forEach((line, idx) => {
        if (line.trim() === '') return;
        if (idx === 0 || SUB_BULLET.test(line)) {
            runs.push([line]);
        } else {
            runs[runs.length - 1].push(line.trim());
        }
    });
    return runs
        .map((run, idx) => {
            const text = stripMarkdown(run.join(' ').trim(), linkLabels);
            return idx === 0 ? text : `• ${text}`;
        })
        .join(' ');
}

// Strip markdown as `changelog-parser` did: a standalone `[token]` stays literal unless it names a
// link reference definition, which strips to its text.
function stripMarkdown(text, linkLabels) {
    if (!text.includes('[')) return removeMarkdown(text);
    const open = '\u0000',
        close = '\u0001',
        safe = text.replace(STANDALONE_BRACKET, (match, inner) =>
            linkLabels.has(normalizeLabel(inner)) ? inner : `${open}${inner}${close}`
        );
    return removeMarkdown(safe).replaceAll(open, '[').replaceAll(close, ']');
}

function normalizeLabel(label) {
    return label.trim().replace(/\s+/g, ' ').toLowerCase();
}

// Blank out HTML comments but keep their newlines, so line numbers match `parseChangelog()`.
function stripComments(text) {
    return text.replace(/<!--[\s\S]*?-->/g, c => c.replace(/[^\n]/g, ''));
}

module.exports = {buildAppChangelogJson, toVersionJson};
