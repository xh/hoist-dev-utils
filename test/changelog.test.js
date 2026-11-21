/*
 * This file belongs to Hoist, an application development toolkit
 * developed by Extremely Heavy Industries (www.xh.io | info@xh.io)
 *
 * Copyright © 2026 Extremely Heavy Industries Inc.
 */
'use strict';

const assert = require('node:assert/strict'),
    fs = require('node:fs'),
    os = require('node:os'),
    path = require('node:path'),
    {afterEach, beforeEach, describe, it} = require('node:test');

const {parseChangelog, parseFragment} = require('../lib/changelog/parse'),
    {inferConfig} = require('../lib/changelog/config'),
    {
        validateFragment,
        assembleBody,
        insertRelease,
        extractUnreleased
    } = require('../lib/changelog/assemble'),
    {run} = require('../lib/changelog/cli');

const CHANGELOG = `# Changelog

<!-- Conventions: see docs. -->

## 2.0.0-SNAPSHOT - unreleased

## 1.1.0 - 2026-02-01

### 🎁 New Features

* Added a wrapped entry that runs
  onto a second line.
    * With a sub-bullet.

### ⚙️ Technical

* Tuned a thing.

## 1.0.0 - 2026-01-01

### 💥 Breaking Changes (upgrade difficulty: 🟢 LOW)

See the upgrade notes.

* Removed \`Foo\`.

### 🎁 New Features

* First feature.
`;

const CONFIG = {
    sections: ['💥 Breaking Changes', '🎁 New Features', '🐞 Bug Fixes', '⚙️ Technical'],
    headingFormat: '## {version} - {date}'
};

const fragment = text => ({name: 'f.md', sections: parseFragment(text).sections});

