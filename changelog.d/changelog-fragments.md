### 🎁 New Features

* New `xh-changelog` command for changelog fragments. Each pull request adds its entries as a
  markdown file in `changelog.d/`, and `xh-changelog release <version>` assembles them into
  `CHANGELOG.md`. Pull requests stop conflicting over `CHANGELOG.md`, and an entry merged after a
  release can no longer land under the version that shipped. It runs on plain Node, for libraries
  and apps alike. See the README section "Changelog fragments".
    * `xh-changelog add fix "<text>"` adds one entry to the branch's fragment. It finds the section
      from a short name, so nobody types an emoji heading.
    * `xh-changelog init` sets up a repo: the config, a README, a `changelog` package script and a
      GitHub workflow.
* New `check-changelog` shared action, which runs `xh-changelog check` on pull requests. The job
  summary shows the entries that the pull request adds. In a release build, pass `release` to fail
  the build unless `CHANGELOG.md` holds the version and no fragments are left.
* App builds show unreleased changelog fragments in the in-app release notes, under the version in
  development.
* App release notes keep wrapped bullets and sub-bullets. Before, the build kept only the first line
  of each bullet, so app changelogs had to write every bullet as one long line. The changelog JSON
  also gains markdown `sections`, which hoist-react 91.1 renders with code spans, links and nested
  lists. See the README section "In-app release notes".

### ⚙️ Technical

* This repo now writes its own changelog entries as fragments in `changelog.d/`.

### 📚 Libraries

* changelog-parser `removed`
* remove-markdown `added @ 0.6`
