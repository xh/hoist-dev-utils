/*
 * This file belongs to Hoist, an application development toolkit
 * developed by Extremely Heavy Industries (www.xh.io | info@xh.io)
 *
 * Copyright © 2026 Extremely Heavy Industries Inc.
 */
'use strict';

/**
 * Structural parser for Hoist-style changelog markdown: a whole CHANGELOG.md, or one fragment
 * from `changelog.d/`. It reads only the outline the changelog conventions use - `##` release
 * headings, `###` sections, `####` groups, top-level `*` / `-` bullets and prose paragraphs - and
 * keeps the source text of every bullet exactly as written. Wrapped lines, sub-bullets, code spans
 * and fenced code stay part of the bullet they belong to.
 *
 * Bullet rules, a subset of CommonMark list items:
 *  - A bullet starts with `*`, `-` or `+` and a space, indented at most one space.
 *  - Following lines belong to the bullet while they are indented, or until a blank line.
 *  - An unindented line right after a bullet line is a lazy continuation of that bullet.
 *  - After a blank line, an indented line continues the bullet. Anything else ends it.
 *  - HTML comments are ignored. Lines inside a fenced code block never start a heading or bullet.
 */

const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/,
    BULLET = /^ ?[*+-]\s+/,
    FENCE = /^\s*(```|~~~)/,
    VERSION = /\bv?(\d+(?:\.\d+)+(?:-[0-9A-Za-z][0-9A-Za-z.-]*)?)/,
    DATE = /\b(\d{4}-\d{2}-\d{2})\b/,
    SUFFIX = /^(.*?)\s*(\([^()]*(?:\([^()]*\)[^()]*)*\))\s*$/;

/**
 * Parse a full CHANGELOG.md.
 *
 * @param {string} text
 * @returns {{preamble: string, releases: Release[], problems: Problem[]}}
 *      `preamble` is the source before the first `##` heading. Each release has its heading
 *      `title` (text after `## `), parsed `version` and `date` (or null), an `unreleased` flag,
 *      its `sections`, and the 0-based `startLine` / `endLine` (exclusive) of its source.
 */
function parseChangelog(text) {
    const lines = splitLines(text),
        doc = parseLines(lines, {allowReleases: true});
    return {
        preamble: lines.slice(0, doc.releases[0]?.startLine ?? lines.length).join('\n'),
        releases: doc.releases,
        problems: doc.problems
    };
}

/**
 * Parse one changelog fragment - the body of a release without its `##` heading.
 *
 * @param {string} text
 * @returns {{sections: Section[], problems: Problem[]}}
 */
function parseFragment(text) {
    const doc = parseLines(splitLines(text), {allowReleases: false});
    return {sections: doc.sections, problems: doc.problems};
}

/**
 * Split a `### ` heading's text into its section title and an optional trailing parenthetical,
 * such as `(upgrade difficulty: 🟢 LOW)`.
 */
function splitSectionHeading(heading) {
    const match = SUFFIX.exec(heading);
    return match && match[1] ? {title: match[1], suffix: match[2]} : {title: heading, suffix: ''};
}

/** Parse the version and date out of a `##` heading. */
function parseReleaseHeading(title) {
    const version = VERSION.exec(title)?.[1] ?? null,
        date = DATE.exec(title)?.[1] ?? null,
        unreleased = /snapshot|unreleased/i.test(title);
    return {version, date, unreleased};
}

//------------------------
// Implementation
//------------------------
/**
 * Split changelog text into lines for parsing: line endings normalized, a byte order mark dropped,
 * and HTML comments blanked out. A comment counts only where it starts a line, as an HTML block
 * does in CommonMark, so `<!--` inside a code span is left alone. Line numbers match the source.
 */
function splitLines(text) {
    return text
        .replace(/^\uFEFF/, '')
        .replace(/\r\n?/g, '\n')
        .replace(/^ {0,3}<!--[\s\S]*?-->/gm, c => c.replace(/[^\n]/g, ''))
        .split('\n');
}

function parseLines(lines, {allowReleases}) {
    const releases = [],
        rootSections = [],
        problems = [];
    let release = null,
        section = null,
        group = null,
        block = null, // the entry or prose block being read, or null
        sawBlank = false,
        inFence = false;

    const problem = (lineIdx, level, message) => problems.push({line: lineIdx + 1, level, message});

    const endBlock = () => {
        if (block) {
            block.text = trimBlankLines(block.lines).join('\n');
            delete block.lines;
            block = null;
        }
    };

    const sectionsTarget = () => (release ? release.sections : rootSections);

    // Content before any `###` heading goes into a section with a null title. Changelogs that
    // use no sections at all (bullets directly under each release) are made only of these.
    const openBareSection = idx => {
        section = {heading: null, title: null, suffix: '', line: idx + 1, blocks: []};
        sectionsTarget().push(section);
        return section;
    };

    lines.forEach((line, idx) => {
        const isBlank = line.trim() === '';

        // Fenced code - lines inside belong to the current block, whatever they look like.
        if (FENCE.test(line)) inFence = !inFence;
        else if (inFence) {
            if (block) block.lines.push(line);
            return;
        }

        if (isBlank) {
            if (block) block.lines.push(line);
            sawBlank = true;
            return;
        }

        const heading = !line.startsWith(' ') && HEADING.exec(line);
        if (heading) {
            endBlock();
            const depth = heading[1].length,
                headingText = heading[2];
            if (depth <= 2) {
                if (depth === 2 && allowReleases) {
                    if (release) release.endLine = idx;
                    release = {
                        title: headingText,
                        ...parseReleaseHeading(headingText),
                        sections: [],
                        startLine: idx,
                        endLine: lines.length
                    };
                    releases.push(release);
                } else if (!allowReleases) {
                    problem(
                        idx,
                        'error',
                        `Fragments have no version headings - remove "${line.trim()}". ` +
                            'The version is set when the release is assembled.'
                    );
                }
                section = null;
                group = null;
            } else if (depth === 3) {
                section = {
                    heading: headingText,
                    ...splitSectionHeading(headingText),
                    line: idx + 1,
                    blocks: []
                };
                sectionsTarget().push(section);
                group = null;
            } else {
                if (!section) openBareSection(idx);
                group = headingText;
            }
            sawBlank = false;
            return;
        }

        const indented = /^\s/.test(line);
        if (BULLET.test(line)) {
            endBlock();
            block = startBlock('entry', section ?? openBareSection(idx), group, idx);
        } else if (block?.type === 'entry' && (indented || !sawBlank)) {
            // Continuation: indented, or a lazy (unindented) line right after a bullet line.
            block.lines.push(line);
            sawBlank = false;
            return;
        } else if (block?.type === 'prose' && !sawBlank) {
            block.lines.push(line);
            return;
        } else {
            endBlock();
            // Text above the first release heading is the changelog's preamble, not content.
            const target = section ?? (release || !allowReleases ? openBareSection(idx) : null);
            block = startBlock('prose', target, group, idx);
        }
        block.lines.push(line);
        sawBlank = false;
    });

    endBlock();
    if (inFence) problem(lines.length - 1, 'error', 'A fenced code block is never closed.');
    return {releases, sections: rootSections, problems};
}

function startBlock(type, section, group, idx) {
    const block = {type, group, line: idx + 1, lines: []};
    section?.blocks.push(block);
    return block;
}

function trimBlankLines(lines) {
    let start = 0,
        end = lines.length;
    while (start < end && lines[start].trim() === '') start++;
    while (end > start && lines[end - 1].trim() === '') end--;
    return lines.slice(start, end).map(l => l.replace(/\s+$/, ''));
}

/**
 * @typedef {Object} Section
 * @property {?string} heading - full `###` heading text, or null for content above any heading.
 * @property {?string} title - heading text without any trailing parenthetical, or null.
 * @property {string} suffix - trailing parenthetical, or ''.
 * @property {number} line - 1-based source line of the heading.
 * @property {Block[]} blocks - entries and prose paragraphs, in source order.
 *
 * @typedef {Object} Block
 * @property {('entry'|'prose')} type
 * @property {string} text - exact source text, trailing blank lines trimmed.
 * @property {?string} group - the `####` group this block sits under, or null.
 * @property {number} line - 1-based source line where the block starts.
 *
 * @typedef {Object} Release
 * @property {string} title
 * @property {?string} version
 * @property {?string} date
 * @property {boolean} unreleased
 * @property {Section[]} sections
 * @property {number} startLine
 * @property {number} endLine
 *
 * @typedef {Object} Problem
 * @property {number} line - 1-based.
 * @property {('error'|'warning')} level
 * @property {string} message
 */

module.exports = {
    parseChangelog,
    parseFragment,
    parseReleaseHeading,
    splitSectionHeading,
    splitLines
};
