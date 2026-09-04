/**
 * Embodied Man Knowledge — the Embodied Man interview distilled into a deterministic
 * domain layer for body-history conversations with men.
 *
 * Sources (all provided by Vikas on 2026-09-04):
 *   1. "The Embodied Man Interview — Body History Edition" (the full script:
 *      12 sections, consent gates, host rules, body-word menus, medical boundary,
 *      closing letter). This is the authority for this layer.
 *   2. "The Embodied Man Interview Build Specification — Draft 0.1" (how a machine
 *      would run the interview: session model, agent additions, Sentinel gates,
 *      Intelbase schema, text-channel adaptation, feedback artefact, test plan).
 *   3. "mrkos — Conversation Database v2" (the question bank; its `body` domain
 *      rows and move craft informed the question-craft guidance here).
 * Distilled, not copied.
 *
 * WHAT THIS IS
 * ------------
 * A single, reviewable corpus of BODY-HISTORY conversation craft: how Markos
 * receives a man talking about the life he has lived in his body — childhood,
 * adolescence, work under pressure, illness and loss, intimacy, aging — and how
 * he asks about it without ever interpreting the man's body for him. It parallels
 * divorce-knowledge.ts and listening-knowledge.ts: auditable, deterministic, no
 * architecture change. The standing line the whole module is built around:
 * **The body is a source of information, not a diagnostic oracle. Markos helps a
 * man find words for what his body has lived; he never tells the man what his
 * body means.**
 *
 * WHAT THIS IS NOT (spec-vs-repo verification, 2026-09-04)
 * -------------------------------------------------------
 * The build spec describes machinery that does NOT exist in this repo: a
 * four-agent Listener/Proposer/Selector/Sentinels machine, Intelbase / Topic Map /
 * His Words / Terrain stores, a consent state object, interview session phases,
 * resumable sittings, a silence timer, and a feedback artefact. The real pipeline
 * here is orchestrator-v2.ts: Sentinels first, assessment ring, wisdom council +
 * whisperers, one Composer call, post-generation filters. This module implements
 * ONLY what fits that pipeline — deterministic knowledge riding the existing
 * whisperer output channels — and the PR description lists the spec machinery
 * left as follow-ups. No parallel engine is built.
 *
 * HOW IT REACHES A REPLY (no architecture change)
 * ----------------------------------------------
 * Same channels the listening and divorce knowledge ride: a caller detects which
 * embodied-man area(s) the turn touches and emits `buildEmbodiedManNote()`
 * DETERMINISTICALLY into the envelope's `domain_whisperers.context_notes`, with
 * the hard guardrails into `landmines`. Those channels already render into the
 * Composer prompt via `buildEnvelopeContextSummary` (## WHISPERER INTELLIGENCE /
 * ## LANDMINES) and `buildPriorityHierarchy` (PRIORITY 3 — DOMAIN INTELLIGENCE).
 * The assembly works with NO OpenAI key and NO database.
 *
 * SAFETY POSTURE
 * --------------
 * Every note is INTERNAL guidance to Marcus ("you may…", "first reflect…"),
 * never a script to read verbatim. This module does not touch the crisis
 * sentinels; crisis turns keep bypassing the Composer entirely. The script was
 * written for a room and a voice; where a host move assumes a face-to-face
 * setting it is translated for a VOICE-ONLY product — pace, tone, and silence
 * are the nonverbal channel here. The medical boundary is a hard rule, not a
 * theme: one standing referral line, once, never repeated, never a causal story
 * about a symptom. Reviewer fields on every provenance record are null:
 * founder/team review is a launch blocker, not satisfied by this file.
 */

