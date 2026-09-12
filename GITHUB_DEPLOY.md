# Deploying OPAQUE via GitHub

**Important clarification first:** GitHub itself — specifically **GitHub
Pages** — only serves static files (HTML/CSS/JS). It cannot run
`server/server.js`, because that's a real Node.js process that needs to
stay running and needs a real filesystem for its SQLite database. If you
put just `index.html` on GitHub Pages, the page will load, but it will
show the "No account server detected" locked screen forever — there's
nothing there to log into.

**What GitHub is genuinely great for here**: being the place your code
lives, connected to a host that actually *runs* it. Push once, and most
hosts (including the two below) auto-deploy every time you push again.

---

## Step 1 — Push this project to GitHub

```bash
cd opaque-lua-obfuscator
git init
git add .
git commit -m "Initial commit: OPAQUE obfuscator + accounts backend"
```

Create a new **empty** repo at [github.com/new](https://github.com/new)
(don't let GitHub add a README/gitignore — you already have one), then:

```bash
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
git branch -M main
git push -u origin main
```

The included `.gitignore` already keeps `server/opaque.db` (your local
database file, which contains real user data once you're running) out of
git — good, you never want that in a public repo's history.

---

## Step 2 — Pick where it actually *runs*

### Option A: Render, connected straight to your GitHub repo (easiest)

1. Go to [render.com](https://render.com) → **New → Web Service** →
   connect your GitHub account → pick this repo.
2. Render reads `render.yaml` (already included) and configures itself:
   Node runtime, `node server/server.js` as the start command, free plan.
   Click **Apply** / **Create Web Service**.
3. Every future `git push` to `main` auto-redeploys.
4. **The one real caveat**: Render's free plan has **no persistent disk**.
   `server/opaque.db` gets wiped on every redeploy and on the automatic
   restart that happens after ~15 minutes of no traffic. Great for
   demoing this to people; not great if you want real users' accounts to
   survive for more than a session. Two ways around it:
   - Uncomment the `disk:` block in `render.yaml` and upgrade to a paid
     plan (Starter, $7/mo) — that gets you a real persistent disk.
   - Or use Option B instead, which is free forever *and* persistent.

### Option B: Oracle Cloud Always Free VM (persistent, still free forever)

Already fully covered in **`server/DEPLOY_ORACLE.md`** — and it also just
does `git clone` from the exact GitHub repo you just pushed in Step 1, so
none of that work is wasted. This is the option to pick if you want
accounts and credits to actually stick around permanently, at no cost.

---

## Step 3 — After the first deploy

Whichever host you picked, visit its URL, register an account, confirm
you get 100 credits, obfuscate something, log out, log back in, confirm
the balance is still correct. From then on:

```bash
git add .
git commit -m "whatever you changed"
git push
```

...and Render redeploys automatically. On the Oracle VM, `git pull` then
`sudo systemctl restart opaque` (see `server/DEPLOY_ORACLE.md` step 9).

---

## Which one should you actually pick?

- **Just want to show people the demo, don't care if accounts reset
  occasionally**: Render (Option A). Live in about 5 minutes.
- **Want real users to keep their accounts and credits permanently, for
  free, forever**: Oracle Cloud VM (Option B). Takes closer to 30–45
  minutes the first time, but nothing resets.
- **Want both**: perfectly fine — push to GitHub once, and you can even
  run Render as a quick staging/preview environment while Oracle serves
  real traffic.