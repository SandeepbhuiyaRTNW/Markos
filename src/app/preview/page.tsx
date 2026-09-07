import { notFound } from 'next/navigation';
import VisualPreview from '@/components/VisualPreview';

export default async function PreviewPage({ searchParams }: { searchParams: Promise<{ emotion?: string }> }) {
  if (process.env.NODE_ENV !== 'development') notFound();
  const { emotion } = await searchParams;
  return <VisualPreview emotion={emotion} />;
}
