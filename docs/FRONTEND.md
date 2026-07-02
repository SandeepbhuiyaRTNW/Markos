# Marcus / mrkos.ai — Frontend Documentation

Next.js `16.1.6` (App Router, RSC-enabled) · React `19.2.3` · TypeScript 5 · Tailwind v4. A
voice-first AI companion embodying Marcus Aurelius. Path alias `@/*` → `src/*`. The React Compiler
is enabled (`babel-plugin-react-compiler` 1.0.0, `reactCompiler: true` in `next.config.ts`).

> Related: [OVERVIEW.md](OVERVIEW.md) · [BACKEND.md](BACKEND.md) · [AI.md](AI.md)

---

## 1. App shell

### `src/app/layout.tsx` (root layout)
- Server component. Imports `./globals.css`.
- **Font:** `Inter` from `next/font/google` (subset `latin`), exposed as CSS var `--font-inter`,
  applied via `<body className={`${inter.variable} font-sans antialiased`}>`.
- **Metadata:** title `"mrkos.ai — Your Stoic Companion"`, description
  `"Voice-only AI companion embodying Marcus Aurelius"`, icons `/favicon-android.png` and
  `/favicon-iphone.png`.
- `<html lang="en">`. **No providers/context wrappers at all** — no theme provider, no auth
  provider, no React Query. All state lives inside the single client page.

### `src/app/page.tsx` (`Home`) — the entire app
This one `'use client'` component (~1100 lines) is the whole SPA. It holds all top-level state and
routes between views via conditional rendering (no Next.js sub-routes for app screens).

**Key type unions:**
- `VoiceState = 'idle' | 'listening' | 'processing' | 'speaking'`
- `AppView = 'analytics' | 'voice' | 'session-detail' | 'session-notes'`
- `InputMode = 'session-type' | 'pick-session' | 'choice' | 'voice' | 'text'`
- `SessionType = 'continue' | 'fresh'`

**Notable state (all `useState`):** `userId`, `userEmail`, `conversationId`, `transcripts` (array
of `{ user, marcus }`), `onboardingComplete`, `openingMessage`/`openingLoading`, `view`,
`selectedConvId`, `refreshSidebar` (a counter used to force a sidebar refetch), `sidebarOpen`,
`inputMode`, `sessionType`, `continueFromId`, `recentSessions`, `sessionNotes`, plus an auth
sub-state machine (`showLogin`, `authStep: 'email'|'otp'|'password'`, `otpCode`, `password`, …).

**Refs:** `messagesEndRef` (auto-scroll), `fetchingOpeningRef` (guards a double opening fetch),
`viewRef` (mirror of `view` to avoid stale closures in `fetchOpening`).

**Rendering** is a cascade of early returns: auth-loading spinner → landing page (not logged in) →
checking-onboarding spinner → `OnboardingFlow` → main app. The main app has a header (logo, Clean
Slate, Sessions toggle, New Session, email/logout), a `Sidebar` (only in voice/session-notes
views), and a `<main>` that switches on `view`.

### `src/app/globals.css`
- Imports Google Inter (again, via `@import url(...)`), `@import "tailwindcss"` (Tailwind v4
  single-import), and `@import "tw-animate-css"`.
- A comment notes the shadcn `tailwind.css` was inlined because "Turbopack can't resolve the style
  export condition."
- Uses Tailwind v4 **CSS-first config**: `@theme inline { ... }` blocks, `@custom-variant`
  declarations (`data-open`, `data-closed`, `data-checked`, `dark`, …), and `@utility no-scrollbar`.
- **Design tokens** on `:root` (light theme; a `.dark` variant is declared but the app ships
  light-only): a warm Stoic palette — `--background: #fafaf8`, `--foreground: #1c1917`,
  `--primary: #44403c`, and the signature warm accent `--warm: #a3785e` (used literally as
  `#a3785e` throughout). Custom tokens: `--glass-bg`, `--glass-border`, `--warm-subtle`,
  `--warm-muted`, `--stone-accent`, `--radius: 0.75rem`.
- **Hand-written component classes + keyframes** (not utilities): `.message-bubble` /
  `.user-message` / `.marcus-message`; `.glass-card` / `.glass-strong` / `.stat-card`;
  `.ambient-bg` (fixed background); and orb/waveform animations `orb-breathe`, `orb-listening`,
  `orb-processing`, `orb-speaking`, `pulse-ring`, `waveform`, plus `fade-in`, `fade-in-up`,
  `fade-in-scale`, `slide-in-right`. Custom thin scrollbar styling.

