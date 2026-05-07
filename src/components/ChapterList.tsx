import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable'
import { ChapterItem } from '@/components/ChapterItem'
import type { Chapter } from '@/types'

interface ChapterListProps {
  chapters: Chapter[]
  onReorder: (orderedIds: string[]) => void
  onRename: (id: string, name: string) => void
  onExclusionChange: (chapterId: string, delta: number) => void
  onImageDeleted: (chapterId: string) => void
}

export function ChapterList({
  chapters,
  onReorder,
  onRename,
  onExclusionChange,
  onImageDeleted,
}: ChapterListProps) {
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return

    const oldIndex = chapters.findIndex((c) => c.id === active.id)
    const newIndex = chapters.findIndex((c) => c.id === over.id)
    const reordered = arrayMove(chapters, oldIndex, newIndex)
    onReorder(reordered.map((c) => c.id))
  }

  if (chapters.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-sm text-foreground-secondary">
        No chapter folders found in this directory.
      </div>
    )
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
      <SortableContext
        items={chapters.map((c) => c.id)}
        strategy={verticalListSortingStrategy}
      >
        <ul className="divide-y divide-border">
          {chapters.map((chapter, index) => (
            <ChapterItem
              key={chapter.id}
              chapter={chapter}
              index={index}
              onRename={(name) => onRename(chapter.id, name)}
              onExclusionChange={(delta) => onExclusionChange(chapter.id, delta)}
              onImageDeleted={() => onImageDeleted(chapter.id)}
            />
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  )
}
