'use client';

import { useEffect, useState, type CSSProperties } from 'react';

// Settings (DO #3/#4). Reached from the header avatar. Three sections; the destructive
// "start over" uses a real typed-ERASE confirm (DO #4), not window.confirm.
// Contrast-verified colours only.
const INK = '#14100e';
const INK_SOFT = '#3d352e';
const MUTED = '#6b6259';
const MUTED_STRONG = '#5c534b';
const TERRA = '#8a4a14';
const EYEBROW: CSSProperties = { fontSize: 13, letterSpacing: '0.22em', textTransform: 'uppercase', color: MUTED };

interface SettingsScreenProps {
  email: string | null;
  handsFree: boolean;
  onToggleHandsFree: (v: boolean) => void;
  onSignOut: () => void;
  onDeleteAll: () => Promise<void> | void;   // all conversations, memory kept
  onStartOver: () => Promise<void> | void;   // everything incl. memory
}

export default function SettingsScreen({ email, handsFree, onToggleHandsFree, onSignOut, onDeleteAll, onStartOver }: SettingsScreenProps) {
  const [count, setCount] = useState<number | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const [confirmOver, setConfirmOver] = useState(false);
  const [erase, setErase] = useState('');
  const [busy, setBusy] = useState<null | 'all' | 'over'>(null);

  useEffect(() => {
    if (!email) return;
    // Count is read-only context for the confirm copy; the userId lives in localStorage.
    const uid = (() => { try { return localStorage.getItem('marcus_userId'); } catch { return null; } })();
    if (!uid) return;
    fetch(`/api/analytics?userId=${uid}`).then(r => r.json()).then(d => setCount(d.totalSessions ?? 0)).catch(() => {});
  }, [email]);

  const n = count ?? 0;
  const runAll = async () => { setBusy('all'); await onDeleteAll(); setBusy(null); setConfirmAll(false); };
  const runOver = async () => { setBusy('over'); await onStartOver(); setBusy(null); setConfirmOver(false); setErase(''); };

  return (
    <div className="relative z-10 h-full overflow-y-auto">
      <div className="mx-auto w-full px-6 sm:px-10 lg:px-16 py-12 fade-in-up" style={{ maxWidth: 640 }}>
        <h1 className="font-serif" style={{ fontSize: 'clamp(28px,4.5vw,40px)', fontWeight: 400, letterSpacing: '-0.02em', color: INK }}>Settings</h1>

        {/* ACCOUNT */}
        <section style={{ marginTop: 48 }}>
          <p style={EYEBROW}>Account</p>
          <div style={{ marginTop: 16 }}>
            <p style={{ fontSize: 17, color: INK_SOFT }}>{email || '—'}</p>
            <button onClick={onSignOut} className="transition-opacity hover:opacity-70" style={{ fontSize: 15, color: MUTED_STRONG, marginTop: 10 }}>Sign out</button>
          </div>
        </section>

        {/* CONVERSATION */}
        <section style={{ marginTop: 48 }}>
          <p style={EYEBROW}>Conversation</p>
          <div style={{ marginTop: 16, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 24 }}>
            <div style={{ maxWidth: 440 }}>
              <p style={{ fontSize: 17, color: INK_SOFT }}>Hands-free</p>
              <p style={{ fontSize: 14, lineHeight: 1.55, color: MUTED, marginTop: 4 }}>
                The mic stays open and Marcus replies when you pause — no button to hold. Turn this off to speak only while you hold the orb.
              </p>
            </div>
            <button
              role="switch"
              aria-checked={handsFree}
              onClick={() => onToggleHandsFree(!handsFree)}
              style={{ flexShrink: 0, width: 52, height: 30, background: handsFree ? INK : '#d8d2c8', position: 'relative', transition: 'background .18s' }}
            >
              <span style={{ position: 'absolute', top: 3, left: handsFree ? 25 : 3, width: 24, height: 24, background: '#faf9f6', transition: 'left .18s' }} />
            </button>
          </div>
        </section>

        {/* YOUR DATA */}
        <section style={{ marginTop: 48 }}>
          <p style={EYEBROW}>Your data</p>

          {/* Level 2 — delete all conversations, memory kept */}
          <div style={{ marginTop: 20 }}>
            <p style={{ fontSize: 17, color: INK_SOFT }}>Clear all conversations</p>
            <p style={{ fontSize: 14, lineHeight: 1.55, color: MUTED, marginTop: 4, maxWidth: 480 }}>
              Removes every session and its transcript. Marcus keeps what he already knows about you.
            </p>
            {!confirmAll ? (
              <button onClick={() => setConfirmAll(true)} className="transition-opacity hover:opacity-70" style={{ fontSize: 15, color: MUTED_STRONG, marginTop: 10 }}>Clear conversations…</button>
            ) : (
              <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 16 }}>
                <button onClick={() => setConfirmAll(false)} style={{ fontSize: 15, color: INK, fontWeight: 500 }}>Keep them</button>
                <button onClick={runAll} disabled={busy === 'all'} className="transition-opacity hover:opacity-70 disabled:opacity-50" style={{ fontSize: 15, color: TERRA }}>{busy === 'all' ? 'Clearing…' : `Clear all ${n || ''} — keep memory`}</button>
              </div>
            )}
          </div>

          {/* Level 3 — start over, everything incl. memory (typed-ERASE confirm) */}
          <div style={{ marginTop: 32, borderTop: '1px solid #ded8cf', paddingTop: 28 }}>
            <p style={{ fontSize: 17, color: INK_SOFT }}>Start over completely</p>
            <p style={{ fontSize: 14, lineHeight: 1.55, color: MUTED, marginTop: 4, maxWidth: 480 }}>
              Deletes everything — and Marcus forgets you entirely.
            </p>
            {!confirmOver ? (
              <button onClick={() => setConfirmOver(true)} className="transition-opacity hover:opacity-70" style={{ fontSize: 15, color: MUTED_STRONG, marginTop: 10 }}>Start over…</button>
            ) : (
              <div style={{ marginTop: 16, maxWidth: 460 }}>
                <p style={{ fontSize: 15, lineHeight: 1.6, color: INK_SOFT }}>
                  This permanently deletes {n === 1 ? 'your 1 conversation' : `all ${n} of your conversations`} and everything Marcus remembers about you. <span style={{ color: INK, fontWeight: 500 }}>It cannot be undone.</span>
                </p>
                <p style={{ fontSize: 13, color: MUTED, marginTop: 14 }}>Type ERASE to confirm</p>
                <input
                  value={erase}
                  onChange={(e) => setErase(e.target.value)}
                  placeholder="ERASE"
                  className="font-mono"
                  style={{ marginTop: 6, width: 180, height: 40, padding: '0 12px', background: '#faf9f6', border: '1px solid #ded8cf', color: INK, fontSize: 15, letterSpacing: '0.15em' }}
                />
                <div style={{ marginTop: 18, display: 'flex', alignItems: 'center', gap: 20 }}>
                  <button onClick={() => { setConfirmOver(false); setErase(''); }} style={{ height: 44, padding: '0 22px', background: INK, color: '#faf9f6', fontSize: 15, fontWeight: 500 }}>Keep everything</button>
                  <button
                    onClick={runOver}
                    disabled={erase.trim().toUpperCase() !== 'ERASE' || busy === 'over'}
                    className="transition-opacity disabled:opacity-40"
                    style={{ fontSize: 15, color: TERRA }}
                  >
                    {busy === 'over' ? 'Erasing…' : 'Erase everything'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
