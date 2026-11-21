### 🎁 New Features

* New `xh-changelog` command for changelog fragments. Each pull request adds its entries as a
  markdown file in `changelog.d/`, and `xh-changelog release <version>` assembles them into
  `CHANGELOG.md`. Pull requests stop conflicting over `CHANGELOG.md`, and an entry merged after a
  release can no longer land under the version that shipped. It runs on plain Node, for libraries
  and apps alike. See the README section "Changelog fragments".
* New `check-changelog` shared action, which runs `xh-changelog check` on pull requests.

### ⚙️ Technical

* This repo now writes its own changelog entries as fragments in `changelog.d/`.
