import { zodResolver } from '@hookform/resolvers/zod'
import { convertFileSrc } from '@tauri-apps/api/core'
import { open as openFilePicker } from '@tauri-apps/plugin-dialog'
import { openUrl } from '@tauri-apps/plugin-opener'
import { BookImage, Loader2, Trash2, Upload } from 'lucide-react'
import type { FC } from 'react'
import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { toast } from '@/components/ui/toaster'
import { api } from '@/lib/tauri'
import type { CoverInfo } from '@/types'

const anilistSchema = z.object({
  anilistId: z
    .string()
    .trim()
    .min(1, 'Required')
    // Accept either a bare ID ("30013") or an Anilist URL ("anilist.co/manga/30013/...").
    .transform((val) => {
      const match = val.match(/\/manga\/(\d+)/)
      return match ? match[1] : val
    })
    .pipe(
      z.string().regex(/^\d+$/, 'Must be a valid Anilist ID').transform(Number),
    ),
})
type AnilistInput = z.input<typeof anilistSchema> // { anilistId: string } — form field type
type AnilistOutput = z.output<typeof anilistSchema> // { anilistId: number } — submit handler type

interface CoverDialogProps {
  projectId: string
  cover: CoverInfo
  open: boolean
  onOpenChange: (open: boolean) => void
  onCoverChange: (cover: CoverInfo) => void
}

export const CoverDialog: FC<CoverDialogProps> = ({
  projectId,
  cover,
  open,
  onOpenChange,
  onCoverChange,
}) => {
  const { coverPath, anilistId, coverTitle } = cover
  const [uploading, setUploading] = useState(false)
  const [removing, setRemoving] = useState(false)
  // Mirrors the anilistId/coverTitle props but stays in sync with changes made this session.
  const [localAnilistId, setLocalAnilistId] = useState(anilistId)
  const [localCoverTitle, setLocalCoverTitle] = useState(coverTitle)

  const {
    register,
    handleSubmit,
    reset: resetForm,
    formState: { errors, isSubmitting },
  } = useForm<AnilistInput, unknown, AnilistOutput>({
    resolver: zodResolver(anilistSchema),
  })

  useEffect(() => {
    if (open) {
      resetForm({ anilistId: anilistId ? String(anilistId) : '' })
      setLocalAnilistId(anilistId)
      setLocalCoverTitle(coverTitle)
    }
  }, [open, anilistId, coverTitle, resetForm])

  const handleUpload = async () => {
    const selected = await openFilePicker({
      multiple: false,
      filters: [{ name: 'Image', extensions: ['jpg', 'jpeg', 'png', 'webp'] }],
    })
    if (!selected) return
    setUploading(true)
    try {
      const result = await api.setProjectCover(projectId, selected as string)
      onCoverChange({
        coverPath: result.coverPath,
        coverThumbnailPath: result.coverThumbnailPath,
        anilistId: null,
        coverTitle: null,
      })
      setLocalAnilistId(null)
      setLocalCoverTitle(null)
      toast({ title: 'Cover updated' })
    } catch (e) {
      toast({
        title: 'Failed to set cover',
        description: String(e),
        variant: 'negative',
      })
    } finally {
      setUploading(false)
    }
  }

  const handleFetchAnilist = async ({
    anilistId: fetchedId,
  }: AnilistOutput) => {
    try {
      const result = await api.fetchAnilistCover(projectId, fetchedId)
      onCoverChange({
        coverPath: result.coverPath,
        coverThumbnailPath: result.coverThumbnailPath,
        anilistId: fetchedId,
        coverTitle: result.title,
      })
      setLocalAnilistId(fetchedId)
      setLocalCoverTitle(result.title)
      resetForm({ anilistId: String(fetchedId) })
      toast({ title: 'Cover fetched', description: result.title })
    } catch (e) {
      toast({
        title: 'Failed to fetch cover',
        description: String(e),
        variant: 'negative',
      })
    }
  }

  const handleRemove = async () => {
    setRemoving(true)
    try {
      await api.removeProjectCover(projectId)
      onCoverChange({
        coverPath: null,
        coverThumbnailPath: null,
        anilistId: null,
        coverTitle: null,
      })
      setLocalAnilistId(null)
      setLocalCoverTitle(null)
      toast({ title: 'Cover removed' })
    } catch (e) {
      toast({
        title: 'Failed to remove cover',
        description: String(e),
        variant: 'negative',
      })
    } finally {
      setRemoving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <Dialog.Content className="w-80">
        <Dialog.Title>Cover image</Dialog.Title>

        {/* Cover preview */}
        <div className="mb-4 flex justify-center">
          <div className="group/cover relative">
            {coverPath ? (
              <img
                src={convertFileSrc(coverPath)}
                alt="Project cover"
                className="h-48 w-auto rounded-xl object-cover shadow-md"
              />
            ) : (
              <div className="flex h-48 w-32 items-center justify-center rounded-xl border border-border border-dashed bg-background-secondary">
                <BookImage className="size-8 text-foreground-secondary" />
              </div>
            )}
            {(isSubmitting || uploading) && (
              <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-background/60 backdrop-blur-sm">
                <Loader2 className="size-6 animate-spin text-foreground-secondary" />
              </div>
            )}
            {coverPath && !isSubmitting && !uploading && (
              <button
                type="button"
                aria-label="Remove cover"
                className="focus-visible:ring-(length:--ring-width) absolute top-1 right-1 flex size-6 cursor-pointer items-center justify-center rounded-md bg-background/80 text-foreground-secondary opacity-0 ring-ring backdrop-blur-sm transition-all hover:bg-error/10 hover:text-error focus-visible:opacity-100 focus-visible:outline-none active:scale-90 group-hover/cover:opacity-100"
                onClick={handleRemove}
                disabled={removing}
              >
                <Trash2 className="size-3.5" />
              </button>
            )}
          </div>
        </div>

        <div className="space-y-3">
          {/* Upload */}
          <Button
            variant="outline"
            className="w-full"
            onClick={handleUpload}
            isLoading={uploading}
            disabled={uploading || removing || isSubmitting}
          >
            <Upload className="size-4" />
            Upload image
          </Button>

          {/* Anilist fetch */}
          <Field invalid={!!errors.anilistId}>
            <Field.Label className="font-normal text-foreground-secondary text-xs">
              Fetch from Anilist
            </Field.Label>
            <form
              onSubmit={handleSubmit(handleFetchAnilist)}
              className="flex gap-2"
            >
              <Field.Control>
                <Input
                  {...register('anilistId')}
                  placeholder="Manga ID"
                  inputMode="numeric"
                  size="sm"
                  invalid={!!errors.anilistId || undefined}
                  disabled={uploading || removing || isSubmitting}
                  className="flex-1"
                />
              </Field.Control>
              <Button
                type="submit"
                size="sm"
                isLoading={isSubmitting}
                disabled={uploading || removing || isSubmitting}
              >
                Fetch
              </Button>
            </form>
            <Field.Error>{errors.anilistId?.message}</Field.Error>
            {(localCoverTitle || localAnilistId) && !errors.anilistId && (
              <Field.Description className="flex flex-col gap-0.5">
                <span>Fetched from Anilist:</span>
                <button
                  type="button"
                  className="cursor-pointer text-start text-foreground underline-offset-2 hover:underline"
                  onClick={() =>
                    openUrl(`https://anilist.co/manga/${localAnilistId}`)
                  }
                >
                  {localCoverTitle ?? `ID ${localAnilistId}`}
                </button>
              </Field.Description>
            )}
          </Field>
        </div>
      </Dialog.Content>
    </Dialog>
  )
}
