import { Channel } from '@tauri-apps/api/core'
import { save } from '@tauri-apps/plugin-dialog'
import { revealItemInDir } from '@tauri-apps/plugin-opener'
import { Archive } from 'lucide-react'
import type { FC } from 'react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { toast } from '@/components/ui/toaster'
import { api } from '@/lib/tauri'
import type { ExportEvent } from '@/types'

interface ExportPanelProps {
  projectId: string
  projectName: string
  hasChapters: boolean
}

export const ExportPanel: FC<ExportPanelProps> = ({
  projectId,
  projectName,
  hasChapters,
}) => {
  const [progress, setProgress] = useState<{
    current: number
    total: number
  } | null>(null)

  const exporting = progress !== null

  const handleExport = async () => {
    const outputPath = await save({
      filters: [{ name: 'Comic Book Archive', extensions: ['cbz'] }],
      defaultPath: `${projectName}.cbz`,
    })
    if (!outputPath) return

    setProgress({ current: 0, total: 0 })

    const path = outputPath as string

    const channel = new Channel<ExportEvent>()
    channel.onmessage = (event) => {
      if (event.type === 'progress') {
        setProgress({ current: event.current, total: event.total })
      } else if (event.type === 'done') {
        setProgress(null)
        toast({
          title: 'CBZ created',
          description: path,
          action: {
            label: 'Show in folder',
            onClick: () => revealItemInDir(path),
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
      await api.createCbz(projectId, outputPath as string, channel)
    } catch (e) {
      setProgress(null)
      toast({
        title: 'Export failed',
        description: String(e),
      })
    }
  }

  return (
    <div className="flex items-center justify-end gap-3 border-border border-t bg-background px-4 py-3">
      <div className="flex flex-1 flex-col gap-1.5">
        <p className="text-foreground-secondary text-xs">
          {exporting
            ? 'Exporting…'
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
      </div>
      <Button
        onClick={handleExport}
        disabled={!hasChapters || exporting}
        size="sm"
      >
        <Archive className="size-4" />
        Export CBZ
      </Button>
    </div>
  )
}
