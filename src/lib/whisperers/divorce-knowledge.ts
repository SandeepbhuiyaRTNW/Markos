/**
 * Divorce Domain Knowledge — curated, jurisdiction-neutral orientation content.
 * Spec: docs/specs/divorce-domain-knowledge-spec.md (Phase 1 knowledge areas).
 *
 * WHAT THIS IS
 * ------------
 * A single, reviewable corpus of ORIENTATION content — how the process generally
 * works, what the words mean, what to expect emotionally and practically. It is
 * NOT legal, financial, custody, or clinical ADVICE. The standing line the whole
 * module is built around: **Markos orients; professionals advise.**
 *
 * Deepened 2026-09-03 with the four divorce references the founder provided via
 * Google Drive: Hetherington & Kelly's outcome research (For Better or For
 * Worse), McKay et al.'s practical guide (The Divorce Book), Emery's
 * family-renegotiation frame (Renegotiating Family Relationships), and Maione's
 * co-parenting course text (Children & Divorce). Distilled, not copied.
 *
 * HOW IT REACHES A REPLY (no architecture change)
 * ----------------------------------------------
 * The divorce whisperer (divorce.ts) detects which knowledge area(s) a man's
 * message touches and emits `buildOrientationNote()` DETERMINISTICALLY into the
 * envelope's `domain_whisperers.context_notes`, plus the hard red lines into
 * `landmines`. Those two channels already render into the Composer prompt via
 * `buildEnvelopeContextSummary` (## WHISPERER INTELLIGENCE / ## LANDMINES) and
 * `buildPriorityHierarchy` (PRIORITY 3 — DOMAIN INTELLIGENCE). Because the
 * assembly is deterministic, it works with NO OpenAI key and NO database — the
 * DB-backed channels in the spec (embeddings / questions with a `knowledge_area`
 * tag) are the *scaled* corpus and are seeded separately when a key + Postgres
 * exist; this in-code corpus is what actually orients a live reply today.
 *
 * SAFETY POSTURE
 * --------------
 * Every note is written as INTERNAL guidance to Marcus ("you may orient him on…",
 * "say the disclaimer once…"), never as a script to read verbatim, and never with
 * a jurisdiction-specific claim. The reviewer fields on every provenance record
 * are null: professional review (one family-law attorney + one licensed therapist)
 * is a launch blocker per the spec, not satisfied by this file.
 */

export type KnowledgeArea = 'process' | 'legal_literacy' | 'co_parenting' | 'financial' | 'emotional';

export const KNOWLEDGE_AREAS: readonly KnowledgeArea[] = ['process', 'legal_literacy', 'co_parenting', 'financial', 'emotional'];

/**
 * 3.1 Process orientation — the general arc of a divorce, in plain language.
 * Timelines are ranges with heavy caveats; nothing here is jurisdiction-specific.
 */
export interface ProcessStage {
  stage: string;
  what_it_is: string;
  what_it_feels_like: string;
  can_control: string;
  cannot_control: string;
  timeline: string; // always a rough range with a "varies" caveat
}

