// Proof harness for the hands-free CONVERSATION LOOP (no mic, no DOM, no network).
// Drives the real HandsFreeLoop controller — the exact object the VoiceOrb wires the
// VAD + <audio> into — through 3 full turns with a FAKE vad and a MANUAL clock, and
// prints the log sequence. This proves the piece that was failing at runtime: after
// "Marcus audio ended", the mic auto-reopens, every turn, only AFTER the cooldown.
//
// What this does NOT prove (needs a real microphone — the live test):
//   • the browser's Silero VAD actually detecting your speech (onSpeechStart/End)
//   • vad.start() actually resuming mic capture in the browser
// Those emit the SAME log lines live, so the browser console shows where it breaks.
// Run: npx tsx scripts/test-handsfree-loop.ts
import { HandsFreeLoop, REARM_COOLDOWN_MS } from '../src/lib/voice/handsFree';

let passed = 0, failed = 0;
function assert(name: string, cond: boolean, detail = '') {
  if (cond) { passed++; console.log('  ✅ ' + name); }
  else { failed++; console.log('  ❌ ' + name + (detail ? ' — ' + detail : '')); }
}

// ── fakes ──
const logs: string[] = [];
const vadCalls: string[] = [];
let busy = false, muted = false, ended = false;
const fakeVad = {
  start: async () => { vadCalls.push('start'); },
  pause: async () => { vadCalls.push('pause'); },
};
// Manual clock: the loop hands us the reopen callback; we fire it only when we tick().
let pendingReopen: (() => void) | null = null;
const tick = () => { const cb = pendingReopen; pendingReopen = null; if (cb) cb(); };

const loop = new HandsFreeLoop({
  getVad: () => fakeVad,
  isBusy: () => busy,
  isMuted: () => muted,
  isEnded: () => ended,
  log: (m) => { logs.push(m); },
  scheduleAfterCooldown: (cb) => { pendingReopen = cb; return () => { pendingReopen = null; }; },
});

const starts = () => vadCalls.filter((c) => c === 'start').length;
const pauses = () => vadCalls.filter((c) => c === 'pause').length;
const count = (needle: string) => logs.filter((l) => l === needle).length;

async function turn(): Promise<{ startsBeforeTick: number; startsAfterTick: number }> {
  // 1. user speaks
  loop.speechDetected();
  // 2. end of speech → processing (Marcus busy) → pause mic → send
  busy = true;
  loop.pauseForMarcus();
  loop.speechEnded();
  await loop.whenIdle();
  // 3. Marcus responds and plays
  loop.sent();
  loop.marcusPlaying();
  // 4. Marcus audio ends → no longer busy → reopen is SCHEDULED (not fired yet)
  busy = false;
  loop.marcusEnded();
  const startsBeforeTick = starts();
  // 5. cooldown elapses → reopen fires
  tick();
  await loop.whenIdle();
  const startsAfterTick = starts();
  return { startsBeforeTick, startsAfterTick };
}

(async () => {
  console.log('\n── Hands-free loop — 3 continuous turns, one initial start, no taps ──\n');

  // initial listen (entering the voice room; the one gesture is choosing voice mode)
  await fakeVad.start();
  loop.listeningStarted();

  const handoff: boolean[] = [];
  for (let i = 0; i < 3; i++) {
    const { startsBeforeTick, startsAfterTick } = await turn();
    // clean-handoff guard: NO reopen before the cooldown, exactly one after.
    handoff.push(startsAfterTick === startsBeforeTick + 1);
  }

  console.log('  ---- captured console sequence (same lines print live in the browser) ----');
  logs.forEach((l, i) => console.log(String(i + 1).padStart(3, ' ') + '  [hands-free] ' + l));
  console.log('  --------------------------------------------------------------------------\n');

  assert('the mic auto-reopens once per turn (3 turns)', count('auto-reopening mic') === 3, String(count('auto-reopening mic')));
  assert('"listening started" fires 4× (1 initial + 3 reopens)', count('listening started') === 4, String(count('listening started')));
  assert('vad.start() called 4× (initial + 3 reopens)', starts() === 4, String(starts()));
  assert('vad.pause() called 3× (once per Marcus turn)', pauses() === 3, String(pauses()));
  assert('clean handoff: reopen fires ONLY after the cooldown, every turn', handoff.every(Boolean), JSON.stringify(handoff));
  assert('cooldown is the configured handoff buffer', REARM_COOLDOWN_MS >= 200 && REARM_COOLDOWN_MS <= 1000, String(REARM_COOLDOWN_MS));
  // ordering: each 'Marcus audio ended' precedes the matching 'auto-reopening mic'
  const endedIdx = logs.findIndex((l) => l === 'Marcus audio ended');
  const reopenIdx = logs.findIndex((l) => l === 'auto-reopening mic');
  assert('order: "Marcus audio ended" precedes "auto-reopening mic"', endedIdx >= 0 && reopenIdx > endedIdx, `${endedIdx} < ${reopenIdx}`);

  console.log('\n── SUMMARY ──');
  console.log('  passed: ' + passed + '   failed: ' + failed);
  if (failed > 0) { console.log('  ❌ SUITE FAILED'); process.exit(1); } else console.log('  ✅ SUITE PASSED');
})();
