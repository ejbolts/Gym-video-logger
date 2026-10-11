# Gym logger agent instructions

Follow this repository's README and checks, together with the user's shared verification and Git synchronization instructions.

## Release versions and announcements

For every application feature, fix, or other user-visible change, update `frontend/release.json` in the same change or pull request before considering the task complete. Its `version` controls whether users see the release announcement again.

- Advance the semantic version for each new release; never reuse a version that has already been deployed. Changes within the same pending release can share its version.
- **Features use a minor version bump** (for example, `0.3.0` to `0.4.0`, resetting the patch number to zero). A feature adds a capability or workflow, including one introduced through the UI, such as a new import option or sign-in method.
- **UI-only updates and bug fixes use a patch version bump** (for example, `0.3.0` to `0.3.1`). UI-only updates change layout, styling, wording or visual polish without adding a capability or workflow. A visual redesign alone is a patch; a new capability with a new interface is a feature.
- For a release containing both features and UI updates or fixes, use the minor bump. Choose the version manually in `frontend/release.json`; the build validates and publishes this metadata but does not increment versions automatically.
- Update the title, summary and changes to describe the release accurately. Keep the GitHub URL pointing to the matching release notes, and update `docs/RELEASE-NOTES.md` with those notes.
- For a visible feature or UI improvement, include a screenshot when practical. Capture the verified revision using the isolated sample-data environment, inspect it for secrets or personal data, and commit it under `docs/screenshots/releases/` with a versioned filename. Embed it in that release's notes with descriptive alt text and a caption; use before/after images when they help explain the change. For changes with no visible result, or when capture is unavailable, explain the omission in the notes or pull request.
- To show the screenshot in the app's announcement, set the optional `image` object in `frontend/release.json` with `url` and `alt`. Use the direct HTTPS `raw.githubusercontent.com` image URL pinned to the screenshot's committed revision, rather than a GitHub page URL or temporary local browser artifact. Verify the image loads for app users without signing into GitHub; the announcement must remain usable if it cannot load.
- Documentation, tests and internal tooling changes that do not affect application behavior do not require a version bump.
- A bare `git pull` does not rebuild the frontend. Follow `deploy/update.sh` and the deployment guide when an application deployment is authorized; updating release metadata does not authorize restarting or updating the stable app.

## Private Tailscale endpoints

- **443 -> 3773: T3 Code.** Leave this route untouched; it does not belong to the gym app.
- **8446 -> 8000: stable gym logger.** Preserve the stable running build and real data. Use the repository's existing startup instructions.
- **8447 -> 8001: feature verification.** This is the reserved verification route. Inspect the actual backend and isolate sample data, credentials, push keys and build output before using it. The profile launchers were reverted.

The separate PowerShell profile launchers were reverted; do not assume they exist or that `start-app.ps1` isolates test data. Verification must never use or copy real workout records, uploads or credentials. Do not build into or automatically pull a running stable checkout. Keep the tested revision fixed during verification and rerun affected checks after changes.

Use **private Tailscale Serve**, with local app servers bound to loopback. Do not enable public Funnel. Inspect `tailscale serve status` before changing a route; never reset the full configuration or replace another project's endpoint. The three-port Funnel restriction does not apply to private Serve.

Retired MainPC routes (removed 10 October 2026): **8444 -> 8088** (Calorie Tracker), **8445 -> 5174** (old gym Vite preview), **8886 -> 8000** (gym alias), and **8443 -> 3000** (owner unconfirmed). Do not recreate them unless explicitly requested. MainPC now has only 443, 8446 and 8447 configured. Inspect other hosts independently.

Git synchronization does not authorize starting, rebuilding, restarting or promoting the stable app. For verification evidence, report the actual host, HTTPS port, branch/commit (and any uncommitted edits) and data environment. Follow the shared verification skill for checks and required screenshots or recordings.
