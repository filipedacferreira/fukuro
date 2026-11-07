import { Channel } from '@tauri-apps/api/core'
import { useState } from 'react'
import { toast } from '@/components/ui/toaster'
import { api } from '@/lib/tauri'
import type { Project, SyncEvent, SyncProgress } from '@/types'

type ProjectSyncFields = Pick<Project, 'lastKoboExportAt' | 'lastSyncedAt'>

// Drives a single project's "Send to device" action — shared by the project row's menu item
// and the editor's ExportPanel, since both need the same "stream export+copy progress" flow,
// just rendered into different layouts (see CLAUDE.md's component-architecture rule on
// extracting a shared primitive once real duplication, not just a passing similarity, would
// result). Never prompts for a save location — Kobo sync writes to its own fixed AppData
// cache (see kobo.rs's `kobo_cache_path`), decoupled from the user's own "Export CBZ" file.
// `onSynced` lets the caller optimistically patch its own copy of the project's sync
// timestamps — there's no dedicated "get one project" command to refetch from, and a full
// project-list rescan would be overkill for two fields we already know the new values of.
//
// `syncing` is tracked separately from `progress`: while a send is running, `progress` stays
// null until the backend's first event says which phase it's in. Seeding a phase up front
// would flash "Exporting…" for a send whose cache is fresh and goes straight to copying.
export const useKoboSync = (
  project: Pick<Project, 'id' | 'name'>,
  onSynced: (patch: ProjectSyncFields) => void,
) => {
  const [syncing, setSyncing] = useState(false)
  const [progress, setProgress] = useState<SyncProgress | null>(null)

  // Ends the send, whichever way it ended (done, error event, or a rejected invoke).
  const finish = () => {
    setSyncing(false)
    setProgress(null)
  }

  const sync = async () => {
    setSyncing(true)
    setProgress(null)

    const channel = new Channel<SyncEvent>()
    channel.onmessage = (event) => {
      if (event.type === 'exporting' || event.type === 'copying') {
        setProgress({
          phase: event.type,
          current: event.current,
          total: event.total,
        })
      } else if (event.type === 'done') {
        finish()
        // now approximates the timestamps the Rust side just wrote — close enough for
        // outdated comparisons, and avoids a round-trip just to learn the exact
        // server-side value.
        const now = Math.floor(Date.now() / 1000)
        onSynced({ lastKoboExportAt: now, lastSyncedAt: now })
        toast({ title: 'Sent to device', description: project.name })
      } else if (event.type === 'error') {
        finish()
        toast({ title: 'Send to device failed', description: event.message })
      }
    }

    try {
      await api.syncProjectToKobo(project.id, channel)
    } catch (e) {
      finish()
      toast({ title: 'Send to device failed', description: String(e) })
    }
  }

  return { sync, progress, syncing }
}
