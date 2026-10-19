# The folders on disk are the source of truth for library structure

Projects, Chapters, chapter order, chapter numbers and Volumes are all derived from the folders under the Library root, never set by hand in the app. Earlier versions had manual chapter reordering, inline renaming and per-project root paths; they were removed because a structure stored in the database drifts from the downloader's folders and has to be reconciled, while a derived one is always right on the next read. The app only layers curation on top (Exclusions, Covers, display-name overrides), and anything that adds content, such as importing a `.cbz`, does so by writing folders into the Library root rather than creating database-only records.

## Consequences

- Renaming a Manga folder or Chapter folder on disk currently loses the curation attached to it, since the renamed folder is indistinguishable from a new one. Preserving it is tracked as its own issue.
- Features that need structure the folders don't express (e.g. Volumes) must find it in folder names or nesting, not ask the user to assign it.
