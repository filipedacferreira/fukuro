# fukuro

A desktop utility that turns a library of downloaded manga chapters into `.cbz` files and keeps them in sync with a Kobo eReader. The folders on disk are the source of truth; the app adds curation (exclusions, covers) on top.

## Library

**Library root**:
The single folder the user points the app at; every folder directly inside it is a Project.
_Avoid_: Root path, workspace

**Project**:
One manga, backed by one folder directly inside the Library root. Its title is its display name.
_Avoid_: Series, manga (as a noun for the record), book

**Manga folder**:
A Project's folder on disk. Use only when talking about the folder itself, not the Project.

**Chapter**:
One folder inside a Manga folder, holding that chapter's pages. Its order and number come from its folder name.

**Volume**:
A group of Chapters within a Project, derived from the folders on disk rather than assigned by the user.

**Page**:
One image file inside a Chapter.
_Avoid_: Image (in user-facing language)

## Curation

**Exclusion**:
Marking a Page (or, later, a Chapter) to be left out of every Export without deleting it from disk.
_Avoid_: Soft delete, hide

**Cover**:
The image placed before the first Page of an Export, fetched from Anilist or picked by the user.

## Output

**Export**:
A `.cbz` file the user saves to a location of their choice with **Export CBZ**.

**Kobo sync**:
Copying a Project's `.cbz` onto a connected Kobo, from a cache the user never sees. Independent of any Export.
_Avoid_: Kobo export
