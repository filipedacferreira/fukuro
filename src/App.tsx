import { useState } from 'react'
import { Toaster } from '@/foundations/ui/toaster/toaster'
import { ProjectList } from '@/components/ProjectList'
import { Editor } from '@/components/Editor'

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
