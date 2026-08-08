---
name: refresh-dependencies
description: >-
  Refresh the npm dependencies of @xh/hoist-dev-utils — bumping package.json semver specs,
  revving pnpm-lock.yaml, and documenting the changes in CHANGELOG.md following project convention.
  Use this whenever the user wants to update, refresh, upgrade, or bump dependencies / libraries
  in this repo, run `pnpm update`, pull in newer minor/major versions, or prepare a batch of
  dependency updates ahead of a release — even if they don't name this skill explicitly. This is
  a recurring maintenance task; reach for the skill rather than improvising the steps.
---

# Refresh dependencies

This skill captures how we periodically refresh the dependencies of `@xh/hoist-dev-utils` and get
the batch ready to release to apps. The goal: pull in newer library versions safely, rev the
lockfile, and record in `CHANGELOG.md` exactly what the new release changes for consuming apps —
following the conventions we've used across dozens of past dep-update commits.

The skill **stops before committing**. It leaves a clean, reviewed working tree plus a proposed
commit message so the user can eyeball the diff and commit on their own cadence. Releasing the
package to npm is a separate process — not part of this skill.

## What the CHANGELOG documents — and what it doesn't

This is the most important idea in the skill, so internalize it before touching anything.

The CHANGELOG audience is an **app developer taking a new `hoist-dev-utils` release**. It answers
one question: *"what does this release change for me?"* The answer is exactly the set of
**`package.json` semver specs we newly allow or require** — because that, and only that, is what a
new release of this package actually changes for a consuming app.

That means there are two mechanically-similar operations that are documented **completely
differently**:

1. **Lockfile-only refresh** (`pnpm update`): pulls the newest versions allowed *within the
   existing specs*. For `~X.Y.Z` specs that's patch bumps; for `^` and `X.x` specs it can also pull
   new minors. This touches **only `pnpm-lock.yaml`**. It is **NOT changelogged** — even when a `^`/`X.x`
   dep crosses a minor — because we didn't change what the package allows. An app running its own
   `pnpm update` would get the same thing; our release isn't what delivers it.

2. **Spec change** (edit `package.json`): raise a tilde minor (`~5.4.0 → ~5.5.0`), raise a caret/`.x`
   floor (`^7.28.5 → ^7.29.7`, `4.17 → 4.x`), or take a major (`~6.0.1 → ~7.0.0`). This changes what
   the release allows or requires, so it **IS changelogged** under `### 📚 Libraries`.

A full refresh usually does both: `pnpm update` to sweep in-range updates into the lock, *and*
selected spec edits to reach across minor/major boundaries. **Only the spec edits hit the
CHANGELOG**, and only when they cross a minor or major (patch-floor edits don't count).

The `spec-diff.mjs` helper enforces exactly this rule, so you don't have to reason about it
by hand — see steps 5 and 6.

## Procedure

Work from the repo root: `/Users/amcclain/dev/hoist-dev-utils`. Track these as todos.

### 1. Pre-flight

- Confirm a clean working tree (`git status`) and that you're on `develop` (`git branch --show-current`).
  If `package.json`, `pnpm-lock.yaml`, or `CHANGELOG.md` already has uncommitted changes, stop and ask —
  don't fold unrelated changes into a dep refresh. (Untracked files *outside* those three — e.g. a
  not-yet-committed copy of this skill under `.claude/skills/` — are fine to ignore.) The clean
  state of those three files matters because the changelog differ uses the committed `package.json`
  (`HEAD`) as its before-baseline.
- This repo uses **pnpm** (version pinned via the `packageManager` field in `package.json`).
  Never run `npm install` or `yarn install`, or create a `package-lock.json` or `yarn.lock`.
  `pnpm-lock.yaml` is the source of truth. If pnpm is not on the PATH, run it through corepack
  (`corepack pnpm <cmd>`).

### 2. See what's available

```bash
pnpm outdated              # everything with a newer release (Current vs Latest)
pnpm outdated --compatible # only updates already allowed by the current specs
```

Use the two views to plan:
- Listed under `--compatible` → an in-range update `pnpm update` will pick up. Not changelogged.
- Listed only in the full view → a newer minor/major sits outside the current spec; reaching it
  requires a spec edit in `package.json` — and that part *is* changelogged.

