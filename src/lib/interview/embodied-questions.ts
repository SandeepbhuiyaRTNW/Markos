/**
 * Embodied Man Interview — the question content (the move bank).
 *
 * Source: "The Embodied Man Interview — Body History Edition" (the full script,
 * transcribed as embodied_man_interview_extracted.md) and "The Embodied Man
 * Interview Build Specification — Draft 0.1", both provided by Vikas on
 * 2026-09-22 as the content the interview session machinery (session.ts) was
 * waiting for. The question text below is VERBATIM from the script; only
 * podcast framing that has no meaning in the app ("My guest today is [NAME]",
 * "on-mic"/"off-mic") is left out.
 *
 * Three tiers, as the build spec (§5.2, §7) defines them:
 *   main       — must be asked or deliberately skipped, in order, asked as
 *                written (minimal adaptation to his name/situation only).
 *   follow_ups — optional. At most ONE per turn, chosen by relevance to what he
 *                just said, never in list order, never all of them.
 *   menus      — "if needed" word lists. Offered ONLY when he is stuck ("I don't
 *                know", silence) on a body-word question, and offered as
 *                choices ("you can keep it simple — tight, heavy, numb, whatever
 *                fits"), never as a question he must answer.
 *
 * Pure data + deterministic string assembly. No LLM, no DB, no network.
 */

export interface MainQuestion {
  text: string;
  /** Word menu for this question, offered only when he is stuck. */
  if_needed?: string;
  /** A scripted continuation the host may ask right after this question. */
  then_ask?: string;
}

export interface SubBlock {
  name: string;
  /** Only with his explicit permission (touch/sexuality). */
  gated: boolean;
  instruction?: string;
  main: readonly MainQuestion[];
  follow_ups?: readonly string[];
}

export interface SectionContent {
  section: number;          // 1..12
  title: string;            // the script's own section title
  budget: string;           // minutes, a guide for pacing — never a timer
  host_aside?: string;      // host framing or scope note from the script
  main: readonly MainQuestion[];
  follow_ups: readonly string[];
  sub_blocks?: readonly SubBlock[];
}

/** Before Recording: boundaries set before the interview begins (spec §4.1 BEFORE_RECORDING). */
export const BEFORE_RECORDING: readonly string[] = [
  'Before we start, is there anything you do not want to talk about, or anything you want me to handle carefully?',
  'Are you comfortable with questions about touch, affection, body image, pleasure, and sexuality if they come up? You can skip any of them or change your mind at any time.',
  'Are there words you would rather I not use? For example: trauma, vulnerability, weakness, softness, illness, masculinity, or sexuality?',
];

/** Opening framing (spec §4.1 OPENING), adapted from the script's welcome. */
export const OPENING_FRAMING =
  'We are not trying to define the right way to be a man. We are asking a simpler question: What has your body lived through, and what have you learned from living in it?';

export const OPENING_CHECK_IN: MainQuestion = {
  text: 'Before we go back into your history, how does your body feel right now?',
  if_needed: 'You can keep it simple: tight, relaxed, tired, restless, warm, numb, comfortable, hungry, sore, calm — whatever fits.',
};

/** The script's body-word guide — the menus offered when he does not know what he feels. */
export const BODY_WORD_GUIDE: Readonly<Record<string, string>> = {
  where: 'head, face, jaw, throat, neck, chest, belly, back, shoulders, arms, hands, pelvis, legs, feet',
  feels_like: 'tight, loose, heavy, light, hot, cold, warm, shaky, still, tingly, numb, sore, achy, pressured, open, closed, fluttery, pulled, pushed',
  what_changed: 'breathing, posture, voice, stomach, heart rate, energy, appetite, sleep, movement, eye contact',
  wanted_to_do: 'move closer, move away, freeze, hide, speak, yell, cry, fight, rest, run, reach out, be held, be left alone',
  feeling_words: 'sad, scared, angry, ashamed, lonely, hurt, relieved, glad, proud, tender, confused, disappointed, overwhelmed, calm',
};

/** Spec §6.2: the single authored referral line, emitted once when he describes a concerning or untreated symptom. */
export const MEDICAL_REFERRAL_LINE =
  'That sounds worth getting looked at by someone who can actually examine it — I’d want you to. Do you want to keep going here, or stop for now?';

