import { type Channel, invoke } from '@tauri-apps/api/core'
import type {
  AnilistCandidate,
  BackfillEvent,
  Chapter,
  ExportEvent,
  ImageMeta,
  Project,
  ThumbnailUpdate,
} from '@/types'

export const api = {
  getLibraryRoot: () => invoke<string | null>('get_library_root'),

  setLibraryRoot: (rootPath: string) =>
    invoke<Project[]>('set_library_root', { rootPath }),

  listProjects: () => invoke<Project[]>('list_projects'),

  deleteProject: (id: string) => invoke<void>('delete_project', { id }),

  renameProject: (id: string, name: string) =>
    invoke<void>('rename_project', { id, name }),

  getProjectChapters: (projectId: string) =>
    invoke<Chapter[]>('get_project_chapters', { projectId }),

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
    invoke<{ coverPath: string; coverThumbnailPath: string }>(
      'set_project_cover',
      { projectId, imagePath },
    ),

  searchAnilistCovers: (query: string) =>
    invoke<AnilistCandidate[]>('search_anilist_covers', { query }),

  applyAnilistCover: (
    projectId: string,
    anilistId: number,
    imageUrl: string,
    title: string,
  ) =>
    invoke<{ coverPath: string; coverThumbnailPath: string }>(
      'apply_anilist_cover',
      { projectId, anilistId, imageUrl, title },
    ),

  autoFillMissingCovers: (onEvent: Channel<BackfillEvent>) =>
    invoke<void>('auto_fill_missing_covers', { onEvent }),

  removeProjectCover: (projectId: string) =>
    invoke<void>('remove_project_cover', { projectId }),
}
