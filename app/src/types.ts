import type * as React from 'react';
import type { ReactNode } from 'react';
import type { Action, ActionRegistry, ActionsLayout } from './core/actions';
import type { HubArrangement, HubLayout, UIFProfile } from './core/profile';
import type { SendContext } from './core/context';

/** chat: the generic input/response mode; terminal: T mode, commands; persona: a host's persona mode (named by the
 *  `persona` prop, e.g. sAGI for Savante), which sends like chat with `meta.mode` = 'persona'. */
export type UIFMode = 'chat' | 'terminal' | 'persona';
/** Where the field docks: a screen edge, or 'page' — in the page's own flow, where the page placed it (it scrolls with
 *  the page; drag its grip to pop it out). */
export type DockEdge = 'top' | 'bottom' | 'left' | 'right' | 'page';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface OutputMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
  pending?: boolean;
  /** Never read aloud, even in an output with speak on (an engine marks a reply it does not vouch for). */
  silent?: boolean;
  /** A video or image the reply carries (an object URL or a link), shown under its text with a save link. */
  media?: { kind: 'video' | 'image'; url: string; name?: string };
  /** What a system line is: the delivery under an answer (tokens, speed, where it ran, the receipt's verdict), a
   *  footer the page adds (never the model's words), or a status while the answer is on its way. */
  kind?: 'delivery' | 'footer' | 'status';
  /** ok: delivered, a receipt that matched; bad: no delivery, an error; working: downloading, reading, streaming. */
  tone?: 'ok' | 'bad' | 'working';
  /** The reply was not delivered by the model (no completion tokens, an error, stopped): it says so in place of an
   *  answer, and the exchange is kept out of .history. */
  undelivered?: boolean;
}

export interface OutputField {
  id: string;
  title: string;
  color: string;
  placement: 'inline' | 'popout';
  rect: Rect;
  messages: OutputMessage[];
  /** Last reported screen geometry of a popped-out window. */
  screenGeom?: Rect;
  /** Replies in this output are read aloud (speech synthesis, the system's audio output). */
  speak?: boolean;
  /** Shown on another display through the Presentation API (a second screen, a cast device). */
  presented?: boolean;
  /** Filling the whole screen; `rect` is kept, so shrinking back returns it where it was. */
  maximized?: boolean;
}

/** Where a spawned output goes besides this page: its own window, a given monitor, a display, the speakers. */
export interface SpawnTarget {
  window?: boolean;
  /** 1-based monitor number (needs screen access: the `screens` command). */
  screen?: number;
  present?: boolean;
  speak?: boolean;
}

export interface ScreenInfoLine {
  index: number;
  label: string;
  primary: boolean;
  current: boolean;
  width: number;
  height: number;
}

export interface OutputsApi {
  list(): OutputField[];
  activeId: string | null;
  setActive(id: string): void;
  spawn(title?: string, target?: SpawnTarget): string;
  close(id: string): void;
  /** Close every output (in the page and popped out). */
  closeAll(): void;
  /** Empty every output's messages; the windows stay. */
  clearAll(): void;
  /** Fill the whole screen with an output, or shrink it back (toggles when `on` is not given). */
  maximize(id: string, on?: boolean): void;
  /** Arrange the in-page outputs in a grid that fills the screen. */
  tile(): void;
  /** Stack the in-page outputs diagonally, each a step down and right of the last. */
  cascade(): void;
  /** Open the output in its own window; with `screen`, on that monitor. Returns a note when something fell back. */
  popOut(id: string, opts?: { screen?: number }): string | void;
  /** Show the output on another display or cast device (Presentation API). Resolves with what happened. */
  present(id: string): Promise<string>;
  /** Read this output's replies aloud, or stop. Returns what happened. */
  setSpeak(id: string, on: boolean): string;
  /** The monitors, once screen access was granted (`screens`); null before. */
  screens(): ScreenInfoLine[] | null;
  callHome(id: string | 'all'): void;
  ping(id: string): void;
  clear(id: string): void;
  rename(id: string, title: string): void;
  append(id: string, message: Omit<OutputMessage, 'id'>): string;
  update(id: string, messageId: string, patch: Partial<OutputMessage>): void;
  /** Resolve an id, a 1-based index or a title to an output id. */
  resolve(ref: string | undefined): string | undefined;
}

export type LogKind = 'cmd' | 'out' | 'err';

