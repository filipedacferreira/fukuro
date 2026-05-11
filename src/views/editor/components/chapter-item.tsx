import { Reorder, useDragControls } from 'motion/react'
import type { FC } from 'react'
import { useRef, useState } from 'react'
import { Disclosure } from '@/components/ui/disclosure'
import { cn } from '@/lib/utils/classnames'
import type { Chapter } from '@/types'
import { ChapterRow } from './chapter-row'
import { ImageGrid } from './image-grid'

interface ChapterItemProps {
  chapter: Chapter
  index: number
  onExclusionChange: (delta: number) => void
  onImageDeleted: () => void
}

export const ChapterItem: FC<ChapterItemProps> = ({
  chapter,
  index,
  onExclusionChange,
  onImageDeleted,
}) => {
  const controls = useDragControls()
  const [dragging, setDragging] = useState(false)
  const itemRef = useRef<HTMLDivElement>(null)

  const handleOpenChange = (open: boolean) => {
    if (!open) return
    setTimeout(() => {
      itemRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }, 200)
  }

  return (
    <Reorder.Item
      value={chapter}
      dragListener={false}
      dragControls={controls}
      className={cn(dragging && 'z-10')}
      onDragStart={() => setDragging(true)}
      onDragEnd={() => setDragging(false)}
    >
      <Disclosure onOpenChange={handleOpenChange}>
        <div
          ref={itemRef}
          className="overflow-hidden rounded-xl border border-border bg-background"
        >
          <ChapterRow
            chapterId={chapter.id}
            displayName={chapter.displayName}
            index={index}
            imageCount={chapter.imageCount}
            excludedCount={chapter.excludedCount}
            dragging={dragging}
            controls={controls}
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
    </Reorder.Item>
  )
}
