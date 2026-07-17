# Gym Video Logger

A private, single-user mobile PWA for batching individual gym-set videos, stitching them locally, and uploading one unlisted workout video to YouTube. It intentionally has **no application authentication**: access is restricted by a private Tailscale network, not a login page.

The app also includes a structured, dark, mobile-first workout tracker: an exercise library, set/reps/weight logging, RPE and rest tracking, per-set notes, a live rest timer, workout history, colour-coded training heatmap, weekly totals, and per-exercise progression charts. Workout records live in the local SQLite database independently of the optional video workflow.

Workout history can be imported and exported from the History screen using CSV. The round-trip format uses these exact columns: `Date Lifted`, `Exercise`, `Weight (kg)`, `Weight (lb)`, `Reps`, `Bodyweight (kg)`, `Bodyweight (lb)`, `Percentile (%)`, and `Warmup`. Imports accept both comma-separated CSV and tab-separated text copied from a spreadsheet. Missing exercises are added to the local exercise library automatically.

On a fresh workout database, the app seeds five sample sessions across one week so the dashboard, heatmap, history, and progression graphs can be evaluated immediately. Set `GYM_SEED_SAMPLE_DATA=false` before first startup to disable this. Seeded workouts are labelled **Sample**; **Remove samples** in History deletes all of them without affecting real workouts or video sessions, and they will not reappear after a restart.

The first working path is YouTube mock mode. It accepts a batch, processes it with local ffmpeg, and returns a deterministic mock YouTube URL without any Google credentials.

## Architecture

```text
Phone PWA ── private Tailnet HTTPS ── Tailscale Serve ── 127.0.0.1:8000
                                                            │
                                                     FastAPI + SQLite
                                                            │
                                            local uploads / ffmpeg / YouTube
```

- `frontend/`: React, TypeScript, Vite and `vite-plugin-pwa`; the default screen is the upload workflow.
- `backend/app/`: FastAPI API, SQLite/SQLAlchemy models, streamed multipart storage, in-process processor, and YouTube uploader interface.
- `backend/migrations/`: Alembic initial schema migration.
- `data/` (ignored by Git): SQLite database, original uploads, normalized temp files, and stitched outputs.

The backend serves the built PWA from the same origin when `frontend/dist/` exists. No cookies, bearer tokens, account models, login endpoints, authorization middleware, cloud storage, Redis, Celery, AI recognition, or rep counting are present.

## Prerequisites

- Python 3.12
- Node.js 20+ and npm (or pnpm)
- ffmpeg and ffprobe available on `PATH` (or configured with environment variables)
- Tailscale installed on the always-on home PC for phone access

Windows PowerShell (using winget where available):

```powershell
winget install Python.Python.3.12
winget install OpenJS.NodeJS.LTS
winget install Gyan.FFmpeg
winget install Tailscale.Tailscale
```

Linux (Debian/Ubuntu example):

```bash
sudo apt update
sudo apt install python3.12 python3.12-venv nodejs npm ffmpeg
# Install Tailscale from https://tailscale.com/download/linux
```

Check the video tools before starting:

```powershell
ffmpeg -version
ffprobe -version
```

## First local run (mock YouTube)

Copy the environment template and keep mock mode enabled:

```powershell
Copy-Item .env.example .env
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -e ".[dev]"
```

```bash
cp .env.example .env
python3.12 -m venv .venv
. .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -e '.[dev]'
```

Initialize or upgrade the SQLite database, build the PWA, then run FastAPI:

```powershell
alembic upgrade head
Set-Location frontend; npm install; npm run build; Set-Location ..
uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000
```

```bash
alembic upgrade head
(cd frontend && npm install && npm run build)
uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000
```

Open `http://127.0.0.1:8000`. For frontend hot reload during development, run `npm run dev` from `frontend/`; Vite proxies `/api` to the local FastAPI server.

The normal multipart upload is intentionally non-resumable: if a file upload fails, retrying restarts only that file. The client-generated clip ID makes the retry idempotent, while successful clips remain intact.

## YouTube completion alerts

After an upload finishes, YouTube may still need time to create playback versions. The backend polls the video's owner-only `processingDetails` status every 20 seconds and only marks the session complete when YouTube reports success. It sends a Web Push notification to every subscribed phone if YouTube finishes successfully or reports a failure.

On the installed phone PWA, open the app through its Tailscale HTTPS address and choose **Enable alerts**. The browser asks for notification permission, saves the phone's subscription, and sends a test alert immediately. iPhone notifications require the PWA to be installed from Safari's **Add to Home Screen** flow. The server creates its local VAPID private key at `data/web-push-vapid-private.pem`; this is ignored by Git and must remain private.

