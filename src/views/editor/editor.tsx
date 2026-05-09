import { convertFileSrc } from '@tauri-apps/api/core'
import { ArrowLeft, BookImage } from 'lucide-react'
import { motion } from 'motion/react'
import type { FC } from 'react'
import { useEffect, useState } from 'react'
import { CoverDialog } from '@/components/cover-dialog'
import { IconButton } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from '@/components/ui/toaster'
import { api } from '@/lib/tauri'
import type { Chapter } from '@/types'
import { ChapterList } from './components/chapter-list'
import { ExportPanel } from './components/export-panel'

interface EditorProps {
  projectId: string
  projectName: string
  initialCoverPath: string | null
  onBack: () => void
}

export const Editor: FC<EditorProps> = ({
  projectId,
  projectName,
  initialCoverPath,
  onBack,
}) => {
  const [chapters, setChapters] = useState<Chapter[]>([])
  const [loading, setLoading] = useState(true)
  const [coverPath, setCoverPath] = useState(initialCoverPath)
  const [coverDialogOpen, setCoverDialogOpen] = useState(false)

  useEffect(() => {
    api
      .getProjectChapters(projectId)
      .then(setChapters)
      .catch((e) =>
        toast({
          title: 'Failed to load chapters',
          description: String(e),
        }),
      )
      .finally(() => setLoading(false))
  }, [projectId])

  const handleReorder = async (newChapters: Chapter[]) => {
    setChapters(newChapters)
    try {
      await api.reorderChapters(newChapters.map((c) => c.id))
    } catch (e) {
      toast({
        title: 'Failed to save order',
        description: String(e),
      })
    }
  }

  const handleExclusionChange = (chapterId: string, delta: number) => {
    setChapters((prev) =>
      prev.map((c) =>
        c.id === chapterId
          ? { ...c, excludedCount: Math.max(0, c.excludedCount + delta) }
          : c,
      ),
    )
  }

  const handleImageDeleted = (chapterId: string) => {
    setChapters((prev) =>
      prev.map((c) =>
        c.id === chapterId
          ? { ...c, imageCount: Math.max(0, c.imageCount - 1) }
          : c,
      ),
    )
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-border border-b px-4 py-3">
        <IconButton
          variant="ghost"
          size="sm"
          aria-label="Back to projects"
          title="Back to projects"
          onClick={onBack}
        >
          <ArrowLeft className="size-4" />
        </IconButton>

        {/* Compact cover thumbnail — click to open cover dialog */}
        <button
          type="button"
          aria-label="Change cover"
          className="focus-visible:ring-(length:--ring-width) shrink-0 cursor-pointer overflow-hidden rounded outline-none ring-ring focus-visible:ring-inset"
          onClick={() => setCoverDialogOpen(true)}
        >
          {coverPath ? (
            <img
              src={convertFileSrc(coverPath)}
              alt="Cover"
              className="h-8 w-auto rounded object-cover"
            />
          ) : (
            <div className="flex h-8 w-6 items-center justify-center rounded bg-background-secondary">
              <BookImage className="size-3.5 text-foreground-secondary" />
            </div>
          )}
        </button>

        <h1 className="flex-1 truncate font-semibold text-sm">{projectName}</h1>
      </header>

      <CoverDialog
        projectId={projectId}
        coverPath={coverPath}
        open={coverDialogOpen}
        onOpenChange={setCoverDialogOpen}
        onCoverChange={setCoverPath}
      />

      <div className="flex flex-1 flex-col overflow-hidden">
        <motion.div layoutScroll className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="space-y-1 p-4">
              {Array.from({ length: 5 }).map((_, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: static-length skeleton list
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
