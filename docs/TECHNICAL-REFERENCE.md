# Gym Logger technical reference

Setup, maintenance and detailed behavior for contributors and administrators. For a plain-language app overview, see the [README](../README.md). Commands below run from the repository root unless stated otherwise.

## Detailed app behavior

A private, multi-user mobile PWA for batching individual gym-set videos, stitching them locally, and uploading one unlisted workout video to YouTube by default. Each person signs in with their own account and a cookie session, and each user's workout data is private by default, with optional profile sharing. The first account created becomes the admin and claims any existing data. The admin console (Settings → Admin console) lets the admin disable accounts, see each account's activity and storage, check disk space and the video queue, and switch video uploads (off, admins only, or everyone) and new sign-ups on or off without a restart. Video uploads are admin-only by default.

The app also includes a structured, dark, mobile-first workout tracker: an exercise library, set/reps/weight logging, RPE and rest tracking, per-set notes, a live rest timer, workout history, a colour-coded training heatmap, weekly muscle-set tracking, and per-exercise progression charts. Reusable machine photos can be captured from a phone, captioned, pinned to an exercise in a particular workout, and expanded from History. Workout records and photo metadata live in the local SQLite database independently of the optional video workflow; processed photo files live under `data/machine-photos/`.

Weekly muscle-set tracking excludes warmups and cardio, reports raw and RPE-aware effective sets for each active muscle group, and shows unrated or lower-effort sets separately. Today's bars compare raw working-set credits with one account-owned weekly goal per muscle, configurable in Settings > Training preferences and defaulting to 10. Primary and secondary muscle credits keep their existing weighting; the goal does not change set counting or workout recommendations.

The [exercise muscle-credit audit](EXERCISE-MUSCLE-CREDITS.md) documents the built-in
direct (1.0) and assisting (0.5) defaults, source references and variant assumptions.
Startup refreshes changed built-in mappings and their account's workout-cache revision;
custom exercises retain their saved contributions.

Personal records have two types: **Weight PR** for a heavier completed working set for an exercise, and **Volume PR** for more reps in one set at a previously logged weight for that exercise. First attempts establish a baseline. Ties, total session volume, warmups, incomplete/zero-rep sets, and failed sets below their target do not trigger records. A short popup names the record when a set is completed. Estimated 1RM remains a Progress metric.

Completed workout set history can be imported and exported from **Settings > Workout data** using CSV. Uncompleted planned or suggested rows are excluded, so importing an export cannot turn them into performed sets. Exports write `Date Lifted`, `Exercise`, `Weight (kg)`, `Weight (lb)`, `Reps`, `Bodyweight (kg)`, `Bodyweight (lb)`, `Percentile (%)`, `Warmup`, `Workout ID` and `Workout name`. Imports need a header row and one row per completed set; only `Date Lifted`, `Exercise` and `Reps` are required columns. The others are optional, and a file with neither weight column imports sets without weights and shows a warning. Column names match regardless of case and spacing, and order does not matter. Unrecognized columns are ignored and listed in the review; a known column that appears twice is rejected. `Workout ID` and `Workout name` keep separate sessions on the same date apart. IDs group rows within the file; importing always creates account-owned records with new IDs and never uses a supplied ID to overwrite a workout. Files without Workout ID remain valid, but all rows on one date become one session because they contain no session identity.

Imports accept UTF-8 comma-separated or semicolon-separated CSV and tab-separated text copied from a spreadsheet, up to 20 MB. Dates must start with `YYYY-MM-DD`; a following time of day, such as `2026-10-17 07:30:00`, is ignored. Numbers accept a decimal point or a decimal comma with one or two decimal places (`82,5`); values with units, such as `80kg`, are rejected. `Warmup` accepts 1/0, true/false, yes/no or y/n. When only `Weight (lb)` or `Bodyweight (lb)` is filled, it is converted to kilograms and one summary warning gives the row count. Exports from other apps, such as Strong or Hevy, are not mapped automatically; their columns must first be renamed to this layout. The in-app CSV guide explains this layout and downloads a template in the person's weight unit.

Choosing a file opens a read-only review of sessions, sets, new exercises, duplicates and warnings. **Cancel** saves nothing. **Save import** revalidates the file and current limits, skips identical existing sessions in your account, and atomically adds the remaining sessions and any missing exercises. Repeated identical sets within a session are retained. Duplicate matching uses the date and completed set content, so renaming a workout does not cause a duplicate. To preserve separate same-date sessions with identical sets, include them together with different Workout IDs in one file; importing identical sessions through separate files may skip them as duplicates. Exercise aliases are compared by canonical name and pound-only legacy weights are converted to kilograms. Existing workouts and body-weight check-ins are kept; only missing body-weight dates are added from imported sets. CSV covers these set fields and session names, rather than notes, photos, videos, cardio metrics or a complete account backup.