---

## 2. Main components (`src/components/*.tsx`)

### `VoiceOrb.tsx` — the primary voice control (active)
- **Props:** `onStateChange`, `onTranscript(userText, marcusText)`, `userId`, `conversationId`,
  `onConversationId`, `state`, `disabled`.
- Records mic via `navigator.mediaDevices.getUserMedia({ audio: true })` + `MediaRecorder`
  (`mimeType: 'audio/webm'`), accumulating chunks in `chunksRef`.
- **Stale-closure fix:** all callback props/values are mirrored into refs (`conversationIdRef`,
  `userIdRef`, …) via `useEffect` syncs — documented to avoid `MediaRecorder.onstop` capturing a
  null `conversationId` and spawning a new session on every utterance.
- **`sendAudio`:** builds `FormData` with `audio`, `userId`, optional `conversationId` →
  **POST `/api/conversation`**. Reads response **headers** `X-Conversation-Id`, `X-User-Text`,
  `X-Marcus-Text` (URL-decoded), then reads the body as an `ArrayBuffer`, wraps it in a
  `Blob({ type: 'audio/mpeg' })`, and plays it via `new Audio(objectURL)`. Sets state `speaking`
  during playback; `onended` → `idle` and revokes the object URL.
- **UX:** click toggles record/stop; disabled while `processing`/`speaking`. Visual state via CSS
  classes `orb-listening` / `orb-speaking` / `orb-idle`, pulse rings, a spinner for processing, a
  mic vs. `Square` (stop) icon, and radial-gradient backgrounds shifting red (recording) vs. warm
  (`#a3785e`).

### `VoiceButton.tsx` — legacy/alternate voice button
Same recording + `/api/conversation` flow and same header/audio-buffer protocol as VoiceOrb, but
simpler (no ref-mirroring, raw SVG mic). **Not imported by `page.tsx`** — an earlier prototype kept
around.

### `Waveform.tsx`
Tiny presentational component. Props `active: boolean`, `color = '#ffffff'`. Renders 5 bars animated
with the `waveform` keyframe when `active`. **Not currently imported** (decorative/legacy).

### `ConversationView.tsx` — read-only past-session detail
- **Props:** `conversationId`, `onBack`.
- On mount **GET `/api/conversations/{id}`** → `{ messages, conversation }`. Populates messages plus
  rich session-notes fields, reading "new columns first, fall back to `metadata`": `title`,
  `takeaways`, `pondering_topics`, `pattern`, `action_plan` (object or legacy array), `check_in`,
  `stoic_principle`, `mood`, `summary`.
- **`generateSummary()`:** **POST `/api/conversations/{id}`** to generate takeaways/notes on demand
  (shown when no takeaways/summary exist yet).
- **Layout:** split-screen — left 40% = session-notes cards (`glass-strong`), right 60% = transcript
  bubbles (`marcus-message` / `user-message`) with `emotion_detected` chips. Auto-scrolls to bottom.

### `OnboardingFlow.tsx`
- **Props:** `userId`, `onComplete`.
- Two phases: `'profile'` (name, age, "what brought you here") then `'questions'` — 5 hardcoded
  reflective prompts (`QUESTIONS`: `whats_going_on`, `biggest_struggle`, `what_you_want`,
  `relationship_status`, `when_lost`).
- Progress bar over `1 + QUESTIONS.length` steps. On the final question, **POST `/api/onboarding`**
  with `{ userId, name, age, whatBroughtYou, answers }`, then `onComplete()`.
- Pure local state; back/next preserves prior answers.

### `Sidebar.tsx`
- **Props:** `userId`, `onSelectSession`, `activeSessionId`, `onNewSession`, `refreshTrigger`,
  `isOpen`, `onToggle`.
- On mount / when `refreshTrigger` changes: **GET `/api/conversations?userId={userId}`** →
  `data.conversations`. Renders a scrollable session list with session number, title (from
  `metadata.title`, else truncated `first_message`, else `Session N`), date, `message_count`, and a
  summary snippet.
- **Mobile:** fixed drawer sliding via `translate-x` on `isOpen`; **desktop:** static column
  (`w-72`).

