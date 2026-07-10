import type { FC } from 'react'
import { Disclosure } from '@/components/ui/disclosure'

interface ChapterRowProps {
  displayName: string
  chapterNumber: number | null
  imageCount: number
  excludedCount: number
}

export const ChapterRow: FC<ChapterRowProps> = ({
  displayName,
  chapterNumber,
  imageCount,
  excludedCount,
}) => {
  const activeCount = imageCount - excludedCount

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
                Chapter {chapterNumber}
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
