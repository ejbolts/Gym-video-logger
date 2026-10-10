# Gym logger agent instructions

Follow this repository's README and checks, together with the user's shared verification and Git synchronization instructions.

## Private Tailscale endpoints

- **443 -> 3773: T3 Code.** Leave this route untouched; it does not belong to the gym app.
- **8446 -> 8000: stable gym logger.** Use a separate, clean, detached worktree at an explicitly verified commit. Start with `start-stable.ps1 -VerifiedCommit <SHA> -DataRoot <absolute real-data path>`.
- **8447 -> 8001: feature verification.** Use a separate task-branch worktree and `start-verification.ps1`. This instance has isolated sample data, mock YouTube uploads, credentials, push keys and build output.

`start-app.ps1` defaults to **Verification**, not Stable. Do not launch either profile from the main checkout. Stable requires a clean detached checkout, its exact verified commit and an explicit data directory. Verification must never use or copy real workout records, uploads or credentials. Do not work in, build into or automatically pull the stable worktree. Keep the tested revision fixed during verification and rerun affected checks after changes.

Use **private Tailscale Serve**, with local app servers bound to loopback. Do not enable public Funnel. Inspect `tailscale serve status` before changing a route; never reset the full configuration or replace another project's endpoint. The three-port Funnel restriction does not apply to private Serve.

Other MainPC routes: **8444 -> 8088** belongs to Calorie Tracker; **8445 -> 5174** is a historical gym Vite preview; **8886 -> 8000** is a gym alias that may still be bookmarked. **8443 -> 3000** has no confirmed owner. Preserve these routes unless their removal is explicitly requested after checking their use. Ports and owners on another host must be inspected independently.

Git synchronization does not authorize starting, rebuilding, restarting or promoting the stable app. For verification evidence, report the actual host, HTTPS port, branch/commit (and any uncommitted edits) and data environment. Follow the shared verification skill for checks and required screenshots or recordings.
