import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api';
import type { Health, LocalClip, SessionStatus, WorkoutSession } from './types';
import { base64UrlToUint8Array } from './push';
import { formatBytes, formatSeconds, localDate } from './utils';

type Screen = 'upload' | 'progress' | 'processing' | 'complete' | 'history';
const terminalStatuses: SessionStatus[] = ['complete', 'failed', 'cancelled'];
const processingStatuses: SessionStatus[] = [
  'queued',
  'normalizing',
  'stitching',
  'uploading_to_youtube',
  'youtube_processing',
];

function statusText(status: SessionStatus): string {
  return {
    draft: 'Waiting for uploads',
    uploading: 'Uploading clips',
    upload_failed: 'Some uploads need attention',
    queued: 'Queued',
    normalizing: 'Normalizing videos',
    stitching: 'Stitching your workout',
    uploading_to_youtube: 'Uploading to YouTube',
    youtube_processing: 'YouTube is processing',
    complete: 'Complete',
    failed: 'Processing failed',
    cancelled: 'Cancelled',
  }[status];
}

export function VideoUpload() {
  const [screen, setScreen] = useState<Screen>('upload');
  const [sessionName, setSessionName] = useState('');
  const [workoutDate, setWorkoutDate] = useState(localDate);
  const [notes, setNotes] = useState('');
  const [clips, setClips] = useState<LocalClip[]>([]);
  const [serverSession, setServerSession] = useState<WorkoutSession | null>(null);
  const [history, setHistory] = useState<WorkoutSession[]>([]);
  const [health, setHealth] = useState<Health | null>(null);
  const [busy, setBusy] = useState(false);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushEnabling, setPushEnabling] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const pickerRef = useRef<HTMLInputElement>(null);
  const previewUrls = useRef(new Set<string>());
  const wakeLock = useRef<{ release: () => Promise<void> } | null>(null);

  useEffect(() => {
    const urls = previewUrls.current;
    void api
      .health()
      .then(setHealth)
      .catch(() => setMessage('Could not reach the local service.'));
    return () => {
      for (const url of urls) URL.revokeObjectURL(url);
      if (wakeLock.current) void wakeLock.current.release();
    };
  }, []);

  useEffect(() => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
    void navigator.serviceWorker.ready
      .then((registration) => registration.pushManager.getSubscription())
      .then(async (subscription) => {
        if (!subscription) return;
        const keys = subscription.toJSON().keys;
        if (!keys?.p256dh || !keys.auth) return;
        await api.savePushSubscription({
          endpoint: subscription.endpoint,
          p256dh: keys.p256dh,
          auth: keys.auth,
        });
        setPushEnabled(true);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (
      !serverSession ||
      screen !== 'processing' ||
      terminalStatuses.includes(serverSession.status)
    )
      return;
    const timer = window.setInterval(() => {
      void api
        .getSession(serverSession.id)
        .then((next) => {
          setServerSession(next);
          if (next.status === 'complete') setScreen('complete');
        })
        .catch((error: unknown) =>
          setMessage(error instanceof Error ? error.message : 'Could not refresh status.'),
        );
    }, 2500);
    return () => window.clearInterval(timer);
  }, [screen, serverSession]);

  const totalBytes = useMemo(() => clips.reduce((sum, clip) => sum + clip.file.size, 0), [clips]);
  const overallProgress = useMemo(() => {
    if (!clips.length) return 0;
    return Math.round(clips.reduce((sum, clip) => sum + clip.progress, 0) / clips.length);
  }, [clips]);

  function updateClip(clientId: string, update: Partial<LocalClip>) {
    setClips((current) =>
      current.map((clip) => (clip.clientId === clientId ? { ...clip, ...update } : clip)),
    );
  }

  function attachFiles(files: FileList | File[]) {
    const accepted = Array.from(files).filter((file) => /\.(mp4|mov|m4v)$/i.test(file.name));
    if (accepted.length !== Array.from(files).length)
      setMessage('Only MP4, MOV, and M4V video files were added.');
    const additions = accepted.map((file) => {
      const previewUrl = URL.createObjectURL(file);
      previewUrls.current.add(previewUrl);
      return {
        clientId: crypto.randomUUID(),
        file,
        previewUrl,
        exerciseLabel: '',
        status: 'waiting' as const,
        progress: 0,
      };
    });
    setClips((current) => [...current, ...additions]);
  }

  function removeClip(clientId: string) {
    setClips((current) => {
      const clip = current.find((item) => item.clientId === clientId);
      if (clip) {
        URL.revokeObjectURL(clip.previewUrl);
        previewUrls.current.delete(clip.previewUrl);
      }
      return current.filter((item) => item.clientId !== clientId);
    });
  }

  function moveClip(from: number, to: number) {
    if (to < 0 || to >= clips.length || from === to) return;
    setClips((current) => {
      const next = [...current];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  }

  async function acquireWakeLock() {
    try {
      const navigatorWithWakeLock = navigator as Navigator & {
        wakeLock?: { request: (kind: 'screen') => Promise<{ release: () => Promise<void> }> };
      };
      wakeLock.current = (await navigatorWithWakeLock.wakeLock?.request('screen')) ?? null;
    } catch {
      // Upload still works; wake locks are a best-effort guard only.
    }
  }

  async function uploadClips(session: WorkoutSession, selected: LocalClip[]): Promise<boolean> {
    const concurrency = health?.upload_concurrency ?? 2;
    let nextIndex = 0;
    let failed = false;
    async function worker() {
      while (nextIndex < selected.length) {
        const index = nextIndex++;
        const clip = selected[index];
        updateClip(clip.clientId, { status: 'uploading', progress: 0, error: undefined });
        try {
          await api.uploadClip(
            session.id,
            {
              clientId: clip.clientId,
              file: clip.file,
              exerciseLabel: clip.exerciseLabel,
              orderIndex: clips.findIndex((item) => item.clientId === clip.clientId),
            },
            (progress) => updateClip(clip.clientId, { progress }),
          );
          updateClip(clip.clientId, { status: 'uploaded', progress: 100 });
        } catch (error) {
          failed = true;
          updateClip(clip.clientId, {
            status: 'failed',
            error: error instanceof Error ? error.message : 'Upload failed.',
          });
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, selected.length) }, worker));
    return !failed;
  }

  async function beginProcessing(session: WorkoutSession) {
    try {
      const next = await api.process(session.id);
      setServerSession(next);
      setScreen('processing');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not start processing.');
    }
  }

  async function startUpload() {
    if (!sessionName.trim() || !workoutDate || !clips.length || busy) return;
    setBusy(true);
    setMessage(null);
    await acquireWakeLock();
    try {
      const session = await api.createSession({
        name: sessionName.trim(),
        workout_date: workoutDate,
        notes: notes.trim() || null,
        expected_clip_count: clips.length,
      });
      setServerSession(session);
      setScreen('progress');
      const succeeded = await uploadClips(session, clips);
      if (succeeded) await beginProcessing(session);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not create the session.');
    } finally {
      setBusy(false);
      if (wakeLock.current) {
        await wakeLock.current.release();
        wakeLock.current = null;
      }
    }
  }

  async function retryFailedUploads() {
    if (!serverSession || busy) return;
    setBusy(true);
    setMessage(null);
    await acquireWakeLock();
    try {
      const failed = clips.filter((clip) => clip.status === 'failed');
      const succeeded = await uploadClips(serverSession, failed);
      if (succeeded) await beginProcessing(serverSession);
    } finally {
      setBusy(false);
      if (wakeLock.current) {
        await wakeLock.current.release();
        wakeLock.current = null;
      }
    }
  }

  async function cancelSession() {
    if (!serverSession) return;
    try {
      const next = await api.cancel(serverSession.id);
      setServerSession(next);
      setScreen('processing');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not cancel the session.');
    }
  }

  function retryFailedSession() {
    if (!serverSession) return;
    const retry = serverSession.youtube_video_id ? api.retryYoutubeProcessing : api.retryProcessing;
    void retry(serverSession.id)
      .then(setServerSession)
      .catch((error: unknown) =>
        setMessage(error instanceof Error ? error.message : 'Retry failed.'),
      );
  }

  async function showHistory() {
    try {
      setHistory(await api.listSessions());
      setScreen('history');
      setMessage(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not load previous sessions.');
    }
  }

  async function enablePushNotifications() {
    if (pushEnabled || pushEnabling) return;
    if (
      !('serviceWorker' in navigator) ||
      !('PushManager' in window) ||
      !('Notification' in window)
    ) {
      setMessage('Push notifications are not supported by this browser. Install the PWA first.');
      return;
    }
    setPushEnabling(true);
    setMessage(null);
    try {
      const config = await api.pushConfig();
      if (!config.enabled || !config.public_key)
        throw new Error(
          'Phone notifications are not ready on the server. Restart it after updating.',
        );
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') throw new Error('Notification permission was not granted.');
      const registration = await navigator.serviceWorker.ready;
      const subscription =
        (await registration.pushManager.getSubscription()) ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: base64UrlToUint8Array(config.public_key),
        }));
      const keys = subscription.toJSON().keys;
      if (!keys?.p256dh || !keys.auth)
        throw new Error('The browser returned an incomplete push subscription.');
      await api.savePushSubscription({
        endpoint: subscription.endpoint,
        p256dh: keys.p256dh,
        auth: keys.auth,
      });
      await api.testPush();
      setPushEnabled(true);
      setMessage('Completion alerts are enabled. A test notification is on its way.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not enable phone notifications.');
    } finally {
      setPushEnabling(false);
    }
  }

  async function openSession(id: string) {
    try {
      const session = await api.getSession(id);
      setServerSession(session);
      setScreen(session.status === 'complete' ? 'complete' : 'processing');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not load that session.');
    }
  }

  async function deleteSession(session: WorkoutSession) {
    if (
      !window.confirm(
        `Delete “${session.name}”? This removes its saved clips and combined output from this PC.`,
      )
    )
      return;
    setBusy(true);
    setMessage(null);
    try {
      await api.deleteSession(session.id);
      setHistory((current) => current.filter((item) => item.id !== session.id));
      if (serverSession?.id === session.id) resetUpload();
      else setMessage('Session deleted.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not delete this session.');
    } finally {
      setBusy(false);
    }
  }

  function resetUpload() {
    for (const clip of clips) {
      URL.revokeObjectURL(clip.previewUrl);
      previewUrls.current.delete(clip.previewUrl);
    }
    setClips([]);
    setServerSession(null);
    setSessionName('');
    setWorkoutDate(localDate());
    setNotes('');
    setMessage(null);
    setScreen('upload');
  }

  const uploadDisabled = !clips.length || !sessionName.trim() || !workoutDate || busy;
  const failedClips = clips.filter((clip) => clip.status === 'failed');
  const canDeleteCurrentSession =
    serverSession !== null && !processingStatuses.includes(serverSession.status);

  return (
    <main className="app-shell">
      <header className="topbar">
        <button className="brand" onClick={() => setScreen('upload')} aria-label="New upload">
          <span aria-hidden="true">▰</span> Gym logger
        </button>
        <div className="topbar-actions">
          <button
            className="text-button"
            disabled={pushEnabled || pushEnabling}
            onClick={() => void enablePushNotifications()}
          >
            {pushEnabled ? 'Alerts enabled' : pushEnabling ? 'Enabling alerts…' : 'Enable alerts'}
          </button>
          <button className="text-button" onClick={() => void showHistory()}>
            Previous sessions
          </button>
        </div>
      </header>
      {message && (
        <p className="message" role="alert">
          {message}
        </p>
      )}

      {screen === 'upload' && (
        <section className="page">
          <div className="intro">
            <p className="eyebrow">Private workout batch</p>
            <h1>Upload your sets together.</h1>
            <p>
              Review every clip first. Nothing is uploaded until you choose{' '}
              <strong>Upload session</strong>.
            </p>
          </div>
          <div className="card form-card">
            <label>
              Session name
              <input
                value={sessionName}
                onChange={(event) => setSessionName(event.target.value)}
                placeholder="e.g. Saturday lower body"
                required
              />
            </label>
            <label>
              Workout date
              <input
                type="date"
                value={workoutDate}
                onChange={(event) => setWorkoutDate(event.target.value)}
                required
              />
            </label>
            <label>
              Notes <span className="optional">optional</span>
              <textarea
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                rows={3}
                placeholder="Anything useful to keep with this session"
              />
            </label>
          </div>
          <input
            ref={pickerRef}
            className="sr-only"
            type="file"
            accept=".mp4,.mov,.m4v,video/mp4,video/quicktime"
            multiple
            onChange={(event) => {
              if (event.target.files) attachFiles(event.target.files);
              event.currentTarget.value = '';
            }}
          />
          <button className="picker" onClick={() => pickerRef.current?.click()}>
            <span aria-hidden="true">＋</span>
            Add set videos
            <small>MP4, MOV, or M4V · choose more than once if needed</small>
          </button>
          <div
            className="drop-target"
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              attachFiles(event.dataTransfer.files);
            }}
          >
            Drop additional video files here
          </div>
          {clips.length > 0 && (
            <section className="clips" aria-label="Attached clips">
              <div className="summary">
                <strong>{clips.length} clips</strong>
                <span>{formatBytes(totalBytes)} total</span>
              </div>
              {clips.map((clip, index) => (
                <article
                  key={clip.clientId}
                  className="clip-card"
                  draggable
                  onDragStart={(event) => event.dataTransfer.setData('text/plain', clip.clientId)}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => {
                    event.preventDefault();
                    const source = clips.findIndex(
                      (item) => item.clientId === event.dataTransfer.getData('text/plain'),
                    );
                    moveClip(source, index);
                  }}
                >
                  <video src={clip.previewUrl} controls muted playsInline preload="metadata" />
                  <div className="clip-details">
                    <div className="clip-heading">
                      <span className="set-number">Set {index + 1}</span>
                      <strong>{clip.file.name}</strong>
                    </div>
                    <span className="muted">{formatBytes(clip.file.size)}</span>
                    <label>
                      Exercise label <span className="optional">optional</span>
                      <input
                        value={clip.exerciseLabel}
                        onChange={(event) =>
                          updateClip(clip.clientId, { exerciseLabel: event.target.value })
                        }
                        placeholder="e.g. Back squat"
                      />
                    </label>
                    <div className="clip-actions">
                      <button
                        className="small-button"
                        onClick={() => moveClip(index, index - 1)}
                        disabled={index === 0}
                        aria-label={`Move set ${index + 1} up`}
                      >
                        ↑
                      </button>
                      <button
                        className="small-button"
                        onClick={() => moveClip(index, index + 1)}
                        disabled={index === clips.length - 1}
                        aria-label={`Move set ${index + 1} down`}
                      >
                        ↓
                      </button>
                      <button className="danger-link" onClick={() => removeClip(clip.clientId)}>
                        Remove
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </section>
          )}
          <button className="primary" disabled={uploadDisabled} onClick={() => void startUpload()}>
            Upload session
          </button>
          <p className="privacy-note">
            This app has no sign-in. Use it only through your private Tailnet.
          </p>
        </section>
      )}

      {screen === 'progress' && (
        <section className="page">
          <p className="eyebrow">Uploading session</p>
          <h1>{serverSession?.name}</h1>
          <div className="card progress-card">
            <div className="progress-label">
              <span>Overall upload</span>
              <strong>{overallProgress}%</strong>
            </div>
            <progress value={overallProgress} max="100" />
          </div>
          <p className="warning">
            Keep this PWA open and in the foreground until every upload finishes. Mobile browsers
            may suspend uploads if you close or background the app.
          </p>
          <UploadRows clips={clips} />
          {failedClips.length > 0 && (
            <button className="primary" disabled={busy} onClick={() => void retryFailedUploads()}>
              Retry failed uploads
            </button>
          )}
          <button className="secondary" disabled={busy} onClick={() => void cancelSession()}>
            Cancel session
          </button>
        </section>
      )}

      {screen === 'processing' && serverSession && (
        <section className="page">
          <p className="eyebrow">Processing session</p>
          <h1>{serverSession.name}</h1>
          <div className="card status-card">
            <span className={`status-dot ${serverSession.status}`} />
            <div>
              <strong>{statusText(serverSession.status)}</strong>
              <p>
                {serverSession.status === 'queued' &&
                  'Your complete batch is ready; work will begin shortly.'}
                {serverSession.status === 'normalizing' &&
                  'Preparing each phone video for a consistent, 1080p MP4 output.'}
                {serverSession.status === 'stitching' && 'Joining sets in the order you selected.'}
                {serverSession.status === 'uploading_to_youtube' &&
                  'Sending the combined video to YouTube as unlisted.'}
                {serverSession.status === 'youtube_processing' &&
                  'YouTube is preparing playback versions. We will notify this phone when it is ready.'}
                {serverSession.status === 'draft' &&
                  'This batch was never started. Delete it if you no longer have the original clips.'}
                {serverSession.status === 'uploading' &&
                  'This batch has incomplete uploads. Re-select the original clips in a new session, or delete this batch.'}
                {serverSession.status === 'upload_failed' &&
                  'An upload was rejected. Delete this incomplete batch before starting again.'}
                {serverSession.status === 'failed' &&
                  'Review the error below, then retry processing or delete the batch.'}
                {serverSession.status === 'cancelled' &&
                  'This upload batch was cancelled. Any successful uploads remain on disk until you delete the session.'}
              </p>
            </div>
          </div>
          {serverSession.processing_error && (
            <p className="error-box">{serverSession.processing_error}</p>
          )}
          {serverSession.status === 'failed' && (
            <button className="primary" onClick={retryFailedSession}>
              {serverSession.youtube_video_id ? 'Check YouTube again' : 'Retry processing'}
            </button>
          )}
          {serverSession.status === 'cancelled' && (
            <button className="primary" onClick={resetUpload}>
              Start a new upload
            </button>
          )}
          {canDeleteCurrentSession && (
            <button
              className="danger-button"
              disabled={busy}
              onClick={() => void deleteSession(serverSession)}
            >
              Delete this session
            </button>
          )}
        </section>
      )}

      {screen === 'complete' && serverSession && (
        <section className="page">
          <p className="eyebrow">Session complete</p>
          <h1>{serverSession.name}</h1>
          {serverSession.youtube_video_id && (
            <iframe
              className="youtube-frame"
              src={`https://www.youtube-nocookie.com/embed/${serverSession.youtube_video_id}`}
              title="Combined workout video"
              allowFullScreen
            />
          )}
          <a
            className="primary link-button"
            href={serverSession.youtube_url ?? '#'}
            target="_blank"
            rel="noreferrer"
          >
            Open full YouTube video
          </a>
          <section className="timestamps">
            <h2>Sets</h2>
            {serverSession.timestamps.map((timestamp) => (
              <a
                className="timestamp-row"
                key={timestamp.clip_id}
                href={timestamp.youtube_url ?? serverSession.youtube_url ?? '#'}
                target="_blank"
                rel="noreferrer"
              >
                <span>{formatSeconds(timestamp.start_seconds)}</span>
                <strong>{timestamp.label}</strong>
              </a>
            ))}
          </section>
          <button className="secondary" onClick={resetUpload}>
            Upload another session
          </button>
          <button
            className="danger-button"
            disabled={busy}
            onClick={() => void deleteSession(serverSession)}
          >
            Delete this session
          </button>
        </section>
      )}

      {screen === 'history' && (
        <section className="page">
          <p className="eyebrow">Session history</p>
          <h1>Previous sessions</h1>
          {history.length === 0 ? (
            <p className="muted">No sessions yet.</p>
          ) : (
            history.map((item) => (
              <article className="history-item" key={item.id}>
                <button className="history-open" onClick={() => void openSession(item.id)}>
                  <span className={`status-dot ${item.status}`} />
                  <span>
                    <strong>{item.name}</strong>
                    <small>
                      {item.workout_date} · {item.clips.length} clips
                    </small>
                  </span>
                  <em>{statusText(item.status)}</em>
                </button>
                {!processingStatuses.includes(item.status) && (
                  <button
                    className="history-delete"
                    disabled={busy}
                    onClick={() => void deleteSession(item)}
                  >
                    Delete
                  </button>
                )}
              </article>
            ))
          )}
        </section>
      )}
    </main>
  );
}

function UploadRows({ clips }: { clips: LocalClip[] }) {
  return (
    <section className="upload-rows">
      {clips.map((clip) => (
        <article key={clip.clientId} className="upload-row">
          <div>
            <strong>{clip.file.name}</strong>
            <span className={`file-status ${clip.status}`}>{clip.status}</span>
            {clip.error && <small className="error-text">{clip.error}</small>}
          </div>
          <div>
            <progress value={clip.progress} max="100" />
            <small>{clip.progress}%</small>
          </div>
        </article>
      ))}
    </section>
  );
}
