import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Action, ActionRegistry } from '../core/actions';
import type { LayoutApi } from '../types';
import { usePressHoldDrag } from '../hooks/usePressHoldDrag';
import { dropOnShelf, notifyDragOff } from '../core/shelves';
import { useRegistryVersion } from './UIFContext';
import { FloatingActions, type FreeDrag } from './FloatingActions';
import { LayoutSection } from './LayoutSection';

/** Floating buttons and the trash sit above panels, below the strings' beacons. */
const FLOATING_Z = 1900;

interface ActionBarProps {
  registry: ActionRegistry;
  layout: LayoutApi;
  onRun(action: Action): void;
  /** Actions shown as switched on, such as strings while they are visible. */
  pressed?: Record<string, boolean>;
  /** Buttons in a column (the isolated bar stood up sideways). */
  vertical?: boolean;
  /** The bar has just turned to another mode's buttons: it rolls in like a rolodex card. */
  rolling?: boolean;
}

function ActionIcon({ action }: { action: Action }) {
  return <span className="uif-action-icon">{action.icon ?? action.label.slice(0, 1).toUpperCase()}</span>;
}

/** The row of action buttons. Hold a button to rearrange; "+" adds actions. */
export function ActionBar({ registry, layout, onRun, pressed = {}, vertical = false, rolling = false }: ActionBarProps) {
  useRegistryVersion(registry);
  const actions = registry.visible();
  const containerRef = useRef<HTMLDivElement>(null);
  const itemsRef = useRef<HTMLDivElement>(null);
  const [overflowing, setOverflowing] = useState(false);

  // the buttons fit the row unless it is too narrow even for their smallest size; then it scrolls, and says so
  useEffect(() => {
    const el = itemsRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const check = () => setOverflowing(el.scrollWidth > el.clientWidth + 1);
    const ro = new ResizeObserver(check);
    ro.observe(el);
    check();
    return () => ro.disconnect();
  });
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [freeDrag, setFreeDrag] = useState<FreeDrag | null>(null);
  const { arranging, setArranging, drag, onPointerDown, onKeyDown, guardClick } = usePressHoldDrag({
    containerRef,
    onReorder: (from, to) => registry.reorder(from, to),
    onRemove: index => {
      const action = actions[index];
      if (action) registry.hide(action.id);
    },
    // Dropped on a shelf (the sidebar menu, a button panel): it goes there. Anywhere else off the bar: the button
    // stays where it was dropped.
    onDropOutside: (index, at) => {
      const action = actions[index];
      if (!action) return;
      if (dropOnShelf(action.id, at.x, at.y)) registry.hide(action.id);
      else registry.float(action.id, at);
    },
  });

  // a button dragged off the bar: the sidebar appears, to take it
  const off = !!drag?.outside;
  useEffect(() => { notifyDragOff(off); }, [off]);

  // A press outside the bar closes the palette and ends arranging.
  useEffect(() => {
    if (!paletteOpen && !arranging) return;
    const onDown = (e: PointerEvent) => {
      if (containerRef.current?.contains(e.target as Node)) return;
      setPaletteOpen(false);
      setArranging(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [paletteOpen, arranging, setArranging]);

  const items: React.ReactNode[] = actions.map((action, index) => (
    <button
      key={action.id}
      type="button"
      data-uif-item={index}
      className={`uif-action ${arranging ? 'is-arranging' : ''} ${drag?.index === index ? 'is-dragged' : ''} ${pressed[action.id] ? 'is-pressed' : ''}`}
      aria-pressed={action.id in pressed ? !!pressed[action.id] : undefined}
      title={`${action.label}  (${action.command})${arranging ? '' : ' - hold to rearrange'}`}
      aria-label={action.label}
      onPointerDown={e => onPointerDown(e, index)}
      onKeyDown={e => onKeyDown(e, index, actions.length)}
      onClick={() => guardClick(() => onRun(action))}
      onContextMenu={e => e.preventDefault()}
    >
      <ActionIcon action={action} />
    </button>
  ));
  if (drag && !drag.outside && !drag.overTrash) {
    // Placeholder at the drop position, counted among the items that are not being dragged.
    const others = items.filter((_, i) => i !== drag.index);
    const at = others[drag.target];
    const slot = at ? items.indexOf(at) : items.length;
    items.splice(slot, 0, <span key="__slot" className="uif-action-slot" style={{ width: drag.width }} />);
  }

  const dragged = drag ? actions[drag.index] : undefined;
  const dragging = !!drag || !!freeDrag;
  const hint = drag?.overTrash
    ? 'release to hide'
    : drag?.outside
      ? 'release to place it here'
      : 'drag to move · drop anywhere to place · drop on the trash to hide';

  return (
    <div
      className={`uif-actionbar ${arranging ? 'is-arranging' : ''} ${freeDrag?.overBar ? 'is-drop-target' : ''} ${vertical ? 'is-vertical' : ''} ${rolling ? 'is-rolling' : ''}`}
      ref={containerRef}
      role="toolbar"
      aria-label="Actions"
      aria-orientation={vertical ? 'vertical' : 'horizontal'}
    >
      {/* the buttons scroll in one line when the field is compressed; the + palette stays outside the scroller */}
      <div className={`uif-actionbar-items ${overflowing ? 'is-overflowing' : ''}`} ref={itemsRef}>{items}</div>
      {arranging ? (
        <button type="button" className="uif-action uif-action-done" onClick={() => setArranging(false)}>
          Done
        </button>
      ) : (
        <button
          type="button"
          className="uif-action uif-action-add"
          title="Add actions, arrange, layouts"
          aria-expanded={paletteOpen}
          onClick={() => setPaletteOpen(o => !o)}
        >
          +
        </button>
      )}
      {arranging && <span className="uif-arrange-hint">{hint}</span>}
      {dragged &&
        drag &&
        // Portaled: the field's backdrop-filter would make `position: fixed` relative to the field.
        createPortal(
          <div
            className={`uif-action uif-action-ghost ${drag.overTrash ? 'is-removing' : drag.outside ? 'is-placing' : ''}`}
            style={{ left: drag.x - drag.offsetX, top: drag.y - drag.offsetY, width: drag.width, height: drag.height }}
          >
            <ActionIcon action={dragged} />
          </div>,
          document.body,
        )}
      {dragging &&
        createPortal(
          <div
            data-uif-trash=""
            className={`uif-trash ${drag?.overTrash || freeDrag?.overTrash ? 'is-hot' : ''}`}
            style={{ zIndex: FLOATING_Z + 1 }}
          >
            🗑 Drop here to hide
          </div>,
          document.body,
        )}
      <FloatingActions
        registry={registry}
        barRef={containerRef}
        arranging={arranging}
        pressed={pressed}
        onRun={onRun}
        onDragChange={setFreeDrag}
        zIndex={FLOATING_Z}
      />
      {paletteOpen && !arranging && (
        <ActionPalette
          registry={registry}
          layout={layout}
          onArrange={() => {
            setPaletteOpen(false);
            setArranging(true);
          }}
          onClose={() => setPaletteOpen(false)}
        />
      )}
    </div>
  );
}

type PaletteTab = 'actions' | 'new' | 'layout';
const PALETTE_TABS: [PaletteTab, string][] = [
  ['actions', 'Actions'],
  ['new', 'New'],
  ['layout', 'Layout'],
];
/** The palette reopens on the tab it was closed on. */
let lastTab: PaletteTab = 'actions';

function ActionPalette({
  registry,
  layout,
  onArrange,
  onClose,
}: {
  registry: ActionRegistry;
  layout: LayoutApi;
  onArrange(): void;
  onClose(): void;
}) {
  const hidden = registry.hidden();
  const [tab, setTabState] = useState<PaletteTab>(lastTab);
  const setTab = (t: PaletteTab) => {
    lastTab = t;
    setTabState(t);
  };
  const [label, setLabel] = useState('');
  const [icon, setIcon] = useState('');
  const [kind, setKind] = useState<'command' | 'send'>('command');
  const [payload, setPayload] = useState('');

  const add = (e: React.FormEvent) => {
    e.preventDefault();
    if (!label.trim() || !payload.trim()) return;
    registry.addCustom({ label, icon: icon.trim(), kind, payload: payload.trim() });
    setLabel('');
    setIcon('');
    setPayload('');
  };

  return (
    <div className="uif-palette" onKeyDown={e => e.key === 'Escape' && onClose()}>
      <div className="uif-palette-tabs" role="tablist" aria-label="Palette">
        {PALETTE_TABS.map(([id, name]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={`uif-palette-tab ${tab === id ? 'is-active' : ''}`}
            onClick={() => setTab(id)}
          >
            {name}
          </button>
        ))}
      </div>
      {tab === 'actions' && (
        <div role="tabpanel" className="uif-palette-panel">
          <div className="uif-palette-row">
            <strong>Actions</strong>
            <button type="button" className="uif-link" onClick={onArrange}>Arrange…</button>
        </div>
        {hidden.length > 0 ? (
          <ul className="uif-palette-list">
            {hidden.map(a => (
              <li key={a.id}>
                <button type="button" className="uif-palette-item" onClick={() => registry.show(a.id)} title="Add to the bar">
                  <ActionIcon action={a} />
                  <span>{a.label}</span>
                  <code>{a.command}</code>
                </button>
                {registry.isCustom(a.id) && (
                  <button type="button" className="uif-link" title="Delete this action" onClick={() => registry.removeCustom(a.id)}>
                    ✕
                  </button>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="uif-palette-note">Every action is on the bar.</p>
        )}
        </div>
      )}
      {tab === 'new' && (
        <div role="tabpanel" className="uif-palette-panel">
          <form className="uif-palette-form" onSubmit={add}>
            <div className="uif-palette-fields">
              <input value={icon} onChange={e => setIcon(e.target.value)} placeholder="★" maxLength={2} aria-label="Icon" className="uif-input uif-input-icon" />
              <input value={label} onChange={e => setLabel(e.target.value)} placeholder="Label" aria-label="Label" className="uif-input" autoFocus />
            </div>
            <div className="uif-palette-fields">
              <select value={kind} onChange={e => setKind(e.target.value as 'command' | 'send')} aria-label="Kind" className="uif-input">
                <option value="command">runs command</option>
                <option value="send">sends text</option>
              </select>
              <input
                value={payload}
                onChange={e => setPayload(e.target.value)}
                placeholder={kind === 'command' ? 'spawn logs; strings on' : 'Summarize the last reply'}
                aria-label={kind === 'command' ? 'Command' : 'Text'}
                className="uif-input"
              />
            </div>
            <button type="submit" className="uif-button" disabled={!label.trim() || !payload.trim()}>Add to bar</button>
          </form>
        </div>
      )}
      {tab === 'layout' && <LayoutSection layout={layout} />}
    </div>
  );
}
