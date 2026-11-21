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

const semver = require('semver'),
    {parseFragment, parseChangelog} = require('./parse'),
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
            if (known.length && !known.some(k => sameSection(k, section.title))) {
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
 * heading. Sections follow the configured order. Within a section, prose comes first, then
 * bullets, each in fragment order. Exact duplicates are dropped.
 *
 * @param {{name: string, sections: Object[]}[]} fragments - parsed, in the order to assemble.
 * @param {Object} config
 * @returns {{markdown: string, sectionTitles: string[]}}
 */
function assembleBody(fragments, config) {
    const merged = []; // [{title, prose: string[], entries: string[]}]

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
            if (!target) merged.push((target = {title, suffix: '', prose: [], entries: []}));
            target.suffix ||= section.suffix;
            section.blocks.forEach(block => {
                const list = block.type === 'prose' ? target.prose : target.entries;
                if (!list.includes(block.text)) list.push(block.text);
            });
        });
    });

    const order = title => {
        if (title == null) return -1;
        const idx = (config.sections ?? []).findIndex(k => sameSection(k, title));
        return idx < 0 ? Number.MAX_SAFE_INTEGER : idx;
    };
    merged.sort((a, b) => order(a.title) - order(b.title));

    const parts = merged.map(({title, suffix, prose, entries}) => {
        const body = [...prose, mergeLibraryBumps(entries).join('\n')].filter(Boolean),
            heading = `### ${title}${suffix ? ' ' + suffix : ''}`;
        return (title == null ? body : [heading, ...body]).join('\n\n');
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

// The lower of two version strings, by semver where both coerce, else the first.
function lowerVersion(a, b) {
    const ca = coerce(a),
        cb = coerce(b);
    return ca && cb && semver.lt(cb, ca) ? b : a;
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
    const lines = changelogText.replace(/\r\n?/g, '\n').split('\n'),
        {releases} = parseChangelog(changelogText),
        notes = [];

    if (releases.some(r => !r.unreleased && r.version === version)) {
        throw new Error(`CHANGELOG.md already has a release ${version}.`);
    }

    const newVer = coerce(version),
        next = releases.find(
            r => !r.unreleased && r.version && semver.lt(coerce(r.version), newVer)
        ),
        insertAt = next ? next.startLine : trimTrailingBlank(lines),
        block = [heading, '', ...(body ? [body, ''] : [])];

    lines.splice(insertAt, 0, ...block);
    if (!next && lines[insertAt - 1]?.trim() !== '') lines.splice(insertAt, 0, '');

    // Roll the unreleased heading forward when this release ships its major.
    const top = releases[0];
    if (top?.unreleased && top.version) {
        const topVer = coerce(top.version);
        if (topVer && semver.major(topVer) === semver.major(newVer) && /\.0(\.0)?$/.test(version)) {
            const nextMajor = bumpMajor(top.version);
            lines[top.startLine] = lines[top.startLine].replace(top.version, nextMajor);
            notes.push(
                `Rolled the unreleased heading forward to ${nextMajor}. Bump the project ` +
                    `version to match.`
            );
        }
    }

    return {text: lines.join('\n'), notes};
}

/**
 * Write an assembled body under the unreleased heading, for a snapshot build. Creates the
 * heading if the changelog has none.
 */
function insertUnreleased(changelogText, {body, heading}) {
    const lines = changelogText.replace(/\r\n?/g, '\n').split('\n'),
        {releases} = parseChangelog(changelogText),
        top = releases[0];

    if (top?.unreleased) {
        lines.splice(top.startLine + 1, 0, '', body);
    } else {
        const at = top ? top.startLine : trimTrailingBlank(lines);
        lines.splice(at, 0, heading, '', body, '');
    }
    return lines.join('\n');
}

/**
 * Turn the content under a legacy unreleased heading into a fragment, and empty the heading.
 * Used to migrate a repo, or a branch that still wrote entries into CHANGELOG.md.
 *
 * @returns {?{fragment: string, text: string}} - null if there is nothing to move.
 */
function extractUnreleased(changelogText) {
    const lines = changelogText.replace(/\r\n?/g, '\n').split('\n'),
        {releases} = parseChangelog(changelogText),
        top = releases[0];
    if (!top?.unreleased || !top.sections.some(s => s.blocks.length)) return null;

    const content = lines
        .slice(top.startLine + 1, top.endLine)
        .join('\n')
        .trim();
    lines.splice(top.startLine + 1, top.endLine - top.startLine - 1, '');
    return {fragment: content + '\n', text: lines.join('\n')};
}

/** True if a version is a major release (`N.0.0` or `N.0`). */
function isMajor(version) {
    return /^v?\d+\.0(\.0)?$/.test(version);
}

//------------------------
// Implementation
//------------------------
function coerce(version) {
    return semver.coerce(version)?.version ?? null;
}

function bumpMajor(version) {
    return version.replace(/^(v?)(\d+)/, (_, v, major) => `${v}${Number(major) + 1}`);
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
    isMajor
};