describe('parseChangelog', () => {
    const {releases, preamble} = parseChangelog(CHANGELOG);

    it('reads releases with version, date and unreleased flag', () => {
        assert.deepEqual(
            releases.map(r => [r.version, r.date, r.unreleased]),
            [
                ['2.0.0-SNAPSHOT', null, true],
                ['1.1.0', '2026-02-01', false],
                ['1.0.0', '2026-01-01', false]
            ]
        );
        assert.match(preamble, /^# Changelog/);
    });

    it('keeps wrapped lines and sub-bullets as part of their bullet', () => {
        const [features] = releases[1].sections;
        assert.equal(features.title, '🎁 New Features');
        assert.equal(
            features.blocks[0].text,
            '* Added a wrapped entry that runs\n  onto a second line.\n    * With a sub-bullet.'
        );
    });

    it('splits a heading suffix and keeps prose apart from bullets', () => {
        const [breaking] = releases[2].sections;
        assert.equal(breaking.title, '💥 Breaking Changes');
        assert.equal(breaking.suffix, '(upgrade difficulty: 🟢 LOW)');
        assert.deepEqual(
            breaking.blocks.map(b => b.type),
            ['prose', 'entry']
        );
    });

    it('treats an unindented line right after a bullet as a lazy continuation', () => {
        const {sections} = parseFragment('### Bug Fixes\n\n* One line\nand its tail.\n* Two.\n');
        assert.deepEqual(
            sections[0].blocks.map(b => b.text),
            ['* One line\nand its tail.', '* Two.']
        );
    });

    it('keeps an indented paragraph after a blank line in the bullet, and ends it otherwise', () => {
        const {sections} = parseFragment(
            '### Technical\n\n* One.\n\n  More about one.\n\nA closing note.\n'
        );
        assert.deepEqual(
            sections[0].blocks.map(b => [b.type, b.text]),
            [
                ['entry', '* One.\n\n  More about one.'],
                ['prose', 'A closing note.']
            ]
        );
    });

    it('ignores headings and bullets inside fenced code and HTML comments', () => {
        const {sections} = parseFragment(
            '<!--\n### Not a section\n-->\n### Technical\n\n* Example:\n  ```\n  ## not a heading\n  * not a bullet\n  ```\n'
        );
        assert.equal(sections.length, 1);
        assert.equal(sections[0].blocks.length, 1);
    });
});

describe('inferConfig', () => {
    it('merges section order across releases and reads the heading format', () => {
        const {sections, headingFormat} = inferConfig(parseChangelog(CHANGELOG));
        assert.deepEqual(sections, ['💥 Breaking Changes', '🎁 New Features', '⚙️ Technical']);
        assert.equal(headingFormat, '## {version} - {date}');
    });

    it('keeps a "v" prefix when the latest release heading uses one', () => {
        const {headingFormat} = inferConfig(parseChangelog('## v1.0 - 2026-01-01\n'));
        assert.equal(headingFormat, '## v{version} - {date}');
    });
});

describe('validateFragment', () => {
    const errors = text =>
        validateFragment(text, CONFIG)
            .problems.filter(p => p.level === 'error')
            .map(p => p.message);

    it('accepts a well-formed fragment', () => {
        assert.deepEqual(errors('### 🐞 Bug Fixes\n\n* Fixed a bug.\n'), []);
    });

    it('matches section titles regardless of emoji variation selectors', () => {
        assert.deepEqual(errors('### ⚙ Technical\n\n* Tuned.\n'), []);
    });

    it('rejects version headings, unknown sections, suffixes, groups and empty fragments', () => {
        assert.match(errors('## 1.2.0\n\n### 🐞 Bug Fixes\n\n* x\n')[0], /no version headings/);
        assert.match(errors('### Bugfixes\n\n* x\n')[0], /Unknown section/);
        assert.match(errors('### 💥 Breaking Changes (difficulty: LOW)\n\n* x\n')[0], /Remove/);
        assert.match(errors('### 🎁 New Features\n\n#### Grid\n\n* x\n')[0], /Topic groups/);
        assert.match(errors('<!-- nothing yet -->\n')[0], /no entries/);
        assert.match(errors('* Not in a section.\n')[0], /under one of the sections/);
    });

    it('allows bullets with no section when the repo uses none', () => {
        const {problems} = validateFragment('* Added a thing.\n', {sections: []});
        assert.deepEqual(problems, []);
    });

    it('warns on lines over the configured width', () => {
        const {problems} = validateFragment(`### 🐞 Bug Fixes\n\n* ${'x'.repeat(120)}\n`, {
            ...CONFIG,
            maxLineLength: 100
        });
        assert.deepEqual(
            problems.map(p => p.level),
            ['warning']
        );
    });
});

describe('assembleBody', () => {
    it('orders sections by config and entries by fragment, dropping duplicates', () => {
        const {markdown} = assembleBody(
            [
                fragment('### ⚙️ Technical\n\n* Tech A.\n\n### 🎁 New Features\n\n* Feature A.\n'),
                fragment('### 🎁 New Features\n\n* Feature B.\n* Feature A.\n')
            ],
            CONFIG
        );
        assert.equal(
            markdown,
            '### 🎁 New Features\n\n* Feature A.\n* Feature B.\n\n### ⚙️ Technical\n\n* Tech A.'
        );
    });

    it('uses the configured spelling of a section title', () => {
        const {markdown} = assembleBody([fragment('### ⚙ Technical\n\n* T.\n')], CONFIG);
        assert.match(markdown, /^### ⚙️ Technical/);
    });

    it('puts prose before bullets within a section', () => {
        const {markdown} = assembleBody(
            [
                fragment('### 🎁 New Features\n\n* A.\n'),
                fragment('### 🎁 New Features\n\nIntro.\n\n* B.\n')
            ],
            CONFIG
        );
        assert.equal(markdown, '### 🎁 New Features\n\nIntro.\n\n* A.\n* B.');
    });

    it('merges two bumps of the same library into one span, in any order', () => {
        const {markdown} = assembleBody(
            [
                fragment('### 📚 Libraries\n\n* react `19.2 → 19.3`\n'),
                fragment('### 📚 Libraries\n\n* react `19.1 → 19.2`\n* mobx `7.0 → 7.1`\n')
            ],
            {sections: ['📚 Libraries']}
        );
        assert.equal(markdown, '### 📚 Libraries\n\n* react `19.1 → 19.3`\n* mobx `7.0 → 7.1`');
    });
});

describe('insertRelease', () => {
    const body = '### 🐞 Bug Fixes\n\n* Fixed.';

    it('inserts the newest release under the unreleased heading', () => {
        const {text} = insertRelease(CHANGELOG, {
            heading: '## 1.2.0 - 2026-03-01',
            body,
            version: '1.2.0'
        });
        const titles = parseChangelog(text).releases.map(r => r.title);
        assert.deepEqual(titles.slice(0, 3), [
            '2.0.0-SNAPSHOT - unreleased',
            '1.2.0 - 2026-03-01',
            '1.1.0 - 2026-02-01'
        ]);
        assert.match(
            text,
            /## 1\.2\.0 - 2026-03-01\n\n### 🐞 Bug Fixes\n\n\* Fixed\.\n\n## 1\.1\.0/
        );
    });

    it('inserts a hotfix to an older line in version order', () => {
        const {text} = insertRelease(CHANGELOG, {
            heading: '## 1.0.1 - 2026-03-01',
            body,
            version: '1.0.1'
        });
        const versions = parseChangelog(text).releases.map(r => r.version);
        assert.deepEqual(versions, ['2.0.0-SNAPSHOT', '1.1.0', '1.0.1', '1.0.0']);
    });

    it('rolls the unreleased heading forward when its major ships', () => {
        const {text, notes} = insertRelease(CHANGELOG, {
            heading: '## 2.0.0 - 2026-03-01',
            body,
            version: '2.0.0'
        });
        assert.deepEqual(
            parseChangelog(text)
                .releases.slice(0, 2)
                .map(r => r.title),
            ['3.0.0-SNAPSHOT - unreleased', '2.0.0 - 2026-03-01']
        );
        assert.equal(notes.length, 1);
    });

    it('refuses a version that already exists', () => {
        assert.throws(
            () => insertRelease(CHANGELOG, {heading: '## 1.1.0', body, version: '1.1.0'}),
            /already has/
        );
    });
});

describe('extractUnreleased', () => {
    it('moves entries under the unreleased heading into a fragment and keeps the heading', () => {
        const legacy = CHANGELOG.replace(
            '## 2.0.0-SNAPSHOT - unreleased\n',
            '## 2.0.0-SNAPSHOT - unreleased\n\n### 🐞 Bug Fixes\n\n* Old-style entry.\n'
        );
        const {fragment, text} = extractUnreleased(legacy);
        assert.equal(fragment, '### 🐞 Bug Fixes\n\n* Old-style entry.\n');
        assert.equal(parseChangelog(text).releases[0].sections.length, 0);
        assert.equal(extractUnreleased(CHANGELOG), null);
    });
});

describe('xh-changelog CLI', () => {
    let root, logs;
    const cli = (...argv) =>
        run(argv, {
            cwd: path.join(root, 'client-app'),
            log: m => logs.push(m),
            warn: m => logs.push(m),
            env: {},
            today: '2026-03-01'
        });

    beforeEach(() => {
        root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'xh-changelog-')));
        fs.mkdirSync(path.join(root, 'client-app'));
        fs.writeFileSync(path.join(root, 'CHANGELOG.md'), CHANGELOG);
        logs = [];
    });
    afterEach(() => fs.rmSync(root, {recursive: true, force: true}));

    const write = (name, text) => fs.writeFileSync(path.join(root, 'changelog.d', name), text);
    const changelog = () => fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');

    it('finds CHANGELOG.md above the working directory and sets up changelog.d', () => {
        assert.equal(cli('init'), 0);
        const config = JSON.parse(
            fs.readFileSync(path.join(root, 'changelog.d/config.json'), 'utf8')
        );
        assert.deepEqual(config.sections, [
            '💥 Breaking Changes',
            '🎁 New Features',
            '⚙️ Technical'
        ]);
        assert.ok(fs.existsSync(path.join(root, 'changelog.d/README.md')));
    });

    it('creates a fragment that fails check until it has entries', () => {
        cli('init');
        assert.equal(cli('new', 'feature/thing'), 0);
        assert.ok(fs.existsSync(path.join(root, 'changelog.d/feature-thing.md')));
        assert.equal(cli('check'), 1);
        write('feature-thing.md', '### 🎁 New Features\n\n* Added a thing.\n');
        assert.equal(cli('check'), 0);
    });

    it('fails check when CHANGELOG.md has entries under its unreleased heading', () => {
        fs.writeFileSync(
            path.join(root, 'CHANGELOG.md'),
            CHANGELOG.replace('unreleased\n', 'unreleased\n\n### 🐞 Bug Fixes\n\n* Old style.\n')
        );
        assert.equal(cli('check'), 1);
        assert.ok(logs.some(l => /Move them to a fragment/.test(l)));
    });

    it('releases fragments into CHANGELOG.md and deletes them', () => {
        cli('init');
        write('a.md', '### 🎁 New Features\n\n* Added A.\n');
        write('b.md', '### ⚙️ Technical\n\n* Tuned B.\n');
        assert.equal(cli('release', '1.2.0'), 0);
        assert.match(
            changelog(),
            /## 2\.0\.0-SNAPSHOT - unreleased\n\n## 1\.2\.0 - 2026-03-01\n\n### 🎁 New Features\n\n\* Added A\.\n\n### ⚙️ Technical\n\n\* Tuned B\.\n\n## 1\.1\.0/
        );
        assert.deepEqual(fs.readdirSync(path.join(root, 'changelog.d')).sort(), [
            'README.md',
            'config.json'
        ]);
    });

    it('refuses breaking changes in a minor release unless allowed', () => {
        cli('init');
        write('a.md', '### 💥 Breaking Changes\n\n* Removed A.\n');
        assert.equal(cli('release', '1.2.0'), 1);
        assert.equal(cli('release', '1.2.0', '--allow-breaking'), 0);
    });

    it('writes fragments under the unreleased heading for a snapshot build', () => {
        cli('init');
        write('a.md', '### 🎁 New Features\n\n* Added A.\n');
        assert.equal(cli('snapshot'), 0);
        assert.match(
            changelog(),
            /## 2\.0\.0-SNAPSHOT - unreleased\n\n### 🎁 New Features\n\n\* Added A\.\n\n## 1\.1\.0/
        );
        assert.ok(fs.existsSync(path.join(root, 'changelog.d/a.md')));
    });
});