Choose kilograms or pounds in **Settings > Training preferences** for weight entry and display across Home, the workout logger, History, Body, Progress and shared profiles. Changing this preference preserves saved weights and active entries. Workout CSVs keep both kg and lb columns; bodyweight CSVs continue to use the explicit `Weight (kg)` column regardless of the display preference.

On a fresh workout database, the app seeds five sample sessions across one week so the dashboard, heatmap, history, and progression graphs can be evaluated immediately. Set `GYM_SEED_SAMPLE_DATA=false` before first startup to disable this. Seeded workouts are labelled **Sample**; **Remove samples** in History deletes all of them without affecting real workouts or video sessions, and they will not reappear after a restart.

Long training logs load in windows. At startup the app requests `/api/dashboard?calendar_start=` and `/api/workouts/snapshot?start=` from the first day of the month two months back. After an interactive sign-in, the app mounts beneath the sign-in screen while it plays its exit animation (`AUTH_EXIT_MS`), so these requests overlap the animation. The dashboard's `history` summary (total, first and last workout dates, sample flag) tells the client whether older data exists. Scrolling a calendar past its oldest month, or choosing Show more after revealing the loaded History workouts, fetches the previous six months from `/api/workouts/snapshot?start=&end=` and `/api/calendar?start=&end=`. Streaks and the next-workout rotation still read the whole log on the server. The workout logger's PR badges and previous-set suggestions add `/api/exercise-history-baselines?before=`, a per-exercise summary of everything older than the startup window. Requests without these parameters still return the full history for clients that have not refreshed.

The first working path is YouTube mock mode. It accepts a batch, processes it with local ffmpeg, and returns a deterministic mock YouTube URL without any Google credentials.

Accounts use a username and password; no account email is collected. Usernames are case-insensitive, 3–32 ASCII letters, numbers, dots, underscores or hyphens, and start with a letter or number. The separate Name field is how you appear in the app. You can change both in Profile, where you can also add, change or remove a profile photo. Photos are cropped to a 512 px square, stored under `data/profile-photos/`, private by default and visible through optional profile sharing, included in account backups and deleted with the account; run migration `0032_profile_photos` before restarting the backend. An admin can reset a forgotten password with `python -m app.manage reset-password --username yourname`.

Each account chooses who can see its profile in **Profile > Profile sharing**: **Private** (the default), **Friends only** (followers it approves) or **Public** (every sharing member). Only accounts that share can open **Shared profiles**, follow public profiles, request to follow friends-only ones, and approve, decline or remove their own followers. Workouts and the profile photo are always part of a shared profile; a friends-only profile shows only its name and photo until a request is approved. Machine photos (those pinned to shared workouts), body weight (including body weight logged with sets), goals (the active body-weight goal and weekly Zone 2 target), cardio sessions and notes are separate opt-ins. Usernames, videos and sample data are never shared. Going private hides the profile and other profiles immediately while keeping choices and followers; making a profile public approves waiting requests. Disabled accounts are hidden and admins have no extra access. Migration `0033_profile_sharing` (release 0.5.3) adds the `profile_sharing` table, which account backups include, and `profile_follows`, which they leave out because follows involve other accounts. Both are deleted with the account.

When upgrading an email-based account database, migration `0030_username_accounts` derives usernames from the old address's part before `@`, replaces unsupported characters with hyphens, and adds numeric suffixes for duplicates. Short or unusable names become `user`. Account IDs, passwords, sessions, preferences and workout ownership are preserved. Run `python -m app.manage list-users` after migration to see the assigned usernames. The account email column is removed; rolling back requires the pre-upgrade database backup and previous app version. Existing backup archives stay unchanged; new account snapshots use manifest format 2 with an owner username.

## Project structure

- `frontend/`: React, TypeScript, Vite and `vite-plugin-pwa`; the default screen is the two-row menu with total and weekly stats.
- `backend/app/`: FastAPI API, SQLite/SQLAlchemy models, streamed multipart storage, in-process processor, and YouTube uploader interface.
- `backend/migrations/`: Alembic initial schema migration.
- `data/` (ignored by Git): SQLite database, reusable machine photos, original uploads, normalized temp files, and stitched outputs.

