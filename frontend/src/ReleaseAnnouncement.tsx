import { PopupDialog } from './PopupDialog';
import type { Release } from './releaseMetadata';

export function ReleaseAnnouncement({
  release,
  onClose,
}: {
  release: Release;
  onClose: () => void;
}) {
  return (
    <PopupDialog
      title={`Version ${release.version}`}
      kicker="WHAT'S NEW"
      className="release-announcement"
      onClose={onClose}
    >
      <div className="release-announcement-body">
        <h3>{release.title}</h3>
        <p>{release.summary}</p>
        <ul>
          {release.changes.map((change, index) => (
            <li key={index}>{change}</li>
          ))}
        </ul>
        <a href={release.url} target="_blank" rel="noopener noreferrer">
          Read more on GitHub <span aria-hidden="true">↗</span>
        </a>
      </div>
      <footer className="popup-dialog-actions">
        <button type="button" className="popup-primary-action" onClick={onClose}>
          Got it
        </button>
      </footer>
    </PopupDialog>
  );
}
