/*
 * This file belongs to Hoist, an application development toolkit
 * developed by Extremely Heavy Industries (www.xh.io | info@xh.io)
 *
 * Copyright © 2026 Extremely Heavy Industries Inc.
 */
'use strict';

/**
 * Validates changelog fragments and assembles them into a release block for CHANGELOG.md.
 * Pure functions over text and parsed structures - no file or git access.
 */

const {parseFragment, parseChangelog} = require('./parse'),
    {sameSection} = require('./config');

/**
 * Check one fragment against the repo's conventions.
 *
 * @param {string} text - fragment source.
 * @param {Object} config - resolved config from `loadChangelogContext()`.
 * @returns {{sections: Object[], problems: Problem[]}}
 */
function validateFragment(text, config) {
    const {sections, problems} = parseFragment(text),
        error = (line, message) => problems.push({line, level: 'error', message}),
        known = config.sections ?? [];

    const hasContent = sections.some(s => s.blocks.length);
    if (!hasContent) error(1, 'The fragment has no entries.');

    sections.forEach(section => {
        if (section.title == null) {
            if (known.length && section.blocks.length) {
                error(section.line, `Put this under one of the sections: ${known.join(', ')}.`);
            }
        } else {
            if (
                known.length &&
                !config.allowOtherSections &&
                !known.some(k => sameSection(k, section.title))
            ) {
                error(
                    section.line,
                    `Unknown section "${section.title}". Use one of: ${known.join(', ')}. ` +
                        `To add a section, list it in changelog.d/config.json.`
                );
            }
            if (section.suffix) {
                error(
                    section.line,
                    `Remove "${section.suffix}" from the heading. Release-level notes such as an ` +
                        `upgrade difficulty are added when the release is assembled.`
                );
            }
        }
        section.blocks.forEach(block => {
            if (block.group != null) {
                error(
                    block.line,
                    `Topic groups ("#### ${block.group}") are added when a release is curated, ` +
                        `not in fragments. Remove the heading.`
                );
            }
            if (block.type === 'entry' && block.text.replace(/^\s*[*+-]\s*/, '').trim() === '') {
                error(block.line, 'This bullet is empty.');
            }
        });
    });

    if (config.maxLineLength) {
        text.split(/\r?\n/).forEach((line, idx) => {
            if (line.length > config.maxLineLength && !/^\s*\[.*\]:\s*\S+$/.test(line)) {
                problems.push({
                    line: idx + 1,
                    level: 'warning',
                    message: `Line is ${line.length} characters - wrap at ${config.maxLineLength}.`
                });
            }
        });
    }

    return {sections, problems};
}

/**
 * Merge fragments into the markdown body of one release - its sections, without the `##`
 * heading. Sections follow the configured order. Within a section, prose that opens a fragment's
 * section comes first, then bullets in fragment order. Prose that follows a bullet, such as a code
 * block, stays attached to that bullet. Exact duplicates are dropped. Entries under a `####` group
 * (only legacy entries carry one) follow the ungrouped entries, under their group heading.
 *
 * @param {{name: string, sections: Object[]}[]} fragments - parsed, in the order to assemble.
 * @param {Object} config
 * @returns {{markdown: string, sectionTitles: string[]}}
 */
