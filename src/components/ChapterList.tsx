import { Reorder } from 'motion/react'
import { ChapterItem } from '@/components/ChapterItem'
import type { Chapter } from '@/types'

interface ChapterListProps {
  chapters: Chapter[]
  onReorder: (chapters: Chapter[]) => void
  onExclusionChange: (chapterId: string, delta: number) => void
  onImageDeleted: (chapterId: string) => void
}

export function ChapterList({
  chapters,
  onReorder,
  onExclusionChange,
  onImageDeleted,
}: ChapterListProps) {
  if (chapters.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-sm text-foreground-secondary">
        No chapter folders found in this directory.
      </div>
    )
  }

  return (
    <Reorder.Group
      axis="y"
      values={chapters}
      onReorder={onReorder}
      className="flex flex-col gap-2 p-4"
    >
      {chapters.map((chapter, index) => (
        <ChapterItem
          key={chapter.id}
          chapter={chapter}
          index={index}
          onExclusionChange={(delta) => onExclusionChange(chapter.id, delta)}
          onImageDeleted={() => onImageDeleted(chapter.id)}
        />
      ))}
    </Reorder.Group>
  )
}
