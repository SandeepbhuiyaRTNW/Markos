// Single source of truth for how a session is titled + dated across every screen (DO #7).
// The same conversation must show the same title everywhere, so ALL screens import these.

export interface SessionLike {
  metadata?: Record<string, unknown> | null;
  first_message?: string | null;
  session_number?: number;
  started_at?: string;
  ended_at?: string | null;
  session_ended?: boolean;
}

const TITLE_MAX = 48; // ONE truncation length everywhere

/** Human title: the LLM-generated metadata.title, else the first user line truncated, else N. */
export function getSessionTitle(s: SessionLike): string {
  const t = s.metadata?.title;
  if (typeof t === 'string' && t.trim()) return t.trim();
  const fm = s.first_message?.trim();
  if (fm) return fm.length > TITLE_MAX ? fm.slice(0, TITLE_MAX).trimEnd() + '…' : fm;
  return s.session_number != null ? `Session ${s.session_number}` : 'Session';
}

/** Short absolute date, "Mon D" — ended_at for finished sessions, else started_at. */
export function formatSessionDate(s: { started_at?: string; ended_at?: string | null; session_ended?: boolean; date?: string }): string {
  const raw = s.date ?? ((s.session_ended && s.ended_at) ? s.ended_at : s.started_at);
  if (!raw) return '';
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** Relative date used on the editorial home / lists. */
export function relativeDate(dateStr: string): string {
  const t = new Date(dateStr).getTime();
  if (Number.isNaN(t)) return '';
  const days = Math.floor((Date.now() - t) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  if (days < 14) return 'last week';
  if (days < 31) return `${Math.floor(days / 7)} weeks ago`;
  if (days < 60) return 'last month';
  if (days < 365) return `${Math.floor(days / 30)} months ago`;
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

const NUM = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];
export function numberWord(n: number): string {
  const s = n >= 0 && n <= 20 ? NUM[n] : String(n);
  return s.charAt(0).toUpperCase() + s.slice(1);
}
