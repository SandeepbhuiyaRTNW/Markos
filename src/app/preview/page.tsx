import { notFound } from 'next/navigation';
import VisualPreview from '@/components/VisualPreview';

export default async function PreviewPage({ searchParams }: { searchParams: Promise<{ emotion?: string; state?: string }> }) {
  if (process.env.NODE_ENV !== 'development') notFound();
  const { emotion, state } = await searchParams;
  return <VisualPreview emotion={emotion} state={state === 'listening' || state === 'processing' || state === 'idle' ? state : 'speaking'} />;
}
