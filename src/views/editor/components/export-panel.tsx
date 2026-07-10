import { Channel } from '@tauri-apps/api/core'
import { save } from '@tauri-apps/plugin-dialog'
import { revealItemInDir } from '@tauri-apps/plugin-opener'
import { Archive, Send } from 'lucide-react'
import type { FC } from 'react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { toast } from '@/components/ui/toaster'
import { useKoboDevice } from '@/hooks/use-kobo-device'
import { useKoboSync } from '@/hooks/use-kobo-sync'
import { api } from '@/lib/tauri'
import type { ExportEvent, Project } from '@/types'

interface ExportPanelProps {
  project: Project
  hasChapters: boolean
}

export const ExportPanel: FC<ExportPanelProps> = ({ project, hasChapters }) => {
  const [progress, setProgress] = useState<{
    current: number
    total: number
  } | null>(null)

  const koboDevice = useKoboDevice()
  // No onSynced callback needed here — unlike ProjectRow, this view doesn't display any
  // device-sync status that would need updating after a successful "Send to device".
  const {
    sync: syncToKobo,
    progress: syncProgress,
    syncing,
  } = useKoboSync(project, () => {})

  const exporting = progress !== null

  const runExport = async (outputPath: string) => {
    setProgress({ current: 0, total: 0 })

    const channel = new Channel<ExportEvent>()
    channel.onmessage = (event) => {
      if (event.type === 'progress') {
        setProgress({ current: event.current, total: event.total })
      } else if (event.type === 'done') {
        setProgress(null)
        toast({
          title: 'CBZ created',
          description: outputPath,
          action: {
            label: 'Show in folder',
            onClick: () => revealItemInDir(outputPath),
          },
        })
      } else if (event.type === 'error') {
        setProgress(null)
        toast({
          title: 'Export failed',
          description: event.message,
        })
      }
    }

    try {
      await api.createCbz(project.id, outputPath, channel)
    } catch (e) {
      setProgress(null)
      toast({
        title: 'Export failed',
        description: String(e),
      })
    }
  }

  const handleExport = async () => {
    const outputPath = await save({
      filters: [{ name: 'Comic Book Archive', extensions: ['cbz'] }],
      defaultPath: `${project.name}.cbz`,
    })
    if (!outputPath) return
    await runExport(outputPath as string)
  }

  return (
    <div className="flex items-center justify-end gap-3 border-border border-t bg-background px-4 py-3">
      <div className="flex flex-1 flex-col gap-1.5">
        <p className="text-foreground-secondary text-xs">
          {exporting
            ? 'Exporting…'
            : syncing
              ? syncProgress?.phase === 'exporting'
                ? 'Exporting…'
                : 'Sending to device…'
              : 'Images marked as excluded will be skipped during export.'}
        </p>
        {exporting && (
          <Progress
            value={progress?.current ?? 0}
            max={progress?.total || 1}
            size="sm"
            className="max-w-32"
          />
        )}
        {syncing && syncProgress && (
          <Progress
            value={syncProgress.current}
            max={syncProgress.total || 1}
            size="sm"
            className="max-w-32"
          />
        )}
      </div>
      <Button
        onClick={syncToKobo}
        disabled={!koboDevice || exporting || syncing}
        size="sm"
        variant="outline"
      >
        <Send className="size-4" />
        Send to device
      </Button>
      <Button
        onClick={handleExport}
        disabled={!hasChapters || exporting || syncing}
        size="sm"
      >
        <Archive className="size-4" />
        Export CBZ
      </Button>
    </div>
  )
}
