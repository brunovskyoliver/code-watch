import { useEffect, useRef, type ReactNode, type RefObject } from "react";

export function CommandPaletteDialog({
  open,
  label,
  value,
  placeholder,
  inputRef,
  selectedItemId,
  onClose,
  onValueChange,
  children
}: {
  open: boolean;
  label: string;
  value: string;
  placeholder: string;
  inputRef: RefObject<HTMLInputElement | null>;
  selectedItemId?: string | null;
  onClose: () => void;
  onValueChange: (value: string) => void;
  children: ReactNode;
}) {
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open || !selectedItemId) {
      return;
    }

    const selectedItem = listRef.current?.querySelector<HTMLElement>('[data-command-palette-selected="true"]');
    selectedItem?.scrollIntoView({ block: "nearest" });
  }, [open, selectedItemId]);

  if (!open) {
    return null;
  }

  return (
    <div
      className="command-palette-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="command-palette" role="dialog" aria-modal="true" aria-label={label} onMouseDown={(event) => event.stopPropagation()}>
        <RaycastInputBar
          inputRef={inputRef}
          value={value}
          placeholder={placeholder}
          ariaLabel={label}
          onValueChange={onValueChange}
        />
        <div ref={listRef} className="command-palette-list">{children}</div>
      </div>
    </div>
  );
}

export function RaycastInputBar({
  inputRef,
  value,
  placeholder,
  ariaLabel,
  onValueChange
}: {
  inputRef: RefObject<HTMLInputElement | null>;
  value: string;
  placeholder: string;
  ariaLabel: string;
  onValueChange: (value: string) => void;
}) {
  return (
    <div className="raycast-input-bar">
      <input
        ref={inputRef}
        className="command-palette-input"
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        placeholder={placeholder}
        aria-label={ariaLabel}
      />
    </div>
  );
}
