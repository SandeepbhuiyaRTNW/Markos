'use client';

import { useEffect, useRef, useState } from 'react';
import StoicField from '@/components/StoicField';
import Orb3D from '@/components/Orb3D';

// The intro: ~100 unspoken lines pack the screen solid one at a time (accelerating), then
// every one falls INTO a growing point of light (the orb), nearest-to-centre first. Ground is
// Paper Shaders on a Stoic palette (Marcus on campaign) + a vignette. Plays ONCE (persisted),
// skippable, and prefers-reduced-motion / no-WebGL bypass straight to the page.
const SEEN_KEY = 'marcus_intro_seen';

// ~100 ordinary, small lines — no crisis language, nothing dramatic, nothing about self-harm.
const LINES = [
  'I said I was fine.', 'Nobody asks how I’m doing.', 'I don’t answer the phone.', 'Third time this year he’s asked.',
  'My dad never said it back.', 'I don’t know how to say no.', 'Four years since I’ve seen them.', 'I keep everyone else afloat.',
  'I can’t remember the last time I cried.', 'I smile so they don’t worry.', 'Everyone leans on me.', 'I don’t have anyone to call.',
  'I pretend I slept fine.', 'I laughed it off again.', 'I never finished telling him.', 'I say it’s nothing.',
  'I carry it home.', 'I don’t want to be a burden.', 'I haven’t told my wife.', 'I answer “busy” every time.',
  'I lie when they ask.', 'I stopped reaching out.', 'I read the text and didn’t reply.', 'I keep it in the car.',
  'I work through the weekend.', 'I don’t remember the last day off.', 'I said yes when I meant no.', 'I ate lunch at my desk again.',
  'Nobody knows I got passed over.', 'I told them the raise was fine.', 'I haven’t called my brother.', 'I forgot my own birthday.',
  'I let the calls go to voicemail.', 'I don’t sleep much anymore.', 'I keep the light on.', 'I check on everyone but me.',
  'I fixed it before they noticed.', 'I never learned to ask.', 'I apologize when it’s not my fault.', 'I’m the strong one.',
  'I hold it until the drive home.', 'I said I’d handle it.', 'I always handle it.', 'I don’t cry at funerals.',
  'I did the whole thing alone.', 'I told him I was proud, once.', 'I never heard it back.', 'I keep score in my head.',
  'I let it slide again.', 'I don’t talk about my mom.', 'I moved and told no one.', 'I skipped the reunion.',
  'I said I couldn’t make it.', 'I could have made it.', 'I don’t know my neighbors.', 'I eat dinner standing up.',
  'I haven’t seen a doctor in years.', 'I told her I’m okay.', 'I’m not okay, exactly.', 'I keep meaning to call.',
  'I let the plant die.', 'I cancel more than I show.', 'I say next week every week.', 'I don’t remember the good ones.',
  'I remember every mistake.', 'I reread the argument.', 'I didn’t say what I meant.', 'I never do.',
  'I keep my phone face down.', 'I don’t post anymore.', 'I watch other people’s lives.', 'I turned off the group chat.',
  'I said congrats and meant it, mostly.', 'I don’t ask for help.', 'I wouldn’t know how.', 'I finished his sentences for years.',
  'Now there’s no one to finish mine.', 'I keep the receipts.', 'I don’t throw his coat out.', 'I still set two cups.',
  'I drive the long way.', 'I don’t go in that room.', 'I told the kids he’s fine.', 'I haven’t told them yet.',
  'I practice it in the mirror.', 'I never say it out loud.', 'I hum so it’s not quiet.', 'I keep busy so I don’t think.',
  'I think anyway.', 'I said I forgave him.', 'I’m still working on it.', 'I don’t know when it got heavy.',
  'I just carry it.', 'I put it down for no one.', 'I say I’m tired.', 'It’s not tired.',
  'I don’t have the words.', 'I’ve never had the words.', 'I’d tell someone if they asked right.', 'Nobody asks right.',
];

// Words are dark on the shared Stoic field — #2b2721 vs its darkest tone (oxblood) = 5.36:1.
const WORD = '#2b2721';

// Arrival: exponential gap collapse. Collapse: nearest-first, ease-IN (gravity).
const gap = (i: number) => 28 + 820 * Math.exp(-i / 9);
const HOLD = 350;        // pause after the last line lands
const ORB_GROW = 6500;   // point of light -> full size
const CASCADE = 46;      // ms between words falling in
const SETTLE = 1400;     // orb settles up, then the page

type Frag = { id: number; text: string; cx: number; cy: number; size: number; op: number; dx: number; dy: number; rot: number; arrived: boolean; collapsing: boolean };

function shuffle<T>(a: T[]): T[] { const r = a.slice(); for (let i = r.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [r[i], r[j]] = [r[j], r[i]]; } return r; }

