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
        listFragmentFiles,
        listStrayFiles,
        isFragmentName,
        inferConfig,
        sameSection,
        findSections
    } = require('./config'),
    {parseFragment} = require('./parse'),
    {formatHeading, insertRelease, extractUnreleased, findRelease, isMajor} = require('./assemble'),
    {assembleFragments, changelogWithUnreleased} = require('./fragments');

const USAGE = `Usage: xh-changelog <command> [options]

Each pull request adds its changelog entries to ${FRAGMENT_DIR}/<name>.md, using the same
### sections and bullets as CHANGELOG.md, with no version heading. A release assembles them.

Commands:
  add <section> <text>  Add one entry to this branch's fragment, creating the file if needed.
                        <section> is a section title or part of one: fix, feature, tech.
                        Option: --name <fragment>.
  new [name]            Create an empty ${FRAGMENT_DIR}/<name>.md to edit. The name defaults to
                        the git branch.
  check [--base <ref>]  Validate every fragment, and that CHANGELOG.md has no unreleased
                        entries. With --base, also warn if the branch adds no fragment.
                        Add --require to make that an error.
  check --release <version>
                        For a release build: fail unless CHANGELOG.md has <version> and no
                        fragments are left.
  preview [--base <ref>]
                        Print the next release as it would be assembled. With --base, print
                        only the entries this branch adds.
  release <version>     Assemble all fragments into CHANGELOG.md as <version>, then delete
                        them. Options: --date YYYY-MM-DD, --allow-breaking, --dry-run.
  snapshot [--version <v>]
                        Write the assembled fragments under the unreleased heading in
                        CHANGELOG.md, for a snapshot build. Never commit the result.
  init                  Set up ${FRAGMENT_DIR}/ in this repo: a README, a config inferred from
                        CHANGELOG.md, a fragment holding any unreleased entries, and a GitHub
                        workflow that runs the check. Option: --no-ci.

Run from anywhere inside the repo. The tool works on the nearest CHANGELOG.md above you.`;

