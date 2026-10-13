// SPDX-License-Identifier: MIT
// ultimate-clientside: the ultimate input field with this computer's controls. bankML runs in this browser (browseML:
// the consent card, 248 MB once from huggingface.co, its sha256 checked, a receipt on every answer checked here); the
// client rack sets what it may take of this computer — CPU threads, RAM (the context), the prompt cache, the answer
// length — clears the kept model and unloads the engine; the diagnostics come from what actually ran here (usage.ts),
// never from estimates. No T mode: 🛠 in the field (where T sits elsewhere) opens the controls and the diagnostics on
// the field; the sidebar appears when a button is first dragged off the field and opens with the same controls and
// diagnostics, then the buttons dropped there. Commands: /client (`/client threads|ram|cache|answer <n>`,
// `/client apply|unload|clear yes|measure`), /usage, /receipt. Nothing is sent anywhere except the model's download.
// Built by vite.clientside.config.ts into dist-clientside/.
import { useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { UltimateBar } from '../components/UltimateBar';
import { Shelves } from '../components/Shelves';
import { createShelves } from '../core/shelves';
import { useUIF, type UIFContextValue } from '../components/UIFContext';
import { OutputWindow } from '../components/OutputWindow';
import { isOutputWindow } from '../core/bus';
import type { Action } from '../core/actions';
import { loadPersonaText, type Engine } from '../bankml/engine';
import {
  CACHE_CHOICES, CTX_CHOICES, MAXTOK_CHOICES, browseDiag, browseMaxThreads, browseSettings, browseState, clearBrowseCache,
  loadBrowse, setBrowseSettings, unloadBrowse,
} from '../bankml/free';
import { mb, ramEstimate, readCaps } from '../bankml/caps';
import { advise, summarize, usageLog } from '../bankml/usage';
import { useAnswerers } from '../bankml/ui/answering';
import { trackKeyboard } from '../core/keyboard';
import { ClientTools } from './ClientTools';
import { measureTab } from './memory';
import '../styles/UltimateInputField.css';
import './clientside.css';

const KEY = 'ultimate-clientside';
const ENGINES: readonly Engine[] = ['browse'];
const PHONE = '(max-width: 640px)';
/** The bar: ⬇ load, ⧉ dock in the page / pop out, ❏ spawn. No T mode here: 🛠 (where T sits) holds this computer's
 *  controls and the diagnostics; the commands stay reachable as /client, /usage, /receipt. */
const RACK = { chat: ['bankml-load', 'dock-page', 'spawn'] };
const TOOLS = { label: "Tools: this computer's controls and diagnostics", icon: '🛠', render: () => <ClientTools compact /> };

/** The sidebar menu and the button panels, kept in this browser. */
const shelves = createShelves(`${KEY}:shelves`);

function Bridge({ into, onReady }: { into: { current: UIFContextValue | null }; onReady(): void }) {
  const uif = useUIF();
  const first = !into.current;
  into.current = uif;
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
  const a = useAnswerers({ prefsKey: `${KEY}:prefs`, offered: ENGINES, uif, idBase: 'cs-tab', creds: false });
  const A = useRef(a); A.current = a;
  useEffect(() => trackKeyboard(), []);

  const onReady = () => {
    const field = uif.current!;
    if (!field.context.personaText.trim()) loadPersonaText().then(t => field.context.setPersonaText(t)).catch(() => {});
    A.current.showModel();
  };

  const actions = useRef<Action[]>([
    {
      id: 'bankml-load', label: 'bankML in this browser', command: 'load', aliases: ['browseml'], icon: '⬇',
      description: 'load - bankML in this browser: the consent card (248 MB once, from huggingface.co, its sha256 checked), then answers here with receipts',
      run: ctx => A.current.loadHere(ctx.print),
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
  const mine = a.live !== null ? null
    : !own ? { text: 'receipt —', tone: '' }
    : own.how === 'delivered' ? (own.ok ? { text: '✓ receipt', tone: 'ok' } : { text: '✗ receipt', tone: 'bad' })
    : own.how === 'stopped' ? { text: 'stopped', tone: '' } : { text: 'no delivery', tone: 'bad' };

  return (
    <div className="cs-page">
      <header className="cs-head">
        <h1 className="cs-mark">ultimate<span>-clientside</span></h1>
        <p className="cs-line">bankML in this browser, verified · this computer's controls · diagnostics from what actually ran</p>
      </header>
      <div className="cs-dock">
        <UltimateBar
          storageKey={KEY}
          actions={actions}
          modeBar={RACK}
          onSend={a.onSend}
          placeholder={phone ? 'Ask bankML (here)' : 'Ask bankML — it runs in this browser, with a receipt'}
          initialSize={at.size}
          initialPosition={at.at}
          initialDock={phone ? undefined : 'page'}
          outputArea={() => {
            // response windows open beside the sidebar when it is shown (on a phone it overlays: no room)
            const side = shelves.get().shown && window.innerWidth > 640 ? (document.querySelector('.uif-shelves.is-open')?.getBoundingClientRect().width ?? 0) : 0;
            return { left: side, right: window.innerWidth };
          }}
          terminalMode={false}
          tools={TOOLS}
          left={<span className={'cs-pill ' + (a.ready ? 'is-ok' : '')} title={a.ready ? 'bankML is verified and loaded here' : 'not loaded: ⬇ or the card below'}>{a.ready ? '● browseML' : '○ browseML'}</span>}
          right={mine ? <span className={'cs-pill ' + (mine.tone ? `is-${mine.tone}` : '')}>{mine.text}</span> : <span className="cs-pill is-working">streaming · {a.live}</span>}
        >
          <Bridge into={uif} onReady={onReady} />
          <Shelves store={shelves} top={<ClientTools />} />
        </UltimateBar>
      </div>
      <section className="cs-who" aria-label="bankML in this browser">{a.tabArea}</section>
      <footer className="cs-foot"><p>MIT · bankML (cryptoAGI) · the knobs are DreamKnob (MIT, Dreamodus Software Inc.) · nothing you type leaves this device</p></footer>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(isOutputWindow() ? <OutputWindow /> : <Page />);
