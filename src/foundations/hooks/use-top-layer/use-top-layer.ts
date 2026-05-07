import { type RefCallback, useCallback, useRef } from 'react';

type PopoverType = 'manual' | 'hint';

const showAsPopover = <T extends HTMLElement>(element: T, type: PopoverType) => {
  element.setAttribute('popover', type);
  try {
    element.showPopover();
  } catch {
    // already showing
  }
};

const hideAsPopover = <T extends HTMLElement>(element: T) => {
  try {
    element.hidePopover();
  } catch {
    // already hidden
  }
  element.removeAttribute('popover');
};

export const useTopLayer = <T extends HTMLElement>(
  active: boolean = true,
  type: PopoverType = 'manual'
): RefCallback<T> => {
  const previousRef = useRef<T | null>(null);

  return useCallback(
    (element: T | null) => {
      const previous = previousRef.current;
      if (previous && previous !== element) hideAsPopover(previous);
      previousRef.current = element;
      if (element && active) showAsPopover(element, type);
    },
    [active, type]
  );
};