const COMMANDS = {
    add: cmdAdd,
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

    if (!command || ['help', '--help', '-h'].includes(command) || args.help || args.h) {
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
function cmdAdd(ctx, args, out) {
    const {sections, bullet, maxLineLength} = ctx.config,
        words = [...args._];

    let title = null;
    if (sections.length) {
        const name = words.shift(),
            found = name ? findSections(sections, name) : [];
        if (found.length !== 1) {
            throw new Error(
                (!name
                    ? 'Give a section and the entry text.'
                    : found.length
                      ? `"${name}" matches more than one section.`
                      : `No section matches "${name}".`) +
                    ` Sections: ${sections.join(', ')}. ` +
                    'For example: `add fix "Fixed a crash when the grid had no data."`'
            );
        }
        title = found[0];
    }

    const text = words
        .join(' ')
        .replace(/^\s*[*+-]\s+/, '')
        .replace(/\s+/g, ' ')
        .trim();
    if (!text) throw new Error('Give the entry text, in quotes.');

    const name = sanitizeName(args.name ?? gitBranch(ctx.root));
    if (!name) throw new Error('No git branch found. Pass `--name <fragment>`.');

    fs.mkdirSync(ctx.fragmentDir, {recursive: true});
    const file = path.join(ctx.fragmentDir, `${name}.md`),
        existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '',
        entry = wrapEntry(`${bullet} ${text}`, maxLineLength);

    fs.writeFileSync(file, insertEntry(existing, title, entry));
    out.log(`Added to ${title ? `"${title}" in ` : ''}${rel(ctx, file)}:\n\n${entry}\n`);
    return 0;
}

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
    if (args.release) return checkRelease(ctx, args, out);

    const report = new Report(ctx, out),
        {files, problems} = assembleFragments(ctx);
    problems.forEach(({file, ...p}) => report.add(file, p));

    listStrayFiles(ctx.fragmentDir).forEach(name =>
        report.add(path.join(FRAGMENT_DIR, name), {
            level: 'error',
            message:
                `Not a fragment, so a release would leave it out. Fragments are .md files ` +
                `directly in ${FRAGMENT_DIR}/.`
        })
    );
    findReleasedEntries(ctx, files).forEach(({file, ...p}) => report.add(file, p));

    const legacy = extractUnreleased(ctx.changelogText);
    if (legacy) {
        const top = ctx.changelog.releases[0];
        report.add('CHANGELOG.md', {
            line: top.startLine + 1,
            ...(legacy.fragment
                ? {
                      level: 'error',
                      message:
                          `"${top.title}" has entries. Move them to a fragment in ` +
                          `${FRAGMENT_DIR}/ - CHANGELOG.md only gets entries when a release is ` +
                          `assembled.`
                  }
                : {
                      level: 'warning',
                      message: `Remove the empty section headings under "${top.title}".`
                  })
        });
    }

    if (args.base) {
        const changed = gitChangedFiles(ctx.root, args.base);
        if (changed == null) {
            report.add(null, {
                level: args.require ? 'error' : 'warning',
                message:
                    `Could not diff against ${args.base}, so could not look for a new fragment. ` +
                    `In CI, check out with \`fetch-depth: 0\`.`
            });
        } else {
            const prefix = path.relative(gitRoot(ctx.root) ?? ctx.root, ctx.fragmentDir) + '/',
                touched = branchFragments(changed, prefix);
            if (!touched.length) {
                report.add(null, {
                    level: args.require ? 'error' : 'warning',
                    message:
                        `This branch adds no changelog fragment. Run ` +
                        `\`xh-changelog add <section> "<text>"\` to add an entry, or skip it if ` +
                        `the change needs no entry.`
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

// The check a release build runs: the changelog must already hold the version being published.
function checkRelease(ctx, args, out) {
    const version = String(args.release).replace(/^v(?=\d)/, ''),
        report = new Report(ctx, out),
        files = listFragmentFiles(ctx.fragmentDir),
        fix = `Run \`xh-changelog release ${version}\`, review the result and commit it.`;

    if (!findRelease(ctx.changelog, version)) {
        report.add('CHANGELOG.md', {
            level: 'error',
            message: `CHANGELOG.md has no release ${version}. ${fix}`
        });
    }
    if (files.length) {
        report.add(null, {
            level: 'error',
            message:
                `${count(files, 'fragment')} still in ${FRAGMENT_DIR}/ ` +
                `(${files.join(', ')}), so ${version} would ship without ` +
                `${files.length === 1 ? 'its' : 'their'} entries. ${fix}`
        });
    }

    report.print();
    if (!report.errors) out.log(`CHANGELOG.md is ready for ${version}.`);
    return report.errors ? 1 : 0;
}

function cmdPreview(ctx, args, out) {
    let only = null;
    if (args.base) {
        const changed = gitChangedFiles(ctx.root, args.base);
        if (changed == null) throw new Error(`Could not diff against ${args.base}.`);
        const prefix = fragmentPrefix(ctx);
        only = branchFragments(changed, prefix).map(c => c.file.slice(prefix.length));
        if (!only.length) {
            out.log('This branch adds no changelog entries.');
            return 0;
        }
    }

    const {markdown, count} = assemble(ctx, out, {strict: false, only});
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
    const version = args.version ?? packageVersion(out.cwd) ?? 'Unreleased',
        {text} = changelogWithUnreleased(ctx.root, {version});
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
        changelogText = legacy.text;
        if (legacy.fragment) {
            out.warn(`Including entries found under "${ctx.changelog.releases[0].title}".`);
            extra.push({name: 'CHANGELOG.md (unreleased)', text: legacy.fragment});
        }
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
        const inferred = inferConfig(ctx.changelog, ctx.changelogText),
            config = {
                sections: inferred.sections,
                headingFormat: inferred.headingFormat,
                ...(inferred.maxLineLength ? {maxLineLength: inferred.maxLineLength} : {})
            };
        fs.writeFileSync(ctx.configPath, JSON.stringify(config, null, 4) + '\n');
        out.log(`Created ${rel(ctx, ctx.configPath)} - check the section list and order.`);
    }

    const pkg = findPackage(out.cwd, ctx.root),
        scriptAdded = pkg && addPackageScript(pkg);
    if (scriptAdded) {
        out.log(`Added a "changelog" script to ${rel(ctx, pkg.file)}.`);
    }

    const readme = path.join(ctx.fragmentDir, 'README.md');
    if (!fs.existsSync(readme)) {
        // Read the config again: this run may have just created it.
        const {sections} = loadChangelogContext(ctx.root).config;
        fs.writeFileSync(
            readme,
            readmeText(sections, {
                cmd: runCommand(pkg),
                runFrom: pkg && path.relative(ctx.root, path.dirname(pkg.file)),
                conventions: conventionsLink(ctx.root)
            })
        );
        out.log(`Created ${rel(ctx, readme)}.`);
    }

    const legacy = extractUnreleased(ctx.changelogText);
    if (legacy?.fragment) {
        const file = path.join(ctx.fragmentDir, 'unreleased.md');
        fs.writeFileSync(file, legacy.fragment);
        fs.writeFileSync(ctx.changelogPath, legacy.text);
        out.log(`Moved the unreleased entries in CHANGELOG.md to ${rel(ctx, file)}.`);
    }

    if (!args['no-ci']) initWorkflow(ctx, out);

    out.log(
        [
            '',
            'Next steps:',
            `  1. Check the sections in ${rel(ctx, ctx.configPath)}.`,
            `  2. Point CLAUDE.md, contributor docs and the pull request template at ${FRAGMENT_DIR}/.`,
            `  3. Add an entry: \`${runCommand(pkg)} add <section> "<text>"\`.`
        ].join('\n')
    );
    return 0;
}

// Add a workflow that runs the shared check on pull requests, where the repo uses GitHub Actions.
function initWorkflow(ctx, out) {
    const repoRoot = gitRoot(ctx.root) ?? ctx.root,
        dir = path.join(repoRoot, '.github', 'workflows');
    if (!fs.existsSync(dir)) return;

    const inUse = fs
        .readdirSync(dir)
        .filter(f => /\.ya?ml$/.test(f))
        .some(f => fs.readFileSync(path.join(dir, f), 'utf8').includes('check-changelog'));
    if (inUse) return;

    const file = path.join(dir, 'changelog.yml'),
        workingDir = path.relative(repoRoot, ctx.root);
    if (fs.existsSync(file)) return;
    fs.writeFileSync(file, workflowText(workingDir));
    out.log(`Created ${path.relative(ctx.root, file)}, which checks fragments on pull requests.`);
}

//------------------------
// Implementation
//------------------------
function assemble(ctx, out, {strict, extra = [], only = null}) {
    const result = assembleFragments(ctx, {extra, only}),
        report = new Report(ctx, out);
    result.problems.forEach(({file, ...p}) => report.add(file, p));
    report.print();
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
        // An argument with a space is entry text, even if it starts with dashes.
        if (arg.startsWith('--') && !/\s/.test(arg)) {
            const [key, inline] = arg.slice(2).split('=', 2);
            const takesValue = ['base', 'date', 'version', 'name', 'release'].includes(key);
            args[key] = inline ?? (takesValue ? argv[++i] : true);
        } else {
            args._.push(arg);
        }
    }
    return args;
}

// Path of `changelog.d/` from the git root, as `git diff` reports it, with a trailing slash.
function fragmentPrefix(ctx) {
    return path.relative(gitRoot(ctx.root) ?? ctx.root, ctx.fragmentDir) + '/';
}

// The fragments a branch added or changed, from its `git diff` file list.
function branchFragments(changed, prefix) {
    return changed.filter(
        c =>
            c.file.startsWith(prefix) &&
            c.status !== 'D' &&
            !c.file.slice(prefix.length).includes('/') &&
            isFragmentName(c.file.slice(prefix.length))
    );
}

/**
 * Find fragment entries that a release in CHANGELOG.md already holds. This happens when a hotfix
 * release merges back to a branch that still has the fragment: the next release would list the
 * entry twice.
 */
function findReleasedEntries(ctx, files) {
    const key = text => text.replace(/\s+/g, ' ').trim(),
        released = new Map();
    ctx.changelog.releases
        .filter(r => !r.unreleased)
        .forEach(r =>
            r.sections.forEach(s =>
                s.blocks
                    .filter(b => b.type === 'entry')
                    .forEach(b => released.has(key(b.text)) || released.set(key(b.text), r.title))
            )
        );

    const found = [];
    files.forEach(name => {
        const text = fs.readFileSync(path.join(ctx.fragmentDir, name), 'utf8');
        parseFragment(text).sections.forEach(s =>
            s.blocks
                .filter(b => b.type === 'entry' && released.has(key(b.text)))
                .forEach(b =>
                    found.push({
                        file: path.join(FRAGMENT_DIR, name),
                        line: b.line,
                        level: 'warning',
                        message:
                            `Release "${released.get(key(b.text))}" already has this entry. ` +
                            `Delete it here, or the next release lists it twice.`
                    })
                )
        );
    });
    return found;
}

// Wrap one bullet at `width`, indenting continuation lines to line up under its text.
function wrapEntry(entry, width) {
    if (!width) return entry;
    const lines = [];
    let line = '';
    entry.split(' ').forEach(word => {
        if (line && line.length + 1 + word.length > width) {
            lines.push(line);
            line = '  ' + word;
        } else {
            line = line ? `${line} ${word}` : word;
        }
    });
    return [...lines, line].join('\n');
}

/**
 * Add a bullet to fragment text, under its section. The bullet goes after the section's last
 * content. A section the fragment lacks is added at the end.
 */
function insertEntry(text, title, entry) {
    const eol = text.includes('\r\n') ? '\r\n' : '\n',
        lines = text ? text.replace(/\r\n?/g, '\n').split('\n') : [],
        {sections} = parseFragment(text),
        idx = sections.findIndex(s =>
            title == null ? s.title == null : s.title != null && sameSection(s.title, title)
        ),
        trimEnd = end => {
            while (end > 0 && lines[end - 1].trim() === '') end--;
            return end;
        };

    if (idx >= 0) {
        // Section lines are 1-based, so the next section's line is this one's exclusive end.
        const end = trimEnd(idx + 1 < sections.length ? sections[idx + 1].line - 1 : lines.length),
            section = sections[idx],
            afterHeading = section.title != null && !section.blocks.length;
        lines.splice(end, 0, ...(afterHeading ? ['', entry] : [entry]));
        if (lines.at(-1) !== '') lines.push('');
    } else {
        const end = trimEnd(lines.length);
        lines.length = end;
        lines.push(...(end ? [''] : []), ...(title ? [`### ${title}`, ''] : []), entry, '');
    }
    return lines.join(eol);
}

// `1 fragment`, `2 fragments`.
function count(items, noun) {
    return `${items.length} ${noun}${items.length === 1 ? '' : 's'}`;
}

function sanitizeName(name) {
    return name
        ?.trim()
        .replace(/\.md$/, '')
        .replace(/[^A-Za-z0-9._-]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

/**
 * The package.json that the team runs scripts from: the nearest one at or above `dir`, no higher
 * than the changelog's own folder. Null for a repo without one, such as a Gradle library.
 */
function findPackage(dir, root) {
    for (let d = path.resolve(dir); ; d = path.dirname(d)) {
        const file = path.join(d, 'package.json');
        if (fs.existsSync(file)) {
            // The script only works where the package installs this tool.
            const json = JSON.parse(fs.readFileSync(file, 'utf8')),
                name = '@xh/hoist-dev-utils',
                installed =
                    json.name === name || json.dependencies?.[name] || json.devDependencies?.[name];
            if (!installed) return null;
            const manager = fs.existsSync(path.join(d, 'pnpm-lock.yaml'))
                ? 'pnpm'
                : fs.existsSync(path.join(d, 'yarn.lock'))
                  ? 'yarn'
                  : 'npm run';
            return {file, manager};
        }
        if (d === root || path.dirname(d) === d) return null;
    }
}

// Add `"changelog": "xh-changelog"` to a package.json's scripts, keeping its indentation.
function addPackageScript({file}) {
    const text = fs.readFileSync(file, 'utf8'),
        json = JSON.parse(text);
    if (json.scripts?.changelog) return false;
    json.scripts = {...json.scripts, changelog: 'xh-changelog'};
    const indent = /^([ \t]+)"/m.exec(text)?.[1] ?? '  ';
    fs.writeFileSync(file, JSON.stringify(json, null, indent) + (text.endsWith('\n') ? '\n' : ''));
    return true;
}

// A markdown pointer, from changelog.d/, to where the repo documents how to write an entry.
function conventionsLink(root) {
    if (fs.existsSync(path.join(root, 'docs', 'changelog-format.md'))) {
        return '[`docs/changelog-format.md`](../docs/changelog-format.md)';
    }
    const claudeMd = path.join(root, 'CLAUDE.md');
    if (fs.existsSync(claudeMd) && /^#+ Changelog\b/m.test(fs.readFileSync(claudeMd, 'utf8'))) {
        return 'the "Changelog" section of [`CLAUDE.md`](../CLAUDE.md)';
    }
    return null;
}

// How the team runs the tool: through the package script where there is one.
function runCommand(pkg) {
    return pkg ? `${pkg.manager} changelog` : 'xh-changelog';
}

// Version from the nearest package.json at or above `dir`, or null.
function packageVersion(dir) {
    for (let d = path.resolve(dir); ; d = path.dirname(d)) {
        const file = path.join(d, 'package.json');
        if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8')).version ?? null;
        if (path.dirname(d) === d) return null;
    }
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

// The README that `init` writes, with an example built from the repo's own sections.
function readmeText(sections = [], {cmd = 'xh-changelog', runFrom, conventions} = {}) {
    const pick = (re, fallback) => sections.find(s => re.test(s)) ?? fallback,
        feature = pick(/feature/i, sections[0] ?? 'New Features'),
        fix = pick(/fix/i, sections[1] ?? 'Bug Fixes'),
        hasEmoji = sections.some(s => /\p{Extended_Pictographic}/u.test(s)),
        hasFix = sections.some(s => /fix/i.test(s)),
        example = hasFix
            ? `${shortName(fix)} "Fixed a crash when the widget had no data."`
            : `${shortName(feature)} "Added a widget that does a thing."`;
    return `# Changelog fragments

Each pull request adds its changelog entries here, in a new markdown file, instead of editing
\`CHANGELOG.md\`. A release assembles every fragment into \`CHANGELOG.md\` under the real version
number, then deletes them.

This means that pull requests never conflict over \`CHANGELOG.md\`, and an entry can never land
under a version that has already shipped.
${conventions ? `\nEntry conventions are in ${conventions}.\n` : ''}
## Add an entry

For a one-line entry, run \`${cmd} add\`. It names the file for your branch and finds the
section from a short name:

\`\`\`bash
${cmd} add ${example}
\`\`\`

For more than that, run \`${cmd} new\` to create \`changelog.d/<branch>.md\`, or create the
file yourself. Write it as you would write the entries in \`CHANGELOG.md\`, with the same \`###\`
section headings and bullets, but with no version heading:

\`\`\`markdown
### ${feature}

* Added a widget that does a thing.

### ${fix}

* Fixed a crash when the widget had no data.
\`\`\`

- Use only the sections listed in \`changelog.d/config.json\`.${
        hasEmoji
            ? ` You can leave the emoji off a
  heading. The release adds it.`
            : ''
    }
- Bullets can wrap and can hold sub-bullets.
- To change an entry before release, edit its fragment. After release, edit \`CHANGELOG.md\`.
- Release-level notes, such as an upgrade difficulty or topic groups, are added when the release
  is curated. Leave them out of fragments.

## Commands

${
    cmd === 'xh-changelog'
        ? ''
        : `\`${cmd}\` runs \`xh-changelog\`, from \`@xh/hoist-dev-utils\`.${
              runFrom ? ` Run it from \`${runFrom}/\`.` : ''
          }\n\n`
}- \`${cmd} add <section> "<text>"\` - add one entry to your branch's fragment.
- \`${cmd} new\` - create an empty fragment for your branch.
- \`${cmd} check\` - validate the fragments. CI runs this on each pull request.
- \`${cmd} preview\` - print the next release as it will be assembled.
- \`${cmd} release <version>\` - assemble the release into \`CHANGELOG.md\` and delete the
  fragments. Review and curate the result, then commit.
`;
}

// A short name that \`add\` resolves to a section, such as \`fix\` for \`🐞 Bug Fixes\`.
function shortName(section) {
    const word = section
        .replace(/[^A-Za-z ]/g, '')
        .trim()
        .split(/\s+/)
        .pop()
        .toLowerCase();
    return word.replace(/(?<=[sx]|ch|sh)es$|s$/, '') || 'fix';
}

function workflowText(workingDir) {
    const withDir = workingDir
        ? `
              with:
                  working-directory: ${workingDir}`
        : '';
    return `# Validates the changelog fragments a pull request adds. See ${path.join(workingDir, FRAGMENT_DIR)}/README.md.
name: Changelog

on:
    pull_request:
        types: [opened, synchronize, reopened, labeled, unlabeled]

permissions:
    contents: read

jobs:
    check:
        runs-on: ubuntu-latest
        steps:
            - uses: actions/checkout@v6
              with:
                  fetch-depth: 0
            - uses: xh/hoist-dev-utils/.github/actions/check-changelog@master${withDir}
`;
}

module.exports = {run, USAGE};