function assembleBody(fragments, config) {
    const merged = []; // [{title, suffix, intro: string[], entries: {group, text}[]}]

    fragments.forEach(fragment => {
        fragment.sections.forEach(section => {
            if (!section.blocks.length) return;
            const title =
                section.title == null
                    ? null
                    : ((config.sections ?? []).find(k => sameSection(k, section.title)) ??
                      section.title);
            let target = merged.find(m =>
                title == null ? m.title == null : m.title != null && sameSection(m.title, title)
            );
            if (!target) merged.push((target = {title, suffix: '', intro: [], entries: []}));
            target.suffix ||= section.suffix;

            let last = null; // the entry that prose following it belongs to
            section.blocks.forEach(block => {
                if (block.type === 'entry') {
                    last = {group: block.group, text: block.text};
                    if (!target.entries.some(e => e.text === last.text)) target.entries.push(last);
                } else if (last && last.group === block.group) {
                    last.text += '\n\n' + block.text;
                } else if (!target.intro.includes(block.text)) {
                    target.intro.push(block.text);
                }
            });
        });
    });

    const order = title => {
        if (title == null) return -1;
        const idx = (config.sections ?? []).findIndex(k => sameSection(k, title));
        return idx < 0 ? Number.MAX_SAFE_INTEGER : idx;
    };
    merged.sort((a, b) => order(a.title) - order(b.title));

    const parts = merged.map(({title, suffix, intro, entries}) => {
        const isLibraries = /librar/i.test(title ?? ''),
            groups = [...new Set(entries.map(e => e.group))].sort((a, b) =>
                a == null ? -1 : b == null ? 1 : 0
            ),
            lists = groups.map(group => {
                let texts = entries.filter(e => e.group === group).map(e => e.text);
                if (isLibraries) texts = mergeLibraryBumps(texts);
                const list = texts.join('\n');
                return group == null ? list : `#### ${group}\n\n${list}`;
            }),
            heading = `### ${title}${suffix ? ' ' + suffix : ''}`,
            body = [...intro, ...lists].filter(Boolean);
        if (title == null) return body.join('\n\n');
        return heading + (config.compactHeadings ? '\n' : '\n\n') + body.join('\n\n');
    });

    return {markdown: parts.join('\n\n'), sectionTitles: merged.map(m => m.title)};
}

/**
 * Collapse repeated single-line library bumps, such as `* react `19.1 → 19.2`` from one PR and
 * `* react `19.2 → 19.3`` from another, into one bullet spanning both.
 */
