"use strict";
/**
 * OPAQUE backend — accounts, tokens, memberships, and usage history.
 *
 * Zero third-party dependencies on purpose: only Node's own built-ins
 * (http, node:sqlite, crypto, fs, path). Requires Node.js 22.5+ (for
 * node:sqlite). Run with:
 *
 *   node server.js
 *
 * TOKEN MODEL
 * -----------
 * Each obfuscation run costs exactly **1 token** — no more size/level-based
 * pricing. There are two independent token sources on an account:
 *
 *   - `single_use_tokens`: a plain counter. Registering grants 5. Buying a
 *     one-time pack adds more. These never expire and never refill on
 *     their own. Runs paid with a single-use token are restricted to a
 *     smaller feature set (see RESTRICTED_LEVELS / RESTRICTED_OPTIONS) —
 *     single-use tokens are the "try it out" tier, not the full tool.
 *   - Membership tokens: buying a membership (see MEMBERSHIP_PLANS) grants
 *     `dailyTokens` tokens immediately, in a 24h cycle. If a member runs
 *     out before the cycle ends, they simply wait for the next cycle —
 *     `refreshMembership()` resets the balance to the plan's daily
 *     allowance once 24h have elapsed since the last reset. Membership
 *     runs unlock every level and option.
 *
 * Spend order: membership tokens first (they're "use it or lose it" every
 * day anyway), then single-use tokens as a fallback.
 *
 * WHAT'S REAL vs WHAT'S STILL A DEMO
 * -----------------------------------
 * Real: password hashing (scrypt + per-user salt), sessions (random token
 * in an httpOnly cookie, checked against the DB on every request), token
 * balances and membership cycles (stored + computed server-side — a user
 * editing their browser can't grant themselves tokens or reset their own
 * cycle), and a usage history table. Feature-tier restrictions are
 * enforced here in the backend (see handleSpend), not just hidden in the
 * UI — a request for a restricted level/option without a membership is
 * rejected regardless of what the client sends.
 *
 * Still a demo: `/api/topup` and `/api/subscribe` just grant
 * tokens/membership with no payment behind them — there is still no
 * payment processor wired up. See those handlers below for exactly where
 * to plug in Stripe (or similar): create a Checkout Session, and only
 * grant anything from your webhook handler once payment is confirmed —
 * never straight from a client-triggered request like this demo does.
 *
 * PRIVACY
 * -------
 * The usage history table stores metadata about each obfuscation run
 * (level, runtime, input size, which token type was spent, timestamp) —
 * NEVER the actual code you obfuscated. Obfuscation itself still happens
 * entirely client-side; this server only exists for accounts and tokens.
 */

const http = require("http");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");

const PORT = process.env.PORT || 3000;
const DB_PATH = path.join(__dirname, "opaque.db");
const FRONTEND_FILE = process.env.OPAQUE_FRONTEND || path.join(__dirname, "..", "index.html");
const SESSION_COOKIE = "opaque_session";
const SESSION_MAX_AGE_DAYS = 30;
const FREE_SIGNUP_TOKENS = 5;
const MEMBERSHIP_CYCLE_MS = 24 * 60 * 60 * 1000;

// Source of truth for plans/pricing (demo prices — see file header).
const MEMBERSHIP_PLANS = {
  starter: { label: "Starter", dailyTokens: 20, priceUSD: 4.99 },
  pro:     { label: "Pro",     dailyTokens: 60, priceUSD: 9.99 },
  studio:  { label: "Studio",  dailyTokens: 200, priceUSD: 19.99 },
};
const SINGLE_USE_PACKAGES = {
  10:  2.99,
  30:  6.99,
  100: 17.99,
};
// Anything not listed here is available to single-use-token runs too.
const RESTRICTED_LEVELS = new Set(["HIGH", "EXTREME"]);
const RESTRICTED_OPTIONS = new Set(["controlFlow", "deadCode", "vmProtection"]);

