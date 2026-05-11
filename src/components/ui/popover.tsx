import {
  autoUpdate,
  type FloatingContext,
  FloatingFocusManager,
  flip,
  hide,
  offset as offsetMiddleware,
  type Placement,
  shift,
  size,
  type UseFloatingOptions,
  type UseInteractionsReturn,
  useClick,
  useDismiss,
  useFloating,
  useInteractions,
  useMergeRefs,
  useRole,
  useTransitionStatus,
} from '@floating-ui/react'
import { Search } from 'lucide-react'
import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react'

import { Slot } from '@/components/ui/slot'
import { Spinner } from '@/components/ui/spinner'
import { useTopLayer } from '@/hooks/use-top-layer'
import { cn } from '@/lib/utils/classnames'

type PopoverOrigin = 'trigger' | 'pointer' | [number, number]

interface UsePopoverFloatingOptions {
  open?: boolean
  onOpenChange?: UseFloatingOptions['onOpenChange']
  placement?: Placement
  offset?: number
  origin?: PopoverOrigin
  flipFallbackPlacements?: Placement[]
  nodeId?: string
}

const usePopoverFloating = ({
  open: propsOpen,
  onOpenChange: propsOnOpenChange,
  placement = 'bottom',
  offset = 4,
  origin = 'trigger',
  flipFallbackPlacements,
  nodeId,
}: UsePopoverFloatingOptions) => {
  const [internalOpen, setInternalOpen] = useState(false)
  const open = propsOpen ?? internalOpen

  const setOpen = useCallback<NonNullable<UseFloatingOptions['onOpenChange']>>(
    (open, event, reason) => {
      setInternalOpen(open)
      propsOnOpenChange?.(open, event, reason)
    },
    [propsOnOpenChange],
  )

  const floating = useFloating({
    nodeId,
    placement,
    open,
    onOpenChange: setOpen,
    whileElementsMounted: (reference, floatingEl, update) => {
      let paused = false
      const isTextInput = (n: EventTarget | null) =>
        n instanceof HTMLElement &&
        (n.tagName === 'INPUT' ||
          n.tagName === 'TEXTAREA' ||
          n.isContentEditable)
      const onFocusIn = (e: FocusEvent) => {
        if (isTextInput(e.target)) paused = true
      }
      const onFocusOut = (e: FocusEvent) => {
        if (isTextInput(e.target)) paused = false
      }
      floatingEl.addEventListener('focusin', onFocusIn)
      floatingEl.addEventListener('focusout', onFocusOut)

      const cleanup = autoUpdate(
        reference,
        floatingEl,
        () => {
          if (paused) return
          update()
        },
        { layoutShift: false },
      )

      return () => {
        cleanup()
        floatingEl.removeEventListener('focusin', onFocusIn)
        floatingEl.removeEventListener('focusout', onFocusOut)
      }
    },
    middleware: [
      flip({ padding: 8, fallbackPlacements: flipFallbackPlacements }),
      shift({ padding: 8 }),
      offsetMiddleware(offset),
      size({
        apply({ rects, elements, availableHeight }) {
          elements.floating.style.setProperty(
            '--max-height',
            `${availableHeight}px`,
          )
          elements.floating.style.setProperty(
            '--width',
            `${rects.reference.width}px`,
          )
        },
        padding: 4,
      }),
      hide(),
    ],
  })

  useEffect(() => {
    if (Array.isArray(origin)) {
      const [x, y] = origin
      floating.refs.setPositionReference({
        getBoundingClientRect: () => ({
          width: 0,
          height: 0,
          x,
          y,
          top: y,
          right: x,
          bottom: y,
          left: x,
        }),
      })
    }
  }, [origin, floating.refs])

  return useMemo(
    () => ({
      open,
      setOpen,
      origin,
      ...floating,
    }),
    [open, setOpen, origin, floating],
  )
}

interface ContextType
  extends ReturnType<typeof usePopoverFloating>,
    UseInteractionsReturn {
  modal: boolean
}

