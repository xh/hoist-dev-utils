/*
 * This file belongs to Hoist, an application development toolkit
 * developed by Extremely Heavy Industries (www.xh.io | info@xh.io)
 *
 * Copyright © 2026 Extremely Heavy Industries Inc.
 */
'use strict';

/**
 * `xh-changelog` - manage changelog fragments. Each pull request adds its entries as a small
 * markdown file in `changelog.d/`. A release assembles them into CHANGELOG.md under the real
 * version number. See the README section "Changelog fragments".
 */

const fs = require('fs'),
    path = require('path'),
    {execFileSync} = require('child_process'),
    {
        FRAGMENT_DIR,
        CONFIG_FILE,
        findChangelogRoot,
        loadChangelogContext,
        inferConfig
    } = require('./config'),
    {formatHeading, insertRelease, extractUnreleased, isMajor} = require('./assemble'),
    {assembleFragments, changelogWithUnreleased} = require('./fragments');

const USAGE = `Usage: xh-changelog <command> [options]

Each pull request adds its changelog entries to ${FRAGMENT_DIR}/<name>.md, using the same
### sections and bullets as CHANGELOG.md, with no version heading. A release assembles them.

Commands:
  new [name]            Create ${FRAGMENT_DIR}/<name>.md. The name defaults to the git branch.
  check [--base <ref>]  Validate every fragment, and that CHANGELOG.md has no unreleased
                        entries. With --base, also warn if the branch adds no fragment.
                        Add --require to make that an error.
  preview               Print the next release as it would be assembled.
  release <version>     Assemble all fragments into CHANGELOG.md as <version>, then delete
                        them. Options: --date YYYY-MM-DD, --allow-breaking, --dry-run.
  snapshot [--version <v>]
                        Write the assembled fragments under the unreleased heading in
                        CHANGELOG.md, for a snapshot build. Never commit the result.
  init                  Set up ${FRAGMENT_DIR}/ in this repo: a README, a config inferred from
                        CHANGELOG.md, and a fragment holding any unreleased entries.

Run from anywhere inside the repo. The tool works on the nearest CHANGELOG.md above you.`;

const COMMANDS = {
    new: cmdNew,
    check: cmdCheck,
    preview: cmdPreview,
    release: cmdRelease,
    snapshot: cmdSnapshot,
    init: cmdInit
};

/**
 * Run the CLI.
 * @param {string[]} argv - arguments after the command name.
 * @param {Object} [io] - injectable `cwd`, `log`, `warn` and `env`, for tests.
 * @returns {number} exit code.
 */
function run(argv, io = {}) {
    const out = {
        cwd: io.cwd ?? process.cwd(),
        log: io.log ?? (msg => console.log(msg)),
        warn: io.warn ?? (msg => console.error(msg)),
        env: io.env ?? process.env,
        today: io.today ?? today()
    };
    const [command, ...rest] = argv,
        args = parseArgs(rest);

    if (!command || command === 'help' || args.help) {
        out.log(USAGE);
        return command ? 0 : 1;
    }
    const fn = COMMANDS[command];
    if (!fn) {
        out.warn(`Unknown command "${command}".\n\n${USAGE}`);
        return 1;
    }

    const root = findChangelogRoot(out.cwd);
    if (!root) {
        out.warn('No CHANGELOG.md found in this directory or any parent.');
        return 1;
    }

    try {
        return fn(loadChangelogContext(root), args, out) ?? 0;
    } catch (e) {
        out.warn(`xh-changelog: ${e.message}`);
        return 1;
    }
}

//------------------------
// Commands
//------------------------
function cmdNew(ctx, args, out) {
    const name = sanitizeName(args._[0] ?? gitBranch(ctx.root));
    if (!name) throw new Error('No name given and no git branch found. Run `new <name>`.');

    fs.mkdirSync(ctx.fragmentDir, {recursive: true});
    const file = path.join(ctx.fragmentDir, `${name}.md`);
    if (fs.existsSync(file)) {
        out.log(`${rel(ctx, file)} already exists - add your entries there.`);
        return 0;
    }

    const sections = ctx.config.sections.length
        ? ctx.config.sections.map(s => `    ### ${s}`).join('\n')
        : '    (none - write bullets with no section heading)';
    fs.writeFileSync(
        file,
        `<!--
  Changelog entries for this branch. Write them as you would in CHANGELOG.md, under one or more
  of these section headings, in any order. Do not add a version heading.

${sections}
-->
`
    );
    out.log(`Created ${rel(ctx, file)}.`);
    return 0;
}

