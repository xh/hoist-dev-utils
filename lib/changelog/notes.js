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
 * lead nowhere from the release page.
 */

const {parseChangelog, splitLines} = require('./parse'),
    {findRelease} = require('./assemble');

const FENCE = /^\s*(```|~~~)/,
    // A heading, blockquote or table row starts a line of its own, never a continuation.
    BLOCK_START = /^\s{0,3}(#{1,6}\s|>|\|)/,
    LIST_ITEM = /^\s*(?:[*+-]|\d+[.)])\s+/,
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

    const body = splitLines(changelogText).slice(release.startLine + 1, release.endLine);
    return formatLines(body, linkBase?.replace(/\/+$/, '')).join('\n').trim();
}

//------------------------
// Implementation
//------------------------
/** Join each wrapped paragraph or list item into one line, and point relative links at `base`. */
function formatLines(lines, base) {
    const ret = [];
    let inFence = false,
        open = false;

    lines.forEach(line => {
        const isFence = FENCE.test(line);
        if (isFence) inFence = !inFence;
        const isCode = isFence || inFence,
            text = isCode || !base ? line : resolveLinks(line, base);

        if (isCode || !text.trim() || BLOCK_START.test(text)) {
            open = false;
            ret.push(text);
        } else if (open && !LIST_ITEM.test(text)) {
            ret[ret.length - 1] += ` ${text.trim()}`;
        } else {
            open = true;
            ret.push(text);
        }
    });
    return ret;
}

function resolveLinks(line, base) {
    return line.replace(LINK_TARGET, (match, target) =>
        ABSOLUTE.test(target)
            ? match
            : match.replace(target, `${base}/${target.replace(/^\.\//, '')}`)
    );
}

module.exports = {releaseNotes};
