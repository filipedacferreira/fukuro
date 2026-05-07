import { useEffect, useState } from 'react'
import { open } from '@tauri-apps/plugin-dialog'
import { FolderOpen, Trash2 } from 'lucide-react'
import { Button, IconButton } from '@/foundations/ui/button/button'
import { Skeleton } from '@/foundations/ui/skeleton/skeleton'
import { Dialog } from '@/foundations/ui/dialog/dialog'
import { toast } from '@/foundations/ui/toaster/toaster'
import { api } from '@/lib/tauri'
import type { Project } from '@/types'

interface ProjectListProps {
  onOpenProject: (id: string, name: string) => void
}

export function ProjectList({ onOpenProject }: ProjectListProps) {
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [opening, setOpening] = useState(false)

  useEffect(() => {
    api.listProjects()
      .then(setProjects)
      .catch((e) => toast({ title: 'Failed to load projects', description: String(e), variant: 'negative' }))
      .finally(() => setLoading(false))
  }, [])

  const handleOpenFolder = async () => {
    setOpening(true)
    try {
      const selected = await open({ directory: true, multiple: false, title: 'Select manga folder' })
      if (!selected) return
      const project = await api.createProject(selected as string)
      setProjects((prev) => [project, ...prev])
      onOpenProject(project.id, project.name)
    } catch (e) {
      toast({ title: 'Failed to open folder', description: String(e), variant: 'negative' })
    } finally {
      setOpening(false)
    }
  }

  const handleDelete = async (id: string) => {
    try {
      await api.deleteProject(id)
      setProjects((prev) => prev.filter((p) => p.id !== id))
      toast({ title: 'Project deleted', variant: 'default' })
    } catch (e) {
      toast({ title: 'Failed to delete project', description: String(e), variant: 'negative' })
    }
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-border px-6 py-4">
        <div className="flex items-center gap-2">
          <span className="text-base leading-none">梟</span>
          <h1 className="text-base font-semibold">Fukurō</h1>
        </div>
        <Button onClick={handleOpenFolder} isLoading={opening} size="sm">
          <FolderOpen className="size-4" />
          Open folder
        </Button>
      </header>

      <main className="flex-1 overflow-y-auto px-6 py-6">
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full rounded-xl" />
            ))}
          </div>
        ) : projects.length === 0 ? (
          <EmptyState onOpen={handleOpenFolder} opening={opening} />
        ) : (
          <ul className="space-y-2">
            {projects.map((project) => (
              <ProjectRow
                key={project.id}
                project={project}
                onOpen={() => onOpenProject(project.id, project.name)}
                onDelete={() => handleDelete(project.id)}
              />
            ))}
          </ul>
        )}
      </main>
    </div>
  )
}

function EmptyState({ onOpen, opening }: { onOpen: () => void; opening: boolean }) {
  return (
    <div className="flex h-full min-h-[400px] flex-col items-center justify-center gap-4 text-center">
      <div className="rounded-2xl border border-border bg-background-secondary p-6">
        <span className="text-5xl leading-none text-foreground-secondary">梟</span>
      </div>
      <div>
        <p className="font-medium">No manga projects yet</p>
        <p className="mt-1 text-sm text-foreground-secondary">
          Open a folder containing chapter subfolders to get started.
        </p>
      </div>
      <Button onClick={onOpen} isLoading={opening} variant="outline">
        <FolderOpen className="size-4" />
        Open a manga folder
      </Button>
    </div>
  )
}

interface ProjectRowProps {
  project: Project
  onOpen: () => void
  onDelete: () => void
}

function ProjectRow({ project, onOpen, onDelete }: ProjectRowProps) {
  const date = new Date(project.createdAt * 1000).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })

  return (
    <li className="group relative rounded-xl border border-border bg-background transition hover:bg-background-secondary active:bg-foreground/5">
      <button
        className="flex w-full cursor-pointer flex-col gap-0.5 px-4 py-3 text-left"
        onClick={onOpen}
      >
        <span className="font-medium">{project.name}</span>
        <span className="max-w-[500px] truncate text-xs text-foreground-secondary">
          {project.rootPath}
        </span>
        <span className="text-xs text-foreground-secondary">
          {project.chapterCount} {project.chapterCount === 1 ? 'chapter' : 'chapters'} · {date}
        </span>
      </button>

      <div className="absolute right-3 top-1/2 -translate-y-1/2">
        <Dialog>
          <Dialog.Trigger asChild>
            <IconButton
              variant="ghost"
              size="sm"
              aria-label="Delete project"
              title="Delete project"
              className="opacity-0 transition-opacity group-hover:opacity-100"
            >
              <Trash2 className="size-4" />
            </IconButton>
          </Dialog.Trigger>
          <Dialog.Content className="w-80">
            <Dialog.Title>Delete project?</Dialog.Title>
            <Dialog.Description>
              This removes the project from fukuro. Your manga files won't be deleted.
            </Dialog.Description>
            <Dialog.Actions>
              <Dialog.Close asChild>
                <Button variant="destructive" onClick={onDelete}>Delete</Button>
              </Dialog.Close>
              <Dialog.Close asChild>
                <Button variant="outline">Cancel</Button>
              </Dialog.Close>
            </Dialog.Actions>
          </Dialog.Content>
        </Dialog>
      </div>
    </li>
  )
}