export const PROCESS_STAGES: readonly ProcessStage[] = [
  {
    stage: 'Decision & disclosure',
    what_it_is: 'One or both people conclude the marriage is ending, and it gets said out loud.',
    what_it_feels_like: 'Disbelief, dread, relief and grief at once. Often denial and fear dominate.',
    can_control: 'How he says it, who he leans on, whether he gets his own counsel before acting.',
    cannot_control: 'Whether she agrees, how she reacts, the timing she chooses.',
    timeline: 'Highly variable — weeks to years of ambivalence before anyone files.',
  },
  {
    stage: 'Filing & service',
    what_it_is: 'A petition is filed with the court; the other spouse is formally served and responds.',
    what_it_feels_like: 'It becomes real and public. Petitioner vs. respondent is just who filed first — not who is right.',
    can_control: 'Retaining a lawyer, keeping his own records, responding on time.',
    cannot_control: 'Court calendars, procedural rules, the other side\'s filings.',
    timeline: 'Response deadlines are typically a few weeks — but set by each state\'s rules.',
  },
  {
    stage: 'Temporary orders',
    what_it_is: 'Interim arrangements while the case is pending — a temporary parenting schedule, who lives where, interim support.',
    what_it_feels_like: 'A scramble for stability. Temporary is not permanent, but it sets a rhythm.',
    can_control: 'Showing up prepared, documenting his involvement with the kids and the finances.',
    cannot_control: 'What the judge orders on an interim basis.',
    timeline: 'Set early and can last the length of the case — months, sometimes longer.',
  },
  {
    stage: 'Financial disclosure / discovery',
    what_it_is: 'Both sides exchange financial information — income, assets, debts, documents — so everything is on the table.',
    what_it_feels_like: 'Exposing. Anger often spikes here as details surface.',
    can_control: 'Gathering his own documents early, being honest and complete.',
    cannot_control: 'What the other side discloses or how long it takes.',
    timeline: 'A slow stretch — weeks to many months depending on complexity.',
  },
  {
    stage: 'Negotiation or mediation',
    what_it_is: 'The couple, through lawyers or a neutral mediator, tries to reach an agreement instead of a trial.',
    what_it_feels_like: 'Tense bargaining; grief and fatigue underneath the numbers.',
    can_control: 'Knowing his priorities, staying regulated, listening to his own lawyer.',
    cannot_control: 'Whether the other side negotiates in good faith.',
    timeline: 'Most cases settle here — over weeks to months.',
  },
  {
    stage: 'Settlement or trial',
    what_it_is: 'Either a signed settlement, or a judge decides the unresolved issues at trial.',
    what_it_feels_like: 'Relief, exhaustion, or a fresh wound if it went to trial.',
    can_control: 'Preparation with his lawyer; deciding what he can live with.',
    cannot_control: 'A judge\'s ruling; the final terms if it is decided for him.',
    timeline: 'Trials are the minority and can be a year or more out; settlements are faster.',
  },
  {
    stage: 'Decree',
    what_it_is: 'The court enters the final judgment — the divorce is legally done and the terms are binding.',
    what_it_feels_like: 'A strange flatness. The paperwork ends; the feelings do not follow the calendar.',
    can_control: 'Understanding what he agreed to; following the orders.',
    cannot_control: 'That it is now final.',
    timeline: 'The endpoint of the case — total time from filing is often many months to a couple of years.',
  },
  {
    stage: 'Post-decree life',
    what_it_is: 'Living the new arrangement — co-parenting, separate finances, rebuilding an identity.',
    what_it_feels_like: 'Loneliness early, then flashes of purpose and freedom. Rebuilding, not replacing.',
    can_control: 'How he shows up for his kids, his own recovery, the life he builds next.',
    cannot_control: 'The past; the other person\'s choices.',
    timeline: 'Ongoing. Adjustment research points to a couple of years for most, not a couple of months.',
  },
];

/**
 * 3.2 Legal literacy — plain-language definitions so a man is not lost in his own
 * lawyer's office. Definitions only. Every one carries the standing frame that his
 * lawyer knows his state; none states what he will get.
 */
export interface LegalTerm {
  term: string;
  plain: string;
}

export const LEGAL_TERMS: readonly LegalTerm[] = [
  { term: 'Petitioner / respondent', plain: 'The petitioner is whoever filed first; the respondent is the other spouse. It is a label for order of filing, not for fault or who "wins."' },
  { term: 'Discovery', plain: 'The formal exchange of information and documents between the two sides before settlement or trial.' },
  { term: 'Disclosure', plain: 'Each side\'s required accounting of income, assets, and debts, so the financial picture is complete and honest.' },
  { term: 'Temporary orders', plain: 'Interim rules the court puts in place while the case is pending — parenting time, who stays in the home, interim support.' },
  { term: 'Mediation vs. litigation', plain: 'Mediation is reaching agreement with a neutral third party; litigation is a judge deciding. Most divorces settle without a trial.' },
  { term: 'Custody vs. visitation', plain: 'Older language for how time and decisions are shared. Many places now say "parenting time" and "parental responsibility" instead.' },
  { term: 'Legal vs. physical custody', plain: 'Legal custody is who makes major decisions (school, medical); physical custody is where the child lives day to day. They can be split differently.' },
  { term: 'Community property vs. equitable distribution', plain: 'Two general frameworks states use to divide marital property — roughly equal split vs. what a court deems fair. Which applies depends on the state.' },
  { term: 'QDRO', plain: 'A Qualified Domestic Relations Order — the court order used to divide certain retirement accounts without triggering penalties.' },
  { term: 'Spousal support vs. child support', plain: 'Spousal support (alimony) is money to a former spouse; child support is money for the children\'s needs. They are calculated separately.' },
];

