# Hosting Gym Logger on Oracle Cloud (Always Free)

This guide moves Gym Logger from your home PC onto a small Oracle Cloud virtual machine that stays on, so your phone can reach it from anywhere over HTTPS. You will end up with:

- An Ubuntu 24.04 VM on Oracle's Always Free Ampere A1 shape (arm64).
- **Caddy** serving `https://gym.yourdomain.com` with a free Let's Encrypt certificate and forwarding requests to the app.
- The FastAPI backend running as a **systemd** service under a dedicated `gymlogger` user, from `/opt/gym-logger`, with its data in `/opt/gym-logger/data`.
- Scripts in the `deploy/` folder for setup, updates, and backups.

HTTPS is required, not optional. Secure sign-in cookies, installing the app to your home screen, and phone push notifications all need it.

Menu names and button labels in Oracle's console and in Google/DNS providers change from time to time. Where a label may differ, the text says "(menu names may vary slightly)". Look for the closest match.

Throughout this guide, lines in code blocks are typed in the place shown. Lines starting with `#` in a code block are comments and do not need to be typed.

**Placeholders used below** (replace them with your own values):

| Placeholder | Meaning | Example |
|---|---|---|
| `gym.example.com` | Your app's hostname | `gym.mydomain.com` or `yourname.duckdns.org` |
| `203.0.113.10` | Your VM's reserved public IP | Shown in Oracle after you reserve it |
| `~\.ssh\oracle_gym` | Your SSH private key on the PC | Created in step 5 |
| `t3code/multi-user-auth` / `master` | The branch to deploy | Use the branch that contains the multi-user code |

**Branch note:** the multi-user sign-in code may not be on `master` yet. Until it is merged, deploy `t3code/multi-user-auth` by passing that name wherever this guide says `master`. Deploy the same branch your PC runs, so the database schema matches.

---

## 1. Create the Oracle Cloud account

1. Go to Oracle Cloud's free tier page and choose **Start for free** (menu names may vary slightly).
2. Enter your details. Oracle needs a payment card to verify your identity. Always Free resources are not billed, but keep the account in your name and watch your email for Oracle notices.
3. **Choose the Home Region with great care.** The Home Region is set during sign-up and **cannot be changed later**. Always Free Ampere A1 capacity is limited per region and per availability domain, so choose a region that is near you and where A1 capacity is currently available. If you later find that a region has no A1 capacity, you may need a new account.
4. Finish verification, then sign in to the Oracle Cloud Console.

**Optional: upgrade to Pay As You Go.** Pay As You Go accounts usually get better Ampere A1 availability and are exempt from the idle-instance reclamation policy described in section 9. You stay within the Always Free limits and are not charged for those resources, but if you upgrade:

- Set a **budget with an alert** before doing anything else (Billing & Cost Management → Budgets, menu names may vary). Use a low threshold so you hear about any charge right away.
- Check the Always Free limits in Oracle's documentation regularly. Anything above them is billed.

## 2. Create the VM instance

1. In the console, go to **Compute → Instances → Create instance** (menu names may vary slightly).
2. **Name:** `gym-logger`.
3. **Placement:** keep the default availability domain for now. If you see "Out of host capacity" later, see the troubleshooting note below.
4. **Image:** choose **Change image → Canonical Ubuntu 24.04**. When the shape is Ampere, pick the Aarch64 build of Ubuntu 24.04 (it is shown with the arm64 variant when the shape is Ampere).
5. **Shape:** choose **Change shape → Ampere → VM.Standard.A1.Flex**. Set **2 OCPUs** and **12 GB** of memory. This is the whole Always Free A1 allowance: since June 2026 Oracle allows 2 OCPUs and 12 GB in total across all A1 instances (it was 4 OCPUs and 24 GB before). Do not go above it, or Oracle may stop the instance.
6. **Networking:** choose **Create new virtual cloud network** and keep the default public subnet. Make sure **Assign a public IPv4 address** is selected.
7. **SSH keys:** do this on your PC first (Windows 11 includes OpenSSH). In PowerShell:

   ```powershell
   ssh-keygen -t ed25519 -f $HOME\.ssh\oracle_gym -C "gym-logger"
   Get-Content $HOME\.ssh\oracle_gym.pub
   ```

   Choose **Paste public keys** and paste the single line that the second command printed. Keep `oracle_gym` (the private key) secret and never share it.