export type EmbodiedManArea =
  | 'body_check_in'      // present-moment: how his body feels right now
  | 'body_locus'         // where he feels something
  | 'body_quality'       // what it feels like (tight, heavy, numb…)
  | 'body_impulse'       // what his body wanted to do (freeze, run, hide, reach out…)
  | 'stuck_signal'       // "I don't know", deflecting, minimising, flat, numb
  | 'medical_mention'    // a current, untreated, or concerning symptom
  | 'consent_signal'     // narrowing, withdrawing, or extending permission
  | 'touch_intimacy'     // touch, affection, sexuality, body image, pleasure (gated)
  | 'hidden_feelings'    // anger, fear, shame — the feelings men hide
  | 'body_says_enough'   // illness, injury, panic, burnout, loss
  | 'men_with_men'       // male friendship, touch between men, being held
  | 'aging_body_now'     // the present-day body: aging, rest, care
  | 'letter_to_body';    // the closing reflection: a letter to his body

export const EMBODIED_MAN_AREAS: readonly EmbodiedManArea[] = [
  'body_check_in', 'body_locus', 'body_quality', 'body_impulse',
  'stuck_signal', 'medical_mention', 'consent_signal', 'touch_intimacy',
  'hidden_feelings', 'body_says_enough', 'men_with_men', 'aging_body_now',
  'letter_to_body',
];

export interface Provenance {
  source_title: string;
  source_url: string | null;
  reviewed_by: string | null;   // null until founder/team review — launch blocker
  reviewed_at: string | null;
}

export const SOURCES: Record<string, Provenance> = {
  interview_script: {
    source_title: 'The Embodied Man Interview — Body History Edition (full script, provided 2026-09-04): 12 sections, consent gates, host rules, body-word menus, medical boundary, closing letter',
    source_url: null,
    reviewed_by: null,
    reviewed_at: null,
  },
  build_spec: {
    source_title: 'The Embodied Man Interview Build Specification — Draft 0.1, September 2026 (provided 2026-09-04): session model, agent additions, Sentinel gates, Intelbase schema, text-channel adaptation, feedback artefact, test plan',
    source_url: null,
    reviewed_by: null,
    reviewed_at: null,
  },
  conversation_db: {
    source_title: 'mrkos — Conversation Database v2 (workbook, provided 2026-09-04): question bank whose body-domain rows and move craft informed the question-craft guidance',
    source_url: null,
    reviewed_by: null,
    reviewed_at: null,
  },
};

export interface EmbodiedManKnowledge {
  area: EmbodiedManArea;
  principle: string;         // the rule, in one line
  guidance: string;          // internal guidance to Marcus — how to carry it in a reply
  voice_translation: string; // how a face-to-face host move maps to a voice-only conversation
  provenance: Provenance;
}

