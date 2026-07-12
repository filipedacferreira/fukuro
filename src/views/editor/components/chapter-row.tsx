import { Trash2 } from 'lucide-react'
import type { FC } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Disclosure } from '@/components/ui/disclosure'
import { toast } from '@/components/ui/toaster'
import { api } from '@/lib/tauri'
import { cn } from '@/lib/utils/classnames'

interface ChapterRowProps {
  chapterId: string
  displayName: string
  chapterNumber: number | null
  imageCount: number
  excludedCount: number
  onDeleted: () => void
}

export const ChapterRow: FC<ChapterRowProps> = ({
  chapterId,
  displayName,
  chapterNumber,
  imageCount,
  excludedCount,
  onDeleted,
}) => {
  const activeCount = imageCount - excludedCount
  // The label the row shows for this chapter, reused verbatim in the confirm dialog so the
  // user deletes exactly what they see. Falls back to the folder name when no number parses.
  const chapterLabel =
    chapterNumber !== null ? `Chapter ${chapterNumber}` : displayName

  // On success the parent filters this chapter out of the editor's list, which unmounts this
  // row (and the dialog with it) — so there's nothing to close here. On error the dialog
  // stays open and we surface the reason as a toast.
  const handleDelete = async () => {
    try {
      await api.deleteChapter(chapterId)
      onDeleted()
    } catch (e) {
      toast({ title: 'Failed to delete chapter', description: String(e) })
    }
  }

  return (
    <div className="group relative select-none transition hover:bg-foreground/5 has-[[data-row-trigger]:active]:bg-foreground/10">
      <Disclosure.Trigger
        data-row-trigger
        className="absolute inset-0 cursor-pointer focus-visible:ring-inset"
      />

      <div className="pointer-events-none relative z-10 flex items-center gap-2.5 px-4 py-3">
        <div className="flex min-w-0 flex-1 flex-col">
          {chapterNumber !== null ? (
            <>
              <span className="min-w-0 truncate font-medium text-sm">
                {chapterLabel}
              </span>
              <span className="min-w-0 truncate text-foreground-secondary text-xs">
                {displayName}
              </span>
            </>
          ) : (
            <span className="min-w-0 truncate font-medium text-sm">
              {displayName}
            </span>
          )}
        </div>

        {/* The count and the delete button share one right-aligned slot and crossfade on
            hover, so the resting layout has no dead gap and nothing shifts when the button
            appears. The button overlays the count (z-20 above the full-bleed
            Disclosure.Trigger) and re-enables the pointer events the content div disabled, so
            clicking it opens the dialog instead of toggling the disclosure. */}
        <div className="relative flex min-w-6 shrink-0 items-center justify-end">
          <span className="text-foreground-secondary text-xs tabular-nums transition group-hover:opacity-0">
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

          <Dialog>
            <Dialog.Trigger asChild>
              <button
                type="button"
                className={cn(
                  'pointer-events-auto absolute top-1/2 left-1/2 z-20 flex size-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-md',
                  'text-foreground-secondary',
                  'cursor-pointer opacity-0 transition focus-visible:opacity-100 active:scale-90 group-hover:opacity-100',
                  'focus-visible:ring-(length:--ring-width) ring-ring hover:bg-error/10 hover:text-error focus-visible:outline-none',
                )}
                aria-label={`Delete ${chapterLabel} from disk`}
              >
                <Trash2 className="size-3.5" />
              </button>
            </Dialog.Trigger>
            {/* The dialog is a DOM descendant of the row's pointer-events-none content div,
                and pointer-events inherits even into the top layer — so re-enable it here or
                the modal can't be clicked. */}
            <Dialog.Content className="pointer-events-auto w-80">
              <Dialog.Title>Delete chapter?</Dialog.Title>
              <Dialog.Description>
                "{chapterLabel}" and its {imageCount}{' '}
                {imageCount === 1 ? 'page' : 'pages'} will be permanently
                deleted from disk. This cannot be undone.
              </Dialog.Description>
              <Dialog.Actions>
                <Button variant="destructive" onClick={handleDelete}>
                  Delete chapter
                </Button>
                <Dialog.Close asChild>
                  <Button variant="outline">Cancel</Button>
                </Dialog.Close>
              </Dialog.Actions>
            </Dialog.Content>
          </Dialog>
        </div>

        <Disclosure.Chevron />
      </div>
    </div>
  )
}
