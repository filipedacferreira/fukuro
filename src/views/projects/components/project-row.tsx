import { zodResolver } from '@hookform/resolvers/zod'
import { Channel } from '@tauri-apps/api/core'
import { save } from '@tauri-apps/plugin-dialog'
import { revealItemInDir } from '@tauri-apps/plugin-opener'
import { Archive, MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
import type { FC } from 'react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { CoverDialog } from '@/components/cover-dialog'
import { CoverThumbnail } from '@/components/cover-thumbnail'
import { Button, IconButton } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Menu } from '@/components/ui/menu'
import { toast } from '@/components/ui/toaster'
import { api } from '@/lib/tauri'
import type { RenameValues } from '@/lib/validation'
import { renameSchema } from '@/lib/validation'
import type { CoverInfo, ExportEvent, Project } from '@/types'

interface ProjectRenameDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  name: string
  onSubmit: (values: RenameValues) => Promise<void>
}

const ProjectRenameDialog: FC<ProjectRenameDialogProps> = ({
  open,
  onOpenChange,
  name,
  onSubmit,
}) => {
  const {
    register,
    handleSubmit,
    reset,
    formState: { isSubmitting },
  } = useForm<RenameValues>({
    resolver: zodResolver(renameSchema),
    defaultValues: { name },
  })

  // Sync the default value when name changes (e.g. after a successful rename)
  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) reset({ name })
    onOpenChange(nextOpen)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <Dialog.Content className="w-80">
        <Dialog.Title>Rename project</Dialog.Title>
        <form
          onSubmit={handleSubmit(onSubmit)}
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
  )
}

interface ProjectDeleteDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  name: string
  onDelete: () => void
}

const ProjectDeleteDialog: FC<ProjectDeleteDialogProps> = ({
  open,
  onOpenChange,
  name,
  onDelete,
}) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <Dialog.Content className="w-80">
      <Dialog.Title>Delete &ldquo;{name}&rdquo;?</Dialog.Title>
      <Dialog.Description>
        This removes the project from fukuro. Your manga files won't be deleted.
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
)

interface ProjectRowProps {
  project: Project
  onOpen: (project: Project) => void
  onDelete: () => void
  onRename: (id: string, newName: string) => void
}

export const ProjectRow: FC<ProjectRowProps> = ({
  project,
  onOpen,
  onDelete,
  onRename,
}) => {
  const [localName, setLocalName] = useState(project.name)
  const [exporting, setExporting] = useState(false)
  const [cover, setCover] = useState<CoverInfo>({
    coverPath: project.coverPath,
    anilistId: project.anilistId,
    coverTitle: project.coverTitle,
  })
  // Seed with Date.now() so the URL is unique per session, preventing stale cache across restarts.
  const [coverVersion, setCoverVersion] = useState(() => Date.now())
  const [coverDialogOpen, setCoverDialogOpen] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [renameDialogOpen, setRenameDialogOpen] = useState(false)

  const date = new Date(project.createdAt * 1000).toLocaleDateString(
    undefined,
    { year: 'numeric', month: 'short', day: 'numeric' },
  )

  const handleExport = async () => {
    const outputPath = await save({
      filters: [{ name: 'Comic Book Archive', extensions: ['cbz'] }],
      defaultPath: `${localName}.cbz`,
    })
    if (!outputPath) return

    setExporting(true)
    const path = outputPath as string
    const channel = new Channel<ExportEvent>()
    channel.onmessage = (event) => {
      if (event.type === 'done') {
        setExporting(false)
        toast({
          title: 'CBZ created',
          description: path,
          action: {
            label: 'Show in folder',
            onClick: () => revealItemInDir(path),
          },
        })
      } else if (event.type === 'error') {
        setExporting(false)
        toast({ title: 'Export failed', description: event.message })
      }
    }

    try {
      await api.createCbz(project.id, path, channel)
    } catch (e) {
      setExporting(false)
      toast({ title: 'Export failed', description: String(e) })
    }
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

  return (
    <>
      <li className="group has-[[data-card-trigger]:focus-visible]:ring-(length:--ring-width) relative flex items-center gap-3 rounded-xl border border-border bg-background px-3 py-3 ring-ring transition has-[[data-card-trigger]:hover]:bg-background-secondary has-[[data-card-trigger]:focus-visible]:ring-inset">
        <button
          type="button"
          data-card-trigger
          aria-label={`Open ${localName}`}
          className="absolute inset-0 cursor-pointer rounded-xl outline-none transition active:bg-foreground/5"
          onClick={() => onOpen({ ...project, name: localName, ...cover })}
        />

        {/* Cover thumbnail — sits above overlay via z-10 */}
        <div className="relative z-10 shrink-0">
          <CoverThumbnail
            coverPath={cover.coverPath}
            coverVersion={coverVersion}
            size="lg"
            onClick={() => setCoverDialogOpen(true)}
          />
        </div>

        {/* Text content — pointer-events-none so clicks fall through to the overlay */}
        <div className="pointer-events-none relative z-10 min-w-0 flex-1">
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
              <Menu.Item onSelect={() => setRenameDialogOpen(true)}>
                <Pencil className="size-4" />
                Rename
              </Menu.Item>
              <Menu.Item onSelect={handleExport} disabled={exporting}>
                <Archive className="size-4" />
                Export CBZ
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

      <ProjectRenameDialog
        open={renameDialogOpen}
        onOpenChange={setRenameDialogOpen}
        name={localName}
        onSubmit={commit}
      />

      <ProjectDeleteDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        name={localName}
        onDelete={onDelete}
      />

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
    </>
  )
}
