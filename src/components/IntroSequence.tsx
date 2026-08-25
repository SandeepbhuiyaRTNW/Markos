'use client';

import { useEffect, useRef, useState } from 'react';
import ShaderBackground from '@/components/ShaderBackground';
import Orb3D from '@/components/Orb3D';

// ~17s intro that plays ONCE before the landing page (flag persisted). Phase 1: fragments of
// what men don't say fade in fast at random spots until the screen is crowded (anxious).
// Phase 2: they clear ONE AT A TIME, slower than they arrived (relief). Phase 3: the orb
// rises while the last fragments still fade — arriving to take them. Phase 4: it settles up
// and the page fades in beneath. Skippable on click / scroll / key. Reduced-motion => skip.
const SEEN_KEY = 'marcus_intro_seen';

// Ordinary, small, unspoken lines — no crisis language, nothing about self-harm.
const FRAGMENTS = [
  'I said I was fine', 'Nobody asks how I’m doing', 'Third time this year he’s asked',
  'My dad never said it back', 'I don’t know how to say no', 'Four years since I’ve seen them',
  'I keep everyone else afloat', 'I can’t remember the last time I cried', 'I smile so they don’t worry',
  'Everyone leans on me', 'I don’t have anyone to call', 'I pretend I slept fine',
  'I laughed it off again', 'I never finished telling him', 'I say it’s nothing',
  'I carry it home', 'I don’t want to be a burden', 'I haven’t told my wife',
  'I answer “busy” every time', 'I lie when they ask',
];

// Timing (ms). Fill is FAST, clear is SLOWER — the asymmetry is the point.
const FILL = 340;         // interval between arrivals
const CLEAR_START = 7400;
const CLEAR = 480;        // interval between departures (> FILL)
const ORB_IN = 12800;     // orb rises while last fragments still fade
const ORB_UP = 15800;     // settles upward
const DONE = 17400;       // ~17.4s total -> page

type Frag = { id: number; text: string; x: number; y: number; size: number; state: 'in' | 'out' };

function shuffled<T>(a: T[]): T[] {
  const r = a.slice();
  // No Math.random ban here (client runtime) — vary order per visit.
  for (let i = r.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [r[i], r[j]] = [r[j], r[i]]; }
  return r;
}

export default function IntroSequence({ onDone }: { onDone: () => void }) {
  const [frags, setFrags] = useState<Frag[]>([]);
  const [orb, setOrb] = useState(false);
  const [orbUp, setOrbUp] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const finished = useRef(false);

  const finish = () => {
    if (finished.current) return;
    finished.current = true;
    timers.current.forEach(clearTimeout);
    try { localStorage.setItem(SEEN_KEY, '1'); } catch { /* ignore */ }
    onDone();
  };

  useEffect(() => {
    // Reduced-motion, or already seen: straight to the page.
    let seen = false;
    try { seen = localStorage.getItem(SEEN_KEY) === '1'; } catch { /* ignore */ }
    let reduce = false;
    try { reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { /* ignore */ }
    if (seen || reduce) { finish(); return; }

    const order = shuffled(FRAGMENTS);
    const T = (fn: () => void, ms: number) => { timers.current.push(setTimeout(fn, ms)); };

    // Phase 1 — fill fast at random positions/sizes.
    order.forEach((text, i) => {
      T(() => {
        const x = 8 + Math.random() * 78;      // %
        const y = 12 + Math.random() * 68;
        const size = 14 + Math.random() * 16;  // px
        setFrags((f) => [...f, { id: i, text, x, y, size, state: 'in' }]);
      }, i * FILL);
    });

    // Phase 2 — clear one at a time, slower.
    order.forEach((_, i) => {
      T(() => setFrags((f) => f.map((fr) => (fr.id === i ? { ...fr, state: 'out' } : fr))), CLEAR_START + i * CLEAR);
      T(() => setFrags((f) => f.filter((fr) => fr.id !== i)), CLEAR_START + i * CLEAR + 1100);
    });

    // Phase 3/4 — orb rises, then settles, then the page.
    T(() => setOrb(true), ORB_IN);
    T(() => setOrbUp(true), ORB_UP);
    T(finish, DONE);

    return () => timers.current.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Skip on any intent.
  useEffect(() => {
    const skip = () => finish();
    window.addEventListener('click', skip);
    window.addEventListener('keydown', skip);
    window.addEventListener('wheel', skip, { passive: true });
    window.addEventListener('touchstart', skip, { passive: true });
    return () => {
      window.removeEventListener('click', skip);
      window.removeEventListener('keydown', skip);
      window.removeEventListener('wheel', skip);
      window.removeEventListener('touchstart', skip);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="fixed inset-0 z-50 overflow-hidden" style={{ background: '#faf9f6' }}>
      <ShaderBackground contained state="idle" register={0} />
      <div className="relative z-10 h-full w-full">
        {frags.map((fr) => (
          <span
            key={fr.id}
            style={{
              position: 'absolute', left: `${fr.x}%`, top: `${fr.y}%`, transform: 'translate(-50%,-50%)',
              fontSize: fr.size, lineHeight: 1.4, color: '#3d352e', whiteSpace: 'nowrap',
              opacity: fr.state === 'in' ? 0.9 : 0,
              transition: fr.state === 'in' ? 'opacity 0.7s ease' : 'opacity 1.1s ease',
            }}
          >
            {fr.text}
          </span>
        ))}
        {orb && (
          <div
            style={{
              position: 'absolute', left: '50%', top: orbUp ? '38%' : '52%', transform: 'translate(-50%,-50%)',
              opacity: 1, transition: 'top 2.2s cubic-bezier(.22,.61,.36,1), opacity 1.6s ease',
            }}
          >
            <Orb3D size={200} />
          </div>
        )}
        <button onClick={finish} className="absolute bottom-6 right-8 transition-opacity hover:opacity-70" style={{ fontSize: 12, letterSpacing: '0.2em', textTransform: 'uppercase', color: '#6b6259' }}>Skip</button>
      </div>
    </div>
  );
}