8. **Boot volume:** set the size to **100 GB** (the Always Free tier allows up to 200 GB of boot and block storage in total). Videos are deleted after YouTube processes them, so the size mostly covers the OS, the database, and machine photos.
9. Choose **Create** and wait until the instance state shows **Running**. Note its **public IP address**.

**Make the public IP reserved.** An ordinary public IP can change when the instance is stopped, restarted, or recreated, which would break your DNS. To reserve it:

1. Open the instance, then **Attached VNICs** (or **Networking**), then the primary VNIC.
2. Under **IPv4 addresses**, choose **Edit** for the public IP and select **Reserve public IP** (or create a reserved IP under **Networking → IP Management → Reserved Public IPs** and attach it to the VNIC). Menu names may vary slightly.

From here on, `203.0.113.10` in this guide means your **reserved** IP.

**"Out of host capacity" error.** This means Oracle has no free A1 capacity right now, which is common and not a fault in your account. Try again later, try a different availability domain in the same region, or try again at a quieter time of day. Upgrading to Pay As You Go (section 1) also tends to improve availability.

## 3. Open ports 80 and 443

Caddy needs port 80 (for certificate validation and redirects) and port 443 (HTTPS). Oracle has two firewalls, and **both** must allow the traffic.

**Layer 1: the VCN Security List (Oracle console).**

1. Go to **Networking → Virtual Cloud Networks** and open the VCN the instance uses.
2. Choose **Security → Security Lists → Default Security List for vcn-...** (menu names may vary slightly).
3. Choose **Add Ingress Rules** and add two rules:
   - Source CIDR `0.0.0.0/0`, IP protocol **TCP**, destination port range **80**.
   - Source CIDR `0.0.0.0/0`, IP protocol **TCP**, destination port range **443**.
4. Keep the existing rule for port 22 (SSH). Do not open port 8000. The app listens on localhost only, and Caddy is the only thing that talks to it.

**Layer 2: the host firewall on the VM (iptables).** Oracle's Ubuntu images ship with iptables rules that reject all inbound traffic except SSH. Opening the Security List alone is therefore **not enough**. The setup script handles this for you. It inserts ACCEPT rules for 80 and 443 above the image's REJECT rule and saves them with `netfilter-persistent`. If you ever need to check it yourself:

```bash
sudo iptables -L INPUT --line-numbers -n
# The ACCEPT lines for tcp dpt:80 and dpt:443 must come BEFORE the line with REJECT.
```

If you see them after REJECT, run `sudo bash /opt/gym-logger/deploy/setup-ubuntu.sh` again (it is safe to re-run) or move them by hand.

## 4. Point a hostname at the VM (DNS)

Let's Encrypt issues certificates for hostnames, not raw IP addresses, so you need a name that resolves to `203.0.113.10`.

**Option A: a domain you own (recommended).** At your domain registrar or DNS provider, add a record:

| Type | Name | Value | TTL |
|---|---|---|---|
| A | `gym` | `203.0.113.10` | default |

That creates `gym.yourdomain.com`. (Menu names may vary slightly.)

**Option B: a free dynamic-DNS name, such as DuckDNS.** Create an account, choose a subdomain such as `yourname.duckdns.org`, and set its IP to `203.0.113.10`. This is free and works with Caddy. Let's Encrypt limits how many certificates can be issued for shared domains, so if you see a rate-limit error in section 10, use your own domain instead.

**Settings to avoid for now:**

