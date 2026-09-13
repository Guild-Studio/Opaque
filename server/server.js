"use strict";
/**
 * OPAQUE backend — accounts and usage history. Currently free to use for
 * any logged-in account (no tokens, no membership tiers, no restrictions
 * on level/options) — that gating was deliberately removed for now and can
 * be reintroduced later without touching anything else here.
 *
 * Zero third-party dependencies on purpose: only Node's own built-ins
 * (http, node:sqlite, crypto, fs, path). Requires Node.js 22.5+ (for
 * node:sqlite). Run with:
 *
 *   node server.js
 *
 * ...and open http://localhost:3000 — no `npm install` step, no external
 * database server to stand up. The SQLite file (opaque.db) is created next
 * to this script on first run.
 *
 * WHAT'S REAL
 * -----------
 * Password hashing (scrypt + per-user salt, never plaintext), sessions
 * (random token in an httpOnly cookie, checked against the DB on every
 * request), and a usage history table.
 *
 * PRIVACY
 * -------
 * The usage history table stores metadata about each obfuscation run
 * (runtime, level, input size, timestamp) — NEVER the actual code you
 * obfuscated. Obfuscation itself still happens entirely client-side; this
 * server only exists for accounts.
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

// ---------------------------------------------------------------- database
const db = new DatabaseSync(DB_PATH);
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    salt TEXT NOT NULL,
    hash TEXT NOT NULL,
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
    created_at TEXT NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id)
  );
`);

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

function publicUser(user) {
  return { email: user.email };
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
    "INSERT INTO users (email, salt, hash, created_at) VALUES (?, ?, ?, ?)"
  ).run(email, salt, hash, new Date().toISOString());

  const token = createSession(Number(info.lastInsertRowid));
  setSessionCookie(res, token);
  sendJSON(res, 201, publicUser({ email }));
}

function handleLogin(req, res, body) {
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
  if (!user || !verifyPassword(password, user.salt, user.hash)) {
    return sendJSON(res, 401, { error: "Incorrect email or password." });
  }
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
  sendJSON(res, 200, publicUser(user));
}

function handleLogRun(req, res, user, body) {
  // Free to use — this just records what was run (metadata only, never the
  // code) for the history endpoint. Never blocks or costs anything.
  if (!user) return sendJSON(res, 401, { error: "Not logged in." });
  db.prepare(
    "INSERT INTO usage_history (user_id, runtime, level, input_bytes, created_at) VALUES (?, ?, ?, ?, ?)"
  ).run(
    user.id,
    String(body.runtime || "unknown"),
    String(body.level || "unknown").toUpperCase(),
    Math.floor(Number(body.inputBytes) || 0),
    new Date().toISOString()
  );
  sendJSON(res, 200, { ok: true });
}

function handleHistory(req, res, user) {
  if (!user) return sendJSON(res, 401, { error: "Not logged in." });
  const rows = db.prepare(
    "SELECT runtime, level, input_bytes, created_at FROM usage_history WHERE user_id = ? ORDER BY id DESC LIMIT 20"
  ).all(user.id);
  sendJSON(res, 200, { history: rows });
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
    if (req.method === "POST" && url.pathname === "/api/log-run") {
      return handleLogRun(req, res, user, await readJSONBody(req));
    }
    if (req.method === "GET" && url.pathname === "/api/history") {
      return handleHistory(req, res, user);
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
