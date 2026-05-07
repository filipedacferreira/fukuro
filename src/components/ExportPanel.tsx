import { useState } from 'react'
import { save } from '@tauri-apps/plugin-dialog'
import { ArchiveIcon } from '@phosphor-icons/react/dist/ssr'
import { Button } from '@/foundations/ui/button/button'
import { toast } from '@/foundations/ui/toaster/toaster'
import { api } from '@/lib/tauri'

interface ExportPanelProps {
  projectId: string
  hasChapters: boolean
}

export function ExportPanel({ projectId, hasChapters }: ExportPanelProps) {
  const [exporting, setExporting] = useState(false)

  const handleExport = async () => {
    const outputPath = await save({
      filters: [{ name: 'Comic Book Archive', extensions: ['cbz'] }],
      defaultPath: 'manga.cbz',
    })
    if (!outputPath) return

    setExporting(true)
    try {
      const result = await api.createCbz(projectId, outputPath as string)
      toast({
        title: 'CBZ created',
        description: result,
        variant: 'positive',
      })
    } catch (e) {
      toast({ title: 'Export failed', description: String(e), variant: 'negative' })
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="flex items-center justify-end gap-3 border-t border-border bg-background px-4 py-3">
      <p className="text-xs text-foreground-secondary flex-1">
        Images marked as excluded will be skipped during export.
      </p>
      <Button
        onClick={handleExport}
        isLoading={exporting}
        disabled={!hasChapters || exporting}
        size="sm"
      >
        <ArchiveIcon />
        Export CBZ
      </Button>
    </div>
  )
}
