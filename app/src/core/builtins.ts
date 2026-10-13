import type { DockEdge, UIFMode } from '../types';
import type { Action } from './actions';
import { rackAdd, rackMove, rackRemove } from './rack';

const EDGES: DockEdge[] = ['top', 'bottom', 'left', 'right', 'page'];

function needOutput(ctx: Parameters<Action['run']>[0], verb: string): string | undefined {
  const id = ctx.outputs.resolve(ctx.args[0]);
  if (!id) ctx.print(`${verb}: no output ${ctx.args[0] ? `"${ctx.args[0]}"` : 'is active'}`, 'err');
  return id;
}

export const builtinActions: Action[] = [
  {
    id: 'spawn',
    label: 'Spawn output',
    command: 'spawn',
    aliases: ['new'],
    icon: '⊞',
    description: 'spawn [title] [--window] [--screen N] [--present] [--speak] - open a new output, here or on another monitor, display or the speakers',
    builtin: true,
    async run(ctx) {
      const words: string[] = [];
      const target: { window?: boolean; screen?: number; present?: boolean; speak?: boolean } = {};
      for (let i = 0; i < ctx.args.length; i++) {
        const a = ctx.args[i];
        if (a === '--window' || a === '--popout') target.window = true;
        else if (a === '--present' || a === '--cast') target.present = true;
        else if (a === '--speak' || a === '--voice') target.speak = true;
        else if (a === '--screen') {
          const n = Number(ctx.args[++i]);
          if (!Number.isInteger(n) || n < 1) return ctx.print('spawn: --screen needs a monitor number (1, 2, …; see "screens")', 'err');
          target.screen = n;
        } else words.push(a);
      }
      const id = ctx.outputs.spawn(words.join(' ') || undefined);
      ctx.print(`spawned ${id}`);
      if (target.speak) ctx.print(ctx.outputs.setSpeak(id, true));
      if (target.present) ctx.print(await ctx.outputs.present(id));
      else if (target.window || target.screen !== undefined) {
        const note = ctx.outputs.popOut(id, { screen: target.screen });
        if (note) ctx.print(note, 'err');
      }
    },
  },
  {
    id: 'strings',
    label: 'Strings',
    command: 'strings',
    aliases: ['find'],
    icon: '〰',
    description: 'strings [on|off] - show lines to every output',
    builtin: true,
    run(ctx) {
      const arg = ctx.args[0];
      ctx.setStrings(arg === 'on' ? true : arg === 'off' ? false : 'toggle');
    },
  },
  {
    id: 'home',
    label: 'Call home',
    command: 'home',
    icon: '⌂',
    description: 'home [output|all] - bring outputs back beside the field',
    builtin: true,
    run(ctx) {
      const ref = ctx.args[0];
      if (!ref || ref === 'all') {
        ctx.outputs.callHome('all');
        ctx.print('called all outputs home');
        return;
      }
      const id = needOutput(ctx, 'home');
      if (id) ctx.outputs.callHome(id);
    },
  },
  {
    id: 'dock',
    label: 'Dock',
    command: 'dock',
    icon: '▁',
    description: 'dock [top|bottom|left|right|page|off] - pin the field to an edge, or into the page (page: it sits where the page put it; drag its grip to pop it out)',
    builtin: true,
    run(ctx) {
      const arg = ctx.args[0] as DockEdge | 'off' | undefined;
      if (arg === 'off') return ctx.dock(null);
      if (arg && !EDGES.includes(arg)) return ctx.print(`dock: unknown edge "${arg}"`, 'err');
      ctx.dock(arg ?? (ctx.docked ? null : 'bottom'));
    },
  },
  {
    id: 'isolate',
    label: 'Isolate buttons',
    command: 'isolate',
    icon: '⠿',
    description: 'isolate [vertical] - take the button row out of the field as its own floating bar (join puts it back)',
    builtin: true,
    defaultHidden: true,
    run(ctx) {
      const vertical = ['vertical', 'sideways', 'v'].includes(ctx.args[0] ?? '');
      ctx.bar.isolate({ vertical });
      ctx.print(`the button row floats on its own${vertical ? ', standing up' : ''}; "join" puts it back`);
    },
  },
  {
    id: 'join',
    label: 'Join buttons',
    command: 'join',
    icon: '⤓',
    description: 'join - put an isolated button row back into the field',
    builtin: true,
    defaultHidden: true,
    run(ctx) {
      if (!ctx.bar.isolated) return ctx.print('the button row is already in the field');
      ctx.bar.join();
      ctx.print('the button row is back in the field');
    },
  },
  {
    id: 'arrange',
    label: 'Arrange field',
    command: 'arrange',
    icon: '⇵',
    description: 'arrange [auto|stacked|sideways] - input above the buttons, side by side, or by height (auto)',
    builtin: true,
    defaultHidden: true,
    run(ctx) {
      const want = ctx.args[0];
      if (!want) return ctx.print(`arrangement: ${ctx.bar.arrangement}`);
      if (want !== 'auto' && want !== 'stacked' && want !== 'sideways') return ctx.print('arrange auto | stacked | sideways', 'err');
      ctx.bar.arrange(want);
      ctx.print(`arrangement: ${want}`);
    },
  },
  {
    id: 'speak',
    label: 'Speak output',
    command: 'speak',
    aliases: ['voice'],
    icon: '🔊',
    description: 'speak [output] [on|off] - read an output\'s replies aloud (the system\'s audio output)',
    builtin: true,
    defaultHidden: true,
    run(ctx) {
      const last = ctx.args[ctx.args.length - 1];
      const setting = last === 'on' || last === 'off' ? last : undefined;
      const ref = setting ? ctx.args.slice(0, -1).join(' ') : ctx.args.join(' ');
      const id = ctx.outputs.resolve(ref || undefined);
      if (!id) return ctx.print(`speak: no output ${ref ? `"${ref}"` : 'is active'}`, 'err');
      const now = ctx.outputs.list().find(f => f.id === id)?.speak;
      ctx.print(ctx.outputs.setSpeak(id, setting ? setting === 'on' : !now));
    },
  },
  {
    id: 'present',
    label: 'Present output',
    command: 'present',
    aliases: ['cast'],
    icon: '📺',
    description: 'present [output] - show an output on another display or cast device (Presentation API)',
    builtin: true,
    defaultHidden: true,
    async run(ctx) {
      const id = ctx.outputs.resolve(ctx.args.join(' ') || undefined);
      if (!id) return ctx.print('present: no output is active', 'err');
      ctx.print(await ctx.outputs.present(id));
    },
  },
  {
    id: 'popout',
    label: 'Pop out',
    command: 'popout',
    aliases: ['pop'],
    icon: '⧉',
    description: 'popout [output] [--screen N] - move an output into its own window, on monitor N if given',
    builtin: true,
    defaultHidden: true,
    run(ctx) {
      const i = ctx.args.indexOf('--screen');
      const screen = i >= 0 ? Number(ctx.args[i + 1]) : undefined;
      if (i >= 0 && (!Number.isInteger(screen) || (screen as number) < 1)) return ctx.print('popout: --screen needs a monitor number', 'err');
      const ref = (i >= 0 ? [...ctx.args.slice(0, i), ...ctx.args.slice(i + 2)] : ctx.args).join(' ');
      const id = ctx.outputs.resolve(ref || undefined);
      if (!id) return ctx.print(`popout: no output ${ref ? `"${ref}"` : 'is active'}`, 'err');
      const note = ctx.outputs.popOut(id, { screen });
      if (note) ctx.print(note, 'err');
    },
  },
  {
    id: 'close',
    label: 'Close output',
    command: 'close',
    icon: '⊠',
    description: 'close [output|all] - close an output field, or every one',
    builtin: true,
    defaultHidden: true,
    run(ctx) {
      if (ctx.args[0] === 'all') {
        const n = ctx.outputs.list().length;
        ctx.outputs.closeAll();
        return ctx.print(`closed ${n} output${n === 1 ? '' : 's'}`);
      }
      const id = needOutput(ctx, 'close');
      if (id) ctx.outputs.close(id);
    },
  },
  {
    id: 'max',
    label: 'Fill the screen',
    command: 'max',
    aliases: ['maximize'],
    icon: '⤢',
    description: 'max [output] - fill the screen with an output, or shrink it back (double-click its header does the same)',
    builtin: true,
    defaultHidden: true,
    run(ctx) {
      const id = needOutput(ctx, 'max');
      if (id) ctx.outputs.maximize(id);
    },
  },
  {
    id: 'tile',
    label: 'Tile outputs',
    command: 'tile',
    icon: '▦',
    description: 'tile - arrange the outputs in a grid that fills the screen',
    builtin: true,
    defaultHidden: true,
    run(ctx) {
      ctx.outputs.tile();
    },
  },
  {
    id: 'cascade',
    label: 'Cascade outputs',
    command: 'cascade',
    icon: '◪',
    description: 'cascade - stack the outputs, each a step down and right',
    builtin: true,
    defaultHidden: true,
    run(ctx) {
      ctx.outputs.cascade();
    },
  },
  {
    id: 'rename',
    label: 'Rename output',
    command: 'rename',
    icon: '✎',
    description: 'rename <output> <new title> - rename an output field',
    builtin: true,
    defaultHidden: true,
    run(ctx) {
      const [ref, ...rest] = ctx.args;
      const title = rest.join(' ').trim();
      if (!ref || !title) return ctx.print('rename: usage rename <output> <new title>', 'err');
      const id = ctx.outputs.resolve(ref);
      if (!id) return ctx.print(`rename: no output "${ref}"`, 'err');
      ctx.outputs.rename(id, title);
      ctx.print(`renamed ${ref} to ${title}`);
    },
  },
  {
    id: 'ping',
    label: 'Ping output',
    command: 'ping',
    icon: '◎',
    description: 'ping [output] - flash an output so you can find it',
    builtin: true,
    defaultHidden: true,
    run(ctx) {
      const id = needOutput(ctx, 'ping');
      if (id) ctx.outputs.ping(id);
    },
  },
  {
    id: 'outputs',
    label: 'List outputs',
    command: 'outputs',
    aliases: ['ls'],
    icon: '☷',
    description: 'outputs - list output fields',
    builtin: true,
    defaultHidden: true,
    run(ctx) {
      const list = ctx.outputs.list();
      if (!list.length) return ctx.print('no outputs');
      list.forEach((o, i) =>
        ctx.print(`${i + 1}  ${o.id}  ${o.title}  [${o.placement}]${o.id === ctx.outputs.activeId ? '  *' : ''}`),
      );
    },
  },
  {
    id: 'screens',
    label: 'Screens',
    command: 'screens',
    icon: '▭',
    description: 'screens - allow pop-outs to open on other monitors',
    builtin: true,
    defaultHidden: true,
    async run(ctx) {
      await ctx.requestScreens();
      const list = ctx.outputs.screens();
      list?.forEach(sc =>
        ctx.print(`${sc.index}  ${sc.label}  ${sc.width}×${sc.height}${sc.primary ? '  primary' : ''}${sc.current ? '  (this window)' : ''}`),
      );
      if (list) ctx.print('spawn <title> --screen N opens an output on monitor N');
    },
  },
  {
    id: 'mode',
    label: 'Toggle mode',
    command: 'mode',
    aliases: ['chat', 't'],
    icon: 'T',
    description: 'mode [chat|terminal|persona] - switch between chat (generic), terminal and the persona mode',
    builtin: true,
    defaultHidden: true,
    run(ctx) {
      const arg = ctx.args[0];
      ctx.setMode(arg === 'chat' ? 'chat' : arg === 'terminal' ? 'terminal' : arg === 'persona' ? 'persona' : 'toggle');
    },
  },
  {
    id: 'clear',
    label: 'Clear',
    command: 'clear',
    aliases: ['cls'],
    icon: '⌫',
    description: 'clear [output|all] - clear the terminal log, an output, or every output',
    builtin: true,
    defaultHidden: true,
    run(ctx) {
      if (!ctx.args[0]) return ctx.clearLog();
      if (ctx.args[0] === 'all') return ctx.outputs.clearAll();
      const id = needOutput(ctx, 'clear');
      if (id) ctx.outputs.clear(id);
    },
  },
  {
    id: 'profile',
    label: 'Layouts',
    command: 'profile',
    aliases: ['layout'],
    icon: '▦',
    description: 'profile [list|save <name>|load <name>|delete <name>|export [name]] - saved layouts (.profile)',
    builtin: true,
    defaultHidden: true,
    run(ctx) {
      const [sub = 'list', ...rest] = ctx.args;
      const name = rest.join(' ').trim();
      const { layout } = ctx;
      switch (sub) {
        case 'list': {
          const names = layout.list();
          ctx.print(names.length ? names.map(n => (n === layout.active ? `* ${n}` : `  ${n}`)).join('\n') : 'no saved layouts');
          return;
        }
        case 'save':
          if (!name) return ctx.print('profile: usage profile save <name>', 'err');
          ctx.print(`saved "${layout.save(name).name}"`);
          return;
        case 'load':
          if (!name) return ctx.print('profile: usage profile load <name>', 'err');
          return layout.load(name) ? ctx.print(`loaded "${name}"`) : ctx.print(`profile: no layout "${name}"`, 'err');
        case 'delete':
          return layout.remove(name) ? ctx.print(`deleted "${name}"`) : ctx.print(`profile: no layout "${name}"`, 'err');
        case 'export':
          layout.exportProfile(name || undefined);
          ctx.print(`exported ${name || 'the current layout'}`);
          return;
        default:
          // "profile work" is short for "profile load work".
          return layout.load(ctx.args.join(' ')) ? ctx.print(`loaded "${ctx.args.join(' ')}"`) : ctx.print(`profile: unknown "${sub}"`, 'err');
      }
    },
  },
  {
    id: 'reset',
    label: 'Reset layout',
    command: 'reset',
    icon: '↺',
    description: 'reset - back to the standard layout (saved layouts are kept)',
    builtin: true,
    defaultHidden: true,
    run(ctx) {
      ctx.layout.reset();
      ctx.print('reset to the standard layout');
    },
  },
  {
    id: 'remember',
    label: 'Remember',
    command: 'remember',
    icon: '◈',
    description: 'remember <text> - add a note to .memory',
    builtin: true,
    defaultHidden: true,
    async run(ctx) {
      const text = ctx.args.join(' ').trim();
      if (!text) return ctx.print('remember: usage remember <text>', 'err');
      await ctx.remember(text);
      ctx.print('remembered');
    },
  },
  {
    id: 'rack',
    label: 'Rack',
    command: 'rack',
    icon: '▥',
    description: 'rack [t] [add <command> [n]|remove <command>|move <command> <n>|reset] - the buttons on the bar (the chat bar; "rack t …" the T-mode bar); kept',
    builtin: true,
    defaultHidden: true,
    run(ctx) {
      const args = [...ctx.args];
      // which face of the bar: the chat (ask) bar unless T or persona is named
      const faceWord: Record<string, UIFMode> = { t: 'terminal', terminal: 'terminal', chat: 'chat', ask: 'chat', persona: 'persona' };
      const face: UIFMode = args[0] && faceWord[args[0].toLowerCase()] ? faceWord[args.shift()!.toLowerCase()] : 'chat';
      const name = face === 'terminal' ? 'the T-mode rack' : face === 'persona' ? 'the persona rack' : 'the rack';
      const [sub = 'list', ref, pos] = args;
      const known = (id: string) => !!ctx.registry.get(id);
      const find = (r: string | undefined) => (r ? ctx.registry.find(r) ?? ctx.registry.get(r) : undefined);
      const faces = ctx.bar.faces;
      const l = faces.get(face);
      const label = (id: string) => {
        const a = ctx.registry.get(id);
        return a ? `${typeof a.icon === 'string' ? a.icon + ' ' : ''}${a.command}` : id;
      };
      const position = (p: string | undefined) => {
        const n = Number(p);
        return Number.isInteger(n) && n >= 1 ? n - 1 : undefined;
      };
      const shown = face === ctx.bar.face ? '' : ` (it shows in ${face === 'terminal' ? 'T mode' : face === 'persona' ? 'the persona mode' : 'ask mode: > to go back'})`;
      switch (sub) {
        case 'list':
        case 'ls': {
          const racked = l.order.filter(known);
          ctx.print(`${name}: ${racked.length ? racked.map((id, i) => `${i + 1} ${label(id)}`).join(' · ') : 'empty'} · then +   (always there: T · ▤ windows · responses)`);
          const floating = Object.keys(l.floating).filter(known);
          if (floating.length) ctx.print(`floating on the page: ${floating.map(label).join(' · ')}`);
          const available = ctx.registry.all().map(a => a.id).filter(id => !racked.includes(id) && !floating.includes(id));
          ctx.print(`available: ${available.map(id => ctx.registry.get(id)!.command).join(' ') || 'none'}`);
          ctx.print(`rack${face === 'chat' ? '' : ' t'} add <command> [n] · rack remove <command> · rack move <command> <n> · rack reset`);
          return;
        }
        case 'add': {
          const a = find(ref);
          if (!a) return ctx.print(`rack add: no command "${ref ?? ''}" (rack lists them)`, 'err');
          if (pos !== undefined && position(pos) === undefined) return ctx.print('rack add: the position is a number, 1 for the first', 'err');
          faces.set(face, rackAdd(l, a.id, known, position(pos)));
          return ctx.print(`racked ${label(a.id)} on ${name}${pos ? ` at ${pos}` : ''}${shown}`);
        }
        case 'remove':
        case 'rm': {
          const a = find(ref);
          if (!a) return ctx.print(`rack remove: no command "${ref ?? ''}"`, 'err');
          const next = rackRemove(l, a.id);
          if (!next) return ctx.print(`rack remove: ${a.command} is not on ${name}`, 'err');
          faces.set(face, next);
          return ctx.print(`took ${label(a.id)} off ${name}; still a command, and in + to add back`);
        }
        case 'move':
        case 'mv': {
          const a = find(ref), to = position(pos);
          if (!a || to === undefined) return ctx.print('rack move: usage rack move <command> <position> (1 is the first)', 'err');
          const next = rackMove(l, a.id, known, to);
          if (!next) return ctx.print(`rack move: ${a.command} is not on ${name} (rack add ${a.command} ${pos})`, 'err');
          faces.set(face, next);
          return ctx.print(`moved ${label(a.id)} to ${to + 1} on ${name}`);
        }
        case 'reset':
          faces.set(face, faces.standard(face));
          return ctx.print(`${name} is back to its standard buttons${shown}`);
        default:
          return ctx.print(`rack: unknown "${sub}" (rack · rack add · rack remove · rack move · rack reset)`, 'err');
      }
    },
  },
  {
    id: 'actions',
    label: 'List actions',
    command: 'actions',
    icon: '≡',
    description: 'actions - list every action and its command',
    builtin: true,
    defaultHidden: true,
    run(ctx) {
      const visible = new Set(ctx.registry.visible().map(a => a.id));
      ctx.registry.all().forEach(a =>
        ctx.print(`${visible.has(a.id) ? '●' : '○'} ${a.command.padEnd(10)} ${a.label}`),
      );
    },
  },
  {
    id: 'help',
    label: 'Help',
    command: 'help',
    aliases: ['?'],
    icon: '?',
    description: 'help - list commands',
    builtin: true,
    defaultHidden: true,
    run(ctx) {
      ctx.registry.all().forEach(a => ctx.print(a.description ?? `${a.command} - ${a.label}`));
      ctx.print('hold any button to rearrange; drag it off the bar to hide it');
    },
  },
];

/**
 * The buttons each mode's bar shows until it is rearranged: the rolodex's two faces. Chat manages the conversation's
 * output fields; T (terminal) mode the fields' state and the context windows a command works with.
 */
export const MODE_BAR: Record<'chat' | 'terminal', readonly string[]> = {
  chat: ['spawn', 'strings', 'home', 'dock', 'popout', 'rename', 'clear', 'outputs'],
  // `diag` is a host's action (the bankML console registers it); where none does, its place stays empty
  terminal: ['ping', 'diag', 'outputs', 'screens', 'close', 'clear', 'win-history', 'win-memory', 'win-prompt'],
};