/** Spec §5.4: clinical vocabulary he may use first, but Markos never introduces. */
export const CLINICAL_BLACKLIST: readonly string[] = [
  'trauma', 'traumatic', 'dysregulation', 'hyperarousal', 'hypoarousal', 'dissociation',
  'somatic', 'nervous system', 'fight/flight/freeze', 'triggered', 'regulate',
  'window of tolerance', 'attachment style',
];

/** Spec §4.2 + script §7: the only permitted first turn of Section 7. */
export const SECTION_7_CONSENT_CHECK =
  'Are you still comfortable talking about touch, affection, pleasure, and sexuality? We can keep this broad or skip anything.';

export const EMBODIED_SECTIONS: readonly SectionContent[] = [
  {
    section: 1, title: 'Early Childhood: Your First Body Lessons', budget: '7–9 min',
    main: [
      { text: 'What are your earliest memories of living in your body?' },
      { text: 'When you think about that younger body now, what do you notice in yourself?',
        if_needed: 'Does anything tighten? Soften? Get heavy? Warm? Do you want to smile, move away, or get quiet?' },
    ],
    follow_ups: [
      'Were you an active kid, a quiet kid, a sick kid, a strong kid, a sensitive kid, or something else?',
      'What did adults say about your body?',
      'Were you hugged, held, cuddled, wrestled with, or comforted physically?',
      'What happened when you cried, got hurt, got scared, or said something hurt?',
      'Were you allowed to rest when you were tired or sick?',
      'Was your body treated with privacy, shame, humor, pride, or curiosity?',
      'What did you learn about nudity and being seen?',
      'What did boys learn about being "tough"?',
      'Who made you feel safe in your body? Who made you feel watched or judged?',
    ],
  },
  {
    section: 2, title: 'Adolescence: The Body Becomes Public', budget: '8–10 min',
    main: [
      { text: 'When puberty began changing your body, what did you start to learn about what a male body was supposed to look like and do?' },
      { text: 'Can you remember a time as a teenager when your body was telling you something and you ignored it?' },
      { text: 'Can you remember a time when your body felt really good — strong, fast, comfortable, attractive, playful, or simply yours?' },
    ],
    follow_ups: [
      'What kinds of boys were admired?',
      'What kinds of bodies were mocked?',
      'Did height, weight, muscle, athletic ability, penis size, hair, skin, disability, or coordination affect how boys were treated?',
      'Did you compare your body with other boys?',
      'What did sports, coaches, school, religion, peers, pornography, or media teach you?',
      'Were you expected to take pain quietly?',
      'Did you learn to push through tiredness, injury, hunger, fear, or embarrassment?',
      'What did "soft," "weak," "fat," "skinny," "gay," "girly," or "not man enough" mean in your world?',
      'Did you feel proud of your body, embarrassed by it, disconnected from it, or all of those at different times?',
    ],
    sub_blocks: [{
      name: 'Touch, curiosity, and sexuality in adolescence', gated: true,
      instruction: 'Use only if permission was given. Keep it non-graphic.',
      main: [{ text: 'What did you learn as a teenager about touching your own body, sexual curiosity, masturbation, desire, and pleasure?' }],
      follow_ups: [
        'Was it talked about, joked about, shamed, ignored, or treated as normal?',
        'Did you learn sex as connection, performance, conquest, danger, release, proof of manhood, or something else?',
        'Did you feel free to ask questions about your body?',
        'Were there parts of your body you learned to hide or judge?',
      ],
    }],
  },
  {
    section: 3, title: 'Leaving Home: Learning to Run Your Own Body', budget: '7–9 min',
    main: [
      { text: 'When you became responsible for yourself, what kind of relationship did you develop with your body?' },
      { text: 'What is one early-adult moment when you clearly remember pushing your body past what it wanted?',
        then_ask: 'What did it feel like at the time? Tight? Wired? Sick? Numb? Exhausted? What did you tell yourself so you could keep going?' },
      { text: 'What did pushing through give you? And what did it cost?' },
    ],
    follow_ups: [
      'How did sleep, food, alcohol, substances, exercise, sex, work, and stress change?',
      'Did you start listening to your body more — or less?',
      'What did you do when you were exhausted?',
      'Did you ask for help or just push through?',
      'What did independence mean physically?',
      'Did your body become a project to improve, discipline, control, or prove something through?',
    ],
  },
  {
    section: 4, title: 'Adult Life: Work, Responsibility, and the Body Under Pressure', budget: '8–10 min',
    main: [
      { text: 'As adult responsibilities grew, what did your body learn it had to do?' },
      { text: 'When you are under pressure now, where do you usually feel it first?',
        if_needed: 'jaw, throat, chest, stomach, shoulders, back, hands, breathing, headaches, fatigue, numbness, restlessness.' },
      { text: 'What does it feel like there?' },
      { text: 'What do you usually do next?' },
      { text: 'What do you think you actually need in that moment?' },
    ],
    follow_ups: [
      'Work longer?',
      'Sleep less?',
      'Stay calm for everyone else?',
      'Carry more responsibility?',
      'Hide fear or uncertainty?',
      'Become harder, quieter, faster, more controlling, or more useful?',
    ],
    sub_blocks: [{
      name: 'A simple "sensation before story" sequence', gated: false,
      instruction: 'Use this with one recent, manageable example. Do not start with the worst event in his life. One step per turn.',
      main: [
        { text: 'What happened — just the facts?' },
        { text: 'What was the first thing you felt in your body?' },
        { text: 'Where was it?' },
        { text: 'What did it feel like?' },
        { text: 'What feeling came with it — scared, angry, hurt, ashamed, lonely, something else?' },
        { text: 'What did your mind tell you was happening?' },
        { text: 'What did your body want to do?' },
        { text: 'What did you need?' },
        { text: 'What did you do?' },
      ],
    }],
  },
  {
    section: 5, title: 'When the Body Says "Enough"', budget: '9–11 min',
    host_aside: 'This might be illness, injury, panic, exhaustion, chronic pain, disability, surgery, a major loss, a breakup, burnout, or another life event. He does not need to describe graphic details.',
    main: [
      { text: 'Was there a time when your body stopped letting you carry on in the same way?' },
      { text: 'What did you become good at to get through that time?' },
      { text: 'Did that survival skill later become a problem?' },
      { text: 'What did you lose during that period that you never really grieved?',
        if_needed: 'a person, relationship, body, role, career, home, future, trust, sexuality, confidence, time, safety, or a version of yourself.' },
      { text: 'How does grief show up in your body?' },
      { text: 'What remains unsaid or unfinished?' },
    ],
    follow_ups: [
      'What changed physically?',
      'What did you first think was happening?',
      'Did you seek care right away or wait?',
      'What made it hard to stop?',
      'What did needing help feel like?',
      'Did you feel weak, relieved, frightened, angry, ashamed, cared for, or something else?',
      'Did you trust your body less afterward — or more?',
      'What did that experience change about your idea of strength?',
    ],
  },
  {
    section: 6, title: 'Anger, Fear, Shame, and the Feelings Men Hide', budget: '7–9 min',
    main: [
      { text: 'Looking back over your life, which feelings were easiest for you to show — and which were hardest?',
        if_needed: 'sad, scared, angry, ashamed, lonely, hurt, helpless, relieved, tender, proud, confused.' },
      { text: 'Which feeling usually comes out as something else?' },
      { text: 'Where do you feel anger in your body?' },
      { text: 'What is your anger trying to protect?' },
      { text: 'What would you want anger to help you say without hurting or shrinking another person?' },
      { text: 'Is there a word that still feels dangerous to use about yourself — soft, weak, needy, scared, sick, old, dependent, feminine, queer, something else?' },
      { text: 'What happens in your body when you say that word?' },
    ],
    follow_ups: [
      'Does fear become control?',
      'Does shame become silence or overwork?',
      'Does sadness become numbness?',
      'Does loneliness become withdrawal?',
      'Does anger become aggression, sarcasm, silence, or distance?',
    ],
  },
  {
    section: 7, title: 'The Body in Love: Touch, Sex, Affection, and Being Known', budget: '10–12 min',
    main: [
      { text: 'How have your close relationships changed the way you feel about your body?' },
      { text: 'When do you feel most at home in your body with another person?' },
      { text: 'What would intimacy look like if you did not have to prove anything?' },
    ],
    follow_ups: [
      'When have you felt most comfortable being touched?',
      'What kinds of nonsexual touch feel natural: hugging, holding hands, cuddling, massage, sleeping close, a hand on the shoulder?',
      'What kinds of touch feel uncomfortable or complicated?',
      'Can you receive affection without feeling that you have to perform or turn it into sex?',
      'Can you tell a partner what feels good and what does not?',
      'Have you ever felt ashamed of your body with a partner?',
      'Have aging, illness, medication, stress, parenting, disability, or relationship conflict changed your sex life or desire?',
      'Have you ever experienced sexual rejection as a judgment of your masculinity?',
      'What have relationships taught you about desire, tenderness, pleasure, boundaries, and consent?',
      'How does your sexual orientation shape the way you have understood masculinity and your body?',
    ],
  },
  {
    section: 8, title: 'Being Seen: Boundaries, Requests, and Repair', budget: '7–9 min',
    main: [
      { text: 'Who has been able to tell when something was wrong with you before you said it?' },
      { text: 'Have you expected other people to read your silence?' },
      { text: 'What have you had trouble asking for?',
        if_needed: 'help, time, reassurance, touch, space, sex, less sex, rest, medical care, forgiveness, practical help, or simply someone to listen.' },
      { text: 'Think of a relationship where you stayed silent too long. What did you need to say?' },
      { text: 'What boundary did you need?' },
      { text: 'What were you afraid would happen if you said it?' },
    ],
    follow_ups: [],
    sub_blocks: [
      {
        name: 'Practice one honest sentence', gated: false,
        instruction: 'Optional structure if he wants it: "When ___ happened, I felt ___ in my body. I felt ___. What I needed was ___. What I want to say now is ___."',
        main: [
          { text: 'Finish this sentence slowly: "What I have not known how to say is..."' },
          { text: 'What happened in your body as you said that?' },
        ],
      },
      {
        name: 'Repair', gated: false,
        instruction: 'Ask what HE would do. Never draft what he would say to anyone.',
        main: [
          { text: 'Is there someone who experienced the cost of your silence, anger, overwork, control, or distance?' },
          { text: 'What can you take responsibility for without taking responsibility for everything?' },
          { text: 'What would a real repair require you to do differently, not just say differently?' },
        ],
      },
    ],
  },
  {
    section: 9, title: 'Men With Men: Friendship, Touch, and Being Held', budget: '6–8 min',
    main: [
      { text: 'Which men in your life have really known you?' },
      { text: 'How does your body know when another man is really listening to you?' },
      { text: 'What do men need to learn about listening without fixing?' },
    ],
    follow_ups: [
      'Who could listen without trying to fix you?',
      'Who made it safe to cry, be quiet, or not know what to say?',
      'Have you ever been hugged or physically comforted by another man when you were struggling?',
      'Did that feel natural, awkward, sexualized, comforting, or unfamiliar?',
      'What rules did your culture teach you about men touching men?',
      "What makes a men's group or male friendship feel safe instead of performative?",
      'What destroys trust between men?',
    ],
  },
  {
    section: 10, title: 'Your Body Now', budget: '7–9 min',
    main: [
      { text: 'How is your body different now from the body you had at 18, 25, 35, or 45?' },
      { text: 'When do you feel most alive in your body now?' },
      { text: 'What does your body enjoy?' },
      { text: 'What are you still asking your body to prove?' },
    ],
    follow_ups: [
      'What has become harder?',
      'What has become easier?',
      'What do you miss?',
      'What are you relieved to leave behind?',
      'How has your relationship with weight, strength, appearance, sexuality, energy, or pain changed?',
      'What does your body ask of you now that it did not ask when you were younger?',
      'Can you rest without earning it?',
      'Do you seek care sooner now?',
      'What symptoms do you still minimize?',
      'What kinds of movement, food, sleep, touch, work, or rest make your body feel cared for?',
    ],
  },
  {
    section: 11, title: 'What You Want to Carry Forward', budget: '5–7 min',
    host_aside: 'Built from call-backs: where it fits, use his own words from earlier sections.',
    main: [
      { text: 'Looking across your whole body history, what did your body help you survive?' },
      { text: 'What did you ask too much of it?' },
      { text: 'What strengths do you want to keep?' },
      { text: 'What habits or old rules are you ready to loosen?' },
      { text: 'What is one body signal you want to notice earlier?' },
      { text: 'What is one sentence you want to say sooner?' },
      { text: 'Who do you want to reach out to before things become a crisis?' },
      { text: 'What is one thing you want to do differently for your body in the next week?' },
    ],
    follow_ups: [],
  },
  {
    section: 12, title: 'A Letter to My Body', budget: '8–10 min',
    host_aside: 'Framing, in your own plain words: we have talked about his body as a child, a teenager, a young man, an adult under pressure, in relationships, hurt or changed, and now. For the last few minutes, he imagines writing a letter directly to his own body. It does not need to be beautiful; short sentences are fine; grateful, angry, sad, funny, apologetic, confused — whatever is true. Slow down. Ask one prompt, then wait. Do not fill the silence.',
    main: [],
    follow_ups: [],
    sub_blocks: [
      {
        name: 'The letter', gated: false,
        main: [
          { text: 'Start with: "Dear body..." What is the first thing you want to say?' },
          { text: 'What do you want to thank your body for?' },
          { text: 'What are you sorry you put it through?' },
          { text: 'When have you been angry at your body?' },
          { text: 'What have you judged it for?' },
          { text: 'What do you understand now that you did not understand when you were younger?' },
          { text: 'Was there a time your body tried to get your attention and you did not listen? What would you say about that now?' },
          { text: 'What did your body carry for you when you did not have words?' },
          { text: 'What do you want to stop asking your body to do?' },
          { text: 'What do you want to give your body more of?',
            if_needed: 'rest, movement, food, sleep, touch, sex, medical care, quiet, play, challenge, tenderness, time, sunlight, laughter, less alcohol, less work, more friendship.' },
          { text: 'What are you afraid will happen to your body as you grow older?' },
          { text: 'What do you want your relationship with your body to be like from here?' },
          { text: 'Finish this sentence: "Body, from now on, I want you to know..."' },
        ],
      },
      {
        name: 'Let the body answer', gated: false,
        instruction: 'This is imaginative, not medical or mystical — simply another way to hear what he already knows. If he needs a start: "Dear [his name]..."',
        main: [{ text: 'If your body could write one short letter back to you, what do you imagine it would say?' }],
        follow_ups: [
          'What would it ask you to notice sooner?',
          'What would it ask you to stop doing?',
          'What would it ask you to keep doing?',
          'What would it ask you not to be ashamed of anymore?',
          'What would it ask you for right now?',
        ],
      },
      {
        name: 'Final sentence', gated: false,
        main: [{ text: 'After everything we have talked about, complete this sentence: "A man becomes more fully alive in his body when he..."' }],
      },
    ],
  },
];

