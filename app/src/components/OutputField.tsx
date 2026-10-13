import React, { useEffect, useRef, useState } from 'react';
import { Linked } from '../core/links';
import { responseSettings, setWindowReply, windowReply } from '../core/responseSettings';
import type { OutputField as OutputFieldData } from '../types';
import { KEYBOARD_HINT, useDragResize } from '../hooks/useDragResize';
import { useUIF } from './UIFContext';
import { ResizeCorners } from './ResizeCorners';

interface ViewProps {
  /** The page's live message parts (OutputMessage.widget); a popped-out window has none and shows the text. */
  widgets?: import('../types').UIFProviderOptions['widgets'];
  field: OutputFieldData;
  active: boolean;
  flash: number;
  popped?: boolean;
  onHeaderPointerDown?: (e: React.PointerEvent) => void;
  /** Keyboard move/resize for the header; makes the header focusable. */
  onHeaderKeyDown?: (e: React.KeyboardEvent) => void;
  onRename?: (title: string) => void;
  /** Send a chat message into this output. Shows a reply box when set. */
  onSubmit?: (text: string) => void;
  /** Keep a reply in .memory. Shows a ◈ button on replies when set. */
  onRemember?: (text: string) => void;
  onPopOut?: () => void;
  /** Read replies aloud: shows a 🔊 toggle when set. */
  onSpeak?: () => void;
  onHome?: () => void;
  /** Fill the screen or shrink back: a ⤢ button, and a double-click on the header (the title still renames). */
  onMaximize?: () => void;
  onClose: () => void;
}

