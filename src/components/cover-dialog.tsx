import { zodResolver } from '@hookform/resolvers/zod'
import { convertFileSrc } from '@tauri-apps/api/core'
import { open as openFilePicker } from '@tauri-apps/plugin-dialog'
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

const anilistSchema = z.object({
  anilistId: z
    .string()
    .trim()
    .min(1, 'Required')
    .regex(/^\d+$/, 'Must be a valid Anilist ID')
    .transform(Number),
})
type AnilistInput = z.input<typeof anilistSchema> // { anilistId: string } — form field type
type AnilistOutput = z.output<typeof anilistSchema> // { anilistId: number } — submit handler type

interface CoverDialogProps {
  projectId: string
  coverPath: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onCoverChange: (newPath: string | null) => void
}

export const CoverDialog: FC<CoverDialogProps> = ({
  projectId,
  coverPath,
  open,
  onOpenChange,
  onCoverChange,
}) => {
  const [uploading, setUploading] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [anilistTitle, setAnilistTitle] = useState<string | null>(null)

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
      resetForm()
      setAnilistTitle(null)
    }
  }, [open, resetForm])

  const handleUpload = async () => {
    const selected = await openFilePicker({
      multiple: false,
      filters: [{ name: 'Image', extensions: ['jpg', 'jpeg', 'png', 'webp'] }],
    })
    if (!selected) return
    setUploading(true)
    try {
      const newPath = await api.setProjectCover(projectId, selected as string)
      onCoverChange(newPath)
      setAnilistTitle(null)
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

  const handleFetchAnilist = async ({ anilistId }: AnilistOutput) => {
    try {
      const result = await api.fetchAnilistCover(projectId, anilistId)
      onCoverChange(result.coverPath)
      setAnilistTitle(result.title)
      resetForm()
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
      onCoverChange(null)
      setAnilistTitle(null)
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
            {anilistTitle && !errors.anilistId && (
              <Field.Description>
                Matched: <span className="text-foreground">{anilistTitle}</span>
              </Field.Description>
            )}
          </Field>
        </div>
      </Dialog.Content>
    </Dialog>
  )
}