export const EMBODIED_MAN_KNOWLEDGE: readonly EmbodiedManKnowledge[] = [
  {
    area: 'body_check_in',
    principle: 'Start where his body is right now, before any history.',
    guidance:
      'The script opens every conversation with a present-moment check-in: "Before we go back into your history, how does your body feel right now?" When he offers present-moment body words, receive them as real information and keep them — the closing of a deep conversation can call back to how he said he was at the start. If he reaches for it, offer the simple menu as a choice: "tight, relaxed, tired, restless, warm, numb, comfortable, sore, calm — whatever fits."',
    voice_translation:
      'Face-to-face the host can see him settle into the chair. In voice, the check-in is an invitation with an explicit release — "or nothing, that\'s fine" — asked at most once per stretch of conversation, never as a warmup ritual he has to perform.',
    provenance: SOURCES.interview_script,
  },
  {
    area: 'body_locus',
    principle: 'Where comes before why.',
    guidance:
      'When he places a sensation somewhere — chest, jaw, shoulders, stomach, hands — stay at that location before any meaning. The spine is: where is it → what does it feel like → what did your body want to do → what did you need → what did you do. Use his word for the place, not an anatomical upgrade. Never tell him what that location "holds" or "remembers" — a tight chest is his tight chest, not your symbol.',
    voice_translation:
      'A room host might gesture; in voice you simply hand the location back in his own words and ask the next smaller question about it. One step of the spine per turn, not the whole ladder.',
    provenance: SOURCES.interview_script,
  },
  {
    area: 'body_quality',
    principle: 'Plain body words before emotional or psychological language.',
    guidance:
      'Tight, loose, heavy, light, hot, cold, shaky, still, tingly, numb, sore, achy, pressured, open, closed, fluttery — these are the first vocabulary, and they are enough. If he reaches for a feeling word, receive it; if he does not, do not promote his sensation into an emotion for him. When he is stuck on quality, the menu is a choice he can take or leave, never a quiz: "tight? heavy? numb? whatever fits — or nothing."',
    voice_translation:
      'On voice, slow down and drop your pitch when you offer a menu; the offer should sound like room to breathe, not a list to complete. Silence after the offer is him thinking, not a failed turn.',
    provenance: SOURCES.interview_script,
  },
  {
    area: 'body_impulse',
    principle: 'What his body wanted to do is information, not a confession.',
    guidance:
      'Move closer, move away, freeze, hide, speak, yell, cry, fight, rest, run, reach out, be held, be left alone — when he names an impulse, receive it without evaluating it. Many men have never said "I wanted to run" or "I wanted to be held" out loud; the saying is the event. Do not convert the impulse into advice ("next time, listen to that") or into a character read ("you\'re a fighter").',
    voice_translation:
      'Face-to-face this lands with a nod and stillness. In voice: a short acknowledgment in his words, then quiet. Do not rush to the next question — the impulse he just named is still in the room.',
    provenance: SOURCES.interview_script,
  },
  {
    area: 'stuck_signal',
    principle: 'Simpler, not harder. "I don\'t know" is a valid answer.',
    guidance:
      'When he says he doesn\'t know, goes flat, minimises ("it\'s fine," "nothing really"), or goes numb, the move is NEVER a more abstract, more emotional, or more layered question. Make the question smaller: narrower in time, closer to the body, or offer a word menu as a choice. And "I don\'t know" is allowed to stand — you may leave it with "that\'s fine, we can leave it there" and stay with him. Flatness and numbness can be how the story is carried, not disengagement; do not treat them as a wall to break through.',
    voice_translation:
      'A voice host would soften and slow. In voice: shorter sentences, lower tempo, and genuine comfort with a pause. Never fill his silence with a rephrase of the same question at higher intensity.',
    provenance: SOURCES.interview_script,
  },
  {
    area: 'medical_mention',
    principle: 'The body is information, not a diagnostic oracle. Refer once, then follow his choice.',
    guidance:
      'When he describes a current, untreated, or concerning symptom, you do exactly one thing once: the standing referral line — name that it sounds worth getting looked at by someone who can actually examine it, say you\'d want him to, and ask whether he wants to keep going here or stop. Then continue or close as HE chooses. You do not repeat the referral, do not ask about the symptom\'s cause, do not ask more than once whether he has seen a doctor, and never attribute the symptom to stress, grief, or any emotional story.',
    voice_translation:
      'Say it plainly and warmly, the way you\'d tell a friend to get something checked — then let it go. The power of the line is that it is said once and meant, not repeated until he complies.',
    provenance: SOURCES.build_spec,
  },
  {
    area: 'consent_signal',
    principle: 'His "no" and his "skip" are instant and permanent until he reopens the door himself.',
    guidance:
      'Any turn that narrows, withdraws, or extends permission — "I\'d rather not," "can we skip that," "that\'s fine to ask" — takes effect immediately, before anything else in your reply. A narrowed topic is closed: do not return to it later in the conversation, do not ask why, do not acknowledge it with more than a plain "of course" and a move to solid ground. If he extends permission, receive it without making it a ceremony.',
    voice_translation:
      'In a room the host would simply move on without a flicker. In voice: no audible surprise, no "are you sure?", no apology spiral. The smoother the pivot, the safer he learns the conversation is.',
    provenance: SOURCES.interview_script,
  },
  {
    area: 'touch_intimacy',
    principle: 'Touch, affection, sexuality, self-touch, body image, and pleasure are gated territory.',
    guidance:
      'These topics require HIS explicit opening. If he has not clearly opened the door, do not raise them — not even gently, not even as a menu. If he opens the door, keep it non-graphic: you may ask what he learned, what felt natural or complicated, what he wants — never for description of acts. If he narrows mid-topic ("can we not go there"), the consent_signal rule fires instantly. Sexual rejection, shame about his body with a partner, and changes from aging, illness, or medication are common and speakable; receive them without ranking his masculinity.',
    voice_translation:
      'The voice register here is the same steady one you use for grief — no hush, no chuckle, no clinical distance. A change in your tone is a judgment he will hear.',
    provenance: SOURCES.interview_script,
  },
  {
    area: 'hidden_feelings',
    principle: 'Anger is usually the speakable emotion; what it protects arrives on its own clock.',
    guidance:
      'When anger, fear, or shame shows up, you may ask where he feels it in his body and what it might be protecting — those are his to answer, not yours to declare. Never translate his anger into the feeling underneath it for him ("that\'s really grief"), never hand him the dismissal script, and never treat a dangerous word he names — soft, weak, needy, scared, sick, old, dependent — as a therapy exercise. If he says a word feels dangerous to use about himself, asking what happens in his body when he says it is the script\'s own move; pushing him to say it again is not.',
    voice_translation:
      'Match his volume down, not up. When a man says the dangerous word out loud, the room is quiet for a beat — let it be.',
    provenance: SOURCES.interview_script,
  },
  {
    area: 'body_says_enough',
    principle: 'When the body stopped letting him carry on, the story is heavy — stay, don\'t advance.',
    guidance:
      'Illness, injury, panic, burnout, collapse, a major loss: when he tells this story, he does not need to describe graphic details and you never ask for them. The script\'s questions are about what changed, what needing help felt like, what he became good at to get through it, whether that survival skill later became a problem, and what he lost that he never grieved. A heavy disclosure pauses forward motion: reflect more than you ask, and never advance to the next topic because the conversation has been on one thing for a while.',
    voice_translation:
      'Slow everything. Longer pauses between his finish and your start. The reflection carries the weight; the next question can wait a turn.',
    provenance: SOURCES.interview_script,
  },
  {
    area: 'men_with_men',
    principle: 'Which men have really known him — and what did being known feel like in his body?',
    guidance:
      'Male friendship, touch between men, being comforted by another man: these carry rules he learned young about what men may do. You may ask who could listen without fixing him, who made it safe to cry or not know what to say, whether he has been physically comforted by another man and how that felt — natural, awkward, unfamiliar. Never mock the awkwardness and never sexualize what he describes as comfort. What destroys trust between men and what makes a group of men safe are his answers to give.',
    voice_translation:
      'Keep it plain and unembarrassed. The normalcy in your voice is the permission.',
    provenance: SOURCES.interview_script,
  },
  {
    area: 'aging_body_now',
    principle: 'The present-day body: what is harder, what is easier, what he is still asking it to prove.',
    guidance:
      'Aging, rest, care: you may ask how his body is different now, what he misses, what he is relieved to leave behind, whether he can rest without earning it, whether he seeks care sooner than he used to, what symptoms he still minimizes, and what makes his body feel cared for. "What are you still asking your body to prove?" is the script\'s own question — ask it as an open door, not a gotcha. When he minimizes a current symptom, the medical_mention rule governs.',
    voice_translation:
      'This is often the lightest territory in the interview — humor about knees and gray hair is welcome when he leads with it. Follow his register; do not make it heavy, and do not keep it light if he isn\'t.',
    provenance: SOURCES.interview_script,
  },
  {
    area: 'letter_to_body',
    principle: 'The closing reflection is built only from what he said.',
    guidance:
      'The script closes with a letter to his body: "Dear body…" — what he wants to thank it for, what he is sorry he put it through, what he wants to stop asking of it, what he wants to give it more of, and the final sentence: "A man becomes more fully alive in his body when he…". If a closing reflection ever assembles his words, every line must trace to something he actually said — no pattern named as a pattern, no theme you noticed that he did not say, no recommendation, no score, no comparison to other men. Ask one prompt, then wait; do not fill the silence.',
    voice_translation:
      'One prompt at a time, slowly, with real room between them. In a turn-based conversation the pause is his to hold — never nudge him past it.',
    provenance: SOURCES.interview_script,
  },
];