/** Header and message list, shared by the in-page panel and the pop-out window. */
export function OutputView({
  field,
  active,
  flash,
  popped,
  onHeaderPointerDown,
  onHeaderKeyDown,
  onRename,
  onSubmit,
  onRemember,
  onPopOut,
  onSpeak,
  onHome,
  onMaximize,
  onClose,
  widgets,
}: ViewProps) {
  const [kept, setKept] = useState<Record<string, boolean>>({});
  const listRef = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState(false);
  const [reply, setReply] = useState('');
  // the reply field: only when chosen (this window's ⋯ menu, or the setting for every window)
  const [, rerender] = useState(0);
  useEffect(() => responseSettings.subscribe(() => rerender(n => n + 1)), []);
  const [menu, setMenu] = useState(false);
  const replyOn = windowReply(field.id);
  const busy = field.messages.some(m => m.pending);

  const finishRename = (title: string | null) => {
    setEditing(false);
    if (title !== null && title.trim() && title.trim() !== field.title) onRename?.(title);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!reply.trim() || busy) return;
    onSubmit?.(reply);
    setReply('');
  };
  const last = field.messages[field.messages.length - 1];

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [field.messages.length, last?.text]);

  return (
    <>
      {flash > 0 && <div key={flash} className="uif-flash" style={{ '--uif-color': field.color } as React.CSSProperties} />}
      <div
        className={`uif-output-header ${busy ? 'is-busy' : ''}`}
        onPointerDown={editing ? undefined : onHeaderPointerDown}
        onKeyDown={editing ? undefined : onHeaderKeyDown}
        onDoubleClick={e => {
          // the title's own double-click renames; anywhere else on the header maximizes or shrinks back
          if (!editing && onMaximize && !(e.target as HTMLElement).closest('.uif-output-title, .uif-output-buttons')) onMaximize();
        }}
        tabIndex={onHeaderKeyDown ? 0 : undefined}
        role={onHeaderKeyDown ? 'group' : undefined}
        aria-label={onHeaderKeyDown ? `${field.title} output. ${KEYBOARD_HINT}` : undefined}
      >
        <span className="uif-output-dot" style={{ background: field.color }} />
        <span className="uif-output-avatar" aria-hidden="true" />
        {editing ? (
          <input
            className="uif-output-rename"
            defaultValue={field.title}
            aria-label="Output name"
            autoFocus
            onFocus={e => e.currentTarget.select()}
            onPointerDown={e => e.stopPropagation()}
            onKeyDown={e => {
              e.stopPropagation();
              if (e.key === 'Enter') finishRename(e.currentTarget.value);
              if (e.key === 'Escape') finishRename(null);
            }}
            onBlur={e => finishRename(e.currentTarget.value)}
          />
        ) : (
          <span
            className="uif-output-title"
            title={onRename ? 'Double-click to rename' : undefined}
            onDoubleClick={onRename ? () => setEditing(true) : undefined}
          >
            {field.title}
          </span>
        )}
        {active && <span className="uif-output-badge">active</span>}
        <span className="uif-output-buttons" onPointerDown={e => e.stopPropagation()}>
          {onSpeak && (
            <button
              type="button"
              className={field.speak ? 'is-on' : ''}
              title={field.speak ? 'Stop reading replies aloud' : 'Read replies aloud'}
              aria-pressed={!!field.speak}
              onClick={onSpeak}
            >
              {field.speak ? '🔊' : '🔈'}
            </button>
          )}
          {onPopOut && (
            <button type="button" title="Pop out to a window" onClick={onPopOut}>⧉</button>
          )}
          {onHome && (
            <button type="button" title={popped ? 'Call home' : 'Back beside the field'} onClick={onHome}>⌂</button>
          )}
          {onMaximize && (
            <button type="button" title={field.maximized ? 'Shrink back (or double-click the header, or Esc)' : 'Fill the screen (or double-click the header)'}
              aria-pressed={!!field.maximized} onClick={onMaximize}>{field.maximized ? '⤡' : '⤢'}</button>
          )}
          <button type="button" title="This window's settings" aria-haspopup="menu" aria-expanded={menu} className={menu ? 'is-on' : ''} onClick={() => setMenu(m => !m)}>⋯</button>
          <button type="button" title="Close" onClick={onClose}>✕</button>
        </span>
      </div>
      {menu && (
        <div className="uif-output-menu" role="menu" onPointerDown={e => e.stopPropagation()} onKeyDown={e => e.key === 'Escape' && setMenu(false)}>
          <label className="uif-menu-check"><input type="checkbox" checked={replyOn} onChange={e => setWindowReply(field.id, e.target.checked)} /> a reply field in this window</label>
          <label className="uif-menu-check"><input type="checkbox" checked={responseSettings.get().replyField} onChange={e => responseSettings.set({ replyField: e.target.checked })} /> a reply field in every new window</label>
          <p className="uif-menu-foot">Off: ask from the input field; its answers go to the active window.</p>
        </div>
      )}
      <div className="uif-output-body" ref={listRef}>
        {field.messages.length === 0 && <div className="uif-output-empty">No messages yet.</div>}
        {field.messages.map(m => {
          if (m.role === 'system' && !m.text && !m.pending && !m.widget) return null;  // a status line the engine cleared
          const keep = onRemember && m.role === 'assistant' && !m.pending && !m.undelivered && m.text;
          const msg = (
            <div key={m.id} className={['uif-msg', `uif-msg-${m.role}`, m.kind && `is-${m.kind}`, m.tone && `is-${m.tone}`, m.undelivered && 'is-undelivered'].filter(Boolean).join(' ')}>
              {!(m.widgetOnly && m.widget && widgets?.[m.widget]) && (m.text ? <Linked text={m.text} /> : m.text)}
              {m.pending && <span className="uif-caret">▍</span>}
              {m.widget && widgets?.[m.widget] && <div className="uif-msg-widget">{widgets[m.widget]({ outputId: field.id, message: m })}</div>}
              {m.media && (
                <span className="uif-msg-media">
                  {m.media.kind === 'video'
                    ? <video src={m.media.url} controls playsInline loop className="uif-media" aria-label={m.text || 'video'} />
                    : <img src={m.media.url} alt={m.text || 'image'} className="uif-media" />}
                  <a className="uif-media-save" href={m.media.url} download={m.media.name || (m.media.kind === 'video' ? 'video.mp4' : 'image.png')}>⤓ save</a>
                </span>
              )}
              {m.silent && field.speak && (
                <span className="uif-msg-silent" title="Not read aloud: the engine did not vouch for this reply" aria-label="not read aloud">
                  {' '}🔇
                </span>
              )}
            </div>
          );
          if (!keep) return msg;
          // The keep button sits beside the reply, not inside it, so copying the reply copies only the reply.
          return (
            <div key={m.id} className="uif-msg-row">
              {msg}
              <button
                type="button"
                className={`uif-msg-keep ${kept[m.id] ? 'is-kept' : ''}`}
                title={kept[m.id] ? 'Kept in .memory' : 'Keep this reply in .memory'}
                aria-label="Remember this reply"
                disabled={kept[m.id]}
                onClick={() => {
                  onRemember(m.text);
                  setKept(k => ({ ...k, [m.id]: true }));
                }}
              >
                ◈
              </button>
            </div>
          );
        })}
      </div>
      {onSubmit && replyOn && (
        <form className="uif-output-reply" onSubmit={submit}>
          <input
            value={reply}
            onChange={e => setReply(e.target.value)}
            placeholder={`Reply in ${field.title}…`}
            aria-label={`Message ${field.title}`}
            className="uif-output-reply-input"
          />
          <button type="submit" disabled={!reply.trim() || busy} aria-label="Send">
            ➤
          </button>
        </form>
      )}
    </>
  );
}