// ---------------------------------------------------------------- database
const db = new DatabaseSync(DB_PATH);
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    salt TEXT NOT NULL,
    hash TEXT NOT NULL,
    single_use_tokens INTEGER NOT NULL DEFAULT ${FREE_SIGNUP_TOKENS},
    membership_plan TEXT DEFAULT NULL,
    membership_daily_tokens INTEGER NOT NULL DEFAULT 0,
    membership_tokens INTEGER NOT NULL DEFAULT 0,
    membership_cycle_start TEXT DEFAULT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id)
  );
  CREATE TABLE IF NOT EXISTS usage_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    runtime TEXT NOT NULL,
    level TEXT NOT NULL,
    input_bytes INTEGER NOT NULL,
    token_source TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id)
  );
`);
// Best-effort migration for databases created by the previous (credits-based)
// version of this schema — safe to run repeatedly, ignored if already applied.
for (const stmt of [
  `ALTER TABLE users ADD COLUMN single_use_tokens INTEGER NOT NULL DEFAULT ${FREE_SIGNUP_TOKENS}`,
  `ALTER TABLE users ADD COLUMN membership_plan TEXT DEFAULT NULL`,
  `ALTER TABLE users ADD COLUMN membership_daily_tokens INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE users ADD COLUMN membership_tokens INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE users ADD COLUMN membership_cycle_start TEXT DEFAULT NULL`,
]) {
  try { db.exec(stmt); } catch (e) { /* column already exists — fine */ }
}

// ------------------------------------------------------------- password hashing
function hashPassword(password, saltHex) {
  const salt = saltHex ? Buffer.from(saltHex, "hex") : crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return { salt: salt.toString("hex"), hash: hash.toString("hex") };
}
function verifyPassword(password, saltHex, hashHex) {
  const hash = crypto.scryptSync(password, Buffer.from(saltHex, "hex"), 64);
  const a = Buffer.from(hash.toString("hex"));
  const b = Buffer.from(hashHex);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ------------------------------------------------------------------ sessions
function createSession(userId) {
  const token = crypto.randomBytes(32).toString("hex");
  db.prepare("INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)")
    .run(token, userId, new Date().toISOString());
  return token;
}
function getUserFromToken(token) {
  if (!token) return null;
  const row = db.prepare(
    `SELECT u.*, s.created_at as session_created
     FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?`
  ).get(token);
  if (!row) return null;
  const ageDays = (Date.now() - new Date(row.session_created).getTime()) / 86400000;
  if (ageDays > SESSION_MAX_AGE_DAYS) {
    db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
    return null;
  }
  return row;
}

// -------------------------------------------------------- membership cycles
// If a member's 24h cycle has elapsed, reset their token balance to the
// plan's daily allowance and start a new cycle. Always call this before
// reading or spending membership_tokens, so the balance shown/spent is
// never stale.
function refreshMembership(user) {
  if (!user.membership_plan) return user;
  const plan = MEMBERSHIP_PLANS[user.membership_plan];
  if (!plan) return user; // unknown/removed plan — treat as no membership perk
  const cycleStart = user.membership_cycle_start ? new Date(user.membership_cycle_start).getTime() : 0;
  if (Date.now() - cycleStart >= MEMBERSHIP_CYCLE_MS) {
    const now = new Date().toISOString();
    db.prepare("UPDATE users SET membership_tokens = ?, membership_cycle_start = ? WHERE id = ?")
      .run(plan.dailyTokens, now, user.id);
    user.membership_tokens = plan.dailyTokens;
    user.membership_cycle_start = now;
  }
  return user;
}

function publicUser(user) {
  const membership = user.membership_plan
    ? {
        plan: user.membership_plan,
        label: MEMBERSHIP_PLANS[user.membership_plan]?.label || user.membership_plan,
        tokens: user.membership_tokens,
        dailyTokens: user.membership_daily_tokens,
        renewsAt: new Date(new Date(user.membership_cycle_start).getTime() + MEMBERSHIP_CYCLE_MS).toISOString(),
      }
    : null;
  return { email: user.email, singleUseTokens: user.single_use_tokens, membership };
}

// --------------------------------------------------------------- cookie helpers
function parseCookies(req) {
  const header = req.headers.cookie || "";
  const out = {};
  header.split(";").forEach(part => {
    const idx = part.indexOf("=");
    if (idx === -1) return;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  });
  return out;
}
function setSessionCookie(res, token) {
  const maxAge = SESSION_MAX_AGE_DAYS * 86400;
  res.setHeader("Set-Cookie", `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}`);
}
function clearSessionCookie(res) {
  res.setHeader("Set-Cookie", `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
}