describe('app changelog JSON', () => {
    const {writeChangelogJson} = require('../lib/common');
    let root;
    beforeEach(() => {
        root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'xh-app-changelog-')));
        fs.mkdirSync(path.join(root, 'client-app/node_modules'), {recursive: true});
        fs.mkdirSync(path.join(root, 'changelog.d'));
        fs.writeFileSync(path.join(root, 'CHANGELOG.md'), CHANGELOG);
    });
    afterEach(() => fs.rmSync(root, {recursive: true, force: true}));

    const build = async () =>
        JSON.parse(
            fs.readFileSync(
                await writeChangelogJson(path.join(root, 'client-app'), true, '2.0.0-SNAPSHOT'),
                'utf8'
            )
        );

    it('shows unreleased fragments under the unreleased heading', async () => {
        fs.writeFileSync(
            path.join(root, 'changelog.d/a.md'),
            '### 🎁 New Features\n\n* Added a wrapped\n  entry.\n'
        );
        const [top, next] = (await build()).versions;
        assert.equal(top.version, '2.0.0-SNAPSHOT');
        assert.deepEqual(top.parsed['🎁 New Features'], ['Added a wrapped entry.']);
        assert.equal(next.version, '1.1.0');
    });

    it('leaves an empty unreleased heading when there are no fragments', async () => {
        const [top] = (await build()).versions;
        assert.equal(top.version, '2.0.0-SNAPSHOT');
        assert.deepEqual(top.sections, []);
    });
});
