import { useEffect, useState } from 'react'
import { convertFileSrc } from '@tauri-apps/api/core'
import { Trash2, EyeOff } from 'lucide-react'
import { Button } from '@/foundations/ui/button/button'
import { Dialog } from '@/foundations/ui/dialog/dialog'
import { Skeleton } from '@/foundations/ui/skeleton/skeleton'
import { toast } from '@/foundations/ui/toaster/toaster'
import { cn } from '@/lib/utils/classnames'
import { api } from '@/lib/tauri'
import type { ImageMeta } from '@/types'

interface ImageGridProps {
  chapterId: string
  onExclusionChange: (delta: number) => void
  onImageDeleted: () => void
}

export function ImageGrid({ chapterId, onExclusionChange, onImageDeleted }: ImageGridProps) {
  const [images, setImages] = useState<ImageMeta[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    api.getChapterImages(chapterId)
      .then(setImages)
      .catch((e) => toast({ title: 'Failed to load images', description: String(e), variant: 'negative' }))
      .finally(() => setLoading(false))
  }, [chapterId])

  const handleToggle = async (image: ImageMeta) => {
    const wasExcluded = image.isExcluded
    setImages((prev) =>
      prev.map((img) =>
        img.path === image.path ? { ...img, isExcluded: !img.isExcluded } : img
      )
    )
    try {
      await api.toggleExclusion(chapterId, image.path)
      onExclusionChange(wasExcluded ? -1 : 1)
    } catch (e) {
      setImages((prev) =>
        prev.map((img) =>
          img.path === image.path ? { ...img, isExcluded: wasExcluded } : img
        )
      )
      toast({ title: 'Failed to update exclusion', description: String(e), variant: 'negative' })
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
      setImages((prev) => [...prev, image].sort((a, b) => a.filename.localeCompare(b.filename)))
      toast({ title: 'Failed to delete image', description: String(e), variant: 'negative' })
    }
  }

  if (loading) {
    return (
      <div className="grid grid-cols-[repeat(auto-fill,minmax(100px,1fr))] gap-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="aspect-[2/3] rounded-lg" />
        ))}
      </div>
    )
  }

  if (images.length === 0) {
    return (
      <p className="py-4 text-center text-sm text-foreground-secondary">
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

function ImageCard({ image, onToggle, onDelete }: ImageCardProps) {
  const src = convertFileSrc(image.path)

  return (
    <div className="group relative">
      <button
        className={cn(
          'relative block w-full overflow-hidden rounded-lg border border-border cursor-pointer',
          'transition-all duration-150',
          image.isExcluded && 'opacity-40 grayscale'
        )}
        onClick={onToggle}
        title={image.isExcluded ? 'Click to include' : 'Click to exclude'}
      >
        <img
          src={src}
          alt={image.filename}
          className="aspect-[2/3] w-full object-cover"
          loading="lazy"
        />
        {image.isExcluded && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/60">
            <EyeOff className="size-6 text-foreground-secondary" />
          </div>
        )}
      </button>

      <p className="mt-1 truncate px-0.5 text-center text-2xs text-foreground-secondary">
        {image.filename}
      </p>

      <Dialog>
        <Dialog.Trigger asChild>
          <button
            className={cn(
              'absolute top-1 right-1 flex size-6 items-center justify-center rounded-md',
              'bg-background/80 text-foreground-secondary backdrop-blur-sm',
              'opacity-0 group-hover:opacity-100 transition-opacity',
              'hover:text-error hover:bg-error/10'
            )}
            aria-label={`Delete ${image.filename} from disk`}
          >
            <Trash2 className="size-3.5" />
          </button>
        </Dialog.Trigger>
        <Dialog.Content className="w-80">
          <Dialog.Title>Delete file?</Dialog.Title>
          <Dialog.Description>
            "{image.filename}" will be permanently deleted from disk. This cannot be undone.
          </Dialog.Description>
          <Dialog.Actions>
            <Dialog.Close asChild>
              <Button variant="destructive" onClick={onDelete}>Delete file</Button>
            </Dialog.Close>
            <Dialog.Close asChild>
              <Button variant="outline">Cancel</Button>
            </Dialog.Close>
          </Dialog.Actions>
        </Dialog.Content>
      </Dialog>
    </div>
  )
}
