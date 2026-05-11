import {
  FloatingList,
  FloatingNode,
  FloatingTree,
  safePolygon,
  type UseInteractionsReturn,
  useClick,
  useDismiss,
  useFloatingNodeId,
  useFloatingParentNodeId,
  useFloatingTree,
  useHover,
  useInteractions,
  useListItem,
  useListNavigation,
  useMergeRefs,
  useRole,
  useTypeahead,
} from '@floating-ui/react'
import { ChevronRight } from 'lucide-react'
import {
  createContext,
  Fragment,
  use,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Divider } from '@/components/ui/divider'
import {
  Popover,
  PopoverContext,
  type PopoverOrigin,
  usePopoverContext,
  usePopoverFloating,
} from '@/components/ui/popover'
import { Slot } from '@/components/ui/slot'
import { useStableCallback } from '@/hooks/use-stable-callback'
import { cn, cva } from '@/lib/utils/classnames'

const HOVER_OPEN_DELAY = 75
const HOVER_CLOSE_DELAY = 150

type Item = {
  id: string
  label: string
  onSelect?: (e: { preventDefault: () => void }) => void
}

type Items = Record<string, Item>

interface MenuContextType {
  parent: MenuContextType | null
  isNested: boolean
  elementsRef: React.RefObject<(HTMLElement | null)[]>
  highlightedIndex: number | null
  setHighlightedIndex: React.Dispatch<React.SetStateAction<number | null>>
  searchInputRef: React.RefObject<HTMLInputElement | null>
  hasSearchInput: boolean
  setSearchInputEl: (el: HTMLInputElement | null) => void
  items: Items
  registerItem: (item: Item) => () => void
  getItemProps: UseInteractionsReturn['getItemProps']
}

const MenuContext = createContext<MenuContextType | null>(null)

const useMenuContext = () => {
  const context = use(MenuContext)

  if (context == null) {
    throw new Error('Menu components must be wrapped in <Menu />')
  }

  return context
}

interface MenuProps {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  placement?: React.ComponentProps<typeof Popover>['placement']
  offset?: number
  origin?: PopoverOrigin
  modal?: boolean
  children?: React.ReactNode
}

const Menu = (props: MenuProps) => {
  const parentId = useFloatingParentNodeId()
  const Container = parentId === null ? FloatingTree : Fragment

  return (
    <Container>
      <MenuRoot {...props} />
    </Container>
  )
}

