import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'

import { nextFrame } from '@/utils/next-frame'

type Status = 'unmounted' | 'initial' | 'open' | 'closed'

interface UseElementTransitionReturn<T extends HTMLElement> {
  ref: React.RefObject<T | null>
  isMounted: boolean
  status: Status
}

export const useElementTransition = <T extends HTMLElement>(
  shouldMount: boolean,
): UseElementTransitionReturn<T> => {
  const ref = useRef<T>(null)
  const [isMounted, setIsMounted] = useState(shouldMount)
  const [status, setStatus] = useState<Status>(
    shouldMount ? 'open' : 'unmounted',
  )

  if (shouldMount && !isMounted) {
    setIsMounted(true)
  }

  useEffect(() => {
    const element = ref.current
    if (!element) return
    if (shouldMount || !isMounted) return

    const triggerUnmount = () => {
      setIsMounted(false)
      setStatus('unmounted')
    }

    nextFrame(() => {
      const hasTransitions = element.getAnimations().length > 0

      if (hasTransitions) {
        const onTransitionEnd = () => {
          const isFinished = element.getAnimations().length === 0
          if (isFinished) {
            triggerUnmount()
          }
        }

        element.addEventListener('transitionend', onTransitionEnd)
        element.addEventListener('transitioncancel', onTransitionEnd)

        return () => {
          element.removeEventListener('transitionend', onTransitionEnd)
          element.removeEventListener('transitioncancel', onTransitionEnd)
        }
      } else {
        triggerUnmount()
      }
    })
  }, [shouldMount, isMounted])

  useLayoutEffect(() => {
    if (!ref.current) return

    if (shouldMount) {
      setStatus('initial')
      return nextFrame(() => {
        flushSync(() => setStatus('open'))
      }, 2)
    }

    setStatus('closed')
  }, [shouldMount])

  return { ref, isMounted, status }
}