const PopoverContext = createContext<ContextType | null>(null)

const usePopoverContext = () => {
  const context = use(PopoverContext)

  if (context == null) {
    throw new Error('Popover components must be wrapped in <Popover />')
  }

  return context
}

interface PopoverProps extends UsePopoverFloatingOptions {
  modal?: boolean
  children: React.ReactNode
}

const Popover = ({ children, modal = false, ...props }: PopoverProps) => {
  const floating = usePopoverFloating(props)

  const click = useClick(floating.context)
  const dismiss = useDismiss(floating.context)
  const role = useRole(floating.context)

  const interactions = useInteractions([click, dismiss, role])

  const popoverContextValue = useMemo(
    () => ({
      ...floating,
      ...interactions,
      modal,
    }),
    [floating, interactions, modal],
  )

  return <PopoverContext value={popoverContextValue}>{children}</PopoverContext>
}

interface PopoverTriggerProps extends React.ComponentPropsWithRef<'button'> {
  asChild?: boolean
}

const PopoverTrigger = ({
  ref: refProp,
  children,
  asChild = false,
  className,
  ...props
}: PopoverTriggerProps) => {
  const context = usePopoverContext()
  const Comp = asChild ? Slot : 'button'

  const ref = useMergeRefs([context.refs.setReference, refProp])
  const referenceProps = context.getReferenceProps(props)

  return (
    <Comp
      ref={ref}
      type={asChild ? undefined : 'button'}
      className={cn(!asChild && 'disabled:opacity-40', className)}
      data-state={context.open ? 'open' : 'closed'}
      {...referenceProps}
      onClick={(event: React.MouseEvent<HTMLButtonElement>) => {
        if (
          context.origin === 'pointer' &&
          !context.open &&
          event.clientX &&
          event.clientY
        ) {
          const x = event.clientX
          const y = event.clientY
          context.refs.setPositionReference({
            getBoundingClientRect: () => ({
              width: 0,
              height: 0,
              x,
              y,
              top: y,
              right: x,
              bottom: y,
              left: x,
            }),
          })
        }
        if (typeof referenceProps.onClick === 'function') {
          referenceProps.onClick(event)
        }
      }}
    >
      {children}
    </Comp>
  )
}

const PopoverContent = ({
  ref: refProp,
  className,
  children,
  ...props
}: React.ComponentPropsWithRef<'div'>) => {
  const { context, refs, getFloatingProps, modal, isPositioned } =
    usePopoverContext()

  const ref = useMergeRefs([refs.setFloating, refProp])

  return (
    <PopoverPanel
      context={context}
      modal={modal}
      isPositioned={isPositioned}
      ref={ref}
      className={cn(
        'z-50 max-h-(--max-height) w-72 overflow-auto rounded-xl border border-border bg-background p-3 font-medium text-foreground shadow-lg outline-none',
        className,
      )}
      {...getFloatingProps(props)}
    >
      {children}
    </PopoverPanel>
  )
}

interface PopoverPanelProps extends React.ComponentPropsWithRef<'div'> {
  context: FloatingContext
  modal?: boolean
  isPositioned?: boolean
  initialFocus?: number | React.RefObject<HTMLElement | null>
  returnFocus?: boolean
  animate?: boolean
}

