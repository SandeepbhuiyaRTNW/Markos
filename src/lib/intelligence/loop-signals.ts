/**
 * Cheap, no-LLM loop-signal detection. Runs every turn to (a) help gate the
 * gpt-4o-mini extraction call and (b) give the model candidate signals. These
 * are heuristics, not authoritative — the LLM decides what is actually a loop.
 */

export interface LoopSignal {
  label: string;
  match: string;
}

const LOOP_SIGNAL_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\bi (need|have) to (decide|figure out|choose|deal with|face)\b/i, label: 'decision_pending' },
  { pattern: /\bshould i\b/i, label: 'seeking_decision' },
  { pattern: /\bhaven'?t (told|talked to|spoken to|said|asked)\b/i, label: 'unspoken' },
  { pattern: /\b(i'?ll|i am going to|i'?m going to|gonna) (talk to|call|tell|ask|confront)\b/i, label: 'intended_action' },
  { pattern: /\b(don'?t know what to do|not sure (what|if|whether) i should|can'?t decide)\b/i, label: 'undecided' },
  { pattern: /\b(keep (thinking|coming back)|can'?t stop thinking) (about|to)\b/i, label: 'rumination' },
  { pattern: /\b(trying|need) to figure out\b/i, label: 'figuring_out' },
  { pattern: /\b(have to|need to) (tell|talk to|confront)\b/i, label: 'pending_confrontation' },
  { pattern: /\b(what should i|what do i do|what would you do)\b/i, label: 'asking_guidance' },
  { pattern: /\b(thinking about whether|wondering (if|whether)|not sure whether)\b/i, label: 'weighing' },
];

export function detectLoopSignals(text: string): LoopSignal[] {
  const signals: LoopSignal[] = [];
  for (const { pattern, label } of LOOP_SIGNAL_PATTERNS) {
    const m = text.match(pattern);
    if (m) signals.push({ label, match: m[0] });
  }
  return signals;
}
