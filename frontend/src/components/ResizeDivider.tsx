import React, { useState, useRef, useEffect } from 'react';

export interface ResizeDividerProps {
  direction?: 'vertical' | 'horizontal';
  onResize: (delta: number) => void;
  onResizeStart?: () => void;
  onResizeEnd?: () => void;
  onReset?: () => void;
  className?: string;
  title?: string;
  ariaLabel?: string;
  disabled?: boolean;
}

/**
 * VS Code-style resizable divider with pointer event tracking,
 * requestAnimationFrame throttling, double-click reset, and cyber aesthetic.
 */
export const ResizeDivider: React.FC<ResizeDividerProps> = ({
  direction = 'vertical',
  onResize,
  onResizeStart,
  onResizeEnd,
  onReset,
  className = '',
  title = 'Drag to resize · Double-click to reset',
  ariaLabel = 'Panel resizer',
  disabled = false,
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const isDraggingRef = useRef(false);
  const startCoordRef = useRef(0);
  const rafIdRef = useRef<number | null>(null);

  const isVertical = direction === 'vertical';

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();

    isDraggingRef.current = true;
    setIsDragging(true);
    startCoordRef.current = isVertical ? e.clientX : e.clientY;

    // Prevent text selection across the whole document during drag
    document.body.style.userSelect = 'none';
    document.body.style.cursor = isVertical ? 'col-resize' : 'row-resize';

    onResizeStart?.();

    const onPointerMove = (moveEvent: PointerEvent) => {
      if (!isDraggingRef.current) return;
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
      }

      rafIdRef.current = requestAnimationFrame(() => {
        const currentCoord = isVertical ? moveEvent.clientX : moveEvent.clientY;
        const delta = currentCoord - startCoordRef.current;
        onResize(delta);
      });
    };

    const onPointerUp = () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      isDraggingRef.current = false;
      setIsDragging(false);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';

      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);

      onResizeEnd?.();
    };

    window.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
  };

  useEffect(() => {
    return () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
      }
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    };
  }, []);

  return (
    <div
      role="separator"
      aria-orientation={isVertical ? 'vertical' : 'horizontal'}
      aria-label={ariaLabel}
      tabIndex={0}
      title={title}
      onPointerDown={handlePointerDown}
      onDoubleClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onReset?.();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onReset?.();
        }
      }}
      className={`group relative flex items-center justify-center select-none touch-none z-20 shrink-0 ${
        isVertical
          ? 'w-2 cursor-col-resize -mx-1 h-full'
          : 'h-2 cursor-row-resize -my-1 w-full'
      } ${
        isDragging
          ? 'bg-cyan-500/15'
          : 'hover:bg-cyan-500/10'
      } ${className}`}
    >
      {/* 1px visible divider line */}
      <div
        className={`transition-all duration-150 ${
          isVertical ? 'w-[1px] h-full' : 'h-[1px] w-full'
        } ${
          isDragging
            ? 'bg-cyan-400 shadow-[0_0_8px_rgba(54,213,223,0.8)]'
            : 'bg-[#212638] group-hover:bg-cyan-400/80 group-hover:shadow-[0_0_6px_rgba(54,213,223,0.4)]'
        }`}
      />

      {/* Subtle grab handle indicator pill */}
      <div
        className={`absolute rounded-full pointer-events-none transition-all duration-150 ${
          isVertical
            ? 'top-1/2 -translate-y-1/2 w-1 h-6'
            : 'left-1/2 -translate-x-1/2 h-1 w-6'
        } ${
          isDragging
            ? 'opacity-100 bg-cyan-400 shadow-[0_0_8px_rgba(54,213,223,0.8)]'
            : 'opacity-0 group-hover:opacity-100 bg-cyan-400/80'
        }`}
      />
    </div>
  );
};