### `AnalyticsDashboard.tsx` — the default landing view when logged in
- **Props:** `userId`, `onSelectSession`, `onContinueSession`.
- On mount **GET `/api/analytics?userId={userId}`** → `AnalyticsData`: `totalSessions`,
  `totalMessages`, `topics[]`, `conversations[]`, `weeklyUsage[]`, `lastSessionNotes`.
- **Layout:** left 40% = "From Your Last Session" card, two stat cards (Sessions / Exchanges), a
  hand-rolled **weekly-usage bar chart** (flex bars scaled to `maxWeekly`), and a **topics bar list**
  (top 6 as bars, 7–15 as pills). Right 60% = past-sessions list; each card has a "Continue this
  conversation" button (calls `onContinueSession`, `stopPropagation` from the select handler).
  **No charting library** — all charts are plain divs.

---

## 3. UI library — shadcn/ui (`src/components/ui/*`)

Confirmed shadcn via `components.json`: `"style": "new-york"`, `"rsc": true`, `"tsx": true`,
`"baseColor": "neutral"`, `cssVariables: true`, `iconLibrary: "lucide"`, aliases `@/components`,
`@/lib/utils`, `@/components/ui`. Uses the **unified `radix-ui` package** (v1.4.3) with namespaced
imports (`import { Slot } from "radix-ui"`, `import { Tabs as TabsPrimitive } from "radix-ui"`)
rather than per-primitive `@radix-ui/react-*` packages.

**Components present:** `avatar.tsx`, `badge.tsx`, `button.tsx`, `card.tsx`, `dialog.tsx`,
`input.tsx`, `progress.tsx`, `scroll-area.tsx`, `separator.tsx`, `sheet.tsx`, `tabs.tsx`,
`textarea.tsx`. All use the `data-slot` convention and `cn()` from `@/lib/utils` (`clsx` +
`tailwind-merge`). `button.tsx` uses `class-variance-authority` with variants
(default/destructive/outline/secondary/ghost/link) and sizes including custom `xs`, `icon-xs`,
`icon-sm`, `icon-lg`; renders `Slot.Root` when `asChild`.

In practice `page.tsx` mostly uses raw styled `<button>`s and pulls in shadcn `Button` and `Input`;
`ConversationView` uses `Button`. Most shadcn primitives (dialog, sheet, tabs, avatar, badge,
progress, scroll-area, separator) are **installed but not yet wired** into the main flows.

---

## 4. Voice / audio UX (client)

- **Recording:** `getUserMedia` → `MediaRecorder` (`audio/webm`), chunk collection, `onstop`
  assembles a `Blob` and uploads.
- **Transport:** a single multipart POST to `/api/conversation` carrying the audio + `userId`
  (+ `conversationId`). The **backend does STT → LLM → TTS**; the client is provider-agnostic.
- **Response protocol:** a binary MP3 stream with metadata smuggled through custom HTTP headers
  (`X-Conversation-Id`, `X-User-Text`, `X-Marcus-Text`) rather than a JSON envelope.
- **Playback:** response `ArrayBuffer` → `Blob('audio/mpeg')` → object URL → `new Audio().play()`;
  object URLs revoked on `ended`. The state machine drives orb animation
  (`listening` → `processing` → `speaking` → `idle`).
- **Opening line** (`fetchOpening` in `page.tsx`): **GET `/api/conversation/opening?userId=...`**
  with query flags `skipTts=true` (text mode), `sessionType=fresh`, `continueFrom={id}`. Voice mode
  returns audio (+ headers) and auto-plays; text mode returns JSON `{ conversationId, marcusText }`.
- **Text mode** bypasses audio entirely: **POST `/api/conversation/text`**
  `{ userId, conversationId, message }` → JSON `{ conversationId, marcusText }`.

---

## 5. State management & data fetching

- **No state library, no data-fetching library.** Everything is `useState`/`useRef`/`useEffect` in
  `page.tsx`, with props drilled into children. Cross-component refresh uses an incrementing
  `refreshSidebar` counter passed as `refreshTrigger`.
- **Persistence:** session is stored in `localStorage` (`marcus_userId`, `marcus_email`), restored
  on mount. No cookies / NextAuth session on the client despite `next-auth` being a dependency —
  auth is a custom email→password / email→OTP flow hitting `/api/auth/*`.
- **Fetch pattern:** raw `fetch`, a mix of `.then()` chains (mount effects) and `async/await`
  (handlers), manual `res.ok` checks, `console.error` on failure. No AbortControllers, no caching,
  no optimistic UI beyond appending to `transcripts`.
