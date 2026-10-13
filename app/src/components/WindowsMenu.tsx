import { useEffect, useRef, useState } from 'react';
import { useUIF } from './UIFContext';

/** The field's Windows menu: opens .history, .memory, .prompt, .persona and .model. */
export function WindowsMenu() {
  const uif = useUIF();
  const { windows } = uif;
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);


  return (
    <div className="uif-windows-menu" ref={ref}>
      <button
        type="button"
        className={`uif-windows-toggle ${open ? 'is-open' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Windows"
        title={`Windows: ${windows.defs.map(d => d.file).join(' ')}`}
        onClick={() => setOpen(o => !o)}
      >
        ▤
      </button>
      {open && (
        <div className="uif-windows-list" role="menu" aria-label="Windows" onKeyDown={e => e.key === 'Escape' && setOpen(false)}>
          {windows.defs.map(({ id: kind, icon, file, detail }) => (
            <button
              key={kind}
              type="button"
              role="menuitemcheckbox"
              aria-checked={windows.isOpen(kind)}
              className={`uif-windows-item ${windows.isOpen(kind) ? 'is-open' : ''}`}
              onClick={() => {
                windows.toggle(kind);
                setOpen(false);
              }}
            >
              <span className="uif-windows-icon" aria-hidden="true">{icon}</span>
              <span className="uif-windows-file">{file}</span>
              <span className="uif-windows-detail">{detail?.(uif) ?? ''}</span>
              <span className="uif-windows-check" aria-hidden="true">{windows.isOpen(kind) ? '●' : ''}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
