import type { FC } from 'react'
import { Progress } from '@/components/ui/progress'
import { formatBytes } from '@/lib/kobo'
import { cn } from '@/lib/utils/classnames'
import type { SyncProgress } from '@/types'

interface KoboSyncProgressProps {
  // Null while a send has started but the backend hasn't reported a phase yet.
  progress: SyncProgress | null
  size?: 'xs' | 'sm'
  className?: string
}

// The detail text next to the phase label: "42% · 120 MB of 284 MB" when copying (bytes) or
// "42% · 12 of 30 pages" when exporting (Pages). Null if the event reports no total yet, so
// the line never shows a meaningless "0%".
const formatProgressDetail = ({
  phase,
  current,
  total,
}: SyncProgress): string | null => {
  if (total <= 0) return null
  const percent = Math.floor((Math.min(current, total) / total) * 100)
  const amount =
    phase === 'copying'
      ? `${formatBytes(current)} of ${formatBytes(total)}`
      : `${current} of ${total} ${total === 1 ? 'page' : 'pages'}`
  return `${percent}% · ${amount}`
}

// Live progress line for one project's Kobo sync: bar + "Exporting"/"Copying" + percentage +
// Pages/bytes. Shared by every place a Kobo send shows progress — the drawer row (single send
// or the active project of a Sync all), the project card, and the editor's ExportPanel — so
// single and bulk sends always read the same. Before the first event (`progress` null) it
// reads "Preparing…" over an empty bar rather than guessing a phase.
export const KoboSyncProgress: FC<KoboSyncProgressProps> = ({
  progress,
  size = 'xs',
  className,
}) => {
  const label = !progress
    ? 'Preparing'
    : progress.phase === 'exporting'
      ? 'Exporting'
      : 'Copying'
  const detail = progress ? formatProgressDetail(progress) : null

  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <Progress
        value={progress?.current ?? 0}
        max={progress?.total || 1}
        size={size}
      />
      <p className="truncate text-2xs text-foreground-secondary">
        {label}
        {detail ? ` · ${detail}` : '…'}
      </p>
    </div>
  )
}
