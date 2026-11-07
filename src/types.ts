export type CoverInfo = Pick<
  Project,
  'coverPath' | 'coverThumbnailPath' | 'anilistId' | 'coverTitle'
>

export interface Project {
  id: string
  rootPath: string
  name: string
  createdAt: number
  chapterCount: number
  coverPath: string | null
  coverThumbnailPath: string | null
  anilistId: number | null
  coverTitle: string | null
  lastExportPath: string | null
  lastExportedAt: number | null
  lastKoboExportAt: number | null
  lastSyncedAt: number | null
}

export interface AnilistCandidate {
  anilistId: number
  title: string
  year: number | null
  thumbnailUrl: string
  imageUrl: string
}

export type BackfillEvent =
  | { type: 'progress'; current: number; total: number; applied: boolean }
  | { type: 'done'; applied: number; total: number }

export interface Chapter {
  id: string
  projectId: string
  folderPath: string
  displayName: string
  chapterNumber: number | null
  sortOrder: number
  imageCount: number
  excludedCount: number
}

export interface ImageMeta {
  path: string
  thumbnailPath: string
  filename: string
  isExcluded: boolean
}

export interface ThumbnailUpdate {
  imagePath: string
  thumbnailPath: string
}

export type ExportEvent =
  | { type: 'progress'; current: number; total: number }
  | { type: 'done'; outputPath: string }
  | { type: 'error'; message: string }

export interface KoboDevice {
  drivePath: string
  label: string | null
  freeBytes: number
  totalBytes: number
}

export type SyncEvent =
  | { type: 'exporting'; current: number; total: number }
  | { type: 'copying'; current: number; total: number }
  | { type: 'done'; devicePath: string }
  | { type: 'error'; message: string }

// Which half of a Kobo send is running. Mirrors kobo.rs's unit-only `SyncPhase` enum, which
// serializes as a plain string (see docs/rust-primer.md's "Tagged enums" entry).
export type SyncPhase = 'exporting' | 'copying'

// Live progress of one project's Kobo send, for a single send (useKoboSync, from SyncEvent) and
// for the active project of a Sync all (from SyncAllEvent's `projectProgress`) alike. Units
// depend on the phase: Pages when exporting, bytes when copying.
export interface SyncProgress {
  phase: SyncPhase
  current: number
  total: number
}

// Per project: `started` → zero or more `projectProgress` (exporting before copying) →
// `finished`. One `done` ends the run.
export type SyncAllEvent =
  | { type: 'started'; projectId: string }
  | ({ type: 'projectProgress'; projectId: string } & SyncProgress)
  | {
      type: 'finished'
      current: number
      total: number
      projectId: string
      projectName: string
      success: boolean
      error: string | null
    }
  | { type: 'done'; synced: number; total: number }