/** A section of a terminal report: a heading that opens to its lines (an accordion in the T-mode log). */
export interface LogSection {
  title: string;
  lines: string[];
  /** ok, warn or bad: the heading's mark and colour. */
  level?: 'ok' | 'warn' | 'bad';
  open?: boolean;
}

/** Named layouts (`.profile`) and the reset to the standard layout. */
export interface LayoutApi {
  /** Saved profile names, sorted. */
  list(): string[];
  /** The profile last saved or loaded, or 'standard' after a reset. */
  active: string | null;
  /** The current layout as a profile, without saving it. */
  capture(name: string): UIFProfile;
  save(name: string): UIFProfile;
  /** Apply a saved profile; 'standard' resets. Returns false when there is no such profile. */
  load(name: string): boolean;
  remove(name: string): boolean;
  /** Back to the standard layout. Saved profiles are kept. */
  reset(): void;
  /** Download a profile as `<name>.profile` (the current layout when no saved name is given). */
  exportProfile(name?: string): void;
  /** Read a `.profile` file's text, save it and apply it. Returns its name; throws when the file is invalid. */
  importProfile(text: string, fileName?: string): string;
}

/** The input field registers this so profiles can read and set its layout. */
export interface HubLayoutHandle {
  get(): HubLayout;
  /** Apply a layout; null means the standard (default) layout. */
  set(layout: HubLayout | null): void;
}

export interface ActionContext {
  args: string[];
  print(text: string, kind?: LogKind): void;
  /** Print a report into the T-mode log: a heading line, then sections that open and close (an accordion). */
  printSections(title: string, sections: LogSection[]): void;
  clearLog(): void;
  send(text: string): void;
  runCommand(line: string): void;
  mode: UIFMode;
  setMode(mode: UIFMode | 'toggle'): void;
  docked: DockEdge | null;
  dock(edge: DockEdge | null): void;
  strings: boolean;
  setStrings(on: boolean | 'toggle'): void;
  outputs: OutputsApi;
  registry: ActionRegistry;
  layout: LayoutApi;
  /** Open, close or toggle the context windows (.history, .memory, .prompt, .persona, .model). */
  windows: { isOpen(id: string): boolean; show(id: string): void; hide(id: string): void; toggle(id: string): void };
  /** Add a note to .memory. */
  remember(text: string): Promise<void>;
  /** The button row: part of the field, or isolated as its own floating bar; and how the field is arranged. */
  bar: {
    isolated: boolean;
    isolate(opts?: { vertical?: boolean }): void;
    join(): void;
    arrangement: HubArrangement;
    arrange(a: HubArrangement): void;
    /** The mode now showing on the bar (each mode has its own face: the rolodex). */
    face: UIFMode;
    /** A mode's face of the bar: its layout (the registry's when it is the face showing), replaced (saved, and shown
     *  when it is the face showing), or the standard one the field starts with. */
    faces: {
      get(mode: UIFMode): ActionsLayout;
      set(mode: UIFMode, layout: ActionsLayout): void;
      standard(mode: UIFMode): ActionsLayout;
    };
  };
  requestScreens(): Promise<void>;
}

export interface SendMeta {
  outputId: string;
  /** The mode the message was sent in: 'chat' (generic) or 'persona' (the host's persona mode). */
  mode?: UIFMode;
  /**
   * The context to call a model with: the composed system prompt
   * (.prompt or the persona's, plus persona lines and the .memory block),
   * ready-made chat `messages` (system, this output's recent exchanges, the
   * new message), and the parsed .persona, .memory and .model.
   */
  context: SendContext;
  /**
   * Add fields to this exchange's .history record, e.g. `{ receipt }` from a
   * verifying engine (bankML's savante.history keeps one per answer). Later
   * calls merge; a field named like a standard one (model, prompt) replaces it.
   */
  annotate(fields: Record<string, unknown>): void;
  /**
   * Change this exchange's reply message while (or after) it streams, e.g. `{ silent: true }` so an output with
   * speak on does not read a reply the engine could not verify. Calls before the reply exists are kept for it.
   */
  markReply(patch: ReplyMarks): void;
  /** Aborted when the visitor presses Stop: an engine can close its request, and a wrapper knows the answer was cut. */
  signal?: AbortSignal;
}

