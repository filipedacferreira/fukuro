import { useCallback, useEffect, useRef } from 'react'

// biome-ignore lint/suspicious/noExplicitAny: expected
type AnyFunction = (...args: any[]) => any

export const useStableCallback = <T extends AnyFunction>(callback?: T) => {
  const callbackRef = useRef<T | undefined>(callback)

  useEffect(() => {
    if (callback) {
      callbackRef.current = callback
    }
  }, [callback])

  const stableCallback = useCallback((...args: Parameters<T>) => {
    if (callbackRef.current) {
      callbackRef.current(...args)
    }
  }, [])

  return stableCallback
}
