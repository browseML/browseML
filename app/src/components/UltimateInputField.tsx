import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { ActionContext, DockEdge, LogKind, LogSection, ReplyMarks, UIFMode, UltimateInputFieldProps } from '../types';
import { layoutFor, type Action, type ActionsLayout } from '../core/actions';
import { MODE_BAR } from '../core/builtins';
import { parseCommand } from '../core/commands';
import { KEYBOARD_HINT, useDragResize } from '../hooks/useDragResize';
import { Button } from './ui/Button';
import { IconSend, IconTerminal, IconType } from './ui/Icons';
import { ActionBar } from './ActionBar';
import { ResizeCorners } from './ResizeCorners';
import { WindowsMenu } from './WindowsMenu';
import { ResponsesMenu } from './ResponsesMenu';
import { responseSettings } from '../core/responseSettings';
import { HUB_KEY, UIFProvider, useOptionalUIF, useUIF } from './UIFContext';
import { loadJSON, saveJSON } from '../core/storage';
import type { HubArrangement, HubLayout, IsolatedBar as IsolatedBarState } from '../core/profile';
import { useHoldDrag } from '../hooks/useHoldDrag';
import { IsolatedBar } from './IsolatedBar';
import { createPortal } from 'react-dom';
import { modelLabel } from '../core/context';
import { magnetEdge } from '../core/dock';
import { useVoice, VOICE_ENGINE } from '../hooks/useVoice';
import '../styles/UltimateInputField.css';

interface LogLine {
  id: number;
  kind: LogKind;
  text: string;
  /** A report: sections that open and close under the line. */
  sections?: LogSection[];
}

const MAX_LOG = 300;

/** Below this height the input and the button row cannot both have a full row: the field goes sideways. */
const STACK_MIN = 104;
/** A narrow viewport, or a touch screen that is not wide: a handheld. */
const HANDHELD_QUERY = '(max-width: 640px), (pointer: coarse) and (max-width: 900px)';

