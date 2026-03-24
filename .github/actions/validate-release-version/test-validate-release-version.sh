#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$SCRIPT_DIR/validate-release-version.sh"

PASS=0
FAIL=0
ERRORS=()

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

setup_repo() {
    local tmpdir
    tmpdir=$(mktemp -d)
    git -C "$tmpdir" init -q
    git -C "$tmpdir" commit --allow-empty -m "init" -q
    echo "$tmpdir"
}

add_tags() {
    local repo=$1; shift
    for tag in "$@"; do
        git -C "$repo" tag "$tag"
    done
}

run_script() {
    local repo=$1 version=$2 is_hotfix=${3:-false}
    (
        cd "$repo"
        VERSION="$version" IS_HOTFIX="$is_hotfix" bash "$SCRIPT" 2>&1
    )
}

assert_success() {
    local description=$1; shift
    local repo=$1 version=$2 is_hotfix=${3:-false}
    local output
    if output=$(run_script "$repo" "$version" "$is_hotfix" 2>&1); then
        PASS=$((PASS + 1))
        echo "  PASS: $description"
    else
        FAIL=$((FAIL + 1))
        ERRORS+=("FAIL: $description (expected success, got failure)")
        echo "  FAIL: $description (expected success, got failure)"
        echo "        output: $output"
    fi
}

assert_failure() {
    local description=$1; shift
    local repo=$1 version=$2 is_hotfix=${3:-false}
    local output
    if output=$(run_script "$repo" "$version" "$is_hotfix" 2>&1); then
        FAIL=$((FAIL + 1))
        ERRORS+=("FAIL: $description (expected failure, got success)")
        echo "  FAIL: $description (expected failure, got success)"
        echo "        output: $output"
    else
        PASS=$((PASS + 1))
        echo "  PASS: $description"
    fi
}

# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

echo "=== Semver format validation ==="

REPO=$(setup_repo)
add_tags "$REPO" v1.0.0

assert_failure "rejects leading zero in major"    "$REPO" "01.0.0"
assert_failure "rejects leading zero in minor"    "$REPO" "1.01.0"
assert_failure "rejects leading zero in patch"    "$REPO" "1.0.01"
assert_failure "rejects missing patch"            "$REPO" "1.0"
assert_failure "rejects prerelease suffix"        "$REPO" "1.0.1-rc1"
assert_failure "rejects empty string"             "$REPO" ""
assert_failure "rejects v prefix"                 "$REPO" "v1.0.1"

rm -rf "$REPO"

echo ""
echo "=== Duplicate tag ==="

REPO=$(setup_repo)
add_tags "$REPO" v1.0.0

assert_failure "rejects version matching existing tag" "$REPO" "1.0.0"

rm -rf "$REPO"

echo ""
echo "=== Standard increment ==="

REPO=$(setup_repo)
add_tags "$REPO" v1.2.3

assert_success "accepts next major"  "$REPO" "2.0.0"
assert_success "accepts next minor"  "$REPO" "1.3.0"
assert_success "accepts next patch"  "$REPO" "1.2.4"
assert_failure "rejects double major increment" "$REPO" "3.0.0"
assert_failure "rejects double minor increment" "$REPO" "1.4.0"
assert_failure "rejects double patch increment" "$REPO" "1.2.5"
assert_failure "rejects random version"         "$REPO" "5.5.5"

rm -rf "$REPO"

echo ""
echo "=== No tags ==="

REPO=$(setup_repo)

assert_failure "fails when no release tags exist" "$REPO" "1.0.0"

rm -rf "$REPO"

echo ""
echo "=== Hotfix ==="

REPO=$(setup_repo)
add_tags "$REPO" v1.0.0 v1.1.0 v2.0.0 v2.1.0 v2.1.1

# Valid hotfix: patch bump on older major.minor line
assert_success "accepts hotfix patch to older line (1.1.1)" "$REPO" "1.1.1" "true"

# Valid hotfix: next minor on older major
assert_success "accepts hotfix minor to older major (1.2.0)" "$REPO" "1.2.0" "true"

# Rejects hotfix that matches standard next version
assert_failure "rejects hotfix matching next major (3.0.0)"  "$REPO" "3.0.0" "true"
assert_failure "rejects hotfix matching next minor (2.2.0)"  "$REPO" "2.2.0" "true"
assert_failure "rejects hotfix matching next patch (2.1.2)"  "$REPO" "2.1.2" "true"

# Rejects hotfix to nonexistent major
assert_failure "rejects hotfix to nonexistent major (5.0.1)" "$REPO" "5.0.1" "true"

# Rejects double-jump hotfix
assert_failure "rejects double-jump hotfix patch (1.0.2)"   "$REPO" "1.0.2" "true"
assert_failure "rejects double-jump hotfix minor (1.3.0)"   "$REPO" "1.3.0" "true"

rm -rf "$REPO"

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------

echo ""
echo "==========================================="
echo "  Results: $PASS passed, $FAIL failed"
echo "==========================================="

if [ "$FAIL" -gt 0 ]; then
    echo ""
    echo "Failures:"
    for err in "${ERRORS[@]}"; do
        echo "  - $err"
    done
    exit 1
fi