### 3. Apply in-range updates

```bash
pnpm update
```

Revs `pnpm-lock.yaml` to the newest version each existing spec allows. No `package.json` change,
and — per the principle above — **nothing here goes in the CHANGELOG**.

### 4. Edit specs to reach newer minors/majors

Decide which out-of-range updates to take, then edit `package.json` specs **preserving the spec
style of each entry** (see conventions below). After editing, run `pnpm install` to rev the lock.

- **Minor bumps**: apply freely. For a `~` dep, raise the minor and reset patch to 0
  (`~5.4.0 → ~5.5.0`). For a `^`/`X.x` dep, raising the floor to require a newer minor is a
  deliberate choice — do it when you want apps to get at least that version; otherwise the minor
  already flows through `pnpm update` without a spec change (and stays out of the CHANGELOG).
- **Major bumps**: do **not** apply blind — but do **not** silently defer them either. For each
  available major, research it, then **put the decision to the user explicitly** (an
  `AskUserQuestion` with a clear take-it / hold recommendation) and wait for their answer. Deciding
  on their behalf — applying *or* skipping without asking — is the main failure mode this step
  guards against. A major is exactly the kind of judgment call the user wants to make.

  Research each major against **our actual usage**, not just its changelog in the abstract — a
  "breaking" change is irrelevant if we don't touch the affected API. Gather:
  - its breaking-change notes (release notes / CHANGELOG — use Context7 or WebFetch);
  - whether anything in `configureWebpack.js` actually relies on what changed (grep the loader/plugin
    config — e.g. sass-loader 17 dropped the legacy Sass API, but we pass no options, so it's moot);
  - any new **Node** floor it introduces (`npm view <pkg>@<version> engines.node`, read-only) and
    whether that exceeds our current floor;
  - any **hoist-react** implication (e.g. `@types/react` is runtime-coupled to React's major and must
    move in lockstep with hoist-react, not ahead of it).

  Present that synthesis in the question so the user is deciding on facts, not vibes. (History:
  `copy-webpack-plugin 14` and `webpack-cli 7` raised the Node floor to 20.9+ and were called out;
  `sass-loader 17` raised it to 22.11.)

- **Node floor**: if an approved bump raises the minimum Node version, update the `engines.node`
  field in `package.json` to the new floor and note it in the CHANGELOG (`⚙️ Technical`). Whether
  that floor is *also* a `💥 Breaking Changes` item is a judgment call — if every app on this
  dev-utils release is already expected to be at/above the floor (the repos track `lts/*`), it's just
  documentation, not a break. Confirm with the user rather than assuming.

After spec edits:

```bash
pnpm install
```

### 5. Verify the install is healthy

- The install must complete with no resolution errors or peer-dependency failures that weren't
  there before.
- `git diff pnpm-lock.yaml` should look like version bumps, not duplicate-package explosions. A full
  refresh produces large line churn (the `pnpm update` sweep rewrites many version strings) — that
  alone is normal. A useful sanity check is the count of locked packages before vs after
  (`grep -c 'resolution:' pnpm-lock.yaml` vs the same on `git show HEAD:pnpm-lock.yaml`); it
  should hold roughly steady, not balloon.
- To confirm a specific dep resolved as expected, read its installed manifest directly —
  `node -p "require('./node_modules/<pkg>/package.json').version"` works for most, but packages that
  restrict `exports` (e.g. `sass-embedded`) will throw `ERR_PACKAGE_PATH_NOT_EXPORTED`. Read the file
  directly instead (`grep -m1 '"version"' node_modules/<pkg>/package.json`), which always works.
- There is **no build or test suite** in this repo. For higher confidence on a risky bump
  (especially a major), `pnpm link` this package into a consuming app like Toolbox and run that
  app's build — but this is optional and usually reserved for majors.

### 6. Compute the CHANGELOG diff

The differ compares the committed `package.json` (`HEAD`) against your edited working copy, so it
reports **only your spec changes** — never lockfile drift:

```bash
node .claude/skills/refresh-dependencies/scripts/spec-diff.mjs
```

It prints three groups:
- **CHANGELOG entries** — spec changes that crossed a minor/major, pre-formatted as
  `` `* pkg `old → new` `` (plus `added`/`removed`), alphabetized. Copy these into the CHANGELOG.
- **MAJOR spec bumps** — the subset that crossed a major; each needs breaking-change review and
  likely a `💥 Breaking Changes` note.
- **Spec edits below minor granularity** — e.g. a patch-floor bump; informational, **not** changelogged.

If this prints "no spec changes", then the refresh was lockfile-only and there is **nothing to add
to the CHANGELOG** — skip to step 8 and propose a `` Run `pnpm update` `` commit.

### 7. Update CHANGELOG.md

Edits go under the **topmost** entry, which must be the unreleased `SNAPSHOT` heading.

- If the top entry is already a `## vX.Y.Z-SNAPSHOT` heading (no date), append to it.
- If the top entry is a **dated** (already-released) version, the SNAPSHOT entry doesn't exist yet —
  create it above that entry, using the version from `package.json` (e.g. `## v13.0.0-SNAPSHOT`).

Within the SNAPSHOT entry:
- Add a `### 📚 Libraries` section (or extend the existing one) with the lines from step 6. Keep the
  list alphabetized and merge with any lines already there.
- For each approved **major** bump that requires app-level changes, add a `### 💥 Breaking Changes`
  note — including the required `hoist-react >=` version and/or Node floor when relevant.
- If a spec was *widened* for a reason worth recording (e.g. `lodash 4.17 → 4.x` to allow future
  security patches), keep the short parenthetical explanation, matching past entries.

See `references/conventions.md` for the exact CHANGELOG formats and worked examples.

### 8. Format and present

```bash
pnpm prettier --check .
```

Fix anything it flags with `pnpm prettier --write .`. Then show the user:
- The `package.json` diff and a summary of the `pnpm-lock.yaml` churn.
- The new CHANGELOG section (or a note that the refresh was lockfile-only).
- Any majors deferred or applied, with their breaking-change implications.
- A **proposed commit message** following the conventions below.

Then stop. Let the user review and commit.

## Semver spec conventions

When editing `package.json`, match the existing style of each dependency — don't homogenize them.

| Style | Example | Used for | `pnpm update` pulls (NOT changelogged) |
|-------|---------|----------|------------------------------------------|
| `~X.Y.Z` (tilde) | `webpack: ~5.106.2` | most build deps / webpack plugins | patches only |
| `^X.Y.Z` (caret) | `@babel/core: ^7.28.5`, `@xh/eslint-config: ^7.0` | Babel packages, eslint-config | minors + patches |
| `X.x` | `lodash: 4.x`, `type-fest: 5.x`, `@types/react: 18.x`, `prettier: 3.x` | libs we track loosely within a major | minors + patches |

Implications for what reaches the CHANGELOG:
- A `~` dep needs a **spec edit** to take a new minor — and that edit is changelogged.
- A `^`/`X.x` dep takes new minors silently via `pnpm update`; that's **not** changelogged. Only a
  deliberate **floor raise** (`^7.28.5 → ^7.29.7`) or **major widen** (`4.x → 5.x`) is a spec change
  worth documenting.
- To take a **major** on any style, raise the major in the spec and review breaking changes first.

## Commit message conventions

Past commits, smallest to largest scope:
- `` Run `pnpm update` `` — lockfile-only, no spec changes, no CHANGELOG change.
- `Minor dependency update` / `Minor dependency updates` — minor spec bumps, with a short body
  listing them and a `` - Run `pnpm update` `` line when applicable.
- `Update dependencies to latest minor/major versions` — larger batch; body groups `Minor:` and
  `Major:` deps and notes any Node-floor changes.

Keep the body terse and factual. Per repo settings, **do not** add Claude/AI co-author attribution.

## References

- `references/conventions.md` — CHANGELOG `📚 Libraries` / `💥 Breaking Changes` formats with
  worked examples, and the SNAPSHOT-heading rules in detail.
- `scripts/spec-diff.mjs` — the spec differ used in step 6. Compares `HEAD:package.json` to the
  working copy (or two explicit files) and emits CHANGELOG-ready lines.