Mixed portrait and landscape clips are normalized to a shared 1920x1080, 30 FPS MP4 canvas before stitching. Each clip retains its original aspect ratio: portrait clips are pillarboxed and wide clips are letterboxed where necessary. This avoids distortion and makes the concat step reliable; a single YouTube video cannot safely change its encoded frame dimensions mid-playback.

## Checks

Run these from the repository root after activating the virtual environment:

```powershell
ruff format --check backend
ruff check backend
pytest
Set-Location frontend; npm run format:check; npm run lint; npm run build; npm test
```

Use `ruff format backend` and `npm run format` to apply formatting.

## Tailscale: private phone access

Keep Uvicorn bound to `127.0.0.1`; do not bind it directly to a LAN or public interface, open a router port, or use Tailscale Funnel. Any person/device allowed by your Tailnet policy to reach this PC can use this intentionally unauthenticated app.

On the home PC, first inspect the installed client instead of assuming an older CLI form:

```powershell
tailscale version
tailscale serve --help
```

The current Tailscale Serve syntax is `tailscale serve [flags] <target>`. With FastAPI listening on port 8000, configure its private HTTPS reverse proxy as follows:

```powershell
tailscale serve --https=443 http://127.0.0.1:8000
tailscale serve status
```

The command above is private Serve, not Funnel. Open the HTTPS MagicDNS URL shown by `tailscale serve status` on your phone while it is connected to the same Tailnet. Install the PWA from that HTTPS page:

- iPhone/iPad: Safari → Share → **Add to Home Screen**.
- Android: Chrome menu → **Install app** / **Add to Home screen**.

Use restrictive Tailscale grants or ACLs that permit only your phone identity/device to connect to this home PC and service. Re-check `tailscale serve --help` after updating the Tailscale client; Tailscale changed Serve and Funnel CLI syntax in client version 1.52.

## Switching to real YouTube uploads

1. Create a Google Cloud OAuth **Desktop app** credential with the YouTube Data API v3 enabled.
2. Save the downloaded client-secret JSON outside source control, for example `secrets/youtube-client-secret.json`.
3. Set `GYM_YOUTUBE_MOCK_MODE=false` and configure `GYM_YOUTUBE_CLIENT_SECRET_PATH` and `GYM_YOUTUBE_TOKEN_PATH` in `.env`.
4. On the home PC, complete the local OAuth flow:

   ```powershell
   python -m app.oauth_setup
   ```

5. Restart the service. The uploader uses resumable YouTube uploads and defaults to `unlisted`.

OAuth secrets and refresh tokens are ignored by Git. The app requests YouTube's `youtube.force-ssl` permission so it can both upload videos and poll their owner-only processing status. Run the OAuth command again if upgrading from an earlier version that requested upload-only access. Title and description templates can use `{session_name}`, `{workout_date}`, `{notes}`, and `{chapters}`. Timestamp links are always saved; chapter text is added only when the timestamps satisfy common YouTube chapter minimums.

Google currently restricts uploads from unaudited API projects created after July 2020 to private viewing, even if this app requests `unlisted`. That is normal during personal testing; a YouTube API audit is required before an unaudited project can publish unlisted or public uploads.

## Configuration

See `.env.example` for all supported variables:

- storage/database paths and upload limits
- frontend upload-concurrency hint
- ffmpeg/ffprobe executable paths
- YouTube OAuth paths, privacy, mock mode, title/description templates
- YouTube processing poll interval and Web Push VAPID/contact settings
- cleanup of original uploads and the stitched video after YouTube confirms success
- start/end trimming for each clip before it is stitched (5 seconds each by default)

By default, the original uploads and stitched output are retained while YouTube is processing, then deleted after YouTube confirms the video is ready. Set `GYM_DELETE_ORIGINALS_AFTER_SUCCESS=false` or `GYM_DELETE_OUTPUT_AFTER_SUCCESS=false` to retain either copy. The processor uses an in-process queue appropriate to this one-user, one-PC deployment; it is not a distributed job queue. Queued jobs survive a restart, while a job interrupted during ffmpeg or YouTube upload is marked failed with a useful retry message.

Each clip is also trimmed by 5 seconds at its start and end before it is normalized and stitched. Change `GYM_TRIM_START_SECONDS` or `GYM_TRIM_END_SECONDS` to adjust this (set both to `0` to disable it). Clips always retain at least 3 seconds, so very short videos are trimmed proportionally rather than made empty.

## Limitations and sensible next steps

- Uploads are not resumable and mobile browsers can suspend a backgrounded PWA.
- A processing job cannot be cancelled once ffmpeg work begins; cancellation is supported during upload.
- The in-process worker processes one session at a time and is not suitable for multi-user or distributed deployment.
- Real YouTube uploads need credentials and internet access; mock mode remains ideal for local verification.
- Future milestones could add saved workout templates, richer YouTube processing progress, or carefully designed exercise analysis. AI exercise recognition and rep counting are deliberately out of scope here.