/** A floating, draggable output panel inside the hub page. */
export function OutputField({ field }: { field: OutputFieldData }) {
  const { outputs, setRect, flashes, raise, zIndexOf, sendTo, context, widgets, hubRef } = useUIF();
  const { position, size, setPosition, setSize, startDrag, startResize, onHandleKeyDown, isDragging } = useDragResize({
    initialPosition: { x: field.rect.x, y: field.rect.y },
    initialSize: { width: field.rect.width, height: field.rect.height },
    minWidth: 220,
    minHeight: 120,
    onCommit: rect => setRect(field.id, rect),
  });

  // Follow rect changes made elsewhere (call home restacks the panels).
  useEffect(() => {
    setPosition({ x: field.rect.x, y: field.rect.y });
    setSize({ width: field.rect.width, height: field.rect.height });
  }, [field.rect, setPosition, setSize]);

  const active = outputs.activeId === field.id;
  const max = !!field.maximized;
  // a new window emerges from the input field: once it is placed (a few frames), it grows out of the field's centre
  const box = React.useRef<HTMLDivElement>(null);
  const [emerge, setEmerge] = useState<'wait' | 'go' | null>('wait');
  useEffect(() => {
    let n = 0, raf = 0;
    const step = () => {
      if (++n < 3) { raf = requestAnimationFrame(step); return; }
      const el = box.current, h = hubRef.current?.getBoundingClientRect(), r = el?.getBoundingClientRect();
      if (el && h && r && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        el.style.setProperty('--uif-emerge-origin', `${Math.round(h.left + h.width / 2 - r.left)}px ${Math.round(h.top + h.height / 2 - r.top)}px`);
        setEmerge('go');
      } else setEmerge(null);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Esc shrinks the window that fills the screen back to where it was
  useEffect(() => {
    if (!max) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && outputs.activeId === field.id) outputs.maximize(field.id, false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [max, field.id, outputs]);
  return (
    <div
      ref={box}
      className={`uif-output ${active ? 'is-active' : ''} ${isDragging ? 'is-dragging' : ''} ${max ? 'is-maximized' : ''} ${emerge === 'wait' ? 'is-emerge-wait' : emerge === 'go' ? 'is-emerging' : ''}`}
      onAnimationEnd={e => { if (e.animationName === 'uif-emerge') setEmerge(null); }}
      data-uif-output={field.id}
      style={
        {
          left: max ? 0 : position.x,
          top: max ? 0 : position.y,
          width: max ? '100vw' : size.width,
          height: max ? '100vh' : size.height,
          zIndex: zIndexOf(field.id),
          '--uif-color': field.color,
        } as React.CSSProperties
      }
      onPointerDownCapture={() => {
        outputs.setActive(field.id);
        raise(field.id);
      }}
    >
      <OutputView
        widgets={widgets}
        field={field}
        active={active}
        flash={flashes[field.id] ?? 0}
        onHeaderPointerDown={max ? undefined : startDrag}
        onHeaderKeyDown={onHandleKeyDown}
        onMaximize={() => outputs.maximize(field.id)}
        onRename={title => outputs.rename(field.id, title)}
        onSubmit={text => sendTo(text, field.id)}
        onRemember={text => void context.remember(text, 'response')}
        onPopOut={() => outputs.popOut(field.id)}
        onSpeak={() => outputs.setSpeak(field.id, !field.speak)}
        onClose={() => outputs.close(field.id)}
      />
      {!max && <ResizeCorners onStart={startResize} />}
    </div>
  );
}
