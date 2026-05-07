import { cn } from '@/lib/utils/classnames';

interface DividerProps extends React.ComponentPropsWithRef<'div'> {
  orientation?: 'horizontal' | 'vertical';
  decorative?: boolean;
}

const Divider = ({
  className,
  orientation = 'horizontal',
  decorative,
  ...props
}: DividerProps) => {
  const ariaOrientation = orientation === 'vertical' ? orientation : undefined;
  const semanticProps = decorative
    ? { role: 'none' }
    : { 'aria-orientation': ariaOrientation, role: 'separator' };

  return (
    <div
      className={cn(
        'shrink-0 bg-border',
        orientation === 'horizontal' ? 'h-px w-full' : 'h-full w-px',
        className
      )}
      {...semanticProps}
      {...props}
    />
  );
};

export { Divider };