const MenuRoot = ({
  children,
  modal = true,
  placement: propPlacement,
  ...props
}: MenuProps) => {
  const parent = use(MenuContext)
  const parentId = useFloatingParentNodeId()
  const isNested = !!parentId

  const [highlightedIndex, setHighlightedIndex] = useState<number | null>(null)
  const elementsRef = useRef<(HTMLElement | null)[]>([])
  const [items, setItems] = useState<Items>({})
  const labelsRef = useRef<string[]>([])
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const [hasSearchInput, setHasSearchInput] = useState(false)
  const setSearchInputEl = useCallback((el: HTMLInputElement | null) => {
    searchInputRef.current = el
    setHasSearchInput(!!el)
  }, [])

  useEffect(() => {
    labelsRef.current = Object.values(items).map((item) => item.label)
  }, [items])

  const registerItem = useCallback((item: Item) => {
    setItems((prev) => ({ ...prev, [item.id]: item }))

    return () => {
      setItems((prev) => {
        const { [item.id]: _, ...rest } = prev
        return rest
      })
    }
  }, [])

  const tree = useFloatingTree()
  const nodeId = useFloatingNodeId()

  const floating = usePopoverFloating({
    nodeId,
    placement: propPlacement ?? (isNested ? 'right-start' : 'bottom-start'),
    offset: isNested ? -4 : 4,
    flipFallbackPlacements: isNested
      ? ['left-start', 'bottom-start', 'top-start']
      : undefined,
    ...props,
  })

  const hover = useHover(floating.context, {
    enabled: isNested,
    delay: { open: HOVER_OPEN_DELAY, close: HOVER_CLOSE_DELAY },
    handleClose: safePolygon({ blockPointerEvents: true }),
    mouseOnly: true,
  })

  const click = useClick(floating.context, {
    event: 'click',
    ignoreMouse: isNested,
    toggle: !isNested,
  })

  const role = useRole(floating.context, { role: 'menu' })
  const dismiss = useDismiss(floating.context, { bubbles: true })

  const listNavigation = useListNavigation(floating.context, {
    listRef: elementsRef,
    activeIndex: highlightedIndex,
    nested: isNested,
    onNavigate: setHighlightedIndex,
    virtual: hasSearchInput,
  })

  const typeahead = useTypeahead(floating.context, {
    enabled: !hasSearchInput && !isNested,
    listRef: labelsRef,
    activeIndex: highlightedIndex,
    onMatch: setHighlightedIndex,
  })

  const interactions = useInteractions([
    hover,
    click,
    role,
    dismiss,
    listNavigation,
    typeahead,
  ])

  useEffect(() => {
    if (!tree) return

    const onTreeClick = () => floating.setOpen(false)
    const onSubMenuOpen = (event: { nodeId: string; parentId: string }) => {
      if (event.nodeId !== nodeId && event.parentId === parentId) {
        floating.setOpen(false)
      }
    }

    tree.events.on('click', onTreeClick)
    tree.events.on('menuopen', onSubMenuOpen)

    return () => {
      tree.events.off('click', onTreeClick)
      tree.events.off('menuopen', onSubMenuOpen)
    }
  }, [tree, nodeId, parentId, floating])

  useEffect(() => {
    if (floating.open && tree) {
      tree.events.emit('menuopen', { parentId, nodeId })
    }
  }, [tree, nodeId, parentId, floating.open])

  const popoverContextValue = useMemo(
    () => ({
      ...floating,
      ...interactions,
      modal,
    }),
    [floating, interactions, modal],
  )

  const menuContextValue = useMemo<MenuContextType>(
    () => ({
      parent,
      isNested,
      elementsRef,
      highlightedIndex,
      setHighlightedIndex,
      searchInputRef,
      hasSearchInput,
      setSearchInputEl,
      items,
      registerItem,
      getItemProps: interactions.getItemProps,
    }),
    [
      parent,
      isNested,
      highlightedIndex,
      hasSearchInput,
      setSearchInputEl,
      items,
      registerItem,
      interactions.getItemProps,
    ],
  )

  return (
    <FloatingNode id={nodeId}>
      <PopoverContext value={popoverContextValue}>
        <MenuContext value={menuContextValue}>{children}</MenuContext>
      </PopoverContext>
    </FloatingNode>
  )
}

interface MenuTriggerProps extends React.ComponentPropsWithRef<'button'> {
  asChild?: boolean
}

const MenuTrigger = ({
  ref: refProp,
  asChild,
  children,
  className,
  ...props
}: MenuTriggerProps) => {
  const popover = usePopoverContext()
  const { isNested, parent } = useMenuContext()
  const item = useListItem()

  const ref = useMergeRefs([popover.refs.setReference, item.ref, refProp])

  const isHighlighted = parent?.highlightedIndex === item.index
  const Comp = asChild ? Slot : 'button'

  const referenceProps = popover.getReferenceProps(
    isNested ? parent?.getItemProps(props) : props,
  )

  return (
    <Comp
      ref={ref}
      type={asChild ? undefined : 'button'}
      className={cn(!asChild && 'disabled:opacity-40', className)}
      tabIndex={isNested ? (isHighlighted ? 0 : -1) : 0}
      data-state={popover.open ? 'open' : 'closed'}
      data-highlighted={isHighlighted || undefined}
      {...referenceProps}
    >
      {children}
    </Comp>
  )
}

const itemTriggerStyle = cva({
  base: [
    'relative mx-(--inset) flex w-[calc(100%-calc(var(--inset)*2))] cursor-pointer select-none items-center gap-1.5 rounded-lg px-3 py-1.5',
    'font-medium text-base text-foreground/80 outline-none',
    'first-of-type:mt-(--inset) last-of-type:mb-(--inset)',
    'data-disabled:pointer-events-none data-disabled:opacity-50',
    'active:bg-background-secondary data-[state=open]:bg-background-secondary data-highlighted:bg-background-secondary',
  ],
})

