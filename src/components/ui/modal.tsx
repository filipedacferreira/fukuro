import {
  createContext,
  use,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import { Slot } from '@/components/ui/slot'
import { useElementTransition } from '@/hooks/use-element-transition'
import { cn } from '@/lib/utils/classnames'
import { composeRefs } from '@/utils/compose-refs'

const useDialogElement = (
  open: boolean,
  setOpen: (isOpen: boolean) => void,
) => {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const origin = ref.current
    if (!origin) return
    const openEvent = new CustomEvent(
      open ? 'ui:modal-open' : 'ui:modal-close',
      {
        detail: { origin: ref.current },
      },
    )
    window.dispatchEvent(openEvent)
  }, [open])

  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    if (!element.open) element.showModal()

    const abortController = new AbortController()
    const { signal } = abortController

    element.addEventListener(
      'cancel',
      (event: Event) => {
        event.preventDefault()
        setOpen(false)
      },
      { signal },
    )

    element.addEventListener(
      'keydown',
      (event: KeyboardEvent) => {
        if (event.key === 'Escape' && open) {
          event.preventDefault()
          setOpen(false)
        }
      },
      { signal },
    )

    window.addEventListener(
      'keydown',
      (event: KeyboardEvent) => {
        if (event.key === 'Escape' && element.inert && open) {
          event.preventDefault()
          setOpen(false)
        }
      },
      { signal },
    )

    return () => abortController.abort()
  }, [open, setOpen])

  useEffect(() => {
    const element = ref.current
    if (!element || !open) return

    const handleDialogClick = (event: MouseEvent) => {
      if ((event.target as HTMLElement).nodeName === 'DIALOG') {
        const dialog = event.target as HTMLDialogElement
        const { top, left, width, height } = dialog.getBoundingClientRect()
        const isOutsideModal =
          top > event.clientY ||
          event.clientY > top + height ||
          left > event.clientX ||
          event.clientX > left + width

        if (isOutsideModal) {
          event.stopPropagation()
          setOpen(false)
        }
      }
    }

    element.addEventListener('click', handleDialogClick)
    return () => element.removeEventListener('click', handleDialogClick)
  }, [setOpen, open])

  return ref
}

const ModalContext = createContext<{
  open: boolean
  labelId?: string
  descriptionId?: string
  setOpen: (open: boolean) => void
  setLabelId: (id?: string) => void
  setDescriptionId: (id?: string) => void
} | null>(null)

const useModalContext = () => {
  const context = use(ModalContext)
  if (!context) throw new Error('Modal component must be used within a Modal')
  return context
}

interface ModalProps {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  children: React.ReactNode
}

const Modal = ({ open: propsOpen, onOpenChange, children }: ModalProps) => {
  const [internalOpen, setInternalOpen] = useState(false)
  const [labelId, setLabelId] = useState<string | undefined>(undefined)
  const [descriptionId, setDescriptionId] = useState<string | undefined>(
    undefined,
  )

  const open = propsOpen ?? internalOpen

  const setOpen = useCallback(
    (isOpen: boolean) => {
      setInternalOpen(isOpen)
      onOpenChange?.(isOpen)
    },
    [onOpenChange],
  )

  const ctx = useMemo(
    () => ({
      open,
      setOpen,
      labelId,
      setLabelId,
      descriptionId,
      setDescriptionId,
    }),
    [descriptionId, labelId, open, setOpen],
  )

  return <ModalContext value={ctx}>{children}</ModalContext>
}

interface ModalContentProps extends React.ComponentPropsWithRef<'dialog'> {
  catchFocus?: boolean
}

const ModalContent = ({
  className,
  children,
  catchFocus = true,
  ...props
}: ModalContentProps) => {
  const { open, labelId, descriptionId, setOpen } = useModalContext()
  const dialogRef = useDialogElement(open, setOpen)
  const {
    ref: transitionRef,
    isMounted,
    status,
  } = useElementTransition<HTMLDialogElement>(open)

  if (!isMounted) return null

  return (
    <dialog
      ref={composeRefs(dialogRef, transitionRef)}
      data-status={status}
      aria-labelledby={labelId}
      aria-describedby={descriptionId}
      className={cn('m-auto', className)}
      {...props}
    >
      {catchFocus && (
        <div
          className="sr-only"
          autoFocus
          tabIndex={-1}
          data-modal-focus-catcher=""
        />
      )}
      {children}
    </dialog>
  )
}

interface ModalTriggerProps extends React.ComponentPropsWithRef<'button'> {
  asChild?: boolean
}

const ModalTrigger = ({ asChild, children, ...props }: ModalTriggerProps) => {
  const { setOpen } = useModalContext()

  const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    props.onClick?.(event)
    if (!event.defaultPrevented) setOpen(true)
  }

  const Component = asChild ? Slot : 'button'
  return (
    <Component {...props} onClick={handleClick}>
      {children}
    </Component>
  )
}

interface ModalCloseProps extends React.ComponentPropsWithRef<'button'> {
  asChild?: boolean
}

const ModalClose = ({
  asChild = false,
  children,
  ...props
}: ModalCloseProps) => {
  const { setOpen } = useModalContext()

  const handleClick = (event: React.MouseEvent<HTMLElement>) => {
    props.onClick?.(event as React.MouseEvent<HTMLButtonElement>)
    if (!event.defaultPrevented) setOpen(false)
  }

  const Component = asChild ? Slot : 'button'
  return (
    <Component {...props} onClick={handleClick}>
      {children}
    </Component>
  )
}

interface ModalTitleProps extends React.ComponentPropsWithRef<'h2'> {
  asChild?: boolean
}

const ModalTitle = ({ children, asChild, ...props }: ModalTitleProps) => {
  const generatedId = useId()
  const id = props.id ?? generatedId
  const { setLabelId } = useModalContext()

  useLayoutEffect(() => {
    setLabelId(id)
    return () => setLabelId(undefined)
  }, [id, setLabelId])

  const Component = asChild ? Slot : 'h2'
  return (
    <Component id={id} {...props}>
      {children}
    </Component>
  )
}

interface ModalDescriptionProps extends React.ComponentPropsWithRef<'p'> {
  asChild?: boolean
}

const ModalDescription = ({
  children,
  asChild,
  ...props
}: ModalDescriptionProps) => {
  const generatedId = useId()
  const id = props.id ?? generatedId
  const { setDescriptionId } = useModalContext()

  useLayoutEffect(() => {
    setDescriptionId(id)
    return () => setDescriptionId(undefined)
  }, [id, setDescriptionId])

  const Component = asChild ? Slot : 'p'
  return (
    <Component id={id} {...props}>
      {children}
    </Component>
  )
}

const CompoundModal = Object.assign(Modal, {
  Content: ModalContent,
  Trigger: ModalTrigger,
  Close: ModalClose,
  Title: ModalTitle,
  Description: ModalDescription,
})

export { CompoundModal as Modal }
