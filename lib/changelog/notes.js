/*
 * This file belongs to Hoist, an application development toolkit
 * developed by Extremely Heavy Industries (www.xh.io | info@xh.io)
 *
 * Copyright © 2026 Extremely Heavy Industries Inc.
 */
'use strict';

/**
 * The notes of one release, taken from CHANGELOG.md and made ready for a GitHub release.
 *
 * A GitHub release shows a line break for every newline in its body, so a bullet that CHANGELOG.md
 * wraps at a fixed width would show as ragged lines. A link relative to CHANGELOG.md would also
 * lead nowhere from the release page. This module joins the wrapped lines and resolves the links.
 */

const {parseChangelog, splitLines} = require('./parse'),
    {findRelease} = require('./assemble');

const FENCE = /^\s*(```|~~~)/,
    HEADING = /^\s{0,3}#{1,6}\s/,
    LIST_ITEM = /^\s*(?:[*+-]|\d+[.)])\s+/,
    TABLE_ROW = /^\s*\|/,
    HARD_BREAK = /( {2,}|\\)$/,
    CODE_SPAN = /(`+[^`]*`+)/,
    LINK_TARGET = /\]\(\s*<?([^)\s>]+)/g,
    // A target that already says where it is: a URL scheme, `//host`, a root path or an anchor.
    ABSOLUTE = /^([a-z][a-z0-9+.-]*:|\/|#)/i;

/**
 * @param {string} changelogText - source of CHANGELOG.md.
 * @param {string} version - a released version, with or without a `v`.
 * @param {Object} [opts]
 * @param {string} [opts.linkBase] - URL of the folder that holds CHANGELOG.md, to resolve its
 *      relative links against. Without it, links stay as written.
 * @returns {?string} the release's markdown without its `##` heading, or null if CHANGELOG.md has
 *      no such release.
 */
function releaseNotes(changelogText, version, {linkBase} = {}) {
    const release = findRelease(parseChangelog(changelogText), version);
    if (!release) return null;

    const body = splitLines(changelogText).slice(release.startLine + 1, release.endLine),
        lines = joinWrappedLines(body);
    return (linkBase ? resolveLinks(lines, linkBase) : lines).join('\n').trim();
}

//------------------------
// Implementation
//------------------------
/**
 * Join each wrapped paragraph or list item into one line. A heading, a table row, a new list item
 * and a line after a hard break each start a line of their own. Fenced code is left as it is.
 */
function joinWrappedLines(lines) {
    const ret = [];
    let inFence = false,
        open = false;

    lines.forEach(line => {
        if (FENCE.test(line)) {
            inFence = !inFence;
            open = false;
            ret.push(line);
        } else if (inFence || line.trim() === '' || HEADING.test(line) || TABLE_ROW.test(line)) {
            open = false;
            ret.push(line);
        } else if (open && !LIST_ITEM.test(line) && !HARD_BREAK.test(ret.at(-1))) {
            ret[ret.length - 1] += ` ${line.trim()}`;
        } else {
            open = true;
            ret.push(line);
        }
    });
    return ret;
}

// Point each relative link at `linkBase`. Code, fenced or in a span, is left as it is.
function resolveLinks(lines, linkBase) {
    const base = linkBase.replace(/\/+$/, '');
    let inFence = false;

    return lines.map(line => {
        if (FENCE.test(line)) inFence = !inFence;
        if (inFence || FENCE.test(line)) return line;
        return line
            .split(CODE_SPAN)
            .map((part, idx) =>
                idx % 2
                    ? part
                    : part.replace(LINK_TARGET, (match, target) =>
                          ABSOLUTE.test(target)
                              ? match
                              : match.replace(target, `${base}/${target.replace(/^\.\//, '')}`)
                      )
            )
            .join('');
    });
}

module.exports = {releaseNotes};