export function sectionContent(section: number): SectionContent | null {
  return EMBODIED_SECTIONS.find((s) => s.section === section) ?? null;
}

/** Sections where the spec wants shorter turns and a 1:1 reflection-to-question ratio (§5.2, §8.3). */
const HEAVY_SECTIONS = new Set([5, 6, 7, 8, 9, 10, 11, 12]);
const SHORT_TURN_SECTIONS = new Set([5, 7, 8, 12]);

function renderMain(list: readonly MainQuestion[], start = 1): string[] {
  return list.map((q, i) => {
    let line = `  ${start + i}. "${q.text}"`;
    if (q.then_ask) line += ` Then: "${q.then_ask}"`;
    if (q.if_needed) line += ` [menu if stuck: ${q.if_needed}]`;
    return line;
  });
}

/**
 * The question content for one section, as Composer-note lines. Internal
 * guidance only. `includeBeforeRecording` is set for the very first sitting at
 * Section 1, so the boundaries and the present-moment check-in come first.
 */
export function buildSectionContentLines(
  section: number,
  opts: { includeBeforeRecording?: boolean; gatePending?: boolean } = {},
): string[] {
  const c = sectionContent(section);
  if (!c) return [];
  const out: string[] = [];
  if (opts.includeBeforeRecording) {
    out.push(
      `- FIRST, if this conversation has not covered them yet: the boundary questions, one per turn, then the check-in. Whatever he answers becomes a standing rule for the whole interview (topics to skip, words never to use, whether touch/sexuality may come up at all).`,
      ...BEFORE_RECORDING.map((q, i) => `  B${i + 1}. "${q}"`),
      `  Check-in: "${OPENING_CHECK_IN.text}" [menu if stuck: ${OPENING_CHECK_IN.if_needed}] Remember his check-in words; the close calls back to them.`,
    );
  }
  if (section === 7 && opts.gatePending) {
    out.push(`- If you have not asked it yet in this section, your turn is this consent check and nothing else, even if he said yes before: "${SECTION_7_CONSENT_CHECK}" Once he has answered, follow his answer: if he narrows or says no, keep it broad or skip what he names.`);
  }
  out.push(`- Section ${c.section} — ${c.title} (about ${c.budget}; a guide, never a timer).`);
  if (c.host_aside) out.push(`- Host note: ${c.host_aside}`);
  if (c.main.length > 0) {
    out.push(`- MAIN QUESTIONS, in order, one per turn, asked as written (each asked or skipped if he declines). Check the conversation for which you have already asked:`);
    out.push(...renderMain(c.main));
  }
  if (c.follow_ups.length > 0) {
    out.push(`- Optional follow-ups — pick at most ONE per turn, only if it fits what he just said, never in list order, never all: ${c.follow_ups.map((f) => `"${f}"`).join(' ')}`);
  }
  for (const b of c.sub_blocks ?? []) {
    const gate = b.gated ? ' ONLY if he plainly said yes to touch/sexuality questions — otherwise skip this block without comment.' : '';
    out.push(`- ${b.name}:${gate}${b.instruction ? ` ${b.instruction}` : ''}`);
    out.push(...renderMain(b.main));
    if (b.follow_ups && b.follow_ups.length > 0) {
      out.push(`  Optional follow-ups (at most one per turn): ${b.follow_ups.map((f) => `"${f}"`).join(' ')}`);
    }
  }
  if (SHORT_TURN_SECTIONS.has(section)) {
    out.push(`- Keep your turns short here: one sentence that is a question, at most.`);
  }
  if (HEAVY_SECTIONS.has(section)) {
    out.push(`- The material is heavier from here: reflect what he said at least as often as you ask.`);
  }
  if (section === 12) {
    out.push(`- When the letter and the final sentence are done, close: thank him plainly, and if it fits, set his opening check-in words next to how his body feels now — in HIS words only, no interpretation.`);
  }
  return out;
}

