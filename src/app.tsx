import { useState } from 'react'
import { Toaster } from '@/components/ui/toaster'
import { Editor } from '@/views/editor/editor'
import { ProjectList } from '@/views/projects/project-list'

type View =
  | { type: 'projects' }
  | { type: 'editor'; projectId: string; projectName: string }

export default function App() {
  const [view, setView] = useState<View>({ type: 'projects' })

  return (
    <div className="flex h-full flex-col bg-background">
      {view.type === 'projects' ? (
        <ProjectList
          onOpenProject={(id, name) =>
            setView({ type: 'editor', projectId: id, projectName: name })
          }
        />
      ) : (
        <Editor
          projectId={view.projectId}
          projectName={view.projectName}
          onBack={() => setView({ type: 'projects' })}
        />
      )}
      <Toaster />
    </div>
  )
}
