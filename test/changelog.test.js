/*
 * This file belongs to Hoist, an application development toolkit
 * developed by Extremely Heavy Industries (www.xh.io | info@xh.io)
 *
 * Copyright © 2026 Extremely Heavy Industries Inc.
 */
'use strict';

const assert = require('node:assert/strict'),
    {execFileSync} = require('node:child_process'),
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

/**
 * Gives each test in the calling `describe` a temp repo with `CHANGELOG.md` at its root.
 * `cwd` is the folder the CLI runs in. `files` are written before each test.
 */
function tempRepo({cwd = '', files = {}} = {}) {
    let root;
    const logs = [],
        at = name => path.join(root, name),
        read = name => fs.readFileSync(at(name), 'utf8'),
        write = (name, text) => {
            fs.mkdirSync(path.dirname(at(name)), {recursive: true});
            fs.writeFileSync(at(name), text);
        },
        cli = (...argv) =>
            run(argv, {
                cwd: at(cwd),
                log: m => logs.push(m),
                warn: m => logs.push(m),
                env: {},
                today: '2026-03-01'
            });

    beforeEach(() => {
        root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'xh-changelog-')));
        fs.mkdirSync(at(cwd), {recursive: true});
        logs.length = 0;
        Object.entries({'CHANGELOG.md': CHANGELOG, ...files}).forEach(([name, text]) =>
            write(name, text)
        );
    });
    afterEach(() => fs.rmSync(root, {recursive: true, force: true}));

    return {cli, logs, at, read, write};
}

