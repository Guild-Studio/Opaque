# OPAQUE server — accounts, credits, and history

Adds real user accounts on top of the client-side obfuscator: register,
log in, and credits are tracked **server-side** in a real database, so a
user can't just edit their browser storage to give themselves free tokens.

## Why this exists

The obfuscator itself (lexer/parser/transforms/codegen) still runs
**entirely in the browser** — this server never sees your code, only
account/credit bookkeeping. See the file header in `server.js` for exactly
what's stored and what isn't.

## Requirements

- **Node.js 22.5 or newer** (needs the built-in `node:sqlite` module).
- Nothing else. No `npm install`, no external database server. Check your
  version with `node -v`; if it's older, either upgrade Node or swap the
  four `node:sqlite` calls in `server.js` for `better-sqlite3` (an npm
  package with the same synchronous API shape) if you'd rather not upgrade.

## Run it

```bash
cd server
node server.js
```

Then open **http://localhost:3000** — that one URL serves both the
obfuscator page and the `/api/*` endpoints, so accounts work out of the box
(no CORS setup needed). A SQLite file `server/opaque.db` is created on
first run and holds everything from then on.

Change the port with `PORT=8080 node server.js`.

## What you get

- `POST /api/register` — `{ email, password }` → creates an account with
  **100 free credits**, logs them in (sets a session cookie).
- `POST /api/login` — `{ email, password }` → logs in if the password
  matches (hashed with `scrypt` + a per-user random salt — plaintext
  passwords are never stored).
- `POST /api/logout`
- `GET /api/me` — current session's `{ email, credits }`, or 401.
- `POST /api/spend` — `{ amount, runtime, level, inputBytes }` → deducts
  credits **only if there's enough balance** (checked server-side, not
  trusted from the client), logs a history row (metadata only — never your
  actual code), returns the new balance or a 402 if you don't have enough.
- `POST /api/topup` — `{ amount }` → **demo only**, see below.
- `GET /api/history` — your last 20 runs (runtime, level, size, cost, when
  — not the code itself).

## The "buy tokens" flow is still a demo

`/api/topup` just adds credits with nothing behind it — there is still no
payment processor wired up anywhere in this project. To make it real:

1. Have the "Buy" button call your backend to create a Stripe Checkout
   Session (or your processor of choice) instead of hitting `/api/topup`
   directly.
2. Only credit the account from your **webhook handler**, once Stripe
   confirms the payment went through — never from a request the browser
   can trigger on its own, the way this demo endpoint currently works.

## Frontend behavior without this server running

`index.html` still works completely standalone (e.g. opened directly as a
file, or hosted as a static file with no backend) — `app.js` tries
`fetch('/api/me')` on load, and if that fails (no server, or a different
origin), it transparently falls back to the same local-only demo wallet
from before (credits tracked in `localStorage`, no accounts). You'll see a
small banner explaining this if you open the login modal in that mode.

## Deploying

This is a single Node process with a local SQLite file — it deploys the
same way any small Node app does: a VPS (`node server.js` behind a reverse
proxy for TLS), or a platform like Render/Railway/Fly.io that runs a Node
start command. Make sure the disk holding `opaque.db` persists across
deploys/restarts on whatever platform you choose, or accounts will reset.

For anything beyond a single instance (multiple server processes/replicas),
swap the SQLite file for a real hosted database (Postgres, MySQL, etc.) —
SQLite is great for one process but doesn't coordinate across many.

## Security notes for going further

- Sessions here are simple random tokens in an httpOnly cookie with a fixed
  30-day expiry — fine for a small project, but consider rotating tokens on
  privilege changes and adding rate limiting on `/api/login` and
  `/api/register` (a few failed attempts per IP per minute) before this
  faces the public internet at any scale.
- Put this behind HTTPS in production (via a reverse proxy like Caddy/
  nginx, or your hosting platform's built-in TLS) — cookies containing
  session tokens should never travel over plain HTTP.
- Consider email verification if you find people are farming accounts.

## Bug reports → Discord

`POST /api/report-bug` forwards bug reports to a Discord channel via
webhook — **server-side only**, so the webhook URL is never exposed to the
browser (anyone viewing page source could otherwise extract it and spam
your channel directly).

The webhook URL is set in `server.js` as a fallback default, but you should
override it via an environment variable instead of committing your real
URL to git:

```bash
DISCORD_WEBHOOK_URL="https://discord.com/api/webhooks/..." node server.js
```

Each report includes: the description, the reporter's account email (or
"not logged in"), runtime/level/options, engine version, and browser user
agent — plus, only if the reporter leaves the checkbox checked, their
current input and output code as attached `.txt` files (never sent
silently). Rate-limited to 3 reports per 10 minutes per IP (in-memory,
resets on restart) to keep it from being used to spam your Discord.

## Suggestions → Discord

Same idea, separate channel: `POST /api/suggest-feature` forwards feature
suggestions to a second Discord webhook, set via
`DISCORD_SUGGESTION_WEBHOOK_URL` (also server-side only, same reasoning as
bug reports above). Simpler payload — just the suggestion text, the
reporter's account email if logged in, and their browser — and its own
independent 3-per-10-minutes rate limit, so a burst of bug reports can't
also block someone from sending a suggestion.
