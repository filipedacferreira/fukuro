import { GripVertical, Pencil } from 'lucide-react'
import { Reorder, useDragControls } from 'motion/react'
import type { FC } from 'react'
import { useEffect, useRef, useState } from 'react'
import { Disclosure } from '@/components/ui/disclosure'
import { api } from '@/lib/tauri'
import { cn } from '@/lib/utils/classnames'
import type { Chapter } from '@/types'
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
  const [isRenaming, setIsRenaming] = useState(false)
  const [draft, setDraft] = useState('')
  const [localName, setLocalName] = useState(chapter.displayName)
  const inputRef = useRef<HTMLInputElement>(null)
  const activeCount = chapter.imageCount - chapter.excludedCount

  useEffect(() => {
    if (isRenaming) inputRef.current?.focus()
  }, [isRenaming])

  const startRenaming = () => {
    setDraft(localName)
    setIsRenaming(true)
  }

  const cancelRename = () => {
    setIsRenaming(false)
    setDraft('')
  }

  const commitRename = async () => {
    const trimmed = draft.trim()
    if (trimmed && trimmed !== localName) {
      await api.renameChapter(chapter.id, trimmed)
      setLocalName(trimmed)
    }
    setIsRenaming(false)
    setDraft('')
  }

  const rowContent = (
    <div
      className={cn(
        'group flex select-none items-center gap-2 px-4 py-3 transition',
        !isRenaming && 'cursor-pointer',
        !isRenaming &&
          (dragging
            ? 'bg-foreground/10'
            : 'hover:bg-foreground/5 active:bg-foreground/10'),
      )}
    >
      <button
        type="button"
        className="focus-visible:ring-(length:--ring-width) -m-2 shrink-0 cursor-grab touch-none rounded p-2 text-foreground-secondary ring-ring transition hover:text-foreground focus-visible:outline-none active:cursor-grabbing"
        aria-label="Drag to reorder"
        onPointerDown={(e) => controls.start(e)}
        onClick={(e) => e.stopPropagation()}
      >
        <GripVertical className="size-4" />
      </button>

      <span className="w-6 shrink-0 text-center font-mono text-foreground-secondary text-xs">
        {index + 1}
      </span>

      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        {isRenaming ? (
          <input
            ref={inputRef}
            className="focus-visible:ring-(length:--ring-width) min-w-0 flex-1 rounded bg-transparent font-medium text-foreground text-sm outline-none ring-ring transition"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitRename()
              if (e.key === 'Escape') cancelRename()
            }}
          />
        ) : (
          <>
            <span className="min-w-0 truncate font-medium text-sm">
              {localName}
            </span>
            <button
              type="button"
              aria-label="Rename chapter"
              className="focus-visible:ring-(length:--ring-width) -m-1.5 shrink-0 cursor-pointer rounded p-1.5 text-foreground-secondary opacity-0 ring-ring transition hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none active:opacity-70 group-hover:opacity-100"
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                startRenaming()
              }}
            >
              <Pencil className="size-3.5" />
            </button>
          </>
        )}
      </div>

      <span className="shrink-0 text-foreground-secondary text-xs tabular-nums">
        {chapter.excludedCount > 0 ? (
          <>
            <span className="text-foreground">{activeCount}</span>
            <span className="ml-1 line-through opacity-50">
              {chapter.excludedCount}
            </span>
          </>
        ) : (
          <span>{chapter.imageCount}</span>
        )}
      </span>

      <Disclosure.Chevron />
    </div>
  )

  return (
    <Reorder.Item
      value={chapter}
      dragListener={false}
      dragControls={controls}
      className=""
      onDragStart={() => setDragging(true)}
      onDragEnd={() => setDragging(false)}
    >
      <Disclosure>
        <div className="overflow-hidden rounded-xl border border-border bg-background">
          {isRenaming ? (
            rowContent
          ) : (
            <Disclosure.Trigger asChild>{rowContent}</Disclosure.Trigger>
          )}

          <Disclosure.Content>
            <div className="border-border border-t bg-background-secondary px-4 py-3">
              <ImageGrid
                chapterId={chapter.id}
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
