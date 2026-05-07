import { useEffect, useState } from 'react'
import { motion } from 'motion/react'
import { ArrowLeft } from 'lucide-react'
import { IconButton } from '@/foundations/ui/button/button'
import { Skeleton } from '@/foundations/ui/skeleton/skeleton'
import { toast } from '@/foundations/ui/toaster/toaster'
import { ChapterList } from '@/components/ChapterList'
import { ExportPanel } from '@/components/ExportPanel'
import { api } from '@/lib/tauri'
import type { Chapter } from '@/types'

interface EditorProps {
  projectId: string
  projectName: string
  onBack: () => void
}

export function Editor({ projectId, projectName, onBack }: EditorProps) {
  const [chapters, setChapters] = useState<Chapter[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.getProjectChapters(projectId)
      .then(setChapters)
      .catch((e) => toast({ title: 'Failed to load chapters', description: String(e), variant: 'negative' }))
      .finally(() => setLoading(false))
  }, [projectId])

  const handleReorder = async (newChapters: Chapter[]) => {
    setChapters(newChapters)
    try {
      await api.reorderChapters(newChapters.map((c) => c.id))
    } catch (e) {
      toast({ title: 'Failed to save order', description: String(e), variant: 'negative' })
    }
  }

  const handleExclusionChange = (chapterId: string, delta: number) => {
    setChapters((prev) =>
      prev.map((c) =>
        c.id === chapterId
          ? { ...c, excludedCount: Math.max(0, c.excludedCount + delta) }
          : c
      )
    )
  }

  const handleImageDeleted = (chapterId: string) => {
    setChapters((prev) =>
      prev.map((c) =>
        c.id === chapterId
          ? { ...c, imageCount: Math.max(0, c.imageCount - 1) }
          : c
      )
    )
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-border px-4 py-3">
        <IconButton
          variant="ghost"
          size="sm"
          aria-label="Back to projects"
          title="Back to projects"
          onClick={onBack}
        >
          <ArrowLeft className="size-4" />
        </IconButton>
        <h1 className="flex-1 truncate text-sm font-semibold">{projectName}</h1>
      </header>

      <div className="flex flex-1 flex-col overflow-hidden">
        <motion.div layoutScroll className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="space-y-1 p-4">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full rounded-xl" />
              ))}
            </div>
          ) : (
            <ChapterList
              chapters={chapters}
              onReorder={handleReorder}
onExclusionChange={handleExclusionChange}
              onImageDeleted={handleImageDeleted}
            />
          )}
        </motion.div>

        <ExportPanel projectId={projectId} hasChapters={chapters.length > 0} />
      </div>
    </div>
  )
}
