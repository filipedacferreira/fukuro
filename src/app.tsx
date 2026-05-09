import { useState } from 'react'
import { Toaster } from '@/components/ui/toaster'
import { Editor } from '@/views/editor/editor'
import { ProjectList } from '@/views/projects/project-list'

type View =
  | { type: 'projects' }
  | {
      type: 'editor'
      projectId: string
      projectName: string
      coverPath: string | null
    }

export default function App() {
  const [view, setView] = useState<View>({ type: 'projects' })

  return (
    <div className="flex h-full flex-col bg-background">
      {view.type === 'projects' ? (
        <ProjectList
          onOpenProject={(id, name, coverPath) =>
            setView({
              type: 'editor',
              projectId: id,
              projectName: name,
              coverPath,
            })
          }
        />
      ) : (
        <Editor
          projectId={view.projectId}
          projectName={view.projectName}
          initialCoverPath={view.coverPath}
          onBack={() => setView({ type: 'projects' })}
        />
      )}
      <Toaster />
    </div>
  )
}
