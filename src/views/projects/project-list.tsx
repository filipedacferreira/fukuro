import { zodResolver } from '@hookform/resolvers/zod'
import { convertFileSrc } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import {
  BookImage,
  FolderOpen,
  MoreHorizontal,
  Pencil,
  Trash2,
} from 'lucide-react'
import type { FC } from 'react'
import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { CoverDialog } from '@/components/cover-dialog'
import { Button, IconButton } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Menu } from '@/components/ui/menu'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from '@/components/ui/toaster'
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
              <Skeleton key={i} className="h-[88px] w-full rounded-xl" />
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
  const [localName, setLocalName] = useState(project.name)
  const [coverPath, setCoverPath] = useState(project.coverPath)
  const [coverDialogOpen, setCoverDialogOpen] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [renameDialogOpen, setRenameDialogOpen] = useState(false)

  const {
    register,
    handleSubmit,
    reset,
    formState: { isSubmitting },
  } = useForm<RenameValues>({
    resolver: zodResolver(renameSchema),
    defaultValues: { name: project.name },
  })

  const openRenameDialog = () => {
    reset({ name: localName })
    setRenameDialogOpen(true)
  }

  const commit = async ({ name }: RenameValues) => {
    try {
      if (name !== localName) {
        await api.renameProject(project.id, name)
        setLocalName(name)
        onRename(project.id, name)
      }
      setRenameDialogOpen(false)
    } catch (e) {
      toast({ title: 'Failed to rename project', description: String(e) })
    }
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
    <>
      <li className="group has-[[data-card-trigger]:focus-visible]:ring-(length:--ring-width) relative flex items-center gap-3 rounded-xl border border-border bg-background px-3 py-3 ring-ring transition has-[[data-card-trigger]:hover]:bg-background-secondary has-[[data-card-trigger]:focus-visible]:ring-inset">
        <button
          type="button"
          data-card-trigger
          aria-label={`Open ${localName}`}
          className="absolute inset-0 cursor-pointer rounded-xl outline-none transition active:bg-foreground/5"
          onClick={() => onOpen(coverPath)}
        />

        {/* Cover thumbnail — sits above overlay via z-10 */}
        <button
          type="button"
          aria-label="Change cover"
          className="focus-visible:ring-(length:--ring-width) relative z-10 shrink-0 cursor-pointer overflow-hidden rounded-lg outline-none ring-ring focus-visible:ring-inset"
          onClick={() => setCoverDialogOpen(true)}
        >
          {coverPath ? (
            <img
              src={convertFileSrc(coverPath)}
              alt="Cover"
              className="h-24 w-16 object-cover"
            />
          ) : (
            <div className="flex h-24 w-16 items-center justify-center bg-background-secondary">
              <BookImage className="size-5 text-foreground-secondary" />
            </div>
          )}
        </button>

        {/* Text content — pointer-events-none so clicks fall through to the overlay */}
        <div className="relative z-10 min-w-0 flex-1 pointer-events-none">
          <div className="flex flex-col gap-0.5">
            <span className="truncate font-medium">{localName}</span>
            <span className="truncate text-foreground-secondary text-xs">
              {project.rootPath}
            </span>
            <span className="text-foreground-secondary text-xs">
              {project.chapterCount}{' '}
              {project.chapterCount === 1 ? 'chapter' : 'chapters'} · {date}
            </span>
          </div>
        </div>

        {/* Three-dot actions menu — sits above overlay via z-10 */}
        <div className="relative z-10 shrink-0">
          <Menu>
            <Menu.Trigger asChild>
              <IconButton
                variant="ghost"
                size="sm"
                aria-label="More actions"
                className="opacity-0 transition focus-visible:opacity-100 group-hover:opacity-100"
              >
                <MoreHorizontal className="size-4" />
              </IconButton>
            </Menu.Trigger>
            <Menu.Items>
              <Menu.Item onSelect={openRenameDialog}>
                <Pencil className="size-4" />
                Rename
              </Menu.Item>
              <Menu.Divider />
              <Menu.Item
                variant="destructive"
                onSelect={() => setDeleteDialogOpen(true)}
              >
                <Trash2 className="size-4" />
                Delete
              </Menu.Item>
            </Menu.Items>
          </Menu>
        </div>
      </li>

      <Dialog open={renameDialogOpen} onOpenChange={setRenameDialogOpen}>
        <Dialog.Content className="w-80">
          <Dialog.Title>Rename project</Dialog.Title>
          <form
            onSubmit={handleSubmit(commit)}
            className="mt-4 flex flex-col gap-4"
          >
            <Input
              {...register('name')}
              ref={(el) => {
                register('name').ref(el)
                if (el) {
                  el.focus()
                  el.select()
                }
              }}
            />
            <Dialog.Actions>
              <Button type="submit" isLoading={isSubmitting}>
                Rename
              </Button>
              <Dialog.Close asChild>
                <Button variant="outline" type="button">
                  Cancel
                </Button>
              </Dialog.Close>
            </Dialog.Actions>
          </form>
        </Dialog.Content>
      </Dialog>

      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
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
