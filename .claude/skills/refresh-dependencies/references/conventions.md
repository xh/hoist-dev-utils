# CHANGELOG conventions for dependency refreshes

Reference for the `refresh-dependencies` skill. These are the exact formats used across the repo's
dependency-update history. Read this when writing the CHANGELOG section.

## Where the entry goes: the SNAPSHOT heading

`CHANGELOG.md` is ordered newest-first. The **topmost** entry covers unreleased work and uses the
in-development `SNAPSHOT` version as its heading, **with no date**:

```markdown
## v13.0.0-SNAPSHOT
```

At release time that heading is later rewritten to the final version with a date (e.g.
`## v13.0.0 - 2026-06-15`) — but that's the release process, not this skill.

Two cases when you start a refresh:

1. **A SNAPSHOT entry already exists at the top** (heading ends in `-SNAPSHOT`, no date). Append
   your `📚 Libraries` lines to it (merging with any already present).

2. **The top entry is a dated, already-released version.** No SNAPSHOT entry exists yet — you're the
   first unreleased change. Create one above it, taking the version from `package.json`'s `version`
   field. Example: `package.json` says `"version": "13.0.0-SNAPSHOT"`, so add:

   ```markdown
   ## v13.0.0-SNAPSHOT

   ### 📚 Libraries

   * ...
   ```

Note on the heading prefix: most entries use a `v` prefix (`## v12.1.1 - ...`). A few recent ones
omit it (`## 12.2.0 - ...`). Prefer `v` for new SNAPSHOT headings to match the dominant style, but
matching the immediately-preceding entry's style is also fine.

## The `📚 Libraries` section

Heading is exactly:

```markdown
### 📚 Libraries
```

### Version-change lines

List **only direct dependencies whose `package.json` semver spec changed in a way that crosses a
MAJOR or MINOR boundary** — because the CHANGELOG documents what this release newly allows/requires
for apps, not what a `yarn upgrade` happens to resolve. A `^`/`X.x` dep drifting to a new minor
*within an unchanged spec* is **not** listed; a deliberate spec edit (tilde minor bump, caret/`.x`
floor raise, major) **is**. Skip patch-floor edits. Render each spec to `major.minor` (strip the
range operator and the patch; `~5.106.2 → 5.106`, `^7.28.5 → 7.28`, `4.x → 4.x`). Alphabetize.

```markdown
* autoprefixer `10.4 → 10.5`
* sass-embedded `1.98 → 1.99`
* webpack `5.105 → 5.106`
* webpack-bundle-analyzer `5.2 → 5.3`
* webpack-cli `6.0 → 7.0`
```

The `spec-diff.mjs` helper emits these lines ready to paste, applying exactly this spec-vs-drift
rule for you.

### Added / removed deps

```markdown
* type-fest `added @ 4.0`
* html-webpack-tags-plugin `3.0 → removed`
```

(History also shows the bare form `` `* some-pkg `removed` ``; either reads fine.)

### Spec-widening with a reason

When a change is worth a word of explanation — e.g. loosening a pin to allow future security
patches — keep a short parenthetical, as in v12.0.1:

```markdown
* lodash `4.17 → 4.x (allows update to 4.18 w/security fixes and future)`
```

### Prose context before the list

When a swap needs framing, prose can precede the bullet list (e.g. the v12.1.1 entry explaining why
`html-webpack-tags-plugin` was removed sat in the `⚙️ Technical` section, with the `📚 Libraries`
list below it). Don't force prose where a plain list says enough.

## `💥 Breaking Changes` for majors

A major bump that requires consuming apps to change anything also gets a `### 💥 Breaking Changes`
note in the same SNAPSHOT entry — placed **above** `📚 Libraries`. Include the required framework
floors.

```markdown
### 💥 Breaking Changes

* Requires `hoist-react >= 83.0.2`.
* Upgrade from `@xh/eslint-config` v6.0 to v7.0 requires changes to apps' `eslint` configurations:
  rename `.eslintrc` to `eslint.config.js` ...
```

A Node-floor change introduced by a major (e.g. `copy-webpack-plugin 14` / `webpack-cli 7` needing
Node 20.9+) belongs here too if apps must act on it. If the major is purely internal to the build
with no app-facing impact, the `📚 Libraries` line alone is enough.

## Section ordering within an entry

When multiple sections appear under one version heading, the established order is:

1. `### 💥 Breaking Changes`
2. `### 🎁 New Features`
3. `### ⚙️ Technical`
4. `### 🐞 Bug Fixes`
5. `### 📚 Libraries`

A pure dependency refresh usually only touches `📚 Libraries` (and `💥 Breaking Changes` if a major
lands).
