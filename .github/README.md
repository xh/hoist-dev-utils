# Shared GitHub Actions & Workflows

This directory contains reusable [composite actions](https://docs.github.com/en/actions/sharing-automations/creating-actions/creating-a-composite-action)
and CI/CD workflows for the Hoist framework ecosystem. Because this is a public repository, these
actions can be referenced by any GitHub repository. They are used by Hoist ecosystem projects -
including hoist-dev-utils itself, hoist-react, and hoist-core - to standardize release and snapshot
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

Creates a git tag (`v{version}`), pushes it, and creates a GitHub Release.

The release leads with the version's notes from `CHANGELOG.md`. See
[GitHub release notes](../README.md#github-release-notes). GitHub's auto-generated notes follow,
scoped to the previous semver tag. A first release gets generated notes for the full history. A
repo with no `CHANGELOG.md`, or no entry for the version, gets the generated notes alone.

| Input | Required | Description |
|---|---|---|
| `version` | Yes | Release version (e.g. `12.0.0`) |
| `is-hotfix` | No | Set to `true` to mark the release as non-latest |

**Prerequisites:**
- The calling workflow must check out with `fetch-depth: 0` and `fetch-tags: true`.
- Release tags must follow the `v{X.Y.Z}` convention (e.g. `v12.0.0`). This action both creates
  and expects tags in this format.
- The `GH_TOKEN` environment variable must be set (typically `${{ secrets.GITHUB_TOKEN }}`).
- For the `CHANGELOG.md` notes, the file is at the repo root and Node is on the PATH.

### `check-changelog`

Runs `xh-changelog check` on a pull request, and writes the entries that the pull request adds to
the job summary. The README section [Changelog fragments](../README.md#changelog-fragments)
documents what the check enforces.

The action runs the command from its own checkout of this repository, with plain Node and no
install. It works in npm projects, Hoist apps and Gradle projects. A workflow that pins the action
to a commit SHA also pins the checks it runs.

| Input | Required | Description |
|---|---|---|
| `base` | No | Ref to diff against (default: the pull request base) |
| `skip-label` | No | Label that marks a pull request as needing no entry, and turns off the warning (default: `no-changelog`) |
| `release` | No | Version being published. Runs the [release check](../README.md#release) in place of the pull request checks |
| `working-directory` | No | Where to run. The check uses the nearest `CHANGELOG.md` at or above it (default: `.`) |

On a pull request, check out with `fetch-depth: 0` so the base commit is present. Trigger on
`labeled` and `unlabeled` so that adding `skip-label` re-runs the check:

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

In a release build:

```yaml
- uses: xh/hoist-dev-utils/.github/actions/check-changelog@master
  with:
      release: ${{ inputs.version }}
```

## Supporting Scripts

The `scripts/` directory contains shell scripts used internally by the composite actions:

- **`validate-release-version.sh`** - Core validation logic for release versions.
- **`find-latest-version.sh`** - Finds the latest semver tag or the latest tag before a given
  version.

## Tests

The `test/` directory contains unit tests for the scripts, run by `unitTestActions.yml` on PRs.

## Workflows

The `workflows/` directory contains workflows for hoist-dev-utils' *own* CI/CD:

- **`deployRelease.yml`** - Manually triggered workflow to publish numbered releases to npm.
  Uses `validate-release-version` and `create-tag-and-github-release` actions.
- **`deploySnapshot.yml`** - Publishes a SNAPSHOT build to npm (tagged `next`) on every push to
  `develop`. Uses `prepare-npm-snapshot-version`.
- **`unitTestActions.yml`** - Runs unit tests for the shared actions and scripts on PRs that
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