/**
 * 3.3 Co-parenting basics — what the child-adjustment research generally supports.
 * Markos supports the MAN'S side of co-parenting; he never mediates the couple.
 */
export const CO_PARENTING_BASICS: readonly string[] = [
  'Decades of child-adjustment research point to ongoing CONFLICT between parents — not divorce itself — as the main driver of harm to kids. Lowering the conflict a child is exposed to is the highest-leverage thing a father can control.',
  'Cooperative co-parenting (regular coordination) fits low-conflict situations; parallel parenting (minimal direct contact, each household running its own way) is the safer fit when contact keeps igniting. Neither is failure.',
  'Telling kids works best age-appropriately, together when possible, with a simple, consistent message: this is not their fault, both parents still love them, and it is not their job to fix it.',
  'Business-like communication lowers the temperature: brief, informative, friendly, firm (a "BIFF"-style note). Treat exchanges like a working handoff, not a place to relitigate the marriage.',
  'Never route conflict THROUGH the kids — no messenger duty, no interrogation about the other house, no venting about their mother to them.',
  'Divorce ends a marriage, not a family — the relationships get renegotiated, not dissolved (Emery). The working goal is two connected households a child can move between, not one broken home. This frame alone lowers the catastrophe in his head: he is not losing his kids, he is renegotiating how he parents them.',
  'Children grieve the divorce too, on their own timeline, and a child\'s anger or withdrawal is usually grief or loyalty strain — not a verdict on him as a father (Emery). He does not have to win the child back; he has to stay steady while the child finds their own way through.',
  'Match the response to the child\'s age and stage (Maione): young kids need routine, reassurance, and simple repeated messages; teenagers need honesty without a loyalty bind and room to be angry. What reassures a 6-year-old can insult a 15-year-old.',
  'Early on, stabilize before optimizing (McKay): where the kids sleep, the handoff rhythm, who tells the school — boring, concrete, done. The big permanent parenting decisions wait until the ground stops moving.',
];

/**
 * 3.4 Financial basics — orientation only, always paired with escalation to a
 * CDFA or financial advisor for any real decision.
 */
export const FINANCIAL_BASICS: readonly string[] = [
  'Gathering financial documents early — statements, tax returns, account and debt records — makes disclosure less painful and gives him footing before decisions get made.',
  'Separating finances usually means opening individual accounts and understanding which debts and cards are joint. Joint debt can stay his responsibility regardless of who ran it up — a question for his own advisor and lawyer.',
  'Retirement accounts can often be divided, but doing it without taxes or penalties generally requires a QDRO or the right transfer mechanism — not a casual withdrawal.',
  'Divorce changes tax filing status and often the household from two incomes to one; a fresh, realistic one-income budget is worth building early.',
  'For any actual number or decision — support, asset split, what a settlement really means — a Certified Divorce Financial Analyst (CDFA) or financial advisor is the right call, not a companion.',
];

/**
 * 3.5 Emotional stage-mapping — Fisher's Rebuilding blocks mapped onto the 3.1
 * process stages, so the whisperer can anticipate what a man will feel NEXT, not
 * only what he feels now. (Fisher's Rebuilding Workbook is already in the corpus.)
 */
export interface StageEmotionMap {
  stage: string;
  blocks: string[];
  note: string;
}

export const STAGE_EMOTION_MAP: readonly StageEmotionMap[] = [
  { stage: 'Decision & disclosure', blocks: ['denial', 'fear'], note: 'Pre-filing is dominated by denial and fear — the ground is moving before anything is official.' },
  { stage: 'Filing & service', blocks: ['guilt_rejection', 'grief'], note: 'Filing clusters guilt/rejection and grief; the loss becomes real and public.' },
  { stage: 'Financial disclosure / discovery', blocks: ['anger'], note: 'Anger spikes as details surface; honor it without letting it become the ceiling.' },
  { stage: 'Negotiation or mediation', blocks: ['letting_go', 'self_worth'], note: 'Bargaining forces letting-go and tests self-worth — grief sits under the numbers.' },
  { stage: 'Decree', blocks: ['transition', 'loneliness'], note: 'The decree lands as transition and loneliness — the paperwork ends before the feelings do.' },
  { stage: 'Post-decree life', blocks: ['purpose', 'freedom', 'openness'], note: 'Post-decree is where purpose, freedom, and openness can re-emerge — rebuilding a self, not replacing a marriage.' },
];

