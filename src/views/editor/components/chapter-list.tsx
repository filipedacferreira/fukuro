import type { FC } from 'react'
import type { Chapter } from '@/types'
import { ChapterItem } from './chapter-item'

interface ChapterListProps {
  chapters: Chapter[]
  onExclusionChange: (chapterId: string, delta: number) => void
  onImageDeleted: (chapterId: string) => void
}

export const ChapterList: FC<ChapterListProps> = ({
  chapters,
  onExclusionChange,
  onImageDeleted,
}) => {
  if (chapters.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-foreground-secondary text-sm">
        No chapter folders found in this directory.
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2 p-4">
      {chapters.map((chapter) => (
        <ChapterItem
          key={chapter.id}
          chapter={chapter}
          onExclusionChange={(delta) => onExclusionChange(chapter.id, delta)}
          onImageDeleted={() => onImageDeleted(chapter.id)}
        />
      ))}
    </div>
  )
}
