import { Channel, convertFileSrc } from '@tauri-apps/api/core'
import { EyeOff, Trash2 } from 'lucide-react'
import type { FC } from 'react'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { toast } from '@/components/ui/toaster'
import { api } from '@/lib/tauri'
import { cn } from '@/lib/utils/classnames'
import type { ImageMeta, ThumbnailUpdate } from '@/types'

interface ImageGridProps {
  chapterId: string
  imageCount: number
  onExclusionChange: (delta: number) => void
  onImageDeleted: () => void
}

export const ImageGrid: FC<ImageGridProps> = ({
  chapterId,
  imageCount,
  onExclusionChange,
  onImageDeleted,
}) => {
  const [images, setImages] = useState<ImageMeta[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    let active = true

    api
      .getChapterImages(chapterId)
      .then((imgs) => {
        if (!active) return
        setImages(imgs)

        const needsThumbnails = imgs.some(
          (img) => img.thumbnailPath === img.path,
        )
        if (!needsThumbnails) return

        const channel = new Channel<ThumbnailUpdate>()
        channel.onmessage = (update) => {
          if (!active) return
          setImages((prev) =>
            prev.map((img) =>
              img.path === update.imagePath
                ? { ...img, thumbnailPath: update.thumbnailPath }
                : img,
            ),
          )
        }
        api.generateChapterThumbnailsStream(chapterId, channel).catch(() => {})
      })
      .catch((e) =>
        toast({
          title: 'Failed to load images',
          description: String(e),
        }),
      )
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
    }
  }, [chapterId])

  const handleToggle = async (image: ImageMeta) => {
    const wasExcluded = image.isExcluded
    setImages((prev) =>
      prev.map((img) =>
        img.path === image.path ? { ...img, isExcluded: !img.isExcluded } : img,
      ),
    )
    try {
      await api.toggleExclusion(chapterId, image.path)
      onExclusionChange(wasExcluded ? -1 : 1)
    } catch (e) {
      setImages((prev) =>
        prev.map((img) =>
          img.path === image.path ? { ...img, isExcluded: wasExcluded } : img,
        ),
      )
      toast({
        title: 'Failed to update exclusion',
        description: String(e),
      })
    }
  }

  const handleHardDelete = async (image: ImageMeta) => {
    const wasExcluded = image.isExcluded
    setImages((prev) => prev.filter((img) => img.path !== image.path))
    try {
      await api.hardDeleteImage(chapterId, image.path)
      if (wasExcluded) onExclusionChange(-1)
      onImageDeleted()
    } catch (e) {
      setImages((prev) =>
        [...prev, image].sort((a, b) => a.filename.localeCompare(b.filename)),
      )
      toast({
        title: 'Failed to delete image',
        description: String(e),
      })
    }
  }

  if (loading) {
    return (
      <div className="grid grid-cols-[repeat(auto-fill,minmax(100px,1fr))] gap-2">
        {Array.from({ length: imageCount }).map((_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: static-length skeleton list
          <div key={i}>
            <Skeleton className="aspect-[2/3] rounded-lg" />
            <Skeleton className="mx-auto mt-1 h-3 w-3/4 rounded" />
          </div>
        ))}
      </div>
    )
  }

  if (images.length === 0) {
    return (
      <p className="py-4 text-center text-foreground-secondary text-sm">
        No images found in this folder.
      </p>
    )
  }

  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(100px,1fr))] gap-2">
      {images.map((image) => (
        <ImageCard
          key={image.path}
          image={image}
          onToggle={() => handleToggle(image)}
          onDelete={() => handleHardDelete(image)}
        />
      ))}
    </div>
  )
}

interface ImageCardProps {
  image: ImageMeta
  onToggle: () => void
  onDelete: () => void
}

const ImageCard: FC<ImageCardProps> = ({ image, onToggle, onDelete }) => {
  const src = convertFileSrc(image.thumbnailPath)
  const optimizing = image.thumbnailPath === image.path

  return (
    <div>
      <div className="group/card relative">
        <button
          type="button"
          className={cn(
            'relative block w-full cursor-pointer overflow-hidden rounded-lg border border-border',
            'focus-visible:ring-(length:--ring-width) ring-ring transition-all duration-150 hover:border-foreground/30 focus-visible:outline-none active:scale-[0.98]',
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
              'aspect-[2/3] w-full object-cover transition-[filter] duration-300',
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
              <Dialog.Close asChild>
                <Button variant="destructive" onClick={onDelete}>
                  Delete file
                </Button>
              </Dialog.Close>
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
