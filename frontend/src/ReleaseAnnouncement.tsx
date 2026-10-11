import { useState } from 'react';
import { PopupDialog } from './PopupDialog';
import type { Release } from './releaseMetadata';

function ReleaseScreenshot({ image }: { image: NonNullable<Release['image']> }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;

  return (
    <figure className="release-screenshot">
      <a href={image.url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">
        <img
          src={image.url}
          alt={image.alt}
          referrerPolicy="no-referrer"
          decoding="async"
          onError={() => setFailed(true)}
        />
      </a>
      <figcaption>{image.alt} Select the image to view it full size.</figcaption>
    </figure>
  );
}

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
        {release.image && <ReleaseScreenshot key={release.image.url} image={release.image} />}
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
