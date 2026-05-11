import { z } from 'zod'

export const renameSchema = z.object({
  name: z.string().trim().min(1, 'Name cannot be empty'),
})
export type RenameValues = z.infer<typeof renameSchema>
