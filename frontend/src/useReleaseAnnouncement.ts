import { useEffect, useState } from 'react';
import releaseMetadata from '../public/release.json';
import { hasSeenRelease, rememberRelease, watchReleases } from './releaseAnnouncements';
import { parseRelease } from './releaseMetadata';

const bundledRelease = parseRelease(releaseMetadata)!;

export function useReleaseAnnouncement(userId: string | null) {
  const [state, setState] = useState({ release: bundledRelease, open: false });

  useEffect(() => {
    if (!userId) return;
    return watchReleases((release) => {
      setState((current) => ({
        release,
        open:
          (current.open && current.release.version === release.version) ||
          !hasSeenRelease(userId, release.version),
      }));
    });
  }, [userId]);

  return {
    release: state.release,
    open: userId !== null && state.open,
    show: () => setState((current) => ({ ...current, open: true })),
    dismiss: () => {
      if (userId) rememberRelease(userId, state.release.version);
      setState((current) => ({ ...current, open: false }));
    },
  };
}
