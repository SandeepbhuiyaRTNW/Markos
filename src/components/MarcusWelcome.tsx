'use client';

import { useEffect, useRef, useState } from 'react';
import Orb3D from './Orb3D';
import { MARCUS_WELCOME } from './welcome-copy';

const HEARD_KEY = 'marcus_welcome_heard';

/** Device speech for the fixed welcome only; never owns the microphone or conversation audio. */
export default function MarcusWelcome({ active = true, onComplete, preview = false }: { active?: boolean; onComplete?: () => void; preview?: boolean }) {
  const [status, setStatus] = useState<'quiet' | 'playing' | 'blocked' | 'unavailable'>('quiet');
  const speaking = useRef(false);
  const boundary = useRef(0);
  const complete = useRef(onComplete);
  const play = useRef<() => void>(() => {});
  const stop = useRef<() => void>(() => {});
  useEffect(() => { complete.current = onComplete; }, [onComplete]);

  useEffect(() => {
    if (!active) return;
    let heard = false;
    try { heard = !preview && sessionStorage.getItem(HEARD_KEY) === '1'; } catch { /* private browsing */ }
    if (heard) { complete.current?.(); return; }
    let disposed = false, owned = false;
    let utterance: SpeechSynthesisUtterance | undefined;
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    const synth = window.speechSynthesis;
    const remember = () => { if (!preview) try { sessionStorage.setItem(HEARD_KEY, '1'); } catch { /* private browsing */ } };
    const detach = () => {
      if (utterance) utterance.onstart = utterance.onend = utterance.onerror = utterance.onboundary = null;
      clearTimeout(watchdog);
    };
    const cancel = () => {
      detach();
      if (owned) synth?.cancel();
      owned = false; speaking.current = false;
    };
    const start = () => {
      if (disposed) return;
      if (!synth || typeof SpeechSynthesisUtterance === 'undefined') { setStatus('unavailable'); return; }
      // Do not interrupt another utterance that this component does not own.
      if (!owned && (synth.speaking || synth.pending)) { setStatus('blocked'); return; }
      cancel();
      utterance = new SpeechSynthesisUtterance(MARCUS_WELCOME);
      const english = synth.getVoices().filter(voice => /^en[-_]/i.test(voice.lang));
      utterance.voice = english.find(voice => /Daniel|Arthur|Alex|Google UK English Male/i.test(voice.name))
        || english.find(voice => voice.default) || english[0] || null;
      utterance.lang = utterance.voice?.lang || 'en-GB';
      utterance.rate = .91; utterance.pitch = .95;
      utterance.onstart = () => {
        if (disposed) return;
        clearTimeout(watchdog); speaking.current = true; boundary.current = performance.now(); setStatus('playing');
      };
      // Device speech exposes word events, not PCM: these pulses express cadence, not measured amplitude.
      utterance.onboundary = () => { boundary.current = performance.now(); };
      utterance.onend = () => {
        if (disposed) return;
        clearTimeout(watchdog); owned = false; speaking.current = false; setStatus('quiet'); remember(); complete.current?.();
      };
      utterance.onerror = event => {
        if (disposed) return;
        clearTimeout(watchdog); owned = false; speaking.current = false;
        setStatus(event.error === 'not-allowed' ? 'blocked' : 'unavailable');
      };
      owned = true;
      try { synth.speak(utterance); } catch { owned = false; setStatus('unavailable'); return; }
      // Some browsers silently refuse autoplay instead of dispatching an error.
      watchdog = setTimeout(() => { if (!disposed && !speaking.current) { cancel(); setStatus('blocked'); } }, 1800);
    };
    play.current = start;
    stop.current = () => { cancel(); remember(); setStatus('quiet'); complete.current?.(); };
    const kickoff = setTimeout(start, 0);
    return () => { disposed = true; clearTimeout(kickoff); cancel(); play.current = stop.current = () => {}; };
  }, [active, preview]);

  const getLevel = () => speaking.current ? .18 + .55 * Math.exp(-(performance.now() - boundary.current) / 260) : .12;
  return <div className="flex flex-col items-center text-center" onClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()} onTouchStart={event => event.stopPropagation()}>
    <Orb3D size={244} activity={status === 'playing' ? 'speaking' : 'idle'} getLevel={getLevel} />
    {active && <div style={{ width: 'min(360px, 86vw)', marginTop: 12 }}>
      <p className="font-serif" style={{ color: '#3d352e', fontSize: 19, lineHeight: 1.55 }}>{MARCUS_WELCOME}</p>
      {status === 'blocked' && <button onClick={() => play.current()} className="hover:underline underline-offset-4" style={{ color: '#713b12', marginTop: 12, fontSize: 13 }}>Hear Marcus</button>}
      {status === 'playing' && <button onClick={() => stop.current()} className="hover:underline underline-offset-4" style={{ color: '#6b6259', marginTop: 12, fontSize: 13 }}>Skip introduction</button>}
      {status === 'unavailable' && <p style={{ color: '#6b6259', marginTop: 12, fontSize: 13 }}>Read the welcome above, then continue whenever you’re ready.</p>}
      {status === 'unavailable' && onComplete && <button onClick={onComplete} className="hover:underline underline-offset-4" style={{ color: '#713b12', marginTop: 8, fontSize: 13 }}>Continue</button>}
    </div>}
  </div>;
}