- Do not put the record behind a proxy such as Cloudflare's orange-cloud mode. Keep it "DNS only" (grey cloud). Let's Encrypt must reach your server directly, and free Cloudflare plans also limit upload sizes, which would break video uploads.

**Check that the name resolves** before running setup. In PowerShell on your PC:

```powershell
Resolve-DnsName gym.yourdomain.com
# The IPv4 address shown must be 203.0.113.10. DNS can take minutes to update.
```

## 5. Set up the VM

### 5a. Connect over SSH

```powershell
ssh -i $HOME\.ssh\oracle_gym ubuntu@203.0.113.10
```

The first time, type `yes` to accept the host key. The default user on Oracle's Ubuntu images is `ubuntu`. Check the release:

```bash
lsb_release -a   # should say Ubuntu 24.04 LTS
```

### 5b. Download the code

For a **public** repository, run:

```bash
sudo apt-get update
sudo apt-get install -y git
sudo git clone --branch master https://github.com/ejbolts/Gym-video-logger.git /opt/gym-logger
```

For a **private** repository, give the VM a read-only deploy key. Run these on the VM:

```bash
sudo mkdir -p /root/.ssh && sudo chmod 700 /root/.ssh
sudo ssh-keygen -t ed25519 -N "" -f /root/.ssh/gym_logger_deploy -C gym-logger-vm
sudo cat /root/.ssh/gym_logger_deploy.pub
```

In GitHub, open the repository, then **Settings → Deploy keys → Add deploy key**. Paste the public key and leave **Allow write access** unticked. Then, on the VM:

```bash
sudo tee -a /root/.ssh/config >/dev/null <<'EOF'
Host github.com
  IdentityFile /root/.ssh/gym_logger_deploy
  IdentitiesOnly yes
EOF
sudo chmod 600 /root/.ssh/config
sudo ssh -o StrictHostKeyChecking=accept-new -T git@github.com   # says "successfully authenticated", then exits with status 1; that is normal
sudo apt-get update && sudo apt-get install -y git
sudo git clone --branch master git@github.com:ejbolts/Gym-video-logger.git /opt/gym-logger
```

Use the `git@github.com:...` address as the repo URL in the next step.

### 5c. Run the setup script

Run this on the VM, replacing the hostname, the repo URL, and the branch with your own values:

```bash
sudo bash /opt/gym-logger/deploy/setup-ubuntu.sh gym.yourdomain.com https://github.com/ejbolts/Gym-video-logger.git master
```

For a private repo, pass the `git@github.com:ejbolts/Gym-video-logger.git` URL instead. The script:

- Adds a 4 GB swap file if the VM has under 2 GB of RAM (not needed for the recommended 12 GB shape; the AMD Micro shape needs it).
- Installs Python 3.12, ffmpeg, git, sqlite3, Node.js 24, Caddy, and unattended security updates.
- Creates the `gymlogger` system user, the data directories, and a Python virtualenv in `/opt/gym-logger/.venv`.
- Installs the backend (`pip install -e`, so the app finds the built PWA next to its source) plus `alembic`, which the service needs at startup.
- Builds the PWA (`frontend/dist`) with npm, the same way `start-app.ps1` does.
- Copies `deploy/env.production.example` to `/opt/gym-logger/.env` **only if the file does not already exist**.
- Installs the systemd unit and the Caddyfile (with your hostname filled in), and opens ports 80 and 443 in the host firewall.
- Starts Caddy. It starts the app only after the placeholders in `.env` are replaced.

The first run takes a while, mainly downloading Python packages and building the web app. It is safe to run again if something fails.

### 5d. Edit the production settings

The script stops before starting the app if `.env` still has placeholder values. That protects you from a publicly known invite code (the template is in the repository). Open the file:

```bash
sudo nano /opt/gym-logger/.env
```

Change these lines:

1. **`GYM_REGISTRATION_INVITE_CODE`**: generate a random value and paste it in. Keep it secret; anyone with it can create an account.

   ```bash
   openssl rand -base64 24
   ```