const PopoverPanel = ({
  ref,
  context,
  modal,
  isPositioned = true,
  initialFocus,
  returnFocus,
  animate = true,
  className,
  style,
  ...props
}: PopoverPanelProps) => {
  const { isMounted, status } = useTransitionStatus(context, {
    duration: animate ? 150 : 0,
  })
  const topLayerRef = useTopLayer<HTMLDivElement>(isMounted)

  const mergedRef = useMergeRefs([ref, topLayerRef])

  if (!isMounted) return null

  const hidden = !isPositioned || context.middlewareData.hide?.referenceHidden

  return (
    <FloatingFocusManager
      context={context}
      modal={modal}
      initialFocus={initialFocus}
      returnFocus={returnFocus}
    >
      <div
        ref={mergedRef}
        data-state={['open', 'initial'].includes(status) ? 'open' : 'closed'}
        data-side={context.placement.split('-')[0]}
        className={cn(
          animate && [
            'origin-(--transform-origin) transition duration-300 ease-out',
            'data-[state=closed]:data-[side=left]:translate-x-2 data-[state=closed]:data-[side=right]:-translate-x-2 data-[state=closed]:data-[side=bottom]:-translate-y-2 data-[state=closed]:data-[side=top]:translate-y-2',
            'data-[state=closed]:scale-95 data-[state=closed]:opacity-0 data-[state=closed]:duration-150',
            'data-[state=open]:translate-x-0 data-[state=open]:translate-y-0 data-[state=open]:scale-100',
          ],
          className,
        )}
        style={
          {
            position: context.strategy,
            top: context.y ?? 0,
            left: context.x ?? 0,
            '--transform-origin': placementToTransformOrigin(context.placement),
            visibility: hidden ? 'hidden' : 'visible',
            ...style,
          } as React.CSSProperties
        }
        {...props}
      />
    </FloatingFocusManager>
  )
}

const placementToTransformOrigin = (placement: Placement) => {
  switch (placement) {
    case 'top':
      return 'bottom'
    case 'bottom':
      return 'top'
    case 'left':
      return 'right'
    case 'right':
      return 'left'
    case 'top-start':
      return 'bottom left'
    case 'top-end':
      return 'bottom right'
    case 'bottom-start':
      return 'top left'
    case 'bottom-end':
      return 'top right'
    case 'left-start':
      return 'right top'
    case 'left-end':
      return 'right bottom'
    case 'right-start':
      return 'left top'
    case 'right-end':
      return 'left bottom'
  }
}

interface PopoverCloseProps extends React.ComponentPropsWithRef<'button'> {
  asChild?: boolean
}

const PopoverClose = ({
  asChild = false,
  children,
  ...props
}: PopoverCloseProps) => {
  const { setOpen } = usePopoverContext()
  const Comp = asChild ? Slot : 'button'

  return (
    <Comp
      {...props}
      onClick={(event: React.MouseEvent<HTMLElement>) => {
        props.onClick?.(event as React.MouseEvent<HTMLButtonElement>)
        setOpen(false)
      }}
    >
      {children}
    </Comp>
  )
}

interface PopoverSearchInputProps extends React.ComponentPropsWithRef<'input'> {
  isLoading?: boolean
}

const PopoverSearchInput = ({
  className,
  isLoading,
  ...props
}: PopoverSearchInputProps) => {
  return (
    <div className="relative flex items-center rounded-t-lg border-border border-b bg-transparent">
      {isLoading ? (
        <Spinner size="sm" className="absolute left-4 text-foreground" />
      ) : (
        <Search className="absolute left-4 size-4 shrink-0 text-foreground" />
      )}
      <input
        className={cn(
          'h-10 w-full border-0 bg-transparent p-4 pl-10 font-medium text-base outline-none transition-colors placeholder:text-foreground-secondary focus:ring-0',
          className,
        )}
        {...props}
      />
    </div>
  )
}

const PopoverEmpty = ({
  children,
  className,
  ...props
}: React.ComponentPropsWithRef<'div'>) => {
  return (
    <div
      className={cn(
        'my-4 text-center text-base text-foreground-secondary',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  )
}

const CompoundPopover = Object.assign(Popover, {
  Trigger: PopoverTrigger,
  Content: PopoverContent,
  Close: PopoverClose,
  SearchInput: PopoverSearchInput,
  Empty: PopoverEmpty,
  Panel: PopoverPanel,
})

export type { PopoverOrigin }
export {
  CompoundPopover as Popover,
  PopoverContext,
  usePopoverContext,
  usePopoverFloating,
}
