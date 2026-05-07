export interface Project {
  id: string
  rootPath: string
  name: string
  createdAt: number
  chapterCount: number
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
  filename: string
  isExcluded: boolean
}