// ------------------------------------------------------------------- helpers
function sendJSON(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(body) });
  res.end(body);
}
function readJSONBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    let size = 0;
    req.on("data", chunk => {
      size += chunk.length;
      if (size > 1_000_000) { reject(new Error("body too large")); req.destroy(); return; }
      data += chunk;
    });
    req.on("end", () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch (e) { reject(new Error("invalid JSON")); }
    });
    req.on("error", reject);
  });
}
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// -------------------------------------------------------------- route handlers
function handleRegister(req, res, body) {
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  if (!EMAIL_RE.test(email)) return sendJSON(res, 400, { error: "Enter a valid email address." });
  if (password.length < 8) return sendJSON(res, 400, { error: "Password must be at least 8 characters." });

  const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
  if (existing) return sendJSON(res, 409, { error: "An account with that email already exists." });

  const { salt, hash } = hashPassword(password);
  const info = db.prepare(
    "INSERT INTO users (email, salt, hash, single_use_tokens, created_at) VALUES (?, ?, ?, ?, ?)"
  ).run(email, salt, hash, FREE_SIGNUP_TOKENS, new Date().toISOString());

  const token = createSession(Number(info.lastInsertRowid));
  setSessionCookie(res, token);
  sendJSON(res, 201, publicUser({ email, single_use_tokens: FREE_SIGNUP_TOKENS, membership_plan: null }));
}

function handleLogin(req, res, body) {
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  let user = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
  if (!user || !verifyPassword(password, user.salt, user.hash)) {
    return sendJSON(res, 401, { error: "Incorrect email or password." });
  }
  user = refreshMembership(user);
  const token = createSession(user.id);
  setSessionCookie(res, token);
  sendJSON(res, 200, publicUser(user));
}

function handleLogout(req, res, token) {
  if (token) db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
  clearSessionCookie(res);
  sendJSON(res, 200, { ok: true });
}

function handleMe(req, res, user) {
  if (!user) return sendJSON(res, 401, { error: "Not logged in." });
  user = refreshMembership(user);
  sendJSON(res, 200, publicUser(user));
}

