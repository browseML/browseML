// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import { recogniseGpu } from '../gpu';

const gl = (renderer: string, vendor = '') => ({ webgl: { vendor, renderer, version: 'WebGL 2.0' } });
describe('the graphics card, recognised from what the browser reports', () => {
  it('this laptop: AMD Radeon Vega 3, integrated', () => {
    const k = recogniseGpu({ ...gl('AMD, AMD Radeon Vega 3 Graphics (radeonsi raven2 LLVM 15.0.7), OpenGL 4.6'), adapter: { vendor: 'amd', architecture: 'gcn-5', device: '', description: 'radv: Mesa 23.2.1', fallback: false, features: [], limits: {} } });
    expect(k).toMatchObject({ vendor: 'AMD', kind: 'integrated' });
    expect(k.model).toMatch(/Radeon Vega 3/);
  });
  it('NVIDIA GeForce on Windows (ANGLE / Direct3D), discrete', () => {
    const k = recogniseGpu(gl('ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 (0x00002503) Direct3D11 vs_5_0 ps_5_0, D3D11)', 'Google Inc. (NVIDIA)'));
    expect(k).toMatchObject({ vendor: 'NVIDIA', kind: 'discrete', handheld: false });
    expect(k.model).toBe('GeForce RTX 3060');
  });
  it('AMD Radeon RX 6800 XT, discrete; Radeon 780M, integrated', () => {
    expect(recogniseGpu(gl('ANGLE (AMD, AMD Radeon RX 6800 XT (0x000073BF) Direct3D11 vs_5_0 ps_5_0, D3D11)'))).toMatchObject({ vendor: 'AMD', kind: 'discrete' });
    expect(recogniseGpu(gl('ANGLE (AMD, AMD Radeon 780M Graphics (0x000015BF) Direct3D11 vs_5_0 ps_5_0, D3D11)'))).toMatchObject({ vendor: 'AMD', kind: 'integrated' });
  });
  it('Intel UHD integrated, Intel Arc A770 discrete', () => {
    expect(recogniseGpu(gl('ANGLE (Intel, Intel(R) UHD Graphics 620 (0x00005917) Direct3D11 vs_5_0 ps_5_0, D3D11)'))).toMatchObject({ vendor: 'Intel', kind: 'integrated' });
    expect(recogniseGpu(gl('ANGLE (Intel, Intel(R) Arc(TM) A770 Graphics (0x000056A0) Direct3D11 vs_5_0 ps_5_0, D3D11)'))).toMatchObject({ vendor: 'Intel', kind: 'discrete' });
  });
  it('Apple and phones are integrated', () => {
    expect(recogniseGpu(gl('Apple M2', 'Apple Inc.'))).toMatchObject({ vendor: 'Apple', kind: 'integrated' });
    expect(recogniseGpu(gl('Apple M2', 'Apple Inc.')).handheld).toBe(false);
    expect(recogniseGpu(gl('Apple GPU', 'Apple Inc.'))).toMatchObject({ vendor: 'Apple', handheld: true });
    expect(recogniseGpu(gl('Adreno (TM) 740', 'Qualcomm'))).toMatchObject({ vendor: 'Qualcomm', kind: 'integrated', handheld: true });
    expect(recogniseGpu(gl('Mali-G78 MC24', 'ARM'))).toMatchObject({ vendor: 'ARM', kind: 'integrated', handheld: true });
  });
  it('software adapters are named as such, and never used', () => {
    expect(recogniseGpu(gl('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)', 'Google Inc. (Google)'))).toMatchObject({ vendor: 'software', kind: 'software' });
    expect(recogniseGpu(gl('llvmpipe (LLVM 15.0.7, 256 bits)'))).toMatchObject({ kind: 'software' });
  });
  it('a hidden model is unknown, not guessed', () => {
    expect(recogniseGpu({})).toMatchObject({ vendor: 'unknown', model: null, kind: 'unknown' });
  });
});
