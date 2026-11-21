/*
 * This file belongs to Hoist, an application development toolkit
 * developed by Extremely Heavy Industries (www.xh.io | info@xh.io)
 *
 * Copyright © 2026 Extremely Heavy Industries Inc.
 */
'use strict';

const assert = require('node:assert/strict'),
    fs = require('node:fs'),
    path = require('node:path'),
    {describe, it} = require('node:test');

const {buildAppChangelogJson} = require('../lib/changelog/appJson');

const FIXTURES = path.join(__dirname, 'fixtures', 'changelogs');

// `toolbox.md` is an excerpt of Toolbox's CHANGELOG.md. `app-patterns.md` reproduces, with
// neutral text, the layouts found in other app changelogs: sub-bullets, lazy and indented wrapped
// lines, `-` markers, bullets with no `###` section, a `##` used as a section, and a footer.
describe('buildAppChangelogJson matches changelog-parser output', () => {
    const fixtures = fs.readdirSync(FIXTURES).filter(f => f.endsWith('.md'));

    fixtures.forEach(file => {
        it(`keeps every field and item that changelog-parser emitted for ${file}`, async () => {
            const {parseChangelog} = await import('changelog-parser'),
                text = fs.readFileSync(path.join(FIXTURES, file), 'utf8'),
                legacy = await parseChangelog({text}),
                json = buildAppChangelogJson(text);

            assert.equal(json.title, legacy.title);
            assert.equal(json.versions.length, legacy.versions.length);

            legacy.versions.forEach((old, idx) => {
                const v = json.versions[idx];
                // changelog-parser could not read a two-part version such as `v5.0`.
                if (old.version != null) assert.equal(v.version, old.version);
                assert.equal(v.title, old.title);
                assert.equal(v.date, old.date);
                assert.equal(collapseBlankLines(v.body), collapseBlankLines(old.body));
                assert.deepEqual(Object.keys(v.parsed), Object.keys(old.parsed));

                Object.entries(old.parsed).forEach(([key, oldItems]) => {
                    // changelog-parser read a `---` rule as an empty item.
                    const kept = oldItems.map(it => it.trim()).filter(it => it !== '');
                    assert.equal(v.parsed[key].length, kept.length, `${old.title} / ${key}`);
                    kept.forEach((it, i) =>
                        assert.ok(
                            v.parsed[key][i].startsWith(it),
                            `${old.title} / ${key}: "${v.parsed[key][i]}" should start "${it}"`
                        )
                    );
                });
            });
        });
    });
});

describe('buildAppChangelogJson', () => {
    const json = buildAppChangelogJson(
            fs.readFileSync(path.join(FIXTURES, 'app-patterns.md'), 'utf8')
        ),
        byVersion = v => json.versions.find(it => it.version === v);

    it('reads a two-part unreleased version as a snapshot, so it cannot be marked read', () => {
        assert.equal(json.versions[0].version, '5.0-SNAPSHOT');
    });

    it('lists sections with entries, as markdown without the leading marker', () => {
        const {sections} = byVersion('4.1.0');
        assert.deepEqual(
            sections.map(s => s.title),
            ['New Features', 'Technical', 'Libraries']
        );
        assert.equal(
            sections[0].items[1],
            'Added **contact** fields to the company editor, as described in ' +
                '[the guide](https://xh.io/guide).'
        );
    });

    it('keeps sub-bullets as a nested markdown list', () => {
        assert.equal(
            byVersion('4.1.0').sections[1].items[2],
            [
                'Config changes:',
                '* Update `targetUpgradeVersion: 28`',
                '  * Adds the contact fields to the data dictionary.',
                '  * Migrates an enabled `checklistSpec` config to a `CHECKLIST` blob.'
            ].join('\n')
        );
    });

    it('flattens sub-bullets into the plain-text item with a bullet character', () => {
        assert.equal(
            byVersion('4.1.0').parsed.Technical[2],
            'Config changes: • Update targetUpgradeVersion: 28 • Adds the contact fields to the ' +
                'data dictionary. • Migrates an enabled checklistSpec config to a CHECKLIST blob.'
        );
    });

    it('joins wrapped lines into one plain-text item', () => {
        const items = byVersion('1.49.0').parsed['New Features'];
        assert.equal(
            items[1],
            'Improved the transaction selector to sort top-level transactions ' +
                'reverse-chronologically, displaying respective children below each top-level item.'
        );
        assert.equal(
            items[2],
            'Fixed a wrapped bullet whose second line is indented, as a library changelog writes ' +
                'it, and whose third line is too.'
        );
    });

    it('strips markdown from plain-text items but keeps a literal [token]', () => {
        const {parsed} = byVersion('4.1.0');
        assert.equal(
            parsed['New Features'][1],
            'Added contact fields to the company editor, as described in the guide.'
        );
        assert.equal(parsed.Technical[3], 'Kept a literal [beta] tag in this entry.');
    });

    it('puts entries above any ### heading in the catch-all and a null-titled section', () => {
        const v = byVersion('1.48.0');
        assert.deepEqual(v.parsed, {
            _: ['Hoist Core v33.2 -> v36.1', 'Hoist React v78.1.4 -> v80.0.1']
        });
        assert.deepEqual(v.sections, [
            {title: null, items: ['Hoist Core v33.2 -> v36.1', 'Hoist React v78.1.4 -> v80.0.1']}
        ]);
    });

    it('returns no versions for an empty changelog', () => {
        assert.deepEqual(buildAppChangelogJson('# Changelog\n'), {
            title: 'Changelog',
            versions: []
        });
    });
});

function collapseBlankLines(text) {
    return text.replace(/\n{3,}/g, '\n\n');
}