function handleSpend(req, res, user, body) {
  if (!user) return sendJSON(res, 401, { error: "Not logged in." });
  user = refreshMembership(user);

  const level = String(body.level || "LOW").toUpperCase();
  const options = body.options && typeof body.options === "object" ? body.options : {};
  const isMember = !!user.membership_plan;

  // Server-side enforcement of the feature tier — never trust the client's
  // own idea of what it's allowed to request.
  if (!isMember) {
    if (RESTRICTED_LEVELS.has(level)) {
      return sendJSON(res, 403, { error: `The ${level} level requires a membership.`, requiresMembership: true });
    }
    for (const key of Object.keys(options)) {
      if (options[key] && RESTRICTED_OPTIONS.has(key)) {
        return sendJSON(res, 403, { error: `"${key}" requires a membership.`, requiresMembership: true });
      }
    }
  }

  let source;
  if (isMember && user.membership_tokens > 0) {
    db.prepare("UPDATE users SET membership_tokens = membership_tokens - 1 WHERE id = ?").run(user.id);
    source = "membership";
  } else if (user.single_use_tokens > 0) {
    db.prepare("UPDATE users SET single_use_tokens = single_use_tokens - 1 WHERE id = ?").run(user.id);
    source = "single_use";
  } else {
    return sendJSON(res, 402, {
      error: isMember
        ? "You're out of tokens for today's cycle — they renew in your next 24h window."
        : "You're out of tokens. Buy a one-time pack or a membership to keep going.",
    });
  }

  db.prepare(
    "INSERT INTO usage_history (user_id, runtime, level, input_bytes, token_source, created_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(user.id, String(body.runtime || "unknown"), level, Math.floor(Number(body.inputBytes) || 0), source, new Date().toISOString());

  const fresh = refreshMembership(db.prepare("SELECT * FROM users WHERE id = ?").get(user.id));
  sendJSON(res, 200, { tokenSource: source, ...publicUser(fresh) });
}

function handleTopup(req, res, user, body) {
  // DEMO ONLY — see file header. Grants single-use tokens, charges nothing.
  if (!user) return sendJSON(res, 401, { error: "Not logged in." });
  const amount = Math.max(1, Math.min(100000, Math.floor(Number(body.amount) || 0)));
  db.prepare("UPDATE users SET single_use_tokens = single_use_tokens + ? WHERE id = ?").run(amount, user.id);
  const fresh = refreshMembership(db.prepare("SELECT * FROM users WHERE id = ?").get(user.id));
  sendJSON(res, 200, { demo: true, ...publicUser(fresh) });
}

function handleSubscribe(req, res, user, body) {
  // DEMO ONLY — see file header. Grants a membership, charges nothing.
  if (!user) return sendJSON(res, 401, { error: "Not logged in." });
  const planKey = String(body.plan || "").toLowerCase();
  const plan = MEMBERSHIP_PLANS[planKey];
  if (!plan) return sendJSON(res, 400, { error: "Unknown plan." });
  const now = new Date().toISOString();
  db.prepare(
    "UPDATE users SET membership_plan = ?, membership_daily_tokens = ?, membership_tokens = ?, membership_cycle_start = ? WHERE id = ?"
  ).run(planKey, plan.dailyTokens, plan.dailyTokens, now, user.id);
  const fresh = db.prepare("SELECT * FROM users WHERE id = ?").get(user.id);
  sendJSON(res, 200, { demo: true, ...publicUser(fresh) });
}

function handleUnsubscribe(req, res, user) {
  if (!user) return sendJSON(res, 401, { error: "Not logged in." });
  db.prepare(
    "UPDATE users SET membership_plan = NULL, membership_daily_tokens = 0, membership_tokens = 0, membership_cycle_start = NULL WHERE id = ?"
  ).run(user.id);
  const fresh = db.prepare("SELECT * FROM users WHERE id = ?").get(user.id);
  sendJSON(res, 200, publicUser(fresh));
}

function handleHistory(req, res, user) {
  if (!user) return sendJSON(res, 401, { error: "Not logged in." });
  const rows = db.prepare(
    "SELECT runtime, level, input_bytes, token_source, created_at FROM usage_history WHERE user_id = ? ORDER BY id DESC LIMIT 20"
  ).all(user.id);
  sendJSON(res, 200, { history: rows });
}

function handlePlans(req, res) {
  sendJSON(res, 200, { memberships: MEMBERSHIP_PLANS, singleUsePackages: SINGLE_USE_PACKAGES });
}

// ------------------------------------------------------------------- server
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const cookies = parseCookies(req);
  const user = getUserFromToken(cookies[SESSION_COOKIE]);

  try {
    if (req.method === "POST" && url.pathname === "/api/register") {
      return handleRegister(req, res, await readJSONBody(req));
    }
    if (req.method === "POST" && url.pathname === "/api/login") {
      return handleLogin(req, res, await readJSONBody(req));
    }
    if (req.method === "POST" && url.pathname === "/api/logout") {
      return handleLogout(req, res, cookies[SESSION_COOKIE]);
    }
    if (req.method === "GET" && url.pathname === "/api/me") {
      return handleMe(req, res, user);
    }
    if (req.method === "POST" && url.pathname === "/api/spend") {
      return handleSpend(req, res, user, await readJSONBody(req));
    }
    if (req.method === "POST" && url.pathname === "/api/topup") {
      return handleTopup(req, res, user, await readJSONBody(req));
    }
    if (req.method === "POST" && url.pathname === "/api/subscribe") {
      return handleSubscribe(req, res, user, await readJSONBody(req));
    }
    if (req.method === "POST" && url.pathname === "/api/unsubscribe") {
      return handleUnsubscribe(req, res, user);
    }
    if (req.method === "GET" && url.pathname === "/api/history") {
      return handleHistory(req, res, user);
    }
    if (req.method === "GET" && url.pathname === "/api/plans") {
      return handlePlans(req, res);
    }
  } catch (e) {
    return sendJSON(res, 400, { error: e.message || "Bad request." });
  }

  // Static frontend: serve the same single-file index.html used standalone.
  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
    fs.readFile(FRONTEND_FILE, (err, data) => {
      if (err) { res.writeHead(500); return res.end("Could not read index.html"); }
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(data);
    });
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not found");
});

server.listen(PORT, () => {
  console.log(`OPAQUE server running at http://localhost:${PORT}`);
  console.log(`Database: ${DB_PATH}`);
});

