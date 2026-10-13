// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import { asModel, classify, fromFileList, scan } from '../folders';

const PIN = { bytes: 248_302_272, sha256: '3d7c6c90dd98717a203adb22d5eacd2581850e40aa5327e144b97766cae5f7e3' };
const MB = 1 << 20;

describe('what a file on this computer is', () => {
  it('a .gguf, or a blob named by its sha256 (Ollama, the Hugging Face cache); small files are not models', () => {
    expect(asModel('Bonsai-1.7B-Q1_0.gguf', 248e6)).toEqual({ kind: 'gguf' });
    expect(asModel(`sha256-${PIN.sha256}`, 248e6)).toEqual({ kind: 'blob', named: PIN.sha256 });
    expect(asModel(PIN.sha256.toUpperCase(), 248e6)).toEqual({ kind: 'blob', named: PIN.sha256 });
    expect(asModel('notes.txt', 248e6)).toBeNull();
    expect(asModel('tiny.gguf', 1 * MB)).toBeNull();
  });
  it('which browseML can run: named by the pin, the pinned size, or another model', () => {
    expect(classify({ size: PIN.bytes, named: PIN.sha256 }, PIN)).toBe('named');
    expect(classify({ size: PIN.bytes }, PIN)).toBe('size');
    expect(classify({ size: PIN.bytes, named: '00'.repeat(32) }, PIN)).toBe('size');      // the right size, another name: hashed when used
    expect(classify({ size: 1_160_000_000, named: PIN.sha256 }, PIN)).toBe('other');       // a name that lies about its size
  });
  it("a folder input's files, with their paths", () => {
    const f = Object.assign(new File([new Uint8Array(1)], 'Bonsai-1.7B-Q1_0.gguf'), { webkitRelativePath: 'models/Bonsai-1.7B-Q1_0.gguf' });
    Object.defineProperty(f, 'size', { value: PIN.bytes });
    expect(fromFileList([f])).toMatchObject([{ path: ['models', 'Bonsai-1.7B-Q1_0.gguf'], kind: 'gguf', size: PIN.bytes }]);
  });
});

describe('scanning a granted folder', () => {
  // a folder tree as the File System Access API presents it
  const file = (name: string, size: number) => ({ kind: 'file' as const, name, getFile: async () => ({ size }) as File });
  const dir = (name: string, entries: unknown[]) => ({ kind: 'directory' as const, name, values: async function* () { yield* entries; } });
  it('finds models in nested folders, skips what is not a model and folders like node_modules', async () => {
    const root = dir('home', [
      dir('.ollama', [dir('models', [dir('blobs', [file(`sha256-${PIN.sha256}`, PIN.bytes), file('sha256-' + 'ab'.repeat(32), 1000)])])]),
      dir('bankml', [dir('.models', [file('Bonsai-1.7B-Q1_0.gguf', PIN.bytes), file('Bonsai-8B-Q1_0.gguf', 1_160_000_000)])]),
      dir('node_modules', [file('huge.gguf', PIN.bytes)]),
      file('readme.md', 2000),
    ]);
    const found = await scan(root as unknown as FileSystemDirectoryHandle);
    expect(found.map(f => f.path.join('/')).sort()).toEqual([
      '.ollama/models/blobs/sha256-' + PIN.sha256, 'bankml/.models/Bonsai-1.7B-Q1_0.gguf', 'bankml/.models/Bonsai-8B-Q1_0.gguf',
    ]);
    expect(found.map(f => classify(f, PIN)).sort()).toEqual(['named', 'other', 'size']);
  });
  it('stops at its depth and entry limits', async () => {
    let d: unknown = file('deep.gguf', PIN.bytes);
    for (let i = 0; i < 10; i++) d = dir(`d${i}`, [d]);
    expect(await scan(d as FileSystemDirectoryHandle, { depth: 3 })).toEqual([]);
  });
});
