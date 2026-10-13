// SPDX-License-Identifier: MIT
// Voice input for the field: the browser's own speech recognition (SpeechRecognition / webkitSpeechRecognition),
// off until the visitor presses 🎤, stopped by pressing it again or when speech ends. The page records nothing and
// sends nothing: the words arrive as text in the field. Where the audio goes is the browser's own engine — Chrome
// sends it to Google's speech service, Edge to Microsoft's, Safari to Apple's (on the device where it can) — and the
// button's title says which. Firefox has no speech recognition: no button there.
import { useCallback, useEffect, useRef, useState } from 'react';

type Rec = {
  lang: string; interimResults: boolean; continuous: boolean;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null; onerror: ((e: { error?: string }) => void) | null;
  start(): void; stop(): void; abort(): void;
};
const Ctor = (): (new () => Rec) | null => {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: new () => Rec; webkitSpeechRecognition?: new () => Rec };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
};

/** Whose engine hears the voice in this browser, in a few words (from the user agent, read here). */
export function VOICE_ENGINE(ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''): string {
  if (/Edg\//.test(ua)) return 'Edge sends the audio to Microsoft\'s speech service; this page records and sends nothing.';
  if (/Chrome\//.test(ua) || /CriOS/.test(ua)) return 'Chrome sends the audio to Google\'s speech service; this page records and sends nothing.';
  if (/Safari\//.test(ua)) return 'Safari uses Apple\'s speech recognition (on this device where it can); this page records and sends nothing.';
  return 'Your browser\'s own speech engine hears it; this page records and sends nothing.';
}

export function useVoice(enabled: boolean, onText: (text: string) => void) {
  const [available] = useState(() => enabled && !!Ctor());
  const [listening, setListening] = useState(false);
  const rec = useRef<Rec | null>(null);
  const cb = useRef(onText);
  cb.current = onText;
  const stop = useCallback(() => { rec.current?.stop(); }, []);
  const toggle = useCallback(() => {
    if (rec.current) { rec.current.stop(); return; }
    const C = Ctor();
    if (!C) return;
    const r = new C();
    r.lang = navigator.language || 'en-US';
    r.interimResults = false;
    r.continuous = false;
    r.onresult = e => {
      let t = '';
      for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) t += e.results[i][0].transcript;
      if (t.trim()) cb.current(t.trim());
    };
    r.onend = () => { rec.current = null; setListening(false); };
    r.onerror = () => { rec.current = null; setListening(false); };
    rec.current = r;
    setListening(true);
    try { r.start(); } catch { rec.current = null; setListening(false); }
  }, []);
  useEffect(() => () => rec.current?.abort(), []);
  return { available, listening, toggle, stop };
}
