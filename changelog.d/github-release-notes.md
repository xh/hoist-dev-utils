### 🎁 New Features

* GitHub releases now lead with the version's notes from `CHANGELOG.md`, above the notes that
  GitHub generates. The `create-tag-and-github-release` action gets them from the new
  `xh-changelog notes <version>` command, which joins wrapped lines and resolves relative links.
  A repo with no `CHANGELOG.md` entry for the version gets the generated notes as before.