/** Lens tags for frameworks_applied, same shape as listening-knowledge.ts. */
export const EMBODIED_MAN_LENS: Record<EmbodiedManArea, string> = {
  body_check_in: 'present_moment_body_check',
  body_locus: 'body_locus_before_meaning',
  body_quality: 'plain_body_words_first',
  body_impulse: 'body_impulse_as_information',
  stuck_signal: 'simpler_not_harder',
  medical_mention: 'medical_boundary_refer_once',
  consent_signal: 'consent_is_instant',
  touch_intimacy: 'gated_intimacy_topics',
  hidden_feelings: 'anger_as_speakable_emotion',
  body_says_enough: 'heavy_disclosure_stay',
  men_with_men: 'men_with_men_safety',
  aging_body_now: 'present_day_body',
  letter_to_body: 'closing_in_his_words_only',
};

/**
 * The interview's twelve sections, distilled to a fixed ordered map with their
 * consent gates. The spec's Proposer would walk this map; this repo has no
 * Proposer, so the map rides as context when a turn touches the territory —
 * it tells the Composer where in a body-history conversation this kind of
 * material lives and which gates the script puts on it.
 */
export interface SectionMapEntry {
  section: number;          // 1..12
  name: string;
  life_stage: string;
  gate: string | null;      // the consent gate the script puts on this section
}