function mergeLibraryBumps(entries) {
    const BUMP = /^([*+-]) (\S+) `([^`]+) → ([^`]+)`$/,
        out = [];
    entries.forEach(entry => {
        const m = BUMP.exec(entry);
        const prevIdx = m ? out.findIndex(e => BUMP.exec(e)?.[2] === m[2]) : -1;
        if (prevIdx < 0) return out.push(entry);
        const prev = BUMP.exec(out[prevIdx]),
            from = lowerVersion(prev[3], m[3]),
            to = lowerVersion(prev[4], m[4]) === prev[4] ? m[4] : prev[4];
        out[prevIdx] = `${prev[1]} ${prev[2]} \`${from} → ${to}\``;
    });
    return out;
}

// The lower of two version strings where both parse, else the first.
function lowerVersion(a, b) {
    const ca = coerce(a),
        cb = coerce(b);
    return ca && cb && compareVersions(cb, ca) < 0 ? b : a;
}

/** Format a release heading from the configured template. */
function formatHeading(config, version, date) {
    return (config.headingFormat ?? '## {version} - {date}')
        .replace('{version}', version)
        .replace('{date}', date);
}

/**
 * Insert a release into CHANGELOG.md text.
 *
 * The block goes above the newest release with a lower version, so a hotfix to an older line
 * lands in version order. A bare unreleased heading at the top stays in place. Releasing the
 * version that heading names rolls it forward to the next major.
 *
 * @returns {{text: string, notes: string[]}}
 */
function insertRelease(changelogText, {heading, body, version}) {
    const {lines, eol} = toLines(changelogText),
        {releases} = parseChangelog(changelogText),
        newVer = coerce(version),
        notes = [];

    const released = releases.filter(r => !r.unreleased && coerce(r.version));
    if (released.some(r => compareVersions(coerce(r.version), newVer) === 0)) {
        throw new Error(`CHANGELOG.md already has a release ${version}.`);
    }

    const next = released.find(r => compareVersions(coerce(r.version), newVer) < 0),
        insertAt = next ? next.startLine : trimTrailingBlank(lines),
        block = [heading, '', ...(body ? [body, ''] : [])];

    lines.splice(insertAt, 0, ...block);
    if (!next && lines[insertAt - 1]?.trim() !== '') lines.splice(insertAt, 0, '');

    // Roll the unreleased heading forward when this release ships its major.
    const top = releases[0];
    if (top?.unreleased && top.version) {
        const topVer = coerce(top.version);
        if (topVer && topVer[0] === newVer[0] && isMajor(version)) {
            const nextMajor = bumpMajor(top.version);
            lines[top.startLine] = lines[top.startLine].replace(top.version, nextMajor);
            notes.push(
                `Rolled the unreleased heading forward to ${nextMajor}. Bump the project ` +
                    `version to match.`
            );
        }
    }

    return {text: fromLines(lines, eol), notes};
}

/**
 * Write an assembled body under the unreleased heading, for a snapshot build. Creates the
 * heading if the changelog has none.
 */
function insertUnreleased(changelogText, {body, heading}) {
    const {lines, eol} = toLines(changelogText),
        {releases} = parseChangelog(changelogText),
        top = releases[0];

    if (top?.unreleased) {
        lines.splice(top.startLine + 1, 0, '', body);
    } else {
        const at = top ? top.startLine : trimTrailingBlank(lines);
        lines.splice(at, 0, heading, '', body, '');
    }
    return fromLines(lines, eol);
}

/**
 * Clear the content under a legacy unreleased heading, keeping the heading. Used to migrate a
 * repo, or to release entries a branch still wrote into CHANGELOG.md.
 *
 * @returns {?{fragment: ?string, text: string}} - null if there is nothing under the heading.
 *      `fragment` holds the moved content as a fragment, or is null if the content held only
 *      empty section headings.
 */
function extractUnreleased(changelogText) {
    const {lines, eol} = toLines(changelogText),
        {releases} = parseChangelog(changelogText),
        top = releases[0];
    if (!top?.unreleased || !top.sections.length) return null;

    const hasEntries = top.sections.some(s => s.blocks.length),
        content = lines
            .slice(top.startLine + 1, top.endLine)
            .join('\n')
            .trim();
    lines.splice(top.startLine + 1, top.endLine - top.startLine - 1, '');
    return {fragment: hasEntries ? content + '\n' : null, text: fromLines(lines, eol)};
}

/**
 * Find the released block for a version. `13.0` and `13.0.0` name the same release.
 *
 * @param {Object} changelog - result of `parseChangelog()`.
 * @returns {?Object} the release, or null.
 */
function findRelease(changelog, version) {
    const wanted = coerce(version);
    if (!wanted) return null;
    return (
        changelog.releases.find(
            r => !r.unreleased && coerce(r.version) && !compareVersions(coerce(r.version), wanted)
        ) ?? null
    );
}

/** True if a version is a major release (`N.0.0` or `N.0`). */
function isMajor(version) {
    return /^v?\d+\.0(\.0)?$/.test(version);
}

//------------------------
// Implementation
//------------------------
// Numeric parts of a version (`v14.0-SNAPSHOT` -> [14, 0, 0]), or null. Pre-release tags are
// ignored - only released versions are compared.
function coerce(version) {
    const m = /(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(version ?? '');
    return m ? [m[1], m[2], m[3]].map(n => Number(n ?? 0)) : null;
}

function compareVersions(a, b) {
    for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i];
    return 0;
}

function bumpMajor(version) {
    return version.replace(/^(v?)(\d+)/, (_, v, major) => `${v}${Number(major) + 1}`);
}

// Split text into lines, remembering its line ending so a rewrite keeps it.
function toLines(text) {
    return {
        eol: text.includes('\r\n') ? '\r\n' : '\n',
        lines: text.replace(/\r\n?/g, '\n').split('\n')
    };
}

function fromLines(lines, eol) {
    const text = lines.join('\n');
    return eol === '\n' ? text : text.replace(/\n/g, eol);
}

// Index after the last non-blank line, for appending at the end of the file.
function trimTrailingBlank(lines) {
    let end = lines.length;
    while (end > 0 && lines[end - 1].trim() === '') end--;
    return end;
}

module.exports = {
    validateFragment,
    assembleBody,
    formatHeading,
    insertRelease,
    insertUnreleased,
    extractUnreleased,
    findRelease,
    isMajor
};
