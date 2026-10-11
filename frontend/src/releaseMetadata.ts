export interface Release {
  version: string;
  title: string;
  summary: string;
  changes: string[];
  url: string;
  image?: {
    url: string;
    alt: string;
  };
}

function text(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/** Reject incomplete notes and unsafe links before displaying a server response. */
export function parseRelease(value: unknown): Release | null {
  if (!value || typeof value !== 'object') return null;
  const release = value as Partial<Release>;
  if (
    !text(release.version) ||
    !/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(release.version) ||
    !text(release.title) ||
    !text(release.summary) ||
    !Array.isArray(release.changes) ||
    !release.changes.length ||
    !release.changes.every(text) ||
    !text(release.url)
  ) {
    return null;
  }
  if (!/^https:\/\/github\.com\/[^\s\\]+$/.test(release.url)) {
    return null;
  }
  if (
    release.image !== undefined &&
    (!release.image ||
      !text(release.image.alt) ||
      !text(release.image.url) ||
      !/^https:\/\/raw\.githubusercontent\.com\/[^\s\\]+$/.test(release.image.url))
  ) {
    return null;
  }
  return release as Release;
}
