import * as React from 'react';
import { Pin, PinOff } from 'lucide-react';
import {
  motion,
  LayoutGroup,
  AnimatePresence,
  type HTMLMotionProps,
  type Transition,
} from 'motion/react';
import { cn } from '../lib/utils';

export type PinListProps<T> = {
  items: T[];
  isPinned: (item: T) => boolean;
  onTogglePin: (item: T, event: React.MouseEvent) => void;
  renderItem: (item: T, idx: number) => React.ReactNode;
  labels?: {
    pinned?: string;
    unpinned?: string;
  };
  transition?: Transition;
  labelMotionProps?: HTMLMotionProps<'p'>;
  className?: string;
  labelClassName?: string;
  pinnedSectionClassName?: string;
  unpinnedSectionClassName?: string;
  zIndexResetDelay?: number;
  itemKey: (item: T) => string;
} & Omit<HTMLMotionProps<'div'>, 'children' | 'transition'>;

export function PinList<T>({
  items,
  isPinned,
  onTogglePin,
  renderItem,
  itemKey,
  labels = { pinned: 'Pinned', unpinned: 'All' },
  transition = { stiffness: 320, damping: 20, mass: 0.8, type: 'spring' },
  labelMotionProps = {
    initial: { opacity: 0, height: 0 },
    animate: { opacity: 1, height: 'auto' },
    exit: { opacity: 0, height: 0 },
    transition: { duration: 0.22, ease: 'easeInOut' },
  },
  className,
  labelClassName,
  pinnedSectionClassName,
  unpinnedSectionClassName,
  zIndexResetDelay = 500,
  ...props
}: PinListProps<T>) {
  const [togglingGroup, setTogglingGroup] = React.useState<'pinned' | 'unpinned' | null>(null);

  const pinned = items.filter((u) => isPinned(u));
  const unpinned = items.filter((u) => !isPinned(u));

  const handleToggle = (item: T, e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setTogglingGroup(isPinned(item) ? 'pinned' : 'unpinned');
    onTogglePin(item, e);
    setTimeout(() => setTogglingGroup(null), zIndexResetDelay);
  };

  return (
    <motion.div className={cn('pin-list', className)} {...props as any}>
      <LayoutGroup>
        <div className="pin-list-section">
          <AnimatePresence>
            {pinned.length > 0 && (
              <motion.p
                layout
                key="pinned-label"
                className={cn('pin-list-label', labelClassName)}
                {...labelMotionProps as any}
              >
                {labels.pinned}
              </motion.p>
            )}
          </AnimatePresence>
          {pinned.length > 0 && (
            <div
              className={cn(
                'pin-list-group',
                togglingGroup === 'pinned' ? 'pin-list-group-animating' : '',
                pinnedSectionClassName,
              )}
            >
              {pinned.map((item, idx) => (
                <motion.div
                  className="pin-list-item-wrapper"
                  key={itemKey(item)}
                  layoutId={`item-${itemKey(item)}`}
                  transition={transition}
                >
                  {renderItem(item, idx)}
                  <button className="pin-list-toggle-button" onClick={(e) => handleToggle(item, e)} type="button" aria-label="Unpin">
                    <PinOff className="pin-list-icon" />
                  </button>
                </motion.div>
              ))}
            </div>
          )}
        </div>

        <div className="pin-list-section">
          <AnimatePresence>
            {unpinned.length > 0 && (
              <motion.p
                layout
                key="all-label"
                className={cn('pin-list-label', labelClassName)}
                {...labelMotionProps as any}
              >
                {labels.unpinned}
              </motion.p>
            )}
          </AnimatePresence>
          <div
            className={cn(
              'pin-list-group',
              togglingGroup === 'unpinned' ? 'pin-list-group-animating' : '',
              unpinnedSectionClassName,
            )}
          >
            {unpinned.map((item, idx) => (
              <motion.div
                className="pin-list-item-wrapper"
                key={itemKey(item)}
                layoutId={`item-${itemKey(item)}`}
                transition={transition}
              >
                {renderItem(item, idx)}
                <button className="pin-list-toggle-button" onClick={(e) => handleToggle(item, e)} type="button" aria-label="Pin">
                  <Pin className="pin-list-icon" />
                </button>
              </motion.div>
            ))}
          </div>
        </div>
      </LayoutGroup>
    </motion.div>
  );
}