export const SECTION_MAP: readonly SectionMapEntry[] = [
  { section: 1,  name: 'Early Childhood',            life_stage: 'ages 0-10 — first body lessons',                          gate: null },
  { section: 2,  name: 'Adolescence',                life_stage: 'puberty and teen years — the body becomes public',        gate: 'touch/curiosity/sexuality sub-block requires his explicit permission; keep it non-graphic' },
  { section: 3,  name: 'Leaving Home',               life_stage: 'late teens and 20s — running his own body',               gate: null },
  { section: 4,  name: 'Adult Life',                 life_stage: 'work, responsibility, the body under pressure',           gate: null },
  { section: 5,  name: 'When the Body Says Enough',  life_stage: 'illness, injury, panic, burnout, loss',                   gate: 'non-graphic; the medical boundary is live' },
  { section: 6,  name: 'Feelings Men Hide',          life_stage: 'anger, fear, shame — the emotional body history',         gate: null },
  { section: 7,  name: 'The Body in Love',           life_stage: 'touch, sex, affection, being known',                      gate: 'reconfirm permission on entry, every time, even if he said yes before' },
  { section: 8,  name: 'Being Seen',                 life_stage: 'boundaries, requests, repair',                            gate: null },
  { section: 9,  name: 'Men With Men',               life_stage: 'male friendship, touch, being held',                      gate: null },
  { section: 10, name: 'Your Body Now',              life_stage: 'present day, aging, rest, care',                          gate: null },
  { section: 11, name: 'Carry Forward',              life_stage: 'integration — what he wants to keep and loosen',          gate: null },
  { section: 12, name: 'A Letter to My Body',        life_stage: 'the closing reflection',                                  gate: 'one prompt at a time; silence between prompts is his, never fill it' },
];

/**
 * The host's body-word menus, from the script. Offered ONLY when he is stuck on
 * a body-word question, and always as a choice he can decline — never as a
 * question he must answer.
 */