function cmdCheck(ctx, args, out) {
    const report = new Report(ctx, out),
        {files, problems} = assembleFragments(ctx);
    problems.forEach(({file, ...p}) => report.add(file, p));

    const legacy = extractUnreleased(ctx.changelogText);
    if (legacy) {
        const top = ctx.changelog.releases[0];
        report.add('CHANGELOG.md', {
            line: top.startLine + 1,
            level: 'error',
            message:
                `"${top.title}" has entries. Move them to a fragment in ${FRAGMENT_DIR}/ - ` +
                `CHANGELOG.md only gets entries when a release is assembled.`
        });
    }

    if (args.base) {
        const changed = gitChangedFiles(ctx.root, args.base);
        if (changed == null) {
            report.add(null, {level: 'warning', message: `Could not diff against ${args.base}.`});
        } else {
            const prefix = path.relative(gitRoot(ctx.root) ?? ctx.root, ctx.fragmentDir) + '/',
                touched = changed.filter(
                    c =>
                        c.file.startsWith(prefix) &&
                        c.status !== 'D' &&
                        listableFragment(c.file.slice(prefix.length))
                );
            if (!touched.length) {
                report.add(null, {
                    level: args.require ? 'error' : 'warning',
                    message:
                        `This branch adds no changelog fragment. Run \`xh-changelog new\` to add ` +
                        `one, or skip it if the change needs no entry.`
                });
            }
        }
    }

    report.print();
    if (!report.errors) {
        out.log(`${files.length} fragment${files.length === 1 ? '' : 's'} OK.`);
    }
    return report.errors ? 1 : 0;
}

function cmdPreview(ctx, args, out) {
    const {markdown, count} = assemble(ctx, out, {strict: false});
    if (!count) {
        out.log(`No fragments in ${FRAGMENT_DIR}/.`);
        return 0;
    }
    const top = ctx.changelog.releases[0],
        heading = top?.unreleased ? `## ${top.title}` : '## Unreleased';
    out.log(`${heading}\n\n${markdown}\n`);
    return 0;
}

function cmdSnapshot(ctx, args, out) {
    const {markdown, count} = assemble(ctx, out, {strict: false});
    if (!count) {
        out.log(`No fragments in ${FRAGMENT_DIR}/ - CHANGELOG.md unchanged.`);
        return 0;
    }
    const {text} = changelogWithUnreleased(ctx.root, {version: args.version ?? 'Unreleased'});
    fs.writeFileSync(ctx.changelogPath, text);
    out.log(`Wrote ${count} fragment${count === 1 ? '' : 's'} into CHANGELOG.md for a snapshot.`);
    return 0;
}

function cmdRelease(ctx, args, out) {
    const version = args._[0]?.replace(/^v(?=\d)/, '');
    if (!version) throw new Error('Give the version to release, e.g. `release 92.1.0`.');
    if (!/^\d+\.\d+(\.\d+)?$/.test(version)) {
        throw new Error(`"${version}" is not a release version such as 92.1.0.`);
    }
    const date = args.date ?? out.today;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`Bad --date "${date}".`);

    // Entries still written into CHANGELOG.md the old way join the release as a fragment.
    let changelogText = ctx.changelogText;
    const legacy = extractUnreleased(changelogText),
        extra = [];
    if (legacy) {
        out.warn(`Including entries found under "${ctx.changelog.releases[0].title}".`);
        changelogText = legacy.text;
        extra.push({name: 'CHANGELOG.md (unreleased)', text: legacy.fragment});
    }

    const {markdown, count, sectionTitles, files, errors} = assemble(ctx, out, {
        strict: true,
        extra
    });
    if (errors) return 1;
    if (!count) out.warn('No fragments found - the release will have no entries.');

    const breaking = sectionTitles.find(t => t && /breaking/i.test(t));
    if (breaking && !isMajor(version) && !args['allow-breaking']) {
        throw new Error(
            `The fragments include "${breaking}", but ${version} is not a major release. ` +
                `Release a major version, or pass --allow-breaking.`
        );
    }

    const heading = formatHeading(ctx.config, version, date),
        {text, notes} = insertRelease(changelogText, {heading, body: markdown, version});

    if (args['dry-run']) {
        out.log(`${heading}\n\n${markdown}\n`);
        return 0;
    }

    fs.writeFileSync(ctx.changelogPath, text);
    files.forEach(f => fs.unlinkSync(path.join(ctx.fragmentDir, f)));
    out.log(
        `Added ${version} to CHANGELOG.md from ${count} fragment${count === 1 ? '' : 's'}, ` +
            `and deleted ${files.length} file${files.length === 1 ? '' : 's'} in ${FRAGMENT_DIR}/.`
    );
    notes.forEach(n => out.log(n));
    out.log('Review and edit the new release in CHANGELOG.md, then commit.');
    return 0;
}

function cmdInit(ctx, args, out) {
    fs.mkdirSync(ctx.fragmentDir, {recursive: true});

    if (!fs.existsSync(ctx.configPath)) {
        const inferred = inferConfig(ctx.changelog),
            config = {sections: inferred.sections, headingFormat: inferred.headingFormat};
        fs.writeFileSync(ctx.configPath, JSON.stringify(config, null, 4) + '\n');
        out.log(`Created ${rel(ctx, ctx.configPath)} - check the section list and order.`);
    }

    const readme = path.join(ctx.fragmentDir, 'README.md');
    if (!fs.existsSync(readme)) {
        fs.writeFileSync(readme, README);
        out.log(`Created ${rel(ctx, readme)}.`);
    }

    const legacy = extractUnreleased(ctx.changelogText);
    if (legacy) {
        const file = path.join(ctx.fragmentDir, 'unreleased.md');
        fs.writeFileSync(file, legacy.fragment);
        fs.writeFileSync(ctx.changelogPath, legacy.text);
        out.log(`Moved the unreleased entries in CHANGELOG.md to ${rel(ctx, file)}.`);
    }
    return 0;
}

