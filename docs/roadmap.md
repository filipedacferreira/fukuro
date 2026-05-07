# Roadmap

## Volume grouping

Add a volume layer between projects and chapters: chapters → volumes → project.

- Add `volumes` table (`id`, `project_id`, `display_name`, `sort_order`) with a nullable `volume_id FK` on `chapters`
- Update `create_cbz` to accept a volume ID and filter chapters accordingly
- Add a volume grouping layer above the chapter list in the editor UI

The DB schema is already relational enough to support this without migration pain.

## Settings screen

No settings exist yet. Candidates:
- Default export location
- Theme override
- Thumbnail size in the grid
