import { zodResolver } from '@hookform/resolvers/zod'
import { convertFileSrc } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import { BookImage, FolderOpen, Pencil, Trash2 } from 'lucide-react'
import type { FC } from 'react'
import { useEffect, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { CoverDialog } from '@/components/cover-dialog'
import { Button, IconButton } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from '@/components/ui/toaster'
import { Tooltip } from '@/components/ui/tooltip'
import { api } from '@/lib/tauri'
import type { Project } from '@/types'

const renameSchema = z.object({
  name: z.string().trim().min(1, 'Name cannot be empty'),
})
type RenameValues = z.infer<typeof renameSchema>

interface ProjectListProps {
  onOpenProject: (id: string, name: string, coverPath: string | null) => void
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
      onOpenProject(project.id, project.name, project.coverPath)
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
                onOpen={(coverPath) =>
                  onOpenProject(project.id, project.name, coverPath)
                }
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
  onOpen: (coverPath: string | null) => void
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
  const [localName, setLocalName] = useState(project.name)
  const [coverPath, setCoverPath] = useState(project.coverPath)
  const [coverDialogOpen, setCoverDialogOpen] = useState(false)
  const submittingRef = useRef(false)

  const { register, handleSubmit, reset, setFocus } = useForm<RenameValues>({
    resolver: zodResolver(renameSchema),
    defaultValues: { name: project.name },
  })

  useEffect(() => {
    if (isRenaming) setFocus('name')
  }, [isRenaming, setFocus])

  const startRenaming = () => {
    reset({ name: localName })
    setIsRenaming(true)
  }

  const cancelRename = () => {
    reset()
    setIsRenaming(false)
  }

  const commit = async ({ name }: RenameValues) => {
    if (submittingRef.current) return
    submittingRef.current = true
    try {
      if (name !== localName) {
        await api.renameProject(project.id, name)
        setLocalName(name)
        onRename(project.id, name)
      }
    } catch (e) {
      toast({ title: 'Failed to rename project', description: String(e) })
    } finally {
      submittingRef.current = false
      setIsRenaming(false)
    }
  }

  const {
    ref: registerRef,
    onBlur: _rhfOnBlur,
    ...registerRest
  } = register('name')

  const date = new Date(project.createdAt * 1000).toLocaleDateString(
    undefined,
    {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    },
  )

  return (
    <>
      <li className="group relative flex items-center gap-3 rounded-xl border border-border bg-background px-3 py-3 transition hover:bg-background-secondary has-[[data-row-trigger]:active]:bg-foreground/5">
        {/* Cover thumbnail — separate button so it doesn't nest inside the card button */}
        <button
          type="button"
          aria-label="Change cover"
          className="focus-visible:ring-(length:--ring-width) shrink-0 cursor-pointer overflow-hidden rounded-lg outline-none ring-ring focus-visible:ring-inset"
          onClick={() => setCoverDialogOpen(true)}
        >
          {coverPath ? (
            <img
              src={convertFileSrc(coverPath)}
              alt="Cover"
              className="h-14 w-10 object-cover"
            />
          ) : (
            <div className="flex h-14 w-10 items-center justify-center bg-background-secondary">
              <BookImage className="size-4 text-foreground-secondary" />
            </div>
          )}
        </button>

        {/* Clickable text area */}
        <button
          type="button"
          data-row-trigger
          className="focus-visible:ring-(length:--ring-width) min-w-0 flex-1 rounded-lg text-left outline-none ring-ring transition focus-visible:ring-inset"
          style={{ cursor: isRenaming ? 'default' : 'pointer' }}
          onClick={() => {
            if (!isRenaming) onOpen(coverPath)
          }}
        >
          <div className="flex items-center gap-2">
            {isRenaming ? (
              <form onSubmit={handleSubmit(commit)} className="min-w-0 flex-1">
                <input
                  ref={registerRef}
                  {...registerRest}
                  className="w-full rounded bg-transparent font-medium text-foreground outline-none transition"
                  onBlur={handleSubmit(commit, cancelRename)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      e.preventDefault()
                      cancelRename()
                    }
                  }}
                  onClick={(e) => e.stopPropagation()}
                />
              </form>
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
          <span className="max-w-[500px] truncate text-foreground-secondary text-xs">
            {project.rootPath}
          </span>
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
      <CoverDialog
        projectId={project.id}
        coverPath={coverPath}
        open={coverDialogOpen}
        onOpenChange={setCoverDialogOpen}
        onCoverChange={setCoverPath}
      />
    </>
  )
}
