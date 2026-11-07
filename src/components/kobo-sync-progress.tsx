import type { FC } from 'react'
import { Progress } from '@/components/ui/progress'
import type { SyncProgress } from '@/hooks/use-kobo-sync'
import { formatBytes } from '@/lib/kobo'
import { cn } from '@/lib/utils/classnames'

interface KoboSyncProgressProps {
  progress: SyncProgress
  size?: 'xs' | 'sm'
  className?: string
}

// The detail text next to the phase label: "42% · 120 MB of 284 MB" when copying (bytes) or
// "42% · 12 of 30 pages" when exporting (Pages). Empty until the first real event reports a
// total — useKoboSync seeds `{ total: 0 }` before the backend has said anything.
const describe = ({ phase, current, total }: SyncProgress): string | null => {
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
// single and bulk sends always read the same.
export const KoboSyncProgress: FC<KoboSyncProgressProps> = ({
  progress,
  size = 'xs',
  className,
}) => {
  const detail = describe(progress)

  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <Progress
        value={progress.current}
        max={progress.total || 1}
        size={size}
      />
      <p className="truncate text-2xs text-foreground-secondary">
        {progress.phase === 'exporting' ? 'Exporting' : 'Copying'}
        {detail ? ` · ${detail}` : '…'}
      </p>
    </div>
  )
}
