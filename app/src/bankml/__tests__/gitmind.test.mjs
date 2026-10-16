// SPDX-License-Identifier: MIT
// browseML's .memory as git: the ids are git's own, and the bundle is one git itself verifies, clones and logs.
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FILE, IGNORE, bundle, commitBody, ledgerEvent, nextVersion, object, objectsOf, subjectFor, tree } from '../gitmind';

const hasGit = (() => { try { execFileSync('git', ['--version']); return true; } catch { return false; } })();
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' } }).trim();
const SOURCE = 'browseML https://mindx.pythai.net/bankml/\n';
const n1 = '{"ts":1,"text":"the operator prefers verdicts"}\n', n2 = '{"ts":2,"text":"second note"}\n';

async function history() {
  const vs = [], objs = [];
  let prev = null;
  for (const [text, at, restore] of [[n1, 1_760_000_000_000], [n1 + n2, 1_760_000_060_000], [n2, 1_760_000_120_000]]) {
    const r = (await nextVersion(prev, text, at, SOURCE, restore));
    vs.push(r.version); objs.push(...r.objects); prev = r.version;
  }
  const back = (await nextVersion(prev, vs[1].text, 1_760_000_180_000, SOURCE, vs[1].commit));  // a restore: a new commit
  vs.push(back.version); objs.push(...back.objects);
  return { vs, objs };
}

describe('subjects, as memgit words them', () => {
  it('added, removed, cleared, restored', () => {
    expect(subjectFor('', n1)).toBe('add 1 note');
    expect(subjectFor(n1, n1 + n2)).toBe('add 1 note');
    expect(subjectFor(n1 + n2, n2)).toBe('remove 1 note');
    expect(subjectFor(n1, '')).toBe(`clear ${FILE}`);
    expect(subjectFor(n1, n2, 'abcdef0123')).toBe(`restore ${FILE} to abcdef0`);
  });
  it('nothing changed: no version', async () => {
    const r = (await nextVersion(null, n1, 1000, SOURCE));
    expect(await nextVersion(r.version, n1, 2000, SOURCE)).toBeNull();
  });
});

describe('the history is git', () => {
  it('a restore is a new commit on top, never a rewrite', async () => {
    const { vs } = await history();
    expect(vs.map(v => v.n)).toEqual([1, 2, 3, 4]);
    expect(vs[3].parent).toBe(vs[2].commit);
    expect(vs[3].text).toBe(vs[1].text);
    expect(vs[3].subject).toBe(`restore ${FILE} to ${vs[1].commit.slice(0, 7)}`);
    expect(ledgerEvent(vs[0], null).transition).toBe('reset');
    expect(ledgerEvent(vs[1], vs[0])).toMatchObject({ kind: 'snapshot', transition: 'advance', head: vs[1].commit, prev_head: vs[0].commit, commit_count: 2 });
  });
  it('rebuilt from the texts alone, every commit is the same', async () => {
    const { vs } = await history();
    const objs = await objectsOf(vs, SOURCE);
    expect(objs.filter(o => o.kind === 'commit').map(o => o.id)).toEqual(vs.map(v => v.commit));
  });
  it.skipIf(!hasGit)('blob, tree and commit ids equal git hash-object', async () => {
    const d = mkdtempSync(join(tmpdir(), 'bml-gm-'));
    const blob = await object('blob', n1);
    writeFileSync(join(d, 'f'), n1);
    expect(blob.id).toBe(git(d, 'hash-object', 'f'));
    const ign = await object('blob', IGNORE);
    const t = await tree([{ name: FILE, blob: blob.id }, { name: '.gitignore', blob: ign.id }]);
    const c = await object('commit', commitBody(t.id, null, 1_760_000_000, 'add 1 note'));
    git(d, 'init', '-q');
    writeFileSync(join(d, 't'), t.body); writeFileSync(join(d, 'c'), c.body);
    expect(t.id).toBe(git(d, 'hash-object', '-t', 'tree', '--literally', 't'));
    expect(c.id).toBe(git(d, 'hash-object', '-t', 'commit', '--literally', 'c'));
  });
  it.skipIf(!hasGit)('the bundle: git verifies it, clones it, and logs the history; the files are the last version', async () => {
    const { vs, objs } = await history();
    const d = mkdtempSync(join(tmpdir(), 'bml-gm-'));
    const b = join(d, 'browseml-memory.bundle');
    writeFileSync(b, await bundle(vs[3].commit, objs));
    git(d, 'init', '-q', 'x');
    // git exits non-zero (and execFileSync throws) on a bundle it rejects; on success it lists the refs
    expect(git(join(d, 'x'), 'bundle', 'verify', b)).toContain(`${vs[3].commit} refs/heads/main`);
    git(d, 'clone', '-q', b, 'memory');
    const m = join(d, 'memory');
    expect(git(m, 'log', '--format=%s', 'main').split('\n')).toEqual([...vs].reverse().map(v => v.subject));
    expect(git(m, 'rev-parse', 'HEAD')).toBe(vs[3].commit);
    expect(readFileSync(join(m, FILE), 'utf8')).toBe(n1 + n2);
    expect(readFileSync(join(m, '.gitignore'), 'utf8')).toBe(IGNORE);
    expect(readFileSync(join(m, 'SOURCE'), 'utf8')).toBe(SOURCE);
    expect(git(m, 'fsck', '--strict')).toBe('');
  });
  // gitmind itself (vendored in bankML: sAGI/gitmind, or BROWSEML_GITMIND=<dir holding the gitmind package>) watches the clone
  const gm = process.env.BROWSEML_GITMIND || join(process.env.HOME || '', 'bML/bankml/sAGI');
  const hasGitmind = hasGit && (() => { try { execFileSync('python3', ['-c', 'import gitmind'], { env: { ...process.env, PYTHONPATH: gm } }); return true; } catch { return false; } })();
  it.skipIf(!hasGitmind)('gitmind snapshots the clone: its ledger names the head', async () => {
    const { vs, objs } = await history();
    const d = mkdtempSync(join(tmpdir(), 'bml-gm-'));
    writeFileSync(join(d, 'm.bundle'), await bundle(vs[3].commit, objs));
    git(d, 'clone', '-q', join(d, 'm.bundle'), 'memory');
    const m = join(d, 'memory');
    const out = JSON.parse(execFileSync('python3', ['-m', 'gitmind', 'snapshot'], { cwd: m, encoding: 'utf8', env: { ...process.env, PYTHONPATH: gm } }));
    expect(out.head).toBe(vs[3].commit);
    expect(out.dirty).toBe(false);  // .gitmind/ is ignored by the .gitignore every version carries
    const led = readFileSync(join(m, '.gitmind', 'ledger.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
    expect(led[led.length - 1]).toMatchObject({ kind: 'snapshot', head: vs[3].commit, branch: 'main' });
  });
});
