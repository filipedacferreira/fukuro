import { save } from '@tauri-apps/plugin-dialog'
import { revealItemInDir } from '@tauri-apps/plugin-opener'
import { Archive } from 'lucide-react'
import type { FC } from 'react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/toaster'
import { api } from '@/lib/tauri'

interface ExportPanelProps {
  projectId: string
  hasChapters: boolean
}

export const ExportPanel: FC<ExportPanelProps> = ({
  projectId,
  hasChapters,
}) => {
  const [exporting, setExporting] = useState(false)

  const handleExport = async () => {
    const outputPath = await save({
      filters: [{ name: 'Comic Book Archive', extensions: ['cbz'] }],
      defaultPath: 'manga.cbz',
    })
    if (!outputPath) return

    setExporting(true)
    try {
      await api.createCbz(projectId, outputPath as string)
      toast({
        title: 'CBZ created',
        description: outputPath as string,
        action: {
          label: 'Show in folder',
          onClick: () => revealItemInDir(outputPath as string),
        },
      })
    } catch (e) {
      toast({
        title: 'Export failed',
        description: String(e),
      })
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="flex items-center justify-end gap-3 border-border border-t bg-background px-4 py-3">
      <p className="flex-1 text-foreground-secondary text-xs">
        Images marked as excluded will be skipped during export.
      </p>
      <Button
        onClick={handleExport}
        isLoading={exporting}
        disabled={!hasChapters || exporting}
        size="sm"
      >
        <Archive className="size-4" />
        Export CBZ
      </Button>
    </div>
  )
}
