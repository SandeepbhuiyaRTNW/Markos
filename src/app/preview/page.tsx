import { notFound } from 'next/navigation';
import MarcusWelcome from '@/components/MarcusWelcome';
import StoicField from '@/components/StoicField';
import VisualPreview from '@/components/VisualPreview';

export default async function PreviewPage({ searchParams }: { searchParams: Promise<{ emotion?: string; state?: string; screen?: string }> }) {
  if (process.env.NODE_ENV !== 'development') notFound();
  const { emotion, state, screen } = await searchParams;
  if (screen === 'welcome') return <main className="min-h-screen flex items-center justify-center relative" style={{ background: '#faf9f6' }}><StoicField /><div className="relative z-10"><MarcusWelcome preview /></div></main>;
  return <VisualPreview emotion={emotion} state={state === 'listening' || state === 'processing' || state === 'idle' ? state : 'speaking'} />;
}
