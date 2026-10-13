import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { OutputField } from '../types';
import { createBus, KEY_PARAM, OUTPUT_PARAM, type BusMessage } from '../core/bus';
import { OutputView } from './OutputField';

/**
 * The page a popped-out output loads (the hub opens `?uif-output=<id>`).
 * Render it instead of your app when `isOutputWindow()` is true.
 */
export function OutputWindow() {
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const id = params.get(OUTPUT_PARAM) ?? '';
  const bus = useMemo(() => createBus(params.get(KEY_PARAM) ?? 'default'), [params]);
  const [field, setField] = useState<OutputField | null>(null);
  const [active, setActive] = useState(false);
  const [flash, setFlash] = useState(0);
  const [lost, setLost] = useState(false);

  // Shown on another display through the Presentation API, the hub may be on another device (a cast receiver):
  // every message also travels over the presentation connections.
  const conns = useRef<{ send(d: string): void; state?: string }[]>([]);
  const post = useCallback(
    (msg: BusMessage) => {
      bus.post(msg);
      conns.current.forEach(c => c.state !== 'closed' && c.state !== 'terminated' && c.send(JSON.stringify(msg)));
    },
    [bus],
  );

  useEffect(() => {
    const receiver = (navigator as Navigator & { presentation?: { receiver?: { connectionList: Promise<{ connections: unknown[]; addEventListener(t: string, f: (e: { connection: unknown }) => void): void }> } } }).presentation?.receiver;
    const onRemote = (fn: (msg: BusMessage) => void) => (c: unknown) => {
      const conn = c as { send(d: string): void; state?: string; addEventListener(t: string, f: (e: { data?: unknown }) => void): void };
      conns.current.push(conn);
      conn.addEventListener('message', e => {
        try {
          fn(JSON.parse(String(e.data)));
        } catch {
          /* not ours */
        }
      });
      conn.send(JSON.stringify({ type: 'out:hello', id } satisfies BusMessage));
    };
    const off = bus.on(msg => handle(msg));
    receiver?.connectionList.then(list => {
      list.connections.forEach(onRemote(handle));
      list.addEventListener('connectionavailable', e => onRemote(handle)(e.connection));
    });
    function handle(msg: BusMessage) {
      if (msg.type === 'hub:hello') return post({ type: 'out:hello', id });
      if (!('id' in msg) || msg.id !== id) return;
      if (msg.type === 'out:state') {
        setField(msg.field);
        setActive(msg.active);
        setLost(false);
      } else if (msg.type === 'out:home') {
        window.close();
      } else if (msg.type === 'out:ping') {
        setFlash(n => n + 1);
        window.focus();
      }
    }
    post({ type: 'out:hello', id });
    // No event fires when a window moves, so report geometry on a timer.
    let last = '';
    const report = () => {
      const geom = { x: window.screenX, y: window.screenY, width: window.outerWidth, height: window.outerHeight };
      const key = JSON.stringify(geom);
      if (key !== last) {
        last = key;
        post({ type: 'out:geom', id, geom });
      }
    };
    report();
    const timer = setInterval(report, 500);
    const noHub = setTimeout(() => setLost(true), 2000);
    const bye = () => post({ type: 'out:bye', id });
    window.addEventListener('pagehide', bye);
    return () => {
      off();
      clearInterval(timer);
      clearTimeout(noHub);
      window.removeEventListener('pagehide', bye);
      bus.close();
    };
  }, [bus, id, post]);

  useEffect(() => {
    if (field) document.title = field.title;
  }, [field?.title]);

  if (!field) {
    return (
      <div className="uif-output uif-output-window">
        <div className="uif-output-empty">{lost ? 'The input field this output belongs to is not open.' : 'Connecting…'}</div>
      </div>
    );
  }

  return (
    <div className={`uif-output uif-output-window ${active ? 'is-active' : ''}`} style={{ '--uif-color': field.color } as React.CSSProperties}>
      <OutputView
        field={field}
        active={active}
        flash={flash}
        popped
        onRename={title => post({ type: 'out:request-rename', id, title })}
        onSubmit={text => post({ type: 'out:input', id, text })}
        onRemember={text => post({ type: 'out:remember', id, text })}
        onHome={() => post({ type: 'out:request-home', id })}
        onClose={() => post({ type: 'out:request-close', id })}
      />
    </div>
  );
}
