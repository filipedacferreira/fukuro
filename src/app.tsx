import { useState } from 'react'
import { AppUpdateDialog } from '@/components/app-update-dialog'
import { Toaster } from '@/components/ui/toaster'
import type { Project } from '@/types'
import { Editor } from '@/views/editor/editor'
import { ProjectList } from '@/views/projects/project-list'

type View = { type: 'projects' } | { type: 'editor'; project: Project }

export default function App() {
  const [view, setView] = useState<View>({ type: 'projects' })

  return (
    <div className="flex h-full flex-col bg-background">
      {view.type === 'projects' ? (
        <ProjectList
          onOpenProject={(project) => setView({ type: 'editor', project })}
        />
      ) : (
        <Editor
          project={view.project}
          onBack={() => setView({ type: 'projects' })}
        />
      )}
      <Toaster />
      <AppUpdateDialog />
    </div>
  )
}
