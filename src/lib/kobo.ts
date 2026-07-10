import type { Project } from '@/types'

export type KoboSyncStatus = 'not-sent' | 'outdated' | 'up-to-date'

// A project's Kobo-sync status, as three distinct resting states. Based on
// `lastKoboExportAt`/`lastSyncedAt` — Kobo sync's own AppData cache and device-copy
// timestamps — not `lastExportedAt`, which only tracks the user's separate, manually-picked
// "Export CBZ" file (see kobo.rs's `kobo_cache_path`).
//
// - `not-sent`: both timestamps null — never exported to the Kobo cache *and* never copied to
//   a device. Previously this returned null (shown as nothing), which hid never-sent projects
//   from the pending count entirely even though the backend's `sync_all_to_kobo` would happily
//   send them. Surfacing it as a real state is what lets the drawer count and list them.
// - `outdated`: on the device once, but the cache has drifted since — either exported to cache
//   but not yet copied, or invalidated after an exclusion toggle / page delete (`lastKoboExportAt`
//   null with a prior sync — see `invalidate_export` in images.rs).
// - `up-to-date`: the device copy reflects the current cache.
export const getKoboSyncStatus = (project: Project): KoboSyncStatus => {
  if (project.lastKoboExportAt == null && project.lastSyncedAt == null)
    return 'not-sent'
  if (project.lastKoboExportAt == null || project.lastSyncedAt == null)
    return 'outdated'
  return project.lastKoboExportAt > project.lastSyncedAt
    ? 'outdated'
    : 'up-to-date'
}

// "Pending" = anything that isn't already up to date on the device: both `not-sent` and
// `outdated`. Drives the header pill's count and the drawer's "N pending" summary. Note this
// can't detect a device copy deleted directly on the Kobo (the backend's device scan catches
// that) — it's an approximation, which is why the drawer's Sync action stays enabled even at
// zero pending.
export const isKoboPending = (project: Project): boolean =>
  getKoboSyncStatus(project) !== 'up-to-date'

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