- **Streaming:** none token-by-token. The only "streaming" is receiving the full MP3 body as an
  ArrayBuffer. Text/opening responses are plain JSON. A typing-dots placeholder (`animate-bounce`)
  shows during `processing`/`openingLoading`.

**Client-called endpoints** (all under `/api`): `onboarding` (GET/POST), `conversation` (POST
audio), `conversation/opening` (GET), `conversation/text` (POST), `conversations` (GET list),
`conversations/recent` (GET), `conversations/[id]` (GET detail / POST generate-notes), `analytics`
(GET), `auth/send-code`, `auth/verify-code`, `auth/login`, `auth/clean-slate` (all POST).
(`test-conversation` exists server-side but is not called from the UI.)

---

## 6. Styling system

- **Tailwind v4** (`tailwindcss` ^4, `@tailwindcss/postcss`), CSS-first (`@import "tailwindcss"` +
  `@theme inline`), no `tailwind.config.js` (the `components.json` `tailwind.config` is empty).
- **`tw-animate-css`** ^1.4.0 for animation utilities (a `tailwindcss-animate` replacement).
- **`class-variance-authority`** for shadcn variants; **`clsx` + `tailwind-merge`** via `cn()`.
- **Design language:** warm minimalist "Stoic" light theme — stone/neutral base with a single warm
  accent `#a3785e` (`--warm`), heavy use of custom glass/stat cards, generous rounded corners
  (`--radius: 0.75rem`, scaled up to `radius-4xl`), uppercase tracked micro-labels, and semantic
  accent colors for note sections (orange = pattern, emerald = action system, blue = check-in). Dark
  mode tokens exist in spots (`dark:bg-orange-950/10`) but the app ships light-only.

---

## 7. User-facing flows (client perspective)

1. **Landing** (`!userId`): hero + features + quote; "Log in / Start Your Journey" opens an inline
   auth machine — email → password, with "use verification code instead" switching to a 6-digit OTP
   step (`/api/auth/send-code` → `/api/auth/verify-code`). Success stores `userId`/`email` in
   localStorage.
2. **Onboarding** (`!onboardingComplete`, checked via GET `/api/onboarding?userId`): `OnboardingFlow`
   collects profile + 5 answers, POSTs, then `onboardingComplete = true`.
3. **Dashboard** (`view='analytics'`, the default): `AnalyticsDashboard` shows stats/charts/past
   sessions. A session card can open detail (`onSelectSession` → `session-detail`) or continue
   (`onContinueSession`).
4. **New / Continue Session** (`view='voice'`): a multi-step gate — `session-type` (Continue vs New
   Topic) → optionally `pick-session` (horizontal scroll of `recentSessions` from
   `/api/conversations/recent`, expandable to show takeaways/pondering) → `choice` (Voice vs Text).
   Choosing a mode calls `fetchOpening` for Marcus's opening line, then the chat/voice UI renders.
   Voice uses `VoiceOrb`; text uses an `Input` + send button hitting `/api/conversation/text`.
5. **End Session** (`handleEndSession`): POST `/api/conversations/{id}` → session notes →
   `view='session-notes'` renders the generated summary/takeaways/pondering/pattern/action-plan/
   check-in/stoic-principle cards, then "Back to Dashboard."
6. **Session Detail** (`view='session-detail'`): `ConversationView` read-only split view of notes +
   transcript.
7. **Clean Slate** (`handleCleanSlate`): confirm dialog → POST `/api/auth/clean-slate` wipes all
   sessions/memories. **Logout** clears localStorage and resets state.

---

## 8. Notable frontend observations

- `VoiceButton.tsx` and `Waveform.tsx` are legacy/unused (`page.tsx` uses `VoiceOrb` only; no
  waveform is rendered).
- Many installed shadcn primitives (dialog, sheet, tabs, avatar, badge, progress, scroll-area,
  separator) are not yet used — most modals/confirms use native `window.confirm` / `alert` and
  hand-rolled buttons.
- No global error boundary, no toast system, no loading skeletons beyond spinners/typing-dots;
  errors are largely `console.error`.
- Metadata says "voice-only" but the app fully supports a parallel **text** mode.
- The entire app is one ~1100-line client component — a candidate for future decomposition and for
  moving auth state onto real sessions.