2. **`GYM_WEB_PUSH_CONTACT_EMAIL`**: replace `you@example.com` with a real mailbox you read. Use the format `mailto:you@yourdomain.com`.
3. Check that **`GYM_COOKIE_SECURE=true`** and **`GYM_SEED_SAMPLE_DATA=false`** are set, as shipped.

Save the file (Ctrl+O, Enter, Ctrl+X in nano). Then start the app:

```bash
sudo systemctl restart gym-logger
sudo systemctl status gym-logger --no-pager   # should say "active (running)"
curl -fsS http://127.0.0.1:8000/api/health    # should return a short JSON status
```

Keep `.env` private. It is readable only by root and the `gymlogger` group. Do not paste it anywhere public.

## 6. Move your existing data from the PC

Do this **before the first sign-up**. The first account created on the server becomes the admin and claims any data in the database. If you sign up first, you will have to repeat this step (see the troubleshooting table).

**6a. Stop the PC app (on the PC).** Stop the app that uses your real data (Ctrl+C in its window) and leave it stopped from here on. A stopped app cannot change the database halfway through the copy, and nothing written to the PC after the copy reaches the server. Do not run newer code against the PC copy to "upgrade" it first; the server applies every database migration itself when it starts in 6c.

**6b. Copy the files (PowerShell, from the PC folder that holds your real `data` directory).** Replace `203.0.113.10` with your IP:

```powershell
scp -i $HOME\.ssh\oracle_gym data\gym-video-logger.db ubuntu@203.0.113.10:/tmp/
scp -i $HOME\.ssh\oracle_gym data\web-push-vapid-private.pem ubuntu@203.0.113.10:/tmp/
scp -i $HOME\.ssh\oracle_gym -r data\machine-photos ubuntu@203.0.113.10:/tmp/
```

**6c. Install the files on the VM.** This stops the app while the files are replaced, then starts it again. The app applies any remaining migrations on startup:

```bash
sudo systemctl stop gym-logger
sudo install -o gymlogger -g gymlogger -m 640 /tmp/gym-video-logger.db /opt/gym-logger/data/gym-video-logger.db
sudo install -o gymlogger -g gymlogger -m 600 /tmp/web-push-vapid-private.pem /opt/gym-logger/data/web-push-vapid-private.pem
sudo rm -rf /opt/gym-logger/data/machine-photos
sudo mv /tmp/machine-photos /opt/gym-logger/data/machine-photos
sudo chown -R gymlogger:gymlogger /opt/gym-logger/data
sudo systemctl start gym-logger
sudo journalctl -u gym-logger -n 30 --no-pager   # look for alembic lines and "Application startup complete"
```

Your PC copy is still a good fallback: it is unchanged, at its old schema. Do not log workouts on both the PC app and the VM; anything logged on the PC after the copy is not on the server. After you have confirmed the VM works, stop using the PC app.

## 7. First sign-in and installing the app on your phone

**7a. Create your account.** On your phone or PC, open `https://gym.yourdomain.com`. Choose sign-up and enter:

- your email address and a password,
- the invite code from `GYM_REGISTRATION_INVITE_CODE`.

The first account becomes the **admin** and claims the workout history you copied in step 6. Any account created later is a regular user with its own private data. Browser sign-up always needs the invite code, including for this first account, so nobody can claim the server before you do. If no invite code is set, the sign-up screen says the server is not set up yet; create the first account with the admin CLI below instead.

**7a-2. The admin console.** Signed in as the admin, open **Settings → Admin console**. It has three parts:

- **Features:** two switches that take effect immediately, with no restart:
  - **Video uploads:** *Off*, *Admins* or *Everyone*. It starts *Off* on the server (`GYM_VIDEO_UPLOADS=off` in the template), because re-encoding video uses both of the VM's CPU cores and slows the app for everyone while it runs. Switch it on when you want to process a workout video, and off again afterwards. Videos already queued finish processing when you switch it off; nothing new can be uploaded or queued.
  - **New sign-ups:** once everyone who should have an account has joined, turn this off to stop new accounts entirely.
