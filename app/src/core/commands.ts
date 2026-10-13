import type { Action, ActionRegistry } from './actions';

/** Split a line on whitespace, keeping "double" or 'single' quoted runs together. */
export function tokenize(line: string): string[] {
  const tokens: string[] = [];
  const re = /"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) {
    const quoted = m[1] ?? m[2];
    tokens.push(quoted !== undefined ? quoted.replace(/\\(.)/g, '$1') : m[3]);
  }
  return tokens;
}

export interface ParsedCommand {
  name: string;
  args: string[];
  action?: Action;
}

export function parseCommand(line: string, registry: ActionRegistry): ParsedCommand | null {
  const tokens = tokenize(line.trim().replace(/^\//, ''));
  if (!tokens.length) return null;
  const [name, ...args] = tokens;
  return { name, args, action: registry.find(name) };
}
