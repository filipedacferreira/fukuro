import { zodResolver } from '@hookform/resolvers/zod'
import { convertFileSrc } from '@tauri-apps/api/core'
import { open as openFilePicker } from '@tauri-apps/plugin-dialog'
import { openUrl } from '@tauri-apps/plugin-opener'
import { BookImage, Loader2, Search, Trash2, Upload } from 'lucide-react'
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
import type { AnilistCandidate, CoverInfo } from '@/types'

const searchSchema = z.object({
  title: z.string().trim().min(1, 'Required'),
})
type SearchValues = z.infer<typeof searchSchema>

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
  const [candidates, setCandidates] = useState<AnilistCandidate[] | null>(null)
  const [applyingId, setApplyingId] = useState<number | null>(null)

  const {
    register,
    handleSubmit,
    reset: resetForm,
    formState: { errors, isSubmitting },
  } = useForm<SearchValues>({
    resolver: zodResolver(searchSchema),
  })

  useEffect(() => {
    if (open) {
      resetForm({ title: '' })
      setLocalAnilistId(anilistId)
      setLocalCoverTitle(coverTitle)
      setCandidates(null)
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

  const handleSearch = async ({ title }: SearchValues) => {
    setCandidates(null)
    try {
      const results = await api.searchAnilistCovers(title)
      setCandidates(results)
      if (results.length === 0) {
        toast({ title: 'No matches found', description: title })
      }
    } catch (e) {
      toast({
        title: 'Search failed',
        description: String(e),
        variant: 'negative',
      })
    }
  }

  const handleApplyCandidate = async (candidate: AnilistCandidate) => {
    setApplyingId(candidate.anilistId)
    try {
      const result = await api.applyAnilistCover(
        projectId,
        candidate.anilistId,
        candidate.imageUrl,
        candidate.title,
      )
      onCoverChange({
        coverPath: result.coverPath,
        coverThumbnailPath: result.coverThumbnailPath,
        anilistId: candidate.anilistId,
        coverTitle: candidate.title,
      })
      setLocalAnilistId(candidate.anilistId)
      setLocalCoverTitle(candidate.title)
      setCandidates(null)
      resetForm({ title: '' })
      toast({ title: 'Cover updated', description: candidate.title })
    } catch (e) {
      toast({
        title: 'Failed to set cover',
        description: String(e),
        variant: 'negative',
      })
    } finally {
      setApplyingId(null)
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

  const busy = uploading || removing || isSubmitting

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
            {(busy || applyingId !== null) && (
              <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-background/60 backdrop-blur-sm">
                <Loader2 className="size-6 animate-spin text-foreground-secondary" />
              </div>
            )}
            {coverPath && !busy && applyingId === null && (
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
            disabled={busy}
          >
            <Upload className="size-4" />
            Upload image
          </Button>

          {/* Anilist search */}
          <Field invalid={!!errors.title}>
            <Field.Label className="font-normal text-foreground-secondary text-xs">
              Search Anilist
            </Field.Label>
            <form onSubmit={handleSubmit(handleSearch)} className="flex gap-2">
              <Field.Control>
                <Input
                  {...register('title')}
                  placeholder="Series title"
                  size="sm"
                  invalid={!!errors.title || undefined}
                  disabled={busy}
                  className="flex-1"
                />
              </Field.Control>
              <Button
                type="submit"
                size="sm"
                isLoading={isSubmitting}
                disabled={busy}
              >
                <Search className="size-4" />
              </Button>
            </form>
            <Field.Error>{errors.title?.message}</Field.Error>

            {candidates && candidates.length > 0 && (
              <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto rounded-lg border border-border p-1">
                {candidates.map((candidate) => (
                  <li key={candidate.anilistId}>
                    <button
                      type="button"
                      className="flex w-full cursor-pointer items-center gap-2 rounded-md p-1.5 text-start hover:bg-background-secondary disabled:cursor-default disabled:opacity-60"
                      onClick={() => handleApplyCandidate(candidate)}
                      disabled={applyingId !== null}
                    >
                      <img
                        src={candidate.thumbnailUrl}
                        alt=""
                        className="h-12 w-8 shrink-0 rounded-sm object-cover"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm">
                          {candidate.title}
                        </span>
                        {candidate.year && (
                          <span className="block text-foreground-secondary text-xs">
                            {candidate.year}
                          </span>
                        )}
                      </span>
                      {applyingId === candidate.anilistId && (
                        <Loader2 className="size-4 shrink-0 animate-spin text-foreground-secondary" />
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {(localCoverTitle || localAnilistId) &&
              !errors.title &&
              !candidates && (
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
