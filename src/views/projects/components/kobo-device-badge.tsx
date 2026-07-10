import { Channel } from '@tauri-apps/api/core'
import { CheckCircle, RefreshCw, Send, TriangleAlert } from 'lucide-react'
import type { FC } from 'react'
import { useState } from 'react'
import { Button, IconButton } from '@/components/ui/button'
import { Popover } from '@/components/ui/popover'
import { toast } from '@/components/ui/toaster'
import { formatBytes, getKoboSyncStatus } from '@/lib/kobo'
import { api } from '@/lib/tauri'
import type { KoboDevice, Project, SyncAllEvent } from '@/types'

interface KoboDeviceBadgeProps {
  device: KoboDevice
  projects: Project[]
  onProjectSynced: (projectId: string, success: boolean) => void
}

// Shown in ProjectList's header only when a Kobo is connected — the parent conditions
// rendering on `device` being non-null (see project-list.tsx's single `useKoboDevice` call;
// this component doesn't poll independently). The aggregate up-to-date/outdated indicator
// sits next to the trigger button itself, visible at a glance without opening anything;
// clicking the trigger opens a popover with the device name/free space and a "Sync all"
// action that runs `sync_all_to_kobo` against every outdated-or-missing project —
// per-project sync state lives only here now, not on each row (see project-row.tsx, which
// just exposes a plain "Send to device" menu item).
export const KoboDeviceBadge: FC<KoboDeviceBadgeProps> = ({
  device,
  projects,
  onProjectSynced,
}) => {
  const [syncingAll, setSyncingAll] = useState(false)

  const handleSyncAll = async () => {
    setSyncingAll(true)
    const channel = new Channel<SyncAllEvent>()
    channel.onmessage = (event) => {
      if (event.type === 'progress') {
        onProjectSynced(event.projectId, event.success)
        if (!event.success && event.error) {
          toast({
            title: `Failed to sync ${event.projectName}`,
            description: event.error,
          })
        }
      } else if (event.type === 'done') {
        setSyncingAll(false)
        toast({
          title:
            event.total === 0
              ? 'Everything is already up to date'
              : 'Sync all complete',
          description:
            event.total === 0
              ? undefined
              : `${event.synced} of ${event.total} projects synced`,
        })
      }
    }

    try {
      await api.syncAllToKobo(channel)
    } catch (e) {
      setSyncingAll(false)
      toast({ title: 'Sync all failed', description: String(e) })
    }
  }

  // Approximate — Sync all (see kobo.rs) also picks up projects missing from the device's
  // sync folder regardless of timestamps, which this can't check without asking the device.
  // Good enough for the badge's count; the actual sync run is the source of truth.
  const outdatedCount = projects.filter(
    (p) => getKoboSyncStatus(p) === 'outdated',
  ).length

  return (
    <div className="flex items-center gap-1">
      {outdatedCount === 0 ? (
        <CheckCircle className="size-4 shrink-0 text-success" />
      ) : (
        <TriangleAlert className="size-4 shrink-0 text-warning" />
      )}
      <Popover placement="bottom-end">
        <Popover.Trigger asChild>
          <IconButton
            variant="ghost"
            size="sm"
            aria-label="Kobo device"
            title={device.label ?? 'Kobo device'}
          >
            <Send className="size-4" />
          </IconButton>
        </Popover.Trigger>
        <Popover.Content className="w-64 p-4">
          <p className="font-medium text-sm">
            {device.label ?? 'Kobo eReader'}
          </p>
          <p className="mt-0.5 text-foreground-secondary text-xs">
            {formatBytes(device.freeBytes)} free of{' '}
            {formatBytes(device.totalBytes)}
          </p>
          <Button
            variant="outline"
            size="sm"
            className="mt-3 w-full"
            onClick={handleSyncAll}
            disabled={syncingAll || outdatedCount === 0}
            isLoading={syncingAll}
          >
            <RefreshCw className="size-4" />
            {outdatedCount === 0 ? 'Up to date' : `Sync all (${outdatedCount})`}
          </Button>
        </Popover.Content>
      </Popover>
    </div>
  )
}
