import { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import {
  VIDEO_UPLOAD_OPTIONS,
  formatBytes,
  formatJoined,
  formatLastActive,
  plural,
  videoQueueSummary,
} from './adminDisplay';
import { authErrorMessage } from './authForm';
import { InlineConfirmButton } from './InlineConfirmButton';
import type { AdminUser, ServerSettings, ServerStatus, VideoUploadMode } from './types';
import { useUserSession } from './userContext';

export interface AdminScreenViewProps {
  currentUserId: string;
  users: AdminUser[] | null;
  settings: ServerSettings | null;
  status: ServerStatus | null;
  loading: boolean;
  error: string | null;
  notice: string | null;
  savingSetting: boolean;
  busyUserId: string | null;
  onVideoUploadsChange: (mode: VideoUploadMode) => void;
  onRegistrationChange: (open: boolean) => void;
  onUserDisabledChange: (user: AdminUser, disabled: boolean) => Promise<void>;
  onRefresh: () => void;
}

function SwitchesPanel({
  settings,
  saving,
  onVideoUploadsChange,
  onRegistrationChange,
}: {
  settings: ServerSettings;
  saving: boolean;
  onVideoUploadsChange: (mode: VideoUploadMode) => void;
  onRegistrationChange: (open: boolean) => void;
}) {
  const videoOption = VIDEO_UPLOAD_OPTIONS.find(
    (option) => option.value === settings.video_uploads,
  );
  return (
    <section className="settings-panel panel" aria-labelledby="admin-switches-title">
      <header>
        <div>
          <p className="section-kicker">SERVER SWITCHES</p>
          <h2 id="admin-switches-title">Features</h2>
        </div>
      </header>
      <div className="admin-setting">
        <div>
          <strong id="admin-video-label">Video uploads</strong>
          <small>{videoOption?.detail}</small>
        </div>
        <div
          className="segmented-control compact admin-segmented"
          role="radiogroup"
          aria-labelledby="admin-video-label"
        >
          {VIDEO_UPLOAD_OPTIONS.map((option) => (
            <button
              type="button"
              role="radio"
              key={option.value}
              aria-checked={settings.video_uploads === option.value}
              className={settings.video_uploads === option.value ? 'active' : ''}
              disabled={saving}
              onClick={() => {
                if (settings.video_uploads !== option.value) onVideoUploadsChange(option.value);
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
      <div className="notification-setting-row admin-setting-row">
        <div>
          <strong>New sign-ups</strong>
          <small>
            {settings.allow_registration
              ? settings.invite_code_required
                ? 'Anyone with the invite code can create an account'
                : 'Anyone can create an account'
              : 'Nobody new can create an account'}
          </small>
        </div>
        <button
          type="button"
          role="switch"
          aria-label="New sign-ups"
          aria-checked={settings.allow_registration}
          className={settings.allow_registration ? 'is-on' : ''}
          disabled={saving}
          onClick={() => onRegistrationChange(!settings.allow_registration)}
        >
          <span />
          {settings.allow_registration ? 'On' : 'Off'}
        </button>
      </div>
    </section>
  );
}

function StatusPanel({ status }: { status: ServerStatus }) {
  const { total_bytes, used_bytes, free_bytes } = status.disk;
  const usedPercent = total_bytes ? Math.round((used_bytes / total_bytes) * 100) : 0;
  return (
    <section className="settings-panel panel" aria-labelledby="admin-status-title">
      <header>
        <div>
          <p className="section-kicker">SERVER</p>
          <h2 id="admin-status-title">Storage &amp; processing</h2>
        </div>
      </header>
      <div
        className="admin-disk-meter"
        role="meter"
        aria-label="Disk used"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={usedPercent}
      >
        <span style={{ width: `${usedPercent}%` }} />
      </div>
      <p className="admin-disk-caption">
        {formatBytes(free_bytes)} free of {formatBytes(total_bytes)} ({usedPercent}% used)
      </p>
      <dl className="admin-stats">
        <div>
          <dt>Database</dt>
          <dd>{formatBytes(status.database_bytes)}</dd>
        </div>
        <div>
          <dt>Machine photos</dt>
          <dd>
            {plural(status.photos, 'photo')} · {formatBytes(status.photo_bytes)}
          </dd>
        </div>
        <div>
          <dt>Video files on disk</dt>
          <dd>{formatBytes(status.video_file_bytes)}</dd>
        </div>
        <div>
          <dt>Video queue</dt>
          <dd>{videoQueueSummary(status.video_queue)}</dd>
        </div>
      </dl>
    </section>
  );
}

function UserRow({
  user,
  isSelf,
  busy,
  onDisabledChange,
}: {
  user: AdminUser;
  isSelf: boolean;
  busy: boolean;
  onDisabledChange: (user: AdminUser, disabled: boolean) => Promise<void>;
}) {
  const disabled = user.disabled_at !== null;
  return (
    <li className={`admin-user ${disabled ? 'is-disabled' : ''}`}>
      <div className="admin-user-heading">
        <strong>
          {user.display_name}
          {user.is_admin && <span className="profile-badge">Admin</span>}
          {isSelf && <span className="admin-tag">You</span>}
          {disabled && <span className="admin-tag is-danger">Disabled</span>}
        </strong>
        <span>{user.email}</span>
      </div>
      <dl className="admin-user-stats">
        <div>
          <dt>Joined</dt>
          <dd>{formatJoined(user.created_at)}</dd>
        </div>
        <div>
          <dt>Last active</dt>
          <dd>{formatLastActive(user.last_active_at)}</dd>
        </div>
        <div>
          <dt>Signed in on</dt>
          <dd>{plural(user.signed_in_devices, 'device')}</dd>
        </div>
        <div>
          <dt>Workouts</dt>
          <dd>{user.workouts}</dd>
        </div>
        <div>
          <dt>Photos</dt>
          <dd>
            {user.photos} · {formatBytes(user.photo_bytes)}
          </dd>
        </div>
        <div>
          <dt>Video sessions</dt>
          <dd>{user.video_sessions}</dd>
        </div>
      </dl>
      {!isSelf &&
        (disabled ? (
          <button
            type="button"
            className="profile-secondary"
            disabled={busy}
            onClick={() => void onDisabledChange(user, false)}
          >
            {busy ? 'Enabling…' : 'Enable account'}
          </button>
        ) : (
          <InlineConfirmButton
            label="Disable account"
            confirmLabel="Disable and sign out"
            workingLabel="Disabling…"
            className="profile-danger"
            disabled={busy}
            onConfirm={() => onDisabledChange(user, true)}
          />
        ))}
    </li>
  );
}

export function AdminScreenView({
  currentUserId,
  users,
  settings,
  status,
  loading,
  error,
  notice,
  savingSetting,
  busyUserId,
  onVideoUploadsChange,
  onRegistrationChange,
  onUserDisabledChange,
  onRefresh,
}: AdminScreenViewProps) {
  const disabledCount = users?.filter((user) => user.disabled_at !== null).length ?? 0;
  return (
    <section className="settings-screen admin-screen content-page">
      <div aria-live="polite" aria-atomic="true">
        {notice && (
          <p className="notification-setting-status" role="status">
            {notice}
          </p>
        )}
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
      </div>
      {settings && (
        <SwitchesPanel
          settings={settings}
          saving={savingSetting}
          onVideoUploadsChange={onVideoUploadsChange}
          onRegistrationChange={onRegistrationChange}
        />
      )}
      {status && <StatusPanel status={status} />}
      <section className="settings-panel panel" aria-labelledby="admin-users-title">
        <header>
          <div>
            <p className="section-kicker">ACCOUNTS</p>
            <h2 id="admin-users-title">
              {users ? plural(users.length, 'account') : 'Accounts'}
              {disabledCount > 0 && ` · ${disabledCount} disabled`}
            </h2>
          </div>
        </header>
        <p>
          Disabling an account signs it out on every device and blocks sign-in. Its data is kept, so
          enabling it again restores everything.
        </p>
        {users && (
          <ul className="admin-user-list">
            {users.map((user) => (
              <UserRow
                key={user.id}
                user={user}
                isSelf={user.id === currentUserId}
                busy={busyUserId === user.id}
                onDisabledChange={onUserDisabledChange}
              />
            ))}
          </ul>
        )}
        <button type="button" className="profile-secondary" disabled={loading} onClick={onRefresh}>
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </section>
    </section>
  );
}

export function AdminScreen({ active }: { active: boolean }) {
  const { user, updateUser } = useUserSession();
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [settings, setSettings] = useState<ServerSettings | null>(null);
  const [status, setStatus] = useState<ServerStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [savingSetting, setSavingSetting] = useState(false);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [nextUsers, nextSettings, nextStatus] = await Promise.all([
        api.admin.users(),
        api.admin.settings(),
        api.admin.status(),
      ]);
      setUsers(nextUsers);
      setSettings(nextSettings);
      setStatus(nextStatus);
    } catch (reason) {
      setError(authErrorMessage(reason));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // The screen stays mounted while hidden, so reload whenever it is opened again.
    if (active) void load();
  }, [active, load]);

  async function saveSettings(update: Parameters<typeof api.admin.updateSettings>[0]) {
    if (savingSetting) return;
    setSavingSetting(true);
    setError(null);
    setNotice(null);
    try {
      const saved = await api.admin.updateSettings(update);
      setSettings(saved);
      if (update.video_uploads) {
        // Show or hide the Videos screen for this admin straight away; the switch is already
        // saved, so a failed refresh only delays that until the next sign-in check.
        await api.auth
          .me()
          .then(updateUser)
          .catch(() => undefined);
        const label = VIDEO_UPLOAD_OPTIONS.find((option) => option.value === saved.video_uploads);
        setNotice(`Video uploads: ${label?.label ?? saved.video_uploads}.`);
      } else {
        setNotice(saved.allow_registration ? 'Sign-ups are open.' : 'Sign-ups are closed.');
      }
    } catch (reason) {
      setError(authErrorMessage(reason));
    } finally {
      setSavingSetting(false);
    }
  }

  async function changeUserDisabled(target: AdminUser, disabled: boolean) {
    setBusyUserId(target.id);
    setError(null);
    setNotice(null);
    try {
      const updated = await api.admin.setUserDisabled(target.id, disabled);
      setUsers((current) =>
        current ? current.map((row) => (row.id === updated.id ? updated : row)) : current,
      );
      setNotice(
        disabled
          ? `${updated.display_name} is disabled and signed out.`
          : `${updated.display_name} can sign in again.`,
      );
    } catch (reason) {
      setError(authErrorMessage(reason));
    } finally {
      setBusyUserId(null);
    }
  }

  if (!user?.is_admin) return null;

  return (
    <AdminScreenView
      currentUserId={user.id}
      users={users}
      settings={settings}
      status={status}
      loading={loading}
      error={error}
      notice={notice}
      savingSetting={savingSetting}
      busyUserId={busyUserId}
      onVideoUploadsChange={(mode) => void saveSettings({ video_uploads: mode })}
      onRegistrationChange={(open) => void saveSettings({ allow_registration: open })}
      onUserDisabledChange={changeUserDisabled}
      onRefresh={() => void load()}
    />
  );
}