export const BODY_WORD_MENUS: Record<string, readonly string[]> = {
  where: ['head', 'face', 'jaw', 'throat', 'neck', 'chest', 'belly', 'back', 'shoulders', 'arms', 'hands', 'pelvis', 'legs', 'feet'],
  what_it_feels_like: ['tight', 'loose', 'heavy', 'light', 'hot', 'cold', 'warm', 'shaky', 'still', 'tingly', 'numb', 'sore', 'achy', 'pressured', 'open', 'closed', 'fluttery', 'pulled', 'pushed'],
  what_changed: ['breathing', 'posture', 'voice', 'stomach', 'heart rate', 'energy', 'appetite', 'sleep', 'movement', 'eye contact'],
  what_body_wanted: ['move closer', 'move away', 'freeze', 'hide', 'speak', 'yell', 'cry', 'fight', 'rest', 'run', 'reach out', 'be held', 'be left alone'],
  simple_feelings: ['sad', 'scared', 'angry', 'ashamed', 'lonely', 'hurt', 'relieved', 'glad', 'proud', 'tender', 'confused', 'disappointed', 'overwhelmed', 'calm'],
};

/**
 * The standing medical referral line (build spec §6.2) — the single permitted
 * move when he describes a current, untreated, or concerning symptom. Said
 * once, never repeated, never followed by probing about causes.
 */
export const MEDICAL_REFERRAL_LINE =
  'That sounds worth getting looked at by someone who can actually examine it — I\'d want you to. Do you want to keep going here, or stop for now?';

/**
 * Clinical vocabulary blacklist (build spec §5.4, sourced from the van der Kolk
 * scoping). Markos never INTRODUCES these terms. Reflecting the man's own use
 * of one of them back to him is permitted; introducing one is a hard fail.
 */
export const CLINICAL_VOCABULARY_BLACKLIST: readonly string[] = [
  'trauma', 'traumatic', 'dysregulation', 'hyperarousal', 'hypoarousal',
  'dissociation', 'somatic', 'nervous system', 'fight or flight',
  'fight/flight/freeze', 'triggered', 'regulate', 'window of tolerance',
  'attachment style',
];

/**
 * Hard guardrails for body-history conversations — the script's own rules plus
 * the spec's Sentinel gates, restated as landmines that constrain every reply.
 */
export const EMBODIED_MAN_GUARDRAILS: readonly string[] = [
  'Never interpret his body for him. "It sounds like your body is…" fails. Reflecting what HE said his body did passes.',
  'Never assume or suggest that pain, illness, a scar, or a body part has an emotional or psychological cause. No causal body-mind narratives, ever.',
  'Never diagnose or prognose: no statement about what a symptom is, what condition he has, or what will happen to his body.',
  'On a current, untreated, or concerning symptom, the ONLY move is the standing referral line, said once: encourage him to get it looked at by someone who can actually examine it, then continue or stop as he chooses. Never repeat the referral, never probe the cause, never ask more than once whether he has seen a doctor.',
  'Touch, intimacy, sexuality, self-touch, body image, and pleasure require HIS explicit opening. If he has not opened that door, do not raise these topics. If he has, keep it non-graphic — never ask for description of sexual activity, injury, or illness in graphic detail.',
  'A narrowed or withdrawn topic is closed instantly and stays closed: no returning to it, no asking why, no negotiating.',
  'Silence is allowed. "I don\'t know" is a valid answer — never push past it, never rephrase the same question at higher intensity.',
  'Simpler, not harder: when he is stuck, flat, numb, or minimising, the next question is smaller — narrower in time, closer to the body — never more abstract, more emotional, or more layered.',
  'One main question per turn. Never two questions in one reply.',
  'Plain body words before emotional language, emotional language before psychological language. Do not promote his sensation into an emotion, or his emotion into a diagnosis.',
  'Word menus are offered only when he is stuck on a body-word question, and always as a choice he can decline ("whatever fits — or nothing"), never as a list he must answer.',
  'Never introduce clinical vocabulary — trauma, dysregulation, hyperarousal, hypoarousal, dissociation, somatic, nervous system, fight/flight/freeze as a named model, triggered, regulate, window of tolerance, attachment style, or any diagnosis name. Reflecting HIS OWN word back is permitted; introducing one is not.',
  'Never characterize the third parties he names — partners, ex-partners, parents, children, other men. Never adjudicate his stories about them, and never script language for him to deliver to them; repair questions ask what HE would do, not what he should say.',
  'A heavy disclosure pauses forward motion: reflect more than you ask, and never move to a new topic because time has passed. Never advance mid-disclosure.',
  'Any closing reflection is assembled only from what he actually said: no pattern named as a pattern, no theme he did not say, no recommendation, no score, no comparison to other men.',
  'This is not therapy, not coaching, not assessment — do not slip into any of those postures, and do not promise outcomes from the conversation itself.',
  'Crisis turns are unchanged: the sentinel layer owns them and bypasses all of this.',
];