// A repo that is set up for fragments, with a short line length to show wrapping.
const WITH_CONFIG = {
    files: {'changelog.d/config.json': JSON.stringify({...CONFIG, maxLineLength: 40})}
};

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

    it('ignores a byte order mark and a comment marker inside a code span', () => {
        const {sections} = parseFragment(
            '\uFEFF### 🎁 New Features\n\n* Uses `<!--` here.\n* Two.\n'
        );
        assert.equal(sections[0].title, '🎁 New Features');
        assert.equal(sections[0].blocks.length, 2);
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

    it('keeps a code block with the bullet it follows', () => {
        const {markdown} = assembleBody(
            [
                fragment('### 🎁 New Features\n\n* First.\n'),
                fragment(
                    '### 🎁 New Features\n\n* Renamed `Foo`. Update calls:\n\n```ts\nbar();\n```\n'
                )
            ],
            CONFIG
        );
        assert.equal(
            markdown,
            '### 🎁 New Features\n\n* First.\n* Renamed `Foo`. Update calls:\n\n```ts\nbar();\n```'
        );
    });

    it('keeps topic groups from legacy entries', () => {
        const {markdown} = assembleBody(
            [fragment('### 💥 Breaking Changes\n\n* Loose.\n\n#### Grid\n\n* Grouped.\n')],
            CONFIG
        );
        assert.equal(markdown, '### 💥 Breaking Changes\n\n* Loose.\n\n#### Grid\n\n* Grouped.');
    });

    it('merges two bumps of the same library into one span, in a Libraries section only', () => {
        const {markdown} = assembleBody(
            [
                fragment('### 📚 Libraries\n\n* react `19.2 → 19.3`\n'),
                fragment('### 📚 Libraries\n\n* react `19.1 → 19.2`\n* mobx `7.0 → 7.1`\n')
            ],
            {sections: ['📚 Libraries']}
        );
        assert.equal(markdown, '### 📚 Libraries\n\n* react `19.1 → 19.3`\n* mobx `7.0 → 7.1`');

        // The same lines in another section are two entries.
        const other = assembleBody(
            [fragment('### ⚙️ Technical\n\n* a `1.0 → 1.1`\n* a `1.1 → 1.2`\n')],
            CONFIG
        );
        assert.equal(other.markdown, '### ⚙️ Technical\n\n* a `1.0 → 1.1`\n* a `1.1 → 1.2`');
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

    it('refuses a version that already exists, in either form of its number', () => {
        ['1.1.0', '1.1'].forEach(version =>
            assert.throws(
                () => insertRelease(CHANGELOG, {heading: `## ${version}`, body, version}),
                /already has/
            )
        );
    });

    it('keeps CRLF line endings', () => {
        const crlf = CHANGELOG.replace(/\n/g, '\r\n'),
            {text} = insertRelease(crlf, {
                heading: '## 1.2.0',
                body: '### T\n\n* x.',
                version: '1.2.0'
            });
        assert.equal(text.split('\n').length, text.split('\r\n').length);
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

    it('clears empty section headings left under the unreleased heading', () => {
        const legacy = CHANGELOG.replace('unreleased\n', 'unreleased\n\n### 🎁 New Features\n');
        const {fragment, text} = extractUnreleased(legacy);
        assert.equal(fragment, null);
        assert.equal(parseChangelog(text).releases[0].sections.length, 0);
    });
});

describe('xh-changelog init', () => {
    let root, logs;
    const cli = (...argv) =>
        run(argv, {cwd: path.join(root, 'client-app'), log: m => logs.push(m), env: {}});
    const read = name => fs.readFileSync(path.join(root, name), 'utf8');

    beforeEach(() => {
        root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'xh-changelog-')));
        fs.mkdirSync(path.join(root, 'client-app'));
        fs.mkdirSync(path.join(root, '.github/workflows'), {recursive: true});
        fs.writeFileSync(path.join(root, 'CHANGELOG.md'), CHANGELOG);
        fs.writeFileSync(
            path.join(root, 'client-app/package.json'),
            '{\n  "name": "app",\n  "scripts": {"start": "x"},\n' +
                '  "devDependencies": {"@xh/hoist-dev-utils": "^16.6.0"}\n}\n'
        );
        fs.writeFileSync(path.join(root, 'client-app/pnpm-lock.yaml'), '');
        logs = [];
    });
    afterEach(() => fs.rmSync(root, {recursive: true, force: true}));

    it('finds CHANGELOG.md above the working directory and sets up changelog.d', () => {
        assert.equal(cli('init'), 0);
        const config = JSON.parse(read('changelog.d/config.json'));
        assert.deepEqual(config.sections, [
            '💥 Breaking Changes',
            '🎁 New Features',
            '⚙️ Technical'
        ]);
        assert.ok(fs.existsSync(path.join(root, 'changelog.d/README.md')));
    });

    it('adds a package script, a workflow and a README that uses the package manager', () => {
        assert.equal(cli('init'), 0);
        assert.equal(JSON.parse(read('client-app/package.json')).scripts.changelog, 'xh-changelog');
        assert.match(read('client-app/package.json'), /^\{\n  "name"/);
        assert.match(read('.github/workflows/changelog.yml'), /check-changelog@master\n$/);
        const readme = read('changelog.d/README.md');
        assert.match(
            readme,
            /`pnpm changelog add <section> "<text>"`\. Run it from `client-app\/`\./
        );
        assert.match(readme, /README\.md#changelog-fragments\)/);
        assert.doesNotMatch(readme, /Entry conventions/);
    });

    it("points the README at the repo's entry conventions", () => {
        fs.writeFileSync(path.join(root, 'CLAUDE.md'), '# App\n\n## Changelog\n\nRules.\n');
        cli('init');
        assert.match(
            read('changelog.d/README.md'),
            /Entry conventions are in the "Changelog" section/
        );
    });

    it('leaves an existing script and workflow alone, and skips the workflow with --no-ci', () => {
        fs.writeFileSync(
            path.join(root, '.github/workflows/ci.yml'),
            'uses: xh/hoist-dev-utils/.github/actions/check-changelog@abc\n'
        );
        assert.equal(cli('init'), 0);
        assert.ok(!fs.existsSync(path.join(root, '.github/workflows/changelog.yml')));

        fs.rmSync(path.join(root, '.github/workflows/ci.yml'));
        fs.rmSync(path.join(root, 'changelog.d'), {recursive: true});
        logs = [];
        assert.equal(cli('init', '--no-ci'), 0);
        assert.ok(!fs.existsSync(path.join(root, '.github/workflows/changelog.yml')));
        assert.doesNotMatch(logs.join('\n'), /Added a "changelog" script/);
    });

    it('names plain xh-changelog where no package installs the tool', () => {
        fs.rmSync(path.join(root, 'client-app/package.json'));
        assert.equal(cli('init'), 0);
        assert.match(read('changelog.d/README.md'), /`xh-changelog add <section> "<text>"`\.\n/);
    });

    it('sets the house line length only for a changelog that keeps to it', () => {
        const wrapped = n =>
            `## ${n}.0.0 - 2026-01-01\n\n### 🎁 New Features\n\n` +
            Array.from({length: 12}, (_, i) => `* Added feature ${i}, wrapped\n  as usual.`).join(
                '\n'
            );
        const text = `# Changelog\n\n${wrapped(2)}\n\n${wrapped(1)}\n`;
        assert.equal(inferConfig(parseChangelog(text), text).maxLineLength, 100);

        const long = text.replace(/wrapped\n  as usual/g, 'x'.repeat(120));
        assert.equal(inferConfig(parseChangelog(long), long).maxLineLength, null);
    });
});

describe('xh-changelog add', () => {
    const {cli, logs, at, read, write} = tempRepo(WITH_CONFIG);

    it('adds an entry under the section a short name refers to, wrapped at the line length', () => {
        assert.equal(
            cli('add', 'fix', 'Fixed a crash when the grid had no data.', '--name', 'b'),
            0
        );
        assert.equal(cli('add', 'features', 'Added', 'a', 'thing.', '--name', 'b'), 0);
        assert.equal(cli('add', 'Bug Fixes', '* Fixed more.', '--name', 'b'), 0);
        assert.equal(
            read('changelog.d/b.md'),
            '### 🎁 New Features\n\n* Added a thing.\n\n' +
                '### 🐞 Bug Fixes\n\n* Fixed a crash when the grid had no\n  data.\n* Fixed more.\n'
        );
        assert.equal(cli('check'), 0);
    });

    it('adds a new section in the configured order, not at the end', () => {
        write('changelog.d/g.md', '### 🐞 Bug Fixes\n\n* One.\n\n### ⚙️ Technical\n\n* Two.\n');
        cli('add', 'feature', 'Added a thing.', '--name', 'g');
        cli('add', 'breaking', 'Removed a thing.', '--name', 'g');
        assert.deepEqual(read('changelog.d/g.md').match(/^### .*$/gm), [
            '### 💥 Breaking Changes',
            '### 🎁 New Features',
            '### 🐞 Bug Fixes',
            '### ⚙️ Technical'
        ]);
        assert.match(read('changelog.d/g.md'), /\* Added a thing\.\n\n### 🐞 Bug Fixes/);
        assert.equal(cli('check'), 0);
    });

    it('adds an entry to a fragment below its comment', () => {
        write('changelog.d/c.md', '<!--\n  Notes for this branch.\n-->\n');
        cli('add', 'tech', 'Tuned a thing.', '--name', 'c');
        assert.match(read('changelog.d/c.md'), /-->\n\n### ⚙️ Technical\n\n\* Tuned a thing\.\n$/);
        assert.equal(cli('check'), 0);
    });

    it('sets a new entry off from a paragraph that ends its section', () => {
        write('changelog.d/f.md', '### 🎁 New Features\n\nIntro.\n\n### 🐞 Bug Fixes\n\n* One.\n');
        cli('add', 'feature', 'Added a thing.', '--name', 'f');
        assert.match(read('changelog.d/f.md'), /Intro\.\n\n\* Added a thing\.\n\n### 🐞 Bug Fixes/);
    });

    it('keeps a fragment named with a path inside changelog.d, as a visible file', () => {
        cli('add', 'fix', 'Two.', '--name', '../.hidden');
        assert.ok(fs.existsSync(at('changelog.d/hidden.md')));
        cli('add', 'fix', 'Three.', '--name', 'feature/thing');
        assert.ok(fs.existsSync(at('changelog.d/feature-thing.md')));
    });

    it('takes entry text that starts with dashes', () => {
        assert.equal(cli('add', 'fix', '--watch mode now works.', '--name', 'e'), 0);
        assert.match(read('changelog.d/e.md'), /\* --watch mode now works\./);
    });

    it('refuses a section name that matches none or more than one section', () => {
        assert.equal(cli('add', 'x', 'Text.', '--name', 'd'), 1);
        assert.match(logs.at(-1), /No section matches "x"/);
        assert.equal(cli('add', 'e', 'Text.', '--name', 'd'), 1);
        write('changelog.d/config.json', JSON.stringify({sections: ['Bug Fixes', 'Other Fixes']}));
        assert.equal(cli('add', 'fix', 'Text.', '--name', 'd'), 1);
        assert.match(logs.at(-1), /more than one section/);
        assert.ok(!fs.existsSync(at('changelog.d/d.md')));
    });
});

describe('xh-changelog check', () => {
    const {cli, logs, at, write} = tempRepo(WITH_CONFIG);

    it('fails on a fragment that holds only a comment', () => {
        write('changelog.d/feature-thing.md', '<!--\n  Entries go here.\n-->\n');
        assert.equal(cli('check'), 1);
        write('changelog.d/feature-thing.md', '### 🎁 New Features\n\n* Added a thing.\n');
        assert.equal(cli('check'), 0);
    });

    it('fails when CHANGELOG.md has entries under its unreleased heading', () => {
        write(
            'CHANGELOG.md',
            CHANGELOG.replace('unreleased\n', 'unreleased\n\n### 🐞 Bug Fixes\n\n* Old style.\n')
        );
        assert.equal(cli('check'), 1);
        assert.ok(logs.some(l => /Move them to a fragment/.test(l)));
    });

    it('fails on a file in changelog.d that a release would leave out', () => {
        write('changelog.d/a.md', '### 🐞 Bug Fixes\n\n* Fixed a bug.\n');
        write('changelog.d/my-branch.txt', '### 🐞 Bug Fixes\n\n* Lost.\n');
        assert.equal(cli('check'), 1);
        assert.match(logs.join('\n'), /my-branch\.txt: error: Not a fragment/);
    });

    it('warns when it cannot diff against the base', () => {
        assert.equal(cli('check', '--base', 'no-such-ref'), 0);
        assert.match(logs.join('\n'), /warning: Could not diff against no-such-ref/);
    });

    it('passes --release only when the version is in and no fragments are left', () => {
        write('changelog.d/a.md', '### 🐞 Bug Fixes\n\n* Fixed a bug.\n');
        assert.equal(cli('check', '--release', '1.2.0'), 1);
        assert.match(logs.join('\n'), /CHANGELOG\.md has no release 1\.2\.0/);
        assert.match(logs.join('\n'), /1 fragment still in changelog\.d\/ \(a\.md\)/);

        assert.equal(cli('check', '--release', '1.1'), 1);
        assert.equal(cli('release', '1.2.0'), 0);
        assert.equal(cli('check', '--release', 'v1.2.0'), 0);
        assert.equal(cli('check', '--release', '2.0.0'), 1);
    });
});

describe('xh-changelog preview', () => {
    const {cli, logs, at, write} = tempRepo(WITH_CONFIG),
        git = (...args) => execFileSync('git', args, {cwd: at(''), stdio: 'ignore'});

    it('prints only the entries that the branch adds', () => {
        write('changelog.d/a.md', '### 🐞 Bug Fixes\n\n* On develop.\n');
        git('init', '-q', '-b', 'develop');
        git('add', '-A');
        git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'base');
        git('switch', '-qc', 'feature');
        assert.equal(cli('preview', '--base', 'develop'), 0);
        assert.match(logs.at(-1), /adds no changelog entries/);

        cli('add', 'fix', 'On the branch.');
        git('add', '-A');
        git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'entry');
        assert.equal(cli('preview', '--base', 'develop'), 0);
        assert.match(logs.at(-1), /\* On the branch\./);
        assert.doesNotMatch(logs.at(-1), /On develop/);
        assert.ok(fs.existsSync(at('changelog.d/feature.md')));
    });
});

describe('xh-changelog release', () => {
    const {cli, at, read, write} = tempRepo(WITH_CONFIG);

    it('assembles fragments into CHANGELOG.md and deletes them', () => {
        cli('init');
        write('changelog.d/a.md', '### 🎁 New Features\n\n* Added A.\n');
        write('changelog.d/b.md', '### ⚙️ Technical\n\n* Tuned B.\n');
        assert.equal(cli('release', '1.2.0'), 0);
        assert.match(
            read('CHANGELOG.md'),
            /## 2\.0\.0-SNAPSHOT - unreleased\n\n## 1\.2\.0 - 2026-03-01\n\n### 🎁 New Features\n\n\* Added A\.\n\n### ⚙️ Technical\n\n\* Tuned B\.\n\n## 1\.1\.0/
        );
        assert.deepEqual(fs.readdirSync(at('changelog.d')).sort(), ['README.md', 'config.json']);
    });

    it('refuses entries written under the unreleased heading', () => {
        const old = CHANGELOG.replace('unreleased\n', 'unreleased\n\n### 🐞 Bug Fixes\n\n* Old.\n');
        write('CHANGELOG.md', old);
        write('changelog.d/a.md', '### 🐞 Bug Fixes\n\n* New.\n');
        assert.equal(cli('release', '1.2.0'), 1);
        assert.equal(read('CHANGELOG.md'), old);
        assert.ok(fs.existsSync(at('changelog.d/a.md')));
    });

    it('accepts a section heading written without its emoji, and releases it with one', () => {
        write('changelog.d/a.md', '### bug fixes\n\n* Fixed a bug.\n');
        assert.equal(cli('check'), 0);
        assert.equal(cli('release', '1.2.0'), 0);
        assert.match(
            read('CHANGELOG.md'),
            /## 1\.2\.0 - 2026-03-01\n\n### 🐞 Bug Fixes\n\n\* Fixed/
        );
    });

    it('refuses breaking changes in a minor release unless allowed', () => {
        write('changelog.d/a.md', '### 💥 Breaking Changes\n\n* Removed A.\n');
        assert.equal(cli('release', '1.2.0'), 1);
        assert.equal(cli('release', '1.2.0', '--allow-breaking'), 0);
    });
});

describe('xh-changelog snapshot', () => {
    const {cli, at, read, write} = tempRepo({cwd: 'client-app'});

    it('writes fragments under the unreleased heading, and keeps them', () => {
        cli('init');
        write('changelog.d/a.md', '### 🎁 New Features\n\n* Added A.\n');
        assert.equal(cli('snapshot'), 0);
        assert.match(
            read('CHANGELOG.md'),
            /## 2\.0\.0-SNAPSHOT - unreleased\n\n### 🎁 New Features\n\n\* Added A\.\n\n## 1\.1\.0/
        );
        assert.ok(fs.existsSync(at('changelog.d/a.md')));
    });

    it('names a new unreleased heading for the package version', () => {
        write('CHANGELOG.md', CHANGELOG.replace('## 2.0.0-SNAPSHOT - unreleased\n\n', ''));
        write('client-app/package.json', '{"version": "2.0-SNAPSHOT"}');
        cli('init');
        write('changelog.d/a.md', '### 🎁 New Features\n\n* Added A.\n');
        assert.equal(cli('snapshot'), 0);
        assert.match(read('CHANGELOG.md'), /## 2\.0-SNAPSHOT - unreleased\n\n### 🎁 New Features/);
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

    // Runs a build with console output captured, and returns the JSON and the log lines.
    const buildLogged = async (t, version) => {
        const lines = [];
        t.mock.method(console, 'log', (...args) => lines.push(args.join(' ')));
        const file = await writeChangelogJson(path.join(root, 'client-app'), true, version);
        return {json: JSON.parse(fs.readFileSync(file, 'utf8')), log: lines.join('\n')};
    };

    it('still builds the released notes when the fragments cannot be read', async t => {
        fs.writeFileSync(path.join(root, 'changelog.d/config.json'), '{not json');
        fs.writeFileSync(path.join(root, 'changelog.d/a.md'), '### 🎁 New Features\n\n* A.\n');
        const {json, log} = await buildLogged(t, '2.0.0-SNAPSHOT');
        assert.deepEqual(
            json.versions.map(v => v.version),
            ['2.0.0-SNAPSHOT', '1.1.0', '1.0.0']
        );
        assert.match(log, /could not read the fragments in changelog\.d\/.*config\.json/);
        assert.doesNotMatch(log, /exception parsing CHANGELOG\.md/);
    });

    it('warns when a release build still finds fragments', async t => {
        fs.writeFileSync(path.join(root, 'changelog.d/a.md'), '### 🎁 New Features\n\n* A.\n');
        const release = await buildLogged(t, '1.2.0');
        assert.match(release.log, /WARNING - this is a build of release 1\.2\.0/);

        const snapshot = await buildLogged(t, '2.0.0-SNAPSHOT');
        assert.doesNotMatch(snapshot.log, /WARNING - this is a build of release/);
    });
});

describe('matching the repo it runs in', () => {
    let root, logs;
    const cli = (...argv) =>
        run(argv, {cwd: root, log: m => logs.push(m), env: {}, today: '2026-03-01'});
    const read = name => fs.readFileSync(path.join(root, name), 'utf8');
    const write = (name, text) => {
        fs.mkdirSync(path.dirname(path.join(root, name)), {recursive: true});
        fs.writeFileSync(path.join(root, name), text);
    };
    const infer = text => inferConfig(parseChangelog(text), text);

    beforeEach(() => {
        root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'xh-changelog-')));
        logs = [];
    });
    afterEach(() => fs.rmSync(root, {recursive: true, force: true}));

    it('orders sections that rarely share a release, with Libraries last', () => {
        const release = (version, ...titles) =>
            `## ${version} - 2026-01-01\n\n` + titles.map(t => `### ${t}\n\n* Entry.\n`).join('\n');
        const text = [
            '# Changelog\n',
            release('3.0.0', 'Breaking', 'Features', 'Fixes', 'Technical', 'AI Docs'),
            release('2.1.0', 'Technical'),
            release('2.0.0', 'Breaking', 'Features', 'Fixes', 'Technical', 'Styles'),
            release('1.0.0', 'Features', 'AI Docs', 'Libraries')
        ].join('\n');
        assert.deepEqual(infer(text).sections, [
            'Breaking',
            'Features',
            'Fixes',
            'Technical',
            'AI Docs',
            'Styles',
            'Libraries'
        ]);
    });

    it('learns from the unreleased block of a changelog with no release yet', () => {
        const config = infer(
            '# Changelog\n\n## v1.0-SNAPSHOT - unreleased\n\n### New Features\n* One.\n\n### Bug Fixes\n* Two.\n'
        );
        assert.deepEqual(config.sections, ['New Features', 'Bug Fixes']);
        assert.equal(config.headingFormat, '## v{version} - {date}');
        assert.equal(config.compactHeadings, true);
    });

    it('writes no blank line after a heading in a changelog that has none', () => {
        write(
            'CHANGELOG.md',
            '# Changelog\n\n## v2.0-SNAPSHOT - unreleased\n\n## v1.0.0 - 2026-01-01\n\n' +
                '### New Features\n- One.\n\n### Bug Fixes\n- Two.\n'
        );
        assert.equal(cli('add', 'fix', 'Fixed it.', '--name', 'a'), 0);
        assert.equal(cli('add', 'feature', 'Added it.', '--name', 'a'), 0);
        assert.equal(
            read('changelog.d/a.md'),
            '### New Features\n- Added it.\n\n### Bug Fixes\n- Fixed it.\n'
        );
        assert.equal(cli('release', '1.1.0'), 0);
        assert.match(
            read('CHANGELOG.md'),
            /## v1\.1\.0 - 2026-03-01\n\n### New Features\n- Added it\.\n\n### Bug Fixes\n- Fixed it\.\n\n## v1\.0\.0/
        );
    });

    it('writes the config and workflow in the style the repo already uses', () => {
        write('CHANGELOG.md', CHANGELOG);
        write(
            'package.json',
            '{\n  "name": "lib",\n  "devDependencies": {"@xh/hoist-dev-utils": "^16.6.0"}\n}\n'
        );
        write('.github/workflows/ci.yml', 'steps:\n    - uses: actions/checkout@abc123 # v9\n');
        fs.mkdirSync(path.join(root, '.git'));
        assert.equal(cli('init'), 0);
        assert.match(read('changelog.d/config.json'), /^\{\n  "sections"/);
        assert.match(
            read('.github/workflows/changelog.yml'),
            /- uses: actions\/checkout@abc123 # v9\n/
        );
    });
});
