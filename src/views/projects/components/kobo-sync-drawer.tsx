import { Channel } from '@tauri-apps/api/core'
import { CheckCircle2, RefreshCw, Tablet, TriangleAlert } from 'lucide-react'
import type { FC } from 'react'
import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Drawer } from '@/components/ui/drawer'
import { Progress } from '@/components/ui/progress'
import { toast } from '@/components/ui/toaster'
import { formatBytes, isKoboPending } from '@/lib/kobo'
import { api } from '@/lib/tauri'
import type { KoboDevice, Project, SyncAllEvent } from '@/types'
import { type KoboRowRunState, KoboSyncRow } from './kobo-sync-row'

interface KoboSyncDrawerProps {
  device: KoboDevice
  projects: Project[]
  // Patches a project's sync timestamps in the parent list on a successful send (single or
  // bulk), so rows settle to "up to date" without a full refetch. Same contract the old badge
  // used — see project-list.tsx's handleProjectSynced.
  onProjectSynced: (projectId: string, success: boolean) => void
}

// Header entry point for Kobo sync, shown in ProjectList's header only when a device is
// connected. Replaces the old aggregate icon+glyph badge: a labeled pill trigger (device +
// pending count) opens a right-hand Drawer that lists every project with its per-project sync
// status, live progress, and per-row send/retry, plus a bulk "Sync all". The drawer — not a
// per-row marker — is the single place the whole sync picture lives.
export const KoboSyncDrawer: FC<KoboSyncDrawerProps> = ({
  device,
  projects,
  onProjectSynced,
}) => {
  const [open, setOpen] = useState(false)
  const [syncingAll, setSyncingAll] = useState(false)
  // Per-row transient state for the current bulk run, keyed by project id (see KoboRowRunState).
  const [runStates, setRunStates] = useState<Record<string, KoboRowRunState>>(
    {},
  )
  // Overall batch progress from SyncAllEvent's `current`/`total`. Null when no run is active.
  const [runProgress, setRunProgress] = useState<{
    current: number
    total: number
  } | null>(null)

  const pendingCount = projects.filter(isKoboPending).length

  // Pending projects (not-sent / outdated) float to the top; up-to-date ones sink below. JS's
  // sort is stable, so within each group the parent's existing order (created_at DESC) holds.
  const sortedProjects = useMemo(
    () =>
      [...projects].sort(
        (a, b) => Number(isKoboPending(b)) - Number(isKoboPending(a)),
      ),
    [projects],
  )

  // Clears a single project's lingering run state (used after a successful single-row retry
  // patches its timestamps, so a previously-failed row stops reading "Failed").
  const clearRunState = (projectId: string) => {
    setRunStates((prev) => {
      if (!(projectId in prev)) return prev
      const next = { ...prev }
      delete next[projectId]
      return next
    })
  }

  const handleRowSynced = (projectId: string) => {
    onProjectSynced(projectId, true)
    clearRunState(projectId)
  }

  const handleSyncAll = async () => {
    setSyncingAll(true)
    // Optimistically queue everything the UI can see as pending. The backend may sync a few
    // more (device-missing copies it detects but the UI can't — see kobo.rs), which simply
    // arrive as `started` events for rows not pre-queued; the map handles arbitrary keys.
    setRunStates(
      Object.fromEntries(
        projects.filter(isKoboPending).map((p) => [p.id, 'queued' as const]),
      ),
    )
    setRunProgress({ current: 0, total: pendingCount })

    const channel = new Channel<SyncAllEvent>()
    channel.onmessage = (event) => {
      if (event.type === 'started') {
        setRunStates((prev) => ({ ...prev, [event.projectId]: 'syncing' }))
      } else if (event.type === 'progress') {
        setRunStates((prev) => ({
          ...prev,
          [event.projectId]: event.success ? 'done' : 'failed',
        }))
        setRunProgress({ current: event.current, total: event.total })
        onProjectSynced(event.projectId, event.success)
        if (!event.success && event.error) {
          toast({
            title: `Failed to sync ${event.projectName}`,
            description: event.error,
          })
        }
      } else if (event.type === 'done') {
        setSyncingAll(false)
        setRunProgress(null)
        // Keep only failed rows flagged (so they still show "Failed" + Retry); succeeded rows
        // fall back to their now-up-to-date resting status.
        setRunStates((prev) =>
          Object.fromEntries(
            Object.entries(prev).filter(([, s]) => s === 'failed'),
          ),
        )
        toast({
          title:
            event.total === 0
              ? 'Everything is already up to date'
              : 'Sync all complete',
          description:
            event.total === 0
              ? undefined
              : `${event.synced} of ${event.total} synced`,
        })
      }
    }

    try {
      await api.syncAllToKobo(channel)
    } catch (e) {
      setSyncingAll(false)
      setRunProgress(null)
      setRunStates({})
      toast({ title: 'Sync all failed', description: String(e) })
    }
  }

  return (
    <Drawer
      open={open}
      onOpenChange={(next) => {
        // Don't let Esc/backdrop dismiss the drawer mid-batch — closing would orphan the
        // event channel and drop the progress the run is still reporting.
        if (!next && syncingAll) return
        setOpen(next)
      }}
    >
      <Drawer.Trigger asChild>
        <Button variant="outline" size="sm">
          <Tablet className="size-4" />
          Kobo
          {pendingCount > 0 ? (
            <span className="flex items-center gap-1 text-warning">
              <TriangleAlert className="size-3.5" />
              {pendingCount}
            </span>
          ) : (
            <CheckCircle2 className="size-3.5 text-success" />
          )}
        </Button>
      </Drawer.Trigger>

      <Drawer.Content side="right" className="max-w-md">
        <Drawer.Header>
          <Drawer.Title>Send to Kobo</Drawer.Title>
          <p className="mt-0.5 text-foreground-secondary text-xs">
            {device.label ?? 'Kobo eReader'} · {formatBytes(device.freeBytes)}{' '}
            free of {formatBytes(device.totalBytes)}
          </p>
        </Drawer.Header>

        {projects.length === 0 ? (
          <p className="py-8 text-center text-foreground-secondary text-sm">
            No projects to sync yet.
          </p>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {sortedProjects.map((project) => (
              <KoboSyncRow
                key={project.id}
                project={project}
                bulkActive={syncingAll}
                runState={runStates[project.id]}
                onSynced={handleRowSynced}
              />
            ))}
          </ul>
        )}

        <Drawer.Actions className="flex-col items-stretch gap-3">
          {runProgress && (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between text-foreground-secondary text-xs">
                <span>Syncing…</span>
                <span>
                  {runProgress.current} of {runProgress.total || '…'}
                </span>
              </div>
              <Progress
                value={runProgress.current}
                max={runProgress.total || 1}
                size="sm"
              />
            </div>
          )}
          <div className="flex items-center justify-between gap-3">
            <span className="text-foreground-secondary text-sm">
              {pendingCount > 0
                ? `${pendingCount} pending`
                : 'Everything up to date'}
            </span>
            <Button
              size="sm"
              onClick={handleSyncAll}
              isLoading={syncingAll}
              disabled={syncingAll}
            >
              <RefreshCw className="size-4" />
              {pendingCount > 0 ? 'Sync all' : 'Re-sync all'}
            </Button>
          </div>
        </Drawer.Actions>
      </Drawer.Content>
    </Drawer>
  )
}