//------------------------
// Implementation
//------------------------
function assemble(ctx, out, {strict, extra = []}) {
    const result = assembleFragments(ctx, {extra}),
        report = new Report(ctx, out);
    result.problems.forEach(({file, ...p}) => report.add(file, p));
    if (strict) report.print();
    return {...result, errors: strict && report.errors};
}

/** Collects problems and prints them, as GitHub annotations when run in Actions. */
class Report {
    constructor(ctx, out) {
        this.ctx = ctx;
        this.out = out;
        this.items = [];
    }

    get errors() {
        return this.items.filter(it => it.level === 'error').length;
    }

    add(file, {line, level, message}) {
        this.items.push({file, line, level, message});
    }

    print() {
        const gha = this.out.env.GITHUB_ACTIONS === 'true';
        this.items.forEach(({file, line, level, message}) => {
            if (gha) {
                const loc = file ? ` file=${this.ghaPath(file)}${line ? `,line=${line}` : ''}` : '';
                this.out.warn(`::${level}${loc}::${message}`);
            } else {
                const loc = file ? `${file}${line ? `:${line}` : ''}: ` : '';
                this.out.warn(`${loc}${level}: ${message}`);
            }
        });
    }

    // Annotations need paths relative to the repo root, which differs for apps.
    ghaPath(file) {
        const repoRoot = gitRoot(this.ctx.root) ?? this.ctx.root;
        return path.relative(repoRoot, path.join(this.ctx.root, file));
    }
}

function parseArgs(argv) {
    const args = {_: []};
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg.startsWith('--')) {
            const [key, inline] = arg.slice(2).split('=', 2);
            const takesValue = ['base', 'date', 'version'].includes(key);
            args[key] = inline ?? (takesValue ? argv[++i] : true);
        } else {
            args._.push(arg);
        }
    }
    return args;
}

function listableFragment(name) {
    return (
        name.endsWith('.md') && !name.includes('/') && name !== 'README.md' && name !== CONFIG_FILE
    );
}

function sanitizeName(name) {
    return name
        ?.trim()
        .replace(/\.md$/, '')
        .replace(/[^A-Za-z0-9._-]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

function rel(ctx, file) {
    return path.relative(ctx.root, file);
}

function today() {
    const d = new Date(),
        pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function git(cwd, args) {
    try {
        return execFileSync('git', args, {
            cwd,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore']
        }).trim();
    } catch {
        return null;
    }
}

function gitRoot(cwd) {
    return git(cwd, ['rev-parse', '--show-toplevel']);
}

function gitBranch(cwd) {
    const branch = git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']);
    return branch && branch !== 'HEAD' ? branch : null;
}

/** Files changed on this branch since it left `base`, as `{status, file}` with repo-root paths. */
function gitChangedFiles(cwd, base) {
    const out = git(cwd, ['diff', '--name-status', '--no-renames', `${base}...HEAD`]);
    if (out == null) return null;
    return out
        .split('\n')
        .filter(Boolean)
        .map(line => {
            const [status, file] = line.split('\t');
            return {status: status[0], file};
        });
}

const README = `# Changelog fragments

Each pull request adds its changelog entries here, in a new markdown file, instead of editing
\`CHANGELOG.md\`. A release assembles every fragment into \`CHANGELOG.md\` under the real version
number, then deletes them.

This means that pull requests never conflict over \`CHANGELOG.md\`, and an entry can never land
under a version that has already shipped.

## Add an entry

Run \`xh-changelog new\` (from \`@xh/hoist-dev-utils\`) to create \`changelog.d/<branch>.md\`, or
create the file yourself. Write it as you would write the entries in \`CHANGELOG.md\`, with the
same \`###\` section headings and bullets, but with no version heading:

\`\`\`markdown
### New Features

* Added a widget that does a thing.

### Bug Fixes

* Fixed a crash when the widget had no data.
\`\`\`

- Use only the sections listed in \`changelog.d/config.json\`.
- To change an entry before release, edit its fragment. After release, edit \`CHANGELOG.md\`.
- Release-level notes, such as an upgrade difficulty or topic groups, are added when the release
  is curated. Leave them out of fragments.

## Commands

- \`xh-changelog check\` - validate the fragments. CI runs this on each pull request.
- \`xh-changelog preview\` - print the next release as it will be assembled.
- \`xh-changelog release <version>\` - assemble the release into \`CHANGELOG.md\` and delete the
  fragments. Review and curate the result, then commit.
`;

module.exports = {run, USAGE};
