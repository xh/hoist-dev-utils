#!/usr/bin/env bash
set -euo pipefail

# Find the latest semver release tag, or the latest tag before a given version for the current git repo.
#
# Usage:
#   find-latest-version.sh            # prints the globally latest version (e.g. 12.1.0)
#   find-latest-version.sh 11.2.0     # prints the highest version before 11.2.0 (e.g. 11.1.0)
#
# Output is a bare version string (no "v" prefix). Exits non-zero if no matching tag is found.

VERSION="${1:-}"

# Finds all version tags, strips the "v" prefix, and sorts the tags.
ALL=$(git tag -l 'v*' \
    | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' \
    | sed 's/^v//' \
    | sort -t. -k1,1n -k2,2n -k3,3n)

# Early out/error if no version tags found.
if [ -z "$ALL" ]; then
    echo "::error::No version tags found." >&2
    exit 1
fi

# If no argument version provided, find the globally latest version.
if [ -z "$VERSION" ]; then
    echo "$ALL" | tail -1
else
  # Otherwise, we find the version before the given one.
  # Mix in the target version, sort it in (with de-duplication),
  # get the given version as well as the line before it, get the
  # line before it.
    PREV=$( (echo "$ALL"; echo "$VERSION") \
        | sort -t. -k1,1n -k2,2n -k3,3n -u \
        | grep -B1 "^${VERSION}$" \
        | head -1)

    if [ "$PREV" = "$VERSION" ] || [ -z "$PREV" ]; then
        echo "::error::No version found before $VERSION." >&2
        exit 1
    fi
    echo "$PREV"
fi