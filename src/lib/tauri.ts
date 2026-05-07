import { invoke } from '@tauri-apps/api/core'
import type { Chapter, ImageMeta, Project } from '@/types'

export const api = {
  createProject: (rootPath: string) =>
    invoke<Project>('create_project', { rootPath }),

  listProjects: () =>
    invoke<Project[]>('list_projects'),

  deleteProject: (id: string) =>
    invoke<void>('delete_project', { id }),

  getProjectChapters: (projectId: string) =>
    invoke<Chapter[]>('get_project_chapters', { projectId }),

  reorderChapters: (chapterIds: string[]) =>
    invoke<void>('reorder_chapters', { chapterIds }),

  renameChapter: (id: string, name: string) =>
    invoke<void>('rename_chapter', { id, name }),

  getChapterImages: (chapterId: string) =>
    invoke<ImageMeta[]>('get_chapter_images', { chapterId }),

  toggleExclusion: (chapterId: string, imagePath: string) =>
    invoke<boolean>('toggle_exclusion', { chapterId, imagePath }),

  hardDeleteImage: (chapterId: string, path: string) =>
    invoke<void>('hard_delete_image', { chapterId, path }),

  createCbz: (projectId: string, outputPath: string) =>
    invoke<string>('create_cbz', { projectId, outputPath }),
}
