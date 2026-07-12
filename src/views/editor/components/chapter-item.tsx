import type { FC } from 'react'
import { useRef } from 'react'
import { Disclosure } from '@/components/ui/disclosure'
import type { Chapter } from '@/types'
import { ChapterRow } from './chapter-row'
import { ImageGrid } from './image-grid'

interface ChapterItemProps {
  chapter: Chapter
  onExclusionChange: (delta: number) => void
  onImageDeleted: () => void
  onChapterDeleted: () => void
}

export const ChapterItem: FC<ChapterItemProps> = ({
  chapter,
  onExclusionChange,
  onImageDeleted,
  onChapterDeleted,
}) => {
  const itemRef = useRef<HTMLDivElement>(null)

  const handleOpenChange = (open: boolean) => {
    if (!open) return
    setTimeout(() => {
      itemRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }, 200)
  }

  return (
    <Disclosure onOpenChange={handleOpenChange}>
      <div
        ref={itemRef}
        className="overflow-hidden rounded-xl border border-border bg-background"
      >
        <ChapterRow
          chapterId={chapter.id}
          displayName={chapter.displayName}
          chapterNumber={chapter.chapterNumber}
          imageCount={chapter.imageCount}
          excludedCount={chapter.excludedCount}
          onDeleted={onChapterDeleted}
        />

        <Disclosure.Content>
          <div className="border-border border-t bg-background-secondary px-4 py-3">
            <ImageGrid
              chapterId={chapter.id}
              imageCount={chapter.imageCount}
              onExclusionChange={onExclusionChange}
              onImageDeleted={onImageDeleted}
            />
          </div>
        </Disclosure.Content>
      </div>
    </Disclosure>
  )
}
