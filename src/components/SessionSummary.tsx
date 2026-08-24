'use client';

import React from 'react';

// Shared editorial session summary — used by both the post-end screen (session-notes) and
// the session-detail view (ConversationView). Matches the sessions-home treatment: no cards,
// no filled panels, no colour section headers, no glyphs; sections separated by whitespace
// and small wide-tracked uppercase eyebrows in muted grey. NO mood label (design rules it out).
// Colours are the contrast-verified set (vs the e4634c7 field): #14100e 14.7:1, #3d352e 9.3:1,
// #6b6259 4.6:1 — headings/body >=7, muted >=4.5.
const INK = '#14100e';
const INK_SOFT = '#3d352e';
const MUTED = '#6b6259';
const EYEBROW: React.CSSProperties = { fontSize: 13, letterSpacing: '0.22em', textTransform: 'uppercase', color: MUTED };

interface SessionSummaryProps {
  title?: string | null;
  dateLabel?: string | null;
  summary?: string | null;
  /** The man's OWN words/realizations — not lines Marcus said (enforced at generation). */
  takeaways?: string[] | null;
  ponderingTopics?: string[] | null;
  stoicPrinciple?: string | null;
}

export default function SessionSummary({ title, dateLabel, summary, takeaways, ponderingTopics, stoicPrinciple }: SessionSummaryProps) {
  const notes = (takeaways ?? []).filter(Boolean);
  const ponder = (ponderingTopics ?? []).filter(Boolean);
  return (
    <div className="fade-in-up">
      {dateLabel && <p style={EYEBROW}>{dateLabel}</p>}
      {title && (
        <h1 className="font-serif" style={{ fontSize: 'clamp(28px,4.5vw,42px)', fontWeight: 400, letterSpacing: '-0.02em', lineHeight: 1.18, color: INK, maxWidth: 560, marginTop: dateLabel ? 12 : 0 }}>{title}</h1>
      )}

      {summary && (
        <p style={{ fontSize: 18, lineHeight: 1.6, color: INK_SOFT, maxWidth: 560, marginTop: 20 }}>{summary}</p>
      )}

      {notes.length > 0 && (
        <div style={{ marginTop: 44 }}>
          <p style={EYEBROW}>In your words</p>
          <div style={{ marginTop: 16 }}>
            {notes.map((t, i) => (
              <p key={i} style={{ fontSize: 18, lineHeight: 1.55, color: INK_SOFT, maxWidth: 560, marginTop: i === 0 ? 0 : 16 }}>{t}</p>
            ))}
          </div>
        </div>
      )}

      {ponder.length > 0 && (
        <div style={{ marginTop: 44 }}>
          <p style={EYEBROW}>Ponder before next</p>
          <div style={{ marginTop: 16 }}>
            {ponder.map((t, i) => (
              <p key={i} style={{ fontSize: 19, lineHeight: 1.5, color: INK, maxWidth: 560, marginTop: i === 0 ? 0 : 18 }}>{t}</p>
            ))}
          </div>
        </div>
      )}

      {stoicPrinciple && (
        <p style={{ fontSize: 13, color: MUTED, marginTop: 48 }}>Stoic principle — {stoicPrinciple}</p>
      )}
    </div>
  );
}