/** The standing host rules from the script and build spec §3, §5.3, §5.4, §6.2 — compact. */
export const HOST_RULES: readonly string[] = [
  `- One question per turn, always. Plain body words before feeling words; feeling words before anything psychological.`,
  `- Never tell him what his body means, holds, remembers, or is trying to say ("it sounds like your body is..." is out). Reflecting what HE said his body did is fine. Never link a pain, illness, scar, or body part to an emotional cause.`,
  `- "I don't know" and silence are valid answers. If he is stuck, make the question simpler, not harder — a narrower body question or the menu offered as choices, never a harder or more abstract question.`,
  `- Body-word guide, offered as choices only when he is stuck on a body question (never as a list to answer): where — ${BODY_WORD_GUIDE.where}; what it feels like — ${BODY_WORD_GUIDE.feels_like}; what it wanted to do — ${BODY_WORD_GUIDE.wanted_to_do}; simple feeling words — ${BODY_WORD_GUIDE.feeling_words}.`,
  `- Stay with a rich answer. Never move on mid-disclosure or with a thread he raised still open. Do not fill silence.`,
  `- Honor anything he asked to skip and any word he asked you not to use, for the whole interview. Do not introduce clinical words (${CLINICAL_BLACKLIST.join(', ')}, or any diagnosis); you may reflect them only if he used them first. The one exception is the boundary question's own example list, asked as written.`,
  `- If he describes a current, untreated, or concerning symptom, say this once, then follow his choice, and never probe the symptom again: "${MEDICAL_REFERRAL_LINE}"`,
  `- Never characterize the people he names, and never write words for him to say to them. No graphic detail about injury, illness, or sex, ever.`,
  `- If he says anything about wanting to die, not being here, or hurting himself or someone else, the interview stops mattering: the crisis guidance outranks everything in this note.`,
];