Sign-in uses cookie-based sessions with per-user accounts and authorization checks on each request. A sign-in lasts until the person signs out or goes 90 days (`GYM_SESSION_DAYS`) without using the app; each day of use restarts the count. Signing out, changing the password (other devices), disabling an account, or deleting it ends sessions immediately.

## Prerequisites

- Python 3.12
- Node.js 20+ and npm
- ffmpeg and ffprobe available on `PATH` (or configured with environment variables)

Windows PowerShell (using winget where available):

```powershell
winget install Python.Python.3.12
winget install OpenJS.NodeJS.LTS
winget install Gyan.FFmpeg
```

Linux (Debian/Ubuntu example):

```bash
sudo apt update
sudo apt install python3.12 python3.12-venv nodejs npm ffmpeg
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

Open `http://127.0.0.1:8000`. To create the first (admin) account, either set `GYM_REGISTRATION_INVITE_CODE` in `.env` and sign up in the browser with that code, or run `python -m app.manage create-user --username yourname --display-name "Your Name"` from the repository root. That first account takes ownership of any existing workout data. Other people can sign up only when `GYM_ALLOW_REGISTRATION=true`; `GYM_ALLOW_REGISTRATION` and `GYM_VIDEO_UPLOADS` are starting values that the admin console overrides once changed. For frontend hot reload during development, run `npm run dev` from `frontend/`; Vite proxies `/api` to the local FastAPI server.

On Windows, `./start-app.ps1` builds and starts a local copy. Use `./start-app.ps1 -Dev` to include Vite for frontend development.

The menu has one current dark/blue theme, with three total stats above three weekly/bodyweight-trend stats. The old powerlifting stars menu is retired. Building replaces the previous `frontend/dist` assets. The server revalidates HTML, the service worker, and the manifest; fingerprinted assets may be cached. Release information is checked every minute while visible and online, and when returning or reconnecting. A new release displays a top notification with a refresh arrow; **Settings > What's new > Check for updates** also checks the worker. Replacement workers download in the background and wait, preserving the current cached assets. No screen reloads automatically, including when another tab activates an update. The refresh arrow waits for installation and activation, then reloads. An active workout flushes its local draft first; storage failure, an in-flight workout save or editing a previously saved workout blocks the refresh until the work is saved. Release popups describe the loaded version and remember dismissal per account/version in this browser. The Vite development server replaces any installed production worker with a cache-clearing pass-through worker while preserving push support. Workout data, drafts, settings, and push subscriptions are retained. A local workout draft needs the exercise catalogue to reload successfully before it can be restored; failed or incomplete requests preserve the draft for retry.

Choose the pencil on **Today** to customise the Home Screen directly. The cards gently wiggle and show a drag handle at the top right, a width button beside it and a minus button at the top left. Drag a handle to move its card, or focus it and use the keyboard arrow keys; use the width button to expand or shrink a card, minus to hide a card and **Add sections** to restore it. **Save layout** stores order, widths and visibility in your account across devices; **Cancel**, choosing the highlighted pencil again or switching away from Today discards unsaved edits, and **Reset layout** restores the original arrangement and sizing before saving. An active workout's Resume card always stays visible. Card actions pause while editing, and reduced-motion settings disable the wiggle. These preferences use the existing account settings table and need no migration.

Cardio sessions accept optional whole-number calories (kcal), average heart rate, distance, average speed, incline, average indoor-cycling power, and average METs. Prefer active calories from the machine or watch. **Log metrics / Edit metrics** works for both standalone sessions and cardio linked to a workout. Blank means unknown; zero is a recorded value where valid. The Cardio screen compares calories, fat-energy equivalent, average heart rate, distance, average speed, average incline, average METs, and MET-minutes across This week, This month, 3 months, 6 months, This year, and All time. MET-minutes are calculated as average METs × session minutes, while period-average METs are weighted by duration. Each range except All time is compared with its immediately preceding equivalent period. The week follows the saved week-start preference; month/year are calendar periods to today, and 3/6 months are rolling periods anchored to today. Future sessions are excluded and metric coverage counts make partial data clear.

