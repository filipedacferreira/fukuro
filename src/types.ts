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
}

export interface Chapter {
  id: string
  projectId: string
  folderPath: string
  displayName: string
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