/**
 * 3.6 Adjustment pathways — Hetherington & Kelly's headline finding from the
 * longest divorce study run: most people do FINE after divorce, and the first
 * ~two years are the hardest. The pathways below are how real adults actually
 * adjust; they exist so the whisperer can NORMALIZE and ANTICIPATE. They are
 * never labels to hand a man ("you're a seeker") — they are reading lenses only.
 */
export interface AdjustmentPathway {
  pathway: string;
  pattern: string;
}

export const ADJUSTMENT_PATHWAYS: readonly AdjustmentPathway[] = [
  { pathway: 'good-enoughs', pattern: 'The largest group. Life after divorce is messier and smaller in places, but broadly OK — decent parenting, decent days, no triumph narrative. Normalizing this matters most: ordinary and fine is the actual median outcome.' },
  { pathway: 'enhancers', pattern: 'A minority who genuinely grow through the divorce — more competent, more themselves afterward. Growth is real but not owed to anyone; never hold it up as the standard he must hit.' },
  { pathway: 'competent loners', pattern: 'Well-functioning alone — work, friends, interests — with little interest in repartnering soon. Solitude here is health, not failure.' },
  { pathway: 'seekers', pattern: 'Anxious to repartner fast; being alone feels unbearable. Common in men. Watch for the panic-date filling the hole — name the need underneath without shaming the strategy.' },
  { pathway: 'swingers', pattern: 'Younger crowd; parties, drinks, short relationships. The social high is real and so is the avoidance underneath it. Same posture: no shame, honest naming.' },
  { pathway: 'defeated', pattern: 'A minority who stay stuck for years — depression, bitterness, stalled life. The research is clear this is the exception, not the rule; it is also the group that most needs a steady presence and, when it stays dark, a route to a therapist.' },
];

/** Hetherington & Kelly's core normalization: the shape of adjustment over time. */
export const ADJUSTMENT_ARC =
  'The first year or two after separation is the storm — identity, money, kids, loneliness all moving at once. Most men stabilize; the research majority lands at "good enough," not broken and not transformed. Adjustment is measured in years, not weeks.';

/**
 * Early-stage stabilization (McKay, The Divorce Book) — the practical first
 * moves while the ground is still moving. Orientation about what the early
 * weeks GENERALLY ask for; never a directive about his case.
 */
export const EARLY_STAGE_GROUNDING: readonly string[] = [
  'Stabilize the immediate: where he sleeps, the kids\' routine, the immediate bills — small and concrete beats big and permanent in the first weeks.',
  'Expect the emotional weather to be at its worst exactly when the logistics demand the most; that collision is normal, not proof he is failing.',
  'Big permanent decisions (the house, the final parenting plan, major money moves) generally wait until the first storm passes — orientation about sequence, not a ruling on his timeline.',
  'Getting his own documents and records gathered early gives him footing; disclosure comes for everyone and being ready lowers the dread.',
];

/**
 * Disclaimer in Marcus's voice — ONCE per topic, not per message. Written to pass
 * the read-aloud test: no legalese. This is guidance for what he says, in his voice.
 */
export const DIVORCE_DISCLAIMER =
  'I can tell you how this usually works. What you should do — that is a conversation with a lawyer in your state.';

/** Escalation map — who advises on what. Emotional crisis routes to the unchanged sentinel layer. */
export const ESCALATION_MAP: Record<KnowledgeArea | 'crisis', string> = {
  process: 'For what applies to HIS case, the person is a family-law attorney in his state.',
  legal_literacy: 'Definitions are general; what any term means for him is a family-law attorney question.',
  co_parenting: 'For a high-conflict co-parenting or custody dispute, the professional is a family mediator or his attorney — Markos never mediates between the couple.',
  financial: 'For any real money decision — support, asset split, retirement — route him to a CDFA or financial advisor.',
  emotional: 'For the ongoing weight of it, the professional is a licensed therapist; acute crisis stays with the sentinel layer.',
  crisis: 'Acute emotional crisis is handled by the existing sentinel layer (988 / DV hotline), unchanged. Ongoing distress → a licensed therapist.',
};

/**
 * Hard red lines for the knowledge layer (extend the whisperer's DIVORCE_RED_LINES).
 * These are the load-bearing guardrails from spec §6.
 */
