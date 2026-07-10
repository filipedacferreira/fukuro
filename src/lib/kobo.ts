import type { Project } from '@/types'

export type KoboSyncStatus = 'outdated' | 'up-to-date'

// The device-sync status marker's state, or null when nothing should be shown at all (never
// synced at all). Based on `lastKoboExportAt`/`lastSyncedAt` — Kobo sync's own AppData cache
// and device-copy timestamps — not `lastExportedAt`, which only tracks the user's separate,
// manually-picked "Export CBZ" file (see kobo.rs's `kobo_cache_path`). A project synced at
// least once but whose cache has since been invalidated (`lastKoboExportAt` null — see
// `invalidate_export` in images.rs) still counts as outdated, not "no icon", since there's a
// device copy that no longer matches the current content.
export const getKoboSyncStatus = (project: Project): KoboSyncStatus | null => {
  if (project.lastKoboExportAt == null && project.lastSyncedAt == null)
    return null
  if (project.lastKoboExportAt == null || project.lastSyncedAt == null)
    return 'outdated'
  return project.lastKoboExportAt > project.lastSyncedAt
    ? 'outdated'
    : 'up-to-date'
}

export const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unitIndex = -1
  do {
    value /= 1024
    unitIndex++
  } while (value >= 1024 && unitIndex < units.length - 1)
  return `${value.toFixed(1)} ${units[unitIndex]}`
}

export const formatRelativeTime = (epochSeconds: number): string => {
  const diffSeconds = Math.floor(Date.now() / 1000) - epochSeconds
  if (diffSeconds < 60) return 'just now'
  const diffMinutes = Math.floor(diffSeconds / 60)
  if (diffMinutes < 60) {
    return `${diffMinutes} minute${diffMinutes === 1 ? '' : 's'} ago`
  }
  const diffHours = Math.floor(diffMinutes / 60)
  if (diffHours < 24) {
    return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`
  }
  const diffDays = Math.floor(diffHours / 24)
  return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`
}
