import { convertFileSrc } from '@tauri-apps/api/core'
import { BookImage } from 'lucide-react'
import type { FC } from 'react'
import { cn } from '@/lib/utils/classnames'

interface CoverThumbnailProps {
  coverPath: string | null
  coverThumbnailPath: string | null
  coverVersion: number
  size: 'sm' | 'lg'
  onClick: () => void
  className?: string
}

export const CoverThumbnail: FC<CoverThumbnailProps> = ({
  coverPath,
  coverThumbnailPath,
  coverVersion,
  size,
  onClick,
  className,
}) => {
  // Fall back to the full-res master for covers set before the thumbnail cache existed —
  // it gets backfilled the next time the cover is changed.
  const displayPath = coverThumbnailPath ?? coverPath
  return (
    <button
      type="button"
      aria-label="Change cover"
      className={cn(
        'focus-visible:ring-(length:--ring-width) shrink-0 cursor-pointer overflow-hidden outline-none ring-ring focus-visible:ring-inset',
        size === 'sm'
          ? 'rounded-sm transition will-change-transform active:scale-95'
          : 'aspect-2/3 h-full w-18 rounded-lg',
        className,
      )}
      onClick={onClick}
    >
      {displayPath ? (
        <img
          src={`${convertFileSrc(displayPath)}?v=${coverVersion}`}
          alt="Cover"
          className={cn(
            'object-cover',
            size === 'sm' ? 'h-8 w-auto rounded' : 'h-full w-full',
          )}
        />
      ) : (
        <div
          className={cn(
            'flex items-center justify-center bg-background-secondary',
            size === 'sm' ? 'h-8 w-6 rounded' : 'h-full w-full',
          )}
        >
          <BookImage
            className={cn(
              'text-foreground-secondary',
              size === 'sm' ? 'size-3.5' : 'size-5',
            )}
          />
        </div>
      )}
    </button>
  )
}
