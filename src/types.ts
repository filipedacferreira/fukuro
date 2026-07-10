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

export type SyncAllEvent =
  | {
      type: 'progress'
      current: number
      total: number
      projectId: string
      projectName: string
      success: boolean
      error: string | null
    }
  | { type: 'done'; synced: number; total: number }