/** What an engine may say about its own reply: not to be read aloud; not delivered, with the text that says so. */
export type ReplyMarks = Pick<Partial<OutputMessage>, 'silent' | 'undelivered' | 'text'>;

export type SendResult = void | string | Promise<string | void> | AsyncIterable<string>;

export interface UltimateInputFieldProps extends UIFProviderOptions {
  /** Controlled value. Omit to let the field manage its own text. */
  value?: string;
  onChange?: (value: string) => void;
  /**
   * Called in chat mode. A returned string, promise or async iterable is
   * written (or streamed) into the active output field.
   */
  onSend?: (text: string, meta: SendMeta) => SendResult;
  /** Called for terminal commands that match no action. A returned string is printed. */
  onCommand?: (name: string, args: string[], ctx: ActionContext) => string | void;
  /** Called after any action runs, from a button or a command. */
  onAction?: (action: Action, args: string[]) => void;
  /** The buttons each mode's bar starts with (ids, in order) until the visitor arranges it; MODE_BAR otherwise. A host
   *  puts its own button set here (a persona's carriers and rooms) beside the generic ones. */
  modeBar?: Partial<Record<UIFMode, readonly string[]>>;
  /** A third mode beside chat and T: the host's persona (e.g. `{ label: 'sAGI' }` for Savante). A button beside T
   *  switches to it, as does typing its label alone; `>` goes back to the generic mode. */
  persona?: { label: string; placeholder?: string; title?: string };
  /** T (terminal) mode: its button, typing T or > to switch, and the hints. Default true; false for a page whose
   *  field only asks (browseML), where `tools` usually takes T's place. */
  terminalMode?: boolean;
  /** A tools button where T sits (when terminalMode is false) that opens a tray on the field: a page's own controls
   *  and feedback (browseML: this computer's controls and diagnostics). */
  tools?: { label: string; icon: React.ReactNode; render(close: () => void): React.ReactNode };
  onModeChange?: (mode: UIFMode) => void;
  /** Extra actions to register alongside the built-ins. */
  actions?: Action[];
  isLoading?: boolean;
  className?: string;
  placeholder?: string;
  /** The placeholder in T (terminal) mode; `placeholder` is the ask (chat) mode's. */
  terminalPlaceholder?: string;
  disabled?: boolean;
  /** Initial mode. `'text'` is accepted as an alias for `'chat'`. */
  mode?: UIFMode | 'text';
  initialPosition?: { x: number; y: number };
  initialSize?: { width: number; height: number };
  minWidth?: number;
  maxWidth?: number;
  minHeight?: number;
  maxHeight?: number;
  draggable?: boolean;
  resizable?: boolean;
  dockable?: boolean;
  /** Where the field starts on a first visit (nothing saved): an edge, 'page' (in the page's flow), or null (free).
   *  Default: the bottom edge on a handheld, else free. */
  initialDock?: DockEdge | null;
  glowEffect?: boolean;
  glassEffect?: boolean;
  /** A 🎤 button where the browser has speech recognition (off until pressed; the browser's own engine hears it,
   *  nothing is recorded or sent by the page). Default true; false hides it. */
  voice?: boolean;
  /** The field grows with its text (up to 45% of the screen) and shrinks back when it is sent. Default true. */
  autoGrow?: boolean;
  /** Keys that focus the input from anywhere on the page: "/" (outside a text field) and Ctrl/⌘+K. Default true. */
  focusKeys?: boolean;
  /** Modules rendered on either side of the field (see UltimateBar). */
  left?: ReactNode;
  right?: ReactNode;
}

export interface UIFProviderOptions {
  /** Modules that add windows and actions (the context module is always there). Read once. */
  modules?: import('./core/modules').UIFModule[];
  /** Namespaces localStorage keys and the BroadcastChannel. */
  storageKey?: string;
  /** URL the pop-out windows load. Defaults to the current page. */
  popoutUrl?: string;
  /** Whether tethers and beacons start visible. */
  defaultStrings?: boolean;
  /** Where the page's own top matter ends (px from the viewport's top, read when a response window opens): with no
   *  room beside the field, a response window opens between this and the field, as wide as the field, instead of
   *  over the page's header. */
  outputTop?: () => number;
  /** The part of the viewport's width response windows open in (px from the left, read when one opens): a page with
   *  sidebars keeps them clear of its panels. Default: the whole width. */
  outputArea?: () => { left: number; right: number };
}