function useViewport() {
  const read = () => ({
    width: typeof window !== 'undefined' ? window.innerWidth : 1024,
    handheld: typeof window !== 'undefined' && !!window.matchMedia?.(HANDHELD_QUERY).matches,
  });
  const [vp, setVp] = useState(read);
  useEffect(() => {
    const on = () => setVp(read());
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return vp;
}


function isAsyncIterable(v: unknown): v is AsyncIterable<string> {
  return !!v && typeof (v as AsyncIterable<string>)[Symbol.asyncIterator] === 'function';
}

/**
 * The hub of the bar: chat input, T terminal, extensible action buttons.
 * Works on its own, or inside <UltimateBar>/<UIFProvider> to share outputs.
 */
export const UltimateInputField: React.FC<UltimateInputFieldProps> = props => {
  const ctx = useOptionalUIF();
  if (ctx) return <HubField {...props} />;
  return (
    <UIFProvider storageKey={props.storageKey} popoutUrl={props.popoutUrl} defaultStrings={props.defaultStrings} modules={props.modules}>
      <HubField {...props} />
    </UIFProvider>
  );
};

const HubField: React.FC<UltimateInputFieldProps> = ({
  value: controlledValue,
  onChange,
  onSend,
  onCommand,
  onAction,
  onModeChange,
  actions: extraActions,
  isLoading: externalLoading = false,
  className = '',
  placeholder,
  terminalPlaceholder,
  disabled = false,
  mode: initialMode = 'chat',
  initialPosition,
  initialSize = { width: 600, height: 120 },
  minWidth = 300,
  maxWidth,
  minHeight = 60,
  maxHeight,
  draggable = true,
  resizable = true,
  dockable = true,
  initialDock,
  modeBar,
  persona,
  terminalMode = true,
  tools,
  glowEffect = true,
  glassEffect = true,
  voice: voiceOn = true,
  autoGrow = true,
  focusKeys = true,
  left,
  right,
}) => {
  const uif = useUIF();
  const {
    registry,
    outputs,
    strings,
    setStrings,
    hubRef,
    requestScreens,
    storageKey,
    raise,
    zIndexOf,
    registerSender,
    registerRunner,
    layout,
    registerHubLayout,
    context: contextStore,
  } = uif;
  const hubKey = `uif:${storageKey}:hub`;
  const [saved] = useState(() => loadJSON<Partial<HubLayout>>(hubKey, {}));

  const [innerValue, setInnerValue] = useState('');
  const value = controlledValue ?? innerValue;
  const valueRef = useRef(value);
  valueRef.current = value;
  const setValue = useCallback(
    (v: string) => {
      if (controlledValue === undefined) setInnerValue(v);
      onChange?.(v);
    },
    [controlledValue, onChange],
  );

  const [mode, setModeState] = useState<UIFMode>(() => {
    const m = saved.mode ?? (initialMode === 'text' ? 'chat' : initialMode);
    return m === 'terminal' && !terminalMode ? 'chat' : m;
  });
  const [toolsOpen, setToolsOpen] = useState(false);
  const [toolsBelow, setToolsBelow] = useState(false);
  // a handheld with nothing saved starts docked at the bottom, full width
  const [docked, setDocked] = useState<DockEdge | null>(
    saved.docked !== undefined ? saved.docked : !dockable ? null : initialDock !== undefined ? initialDock
      : typeof window !== 'undefined' && window.matchMedia?.(HANDHELD_QUERY).matches ? 'bottom' : null,
  );
  const [arrangement, setArrangement] = useState<HubArrangement>(saved.arrange ?? 'auto');
  const [isolated, setIsolated] = useState<IsolatedBarState | null>(saved.isolated ?? null);
  const viewport = useViewport();
  const [isGlowing, setIsGlowing] = useState(false);
  const [busy, setBusy] = useState(false);
  const stopRef = useRef<(() => void) | null>(null);
  const [log, setLog] = useState<LogLine[]>([]);
  const [status, setStatus] = useState<LogLine | null>(null);
  const history = useRef<string[]>([]);
  const historyIndex = useRef(-1);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const logSeq = useRef(0);

  const { position, size, setPosition, setSize, isDragging, isResizing, startDrag, startResize, onHandleKeyDown } = useDragResize({
    initialPosition:
      saved.x !== undefined && saved.y !== undefined
        ? { x: saved.x, y: saved.y }
        : initialPosition ?? {
            x: window.innerWidth / 2 - initialSize.width / 2,
            y: window.innerHeight / 2 - initialSize.height / 2,
          },
    initialSize: saved.width && saved.height ? { width: saved.width, height: saved.height } : initialSize,
    minWidth,
    maxWidth,
    minHeight,
    maxHeight,
    draggable,
    resizable,
    // magnetic docking: let go within reach of an edge, and the field docks there
    onCommit: (r, how) => magnet.current(r, how),
  });
  const magnet = useRef<(r: { x: number; y: number; width: number; height: number }, how: string) => void>(() => {});

  // Remember where the field is and how it is set up. Skipped while a gesture is in progress.
  useEffect(() => {
    if (isDragging || isResizing) return;
    saveJSON(hubKey, { x: position.x, y: position.y, width: size.width, height: size.height, mode, docked, arrange: arrangement, isolated } satisfies HubLayout);
  }, [hubKey, position, size, mode, docked, arrangement, isolated, isDragging, isResizing]);

  // Actions passed as props join the shared registry while this field is mounted.
  useEffect(() => {
    extraActions?.forEach(a => registry.register(a));
    return () => extraActions?.forEach(a => registry.unregister(a.id));
  }, [extraActions, registry]);

  // The rolodex: each mode keeps its own bar (its buttons and their order, saved as they change), and switching mode
  // turns the bar to the other mode's face. A mode never arranged starts from MODE_BAR. Custom actions are shared.
  const barFace = useRef<UIFMode | null>(null);
  const [rolling, setRolling] = useState(false);
  useEffect(
    () => registry.subscribe(() => {
      if (barFace.current) saveJSON(`uif:${storageKey}:bar:${barFace.current}`, registry.snapshot());
    }),
    [registry, storageKey],
  );
  /** A mode's standard face: the host's button set for it, or the field's. */
  const faceStandard = useCallback(
    (m: UIFMode) => layoutFor(registry, modeBar?.[m] ?? MODE_BAR[m === 'terminal' ? 'terminal' : 'chat']),
    [registry, modeBar],
  );
  useEffect(() => {
    if (barFace.current === mode) return;
    const first = barFace.current === null;
    const saved = loadJSON<ActionsLayout | null>(`uif:${storageKey}:bar:${mode}`, null);
    barFace.current = mode;
    registry.restore(saved ? { ...saved, custom: registry.snapshot().custom } : faceStandard(mode));
    if (first) return;
    setRolling(true);
    const t = setTimeout(() => setRolling(false), 720);
    return () => clearTimeout(t);
  }, [mode, registry, storageKey]);

  useEffect(() => {
    textareaRef.current?.focus();
  }, [mode]);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [log]);

  useEffect(() => {
    if (!status) return;
    const t = setTimeout(() => setStatus(null), 3500);
    return () => clearTimeout(t);
  }, [status]);

  const print = useCallback((text: string, kind: LogKind = 'out') => {
    const line = { id: logSeq.current++, kind, text };
    setLog(prev => [...prev.slice(-MAX_LOG + 1), line]);
    if (kind !== 'cmd') setStatus(line);
  }, []);

  const printSections = useCallback((title: string, sections: LogSection[]) => {
    const line = { id: logSeq.current++, kind: 'out' as LogKind, text: title, sections };
    setLog(prev => [...prev.slice(-MAX_LOG + 1), line]);
  }, []);

  const lastAsk = useRef<UIFMode>('chat');
  const modeNow = useRef<UIFMode>('chat');
  const triggerGlow = useCallback(() => {
    if (!glowEffect) return;
    setIsGlowing(true);
    setTimeout(() => setIsGlowing(false), 500);
  }, [glowEffect]);

  const setMode = useCallback(
    (next: UIFMode | 'toggle') => {
      setModeState(prev => {
        // T and back: the terminal returns to the ask mode it came from (generic or the persona's)
        if (prev !== 'terminal') lastAsk.current = prev;
        let m = next === 'toggle' ? (prev === 'terminal' ? lastAsk.current : 'terminal') : next === 'persona' && !persona ? prev : next;
        // a field without T mode stays where it is
        if (m === 'terminal' && !terminalMode) m = prev;
        if (m !== prev) onModeChange?.(m);
        return m;
      });
    },
    [onModeChange, persona, terminalMode],
  );

  const dock = useCallback(
    (edge: DockEdge | null) => {
      if (!dockable) return;
      // popped out of the page: it floats from where it is on the screen (clamped into view), not from the middle
      const r = edge === null ? hubRef.current?.getBoundingClientRect() : null;
      setDocked(edge);
      if (edge === null) {
        setPosition(r && docked === 'page'
          ? { x: Math.max(8, Math.min(r.left, window.innerWidth - size.width - 8)), y: Math.max(8, Math.min(r.top, window.innerHeight - size.height - 8)) }
          : { x: window.innerWidth / 2 - size.width / 2, y: window.innerHeight / 2 - size.height / 2 });
      }
    },
    [dockable, setPosition, size.width, size.height, docked, hubRef],
  );
  magnet.current = (r, how) => {
    if (how !== 'drag' || !dockable) return;
    const edge = magnetEdge(r, { width: window.innerWidth, height: window.innerHeight });
    if (edge) setDocked(edge);
  };
  // while dragging: the edge it would dock on, drawn as a glowing strip
  const drawnTo = isDragging && dockable ? magnetEdge({ ...position, ...size }, { width: viewport.width, height: window.innerHeight }) : null;

  const send = useCallback(
    async (text: string, target?: string) => {
      if (!text.trim()) return;
      // "@notes hello" goes to the output called notes, which is opened if it does not exist yet.
      const routed = target ? null : /^@(\S+)\s+([\s\S]+)$/.exec(text);
      let id: string | undefined = target;
      if (id) {
        outputs.setActive(id);
      } else if (routed) {
        text = routed[2];
        id = outputs.resolve(routed[1]) ?? outputs.spawn(routed[1]);
        outputs.setActive(id);
        raise(id);
      } else {
        // the Responses settings: a new window per question, or the active one
        const fresh = responseSettings.get().answerIn === 'new';
        id = (fresh ? undefined : outputs.resolve(undefined)) ?? outputs.spawn();
        if (fresh || !outputs.list().some(o => o.id === id && o.messages.length)) {
          if (responseSettings.get().openMaximized) outputs.maximize(id, true);
        }
      }
      outputs.append(id, { role: 'user', text });
      triggerGlow();
      const context = contextStore.forSend(text, id);
      const outputId = id;
      const extra: Record<string, unknown> = {};
      // Each finished exchange goes into .history (bankml's record shape, plus the output it was in).
      // a reply the engine marked undelivered (no completion tokens, an error) never joins it
      const record = (reply: string) =>
        reply && !replyMarks.undelivered &&
        contextStore.appendHistory({
          ts: Date.now() / 1000,
          session: storageKey,
          output: outputs.list().find(f => f.id === outputId)?.title,
          output_id: outputId,
          user: text,
          assistant: reply,
          prompt: context.promptSource,
          model: modelLabel(context.model),
          ...extra,
        });
      // what the engine says about its own reply (e.g. silent), applied when the reply message exists
      const replyMarks: ReplyMarks = {};
      let replyId: string | null = null;
      const markReply = (patch: ReplyMarks) => {
        Object.assign(replyMarks, patch);
        if (replyId) outputs.update(outputId, replyId, patch);
      };
      const abort = new AbortController();
      const result = onSend?.(text, { outputId: id, mode: modeNow.current, context, annotate: fields => Object.assign(extra, fields), markReply, signal: abort.signal });
      if (result === undefined) return;
      if (typeof result === 'string') {
        outputs.append(id, { role: 'assistant', text: result, ...replyMarks });
        record(result);
        return;
      }
      const mid = outputs.append(id, { role: 'assistant', text: '', pending: true, ...replyMarks });
      replyId = mid;
      setBusy(true);
      // Stop: the reply stops where it is, at once (even while the engine is still reading the prompt)
      let stopNow = () => {};
      const stopped = new Promise<'stop'>(r => { stopNow = () => { abort.abort(); r('stop'); }; });
      stopRef.current = stopNow;
      try {
        if (isAsyncIterable(result)) {
          let acc = '';
          const it = result[Symbol.asyncIterator]();
          for (;;) {
            const step = await Promise.race([it.next(), stopped]);
            if (step === 'stop') {
              void it.return?.(undefined)?.catch(() => {});
              outputs.update(id, mid, { pending: false, undelivered: true, ...(acc ? {} : { text: 'Stopped before the model wrote anything.' }) });
              outputs.append(id, { role: 'system', kind: 'delivery', tone: 'bad', text: 'stopped by you: not delivered in full, not kept in .history' });
              return;
            }
            if (step.done) break;
            acc += step.value;
            outputs.update(id, mid, { text: acc });
          }
          outputs.update(id, mid, { pending: false });
          record(acc);
        } else {
          const reply = await result;
          outputs.update(id, mid, { text: reply ?? '', pending: false });
          record(reply ?? '');
        }
      } catch (err) {
        outputs.update(id, mid, { text: `Error: ${(err as Error).message ?? err}`, pending: false, undelivered: true });
      } finally {
        stopRef.current = null;
        setBusy(false);
      }
    },
    [onSend, outputs, raise, triggerGlow, contextStore, storageKey],
  );

  // Reply boxes on the outputs (in-page and popped out) send through this field.
  useEffect(() => registerSender((text, outputId) => void send(text, outputId)), [registerSender, send]);

  // Profiles read and apply the field's layout through this handle.
  const hubLive = useRef({ position, size, mode, docked, arrangement, isolated });
  hubLive.current = { position, size, mode, docked, arrangement, isolated };
  const standardMode: UIFMode = initialMode === 'text' ? 'chat' : initialMode;
  useEffect(
    () =>
      registerHubLayout({
        get: () => {
          const h = hubLive.current;
          return { ...h.position, ...h.size, mode: h.mode, docked: h.docked, arrange: h.arrangement, isolated: h.isolated };
        },
        set: next => {
          const l = next ?? {
            ...(initialPosition ?? {
              x: window.innerWidth / 2 - initialSize.width / 2,
              y: window.innerHeight / 2 - initialSize.height / 2,
            }),
            ...initialSize,
            mode: standardMode,
            docked: null,
            arrange: 'auto' as HubArrangement,
            isolated: null,
          };
          setSize({ width: l.width, height: l.height });
          setPosition({
            x: Math.max(60 - l.width, Math.min(l.x, window.innerWidth - 60)),
            y: Math.max(0, Math.min(l.y, window.innerHeight - 30)),
          });
          setDocked(dockable ? l.docked : null);
          setMode(l.mode);
          setArrangement(l.arrange ?? 'auto');
          setIsolated(l.isolated ?? null);
        },
      }),
    [registerHubLayout, initialPosition, initialSize, standardMode, setPosition, setSize, setMode, dockable],
  );

  /** Take the button row out of the field; it floats just above the field unless told where. */
  const barRef = useRef<HTMLDivElement>(null);
  const isolateBar = useCallback(
    (vertical: boolean, at?: { x: number; y: number }) => {
      const hub = hubRef.current?.getBoundingClientRect();
      const x = at?.x ?? (hub ? hub.left : 16);
      const y = at?.y ?? (hub ? Math.max(8, hub.top - 56) : 16);
      setIsolated({ x: Math.round(Math.max(0, x)), y: Math.round(Math.max(0, y)), vertical });
    },
    [hubRef],
  );
  // press and hold the grip, drag the row out of the field and drop it anywhere: it floats there
  const grip = useHoldDrag({
    onDrop: p => {
      const hub = hubRef.current?.getBoundingClientRect();
      const inside = hub && p.x >= hub.left - 24 && p.x <= hub.right + 24 && p.y >= hub.top - 24 && p.y <= hub.bottom + 24;
      if (!inside) isolateBar(false, { x: p.x - p.offsetX, y: p.y - p.offsetY });
    },
    onTap: () => print('hold the grip, then drag the button row out of the field (or type: isolate)'),
  });

  // runCommand and runAction call each other (custom actions run command lines).
  const runCommandRef = useRef<(line: string) => void>(() => {});

  const makeContext = useCallback(
    (args: string[]): ActionContext => ({
      args,
      print,
      printSections,
      clearLog: () => setLog([]),
      send: text => void send(text),
      runCommand: line => runCommandRef.current(line),
      mode,
      setMode,
      docked,
      dock,
      strings,
      setStrings,
      outputs,
      registry,
      layout,
      windows: uif.windows,
      remember: text => contextStore.remember(text),
      bar: {
        isolated: !!isolated,
        isolate: opts => isolateBar(opts?.vertical ?? false),
        join: () => setIsolated(null),
        arrangement,
        arrange: setArrangement,
        face: barFace.current ?? mode,
        faces: {
          get: m => (m === barFace.current ? registry.snapshot()
            : (() => {
              const kept = loadJSON<ActionsLayout | null>(`uif:${storageKey}:bar:${m}`, null);
              return kept ? { ...kept, custom: registry.snapshot().custom } : faceStandard(m);
            })()),
          set: (m, l) => (m === barFace.current ? registry.restore(l) : saveJSON(`uif:${storageKey}:bar:${m}`, l)),
          standard: faceStandard,
        },
      },
      requestScreens: async () => print(await requestScreens()),
    }),
    [print, printSections, send, mode, setMode, docked, dock, strings, setStrings, outputs, registry, layout, uif.windows, contextStore, requestScreens, isolated, arrangement, isolateBar, storageKey, faceStandard],
  );

  const runAction = useCallback(
    async (action: Action, args: string[] = []) => {
      try {
        await action.run(makeContext(args));
        onAction?.(action, args);
      } catch (err) {
        print(`${action.command}: ${(err as Error).message ?? err}`, 'err');
      }
    },
    [makeContext, onAction, print],
  );

  useEffect(() => registerRunner((id, args) => {
    const a = registry.get(id);
    if (a) void runAction(a, args);
  }), [registerRunner, registry, runAction]);

  const runCommand = useCallback(
    (line: string) => {
      print(`❯ ${line}`, 'cmd');
      const parsed = parseCommand(line, registry);
      if (!parsed) return;
      if (parsed.action) return void runAction(parsed.action, parsed.args);
      const handled = onCommand?.(parsed.name, parsed.args, makeContext(parsed.args));
      if (typeof handled === 'string') print(handled);
      else if (!onCommand) print(`unknown command: ${parsed.name} (try help)`, 'err');
    },
    [makeContext, onCommand, print, registry, runAction],
  );
  runCommandRef.current = runCommand;

  const submit = () => {
    const text = value;
    if (!text.trim()) return;
    // the switches the placeholders name: "T" alone in ask mode goes to T mode, ">" alone in T mode back to ask
    if (terminalMode && ((mode !== 'terminal' && text.trim() === 'T') || (mode === 'terminal' && text.trim() === '>'))) {
      setMode('toggle');
      setValue('');
      return;
    }
    // the persona's label alone switches to its mode; ">" in it goes back to the generic mode
    if (persona && text.trim().toLowerCase() === persona.label.toLowerCase() && mode !== 'persona') {
      setMode('persona');
      setValue('');
      return;
    }
    if (mode === 'persona' && text.trim() === '>') {
      setMode('chat');
      setValue('');
      return;
    }
    if (mode === 'terminal' || text.startsWith('/')) {
      history.current = [...history.current.filter(h => h !== text), text].slice(-100);
      historyIndex.current = -1;
      runCommand(text.trim());
      triggerGlow();
    } else {
      void send(text);
    }
    setValue('');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter sends, Shift+Enter is a new line; Enter that ends an IME composition only commits the text (Safari reports
    // that Enter with isComposing false but keyCode 229)
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && e.nativeEvent.keyCode !== 229) {
      e.preventDefault();
      submit();
      return;
    }
    if (mode !== 'terminal' || value.includes('\n') || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    const h = history.current;
    if (!h.length) return;
    e.preventDefault();
    let i = historyIndex.current;
    if (e.key === 'ArrowUp') i = i === -1 ? h.length - 1 : Math.max(0, i - 1);
    else i = i === -1 ? -1 : i + 1 >= h.length ? -1 : i + 1;
    historyIndex.current = i;
    setValue(i === -1 ? '' : h[i]);
  };

  const setHub = useCallback(
    (el: HTMLDivElement | null) => {
      hubRef.current = el;
    },
    [hubRef],
  );

  // a free field saved on a wider screen (or before a rotation) is drawn inside this one; its saved place is kept
  const freeLeft = Math.max(8, Math.min(position.x, viewport.width - Math.min(size.width, Math.max(200, viewport.width - 16)) - 8));
  const freeTop = typeof window !== 'undefined' ? Math.max(8, Math.min(position.y, window.innerHeight - size.height - 8)) : position.y;
  let dockStyle: React.CSSProperties = { left: freeLeft, top: freeTop };
  if (docked === 'top') dockStyle = { top: 0, left: '50%', transform: 'translateX(-50%)' };
  if (docked === 'bottom') dockStyle = { bottom: 0, left: '50%', transform: 'translateX(-50%)' };
  if (docked === 'left') dockStyle = { left: 0, top: '50%', transform: 'translateY(-50%)' };
  if (docked === 'right') dockStyle = { right: 0, top: '50%', transform: 'translateY(-50%)' };
  // in the page's flow, as wide as the place the page gave it
  if (docked === 'page') dockStyle = { position: 'relative', left: 'auto', top: 'auto', margin: '0 auto' };

  const isLoading = externalLoading || busy;
  const terminal = mode === 'terminal';
  modeNow.current = mode;
  const sideways = arrangement === 'sideways' || (arrangement === 'auto' && size.height < STACK_MIN);
  const fitW = Math.max(200, viewport.width - 16);
  // the field fills the screen (double-click its grip; again, or Esc, shrinks it back where it was)
  const [hubMax, setHubMax] = useState(false);
  useEffect(() => {
    if (!hubMax) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setHubMax(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [hubMax]);
  // "/" (outside a text field) or Ctrl/⌘+K focuses the input from anywhere on the page
  useEffect(() => {
    if (!focusKeys) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
      const k = (e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k';
      if (!k && (e.key !== '/' || typing || e.ctrlKey || e.metaKey || e.altKey)) return;
      if (e.isComposing) return;
      e.preventDefault();
      textareaRef.current?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [focusKeys]);
  // the field grows with its text (stacked, not filling the screen), up to 45% of the screen; empty, it is back
  const [grow, setGrow] = useState(0);
  const growRef = useRef(0);
  useEffect(() => {
    const ta = textareaRef.current;
    if (!autoGrow || !ta || hubMax || sideways || !value) { if (growRef.current) { growRef.current = 0; setGrow(0); } return; }
    const over = ta.scrollHeight - ta.clientHeight;
    const room = Math.max(0, Math.round(window.innerHeight * 0.45) - size.height);
    const next = Math.max(0, Math.min(room, growRef.current + over));
    if (Math.abs(next - growRef.current) > 2 || (over < 0 && growRef.current > 0)) {
      // shrinking: try smaller until the text just fits
      const fit = over < 0 ? Math.max(0, growRef.current + over) : next;
      growRef.current = fit;
      setGrow(fit);
    }
  }, [value, autoGrow, hubMax, sideways, size.height]);
  const voice = useVoice(voiceOn, text => setValue((valueRef.current ? valueRef.current.replace(/\s*$/, ' ') : '') + text));
  const containerClasses = [
    'ultimate-input-field',
    isGlowing ? 'animate-glow' : '',
    docked ? `transition-all is-docked docked-${docked}` : '',
    drawnTo ? `is-drawn-${drawnTo}` : '',
    hubMax ? 'is-maximized' : '',
    terminal ? 'terminal-glass' : glassEffect ? 'glass-effect' : '',
    terminal ? 'is-terminal' : 'is-chat',
    mode === 'persona' ? 'is-persona' : '',
    sideways ? 'is-sideways' : 'is-stacked',
    viewport.handheld ? 'is-handheld' : '',
    isolated ? 'has-isolated-bar' : '',
    toolsOpen && !terminal ? 'has-tools-open' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  const actionBar = (vertical: boolean) => (
    <ActionBar
      registry={registry}
      layout={layout}
      onRun={action => void runAction(action)}
      vertical={vertical}
      rolling={rolling}
      pressed={{
        strings,
        dock: !!docked,
        ...Object.fromEntries(uif.windows.defs.map(d => [`win-${d.id}`, uif.windows.isOpen(d.id)])),
      }}
    />
  );

  return (
    <div
      ref={setHub}
      className={containerClasses}
      style={hubMax
        ? { left: 0, top: 0, right: 'auto', bottom: 'auto', transform: 'none', width: '100vw', height: '100vh', maxWidth: 'none', zIndex: zIndexOf(HUB_KEY) }
        : {
          ...dockStyle,
          // grown with its text: a free field moves up so it stays on screen (its saved place does not change)
          ...(grow && !docked ? { top: Math.max(8, Math.min(freeTop, window.innerHeight - size.height - grow - 8)) } : {}),
          width: docked === 'page' ? '100%' : Math.min(size.width, fitW),
          height: size.height + grow,
          minWidth: Math.min(minWidth, fitW),
          maxWidth: maxWidth === undefined ? fitW : Math.min(maxWidth, fitW),
          minHeight,
          zIndex: zIndexOf(HUB_KEY),
        }}
      onPointerDownCapture={() => raise(HUB_KEY)}
    >
      {terminal && (
        <div className="uif-termlog" ref={logRef} role="log" aria-live="polite">
          {log.length === 0 && <div className="uif-termline is-dim">T mode: type a command, or help</div>}
          {log.map(l => (
            <div key={l.id} className={`uif-termline is-${l.kind} ${l.sections ? 'is-report' : ''}`}>
              {l.text}
              {l.sections?.map((s, i) => (
                <details key={i} className={`uif-termsection is-${s.level ?? 'ok'}`} open={s.open}>
                  <summary>
                    <span className="uif-termmark" aria-hidden="true">{s.level === 'bad' ? '✗' : s.level === 'warn' ? '!' : '✓'}</span>
                    {s.title}
                    <span className="uif-termhint">{s.level ?? 'ok'}</span>
                  </summary>
                  {s.lines.map((x, j) => <div key={j} className="uif-termsub">{x}</div>)}
                </details>
              ))}
            </div>
          ))}
        </div>
      )}

      {toolsOpen && tools && !terminal && (
        <div className={`uif-tools-tray ${toolsBelow ? 'is-below' : ''}`} role="region" aria-label={tools.label}>
          {tools.render(() => setToolsOpen(false))}
        </div>
      )}

      {drawnTo && createPortal(<div className={`uif-dock-hint is-${drawnTo}`} aria-hidden="true" />, document.body)}
      {draggable && (
        <div
          className={`drag-handle ${isDragging ? 'dragging' : ''}`}
          onPointerDown={hubMax ? undefined : e => {
            if (!docked) return startDrag(e);
            // pull a docked field free: it leaves the edge from where it is, and redocks if let go within reach
            const r = (e.currentTarget.closest('.ultimate-input-field') as HTMLElement).getBoundingClientRect();
            setDocked(null);
            startDrag(e, { x: r.left, y: r.top });
          }}
          onDoubleClick={() => setHubMax(m => !m)}
          onKeyDown={onHandleKeyDown}
          tabIndex={0}
          role="group"
          aria-label={`Input field. ${KEYBOARD_HINT}; double-click to fill the screen or shrink back`}
          title={`${KEYBOARD_HINT}. Double-click: fill the screen / shrink back (Esc)`}
        >
          <div className="drag-indicator" />
        </div>
      )}

      <div className="uif-row">
        {left && <div className="uif-modules uif-modules-left">{left}</div>}
        <div className="uif-core">
          <div className={`uif-prompt ${voice.available && !terminal ? 'has-mic' : ''}`}>
            {terminal && <span className="uif-prompt-sigil">❯</span>}
            <textarea
              ref={textareaRef}
              value={value}
              onChange={e => setValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={terminal ? terminalPlaceholder || 'Enter a command — help · > for ask mode'
                : mode === 'persona' && persona ? persona.placeholder || `${persona.label} mode · > for the generic ask · T for terminal mode`
                : placeholder || (terminalMode ? 'Message…  @output to target · /command to run · T for terminal mode' : 'Message…  @output to target · /command to run')}
              disabled={disabled}
              spellCheck={!terminal}
              enterKeyHint={terminal ? 'go' : 'send'}
              aria-label={terminal ? 'Command' : 'Message'}
              className={`ultimate-textarea ${terminal ? 'terminal-mode' : 'text-mode'} ${isDragging ? 'pointer-events-none' : ''}`}
            />
            {voice.available && !terminal && (
              <button
                type="button"
                className={`uif-mic ${voice.listening ? 'is-on' : ''}`}
                aria-pressed={voice.listening}
                onClick={voice.toggle}
                title={voice.listening ? 'Listening — press to stop' : `Speak instead of typing (off until pressed). ${VOICE_ENGINE()}`}
                aria-label={voice.listening ? 'Stop voice input' : 'Voice input'}
              >
                <span aria-hidden="true">{voice.listening ? '●' : '🎤'}</span>
              </button>
            )}
          </div>
          <div className="ultimate-controls">
            <div className="ultimate-controls-left">
              {terminalMode && (
                <Button
                  variant="ghost"
                  size="icon"
                  className={`uif-mode-toggle ${terminal ? 'is-terminal' : ''}`}
                  onClick={() => setMode('toggle')}
                  type="button"
                  title={terminal ? '> : back to ask mode' : 'T : terminal mode'}
                  aria-label={terminal ? 'Switch to ask mode' : 'Switch to terminal mode'}
                >
                  {/* the key the placeholder names: T in ask mode (to the terminal), > in T mode (back to ask) */}
                  {terminal ? <IconTerminal /> : <IconType />}
                </Button>
              )}
              {!terminalMode && tools && (
                <button
                  type="button"
                  className={`uif-tools-toggle ${toolsOpen ? 'is-on' : ''}`}
                  aria-expanded={toolsOpen}
                  aria-label={tools.label}
                  title={tools.label}
                  onClick={e => {
                    // the tray opens where there is room: above the field, or below it near the top of the screen
                    const r = (e.currentTarget.closest('.ultimate-input-field') as HTMLElement | null)?.getBoundingClientRect();
                    setToolsBelow(!!r && r.top < window.innerHeight * 0.45);
                    setToolsOpen(o => !o);
                  }}
                >
                  {tools.icon}
                </button>
              )}
              {persona && (
                <button
                  type="button"
                  className={`uif-persona-toggle ${mode === 'persona' ? 'is-on' : ''}`}
                  aria-pressed={mode === 'persona'}
                  onClick={() => setMode(mode === 'persona' ? 'chat' : 'persona')}
                  title={mode === 'persona' ? `${persona.label} mode · press for the generic ask mode (or type >)` : persona.title || `${persona.label} mode (or type ${persona.label})`}
                >
                  {persona.label}
                </button>
              )}
              <WindowsMenu />
              <ResponsesMenu />
              {!isolated && (
                <>
                  <button
                    type="button"
                    className={`uif-bar-grip ${grip.dragging ? 'is-dragging' : ''}`}
                    onPointerDown={grip.onPointerDown}
                    onKeyDown={e => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        isolateBar(false);
                      }
                    }}
                    title="Hold, then drag the button row out of the field"
                    aria-label="Button row: hold and drag to take it out of the field (Enter does it)"
                  >
                    ⠿
                  </button>
                  <div className="uif-bar-slot" ref={barRef}>
                    {actionBar(false)}
                  </div>
                </>
              )}
            </div>
            {status && !terminal && <span className={`uif-status is-${status.kind}`}>{status.text}</span>}
            {/* while an answer streams, Stop takes Send's place (one answer at a time; nothing is drawn over the bar) */}
            {busy && !terminal ? (
              <button type="button" className="uif-stop" onClick={() => stopRef.current?.()} title="Stop this answer" aria-label="Stop">
                <span aria-hidden="true">■</span>
              </button>
            ) : (
              <Button
                variant="default"
                size="icon"
                className="uif-send"
                onClick={submit}
                disabled={disabled || (isLoading && !terminal) || !value.trim()}
                type="button"
                aria-label={terminal ? 'Run' : 'Send'}
              >
                <IconSend />
              </Button>
            )}
          </div>
        </div>
        {right && <div className="uif-modules uif-modules-right">{right}</div>}
      </div>

      {!docked && resizable && <ResizeCorners onStart={startResize} />}

      {isolated && (
        <IsolatedBar state={isolated} onChange={setIsolated}>
          {actionBar(isolated.vertical)}
        </IsolatedBar>
      )}
      {grip.dragging &&
        createPortal(
          <div
            className="uif-bar-ghost"
            style={{
              left: grip.dragging.x - grip.dragging.offsetX,
              top: grip.dragging.y - grip.dragging.offsetY,
              width: barRef.current?.offsetWidth ?? 200,
            }}
          >
            button row
          </div>,
          document.body,
        )}
    </div>
  );
};