const MenuItemTrigger = ({
  children,
  className,
  ...props
}: MenuTriggerProps) => {
  const { parent } = useMenuContext()

  if (!parent) {
    throw new Error(
      '<Menu.ItemTrigger> must be rendered inside a nested <Menu>.',
    )
  }

  return (
    <MenuTrigger asChild {...props}>
      <button
        type="button"
        role="menuitem"
        className={itemTriggerStyle({ className })}
      >
        {children}
        <ChevronRight className="ml-auto size-4 text-foreground-secondary" />
      </button>
    </MenuTrigger>
  )
}

interface MenuItemsProps extends React.ComponentPropsWithRef<'div'> {
  inline?: boolean
}

const MenuItems = ({
  ref: refProp,
  children,
  className,
  inline,
  ...props
}: MenuItemsProps) => {
  const popover = usePopoverContext()
  const { isNested, elementsRef, searchInputRef, hasSearchInput } =
    useMenuContext()

  const ref = useMergeRefs([popover.refs.setFloating, refProp])

  if (inline) {
    return (
      <FloatingList elementsRef={elementsRef}>
        <div
          ref={ref}
          className={cn('font-medium text-foreground outline-none', className)}
          {...popover.getFloatingProps(props)}
        >
          {children}
        </div>
      </FloatingList>
    )
  }

  return (
    <FloatingList elementsRef={elementsRef}>
      <Popover.Panel
        ref={ref}
        context={popover.context}
        modal={popover.modal}
        isPositioned={popover.isPositioned}
        initialFocus={hasSearchInput ? searchInputRef : isNested ? -1 : 0}
        returnFocus={!isNested}
        animate={!isNested}
        className={cn(
          'z-50 max-h-(--max-height) w-56 scroll-py-(--inset) overflow-auto rounded-xl border border-border bg-background font-medium text-foreground shadow-lg outline-none',
          className,
        )}
        {...popover.getFloatingProps(props)}
      >
        {children}
      </Popover.Panel>
    </FloatingList>
  )
}

const itemStyle = cva({
  base: [
    'relative mx-(--inset) flex w-[calc(100%-calc(var(--inset)*2))] cursor-pointer select-none items-center gap-1.5 rounded-lg px-3 py-1.5',
    'font-medium text-base outline-none',
    'first-of-type:mt-(--inset) last-of-type:mb-(--inset)',
    'data-disabled:pointer-events-none data-disabled:opacity-50',
  ],
  variants: {
    variant: {
      default:
        'text-foreground/80 active:bg-background-secondary data-highlighted:bg-background-secondary',
      destructive: 'text-error active:bg-error/10 data-highlighted:bg-error/10',
    },
  },
  defaultVariants: { variant: 'default' },
})

interface MenuItemProps extends React.ComponentPropsWithRef<'button'> {
  onSelect?: Item['onSelect']
  asChild?: boolean
  variant?: 'default' | 'destructive'
}

