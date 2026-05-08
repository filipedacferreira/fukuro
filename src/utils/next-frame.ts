export const nextFrame = (cb: (...args: unknown[]) => void, numFrames = 1) => {
  let id: number

  const frame = (remaining: number) => {
    if (remaining > 1) {
      id = requestAnimationFrame(() => frame(remaining - 1))
    } else {
      id = requestAnimationFrame(() => cb())
    }
  }

  frame(numFrames)

  return () => cancelAnimationFrame(id)
}
