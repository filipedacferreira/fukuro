import { Channel } from '@tauri-apps/api/core'
import type { FC } from 'react'
import { useEffect, useState } from 'react'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from '@/components/ui/toaster'
import { api } from '@/lib/tauri'
import type { ImageMeta, ThumbnailUpdate } from '@/types'
import { ImageCard } from './image-card'

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
            <Skeleton className="aspect-2/3 rounded-lg" />
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
