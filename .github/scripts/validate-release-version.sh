#!/usr/bin/env bash
set -euo pipefail

# Must be semver (X.Y.Z) with no leading zeros.
if [[ ! "$VERSION" =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]]; then
    echo "::error::Invalid version '$VERSION'. Must be semver with no leading zeros (e.g. 12.0.0)."
    exit 1
fi

# Must not duplicate an existing release
if git tag -l "v$VERSION" | grep -q .; then
    echo "::error::Tag v$VERSION already exists. This version has already been released."
    exit 1
fi

# Strict version validation — the new version must be exactly one
# increment from the latest relevant tag and hotfix cannot be latest.
LATEST=$(git tag -l 'v*' | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | sed 's/^v//' | sort -t. -k1,1n -k2,2n -k3,3n | tail -1) || true
if [ -z "$LATEST" ]; then
    echo "::error::No existing release tags found. Cannot validate version."
    exit 1
fi
LATEST_MAJOR=$(echo "$LATEST" | cut -d. -f1)
LATEST_MINOR=$(echo "$LATEST" | cut -d. -f2)
LATEST_PATCH=$(echo "$LATEST" | cut -d. -f3)

# The three versions that would be valid as a standard (non-hotfix) release.
NEXT_MAJOR="$(( LATEST_MAJOR + 1 )).0.0"
NEXT_MINOR="${LATEST_MAJOR}.$(( LATEST_MINOR + 1 )).0"
NEXT_PATCH="${LATEST_MAJOR}.${LATEST_MINOR}.$(( LATEST_PATCH + 1 ))"

if [ "$IS_HOTFIX" = "true" ]; then
    # A hotfix must NOT be a standard next-release version.
    if [ "$VERSION" = "$NEXT_MAJOR" ] || [ "$VERSION" = "$NEXT_MINOR" ] || [ "$VERSION" = "$NEXT_PATCH" ]; then
        echo "::error::Hotfix version $VERSION matches a standard release increment (latest is v$LATEST). Use a standard release instead."
        exit 1
    fi

    NEW_MAJOR=$(echo "$VERSION" | cut -d. -f1)
    NEW_MINOR=$(echo "$VERSION" | cut -d. -f2)

    # Validate against the highest tags for this major version.
    MAX_MINOR=$(git tag -l "v${NEW_MAJOR}.*" | grep -E "^v${NEW_MAJOR}\.[0-9]+\.[0-9]+$" | sed 's/^v//' | cut -d. -f2 | sort -n | tail -1) || true

    if [ -z "$MAX_MINOR" ]; then
        echo "::error::No existing tags found for major version ${NEW_MAJOR}. Cannot validate hotfix."
        exit 1
    fi

    # Allowed: next minor bump for this major.
    ALLOWED_MINOR="${NEW_MAJOR}.$(( MAX_MINOR + 1 )).0"

    # Only offer a patch bump if tags exist for this specific MAJOR.MINOR.
    MAX_PATCH=$(git tag -l "v${NEW_MAJOR}.${NEW_MINOR}.*" | grep -E "^v${NEW_MAJOR}\.${NEW_MINOR}\.[0-9]+$" | sed 's/^v//' | cut -d. -f3 | sort -n | tail -1) || true
    if [ -n "$MAX_PATCH" ]; then
        ALLOWED_PATCH="${NEW_MAJOR}.${NEW_MINOR}.$(( MAX_PATCH + 1 ))"
    fi

    if [ "$VERSION" != "$ALLOWED_MINOR" ] && [ "$VERSION" != "${ALLOWED_PATCH:-}" ]; then
        ALLOWED="$ALLOWED_MINOR"
        [ -n "${ALLOWED_PATCH:-}" ] && ALLOWED="$ALLOWED or $ALLOWED_PATCH"
        echo "::error::Hotfix version $VERSION is not a valid next version. Allowed: $ALLOWED."
        exit 1
    fi
else
    # Standard release: must be exactly one increment from the latest tag.
    if [ "$VERSION" != "$NEXT_MAJOR" ] && [ "$VERSION" != "$NEXT_MINOR" ] && [ "$VERSION" != "$NEXT_PATCH" ]; then
        echo "::error::Version $VERSION is not a valid next version (latest is v$LATEST). Allowed: $NEXT_MAJOR, $NEXT_MINOR, or $NEXT_PATCH."
        exit 1
    fi
fi
