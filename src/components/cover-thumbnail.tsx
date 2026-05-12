import { convertFileSrc } from '@tauri-apps/api/core'
import { BookImage } from 'lucide-react'
import type { FC } from 'react'
import { cn } from '@/lib/utils/classnames'

interface CoverThumbnailProps {
  coverPath: string | null
  coverVersion: number
  size: 'sm' | 'lg'
  onClick: () => void
  className?: string
}

export const CoverThumbnail: FC<CoverThumbnailProps> = ({
  coverPath,
  coverVersion,
  size,
  onClick,
  className,
}) => {
  return (
    <button
      type="button"
      aria-label="Change cover"
      className={cn(
        'focus-visible:ring-(length:--ring-width) shrink-0 cursor-pointer overflow-hidden outline-none ring-ring focus-visible:ring-inset',
        size === 'sm' ? 'rounded' : 'h-full w-16',
        className,
      )}
      onClick={onClick}
    >
      {coverPath ? (
        <img
          src={`${convertFileSrc(coverPath)}?v=${coverVersion}`}
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