The comparison uses 7,700 kcal per kg as a conventional approximation and is explicitly not measured fat loss or a food deficit. It does not estimate calories automatically or infer past entries from duration. See [Hall's discussion of the energy rule and its limitations](https://pubmed.ncbi.nlm.nih.gov/17848938/). Run `alembic upgrade head` and restart the backend before serving a metrics-enabled frontend; normal `start-app.ps1` startup handles the migration and build.

The normal multipart upload is intentionally non-resumable: if a file upload fails, retrying restarts only that file. The client-generated clip ID makes the retry idempotent, while successful clips remain intact.

## YouTube completion alerts

After an upload finishes, YouTube may still need time to create playback versions. The backend polls the video's owner-only `processingDetails` status every 20 seconds and only marks the session complete when YouTube reports success. It sends a Web Push notification to every subscribed phone if YouTube finishes successfully or reports a failure.

On the installed phone PWA, enable **Settings > Timers & notifications > Phone alerts**. The browser asks for notification permission, saves the phone's subscription, and sends a test alert immediately. iPhone notifications require the PWA to be installed from Safari's **Add to Home Screen** flow. The server creates its local VAPID private key at `data/web-push-vapid-private.pem`; this is ignored by Git and must remain private.

The workout logger uses the same subscription for rest-timer alerts. Start a rest timer and tap **Alert** on its compact top bar once; subsequent rest timers notify that phone automatically, including while the PWA is backgrounded or the screen is locked. Extending or skipping the visible timer reschedules or cancels its pending notification.

With Phone alerts enabled, an active workout also schedules one reminder at two hours. The server stores this reminder so it survives restarts and can notify a backgrounded phone. Saving or cancelling the workout cancels its reminder; if the phone is offline, cancellation retries when it reconnects. Open the updated app once to register an existing workout's reminder. Upgrade to migration `0019_active_workout_reminders` before restarting the backend. A workout left running can be saved with **Actual duration (minutes)**; the correction stays in its local draft until saved.

**Weekly cardio** includes every cardio session. Weekly dashboard totals and goals follow the saved week-start preference and exclude future entries. A Sunday start means Sunday through Saturday.

Mixed portrait and landscape clips are normalized to a shared 1920x1080, 30 FPS MP4 canvas before stitching. Each clip retains its original aspect ratio: portrait clips are pillarboxed and wide clips are letterboxed where necessary. This avoids distortion and makes the concat step reliable; a single YouTube video cannot safely change its encoded frame dimensions mid-playback.

## Per-account backups

Every backup belongs to one account (`account_backups.user_id`) and holds only that account's data. Backups live in `data/account-backups/<account id>/<backup id>/`, each with a `manifest.json` that lists every file with its size and SHA-256. Run these from the folder that holds the app's `.env`:

```powershell
python -m app.manage backup-account --username yourname [--label "Before trip"]
python -m app.manage list-backups [--username yourname]
python -m app.manage import-legacy-backup --username yourname --source <backup folder>
```

`backup-account` writes a standalone SQLite database containing only that account's rows (with its password hash blanked and no sign-ins, push registrations or server settings), plus its machine photos. Video uploads are not included.

`import-legacy-backup` files a backup taken before accounts existed, such as one made before upgrading to migration `0027`, under the account that claimed that data: the first account. It copies the databases, photos and video files, leaves server secrets, keys and logs behind, and refuses a backup that already contains accounts or one that has already been imported. Deleting an account deletes its backups.

## Hidden account limits

Limits stop one account from bloating the server. They sit far above real use (a six-year log peaks at 55 sets and 9 exercises in one workout), and people are never told they exist: anything over a limit gets a plain "couldn't be saved" message, and the server log records which limit was hit. The exception is the photo upload size, which people are told ("Photos can be up to 5 MB."). The app also shrinks photos before uploading them (to 1,800 px on the long side, as JPEG), so phone photos fit easily. Adjust them under **Settings → Admin console → Account limits**; changes apply immediately.

| Limit | Default | Applies to |
|---|---|---|
| Workouts, cardio sessions | 5,000 each | each account, except admins |
| Custom exercises | 100 | each account, except admins |
| Machine photos | 25 | each account, except admins |
| Changes per minute | 60 | each account, except admins |
| Exercises / sets in one workout | 20 / 100 | everyone |
| Workout / exercise / set note | 2,000 / 1,000 / 500 characters | everyone |
| Photo upload size | 5 MB (shown to people) | everyone |

CSV imports follow the same limits and save nothing if any is exceeded. A workout saved before a limit was lowered can still be edited, but not grown.

## User review and follow-up work

The [13 October 2026 user review](reviews/2026-10-13/USER-REVIEW.md) records the
reviewed revision, sample-data evidence, prioritized findings and feature roadmap.
Use [GitHub issue #29](https://github.com/ejbolts/Gym-video-logger/issues/29) as its
tracking index; each P1 finding has a separate issue. Recheck historical findings
against the current code before starting new work.

## Checks

Run these from the repository root after activating the virtual environment:

```powershell
ruff format --check backend
ruff check backend
pytest
Set-Location frontend; npm run format:check; npm run lint; npm run build; npm test
```

Use `ruff format backend` and `npm run format` to apply formatting.

## Switching to real YouTube uploads

Configure one Google
**Web application** OAuth client, its registered callback and a persistent private encryption
key path, then enable real uploads and the appropriate account access in the admin console.
Users connect their own channels in Settings or Video logger. Connections use upload and
read-only permissions, with encrypted per-account credentials and single-use, sign-in-bound
PKCE authorization. Apply migration `0034_youtube_connections` before serving this frontend.

The legacy Desktop app command and shared token are not used for personal connections. Existing
video links remain; unfinished older batches must be uploaded again with a connected channel.
Google's current API reference no longer imposes the old blanket private-only restriction for
unverified projects; check Google's OAuth production, testing and verification requirements.

Server-to-YouTube uploads are resumable and default to `unlisted`; phone-to-server transfers
remain non-resumable. Title and description templates can use `{session_name}`, `{workout_date}`,
`{notes}`, and `{chapters}`. Timestamp links are always saved; chapter text is added only when
the timestamps satisfy common YouTube chapter minimums.

## Configuration

See `.env.example` for all supported variables:

- storage/database paths and upload limits
- starting machine-photo upload limit, 5 MB (`GYM_MAX_PHOTO_SIZE_BYTES`); the admin console overrides it
- frontend upload-concurrency hint
- ffmpeg/ffprobe executable paths
- YouTube OAuth paths, privacy, mock mode, title/description templates
- YouTube processing poll interval and Web Push VAPID/contact settings
- cleanup of original uploads and the stitched video after YouTube confirms success
- start/end trimming for each clip before it is stitched (5 seconds each by default)

By default, the original uploads and stitched output are retained while YouTube is processing, then deleted after YouTube confirms the video is ready. Set `GYM_DELETE_ORIGINALS_AFTER_SUCCESS=false` or `GYM_DELETE_OUTPUT_AFTER_SUCCESS=false` to retain either copy. Queued jobs survive a restart, while a job interrupted during ffmpeg or YouTube upload is marked failed with a useful retry message.

Each clip is also trimmed by 5 seconds at its start and end before it is normalized and stitched. Change `GYM_TRIM_START_SECONDS` or `GYM_TRIM_END_SECONDS` to adjust this (set both to `0` to disable it). Clips always retain at least 3 seconds, so very short videos are trimmed proportionally rather than made empty.

## Limitations and sensible next steps

- Uploads are not resumable and mobile browsers can suspend a backgrounded PWA.
- A processing job cannot be cancelled once ffmpeg work begins; cancellation is supported during upload.
- Video processing handles one session at a time.
- Real YouTube uploads need credentials and internet access; mock mode remains ideal for local verification.
- Future milestones could add saved workout templates, richer YouTube processing progress, or carefully designed exercise analysis. AI exercise recognition and rep counting are deliberately out of scope here.

## App guide and feedback

New accounts see a guided feature tour before the release announcement. Use **Next**, **Back** or **Skip guide**, then optionally send private feedback from the thank-you screen. Ending or skipping the first tour opens an import step: **Import or export** opens **Settings > Workout data** with the three-page CSV guide, while **Skip for now** shows the release announcement. After choosing to import, the announcement waits until the person leaves Settings. The pending step is remembered per account in the browser, so a reload returns to it; replaying the guide later does not repeat it. Administrators read the latest 100 messages in **Settings > Admin console > App feedback**; feedback is associated with the submitting username and deleted with that account. Messages are limited to 2,000 characters, 100 per account and the existing save-rate limit. A client submission ID prevents duplicates when a request is retried.

Open **Settings > Feedback & feature requests** to send feedback, report problems or suggest improvements at any time. Messages are stored in the app database with your username and appear for administrators in **Settings > Admin console > App feedback**. No email or GitHub issue is created.

Open **Settings > App guide > Replay guide** to see the tour again, or **Add to Home Screen > Show steps** for the illustrated installation instructions. Both remain available from the installed app. Settings and the closing screen link to [contribution instructions](../CONTRIBUTING.md). Upgrade existing databases with `alembic upgrade head` for `0031_app_feedback` before serving this frontend.
