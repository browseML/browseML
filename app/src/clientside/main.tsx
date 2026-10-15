// SPDX-License-Identifier: MIT
// The browseML app: the ultimate input field with this computer's controls. bankML runs in this browser
// (browseML): the model is pulled once, in the background, from its pinned source when the visitor imports it — the
// card in the response window offers it — checked against its sha256 pin, with a receipt on every answer checked
// here. An inquiry drops the field to the bottom left; its response window opens above it, joined by its string.
// 🛠 in the field (no terminal mode here) and the sidebar (it appears when a button is dragged off the field) hold the
// DreamKnob controls — threads, RAM (the context), the prompt cache, the answer length — and the diagnostics from what
// actually ran (usage.ts), never estimates. Commands: /client, /usage, /receipt, /shelf. Nothing is sent anywhere
// except the model's download.
// Built by vite.config.ts into dist/ (beside the landing page).
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import ReactDOM from 'react-dom/client';
import { UltimateBar } from '../components/UltimateBar';
import { Shelves } from '../components/Shelves';
import { createShelves } from '../core/shelves';
import { useUIF, type UIFContextValue } from '../components/UIFContext';
import { OutputWindow } from '../components/OutputWindow';
import { isOutputWindow } from '../core/bus';
import type { Action } from '../core/actions';
import type { SendMeta } from '../types';
import {
  CACHE_CHOICES, CTX_CHOICES, MAXTOK_CHOICES, browseDiag, browseMaxThreads, browseSettings, browseState, clearBrowseCache,
  download, downloadState, loadBrowse, onDownload, setBrowseSettings, unloadBrowse,
} from '../bankml/free';
import { mb, ramEstimate, readCaps } from '../bankml/caps';
import { advise, summarize, usageLog } from '../bankml/usage';
import { useBrowseML, RECEIPT, WIDGET } from './useBrowseML';
import { ReceiptAccordion } from './Receipt';
import { BrowseCard } from './BrowseCard';
import { trackKeyboard } from '../core/keyboard';
import { ControlPanel } from './ControlPanel';
import { ProcessorFire } from './Fire';
import { startMonitor } from './monitor';
import { exitBrowse } from '../bankml/free';
import { activePersona, applyPersona } from './Persona';
import { measureCores } from './cores';
import { Faq } from './Faq';
import { Atlas } from './Atlas';
import { measureTab } from './memory';
import '../styles/UltimateInputField.css';
import './clientside.css';

const KEY = 'ultimate-clientside';  // the storage key kept, so visitors keep their settings and shelves
const PHONE = '(max-width: 640px)';
/** The bar: ⬇ load, ⧉ dock in the page / pop out, ❏ spawn. No T mode here: 🛠 (where T sits) holds this computer's
 *  controls and the diagnostics; the commands stay reachable as /client, /usage, /receipt. */
const RACK = { chat: ['bankml-load', 'dock-page', 'spawn'] };
/** T in the field: the control panel (opens it on the left; again, shelves it). */
const togglePanel = () => { panelOpened = true; shelves.set(s => (s.shown ? { ...s, shown: false, shelved: true } : { ...s, shown: true, shelved: false })); };
/** The control panel opens with the visitor's first question of a visit, and when the model starts downloading, so its
 *  controls and diagnostics are in view while it does; shelved by the visitor, it stays shelved for the visit. Not on
 *  a phone, where it would cover the answer (T opens it there). */
let panelOpened = false;
const openPanelOnce = () => {
  if (panelOpened) return;
  panelOpened = true;
  if (window.innerWidth > 640 && !shelves.get().shown) shelves.set(s => ({ ...s, shown: true, shelved: false }));
};
/** The panel's width on screen (it may not be drawn yet in the frame it opens). */
const panelSide = () => (shelves.get().shown && window.innerWidth > 640
  ? (document.querySelector('.uif-shelves.is-open')?.getBoundingClientRect().width ?? shelves.get().width ?? 340) : 0);

/** The sidebar menu and the button panels, kept in this browser. */
const shelves = createShelves(`${KEY}:shelves`);
// each visit starts with the page alone: the panel (kept open last time or not) comes out with the first interaction
if (shelves.get().shown) shelves.set(s => ({ ...s, shown: false }));

/** The control panel comes out with every new response window — whatever opened it (a question, the FAQ, the windows
 *  menu, a reply) — on a desktop; on a phone it would cover the answer (the edge tab and T open it there). */
