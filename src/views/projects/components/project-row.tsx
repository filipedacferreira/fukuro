import { zodResolver } from '@hookform/resolvers/zod'
import { Channel } from '@tauri-apps/api/core'
import { save } from '@tauri-apps/plugin-dialog'
import { revealItemInDir } from '@tauri-apps/plugin-opener'
import { Archive, MoreHorizontal, Pencil, Send, Trash2 } from 'lucide-react'
import type { FC } from 'react'
import { useEffect, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { CoverDialog } from '@/components/cover-dialog'
import { CoverThumbnail } from '@/components/cover-thumbnail'
import { Button, IconButton } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Menu } from '@/components/ui/menu'
import { toast } from '@/components/ui/toaster'
import { useKoboSync } from '@/hooks/use-kobo-sync'
import { formatRelativeTime } from '@/lib/kobo'
import { api } from '@/lib/tauri'
import type { RenameValues } from '@/lib/validation'
import { renameSchema } from '@/lib/validation'
import type { CoverInfo, ExportEvent, KoboDevice, Project } from '@/types'

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
      <Dialog.Content className="w-96">
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
  onDelete: () => Promise<void>
}

const ProjectDeleteDialog: FC<ProjectDeleteDialogProps> = ({
  open,
  onOpenChange,
  name,
  onDelete,
}) => {
  const [deleting, setDeleting] = useState(false)

  const handleConfirm = async () => {
    setDeleting(true)
    try {
      await onDelete()
      onOpenChange(false) // close only once the delete actually succeeded
    } catch {
      // Already toasted by the caller (project-list.tsx's handleDelete) — just stop the
      // loading state and leave the dialog open so the user can retry or cancel.
    } finally {
      setDeleting(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && deleting) return // ignore Escape/backdrop-close mid-delete
        onOpenChange(next)
      }}
    >
      <Dialog.Content className="w-96">
        <Dialog.Title className="wrap-break-word">
          Delete &ldquo;{name}&rdquo;?
        </Dialog.Title>
        <Dialog.Description>
          This permanently deletes the folder and all its chapters from your
          disk. This can't be undone.
        </Dialog.Description>
        <Dialog.Actions>
          {/* Not wrapped in Dialog.Close: Foundations' Slot always lets a child's own
              onClick override Close's (last props spread wins), so a button that both
              performs an action and closes the dialog can't use asChild here — it has to
              close explicitly, only once the delete succeeds (see handleConfirm above). */}
          <Button
            variant="destructive"
            onClick={handleConfirm}
            isLoading={deleting}
            disabled={deleting}
          >
            Delete
          </Button>
          <Dialog.Close asChild>
            <Button variant="outline" disabled={deleting}>
              Cancel
            </Button>
          </Dialog.Close>
        </Dialog.Actions>
      </Dialog.Content>
    </Dialog>
  )
}

interface ProjectRowProps {
  project: Project
  onOpen: (project: Project) => void
  onDelete: () => Promise<void>
  onRename: (id: string, newName: string) => void
  koboDevice: KoboDevice | null
  onSynced: (patch: Pick<Project, 'lastKoboExportAt' | 'lastSyncedAt'>) => void
}

export const ProjectRow: FC<ProjectRowProps> = ({
  project,
  onOpen,
  onDelete,
  onRename,
  koboDevice,
  onSynced,
}) => {
  const [localName, setLocalName] = useState(project.name)
  const [exporting, setExporting] = useState(false)
  const { sync: syncToKobo, syncing } = useKoboSync(project, onSynced)
  const [cover, setCover] = useState<CoverInfo>({
    coverPath: project.coverPath,
    coverThumbnailPath: project.coverThumbnailPath,
    anilistId: project.anilistId,
    coverTitle: project.coverTitle,
  })
  // Seed with Date.now() so the URL is unique per session, preventing stale cache across restarts.
  const [coverVersion, setCoverVersion] = useState(() => Date.now())
  const [coverDialogOpen, setCoverDialogOpen] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [renameDialogOpen, setRenameDialogOpen] = useState(false)

  // Re-sync the cover from props when it changes externally — e.g. a background
  // Anilist auto-lookup (see cover.rs::spawn_auto_cover_lookup) or the bulk backfill
  // resolves and the parent's `projects` array updates via the `projects-updated` event.
  // Manual edits made through CoverDialog only ever change local `cover` state, never the
  // `project` prop, so they never re-trigger this effect. Skips the first run so mounting
  // doesn't immediately bust the cache-busting `coverVersion` it was just initialised with.
  const skipNextCoverSync = useRef(true)
  useEffect(() => {
    if (skipNextCoverSync.current) {
      skipNextCoverSync.current = false
      return
    }
    setCover({
      coverPath: project.coverPath,
      coverThumbnailPath: project.coverThumbnailPath,
      anilistId: project.anilistId,
      coverTitle: project.coverTitle,
    })
    setCoverVersion(Date.now())
  }, [
    project.coverPath,
    project.coverThumbnailPath,
    project.anilistId,
    project.coverTitle,
  ])

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
        <div className="relative z-10 shrink-0 self-stretch">
          <CoverThumbnail
            coverPath={cover.coverPath}
            coverThumbnailPath={cover.coverThumbnailPath}
            coverVersion={coverVersion}
            size="lg"
            onClick={() => setCoverDialogOpen(true)}
          />
        </div>

        {/* Text content — pointer-events-none so clicks fall through to the overlay */}
        <div className="pointer-events-none relative z-10 min-w-0 flex-1">
          <div className="flex flex-col gap-0.5">
            <span className="truncate font-medium">{localName}</span>
            <span
              title={project.rootPath}
              className="max-w-1/2 truncate text-foreground-secondary text-xs"
            >
              {project.rootPath}
            </span>
            <span className="text-foreground-secondary text-xs">
              {project.chapterCount}{' '}
              {project.chapterCount === 1 ? 'chapter' : 'chapters'} · {date}
            </span>
            {project.lastExportedAt != null && (
              <span className="text-foreground-secondary text-xs">
                Last exported: {formatRelativeTime(project.lastExportedAt)}
              </span>
            )}
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
              {koboDevice && (
                <Menu.Item onSelect={syncToKobo} disabled={syncing}>
                  <Send className="size-4" />
                  Send to device
                </Menu.Item>
              )}
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
