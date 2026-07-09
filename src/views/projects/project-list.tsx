import { listen } from '@tauri-apps/api/event'
import { open } from '@tauri-apps/plugin-dialog'
import { FolderCog, FolderOpen } from 'lucide-react'
import type { FC } from 'react'
import { useEffect, useState } from 'react'
import { Button, IconButton } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from '@/components/ui/toaster'
import { api } from '@/lib/tauri'
import type { Project } from '@/types'
import { ProjectRow } from './components/project-row'

interface ProjectListProps {
  onOpenProject: (project: Project) => void
}

export const ProjectList: FC<ProjectListProps> = ({ onOpenProject }) => {
  const [libraryRoot, setLibraryRootState] = useState<string | null>(null)
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [pendingRoot, setPendingRoot] = useState<string | null>(null)

  useEffect(() => {
    api
      .getLibraryRoot()
      .then(async (root) => {
        setLibraryRootState(root)
        if (!root) return
        setProjects(await api.listProjects())
      })
      .catch((e) =>
        toast({
          title: 'Failed to load projects',
          description: String(e),
        }),
      )
      .finally(() => setLoading(false))
  }, [])

  // The library watcher (started for the app's whole session, see watch.rs) emits this
  // whenever a manga folder is added or removed on disk, keeping this list live even if
  // the user alt-tabs to Explorer without leaving this screen.
  useEffect(() => {
    const unlisten = listen<Project[]>('projects-updated', (event) => {
      setProjects(event.payload)
    })
    return () => {
      unlisten.then((fn) => fn())
    }
  }, [])

  const pickFolder = (title: string) =>
    open({ directory: true, multiple: false, title }) as Promise<string | null>

  const handleSelectLibrary = async () => {
    try {
      const selected = await pickFolder('Select your manga library folder')
      if (!selected) return
      const newProjects = await api.setLibraryRoot(selected)
      setLibraryRootState(selected)
      setProjects(newProjects)
    } catch (e) {
      toast({
        title: 'Failed to open folder',
        description: String(e),
      })
    }
  }

  const handleChangeLibrary = async () => {
    try {
      const selected = await pickFolder('Select a new manga library folder')
      if (!selected) return
      setPendingRoot(selected)
    } catch (e) {
      toast({
        title: 'Failed to open folder',
        description: String(e),
      })
    }
  }

  const confirmChangeLibrary = async () => {
    if (!pendingRoot) return
    try {
      const newProjects = await api.setLibraryRoot(pendingRoot)
      setLibraryRootState(pendingRoot)
      setProjects(newProjects)
    } catch (e) {
      toast({
        title: 'Failed to switch library folder',
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
        {libraryRoot && (
          <IconButton
            variant="ghost"
            size="sm"
            aria-label="Change library folder"
            title="Change library folder"
            onClick={handleChangeLibrary}
          >
            <FolderCog className="size-4" />
          </IconButton>
        )}
      </header>

      <main className="flex-1 overflow-y-auto p-4">
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: static-length skeleton list
              <Skeleton key={i} className="h-22 w-full rounded-xl" />
            ))}
          </div>
        ) : !libraryRoot ? (
          <NoLibraryEmptyState onSelect={handleSelectLibrary} />
        ) : projects.length === 0 ? (
          <EmptyLibraryState libraryRoot={libraryRoot} />
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

      <ChangeLibraryDialog
        open={pendingRoot !== null}
        onOpenChange={(open) => {
          if (!open) setPendingRoot(null)
        }}
        newRoot={pendingRoot}
        onConfirm={confirmChangeLibrary}
      />
    </div>
  )
}

interface NoLibraryEmptyStateProps {
  onSelect: () => void
}

const NoLibraryEmptyState: FC<NoLibraryEmptyStateProps> = ({ onSelect }) => (
  <div className="flex h-full min-h-100 flex-col items-center justify-center gap-4 text-center">
    <div className="rounded-2xl border border-border bg-background-secondary p-6">
      <span className="text-5xl text-foreground-secondary leading-none">
        梟
      </span>
    </div>
    <div>
      <p className="font-medium">Set up your manga library</p>
      <p className="mt-1 max-w-sm text-foreground-secondary text-sm">
        Select the folder that holds your manga — each subfolder inside it
        becomes a project, and each subfolder inside those becomes a chapter.
        New folders are picked up automatically.
      </p>
    </div>
    <Button onClick={onSelect} variant="outline">
      <FolderOpen className="size-4" />
      Select library folder
    </Button>
  </div>
)

interface EmptyLibraryStateProps {
  libraryRoot: string
}

const EmptyLibraryState: FC<EmptyLibraryStateProps> = ({ libraryRoot }) => (
  <div className="flex h-full min-h-100 flex-col items-center justify-center gap-4 text-center">
    <div className="rounded-2xl border border-border bg-background-secondary p-6">
      <span className="text-5xl text-foreground-secondary leading-none">
        梟
      </span>
    </div>
    <div>
      <p className="font-medium">No manga folders yet</p>
      <p className="mt-1 max-w-sm text-foreground-secondary text-sm">
        Add manga folders inside{' '}
        <span className="wrap-break-word font-medium">{libraryRoot}</span> and
        they'll show up here automatically.
      </p>
    </div>
  </div>
)

interface ChangeLibraryDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  newRoot: string | null
  onConfirm: () => void
}

const ChangeLibraryDialog: FC<ChangeLibraryDialogProps> = ({
  open,
  onOpenChange,
  newRoot,
  onConfirm,
}) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <Dialog.Content className="w-96">
      <Dialog.Title>Switch library folder?</Dialog.Title>
      <Dialog.Description className="wrap-break-word">
        This removes all current projects from fukuro — covers, chapter order,
        and exclusions will be lost — and scans{' '}
        <span className="font-medium">{newRoot}</span> instead. Your manga files
        won't be touched.
      </Dialog.Description>
      <Dialog.Actions>
        <Dialog.Close asChild>
          <Button variant="destructive" onClick={onConfirm}>
            Switch folder
          </Button>
        </Dialog.Close>
        <Dialog.Close asChild>
          <Button variant="outline">Cancel</Button>
        </Dialog.Close>
      </Dialog.Actions>
    </Dialog.Content>
  </Dialog>
)
