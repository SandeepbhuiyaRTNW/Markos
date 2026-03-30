'use client';

interface WaveformProps {
  active: boolean;
  color?: string;
}

export default function Waveform({ active, color = '#ffffff' }: WaveformProps) {
  const bars = 5;

  return (
    <div className="flex items-center gap-1 h-8">
      {Array.from({ length: bars }).map((_, i) => (
        <div
          key={i}
          className="w-1 rounded-full transition-all duration-300"
          style={{
            backgroundColor: color,
            height: active ? '100%' : '4px',
            animation: active
              ? `waveform ${0.8 + i * 0.15}s ease-in-out infinite`
              : 'none',
            animationDelay: `${i * 0.1}s`,
            opacity: active ? 0.8 : 0.3,
          }}
        />
      ))}
    </div>
  );
}

