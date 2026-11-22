# Shared GitHub Actions & Workflows

This directory contains reusable [composite actions](https://docs.github.com/en/actions/sharing-automations/creating-actions/creating-a-composite-action)
and CI/CD workflows for the Hoist framework ecosystem. Because this is a public repository, these
actions can be referenced by any GitHub repository. They are used by Hoist ecosystem projects —
including hoist-dev-utils itself, hoist-react, and hoist-core — to standardize release and snapshot
deployment processes. Changes to these actions are documented in the root `CHANGELOG.md` and
reflected in semantic versioning.

## Reusable Composite Actions

Reference these from any workflow, including from Hoist application builds, if public Github.com actions are 
accessible and suitable for your project:

```yaml
uses: xh/hoist-dev-utils/.github/actions/<action-name>@master
```

### `validate-release-version`

Validates that a proposed release version is well-formed semver and a strict single increment
(major, minor, or patch) from the latest existing tag. Supports hotfix releases to older version
lines. A repo with no release tags yet is treated as being at `v0.0.0`, so its first release must be
`1.0.0`, `0.1.0` or `0.0.1`. A first release cannot be a hotfix.

| Input | Required | Description |
|---|---|---|
| `version` | Yes | Release version to validate (e.g. `12.0.0`) |
| `is-hotfix` | No | Set to `true` for hotfix releases to older version lines |

**Prerequisites:**
- The calling workflow must check out with `fetch-depth: 0` and `fetch-tags: true`
  so that all git tags are available for comparison.
- Release tags must follow the `v{X.Y.Z}` convention (e.g. `v12.0.0`). Tags that do not match
  this pattern are ignored.

### `prepare-npm-snapshot-version`

Prepares a `-SNAPSHOT` version string and writes it to `package.json`. Optionally appends a
millisecond timestamp for uniqueness (enabled by default), producing versions like
`12.0.0-SNAPSHOT.1711814400000`.

| Input | Required | Description |
|---|---|---|
| `version` | No | Override version (read from `package.json` if omitted) |
| `append-timestamp` | No | Append millisecond timestamp (default: `true`) |

| Output | Description |
|---|---|
| `snapshot-version` | The resolved snapshot version string |

### `prepare-gradle-snapshot-version`

Prepares a `-SNAPSHOT` version string and writes it to `gradle.properties`. Designed for Java/Grails
projects like hoist-core. Timestamp appending defaults to `false` for Maven Central compatibility.

| Input | Required | Description |
|---|---|---|
| `version` | No | Override version (read from `gradle.properties` if omitted) |
| `version-prop` | Yes | Property name in `gradle.properties` (e.g. `xhReleaseVersion`) |
| `append-timestamp` | No | Append millisecond timestamp (default: `false`) |

| Output | Description |
|---|---|
| `snapshot-version` | The resolved snapshot version string |

### `create-tag-and-github-release`

Creates a git tag (`v{version}`), pushes it, and creates a GitHub Release with auto-generated
release notes scoped to the previous semver tag. A first release gets notes for the full history.

| Input | Required | Description |
|---|---|---|
| `version` | Yes | Release version (e.g. `12.0.0`) |
| `is-hotfix` | No | Set to `true` to mark the release as non-latest |

**Prerequisites:**
- The calling workflow must check out with `fetch-depth: 0` and `fetch-tags: true`.
- Release tags must follow the `v{X.Y.Z}` convention (e.g. `v12.0.0`). This action both creates
  and expects tags in this format.
- The `GH_TOKEN` environment variable must be set (typically `${{ secrets.GITHUB_TOKEN }}`).

### `check-changelog`

Validates the changelog fragments in `changelog.d/` on a pull request. It runs `xh-changelog check`
from this repository with plain Node and no install, so it works for npm projects, Hoist apps and
Gradle projects alike. See [Changelog fragments](../README.md#changelog-fragments).

The check fails on a malformed fragment and on entries written straight into `CHANGELOG.md`. It
warns, or fails with `require`, when the pull request adds or edits no fragment. A pull request with
the `skip-label` label skips that last check.

The job summary shows the entries that the pull request adds, as the release will show them. A
reviewer can read them there without opening the fragment file.

| Input | Required | Description |
|---|---|---|
| `base` | No | Ref to diff against (default: the pull request base) |
| `require` | No | Fail, not warn, when no fragment is added (default: `false`) |
| `skip-label` | No | Label that marks a pull request as needing no entry (default: `no-changelog`) |
| `release` | No | Version being published. Set it in a release build. See below |
| `working-directory` | No | Where to run. The check uses the nearest `CHANGELOG.md` at or above it (default: `.`) |

**Prerequisites:**
- The calling workflow must check out with `fetch-depth: 0`, so the base commit is present.
- To re-run when a label changes, trigger on `labeled` and `unlabeled` too:

```yaml
on:
    pull_request:
        types: [opened, synchronize, reopened, labeled, unlabeled]
jobs:
    check:
        runs-on: ubuntu-latest
        steps:
            - uses: actions/checkout@v6
              with:
                  fetch-depth: 0
            - uses: xh/hoist-dev-utils/.github/actions/check-changelog@master
```

**In a release build**, pass the version as `release`. The action then fails unless
`CHANGELOG.md` holds that version and `changelog.d/` has no fragments left. This stops a release
that someone started before running `xh-changelog release`. It needs no `fetch-depth`.

```yaml
- uses: xh/hoist-dev-utils/.github/actions/check-changelog@master
  with:
      release: ${{ inputs.version }}
```

## Supporting Scripts

The `scripts/` directory contains shell scripts used internally by the composite actions:

- **`validate-release-version.sh`** — Core validation logic for release versions.
- **`find-latest-version.sh`** — Finds the latest semver tag or the latest tag before a given
  version.

## Tests

The `test/` directory contains unit tests for the scripts, run by `unitTestActions.yml` on PRs.

## Workflows

The `workflows/` directory contains workflows for hoist-dev-utils' *own* CI/CD:

- **`deployRelease.yml`** — Manually triggered workflow to publish numbered releases to npm.
  Uses `validate-release-version` and `create-tag-and-github-release` actions.
- **`deploySnapshot.yml`** — Publishes a SNAPSHOT build to npm (tagged `next`) on every push to
  `develop`. Uses `prepare-npm-snapshot-version`.
- **`unitTestActions.yml`** — Runs unit tests for the shared actions and scripts on PRs that
  modify files under `.github/`.
- **`changelog.yml`** - Runs `check-changelog` on every pull request.

These workflows also serve as reference examples for how to integrate the shared actions, but are themselves dedicated 
to actually building and releasing this library itself.

## Usage Example

A typical release workflow in a consuming repo:

```yaml
name: Deploy Release
on:
  workflow_dispatch:
    inputs:
      version:
        description: Release version (e.g. 12.0.0)
        required: true
        type: string
      is-hotfix:
        description: Hotfix to an older version line?
        required: true
        type: boolean
        default: false

concurrency:
  group: deploy-release
  cancel-in-progress: false

jobs:
  release:
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v6
        with:
          fetch-depth: 0
          fetch-tags: true

      - uses: xh/hoist-dev-utils/.github/actions/validate-release-version@master
        with:
          version: ${{ inputs.version }}
          is-hotfix: ${{ inputs.is-hotfix }}

      # ... build and publish steps ...

      - uses: xh/hoist-dev-utils/.github/actions/create-tag-and-github-release@master
        with:
          version: ${{ inputs.version }}
          is-hotfix: ${{ inputs.is-hotfix }}
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```