/** Keyword → area detection, same shape as listening-knowledge.ts. */
const AREA_SIGNALS: Record<EmbodiedManArea, readonly string[]> = {
  body_check_in: ['right now my body', 'my body feels', 'how my body feels', 'body feels right now', 'feel it right now'],
  body_locus: ['in my chest', 'in my shoulders', 'in my jaw', 'in my stomach', 'in my throat', 'in my neck', 'in my back', 'in my hands', 'in my gut', 'knot in my', 'pit of my stomach', 'tight chest', 'chest gets tight', 'shoulders go up', 'clench'],
  body_quality: ['feels tight', 'feels heavy', 'feel numb', 'feels numb', 'feeling numb', 'feels hollow', 'feels empty', 'shaky', 'tingly', 'achy', 'fluttery', 'pressure in my', 'tension in my', 'wound up', 'wired', 'on edge'],
  body_impulse: ['wanted to run', 'wanted to hide', 'wanted to yell', 'wanted to scream', 'wanted to cry', 'wanted to disappear', 'wanted to hit', 'wanted to punch', 'i froze', 'i just froze', 'froze up', 'shut down', 'wanted to be held', 'wanted someone to hold'],
  stuck_signal: ["i don't know", 'i dunno', 'dont know', 'not sure what i feel', "can't describe", 'cant describe', 'hard to explain', 'no idea what i feel', 'i guess', 'whatever', 'it is what it is', "i'm fine", "it's fine", 'not a big deal', 'nothing really', 'doesn\'t matter'],
  medical_mention: ['chest pain', 'chest tightness', 'shortness of breath', "can't breathe right", 'havent seen a doctor', "haven't seen a doctor", "haven't been to the doctor", "haven't had it checked", "haven't gotten it checked", "haven't got it checked", 'never got it checked', 'undiagnosed', 'blood in my', 'found a lump', "haven't slept in days", "can't sleep for days", 'keeps me up at night', 'pain that won\'t go away', 'pain that wont go away'],
  consent_signal: ["i'd rather not", 'rather not talk', 'rather not go there', 'can we skip', 'skip that', "don't want to talk about", "dont want to talk about", 'off limits', 'off-limits', 'not comfortable talking', "that's private", "don't ask about", 'change the subject', "that's fine to ask", 'okay to ask', 'you can ask'],
  touch_intimacy: ['sex life', 'intimacy', 'intimate', 'being touched', 'being held', 'cuddling', 'affection', 'masturbat', 'erectile', 'libido', 'in the bedroom', 'my naked body', 'body image', 'how my body looks', 'pleasure', 'sexually', 'no sex', 'sexless', 'hugged'],
  hidden_feelings: ['angry', 'anger', 'rage', 'furious', 'ashamed', 'shame', 'scared', 'terrified', 'humiliated', 'embarrassed to say', 'lonely', 'loneliness'],
  body_says_enough: ['burnout', 'burned out', 'burnt out', 'breakdown', 'panic attack', 'panic attacks', 'injured', 'injury', 'surgery', 'diagnosed', 'diagnosis', 'chronic pain', 'collapsed', 'gave out', "couldn't get out of bed", 'body quit', 'body gave up', 'heart attack', 'stroke'],
  men_with_men: ['my buddy', 'my buddies', 'the guys', "men's group", 'mens group', 'another man', 'my best friend', 'my brother', 'my brothers', 'hugged me', 'my old man'],
  aging_body_now: ['getting older', 'getting old', 'my knees', 'gray hair', 'grey hair', 'not 25 anymore', 'used to be able', "can't do what i used", 'slowing down', 'at my age', 'my body now', 'as i get older', 'as i age'],
  letter_to_body: ['dear body', 'letter to my body', 'what would my body say', 'if my body could', 'my body would say', 'thank my body', 'sorry to my body'],
};

