import { open } from '@tauri-apps/plugin-dialog'
import { FolderOpen, Pencil, Trash2 } from 'lucide-react'
import type { FC } from 'react'
import { useEffect, useRef, useState } from 'react'
import { Button, IconButton } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from '@/components/ui/toaster'
import { Tooltip } from '@/components/ui/tooltip'
import { api } from '@/lib/tauri'
import type { Project } from '@/types'

interface ProjectListProps {
  onOpenProject: (id: string, name: string) => void
}

export const ProjectList: FC<ProjectListProps> = ({ onOpenProject }) => {
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [opening, setOpening] = useState(false)

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
    setOpening(true)
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: 'Select manga folder',
      })
      if (!selected) return
      const project = await api.createProject(selected as string)
      setProjects((prev) => [project, ...prev])
      onOpenProject(project.id, project.name)
    } catch (e) {
      toast({
        title: 'Failed to open folder',
        description: String(e),
      })
    } finally {
      setOpening(false)
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
        <Button onClick={handleOpenFolder} isLoading={opening} size="sm">
          <FolderOpen className="size-4" />
          Open folder
        </Button>
      </header>

      <main className="flex-1 overflow-y-auto p-4">
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: static-length skeleton list
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
  opening: boolean
}

const EmptyState: FC<EmptyStateProps> = ({ onOpen, opening }) => (
  <div className="flex h-full min-h-[400px] flex-col items-center justify-center gap-4 text-center">
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
    <Button onClick={onOpen} isLoading={opening} variant="outline">
      <FolderOpen className="size-4" />
      Open a manga folder
    </Button>
  </div>
)

interface ProjectRowProps {
  project: Project
  onOpen: () => void
  onDelete: () => void
  onRename: (id: string, newName: string) => void
}

const ProjectRow: FC<ProjectRowProps> = ({
  project,
  onOpen,
  onDelete,
  onRename,
}) => {
  const [isRenaming, setIsRenaming] = useState(false)
  const [draft, setDraft] = useState('')
  const [localName, setLocalName] = useState(project.name)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isRenaming) inputRef.current?.focus()
  }, [isRenaming])

  const startRenaming = () => {
    setDraft(localName)
    setIsRenaming(true)
  }

  const cancelRename = () => {
    setIsRenaming(false)
    setDraft('')
  }

  const commitRename = async () => {
    const trimmed = draft.trim()
    if (trimmed && trimmed !== localName) {
      try {
        await api.renameProject(project.id, trimmed)
        setLocalName(trimmed)
        onRename(project.id, trimmed)
      } catch (e) {
        toast({
          title: 'Failed to rename project',
          description: String(e),
        })
      }
    }
    setIsRenaming(false)
    setDraft('')
  }

  const date = new Date(project.createdAt * 1000).toLocaleDateString(
    undefined,
    {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    },
  )

  return (
    <li className="group relative rounded-xl border border-border bg-background transition hover:bg-background-secondary active:bg-foreground/5">
      <button
        type="button"
        className="focus-visible:ring-(length:--ring-width) flex w-full flex-col gap-0.5 rounded-xl px-4 py-3 text-left outline-none ring-ring transition focus-visible:ring-inset"
        style={{ cursor: isRenaming ? 'default' : 'pointer' }}
        onClick={() => {
          if (!isRenaming) onOpen()
        }}
      >
        <div className="flex items-center gap-2">
          {isRenaming ? (
            <input
              ref={inputRef}
              className="min-w-0 flex-1 rounded bg-transparent font-medium text-foreground outline-none transition"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitRename()
                if (e.key === 'Escape') cancelRename()
              }}
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <>
              <span className="truncate font-medium">{localName}</span>
              <Tooltip>
                <Tooltip.Trigger asChild>
                  <button
                    type="button"
                    aria-label="Rename project"
                    className="focus-visible:ring-(length:--ring-width) -m-1 shrink-0 cursor-pointer rounded p-1 text-foreground-secondary opacity-0 ring-ring transition hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none active:opacity-70 group-hover:opacity-100"
                    onClick={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      startRenaming()
                    }}
                  >
                    <Pencil className="size-3.5" />
                  </button>
                </Tooltip.Trigger>
                <Tooltip.Content>Rename</Tooltip.Content>
              </Tooltip>
            </>
          )}
        </div>
        <Tooltip placement="bottom-start">
          <Tooltip.Trigger asChild>
            <span className="max-w-[500px] cursor-default truncate text-foreground-secondary text-xs">
              {project.rootPath}
            </span>
          </Tooltip.Trigger>
          <Tooltip.Content>{project.rootPath}</Tooltip.Content>
        </Tooltip>
        <span className="text-foreground-secondary text-xs">
          {project.chapterCount}{' '}
          {project.chapterCount === 1 ? 'chapter' : 'chapters'} · {date}
        </span>
      </button>

      <div className="absolute top-1/2 right-3 -translate-y-1/2">
        <Dialog>
          <Tooltip>
            <Dialog.Trigger asChild>
              <Tooltip.Trigger asChild>
                <IconButton
                  variant="ghost"
                  size="sm"
                  aria-label="Delete project"
                  className="opacity-0 transition focus-visible:opacity-100 group-hover:opacity-100"
                >
                  <Trash2 className="size-4" />
                </IconButton>
              </Tooltip.Trigger>
            </Dialog.Trigger>
            <Tooltip.Content>Delete</Tooltip.Content>
          </Tooltip>
          <Dialog.Content className="w-80">
            <Dialog.Title>Delete &ldquo;{localName}&rdquo;?</Dialog.Title>
            <Dialog.Description>
              This removes the project from fukuro. Your manga files won't be
              deleted.
            </Dialog.Description>
            <Dialog.Actions>
              <Dialog.Close asChild>
                <Button variant="destructive" onClick={onDelete}>
                  Delete
                </Button>
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
