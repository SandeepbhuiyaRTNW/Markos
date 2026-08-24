'use client';

import type { CSSProperties } from 'react';

// ONE header, every screen (DO #1). Transparent — no border/rule — so the ShaderBackground
// field runs to the top edge behind it. Full mode: wordmark + Sessions · Talk · Write · avatar.
// Focused mode (voice / write / settings / fork): wordmark + Close, nothing else.
// Colours are contrast-verified (vs the field): ink #14100e 14.7:1, muted #5c534b 5.8:1.
const INK = '#14100e';
const MUTED = '#5c534b';

const WORDMARK: CSSProperties = { fontSize: 13, letterSpacing: '0.3em', textTransform: 'uppercase', color: INK, fontWeight: 500 };

type NavKey = 'sessions' | 'talk' | 'write';

interface AppHeaderProps {
  mode?: 'full' | 'focused';
  active?: NavKey | null;
  email?: string | null;
  onHome?: () => void;      // wordmark
  onSessions?: () => void;
  onTalk?: () => void;
  onWrite?: () => void;
  onSettings?: () => void;  // avatar
  onClose?: () => void;     // focused
}

export default function AppHeader({ mode = 'full', active = null, email, onHome, onSessions, onTalk, onWrite, onSettings, onClose }: AppHeaderProps) {
  const initial = (email?.trim()?.[0] || 'M').toUpperCase();
  const item = (label: string, key: NavKey, onClick?: () => void) => (
    <button
      onClick={onClick}
      className="transition-opacity hover:opacity-70"
      style={{ fontSize: 13, letterSpacing: '0.04em', color: active === key ? INK : MUTED, fontWeight: active === key ? 500 : 400 }}
    >
      {label}
    </button>
  );
  return (
    <header className="relative z-20 flex-none">
      <div className="flex items-center justify-between px-6 sm:px-10 lg:px-16" style={{ height: 60 }}>
        <button onClick={onHome ?? onClose} style={WORDMARK} className="transition-opacity hover:opacity-70">Markos</button>
        {mode === 'focused' ? (
          <button onClick={onClose} className="transition-opacity hover:opacity-70" style={{ fontSize: 13, letterSpacing: '0.04em', color: MUTED }}>Close</button>
        ) : (
          <div className="flex items-center gap-6">
            {item('Sessions', 'sessions', onSessions)}
            {item('Talk', 'talk', onTalk)}
            {item('Write', 'write', onWrite)}
            <button
              onClick={onSettings}
              aria-label="Settings"
              className="transition-opacity hover:opacity-80"
              style={{ width: 30, height: 30, background: INK, color: '#faf9f6', fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >
              {initial}
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
