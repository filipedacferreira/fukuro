import { ArrowLeft } from 'lucide-react'
import { motion } from 'motion/react'
import type { FC } from 'react'
import { useEffect, useState } from 'react'
import { CoverDialog } from '@/components/cover-dialog'
import { CoverThumbnail } from '@/components/cover-thumbnail'
import { IconButton } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from '@/components/ui/toaster'
import { api } from '@/lib/tauri'
import type { Chapter, CoverInfo, Project } from '@/types'
import { ChapterList } from './components/chapter-list'
import { ExportPanel } from './components/export-panel'

interface EditorProps {
  project: Project
  onBack: () => void
}

export const Editor: FC<EditorProps> = ({ project, onBack }) => {
  const [chapters, setChapters] = useState<Chapter[]>([])
  const [loading, setLoading] = useState(true)
  const [cover, setCover] = useState<CoverInfo>({
    coverPath: project.coverPath,
    anilistId: project.anilistId,
    coverTitle: project.coverTitle,
  })
  // Seed with Date.now() so the URL is unique per session, preventing stale cache across restarts.
  const [coverVersion, setCoverVersion] = useState(() => Date.now())
  const [coverDialogOpen, setCoverDialogOpen] = useState(false)

  useEffect(() => {
    api
      .getProjectChapters(project.id)
      .then(setChapters)
      .catch((e) =>
        toast({
          title: 'Failed to load chapters',
          description: String(e),
        }),
      )
      .finally(() => setLoading(false))
  }, [project.id])

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

        <CoverThumbnail
          coverPath={cover.coverPath}
          coverVersion={coverVersion}
          size="sm"
          onClick={() => setCoverDialogOpen(true)}
        />

        <h1 className="flex-1 truncate font-semibold text-sm">
          {project.name}
        </h1>
      </header>

      <CoverDialog
        projectId={project.id}
        cover={cover}
        open={coverDialogOpen}
        onOpenChange={setCoverDialogOpen}
        onCoverChange={(newCover) => {
          setCover(newCover)
          setCoverVersion(Date.now())
        }}
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

        <ExportPanel projectId={project.id} projectName={project.name} hasChapters={chapters.length > 0} />
      </div>
    </div>
  )
}
