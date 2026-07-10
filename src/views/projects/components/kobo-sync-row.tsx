import { convertFileSrc } from '@tauri-apps/api/core'
import {
  BookImage,
  CheckCircle2,
  Circle,
  CircleDashed,
  CircleX,
  RotateCw,
  Send,
  TriangleAlert,
} from 'lucide-react'
import type { FC } from 'react'
import { Button, IconButton } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Spinner } from '@/components/ui/spinner'
import { useKoboSync } from '@/hooks/use-kobo-sync'
import { formatRelativeTime, getKoboSyncStatus } from '@/lib/kobo'
import { cn } from '@/lib/utils/classnames'
import type { Project } from '@/types'

// Transient per-row state during a "Sync all" run, driven by the SyncAllEvent stream in the
// parent drawer (see kobo-sync-drawer.tsx). Separate from the resting KoboSyncStatus, which is
// derived purely from the project's timestamps: a row is `queued` the moment a bulk run starts,
// `syncing` on its `started` event, then `done`/`failed` on its `progress` event. A single-row
// send (below) doesn't use this — it has its own byte-level `useKoboSync` progress instead.
export type KoboRowRunState = 'queued' | 'syncing' | 'done' | 'failed'

// What the row actually renders: either a live run state or the resting timestamp-derived
// status. `syncing` (single send) always wins, then any bulk run state, then the resting status.
type DisplayState = KoboRowRunState | ReturnType<typeof getKoboSyncStatus>

interface KoboSyncRowProps {
  project: Project
  // True while a bulk "Sync all" is in flight — disables the single-row send so a project can't
  // be sent twice at once (once by the batch, once by hand).
  bulkActive: boolean
  runState?: KoboRowRunState
  // Called after a successful single-row send: the parent both patches the project's timestamps
  // in its list (so the row settles to "up to date") and clears any lingering `failed` run state.
  onSynced: (projectId: string) => void
}

const STATUS_META: Record<
  DisplayState,
  { label: string; icon: FC<{ className?: string }>; className: string }
> = {
  queued: {
    label: 'Queued',
    icon: CircleDashed,
    className: 'text-foreground-secondary',
  },
  syncing: { label: 'Syncing…', icon: Circle, className: 'text-accent' },
  done: { label: 'Sent', icon: CheckCircle2, className: 'text-success' },
  failed: { label: 'Failed', icon: CircleX, className: 'text-error' },
  'not-sent': {
    label: 'Not sent',
    icon: Circle,
    className: 'text-foreground-secondary',
  },
  outdated: {
    label: 'Outdated',
    icon: TriangleAlert,
    className: 'text-warning',
  },
  'up-to-date': {
    label: 'Up to date',
    icon: CheckCircle2,
    className: 'text-success',
  },
}

export const KoboSyncRow: FC<KoboSyncRowProps> = ({
  project,
  bulkActive,
  runState,
  onSynced,
}) => {
  const { sync, progress, syncing } = useKoboSync(project, () =>
    onSynced(project.id),
  )

  const status = getKoboSyncStatus(project)
  // Single send in progress wins the display; then the bulk run state; then resting status.
  const display: DisplayState = syncing ? 'syncing' : (runState ?? status)
  const meta = STATUS_META[display]
  const StatusIcon = meta.icon

  // The action button's shape depends on how "done" the row is: up-to-date rows get a quiet
  // re-send icon (nothing's wrong, but a re-verify is always allowed — see the drawer's
  // always-enabled Sync all), failed rows get a "Retry", everything else a plain "Send".
  const isResolved = display === 'up-to-date' || display === 'done'
  const isBusy = display === 'queued' || display === 'syncing'
  const actionLabel = display === 'failed' ? 'Retry' : 'Send'
  const coverSrc = project.coverThumbnailPath ?? project.coverPath

  return (
    <li className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-background-secondary">
      {/* Small non-interactive cover, purely for at-a-glance recognition */}
      <div className="flex h-10 w-7 shrink-0 items-center justify-center overflow-hidden rounded bg-background-secondary">
        {coverSrc ? (
          <img
            src={convertFileSrc(coverSrc)}
            alt=""
            className="size-full object-cover"
          />
        ) : (
          <BookImage className="size-3.5 text-foreground-secondary" />
        )}
      </div>

      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-sm">{project.name}</p>
        <div className="mt-0.5 flex items-center gap-1.5 text-xs">
          {display === 'syncing' ? (
            <Spinner size="xs" className="text-accent" />
          ) : (
            <StatusIcon className={cn('size-3.5 shrink-0', meta.className)} />
          )}
          <span className={meta.className}>{meta.label}</span>
          {/* "Synced X ago" context for rows that have a device copy */}
          {!syncing &&
            !runState &&
            project.lastSyncedAt != null &&
            (status === 'up-to-date' || status === 'outdated') && (
              <span className="truncate text-foreground-secondary">
                · Synced {formatRelativeTime(project.lastSyncedAt)}
              </span>
            )}
        </div>
        {/* Byte/page-level progress for a single-row send only (bulk runs stay coarse) */}
        {syncing && progress && (
          <div className="mt-1.5 flex items-center gap-2">
            <Progress
              value={progress.current}
              max={progress.total || 1}
              size="xs"
              className="flex-1"
            />
            <span className="shrink-0 text-2xs text-foreground-secondary">
              {progress.phase === 'exporting' ? 'Exporting' : 'Copying'}
            </span>
          </div>
        )}
      </div>

      {/* Hidden while this row is queued/syncing in a bulk run — the status already says so */}
      {!isBusy &&
        (isResolved ? (
          <IconButton
            variant="ghost"
            size="sm"
            aria-label={`Re-send ${project.name} to device`}
            title="Re-send"
            onClick={sync}
            disabled={bulkActive}
          >
            <RotateCw className="size-4" />
          </IconButton>
        ) : (
          <Button
            variant="outline"
            size="sm"
            onClick={sync}
            disabled={bulkActive}
          >
            <Send className="size-4" />
            {actionLabel}
          </Button>
        ))}
    </li>
  )
}
