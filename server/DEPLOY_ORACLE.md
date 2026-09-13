# Deploying OPAQUE to Oracle Cloud (Always Free, forever)

This gets `server/server.js` running 24/7 on a real, persistent, genuinely
free-forever VM — no code changes needed. Total time: 30–45 minutes the
first time.

---

## 1. Create your Oracle Cloud account

1. Go to **[oracle.com/cloud/free](https://www.oracle.com/cloud/free/)** and sign up.
2. You'll be asked for a credit/debit card. This is **identity verification
   only** — as long as you stay within the "Always Free" resources below,
   you are not charged.
3. **Pick your Home Region carefully during signup and write it down.**
   This cannot be changed later, and Always Free resource availability
   (especially the ARM instances below) varies a lot by region. If your
   first-choice region is out of capacity, you can create a second account
   in a different region — but decide once and commit.

---

## 2. Create the VM ("Compute Instance")

1. In the OCI Console, open the hamburger menu → **Compute → Instances**.
2. Click **Create Instance**.
3. **Name**: `opaque-server` (or anything you like).
4. **Image and shape**:
   - Image: **Ubuntu 24.04** (recommended — the rest of this guide assumes
     Ubuntu).
   - Shape: click **Change shape**, choose **Ampere (ARM)**, then
     **VM.Standard.A1.Flex**. Set **4 OCPUs / 24 GB RAM** (the max
     Always-Free allowance) — this single instance can use the whole
     allowance, or split it across multiple smaller instances if you
     prefer. This app barely needs any of that; even 1 OCPU / 6 GB is
     overkill for it.
   - **If you get an "Out of host capacity" error**: ARM capacity is
     genuinely scarce in some regions. Either try again in a few minutes/
     hours (a common workaround is refreshing every so often until it
     succeeds), or fall back to shape **VM.Standard.E2.1.Micro** (an
     AMD-based micro instance) — smaller, but always available and still
     Always-Free, and still plenty for this app.
5. **Networking**: leave the defaults (it creates a new VCN with a public
   subnet and assigns a public IP automatically). Confirm **"Assign a
   public IPv4 address"** is checked.
6. **Add SSH keys**: choose **Generate a key pair for me**, then click
   **Save private key** and **Save public key**. Put the private key
   somewhere safe, e.g. `~/.ssh/opaque-oracle.key`, and
   `chmod 600 ~/.ssh/opaque-oracle.key` on your own machine.
7. **Boot volume**: the default (~50 GB) is far more than this app needs.
   Leave it.
8. Click **Create**. Wait 1–2 minutes for the instance state to become
   **Running**, then copy its **Public IP address** from the instance
   details page.

---

## 3. Open the firewall (two layers — both are required)

Oracle blocks inbound traffic at **two** independent layers; you must open
both, or nothing will be reachable from outside.

### 3a. Oracle's Security List (cloud-level firewall)

1. From the instance details page, click the subnet link under
   **Primary VNIC → Subnet**.
2. Click the **Default Security List** for that subnet.
3. **Add Ingress Rules** → add one rule per port you need:
   - Source CIDR: `0.0.0.0/0`, IP Protocol: TCP, Destination Port: **80**
   - Source CIDR: `0.0.0.0/0`, IP Protocol: TCP, Destination Port: **443**
   (Port 80/443 are for the reverse proxy in step 6. If you'd rather skip
   the reverse proxy and hit the app directly, also open **3000** instead
   and skip step 6 — you'll access the site as `http://YOUR_IP:3000`.)

### 3b. The VM's own OS firewall (iptables/ufw)

SSH in first (next section), then:

```bash
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow OpenSSH
sudo ufw --force enable
sudo ufw status
```

(Ubuntu 24.04 images on Oracle also ship with `iptables` rules from
Oracle's cloud-init that can additionally block traffic even with `ufw`
open. If port 80 still doesn't respond after step 6, run:
`sudo iptables -I INPUT -p tcp --dport 80 -j ACCEPT` and
`sudo iptables -I INPUT -p tcp --dport 443 -j ACCEPT`, then persist them
with `sudo netfilter-persistent save` if that tool is installed, or
add equivalent rules with `ufw` as above, which is usually sufficient on
its own.)

---

## 4. Connect over SSH

```bash
ssh -i ~/.ssh/opaque-oracle.key ubuntu@YOUR_PUBLIC_IP
```

(Username is `ubuntu` for the Ubuntu image.)

---

## 5. Install Node.js 22+ and get your code onto the VM

```bash
# Node.js 22 via NodeSource (Ubuntu/Debian)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
node -v   # confirm it's 22.5.0 or newer — node:sqlite needs that

# Get your project onto the VM. Easiest: push it to a Git repo you control
# (GitHub/GitLab, public or private) and clone it here.
git clone https://github.com/YOUR_USERNAME/YOUR_REPO.git opaque
cd opaque/server

# No npm install needed — the backend has zero dependencies on purpose.
node server.js
```

Visit `http://YOUR_PUBLIC_IP:3000` in a browser (assuming you opened port
3000 in step 3 instead of setting up the reverse proxy) — you should see
the OPAQUE homepage, locked until you register. Press `Ctrl+C` once
confirmed; the next step makes it run permanently in the background.

**No Git repo yet?** From your own machine:
```bash
scp -i ~/.ssh/opaque-oracle.key -r /path/to/opaque-lua-obfuscator ubuntu@YOUR_PUBLIC_IP:~/opaque
```

---

## 6. Keep it running permanently with systemd

This makes the server start on boot, and restart automatically if it ever
crashes.

```bash
sudo tee /etc/systemd/system/opaque.service > /dev/null <<'EOF'
[Unit]
Description=OPAQUE server
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/opaque/server
ExecStart=/usr/bin/node server.js
Environment=PORT=3000
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now opaque
sudo systemctl status opaque   # should show "active (running)"
```

Useful commands going forward:
```bash
sudo systemctl restart opaque   # after you update the code
journalctl -u opaque -f         # live logs
```

At this point the app is fully working at `http://YOUR_PUBLIC_IP:3000` —
register an account, confirm the 100 free credits show up, log out, log
back in, confirm the balance is still there. The SQLite file lives at
`/home/ubuntu/opaque/server/opaque.db` and survives reboots, redeploys,
and restarts, because this is real persistent disk, not the ephemeral
filesystem you'd get on a serverless platform.

---

## 7. Optional but recommended: real domain + free HTTPS

Right now the site is plain HTTP on a port number, and login cookies
travel unencrypted — fine for testing, not for real users. **Caddy**
gets you automatic free HTTPS (via Let's Encrypt) with almost no config.

1. Point a domain (or subdomain) you own at `YOUR_PUBLIC_IP` with an A
   record. (Don't have one? Get a cheap one, or use a free DNS service
   like DuckDNS to get a `yourname.duckdns.org` pointing at the IP.)
2. Install Caddy and have your app listen only on localhost:
   ```bash
   sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
   curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
   curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
   sudo apt-get update && sudo apt-get install -y caddy
   ```
3. Configure Caddy to reverse-proxy your domain to the app:
   ```bash
   sudo tee /etc/caddy/Caddyfile > /dev/null <<'EOF'
   yourdomain.com {
       reverse_proxy localhost:3000
   }
   EOF
   sudo systemctl restart caddy
   ```
   Caddy automatically obtains and renews a Let's Encrypt certificate —
   nothing else to configure. Make sure ports 80 and 443 are open per
   step 3 (and that port 3000 is *not* publicly open, so the app is only
   reachable through Caddy).
4. Visit `https://yourdomain.com` — done.

---

## 8. Keeping it "Always Free" and not losing it

- Oracle has reclaimed Always-Free resources from accounts left **fully
  idle** for extended periods. A live web service with even occasional
  traffic is generally fine; if you're worried, a simple cron job that
  curls your own `/api/me` every day is enough activity to look alive.
- Stay within the free shape/OCPU/RAM/storage limits shown during
  instance creation and you won't be billed — set a **Budget alert** in
  **Billing & Cost Management → Budgets** for extra peace of mind (it
  emails you if anything ever starts costing money).
- Back up `opaque.db` occasionally if you care about the data:
  `scp -i ~/.ssh/opaque-oracle.key ubuntu@YOUR_IP:~/opaque/server/opaque.db ./backup.db`

## 9. Updating the app later

```bash
ssh -i ~/.ssh/opaque-oracle.key ubuntu@YOUR_PUBLIC_IP
cd ~/opaque && git pull
sudo systemctl restart opaque
```

The database file isn't touched by a code update — accounts and credits
carry over.