- **Storage & processing:** free disk space, database size, machine photos, video files waiting on disk, and the video queue.
- **Accounts:** everyone who has signed up, with when they joined, when they were last active, how many devices they are signed in on, and their workouts, photos and videos. **Disable account** signs that person out on every device and blocks sign-in; their data is kept, and **Enable account** restores access. You cannot disable your own account.

The values in `.env` (`GYM_VIDEO_UPLOADS`, `GYM_ALLOW_REGISTRATION`) are only starting values. Once you change a switch in the console, the console's choice is stored in the database and wins over `.env`, including after restarts and updates.

**7b. Install the app on your phone.**

- **iPhone or iPad:** open the address in **Safari**, tap **Share → Add to Home Screen**. Phone notifications on iPhone only work for apps installed this way.
- **Android:** open the address in Chrome, then choose **Install app** or **Add to Home screen** from the menu.

**7c. Re-enable push alerts.** Push subscriptions belong to the web address they were created on. Because the address has changed, open the installed app and choose **Enable alerts** again. The app sends a test alert right away.

**Managing accounts from the command line (admin CLI).** For password resets, or creating an account without the invite code, use the CLI on the VM. `list-users` also shows whether each account is active or disabled. Run the commands from the **repository folder** (`/opt/gym-logger`) and as the `gymlogger` user, not as root:

```bash
cd /opt/gym-logger
sudo -u gymlogger .venv/bin/python -m app.manage list-users
sudo -u gymlogger .venv/bin/python -m app.manage create-user --email you@example.com --display-name "Your Name" --admin
sudo -u gymlogger .venv/bin/python -m app.manage reset-password --email you@example.com
```

Two rules follow from how the app loads its settings:

- **Run from `/opt/gym-logger`.** The app reads `.env` from the folder you run it in. The CLI refuses to run if it cannot find `.env` there, and it prints the database path it is using, so you can confirm it matches `GYM_DATABASE_PATH`.
- **Do not run it as root.** Root-owned database files cannot be written by the service, so the app would fail afterwards.

If a flag is rejected, run `sudo -u gymlogger /opt/gym-logger/.venv/bin/python -m app.manage --help` to see the options your version supports.

## 8. YouTube: switching from mock mode to real uploads (optional)

The default `GYM_YOUTUBE_MOCK_MODE=true` returns a fake YouTube link and uploads nothing. To publish for real, you need the OAuth client secret and a token. The VM has no web browser, so create the token on your PC and copy it over.

1. Follow the README's "Switching to real YouTube uploads" steps on your PC. That creates `secrets\youtube-client-secret.json`, then runs `python -m app.oauth_setup` to create `secrets\youtube-token.json`.
2. Copy both files to the VM:

   ```powershell
   scp -i $HOME\.ssh\oracle_gym secrets\youtube-client-secret.json secrets\youtube-token.json ubuntu@203.0.113.10:/tmp/
   ```

3. On the VM, install them into the secrets folder (the paths in `.env` already point there):

   ```bash
   sudo install -o gymlogger -g gymlogger -m 600 /tmp/youtube-client-secret.json /tmp/youtube-token.json /opt/gym-logger/secrets/
   ```

4. Edit `.env`, set `GYM_YOUTUBE_MOCK_MODE=false`, then restart with `sudo systemctl restart gym-logger`.

The app refreshes the token file in place, so the `secrets` folder must stay writable by `gymlogger` (the unit already allows this). Unaudited Google projects are still limited to private uploads, as the README explains.

## 9. Operations

**Status and logs**

```bash
sudo systemctl status gym-logger caddy --no-pager
sudo journalctl -u gym-logger -f       # live app log (Ctrl+C to stop)
sudo journalctl -u caddy -f            # live HTTPS / proxy log
df -h /opt                              # free disk space
free -h                                 # memory and swap
```

**Updating**

```bash
sudo bash /opt/gym-logger/deploy/update.sh
```

