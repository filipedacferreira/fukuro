import { zodResolver } from '@hookform/resolvers/zod'
import { GripVertical, Pencil } from 'lucide-react'
import type { DragControls } from 'motion/react'
import type { FC } from 'react'
import { useEffect, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { Disclosure } from '@/components/ui/disclosure'
import { toast } from '@/components/ui/toaster'
import { Tooltip } from '@/components/ui/tooltip'
import { api } from '@/lib/tauri'
import { cn } from '@/lib/utils/classnames'
import type { RenameValues } from '@/lib/validation'
import { renameSchema } from '@/lib/validation'

interface ChapterRowProps {
  chapterId: string
  displayName: string
  index: number
  imageCount: number
  excludedCount: number
  dragging: boolean
  controls: DragControls
  onRenamed?: (newName: string) => void
}

export const ChapterRow: FC<ChapterRowProps> = ({
  chapterId,
  displayName,
  index,
  imageCount,
  excludedCount,
  dragging,
  controls,
  onRenamed,
}) => {
  const [isRenaming, setIsRenaming] = useState(false)
  const [localName, setLocalName] = useState(displayName)
  const submittingRef = useRef(false)
  const activeCount = imageCount - excludedCount

  const { register, handleSubmit, reset, setFocus } = useForm<RenameValues>({
    resolver: zodResolver(renameSchema),
    defaultValues: { name: displayName },
  })

  useEffect(() => {
    if (isRenaming) setFocus('name')
  }, [isRenaming, setFocus])

  const startRenaming = () => {
    reset({ name: localName })
    setIsRenaming(true)
  }

  const cancelRename = () => {
    reset()
    setIsRenaming(false)
  }

  const commit = async ({ name }: RenameValues) => {
    if (submittingRef.current) return
    submittingRef.current = true
    try {
      if (name !== localName) {
        await api.renameChapter(chapterId, name)
        setLocalName(name)
        onRenamed?.(name)
      }
    } catch (e) {
      toast({ title: 'Failed to rename chapter', description: String(e) })
    } finally {
      submittingRef.current = false
      setIsRenaming(false)
    }
  }

  const {
    ref: registerRef,
    onBlur: _rhfOnBlur,
    ...registerRest
  } = register('name')

  return (
    <div
      className={cn(
        'group relative select-none transition',
        !isRenaming &&
          (dragging
            ? 'bg-foreground/10'
            : 'hover:bg-foreground/5 has-[[data-row-trigger]:active]:bg-foreground/10'),
      )}
    >
      {!isRenaming && (
        <Disclosure.Trigger
          data-row-trigger
          className="absolute inset-0 cursor-pointer focus-visible:ring-inset"
        />
      )}

      <div className="pointer-events-none relative z-10 flex items-center gap-2 px-4 py-3">
        <button
          type="button"
          className="focus-visible:ring-(length:--ring-width) pointer-events-auto -m-2 shrink-0 cursor-grab touch-none rounded p-2 text-foreground-secondary ring-ring transition hover:text-foreground focus-visible:outline-none active:cursor-grabbing"
          aria-label="Drag to reorder"
          onPointerDown={(e) => controls.start(e)}
        >
          <GripVertical className="size-4" />
        </button>

        <span className="w-6 shrink-0 text-center font-mono text-foreground-secondary text-xs">
          {index + 1}
        </span>

        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          {isRenaming ? (
            <form
              onSubmit={handleSubmit(commit)}
              className="pointer-events-auto min-w-0 flex-1"
            >
              <input
                ref={registerRef}
                {...registerRest}
                className="w-full rounded bg-transparent font-medium text-foreground text-sm outline-none transition"
                onBlur={handleSubmit(commit, cancelRename)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    e.preventDefault()
                    cancelRename()
                  }
                }}
              />
            </form>
          ) : (
            <>
              <span className="min-w-0 truncate font-medium text-sm">
                {localName}
              </span>
              <Tooltip>
                <Tooltip.Trigger asChild>
                  <button
                    type="button"
                    aria-label="Rename chapter"
                    className={cn(
                      'focus-visible:ring-(length:--ring-width) pointer-events-auto -m-1.5 shrink-0 cursor-pointer rounded p-1.5 text-foreground-secondary opacity-0 ring-ring transition hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none active:opacity-70',
                      !dragging && 'group-hover:opacity-100',
                    )}
                    onClick={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      startRenaming()
                    }}
                  >
                    <Pencil className="size-3.5" />
                  </button>
                </Tooltip.Trigger>
                <Tooltip.Content>Rename</Tooltip.Content>
              </Tooltip>
            </>
          )}
        </div>

        <span className="shrink-0 text-foreground-secondary text-xs tabular-nums">
          {excludedCount > 0 ? (
            <>
              <span className="text-foreground">{activeCount}</span>
              <span className="ml-1 line-through opacity-50">
                {excludedCount}
              </span>
            </>
          ) : (
            <span>{imageCount}</span>
          )}
        </span>

        <Disclosure.Chevron />
      </div>
    </div>
  )
}
