import { convertFileSrc } from '@tauri-apps/api/core'
import { EyeOff, Trash2 } from 'lucide-react'
import type { FC } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils/classnames'
import type { ImageMeta } from '@/types'

interface ImageCardProps {
  image: ImageMeta
  onToggle: () => void
  onDelete: () => void
}

export const ImageCard: FC<ImageCardProps> = ({
  image,
  onToggle,
  onDelete,
}) => {
  const src = convertFileSrc(image.thumbnailPath)
  const optimizing = image.thumbnailPath === image.path

  return (
    <div>
      <div className="group/card relative transition-transform duration-150 will-change-transform has-[[data-image-toggle]:active]:scale-0.98">
        <button
          type="button"
          data-image-toggle
          className={cn(
            'relative block w-full cursor-pointer overflow-hidden rounded-lg border border-border',
            'focus-visible:ring-(length:--ring-width) ring-ring transition-[border-color] duration-150 hover:border-foreground/30 focus-visible:outline-none',
            image.isExcluded && 'opacity-40 grayscale',
          )}
          onClick={onToggle}
          title={image.isExcluded ? 'Click to include' : 'Click to exclude'}
        >
          <img
            src={src}
            alt={image.filename}
            width={200}
            height={300}
            className={cn(
              'aspect-2/3 w-full object-cover transition-[filter] duration-300',
              optimizing && 'blur-sm',
            )}
            loading="lazy"
          />
          {optimizing && (
            <div className="absolute inset-0 flex items-center justify-center">
              <Spinner className="size-4 text-foreground-secondary" />
            </div>
          )}
          {image.isExcluded && (
            <div className="absolute inset-0 flex items-center justify-center bg-background/60">
              <EyeOff className="size-6 text-foreground-secondary" />
            </div>
          )}
        </button>

        <Dialog>
          <Dialog.Trigger asChild>
            <button
              type="button"
              className={cn(
                'absolute top-1 right-1 flex size-6 items-center justify-center rounded-md',
                'bg-background/80 text-foreground-secondary backdrop-blur-sm',
                'cursor-pointer opacity-0 transition focus-visible:opacity-100 active:scale-90 group-hover/card:opacity-100',
                'focus-visible:ring-(length:--ring-width) ring-ring hover:bg-error/10 hover:text-error focus-visible:outline-none',
              )}
              aria-label={`Delete ${image.filename} from disk`}
            >
              <Trash2 className="size-3.5" />
            </button>
          </Dialog.Trigger>
          <Dialog.Content className="w-80">
            <Dialog.Title>Delete file?</Dialog.Title>
            <Dialog.Description>
              "{image.filename}" will be permanently deleted from disk. This
              cannot be undone.
            </Dialog.Description>
            <Dialog.Actions>
              {/* Not wrapped in Dialog.Close: Foundations' Slot always lets a child's own
                  onClick override Close's, so it wouldn't do anything here anyway. Not an
                  active bug like ProjectDeleteDialog's, though — `onDelete` removes this
                  image from its parent's list optimistically (see image-grid.tsx's
                  handleHardDelete), which unmounts this card, and the dialog with it, on
                  click regardless. */}
              <Button variant="destructive" onClick={onDelete}>
                Delete file
              </Button>
              <Dialog.Close asChild>
                <Button variant="outline">Cancel</Button>
              </Dialog.Close>
            </Dialog.Actions>
          </Dialog.Content>
        </Dialog>
      </div>

      <p className="mt-1 truncate px-0.5 text-center text-2xs text-foreground-secondary">
        {image.filename}
      </p>
    </div>
  )
}