const MenuItem = ({
  ref: refProp,
  children,
  className,
  disabled,
  variant,
  onClick,
  onSelect,
  onKeyDown,
  asChild,
  ...props
}: MenuItemProps) => {
  const itemId = useId()
  const innerRef = useRef<HTMLButtonElement | null>(null)
  const { registerItem, highlightedIndex, getItemProps, searchInputRef } =
    useMenuContext()
  const popoverCtx = usePopoverContext()
  const tree = useFloatingTree()
  const stableOnSelect = useStableCallback(onSelect)

  const { ref: listItemRef, index } = useListItem()
  const ref = useMergeRefs([listItemRef, refProp, innerRef])

  const isHighlighted = highlightedIndex === index
  const Comp = asChild ? Slot : 'button'

  useLayoutEffect(() => {
    const text = innerRef.current?.textContent
    if (!text) return

    return registerItem({
      id: itemId,
      label: text,
      onSelect: stableOnSelect,
    })
  }, [registerItem, itemId, stableOnSelect])

  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    onClick?.(e)
    if (e.defaultPrevented) return

    stableOnSelect?.(e)
    if (e.defaultPrevented) return

    if (tree) {
      tree.events.emit('click')
    } else {
      popoverCtx.setOpen(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    onKeyDown?.(e)
    if (e.defaultPrevented) return

    if (searchInputRef.current && e.key !== 'Enter') {
      searchInputRef.current.focus()
    }
  }

  return (
    <Comp
      ref={ref}
      type={asChild ? undefined : 'button'}
      role="menuitem"
      data-item-id={itemId}
      data-highlighted={isHighlighted || undefined}
      tabIndex={isHighlighted ? 0 : -1}
      disabled={disabled || undefined}
      data-disabled={disabled || undefined}
      className={itemStyle({ variant, className })}
      {...getItemProps({
        ...props,
        onKeyDown: handleKeyDown,
        onClick: handleClick,
      })}
    >
      {children}
    </Comp>
  )
}

interface MenuSectionContextType {
  setTitleId: (id: string) => void
}

const MenuSectionContext = createContext<MenuSectionContextType | null>(null)

const MenuSection = ({
  children,
  className,
  ...props
}: React.ComponentPropsWithRef<'div'>) => {
  const [titleId, setTitleId] = useState<string | undefined>(undefined)

  return (
    <MenuSectionContext value={{ setTitleId }}>
      {/* biome-ignore lint/a11y/useSemanticElements: maintain div */}
      <div
        role="group"
        aria-labelledby={titleId}
        className={cn(
          'flex flex-col items-stretch border-border not-first:border-t',
          className,
        )}
        {...props}
      >
        {children}
      </div>
    </MenuSectionContext>
  )
}

const MenuHeading = ({
  children,
  id: propsId,
  className,
  ...props
}: React.ComponentPropsWithRef<'div'>) => {
  const generatedId = useId()
  const id = propsId ?? generatedId
  const ctx = use(MenuSectionContext)

  useLayoutEffect(() => {
    if (ctx) ctx.setTitleId(id)
  }, [ctx, id])

  return (
    <div
      id={id}
      className={cn(
        'px-3.5 pt-3 pb-1 font-medium text-foreground-secondary text-sm',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  )
}

const MenuDivider = ({
  className,
  ...props
}: React.ComponentPropsWithRef<'div'>) => {
  return <Divider className={cn('my-(--inset)', className)} {...props} />
}

interface MenuSearchInputProps extends React.ComponentPropsWithRef<'input'> {
  isLoading?: boolean
}

const MenuSearchInput = ({
  ref: refProp,
  onChange,
  onKeyDown,
  isLoading,
  ...props
}: MenuSearchInputProps) => {
  const internalRef = useRef<HTMLInputElement | null>(null)
  const {
    highlightedIndex,
    setHighlightedIndex,
    items,
    setSearchInputEl,
    elementsRef,
  } = useMenuContext()
  const popoverCtx = usePopoverContext()
  const tree = useFloatingTree()

  const ref = useMergeRefs([refProp, internalRef, setSearchInputEl])

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange?.(e)
    setHighlightedIndex(0)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && highlightedIndex !== null) {
      const id = elementsRef.current[highlightedIndex]?.dataset.itemId
      if (id && items[id]) {
        items[id].onSelect?.(e)
        if (!e.defaultPrevented) {
          if (tree) {
            tree.events.emit('click')
          } else {
            popoverCtx.setOpen(false)
          }
        }
      }
    }
    onKeyDown?.(e)
  }

  return (
    <Popover.SearchInput
      ref={ref}
      onChange={handleChange}
      onKeyDown={handleKeyDown}
      isLoading={isLoading}
      {...props}
    />
  )
}

const MenuEmpty = Popover.Empty

const CompoundMenu = Object.assign(Menu, {
  Trigger: MenuTrigger,
  ItemTrigger: MenuItemTrigger,
  Items: MenuItems,
  Item: MenuItem,
  Section: MenuSection,
  Heading: MenuHeading,
  Divider: MenuDivider,
  SearchInput: MenuSearchInput,
  Empty: MenuEmpty,
})

export { CompoundMenu as Menu, useMenuContext }
