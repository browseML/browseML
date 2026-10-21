// SPDX-License-Identifier: MIT
// SHARE, the decisions without the page: how much of this browser's engine time the visitor gives a host, and when
// sharing waits. Pure functions over plain values, so they are tested without an engine (share.test.ts); share.tsx
// runs the loop and draws the panel.
//
// The share is a duty cycle the CLIENT keeps: after a job that held the engine for t ms, the engine rests
// t·(100−p)/p ms before the next pull, so over time the host gets p % of the engine's time and the visitor the rest.
// The visitor's own question always goes first (the engine's lane), and every pause has a reason the panel shows.
//
// distributed.mind (the host's docs/DISTRIBUTED_MIND.md): every job names its KIND and a one-line PURPOSE, so the
// visitor sees what the host is thinking about and chooses which kinds of thought this browser takes. A host's
// catalogue arrives with join; `kinds: null` means "every kind the host offers".
import type { Pressure } from '../monitor';

export type PauseAt = 'fair' | 'serious' | 'critical' | 'never';
export interface ShareSettings {
  /** percent of the engine's time given to the host, 5..100 */
  pct: number;
  /** share only while the device charges (or has no battery) */
  onlyCharging: boolean;
  /** pause when the CPU pressure reaches this level */
  pauseAt: PauseAt;
  /** pause while this tab is hidden */
  pauseHidden: boolean;
  /** the largest job taken, in tokens written */
  maxJobTokens: number;
  /** engine minutes given per day; 0 = no daily cap */
  dailyMinutes: number;
  /** the kinds of thought taken (the host's catalogue ids); null = every kind the host offers */
  kinds: string[] | null;
}

/** One kind of thought as the host describes it (join's `kinds`). */
export interface KindInfo { label: string; about: string; unverified_ok?: boolean }

/** The host's catalogue as sent: anything malformed is dropped, so the panel only shows what it can name. */
export function parseKinds(raw: unknown): Record<string, KindInfo> {
  const out: Record<string, KindInfo> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
    const o = v as Record<string, unknown> | null;
    if (/^[a-z][a-z0-9_-]{0,31}$/.test(id) && o && typeof o.label === 'string' && typeof o.about === 'string')
      out[id] = { label: o.label.slice(0, 40), about: o.about.slice(0, 240), unverified_ok: o.unverified_ok === true };
  }
  return out;
}

/** The kinds to send the host: the visitor's choice within the catalogue, or the whole catalogue. */
export function kindsTaken(s: ShareSettings, catalogue: Record<string, KindInfo>): string[] {
  const all = Object.keys(catalogue);
  if (!s.kinds) return all;
  const picked = s.kinds.filter(k => all.includes(k));
  return picked.length ? picked : all;
}

/** Flip one kind; turning the last one off is refused (STOP is how to take nothing). */
export function toggleKind(s: ShareSettings, catalogue: Record<string, KindInfo>, id: string): string[] {
  const cur = kindsTaken(s, catalogue);
  const next = cur.includes(id) ? cur.filter(k => k !== id) : [...cur, id];
  return next.length ? next : cur;
}

export const PCT_MIN = 5;
export const JOB_TOKEN_CHOICES = [128, 256, 512, 1024] as const;
export const DAILY_CHOICES = [10, 30, 60, 120, 0] as const;
export const PAUSE_CHOICES: readonly PauseAt[] = ['fair', 'serious', 'critical', 'never'];
export const DEFAULT_SHARE: ShareSettings = { pct: 25, onlyCharging: true, pauseAt: 'serious', pauseHidden: false, maxJobTokens: 256, dailyMinutes: 30,
  kinds: null };

const clampPct = (n: number) => Math.max(PCT_MIN, Math.min(100, Math.round(n / 5) * 5));

