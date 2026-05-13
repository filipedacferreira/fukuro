import { open } from '@tauri-apps/plugin-dialog'
import { FolderOpen } from 'lucide-react'
import type { FC } from 'react'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from '@/components/ui/toaster'
import { api } from '@/lib/tauri'
import type { Project } from '@/types'
import { ProjectRow } from './components/project-row'

interface ProjectListProps {
  onOpenProject: (project: Project) => void
}

export const ProjectList: FC<ProjectListProps> = ({ onOpenProject }) => {
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api
      .listProjects()
      .then(setProjects)
      .catch((e) =>
        toast({
          title: 'Failed to load projects',
          description: String(e),
        }),
      )
      .finally(() => setLoading(false))
  }, [])

  const handleOpenFolder = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: 'Select manga folder',
      })
      if (!selected) return
      const project = await api.createProject(selected as string)
      setProjects((prev) => [project, ...prev])
      onOpenProject(project)
    } catch (e) {
      toast({
        title: 'Failed to open folder',
        description: String(e),
      })
    }
  }

  const handleRename = (id: string, newName: string) => {
    setProjects((prev) =>
      prev.map((p) => (p.id === id ? { ...p, name: newName } : p)),
    )
  }

  const handleDelete = async (id: string) => {
    try {
      await api.deleteProject(id)
      setProjects((prev) => prev.filter((p) => p.id !== id))
      toast({ title: 'Project deleted' })
    } catch (e) {
      toast({
        title: 'Failed to delete project',
        description: String(e),
        variant: 'negative',
      })
    }
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-border border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-base leading-none">梟</span>
          <h1 className="font-semibold text-base">Fukurō</h1>
        </div>
        <Button onClick={handleOpenFolder} size="sm">
          <FolderOpen className="size-4" />
          Open folder
        </Button>
      </header>

      <main className="flex-1 overflow-y-auto p-4">
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: static-length skeleton list
              <Skeleton key={i} className="h-22 w-full rounded-xl" />
            ))}
          </div>
        ) : projects.length === 0 ? (
          <EmptyState onOpen={handleOpenFolder} />
        ) : (
          <ul className="space-y-2">
            {projects.map((project) => (
              <ProjectRow
                key={project.id}
                project={project}
                onOpen={onOpenProject}
                onDelete={() => handleDelete(project.id)}
                onRename={handleRename}
              />
            ))}
          </ul>
        )}
      </main>
    </div>
  )
}

interface EmptyStateProps {
  onOpen: () => void
}

const EmptyState: FC<EmptyStateProps> = ({ onOpen }) => (
  <div className="flex h-full min-h-100 flex-col items-center justify-center gap-4 text-center">
    <div className="rounded-2xl border border-border bg-background-secondary p-6">
      <span className="text-5xl text-foreground-secondary leading-none">
        梟
      </span>
    </div>
    <div>
      <p className="font-medium">No manga projects yet</p>
      <p className="mt-1 text-foreground-secondary text-sm">
        Open a folder containing chapter subfolders to get started.
      </p>
    </div>
    <Button onClick={onOpen} variant="outline">
      <FolderOpen className="size-4" />
      Open a manga folder
    </Button>
  </div>
)