export const DIVORCE_KNOWLEDGE_RED_LINES: readonly string[] = [
  'Never advise on custody strategy, filing decisions, or whether to divorce — orient on how it generally works, then route to a professional',
  'Never make jurisdiction-specific claims ("in Texas you get…") — only "generally…, your state may differ, that is a lawyer question"',
  'Never draft or critique legal documents, settlement positions, or messages to the ex\'s lawyer',
  'Never estimate what a man "deserves" or will get — no predictions of outcomes, support amounts, or asset splits',
  'Never mediate between the couple or coach communication WITH the ex beyond child-focused, business-like norms',
  'Never state the disclaimer more than once per topic — orient, disclaim once, then be present',
];

/**
 * Provenance for each area — the metadata every scaled chunk will carry
 * (spec §4). reviewed_by / reviewed_at are null until professional review
 * (a launch blocker) completes. Kept here so the future ingestion script and
 * the human reviewer share one source of truth.
 */
export interface KnowledgeProvenance {
  knowledge_area: KnowledgeArea;
  source_title: string;
  source_url: string;
  jurisdiction: 'general';
  reviewed_by: string | null;
  reviewed_at: string | null;
}

export const KNOWLEDGE_PROVENANCE: readonly KnowledgeProvenance[] = [
  { knowledge_area: 'process', source_title: 'State court self-help portals (jurisdiction-neutral core) + ABA public education', source_url: 'https://www.americanbar.org/groups/public_education/', jurisdiction: 'general', reviewed_by: null, reviewed_at: null },
  { knowledge_area: 'legal_literacy', source_title: 'ABA public education glossary + state court self-help terminology', source_url: 'https://www.americanbar.org/groups/public_education/', jurisdiction: 'general', reviewed_by: null, reviewed_at: null },
  { knowledge_area: 'co_parenting', source_title: 'Child-development literature (Amato & Keith meta-analyses) + APA public resources', source_url: 'https://www.apa.org/topics/divorce-child-custody', jurisdiction: 'general', reviewed_by: null, reviewed_at: null },
  { knowledge_area: 'financial', source_title: 'CFP Board + CDFA public education materials', source_url: 'https://www.cfp.net/', jurisdiction: 'general', reviewed_by: null, reviewed_at: null },
  { knowledge_area: 'emotional', source_title: "Fisher, Rebuilding Workbook (stage mapping)", source_url: 'corpus:rebuilding-workbook', jurisdiction: 'general', reviewed_by: null, reviewed_at: null },
  { knowledge_area: 'emotional', source_title: 'Hetherington & Kelly, "For Better or For Worse: Divorce Reconsidered", 2003 (full text provided via Google Drive)', source_url: 'corpus:for-better-or-for-worse', jurisdiction: 'general', reviewed_by: null, reviewed_at: null },
  { knowledge_area: 'co_parenting', source_title: 'Emery, "Renegotiating Family Relationships: Divorce, Child Custody, and Mediation", 2nd ed. 2011 (full text provided via Google Drive)', source_url: 'corpus:renegotiating-family-relationships', jurisdiction: 'general', reviewed_by: null, reviewed_at: null },
  { knowledge_area: 'co_parenting', source_title: 'Maione, "Children & Divorce: A Positive Parenting Approach" (full text provided via Google Drive)', source_url: 'corpus:children-and-divorce-maione', jurisdiction: 'general', reviewed_by: null, reviewed_at: null },
  { knowledge_area: 'process', source_title: 'McKay, Blades, Rogers & Gosse, "The Divorce Book: A Practical and Compassionate Guide", 1999 (full text provided via Google Drive)', source_url: 'corpus:the-divorce-book-mckay', jurisdiction: 'general', reviewed_by: null, reviewed_at: null },
];

/**
 * Detect which knowledge area(s) a message touches. Conservative on purpose: a
 * message that does not clearly ask about the process/terms/kids/money returns
 * NOTHING, so the emotional-support whisperer keeps the turn and no orientation
 * content leaks into a purely emotional moment.
 */