const openWithWindow = () => {
  panelOpened = true;
  if (window.innerWidth > 640 && !shelves.get().shown) shelves.set(s => ({ ...s, shown: true, shelved: false }));
};

function Bridge({ into, onReady }: { into: { current: UIFContextValue | null }; onReady(): void }) {
  const uif = useUIF();
  const first = !into.current;
  into.current = uif;
  const windows = uif.outputs.list().length, seen = useRef(windows);
  useEffect(() => {
    if (windows > seen.current) openWithWindow();
    seen.current = windows;
  }, [windows]);
  useEffect(() => {
    if (first) onReady();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

function fieldAt() {
  const w = window.innerWidth, h = window.innerHeight, phone = w <= 640;
  const width = phone ? Math.max(260, w - 32) : Math.min(720, w - 64);
  return { size: { width, height: 130 }, at: { x: Math.round((w - width) / 2), y: Math.max(12, h - 130 - (phone ? 16 : 32)) } };
}
const pick = <T extends number>(list: readonly T[], v: number): T | null => (list as readonly number[]).includes(v) ? (v as T) : null;

function Page() {
  const [at] = useState(fieldAt);
  const uif = useRef<UIFContextValue | null>(null);
  const a = useBrowseML(uif);
  const panel = useSyncExternalStore(shelves.subscribe, shelves.get, shelves.get);
  const A = useRef(a); A.current = a;
  useEffect(() => trackKeyboard(), []);
  // the model downloading (from the load button or a question): the panel with it
  useEffect(() => onDownload(d => { if (d.phase === 'downloading') openPanelOnce(); }), []);

  const onReady = () => {
    // browseML's persona first (the prompt it answers from), then, if the model is already here, started and warmed
    // the persona chosen (browseML's own is read from browseml.persona every visit, so its facts stay current)
    const persona = activePersona().then(p => applyPersona(() => uif.current, p)).catch(() => {});
    // the page just loads: browseML starts with the visitor's first interaction (below), not before
    void persona;
  };

  // the first interaction (a press or a key, anywhere): the control panel pops out on the left, and browseML starts
  // from a model already on this computer (kept here, or a remembered folder; nothing is downloaded by this)
  useEffect(() => {
    const first = (e: Event) => {
      document.removeEventListener('pointerdown', first, true);
      document.removeEventListener('keydown', first, true);
      // a press on T or in the panel itself is the visitor opening or shelving it: left to them
      if ((e.target as Element | null)?.closest?.('.uif-tools-toggle, .uif-shelves, .uif-shelves-tab')) { panelOpened = true; void measureCores().then(() => A.current.preload()); return; }
      // after the press lands: opening the panel moves the page, and a click must not lose its target
      if (e.type === 'pointerdown') {
        let done = false;
        const go = () => { if (done) return; done = true; window.removeEventListener('click', go); openPanelOnce(); };
        window.addEventListener('click', go);
        window.setTimeout(go, 700);
      } else openPanelOnce();
      // how much processor is free, measured before the engine starts (it waits for this), then started from what is here
      void measureCores().then(() => A.current.preload());
    };
    document.addEventListener('pointerdown', first, true);
    document.addEventListener('keydown', first, true);
    return () => { document.removeEventListener('pointerdown', first, true); document.removeEventListener('keydown', first, true); };
  }, []);

  // the panel opening: a free field and the windows on its side move clear of it
  const wasShown = useRef(!!shelves.get().shown);
  useEffect(() => shelves.subscribe(() => {
    // opening: the panel emerges from the input field (its centre, as a point on the panel)
    const shown = !!shelves.get().shown;
    if (shown && !wasShown.current) {
      const h = uif.current?.hubRef.current?.getBoundingClientRect();
      if (h) document.documentElement.style.setProperty('--uif-panel-origin', `${Math.round(h.left + h.width / 2)}px ${Math.round(h.top + h.height / 2)}px`);
    }
    wasShown.current = shown;
    if (!shown || window.innerWidth <= 640) return;
    requestAnimationFrame(() => {
      const f = uif.current, side = panelSide();
      if (!f || !side) return;
      const hub = f.hubLayout(), h = hub?.get();
      if (hub && h && !h.docked && h.x < side + 8) hub.set({ ...h, x: side + 16, width: Math.min(h.width, window.innerWidth - side - 32) });
      for (const w of f.outputs.list()) {
        if (w.placement !== 'inline' || w.maximized || w.rect.x >= side + 8) continue;
        f.setRect(w.id, { ...w.rect, x: side + 16, width: Math.max(280, Math.min(w.rect.width, window.innerWidth - side - 32)) });
      }
    });
  }), []);

  /** START in the panel: browseML from a model already here, else imported (downloaded once, checked). */
  const start = async (say: (t: string, tone?: 'ok' | 'bad' | 'working') => void) => {
    if (browseState()) return say(`browseML is running: ${browseState()!.model}`, 'ok');
    say('starting browseML…', 'working');
    await A.current.preload();
    if (!browseState()) {
      say('importing browseML: the model is pulled once, then checked against its sha256 pin…', 'working');
      if (!(await download())) return say(`browseML did not start: ${downloadState().error ?? downloadState().phase}`, 'bad');
      await A.current.ready();
    }
    const v = browseState();
    say(v ? `✓ browseML started: ${v.model} · ${v.threads} thread${v.threads === 1 ? '' : 's'}` : 'browseML did not start', v ? 'ok' : 'bad');
  };

  /** An inquiry: a field still docked in the page drops to the bottom left (clear of the sidebar), and a window
   *  opened for this question goes right above it, joined to it by its string; then browseML answers (or its card in
   *  the window offers the import). Ready, a new window starts with browseML's diagnostic line. */
  const onSend = (text: string, meta: SendMeta) => {
    const f = uif.current;
    const fresh = (f?.outputs.list().find(w => w.id === meta.outputId)?.messages.filter(m => m.role !== 'system').length ?? 0) <= 1;
    // the control panel opens with the response window (on a phone, T opens it); the field drops beside it
    if (fresh) openWithWindow(); else panelOpened = true;
    const hub = f?.hubLayout(), h = hub?.get();
    if (hub && h && h.docked === 'page') {
      const side = panelSide();
      const width = Math.max(300, Math.min(560, window.innerWidth - side - 32));
      hub.set({ ...h, docked: null, width, x: side + 16, y: window.innerHeight - h.height - 16 });
    }
    if (fresh && f) {
      if (browseState()) f.outputs.append(meta.outputId, { role: 'system', text: '', widget: WIDGET });
      // after the field has moved (two frames): the window right above it, as wide as there is room for
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const r = f.hubRef.current?.getBoundingClientRect();
        if (!r) return;
        const width = Math.round(Math.max(r.width, Math.min(720, window.innerWidth - r.left - 16)));
        const height = Math.round(Math.max(160, Math.min(560, r.top - 24)));
        f.setRect(meta.outputId, { x: Math.round(r.left), y: Math.max(8, Math.round(r.top) - 12 - height), width, height });
      }));
    }
    return A.current.onSend(text, meta);
  };

  const actions = useRef<Action[]>([
    {
      id: 'bankml-load', label: 'bankML in this browser', command: 'load', aliases: ['browseml'], icon: '⬇',
      description: 'load - import browseML: the model pulled once in the background (248 MB), checked against its sha256 pin, kept in this browser',
      async run(ctx) {
        if (browseState()) return ctx.print('browseML is ready: bankML answers in this browser');
        ctx.print('importing browseML: the model is pulled in the background, then bankML checks it…');
        const v = await download();
        if (v) { A.current.ready(); ctx.print(`✓ ${v.model} verified · ${v.threads} thread${v.threads === 1 ? '' : 's'}`); }
        else ctx.print(`browseML is not ready: ${downloadState().error ?? downloadState().phase}`, 'err');
      },
    },
    {
      id: 'client', label: 'Client', command: 'client', aliases: ['knobs'], icon: '🎛',
      description: 'client [threads <n>|ram <ctx>|cache <MiB>|answer <tokens>|apply|unload|clear|measure] - what bankML may take of this computer; with nothing, the settings and the advice from what ran here',
      async run(ctx) {
        const [sub, arg] = ctx.args, n = Number(arg);
        const s = browseSettings();
        const { max } = await browseMaxThreads();
        if (!sub) {
          if (ctx.mode !== 'terminal') { shelves.set(s => ({ ...s, shown: true })); return; }
          const loaded = browseState();
          ctx.print(`threads ${Math.min(max, s.threads ?? max)} of ${max} · ram (context) ${s.ctx}, at most ${mb(ramEstimate(s.ctx, s.cacheRam))} · cache ${s.cacheRam} MiB · answer ${s.maxTokens} tokens`);
          ctx.print(loaded ? `engine: ${loaded.model} · ${loaded.threads} thread${loaded.threads === 1 ? '' : 's'} · context ${loaded.ctx} · holds ${mb(browseDiag().memoryBytes)}` : 'engine: not loaded (load)');
          advise(usageLog(), { memoryGB: readCaps().memoryGB, threads: Math.min(max, s.threads ?? max), ctx: s.ctx, cacheRam: s.cacheRam })
            .forEach(v => ctx.print(`${v.level === 'ok' ? '✓' : v.level === 'warn' ? '!' : '✗'} ${v.text}`, v.level === 'bad' ? 'err' : 'out'));
          return;
        }
        switch (sub) {
          case 'threads':
            if (!Number.isInteger(n) || n < 1 || n > max) return ctx.print(`client threads: 1 to ${max} here`, 'err');
            setBrowseSettings({ threads: n }); return ctx.print(`threads ${n}: client apply to reload`);
          case 'ram': case 'ctx': {
            const c = pick(CTX_CHOICES, n);
            if (c === null) return ctx.print(`client ram: one of ${CTX_CHOICES.join(', ')} (tokens of context)`, 'err');
            setBrowseSettings({ ctx: c }); return ctx.print(`context ${c}: at most ${mb(ramEstimate(c, s.cacheRam))} · client apply to reload`);
          }
          case 'cache': {
            const c = pick(CACHE_CHOICES, n);
            if (c === null) return ctx.print(`client cache: one of ${CACHE_CHOICES.join(', ')} MiB`, 'err');
            setBrowseSettings({ cacheRam: c }); return ctx.print(`prompt cache ${c} MiB: client apply to reload`);
          }
          case 'answer': {
            const c = pick(MAXTOK_CHOICES, n);
            if (c === null) return ctx.print(`client answer: one of ${MAXTOK_CHOICES.join(', ')} tokens`, 'err');
            setBrowseSettings({ maxTokens: c }); return ctx.print(`answers of ${c} tokens at most, from the next question`);
          }
          case 'apply': {
            if (browseState()) await unloadBrowse();
            try {
              const v = await loadBrowse(line => ctx.print(line));
              return ctx.print(`✓ ${v.model} · ${v.threads} thread${v.threads === 1 ? '' : 's'} · context ${v.ctx} · holds ${mb(browseDiag().memoryBytes)}`);
            } catch (e) { return ctx.print(String((e as Error).message || e), 'err'); }
          }
          case 'unload': {
            if (!browseState()) return ctx.print('the engine is not loaded');
            const was = browseDiag().memoryBytes;
            await unloadBrowse(); return ctx.print(`unloaded: ${mb(was)} back to the browser; the model stays kept`);
          }
          case 'clear': {
            if (arg !== 'yes') return ctx.print('client clear yes - removes the kept model (248 MB) from this browser; the next load downloads it again');
            return ctx.print(`cleared: ${mb(await clearBrowseCache())} removed`);
          }
          case 'measure': {
            const m = await measureTab();
            return ctx.print(m.bytes !== null ? `this tab holds ${mb(m.bytes)} (${m.how})` : m.how, m.bytes !== null ? 'out' : 'err');
          }
          default: return ctx.print('client threads|ram|cache|answer <n> · apply · unload · clear yes · measure', 'err');
        }
      },
    },
    {
      id: 'dock-page', label: 'Dock in the page / pop out', command: 'pop', aliases: ['popout.field', 'inpage'], icon: '⧉',
      description: 'pop - the field docked in the page (it scrolls with it) or popped out (free: drag its grip, resize its corners, or let go near an edge to dock there); dragging a docked field also pops it out',
      run(ctx) { ctx.dock(ctx.docked === 'page' ? null : 'page'); },
    },
    {
      id: 'usage', label: 'Usage', command: 'usage', aliases: ['diag'], icon: '📈',
      description: 'usage - the loads and answers recorded in this browser, as they ran',
      run(ctx) {
        const u = usageLog(), s = summarize(u);
        if (!u.loads.length && !u.answers.length) return ctx.print('nothing recorded yet: load, then ask');
        s.byThreads.forEach(r => ctx.print(`${r.threads} thread${r.threads === 1 ? '' : 's'}: ${r.answers} answer${r.answers === 1 ? '' : 's'} · reading ${r.prompt.toFixed(2)} · writing ${r.gen.toFixed(2)} tok/s (medians)`));
        if (s.lastLoad) ctx.print(`last load: ${s.lastLoad.source === 'cache' ? 'from the cache' : `downloaded ${mb(s.lastLoad.fetched)}${s.lastLoad.retries ? `, ${s.lastLoad.retries} pieces retried` : ''}`} · verified in ${(s.lastLoad.openMs / 1000).toFixed(1)} s · ${mb(s.lastLoad.memory)} once open`);
        ctx.print(`peak engine memory ${mb(s.peakMemory)}${s.longest ? ` · longest exchange ${s.longest.tokens} tokens of ${s.longest.ctx}` : ''}`);
      },
    },
    {
      id: 'bankml-receipt', label: 'Receipt', command: 'receipt', icon: '🧾',
      description: "receipt - the last answer's receipt and its verdict",
      run(ctx) {
        const v = A.current.last;
        if (!v) return ctx.print('no answer yet', 'err');
        ctx.print(v.line, v.ok ? 'out' : 'err');
        if (v.receipt) ctx.print(JSON.stringify(v.receipt, null, 2));
      },
    },
  ]).current;

  const phone = window.matchMedia(PHONE).matches;
  const own = a.outcome;
  const widgets = { [WIDGET]: () => <BrowseCard onReady={() => void A.current.ready()} />, [RECEIPT]: ({ message }: { message: { data?: Record<string, unknown> } }) => <ReceiptAccordion data={message.data} /> };
  const mine = a.live !== null ? null
    : !own ? { text: 'receipt —', tone: '' }
    : own.how === 'delivered' ? (own.ok ? { text: '✓ receipt', tone: 'ok' } : { text: '✗ receipt', tone: 'bad' })
    : own.how === 'stopped' ? { text: 'stopped', tone: '' } : { text: 'no delivery', tone: 'bad' };

  return (
    <div className="cs-page">
      <ProcessorFire />
      <header className="cs-head">
        <h1 className="cs-mark"><img src="browseML-logo.png" alt="browseML" width="132" height="132" /></h1>
        <p className="cs-line">machine learning in your browser</p>
      </header>
      <Atlas />
      <div className="cs-dock">
        <UltimateBar
          storageKey={KEY}
          actions={actions}
          modeBar={RACK}
          onSend={onSend}
          outputPlace="above"
          defaultStrings
          widgets={widgets}
          placeholder="browseML knows best"
          initialSize={at.size}
          initialPosition={at.at}
          initialDock={phone ? undefined : 'page'}
          outputArea={() => {
            // response windows open beside the sidebar when it is shown (on a phone it overlays: no room)
            const side = panelSide();
            return { left: side, right: window.innerWidth };
          }}
          terminalMode={false}
          tools={{ label: 'T — tools: the control panel (STOP, CLEAR, dials, diagnostics, tool suite, limiters)', icon: 'T', onPress: togglePanel, pressed: !!panel.shown }}
          left={<span className={'cs-pill ' + (a.isReady ? 'is-ok' : '')} title={a.isReady ? 'bankML is verified and loaded here' : 'not imported yet: ask, or ⬇'}>{a.isReady ? '● browseML' : '○ browseML'}</span>}
          right={mine ? <span className={'cs-pill ' + (mine.tone ? `is-${mine.tone}` : '')}>{mine.text}</span> : <span className="cs-pill is-working">streaming · {a.live}</span>}
        >
          <Bridge into={uif} onReady={onReady} />
          <Shelves store={shelves} title="control panel" tab="always" top={<ControlPanel uif={uif} onModelReady={() => void A.current.ready()} onStart={start} />} />
        </UltimateBar>
      </div>
      <Faq uif={uif} />
      <footer className="cs-foot"><p>browseML · MIT OR Apache-2.0 · built on <a href="https://github.com/cryptoAGI/bankml">bankML</a> · dials by DreamKnob · <a href="https://github.com/browseML/browseML">source</a> · nothing you type leaves this device</p></footer>
    </div>
  );
}

if (!isOutputWindow()) {
  startMonitor();
  // a clean exit: when the page goes away the engine, its threads and its GPU worker end with it (nothing left running)
  addEventListener('pagehide', () => exitBrowse());
}  // battery, network, CPU, memory, GPU, engine: live from the first moment
ReactDOM.createRoot(document.getElementById('root')!).render(isOutputWindow() ? <OutputWindow /> : <Page />);
