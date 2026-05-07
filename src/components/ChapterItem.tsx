import { Reorder, useDragControls } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { GripVertical, Pencil } from 'lucide-react'
import { Disclosure } from '@/foundations/ui/disclosure/disclosure'
import { ImageGrid } from '@/components/ImageGrid'
import { cn } from '@/lib/utils/classnames'
import { api } from '@/lib/tauri'
import type { Chapter } from '@/types'

interface ChapterItemProps {
  chapter: Chapter
  index: number
  onExclusionChange: (delta: number) => void
  onImageDeleted: () => void
}

export function ChapterItem({
  chapter,
  index,
  onExclusionChange,
  onImageDeleted,
}: ChapterItemProps) {
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

  function startRenaming() {
    setDraft(localName)
    setIsRenaming(true)
  }

  function cancelRename() {
    setIsRenaming(false)
    setDraft('')
  }

  async function commitRename() {
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
        'group flex items-center gap-2 px-4 py-3 select-none transition',
        !isRenaming && 'cursor-pointer',
        !isRenaming && (dragging ? 'bg-foreground/10' : 'hover:bg-foreground/5 active:bg-foreground/10'),
      )}
    >
      <button
        className="shrink-0 p-2 -m-2 cursor-grab touch-none text-foreground-secondary transition hover:text-foreground active:cursor-grabbing rounded focus-visible:outline-none focus-visible:ring-(length:--ring-width) ring-ring"
        aria-label="Drag to reorder"
        onPointerDown={(e) => controls.start(e)}
        onClick={(e) => e.stopPropagation()}
      >
        <GripVertical className="size-4" />
      </button>

      <span className="w-6 shrink-0 text-center text-xs font-mono text-foreground-secondary">
        {index + 1}
      </span>

      <div className="flex flex-1 min-w-0 items-center gap-2.5">
        {isRenaming ? (
          <input
            ref={inputRef}
            className="flex-1 min-w-0 bg-transparent outline-none text-sm font-medium text-foreground rounded transition focus-visible:ring-(length:--ring-width) ring-ring"
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
            <span className="min-w-0 truncate text-sm font-medium">
              {localName}
            </span>
            <button
              type="button"
              aria-label="Rename chapter"
              className="shrink-0 p-1.5 -m-1.5 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 text-foreground-secondary transition hover:text-foreground cursor-pointer active:opacity-70 rounded focus-visible:outline-none focus-visible:ring-(length:--ring-width) ring-ring"
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

      <span className="shrink-0 text-xs text-foreground-secondary tabular-nums">
        {chapter.excludedCount > 0 ? (
          <>
            <span className="text-foreground">{activeCount}</span>
            <span className="line-through opacity-50 ml-1">{chapter.excludedCount}</span>
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
            <div className="border-t border-border bg-background-secondary px-4 py-3">
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
