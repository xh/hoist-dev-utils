#!/usr/bin/env bash
set -euo pipefail

# Validates a release version, ensuring it is either a new latest release or a hotfix release for the current git repo.
# Prints an error and exits 1 if validation fails.
#
# Env variables:
#  VERSION    - The new semantic version number (X.Y.Z).
#  IS_HOTFIX  - If false, must be exactly one increment ahead of the globally latest tag.
#               If true, must be exactly one increment ahead of a previous (non-latest) tag.
#

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FIND_LATEST_VERSION="$SCRIPT_DIR/find-latest-version.sh"

# Must be semantic version (X.Y.Z) with no leading zeros.
if [[ ! "$VERSION" =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]]; then
    echo "::error::Invalid version '$VERSION'. Must be semantic version with no leading zeros (e.g. 12.0.0)."
    exit 1
fi

# Must not duplicate an existing release
if git tag -l "v$VERSION" | grep -q .; then
    echo "::error::Tag v$VERSION already exists. This version has already been released."
    exit 1
fi

# Strict version validation — the new version must be exactly one
# increment from the latest relevant tag and hotfix cannot be latest.
LATEST=$("$FIND_LATEST_VERSION") || true
if [ -z "$LATEST" ]; then
    echo "::error::No existing release tags found. Cannot validate version."
    exit 1
fi

if [ "$IS_HOTFIX" = "true" ]; then
    # For hotfixes, validate against the version right before the proposed one.
    BASE=$("$FIND_LATEST_VERSION" "$VERSION") || true
    if [ -z "$BASE" ]; then
        echo "::error::No existing version found before $VERSION. Cannot validate hotfix."
        exit 1
    fi
    # If the previous version IS the global latest, this should be a standard release.
    if [ "$BASE" = "$LATEST" ]; then
        echo "::error::Hotfix version $VERSION follows the latest release (v$LATEST). Use a standard release instead."
        exit 1
    fi
else
    BASE="$LATEST"
fi

# VERSION must be exactly one increment from BASE.
BASE_MAJOR=$(echo "$BASE" | cut -d. -f1)
BASE_MINOR=$(echo "$BASE" | cut -d. -f2)
BASE_PATCH=$(echo "$BASE" | cut -d. -f3)

NEXT_MAJOR="$(( BASE_MAJOR + 1 )).0.0"
NEXT_MINOR="${BASE_MAJOR}.$(( BASE_MINOR + 1 )).0"
NEXT_PATCH="${BASE_MAJOR}.${BASE_MINOR}.$(( BASE_PATCH + 1 ))"

if [ "$VERSION" != "$NEXT_MAJOR" ] && [ "$VERSION" != "$NEXT_MINOR" ] && [ "$VERSION" != "$NEXT_PATCH" ]; then
    echo "::error::Version $VERSION is not a valid next version (base is v$BASE). Allowed: $NEXT_MAJOR, $NEXT_MINOR, or $NEXT_PATCH."
    exit 1
fi
