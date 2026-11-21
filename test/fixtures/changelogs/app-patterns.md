# Changelog

## v5.0 - SNAPSHOT

### New Features
* Added a chat tab for questions about the help docs. Access requires the `ACCESS_CHAT` role.

### Libraries
* Hoist Chat Kit v1.0 (new)

## v4.1.0 - 2026-10-27

### New Features
* Allowed two companies to share a display name.
* Added **contact** fields to the company editor, as described in [the guide](https://xh.io/guide).

### Technical
* Requires database v383 - changes to the company fields.
* Role changes:
  * Added the `READ_COMPANY_REPORTS` and `READ_ALL_REPORTS` roles.
* Config changes:
  * Update `targetUpgradeVersion: 28` 
    * Adds the contact fields to the data dictionary.
    * Migrates an enabled `checklistSpec` config to a `CHECKLIST` blob.
* Kept a literal [beta] tag in this entry.

### Libraries
* Hoist React v89.3.1
* Hoist Core v43.0.1

## v1.49.0 - 2026-01-14

### New Features

- Added an editable description field to transfers.
- Improved the transaction selector to sort top-level transactions reverse-chronologically, displaying 
respective children below each top-level item.
- Fixed a wrapped bullet whose second line is indented, as a library changelog writes it, and
  whose third line is too.

## v1.48.0 - 2026-01-02

- Hoist Core v33.2 -> v36.1
- Hoist React v78.1.4 -> v80.0.1

## v3.23.4 - 2023-07-20

### New Features
* Added a PDF confirmation of a request.

## Technical
* Added configs `pdfEnabled`, `pdfSchema` - define the PDF confirmation.

## v1.0.0 - 2024-07-15

### New Features
* Initial release.

### Bug Fixes
* No bugs yet!

------------------------------------------

☎️ info@xh.io | <https://xh.io>
Copyright © 2026 Extremely Heavy Industries Inc.
