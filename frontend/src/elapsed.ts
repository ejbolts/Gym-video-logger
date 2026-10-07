import { useEffect, useState } from 'react';

export function formatElapsed(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    : `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function useElapsedSeconds(startedAt: number | null): number {
  const [elapsed, setElapsed] = useState(() =>
    startedAt === null ? 0 : Math.max(0, Math.floor((Date.now() - startedAt) / 1000)),
  );
  useEffect(() => {
    if (startedAt === null) return;
    const update = () => setElapsed(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [startedAt]);
  return elapsed;
}