export default function IntroSequence({ onDone }: { onDone: () => void }) {
  const [frags, setFrags] = useState<Frag[]>([]);
  const [orb, setOrb] = useState(false);
  const [orbScale, setOrbScale] = useState(false);
  const [orbUp, setOrbUp] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const finished = useRef(false);
  const [total, setTotal] = useState(0);

  const finish = () => {
    if (finished.current) return;
    finished.current = true;
    timers.current.forEach(clearTimeout);
    try { localStorage.setItem(SEEN_KEY, '1'); } catch { /* ignore */ }
    onDone();
  };

  useEffect(() => {
    let seen = false; try { seen = localStorage.getItem(SEEN_KEY) === '1'; } catch { /* ignore */ }
    let reduce = false; try { reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { /* ignore */ }
    if (seen || reduce) { finish(); return; }

    const vw = window.innerWidth, vh = window.innerHeight;
    const cx0 = vw / 2, cy0 = vh / 2;
    const cols = 7;
    // Count from the viewport so the screen packs SOLID (clamped so total stays under ~20s).
    const rows = Math.max(14, Math.min(17, Math.round(vh / 46)));
    const N = cols * rows;

    // Grid cells, then SHUFFLE which cell each sequential line lands in (even fill, not a sweep).
    const cells = shuffle(Array.from({ length: N }, (_, i) => i));
    const insetX = vw * 0.04, insetY = vh * 0.07, usableW = vw * 0.92, usableH = vh * 0.86;
    const cellW = usableW / cols, cellH = usableH / rows;

    const built: Frag[] = cells.map((cell, i) => {
      const col = cell % cols, row = Math.floor(cell / cols);
      const cx = insetX + (col + 0.5) * cellW + (Math.random() - 0.5) * cellW * 0.7;
      const cy = insetY + (row + 0.5) * cellH + (Math.random() - 0.5) * cellH * 0.7;
      return {
        id: i, text: LINES[i % LINES.length],
        cx, cy, size: 10.5 + Math.random() * 6, op: 0.4 + Math.random() * 0.52,
        dx: cx0 - cx, dy: cy0 - cy, rot: (Math.random() - 0.5) * 50,
        arrived: false, collapsing: false,
      };
    });
    setFrags(built);

    const T = (fn: () => void, ms: number) => { timers.current.push(setTimeout(fn, ms)); };

    // ARRIVAL — cumulative exponential gap.
    let acc = 0;
    for (let i = 0; i < N; i++) {
      const at = acc;
      T(() => setFrags((f) => f.map((fr) => (fr.id === i ? { ...fr, arrived: true } : fr))), at);
      acc += gap(i);
    }
    const lastArrival = acc;

    // COLLAPSE — nearest-to-centre first, cascading outward.
    const order = built.slice().sort((a, b) => Math.hypot(a.dx, a.dy) - Math.hypot(b.dx, b.dy));
    const collapseStart = lastArrival + HOLD;
    order.forEach((fr, rank) => {
      T(() => setFrags((f) => f.map((x) => (x.id === fr.id ? { ...x, collapsing: true } : x))), collapseStart + rank * CASCADE);
    });

    // ORB — point of light grows as the words arrive, then settles up; page follows.
    T(() => setOrb(true), collapseStart);
    T(() => setOrbScale(true), collapseStart + 60);
    T(() => setOrbUp(true), collapseStart + ORB_GROW);
    const done = collapseStart + ORB_GROW + SETTLE;
    T(finish, done);
    setTotal(Math.round(done));
    // eslint-disable-next-line no-console
    console.log(`[intro] ${N} lines, total ≈ ${(done / 1000).toFixed(1)}s`);
    return () => timers.current.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const skip = () => finish();
    window.addEventListener('click', skip);
    window.addEventListener('keydown', skip);
    window.addEventListener('wheel', skip, { passive: true });
    window.addEventListener('touchstart', skip, { passive: true });
    return () => {
      window.removeEventListener('click', skip); window.removeEventListener('keydown', skip);
      window.removeEventListener('wheel', skip); window.removeEventListener('touchstart', skip);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="fixed inset-0 z-50 overflow-hidden" style={{ background: '#cec5b2' }} data-total={total}>
      <StoicField />

      <div className="relative z-10 h-full w-full">
        {frags.map((f) => (
          <div key={f.id} style={{ position: 'absolute', left: f.cx, top: f.cy, transform: 'translate(-50%,-50%)' }}>
            <span style={{
              display: 'inline-block', fontSize: f.size, lineHeight: 1.3, color: WORD, whiteSpace: 'nowrap', willChange: 'transform,opacity',
              opacity: f.collapsing ? 0 : (f.arrived ? f.op : 0),
              transform: f.collapsing ? `translate(${f.dx}px,${f.dy}px) scale(0.09) rotate(${f.rot}deg)` : 'none',
              transition: f.collapsing
                ? 'transform 1.15s cubic-bezier(.5,0,.75,0), opacity 1s cubic-bezier(.5,0,.75,0)'
                : 'opacity 0.5s ease',
            }}>{f.text}</span>
          </div>
        ))}
        {orb && (
          <div style={{ position: 'absolute', left: '50%', top: orbUp ? '38%' : '50%', transform: 'translate(-50%,-50%)', transition: 'top 2s cubic-bezier(.22,.61,.36,1)', zIndex: 5 }}>
            <div style={{ transform: orbScale ? 'scale(1)' : 'scale(0.03)', transition: `transform ${ORB_GROW}ms cubic-bezier(.34,.02,.2,1)`, filter: 'drop-shadow(0 0 26px rgba(244,226,188,0.55))' }}>
              <Orb3D size={200} />
            </div>
          </div>
        )}
        <button onClick={finish} className="absolute bottom-6 right-8 transition-opacity hover:opacity-70" style={{ fontSize: 12, letterSpacing: '0.2em', textTransform: 'uppercase', color: '#4a4436' }}>Skip</button>
      </div>
    </div>
  );
}