export function detectKnowledgeAreas(message: string): KnowledgeArea[] {
  const msg = message.toLowerCase();
  const areas: KnowledgeArea[] = [];

  // process — "what happens now / next", stage words, timelines
  if (/\b(what (happens|comes|is)? ?(happens )?(now|next)|what do i do (now|next)|how does (this|divorce|the process) work|what to expect|how long (does|will)|timeline|the steps|first step|temporary orders?|decree|settlement|go to (court|trial)|when i file|after (i|we) file)\b/i.test(msg)) {
    areas.push('process');
  }
  // legal_literacy — terminology / "what does X mean"
  if (/\b(what (is|does|are|s)\b.*(discovery|disclosure|petitioner|respondent|mediation|litigation|custody|visitation|community property|equitable|qdro|alimony|spousal|decree|deposition|subpoena)|what does .* mean|difference between .* and|legal (custody|physical custody)|petitioner|respondent|qdro|discovery|disclosure|mediation|litigation|equitable distribution|community property)\b/i.test(msg)) {
    areas.push('legal_literacy');
  }
  // co_parenting — kids in the picture + a co-parenting question
  if (/\b(co-?parent|parenting (plan|schedule|time)|the kids?|my (son|daughter|children|child|boys|girls|kids)|tell (the|my) (kids?|children)|wreck my kids|mess (up|them)|custody schedule|two houses|shuttle|hand ?off|pick ?up|drop ?off)\b/i.test(msg)) {
    areas.push('co_parenting');
  }
  // financial — money fear, documents, house, support
  if (/\b(money|financ|afford|budget|the house|our home|assets?|debt|credit|retirement|401k|pension|alimony|spousal|child support|support payment|split (the|everything|assets|money)|tax(es)?|broke|bills)\b/i.test(msg)) {
    areas.push('financial');
  }
  return areas;
}

/**
 * Build the deterministic INTERNAL orientation note for the Composer. Returns ''
 * when no area is active. This is guidance to Marcus — "you may orient him on…" —
 * not a script to read aloud. It always carries the disclaimer + escalation and
 * never a jurisdiction-specific claim.
 */
export function buildOrientationNote(areas: KnowledgeArea[]): string {
  if (areas.length === 0) return '';
  const parts: string[] = [];
  parts.push('DIVORCE ORIENTATION — he is asking to UNDERSTAND the process he is living through, not (only) to be understood emotionally. You may orient him: explain how it GENERALLY works, define the words, normalize the experience. Orientation, never advice. Never a jurisdiction-specific claim. Never a prediction of what he will get.');

  for (const area of areas) {
    if (area === 'process') {
      const stages = PROCESS_STAGES.map(s => s.stage).join(' → ');
      parts.push(`PROCESS (general arc, in your own plain words, only as far as he is asking): ${stages}. Frame any timeline as a rough range that varies by case and state. Name what he can control here vs. what he cannot.`);
      parts.push(`EARLY STAGE (McKay — orientation about sequence, never a directive about his case): ${EARLY_STAGE_GROUNDING.join(' ')}`);
    } else if (area === 'legal_literacy') {
      const terms = LEGAL_TERMS.map(t => `${t.term} — ${t.plain}`).join(' • ');
      parts.push(`LEGAL LITERACY (define plainly, so he is not lost in his lawyer's office; definitions only, never what he will get): ${terms}`);
    } else if (area === 'co_parenting') {
      parts.push(`CO-PARENTING (support HIS side only — never mediate the couple): ${CO_PARENTING_BASICS.join(' ')}`);
    } else if (area === 'financial') {
      parts.push(`FINANCIAL (orientation only, then route to a CDFA / advisor for any real number): ${FINANCIAL_BASICS.join(' ')}`);
    } else if (area === 'emotional') {
      const map = STAGE_EMOTION_MAP.map(m => `${m.stage}: ${m.blocks.join('/')}`).join(' • ');
      parts.push(`EMOTIONAL STAGE-MAP (what tends to come NEXT, so you can meet it): ${map}. Use it to anticipate, never to tell him how he "should" feel.`);
      parts.push(`ADJUSTMENT (Hetherington & Kelly — normalize honestly, never label him with a pathway): ${ADJUSTMENT_ARC} Real pathways men take: ${ADJUSTMENT_PATHWAYS.map(w => `${w.pathway} (${w.pattern})`).join(' • ')}`);
    }
  }

  // Disclaimer once, in Marcus's voice, + the escalation targets for the active areas.
  parts.push(`DISCLAIMER (say ONCE this topic, in your voice, not legalese): "${DIVORCE_DISCLAIMER}"`);
  const escalations = [...new Set(areas.map(a => ESCALATION_MAP[a]))];
  parts.push(`ROUTE (name the professional for anything decision-shaped): ${escalations.join(' ')}`);
  return parts.join('\n');
}
