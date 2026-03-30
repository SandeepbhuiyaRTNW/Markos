'use client';

import { useState } from 'react';
import { ArrowLeft, Loader2, ChevronRight } from 'lucide-react';

interface OnboardingFlowProps {
  userId: string;
  onComplete: () => void;
}

type Phase = 'profile' | 'questions';

const QUESTIONS = [
  {
    id: 'whats_going_on',
    question: "What's going on in your life right now?",
    subtext: 'No filter needed. Just say what comes to mind.',
    placeholder: 'Whatever is weighing on you…',
  },
  {
    id: 'biggest_struggle',
    question: 'What feels like the biggest struggle you are facing?',
    subtext: 'The thing that keeps you up at night.',
    placeholder: 'Work, relationships, identity…',
  },
  {
    id: 'what_you_want',
    question: 'If things could change, what would that look like?',
    subtext: 'Not the perfect life — just a better one.',
    placeholder: 'What does "better" mean to you…',
  },
  {
    id: 'relationship_status',
    question: 'How are things with the people closest to you?',
    subtext: 'Partner, family, friends — whoever matters.',
    placeholder: 'Connected, distant, complicated…',
  },
  {
    id: 'when_lost',
    question: 'When did you last feel like you were truly yourself?',
    subtext: 'Before the noise took over.',
    placeholder: 'A time when things felt right…',
  },
];

export default function OnboardingFlow({ userId, onComplete }: OnboardingFlowProps) {
  const [phase, setPhase] = useState<Phase>('profile');
  const [name, setName] = useState('');
  const [age, setAge] = useState('');
  const [whatBroughtYou, setWhatBroughtYou] = useState('');
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [currentAnswer, setCurrentAnswer] = useState('');
  const [saving, setSaving] = useState(false);

  const totalSteps = 1 + QUESTIONS.length;
  const currentStepNum = phase === 'profile' ? 1 : 2 + step;
  const progress = (currentStepNum / totalSteps) * 100;
  const canContinueProfile = name.trim() && age.trim() && whatBroughtYou.trim();

  const handleProfileNext = () => setPhase('questions');

  const handleQuestionNext = async () => {
    const currentQ = QUESTIONS[step];
    const updatedAnswers = { ...answers, [currentQ.id]: currentAnswer };
    setAnswers(updatedAnswers);
    setCurrentAnswer('');
    if (step === QUESTIONS.length - 1) {
      setSaving(true);
      try {
        await fetch('/api/onboarding', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId, name: name.trim(), age: age.trim(), whatBroughtYou: whatBroughtYou.trim(), answers: updatedAnswers }),
        });
        onComplete();
      } catch (err) { console.error('Onboarding save error:', err); setSaving(false); }
    } else {
      setStep(step + 1);
    }
  };

  const handleBack = () => {
    if (phase === 'questions' && step === 0) setPhase('profile');
    else if (phase === 'questions' && step > 0) { setStep(step - 1); setCurrentAnswer(answers[QUESTIONS[step - 1].id] || ''); }
  };

  const inputClass = 'w-full h-12 px-4 rounded-xl bg-white border border-border text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-[#a3785e]/25 focus:border-[#a3785e]/30 transition-all text-sm';
  const textareaClass = 'w-full px-4 py-3 rounded-xl bg-white border border-border text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-[#a3785e]/25 focus:border-[#a3785e]/30 transition-all text-sm resize-none leading-relaxed';

  return (
    <div className="h-screen flex flex-col items-center justify-center px-6 fade-in-up">
      <div className="w-full max-w-lg glass-strong rounded-2xl p-8">
        {/* Progress */}
        <div className="mb-10">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[11px] tracking-widest uppercase text-[#a3785e]/70">
              {phase === 'profile' ? 'Your Profile' : 'Getting to Know You'}
            </span>
            <span className="text-[11px] text-muted-foreground/40 tabular-nums">
              {currentStepNum} / {totalSteps}
            </span>
          </div>
          <div className="h-1 bg-secondary rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-[#a3785e]/50 to-[#a3785e] rounded-full transition-all duration-500 ease-out"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        {/* Profile Phase */}
        {phase === 'profile' && (
          <div className="slide-in-right" key="profile">
            <h2 className="text-2xl font-semibold leading-snug mb-2 text-foreground">
              Before we begin, tell me about yourself.
            </h2>
            <p className="text-sm mb-8 text-muted-foreground/70">
              Marcus remembers everything. This helps him understand you from the start.
            </p>
            <div className="space-y-5">
              <div>
                <label className="text-[11px] uppercase tracking-widest mb-2 block text-muted-foreground/50">Name</label>
                <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="What should Marcus call you?" className={inputClass} autoFocus />
              </div>
              <div>
                <label className="text-[11px] uppercase tracking-widest mb-2 block text-muted-foreground/50">Age</label>
                <input type="number" value={age} onChange={(e) => setAge(e.target.value)} placeholder="Your age" min={13} max={120} className={inputClass} />
              </div>
              <div>
                <label className="text-[11px] uppercase tracking-widest mb-2 block text-muted-foreground/50">What brought you here?</label>
                <textarea value={whatBroughtYou} onChange={(e) => setWhatBroughtYou(e.target.value)} placeholder="What are you hoping to find or work through?" rows={3} className={textareaClass} />
              </div>
            </div>
          </div>
        )}

        {/* Questions Phase */}
        {phase === 'questions' && (
          <div className="slide-in-right" key={`q-${step}`}>
            <h2 className="text-2xl font-semibold leading-snug mb-2 text-foreground">
              {QUESTIONS[step].question}
            </h2>
            <p className="text-sm mb-8 text-muted-foreground/70">
              {QUESTIONS[step].subtext}
            </p>
            <textarea
              value={currentAnswer}
              onChange={(e) => setCurrentAnswer(e.target.value)}
              placeholder={QUESTIONS[step].placeholder}
              rows={4}
              className={textareaClass}
              autoFocus
            />
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center justify-between mt-8">
          <button
            onClick={handleBack}
            className={`flex items-center gap-1 text-xs text-muted-foreground/60 hover:text-muted-foreground transition-colors ${phase === 'profile' ? 'opacity-0 pointer-events-none' : ''}`}
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Back
          </button>

          <button
            onClick={phase === 'profile' ? handleProfileNext : handleQuestionNext}
            disabled={phase === 'profile' ? !canContinueProfile : !currentAnswer.trim() || saving}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium bg-[#44403c] hover:bg-[#57534e] text-white disabled:opacity-30 disabled:cursor-not-allowed transition-all"
          >
            {saving ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</>
            ) : step === QUESTIONS.length - 1 && phase === 'questions' ? (
              <>Begin Journey <ChevronRight className="w-4 h-4" /></>
            ) : (
              <>Continue <ChevronRight className="w-4 h-4" /></>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