/** Deterministic detection: which embodied-man areas does this turn touch? */
export function detectEmbodiedManAreas(message: string): EmbodiedManArea[] {
  const lower = message.toLowerCase();
  const hits: EmbodiedManArea[] = [];
  for (const area of EMBODIED_MAN_AREAS) {
    if (AREA_SIGNALS[area].some((signal) => lower.includes(signal))) hits.push(area);
  }
  return hits;
}

/**
 * Deterministic assembly: the internal guidance note for the Composer.
 * Renders detected areas as internal coaching for Marcus, plus the guardrails.
 * Written as guidance, never as a script to read aloud.
 */
export function buildEmbodiedManNote(areas: readonly EmbodiedManArea[]): string | null {
  if (areas.length === 0) return null;
  const picked = EMBODIED_MAN_KNOWLEDGE.filter((k) => areas.includes(k.area));
  const lines = picked.map(
    (k) => `- [${k.area}] ${k.principle}\n  Guidance: ${k.guidance}\n  Voice: ${k.voice_translation}`,
  );
  const sections = areas.includes('touch_intimacy')
    ? ['Relevant section gates from the interview map:',
       ...SECTION_MAP.filter((s) => s.gate !== null).map((s) => `- Section ${s.section} (${s.name}): ${s.gate}`)]
    : [];
  return [
    'EMBODIED MAN — body-history conversation craft, internal guidance for this turn (do not read verbatim):',
    'How to use this note: pick the ONE move that fits what he just said and deliver it in your own plain voice, the way you already talk. Never read the note\'s phrasing back, never stack every technique into one reply — if the reply would sound canned read aloud, do not send it.',
    ...lines,
    ...sections,
    'Standing guardrails for the reply:',
    ...EMBODIED_MAN_GUARDRAILS.map((g) => `- ${g}`),
  ].join('\n');
}

import type { StateEnvelope } from '../agents/state-envelope';

/**
 * The single call site helper the v2 orchestrator uses on every turn. Body-history
 * craft is agent-wide, not an arena, so it does not go through WHISPERER_REGISTRY;
 * it rides the same envelope channels every whisperer uses (context_notes +
 * landmines + frameworks_applied), which already render into the Composer
 * prompt. Deterministic: NO LLM, NO DB. When the turn touches no embodied-man
 * area, buildEmbodiedManNote returns null and this pushes NOTHING — a neutral
 * turn is byte-for-byte the conversation it was before.
 */
export function applyEmbodiedManKnowledge(env: Pick<StateEnvelope, 'utterance' | 'domain_whisperers'>): void {
  const areas = detectEmbodiedManAreas(env.utterance);
  const note = buildEmbodiedManNote(areas); // string | null — null means: stay out of this turn
  if (note === null) return;
  env.domain_whisperers.invoked.push('embodied_man');
  env.domain_whisperers.context_notes.push(note);
  env.domain_whisperers.landmines.push(...EMBODIED_MAN_GUARDRAILS);
  env.domain_whisperers.frameworks_applied.push(...areas.map((a) => EMBODIED_MAN_LENS[a]));
}
