import { useRef, useState } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { CaretDownIcon, DotsSixVerticalIcon } from '@phosphor-icons/react/dist/ssr'
import { Input } from '@/foundations/ui/input/input'
import { cn } from '@/lib/utils/classnames'
import { ImageGrid } from '@/components/ImageGrid'
import type { Chapter } from '@/types'

interface ChapterItemProps {
  chapter: Chapter
  index: number
  onRename: (name: string) => void
  onExclusionChange: (delta: number) => void
  onImageDeleted: () => void
}

export function ChapterItem({
  chapter,
  index,
  onRename,
  onExclusionChange,
  onImageDeleted,
}: ChapterItemProps) {
  const [expanded, setExpanded] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editValue, setEditValue] = useState(chapter.displayName)
  const inputRef = useRef<HTMLInputElement>(null)

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: chapter.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  const startEdit = () => {
    setEditValue(chapter.displayName)
    setEditing(true)
    setTimeout(() => inputRef.current?.select(), 0)
  }

  const commitEdit = () => {
    const trimmed = editValue.trim()
    if (trimmed && trimmed !== chapter.displayName) {
      onRename(trimmed)
    } else {
      setEditValue(chapter.displayName)
    }
    setEditing(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') commitEdit()
    if (e.key === 'Escape') {
      setEditValue(chapter.displayName)
      setEditing(false)
    }
  }

  const activeCount = chapter.imageCount - chapter.excludedCount

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={cn(
        'bg-background',
        isDragging && 'z-10 shadow-md opacity-90'
      )}
    >
      <div className="flex items-center gap-2 px-4 py-3">
        {/* drag handle */}
        <button
          className="cursor-grab touch-none text-foreground-secondary hover:text-foreground active:cursor-grabbing"
          aria-label="Drag to reorder"
          {...attributes}
          {...listeners}
        >
          <DotsSixVerticalIcon className="size-4" />
        </button>

        {/* index badge */}
        <span className="w-6 shrink-0 text-center text-xs font-mono text-foreground-secondary">
          {index + 1}
        </span>

        {/* display name (editable) */}
        <div className="flex-1 min-w-0">
          {editing ? (
            <Input
              ref={inputRef}
              size="sm"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={commitEdit}
              onKeyDown={handleKeyDown}
              className="w-full"
            />
          ) : (
            <button
              className="truncate text-sm font-medium text-left w-full hover:text-foreground-secondary transition-colors"
              onClick={startEdit}
              title="Click to rename"
            >
              {chapter.displayName}
            </button>
          )}
        </div>

        {/* image count */}
        <span className="shrink-0 text-xs text-foreground-secondary tabular-nums">
          {chapter.excludedCount > 0 ? (
            <>
              <span className="text-foreground">{activeCount}</span>
              <span className="line-through opacity-50 ml-1">{chapter.excludedCount}</span>
            </>
          ) : (
            <span>{chapter.imageCount}</span>
          )}
          {' '}img
        </span>

        {/* expand toggle */}
        <button
          className="text-foreground-secondary hover:text-foreground transition-colors"
          aria-label={expanded ? 'Collapse images' : 'Expand images'}
          onClick={() => setExpanded((v) => !v)}
        >
          <CaretDownIcon
            className={cn('size-4 transition-transform duration-200', expanded && 'rotate-180')}
          />
        </button>
      </div>

      {expanded && (
        <div className="border-t border-border bg-background-secondary px-4 py-3">
          <ImageGrid
            chapterId={chapter.id}
            onExclusionChange={onExclusionChange}
            onImageDeleted={onImageDeleted}
          />
        </div>
      )}
    </li>
  )
}
