import { type Channel, invoke } from '@tauri-apps/api/core'
import type {
  Chapter,
  ExportEvent,
  ImageMeta,
  Project,
  ThumbnailUpdate,
} from '@/types'

export const api = {
  createProject: (rootPath: string) =>
    invoke<Project>('create_project', { rootPath }),

  listProjects: () => invoke<Project[]>('list_projects'),

  deleteProject: (id: string) => invoke<void>('delete_project', { id }),

  renameProject: (id: string, name: string) =>
    invoke<void>('rename_project', { id, name }),

  getProjectChapters: (projectId: string) =>
    invoke<Chapter[]>('get_project_chapters', { projectId }),

  reorderChapters: (chapterIds: string[]) =>
    invoke<void>('reorder_chapters', { chapterIds }),

  renameChapter: (id: string, name: string) =>
    invoke<void>('rename_chapter', { id, name }),

  getChapterImages: (chapterId: string) =>
    invoke<ImageMeta[]>('get_chapter_images', { chapterId }),

  generateChapterThumbnailsStream: (
    chapterId: string,
    onEvent: Channel<ThumbnailUpdate>,
  ) =>
    invoke<void>('generate_chapter_thumbnails_stream', { chapterId, onEvent }),

  clearThumbnailCache: () => invoke<void>('clear_thumbnail_cache'),

  toggleExclusion: (chapterId: string, imagePath: string) =>
    invoke<boolean>('toggle_exclusion', { chapterId, imagePath }),

  hardDeleteImage: (chapterId: string, path: string) =>
    invoke<void>('hard_delete_image', { chapterId, path }),

  createCbz: (
    projectId: string,
    outputPath: string,
    onEvent: Channel<ExportEvent>,
  ) => invoke<void>('create_cbz', { projectId, outputPath, onEvent }),

  setProjectCover: (projectId: string, imagePath: string) =>
    invoke<string>('set_project_cover', { projectId, imagePath }),

  fetchAnilistCover: (projectId: string, anilistId: number) =>
    invoke<{ title: string; coverPath: string }>('fetch_anilist_cover', {
      projectId,
      anilistId,
    }),

  removeProjectCover: (projectId: string) =>
    invoke<void>('remove_project_cover', { projectId }),

  startWatchingProject: (projectId: string) =>
    invoke<void>('start_watching_project', { projectId }),

  stopWatchingProject: () => invoke<void>('stop_watching_project'),
}
