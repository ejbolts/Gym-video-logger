import { useEffect, useState } from 'react';
import releaseMetadata from '../release.json';
import {
  fetchRelease,
  hasSeenRelease,
  rememberRelease,
  watchReleases,
} from './releaseAnnouncements';
import { parseRelease } from './releaseMetadata';

const bundledRelease = parseRelease(releaseMetadata)!;

export function useReleaseAnnouncement(userId: string | null) {
  const [state, setState] = useState({ release: bundledRelease, open: false, checked: false });

  useEffect(() => {
    if (!userId) return;
    // A failed first check still counts, so popups queued behind this one are not held forever.
    const checkedWithoutRelease = () => setState((current) => ({ ...current, checked: true }));
    return watchReleases(
      (release) => {
        setState((current) => ({
          release,
          checked: true,
          open:
            (current.open && current.release.version === release.version) ||
            !hasSeenRelease(userId, release.version),
        }));
      },
      () =>
        fetchRelease().then(
          (release) => {
            if (!release) checkedWithoutRelease();
            return release;
          },
          (reason: unknown) => {
            checkedWithoutRelease();
            throw reason;
          },
        ),
    );
  }, [userId]);

  return {
    release: state.release,
    open: userId !== null && state.open,
    checked: state.checked,
    show: () => setState((current) => ({ ...current, open: true })),
    dismiss: () => {
      if (userId) rememberRelease(userId, state.release.version);
      setState((current) => ({ ...current, open: false }));
    },
  };
}