/** Settings read back from storage: anything malformed falls back to the default, field by field. */
export function parseShare(raw: unknown): ShareSettings {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>, d = DEFAULT_SHARE;
  return {
    pct: typeof o.pct === 'number' && isFinite(o.pct) ? clampPct(o.pct) : d.pct,
    onlyCharging: typeof o.onlyCharging === 'boolean' ? o.onlyCharging : d.onlyCharging,
    pauseAt: PAUSE_CHOICES.includes(o.pauseAt as PauseAt) ? (o.pauseAt as PauseAt) : d.pauseAt,
    pauseHidden: typeof o.pauseHidden === 'boolean' ? o.pauseHidden : d.pauseHidden,
    maxJobTokens: (JOB_TOKEN_CHOICES as readonly number[]).includes(o.maxJobTokens as number) ? (o.maxJobTokens as number) : d.maxJobTokens,
    dailyMinutes: (DAILY_CHOICES as readonly number[]).includes(o.dailyMinutes as number) ? (o.dailyMinutes as number) : d.dailyMinutes,
    kinds: Array.isArray(o.kinds) && o.kinds.every(k => typeof k === 'string') && o.kinds.length
      ? [...new Set(o.kinds as string[])].slice(0, 16) : d.kinds,
  };
}

/** How long the engine rests after a job that held it `engineMs`, so the host gets `pct` % over time. */
export function restAfter(engineMs: number, pct: number): number {
  const p = clampPct(pct);
  return p >= 100 ? 0 : Math.round(Math.max(0, engineMs) * (100 - p) / p);
}

const PRESSURE_RANK: Record<Pressure, number> = { nominal: 0, fair: 1, serious: 2, critical: 3 };

/** What the page sees right now, for the pause decision. */
export interface ShareConditions {
  charging: boolean | null;        // null: no battery reading (a desktop): never a reason to pause
  pressure: Pressure | null;
  hidden: boolean;
  visitorBusy: boolean;            // the visitor's own question is using the engine
  usedTodayMs: number;
}

/** Why sharing waits now, or null to go on. The order is the order the panel names them. */
export function pauseReason(c: ShareConditions, s: ShareSettings): string | null {
  if (c.visitorBusy) return 'your own question first';
  if (s.onlyCharging && c.charging === false) return 'on battery (share only while charging)';
  if (s.pauseAt !== 'never' && c.pressure && PRESSURE_RANK[c.pressure] >= PRESSURE_RANK[s.pauseAt]) return `CPU pressure ${c.pressure}`;
  if (s.pauseHidden && c.hidden) return 'tab hidden';
  if (s.dailyMinutes > 0 && c.usedTodayMs >= s.dailyMinutes * 60_000) return `today's ${s.dailyMinutes} min given`;
  return null;
}

/** Today's given engine time, kept per local day: a new day starts at zero. */
export interface DayBudget { day: string; ms: number }
export const today = (now = new Date()) => `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
export function addToDay(b: DayBudget | null, ms: number, day = today()): DayBudget {
  return { day, ms: (b && b.day === day ? b.ms : 0) + Math.max(0, ms) };
}
export const usedToday = (b: DayBudget | null, day = today()) => (b && b.day === day ? b.ms : 0);

/** A host's refusal that retrying cannot fix (barred after a failed audit, a refused join): sharing stops and says why. */
export const isFinal = (r: { barred?: boolean } | null | undefined) => !!r?.barred;

/** One thought this browser gave, for the panel's list (kept for this visit only, never sent anywhere). */
export interface Thought { at: number; kind: string; purpose: string; tokens: number; ms: number; verdict: 'accepted' | 'held' | 'refused' | 'cancelled' }
export const THOUGHTS_KEPT = 12;
export const addThought = (list: Thought[], t: Thought) => [t, ...list].slice(0, THOUGHTS_KEPT);

/** The host's public pool view (dmind's /insight/sharedcpu), the fields the panel shows; anything malformed is dropped. */
export interface PoolView { contributors: number; available: number; queued: number; coreSeconds: number;
  top: { rank: number; wallet: string; core_seconds: number; jobs: number; trusted: boolean }[] }
export function parsePool(raw: unknown): PoolView | null {
  const o = raw as Record<string, unknown> | null;
  if (!o || typeof o !== 'object' || typeof o.contributors !== 'number') return null;
  const n = (v: unknown) => (typeof v === 'number' && isFinite(v) ? v : 0);
  const top = (Array.isArray(o.top) ? o.top : []).filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
    .slice(0, 5).map(r => ({ rank: n(r.rank), wallet: String(r.wallet ?? '').slice(0, 16), core_seconds: n(r.core_seconds), jobs: n(r.jobs),
      trusted: r.trusted === true }));
  return { contributors: n(o.contributors), available: n(o.available), queued: n(o.queued),
    coreSeconds: n((o.totals as Record<string, unknown> | undefined)?.core_seconds), top };
}