This takes a backup first, pulls the latest commit of the branch that is checked out, reinstalls the backend, rebuilds the PWA, restarts the app, and checks `/api/health`. Migrations run automatically on restart. Pass `SKIP_FRONTEND_BUILD=1` through `sudo env` only if you built `frontend/dist` on another machine and copied it in.

After an update, the phone app may need a reload to pick up the new version. The app updates itself in the background, so reopening it is usually enough.

**Backups**

```bash
sudo bash /opt/gym-logger/deploy/backup.sh
```

This creates a consistent snapshot of the database (using SQLite's backup function, so it is safe while the app runs) plus machine photos, the Web Push key, `secrets/`, and `.env`. Archives go to `/var/backups/gym-logger/` and are kept for 14 days by default (`GYM_BACKUP_KEEP_DAYS` changes that).

Schedule it nightly with cron. Create `/etc/cron.d/gym-logger-backup`:

```bash
sudo tee /etc/cron.d/gym-logger-backup >/dev/null <<'EOF'
15 3 * * * root /bin/bash /opt/gym-logger/deploy/backup.sh >> /var/log/gym-logger-backup.log 2>&1
EOF
```

**Backups must leave the VM.** Backups on the same disk do not protect you if that disk fails. Copy them to your PC regularly. Run this in **Git Bash** (not PowerShell, because PowerShell's `>` corrupts binary data):

```bash
ssh -i ~/.ssh/oracle_gym ubuntu@203.0.113.10 "sudo tar -C /var/backups/gym-logger -cf - ." > gym-logger-backups.tar
```

Oracle Object Storage also has an Always Free allowance that is suitable for backups. These scripts do not set it up. Check Oracle's current limits and the OCI CLI documentation if you want to automate it.

**Restoring.** The header of `deploy/backup.sh` lists the restore steps.

**Ubuntu security updates.** `unattended-upgrades` installs security updates automatically. Some kernel updates need a reboot. Check with:

```bash
cat /var/run/reboot-required 2>/dev/null || echo "no reboot needed"
```

Reboot in a quiet period with `sudo reboot`. The app and Caddy start automatically afterwards.

**SSH.** Oracle's Ubuntu images allow only key-based SSH login, which is what you want. Do not enable password logins. Optionally restrict port 22 in the Security List to your home IP if it is stable.

**Idle-instance reclamation (Always Free).** Oracle may reclaim Always Free compute instances that stay very lightly used (low CPU, network, and memory use) over a sustained period (about 7 days in Oracle's documentation). A personal app with few users can look idle. Oracle documents that Pay As You Go accounts are exempt. Check Oracle's current policy before relying on the free tier. Keep backups off the VM so you can rebuild quickly if the instance is ever reclaimed.

**Costs and budgets.** Keep the budget alert from section 1 active, and review it monthly.

## 10. Troubleshooting

| Symptom | Likely cause | What to check or do |
|---|---|---|
| Browser says the certificate is invalid, or Caddy logs `challenge failed` / `timeout` | DNS does not point at the reserved IP, port 80 or 443 is closed, or the Cloudflare proxy is on | `Resolve-DnsName gym.yourdomain.com` should show `203.0.113.10`. Check the Security List (step 3) and the iptables order (`sudo iptables -L INPUT --line-numbers -n`). Turn off the proxy. Then run `sudo journalctl -u caddy -n 100 --no-pager` |
| Caddy logs `too many certificates` or other rate-limit errors | Let's Encrypt limit on a shared domain (common with free dynamic DNS) | Wait for the limit to reset, or use your own domain |
| **502 Bad Gateway** in the browser | Caddy is working but the app is not | `sudo systemctl status gym-logger --no-pager` and `sudo journalctl -u gym-logger -n 100 --no-pager`. Check that you replaced the placeholders in `.env` and that `curl http://127.0.0.1:8000/api/health` responds |
| The app fails right away with `table ... already exists` during `alembic upgrade head` | The copied database was not fully migrated on the PC (an older schema marker) | On the PC, run `.\start-app.ps1` once, stop it, then repeat step 6 |
| `attempt to write a readonly database` or `unable to open database file` | Files in `data/` are owned by root, or the database path is wrong | `sudo chown -R gymlogger:gymlogger /opt/gym-logger/data`, then check `GYM_DATABASE_PATH` in `.env` |
| `Permission denied` reading `.env` | Wrong ownership or mode | `sudo chown root:gymlogger /opt/gym-logger/.env && sudo chmod 640 /opt/gym-logger/.env` |
| Sign-in works but you are logged out at once, or the cookie never sticks | `GYM_COOKIE_SECURE=true` only sends cookies over HTTPS; you are on `http://` or the IP address | Use `https://gym.yourdomain.com`. Make sure Caddy is running. Do not change the cookie setting just to make it work over plain HTTP |
| Sign-up asks for an invite code and rejects yours | Typo, or `GYM_REGISTRATION_INVITE_CODE` was changed after the service started | Compare the value in `.env`, then `sudo systemctl restart gym-logger` |
| You created an account before copying the data | Copying the database replaces the users table, so that account is removed | Sign up again after step 6, using the same email if you want to keep your name |
| Video upload fails at the start or with a 413-style error | The request is larger than Caddy's `request_body` limit, which is 25 GB per file | Check the file size. The per-file cap is `GYM_MAX_FILE_SIZE_BYTES` (20 GiB in the template). Keep Caddy's limit above that |
| Upload fails midway on mobile | Connection drops (uploads are not resumable), or the phone sleeps | Retry the failed file only. Keep the app in the foreground during uploads |
| Upload stalls or fails with a disk error | The boot volume is full | `df -h /opt` and `sudo du -sh /opt/gym-logger/data/*`. Clear completed uploads. If you need more space, enlarge the boot volume in the console, then extend the partition on the VM (Oracle's documentation covers the `growpart` and `resize2fs` steps for Ubuntu) |
| Processing fails with `ffmpeg: not found` | ffmpeg not installed or the path is wrong | `which ffmpeg` should print `/usr/bin/ffmpeg`. Check `GYM_FFMPEG_PATH` in `.env` |
| The app is killed while processing video | The VM ran out of memory | `free -h` and `sudo dmesg | tail`. Keep the swap file in place. Lower `GYM_UPLOAD_CONCURRENCY=1` in `.env` |
| Push alerts never arrive | Notifications were not re-enabled on the new address, the iPhone app was not installed to the Home Screen, or the contact email is still a placeholder | Re-run step 7c. Check `GYM_WEB_PUSH_CONTACT_EMAIL` |
| The update fails at `npm install` / `npm run build` | A dependency failed to install, or the VM ran out of memory | Read the error output. On the 1 GB shape, build `frontend/dist` on the PC, copy it over, and run the update with `SKIP_FRONTEND_BUILD=1` |
| `Out of host capacity` when creating the VM | Oracle has no free A1 capacity in that availability domain right now | Try a different availability domain, try later, or consider Pay As You Go (section 1) |
| The app is still on an old version after an update | Browser or service-worker cache | Close the app completely and reopen it. Reload once in a desktop browser |

If something is not covered here, collect `sudo journalctl -u gym-logger -n 200 --no-pager` and `sudo journalctl -u caddy -n 100 --no-pager` before changing anything. Those logs answer most questions.

---

## Files in `deploy/`

| File | Purpose |
|---|---|
| `setup-ubuntu.sh` | One-time VM setup (section 5) |
| `update.sh` | Back up, pull, reinstall, rebuild, restart |
| `backup.sh` | Consistent database snapshot plus photos, push key, secrets, and `.env` |
| `gym-logger.service` | systemd unit (runs migrations, then the app as `gymlogger`) |
| `Caddyfile` | HTTPS reverse proxy with security headers and upload limits |
| `env.production.example` | Production `.env` template |
