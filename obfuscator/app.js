(function () {
  "use strict";

  // ---------- level presets (real config, drives the engine directly) ----------
  const LEVEL_PRESETS = {
    LOW:     { renameIdentifiers: true,  stringObfuscation: false, controlFlow: false, deadCode: false, minify: true,  removeComments: true,  constantTransform: false, vmProtection: false, watermark: true },
    MEDIUM:  { renameIdentifiers: true,  stringObfuscation: true,  controlFlow: false, deadCode: false, minify: true,  removeComments: true,  constantTransform: true,  vmProtection: false, watermark: true },
    HIGH:    { renameIdentifiers: true,  stringObfuscation: true,  controlFlow: true,  deadCode: false, minify: true,  removeComments: true,  constantTransform: true,  vmProtection: true,  watermark: true },
    EXTREME: { renameIdentifiers: true,  stringObfuscation: true,  controlFlow: true,  deadCode: true,  minify: true,  removeComments: true,  constantTransform: true,  vmProtection: true,  watermark: true },
  };

  // Levels/options gated behind a membership (mirrors server.js — the server
  // is still the real source of truth and re-checks this on every /api/spend,
  // but gating it here too means people see the lock *before* wasting a run).
  const MEMBERSHIP_ONLY_LEVELS = new Set(["HIGH", "EXTREME"]);
  const MEMBERSHIP_ONLY_OPTIONS = new Set(["controlFlow", "deadCode", "vmProtection"]);

  // Demo pricing shown before /api/plans answers (or when there's no backend
  // at all) — kept in sync with server.js's MEMBERSHIP_PLANS/SINGLE_USE_PACKAGES.
  let PLANS = {
    memberships: {
      starter: { label: "Starter", dailyTokens: 20, priceUSD: 4.99 },
      pro:     { label: "Pro",     dailyTokens: 60, priceUSD: 9.99 },
      studio:  { label: "Studio",  dailyTokens: 200, priceUSD: 19.99 },
    },
    singleUsePackages: { 10: 2.99, 30: 6.99, 100: 17.99 },
  };

  const RUNTIME_LABELS = {
    lua51: "Lua 5.1", lua52: "Lua 5.2", lua53: "Lua 5.3", lua54: "Lua 5.4",
    luajit: "LuaJIT", luau: "Roblox Luau",
  };

  const state = {
    runtime: "luau",
    level: "HIGH",
    options: { ...LEVEL_PRESETS.HIGH },
    processing: false,
  };

  const SAMPLE = `local Players = game:GetService("Players")
local player = Players.LocalPlayer
local character = player.Character or player.CharacterAdded:Wait()
local humanoid = character:WaitForChild("Humanoid")

local function applySpeedBoost(multiplier)
    local baseSpeed = 16
    humanoid.WalkSpeed = baseSpeed * multiplier
end

local Remote = game:GetService("ReplicatedStorage"):WaitForChild("BoostEvent")
Remote.OnClientEvent:Connect(function(amount)
    applySpeedBoost(amount)
end)
`;

  // ---------------- accounts (real server-backed, with local fallback) ----------------
  // If server/server.js is running and this page is served from it, /api/me
  // will answer (200 logged in, or 401 logged out) and tokens become
  // account-bound and tamper-resistant. If this file is opened standalone
  // (e.g. via file://, or no backend running), the fetch simply fails and
  // the obfuscator stays locked (see applyAccessState) — there is no
  // anonymous local fallback balance anymore; accounts are required.
  try { localStorage.removeItem("opaque_token_balance_v1"); } catch (e) { /* old version's key — no longer used */ }

  function $(sel) { return document.querySelector(sel); }
  function $all(sel) { return Array.from(document.querySelectorAll(sel)); }

  let cmInput, cmOutput;

  // Is the currently-selected level/options combination allowed without a
  // membership? Mirrors server.js's RESTRICTED_LEVELS/RESTRICTED_OPTIONS —
  // the server re-checks this independently at spend time regardless of
  // what the UI allowed, so this is purely about not wasting the user's
  // time on a run the server will reject.
  function isMemberOnlyConfig(level, options) {
    if (MEMBERSHIP_ONLY_LEVELS.has(level)) return true;
    return Object.keys(options).some(k => options[k] && MEMBERSHIP_ONLY_OPTIONS.has(k));
  }
  function isMember() { return !!(auth.user && auth.user.membership); }

  function applyAccessState() {
    const grid = $("#tool-grid");
    const unlocked = auth.mode === "server" && !!auth.user;
    grid.classList.toggle("locked", !unlocked);
    if (cmInput) cmInput.setOption("readOnly", !unlocked);
    if (!unlocked) {
      if (auth.mode === "server") {
        $("#lock-title").textContent = "Log in to unlock the obfuscator";
        $("#lock-desc").textContent = "Create a free account and get 5 one-time-use tokens, or log in if you already have one.";
        $("#lock-cta").textContent = "Log in / Sign up";
        $("#lock-cta").style.display = "";
      } else {
        $("#lock-title").textContent = "No account server detected";
        $("#lock-desc").innerHTML = 'This page needs to be served by the account server to unlock the obfuscator. Run <code style="font-family:inherit">node server/server.js</code> and open this page from that server (e.g. http://localhost:3000) to create a free account with 5 tokens. See <code style="font-family:inherit">server/README.md</code> for setup.';
        $("#lock-cta").style.display = "none";
      }
    }
    renderFeatureGating();
    renderTokenPill();
  }
  function wireLock() {
    $("#lock-cta").addEventListener("click", () => {
      if (auth.mode === "server") openAuthModal("register");
    });
  }

  // Visually locks HIGH/EXTREME level tabs and the membership-only option
  // toggles behind a membership badge; clicking a locked control opens the
  // memberships tab of the buy modal instead of applying the change.
  function renderFeatureGating() {
    const member = isMember();
    $all(".level-tabs button").forEach(btn => {
      const restricted = MEMBERSHIP_ONLY_LEVELS.has(btn.dataset.level);
      btn.classList.toggle("membership-locked", restricted && !member);
    });
    $all("[data-opt]").forEach(el => {
      const key = el.dataset.opt;
      const row = el.closest(".toggle-row");
      const restricted = MEMBERSHIP_ONLY_OPTIONS.has(key);
      if (row) row.classList.toggle("membership-locked", restricted && !member);
    });
  }

  function renderTokenPill() {
    const countEl = $("#token-count");
    const badgeEl = $("#token-plan-badge");
    if (!countEl) return;
    if (isMember()) {
      const m = auth.user.membership;
      countEl.textContent = m.tokens;
      badgeEl.textContent = m.label;
      badgeEl.style.display = "";
    } else {
      countEl.textContent = auth.user ? auth.user.singleUseTokens : "–";
      badgeEl.style.display = "none";
    }
  }
  function bumpTokenPill() {
    const el = $("#token-count");
    el.classList.remove("bump"); void el.offsetWidth; el.classList.add("bump");
  }

  const auth = {
    mode: "local", // 'local' | 'server'
    user: null,    // { email, singleUseTokens, membership: {...} | null }
    async init() {
      try {
        const res = await fetch("/api/me", { credentials: "include" });
        if (res.status === 401) { this.mode = "server"; this.user = null; }
        else if (res.ok) { this.mode = "server"; this.user = await res.json(); }
        else { this.mode = "local"; }
      } catch (e) {
        this.mode = "local";
      }
      try {
        const res = await fetch("/api/plans");
        if (res.ok) PLANS = await res.json();
      } catch (e) { /* keep the built-in defaults — fine for local mode */ }
      this.renderHeader();
      applyAccessState();
      renderBuyModalContent();
    },
    renderHeader() {
      const area = $("#account-area");
      if (this.mode === "server" && this.user) {
        area.innerHTML = `<div class="account-chip"><span class="email">${escapeHtml(this.user.email)}</span><button id="logout-btn">Log out</button></div>`;
        $("#logout-btn").addEventListener("click", () => this.logout());
      } else {
        area.innerHTML = `<button class="btn btn-ghost btn-sm" id="login-open-btn">Log in</button>`;
        // The header's generic "Log in" button always opens the Log in tab —
        // only the token-pill (which implies "I want tokens") defaults to
        // Register, since that's the tab that actually grants any.
        $("#login-open-btn").addEventListener("click", () => openAuthModal("login"));
      }
    },
    async logout() {
      try { await fetch("/api/logout", { method: "POST", credentials: "include" }); } catch (e) { /* ignore */ }
      this.user = null;
      this.renderHeader();
      applyAccessState();
      showToast("Logged out");
    },
  };

  function openAuthModal(tab) {
    setAuthTab(tab || "login");
    $("#backend-offline-banner").style.display = auth.mode === "local" ? "block" : "none";
    $("#auth-modal").classList.add("show");
    $("#auth-email").focus();
  }
  function closeAuthModal() {
    $("#auth-modal").classList.remove("show");
    $("#auth-error").textContent = "";
    $("#auth-form").reset();
  }
  function setAuthTab(tab) {
    $all(".auth-tab").forEach(t => t.classList.toggle("active", t.dataset.tab === tab));
    const isRegister = tab === "register";
    $("#auth-title").textContent = isRegister ? "Create account" : "Log in";
    $("#auth-sub").textContent = isRegister
      ? "New accounts start with 5 free one-time-use tokens."
      : "Welcome back.";
    $("#auth-submit").textContent = isRegister ? "Create account" : "Log in";
    $("#auth-password").setAttribute("autocomplete", isRegister ? "new-password" : "current-password");
    $("#auth-password-hint").style.display = isRegister ? "block" : "none";
    $("#auth-form").dataset.mode = tab;
    $("#auth-error").textContent = "";
  }

  async function submitAuthForm(e) {
    e.preventDefault();
    const mode = $("#auth-form").dataset.mode || "login";
    const email = $("#auth-email").value.trim();
    const password = $("#auth-password").value;
    const errEl = $("#auth-error");
    errEl.textContent = "";

    if (auth.mode === "local") {
      errEl.textContent = "No account server is running for this page — see the note above.";
      return;
    }

    const btn = $("#auth-submit");
    btn.disabled = true;
    try {
      const res = await fetch(`/api/${mode === "register" ? "register" : "login"}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) { errEl.textContent = data.error || "Something went wrong."; return; }
      auth.user = data;
      auth.renderHeader();
      applyAccessState();
      closeAuthModal();
      showToast(mode === "register" ? `Welcome! +${data.singleUseTokens} free tokens.` : "Logged in.");
    } catch (err) {
      errEl.textContent = "Could not reach the account server.";
    } finally {
      btn.disabled = false;
    }
  }

  function wireAuth() {
    $("#login-open-btn")?.addEventListener("click", () => openAuthModal("login"));
    $("#auth-close").addEventListener("click", closeAuthModal);
    $("#auth-modal").addEventListener("click", (e) => { if (e.target.id === "auth-modal") closeAuthModal(); });
    $all(".auth-tab").forEach(t => t.addEventListener("click", () => setAuthTab(t.dataset.tab)));
    $("#auth-form").addEventListener("submit", submitAuthForm);
  }

  // Spend exactly 1 token for a run (server picks membership vs single-use,
  // and re-validates the feature tier independently of what the UI allowed).
  async function spendToken(meta) {
    if (!(auth.mode === "server" && auth.user)) return { ok: false, error: "Not logged in." };
    try {
      const res = await fetch("/api/spend", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(meta),
      });
      const data = await res.json();
      if (!res.ok) return { ok: false, error: data.error, requiresMembership: !!data.requiresMembership };
      auth.user = data;
      renderTokenPill();
      bumpTokenPill();
      return { ok: true };
    } catch (e) {
      return { ok: false, error: "Could not reach the account server." };
    }
  }

  async function buySingleUsePack(tokens) {
    try {
      const res = await fetch("/api/topup", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: tokens }),
      });
      const data = await res.json();
      if (!res.ok) return false;
      auth.user = data;
      renderTokenPill(); bumpTokenPill(); renderFeatureGating();
      return true;
    } catch (e) { return false; }
  }

  async function subscribeToPlan(planKey) {
    try {
      const res = await fetch("/api/subscribe", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: planKey }),
      });
      const data = await res.json();
      if (!res.ok) return false;
      auth.user = data;
      renderTokenPill(); bumpTokenPill(); renderFeatureGating();
      return true;
    } catch (e) { return false; }
  }

  // ---------------- buy modal (single-use packs + memberships) ----------------
  function openBuyModal(tab) {
    renderBuyModalContent();
    setBuyTab(tab || (isMember() ? "membership" : "single"));
    $("#buy-modal").classList.add("show");
  }
  function closeBuyModal() { $("#buy-modal").classList.remove("show"); }
  function setBuyTab(tab) {
    $all(".buy-tab").forEach(t => t.classList.toggle("active", t.dataset.tab === tab));
    $("#single-use-pane").style.display = tab === "single" ? "" : "none";
    $("#membership-pane").style.display = tab === "membership" ? "" : "none";
  }

  function renderBuyModalContent() {
    const singleWrap = $("#single-use-packages");
    if (singleWrap) {
      singleWrap.innerHTML = Object.entries(PLANS.singleUsePackages).map(([tokens, price]) => `
        <button class="pkg-card" data-tokens="${tokens}">
          <div class="amt">${tokens} <small>tokens</small></div>
          <div class="price">$${Number(price).toFixed(2)}</div>
          <div class="per">≈ ${(price / tokens * 100).toFixed(1)}¢ / token</div>
        </button>`).join("");
      $all("#single-use-packages .pkg-card").forEach(card => {
        card.addEventListener("click", async () => {
          const tokens = parseInt(card.dataset.tokens, 10);
          const ok = await buySingleUsePack(tokens);
          showToast(ok ? `Demo purchase: +${tokens} one-time tokens (no charge was made)` : "Could not complete the demo purchase.");
          if (ok) closeBuyModal();
        });
      });
    }
    const memberWrap = $("#membership-plans");
    if (memberWrap) {
      const entries = Object.entries(PLANS.memberships);
      memberWrap.innerHTML = entries.map(([key, plan], i) => `
        <button class="pkg-card plan-card ${i === 1 ? "best" : ""}" data-plan="${key}">
          <div class="amt">${plan.dailyTokens} <small>tokens / day</small></div>
          <div class="price">$${Number(plan.priceUSD).toFixed(2)}<span class="per-mo">/mo</span></div>
          <div class="per">${plan.label} — renews daily, all levels &amp; options unlocked</div>
        </button>`).join("");
      $all("#membership-plans .pkg-card").forEach(card => {
        card.addEventListener("click", async () => {
          const plan = card.dataset.plan;
          const ok = await subscribeToPlan(plan);
          showToast(ok ? `Demo subscription: ${PLANS.memberships[plan].label} active (no charge was made)` : "Could not complete the demo subscription.");
          if (ok) closeBuyModal();
        });
      });
    }
  }

  function wireWallet() {
    $("#token-pill").addEventListener("click", () => {
      if (auth.mode === "server" && auth.user) { openBuyModal(); return; }
      if (auth.mode === "server") { openAuthModal("register"); return; }
      showToast("Run the account server to get or buy tokens — see server/README.md");
    });
    $("#modal-close").addEventListener("click", closeBuyModal);
    $("#buy-modal").addEventListener("click", (e) => { if (e.target.id === "buy-modal") closeBuyModal(); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") { closeBuyModal(); closeAuthModal(); } });
    $all(".buy-tab").forEach(t => t.addEventListener("click", () => setBuyTab(t.dataset.tab)));
  }


  function initEditors() {
    cmInput = CodeMirror($("#editor-input"), {
      value: "",
      mode: "lua",
      theme: "opaque",
      lineNumbers: true,
      indentUnit: 4,
      tabSize: 4,
      lineWrapping: false,
      placeholder: "Paste your Lua/Luau code here to get started.",
    });
    cmOutput = CodeMirror($("#editor-output"), {
      value: "",
      mode: "lua",
      theme: "opaque",
      lineNumbers: true,
      readOnly: true,
      lineWrapping: false,
    });
    cmInput.on("change", () => {
      updateInputStats();
      clearError();
    });
    updateInputStats();
  }

  function loadSample() {
    cmInput.setValue(SAMPLE);
    cmInput.focus();
  }

  function bytesOf(str) { return new TextEncoder().encode(str).length; }
  function linesOf(str) { return str.length ? str.split("\n").length : 0; }

  function updateInputStats() {
    const src = cmInput.getValue();
    $("#input-stat").textContent = src.trim().length
      ? `${linesOf(src)} lines · ${bytesOf(src)} B`
      : "empty";
  }

  function setRuntime(rt) {
    state.runtime = rt;
    renderFeatureAvailability();
  }

  function setLevel(lv) {
    if (MEMBERSHIP_ONLY_LEVELS.has(lv) && !isMember()) {
      showToast(`${lv} requires a membership`);
      openBuyModal("membership");
      return;
    }
    state.level = lv;
    state.options = { ...LEVEL_PRESETS[lv] };
    renderConfigFromState();
    $all(".level-tabs button").forEach(b => b.classList.toggle("active", b.dataset.level === lv));
  }

  // Which toggles make sense per runtime (informational gating only — the
  // engine itself also silently no-ops unsupported combinations; this just
  // keeps the UI honest about what's actually going to happen).
  function featureNote(rt) {
    if (rt === "luau") return "Luau syntax (types, if-expressions, continue, compound assignment) is parsed and preserved.";
    if (rt === "lua51") return "'continue' and 'goto' aren't part of Lua 5.1; code using them will report a parse error.";
    if (rt === "luajit") return "Parsed with standard Lua 5.1 grammar (LuaJIT's core syntax).";
    return "Parsed with this runtime's grammar; unsupported constructs are reported as errors, not guessed at.";
  }
  function renderFeatureAvailability() {
    $("#runtime-note").textContent = featureNote(state.runtime);
  }

  function renderConfigFromState() {
    $all("[data-opt]").forEach(el => {
      const key = el.dataset.opt;
      el.checked = !!state.options[key];
    });
  }

  function wireToggles() {
    $all("[data-opt]").forEach(el => {
      el.addEventListener("change", () => {
        const key = el.dataset.opt;
        if (MEMBERSHIP_ONLY_OPTIONS.has(key) && el.checked && !isMember()) {
          el.checked = false;
          showToast(`"${key}" requires a membership`);
          openBuyModal("membership");
          return;
        }
        state.options[key] = el.checked;
        // VM protection only has an effect on strings that are already being
        // obfuscated — if someone turns it on, string obfuscation needs to
        // be on too, or the toggle would silently do nothing.
        if (key === "vmProtection" && el.checked && !state.options.stringObfuscation) {
          state.options.stringObfuscation = true;
          const strEl = document.querySelector('[data-opt="stringObfuscation"]');
          if (strEl) strEl.checked = true;
        }
        // Editing an individual toggle detaches from the named preset visually.
        $all(".level-tabs button").forEach(b => b.classList.remove("active"));
      });
    });
  }

  function clearError() {
    const box = $("#error-box");
    box.classList.remove("show");
    box.innerHTML = "";
  }

  function showError(title, detail) {
    const box = $("#error-box");
    box.classList.add("show");
    box.innerHTML = `<div class="etitle">${escapeHtml(title)}</div><div class="eloc">${escapeHtml(detail)}</div>`;
  }

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function showToast(msg) {
    const t = $("#toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(showToast._h);
    showToast._h = setTimeout(() => t.classList.remove("show"), 1600);
  }

  const LOADING_STEPS = ["Analyzing...", "Parsing...", "Applying transformations...", "Generating output...", "Validating..."];

  async function runObfuscation() {
    if (state.processing) return; // debounce: ignore rapid repeat clicks
    const src = cmInput.getValue();
    clearError();
    cmOutput.setValue("");
    $("#stats-row").style.visibility = "hidden";

    if (!src.trim()) {
      showError("Nothing to obfuscate", "Paste some Lua/Luau code into the input editor first.");
      return;
    }
    const MAX_BYTES = 300 * 1024; // generous client-side sanity limit
    if (bytesOf(src) > MAX_BYTES) {
      showError("Input too large", `The input is larger than the ${Math.round(MAX_BYTES/1024)} KB limit for this tool.`);
      return;
    }

    if (!(auth.mode === "server" && auth.user)) {
      if (auth.mode === "server") {
        showError("Log in to obfuscate", "Create a free account to get 5 free tokens, or log in if you already have one.");
        openAuthModal("register");
      } else {
        showError("No account server detected", "Run the account server (see server/README.md) and open this page from it to log in and use the obfuscator.");
      }
      return;
    }
    if (isMemberOnlyConfig(state.level, state.options) && !isMember()) {
      showError("Membership required", "This level/option combination is only available with a membership.");
      openBuyModal("membership");
      return;
    }
    const hasToken = isMember() ? auth.user.membership.tokens > 0 : auth.user.singleUseTokens > 0;
    if (!hasToken) {
      showError(
        "Out of tokens",
        isMember()
          ? "You've used today's membership tokens — they renew in your next 24h cycle."
          : "You're out of one-time-use tokens. Buy more, or get a membership for daily-renewing tokens and every feature."
      );
      openBuyModal();
      return;
    }

    state.processing = true;
    const btn = $("#obfuscate-btn");
    btn.disabled = true;
    btn.classList.add("loading");
    const label = btn.querySelector(".btn-label");

    try {
      for (const step of LOADING_STEPS) {
        label.textContent = step;
        await nextFrame(60);
      }

      let ast, parser;
      try {
        parser = new Parser(src, state.runtime);
        ast = parser.parseChunk();
      } catch (e) {
        renderParseError(e);
        return;
      }

      const seed = cryptoSeed();
      const gen = new CodeGenerator({
        runtime: state.runtime,
        level: state.level,
        generatedAt: new Date(),
        seed,
        minify: !!state.options.minify,
        renameIdentifiers: !!state.options.renameIdentifiers,
        stringObfuscation: !!state.options.stringObfuscation,
        removeComments: !!state.options.removeComments,
        controlFlow: !!state.options.controlFlow,
        deadCode: !!state.options.deadCode,
        constantTransform: !!state.options.constantTransform,
        vmProtection: !!state.options.vmProtection,
        watermark: state.options.watermark !== false,
      });

      let out;
      try {
        out = gen.generate(ast, parser.comments);
      } catch (e) {
        showError("Obfuscation failed", e.message || String(e));
        return;
      }

      // Output validation: the result MUST re-parse, or we refuse to hand it back.
      try {
        const p2 = new Parser(out, state.runtime);
        p2.parseChunk();
      } catch (e) {
        console.error("[internal] obfuscated output failed to re-parse", e);
        showError(
          "Couldn't produce a valid result",
          "The obfuscation pipeline produced output that failed its own validation, so nothing was returned. Try a lower obfuscation level, or simplify the input."
        );
        return;
      }

      label.textContent = "Complete.";
      const spendResult = await spendToken({ runtime: state.runtime, level: state.level, options: state.options, inputBytes: bytesOf(src) });
      if (!spendResult.ok) {
        if (spendResult.requiresMembership) {
          showError("Membership required", spendResult.error);
          openBuyModal("membership");
        } else {
          showError("Couldn't use a token", spendResult.error || "Please try again.");
        }
        return;
      }
      cmOutput.setValue(out);
      const outCard = $("#editor-output").closest(".editor-card");
      outCard.classList.remove("reveal"); void outCard.offsetWidth; outCard.classList.add("reveal");
      renderStats(src, out);
    } finally {
      state.processing = false;
      btn.disabled = false;
      btn.classList.remove("loading");
      setTimeout(() => { label.textContent = "Obfuscate"; }, 400);
    }
  }

  function cryptoSeed() {
    const arr = new Uint32Array(1);
    (window.crypto || window.msCrypto).getRandomValues(arr);
    return arr[0];
  }

  function nextFrame(ms) { return new Promise(r => setTimeout(r, ms)); }

  function renderParseError(e) {
    const line = e.line || "?";
    const col = e.col || "?";
    showError(
      "Unable to parse the code",
      `Line ${line}, column ${col}: ${e.message}`
    );
    if (typeof line === "number") {
      cmInput.setCursor({ line: line - 1, ch: Math.max(0, (col || 1) - 1) });
      cmInput.scrollIntoView({ line: line - 1, ch: 0 }, 100);
    }
  }

  function renderStats(src, out) {
    const origB = bytesOf(src), outB = bytesOf(out);
    const origL = linesOf(src), outL = linesOf(out);
    const delta = origB === 0 ? 0 : Math.round(((outB - origB) / origB) * 100);
    $("#stats-row").style.visibility = "visible";
    $("#stat-orig").textContent = `${(origB/1024).toFixed(2)} KB`;
    $("#stat-out").textContent = `${(outB/1024).toFixed(2)} KB`;
    const deltaEl = $("#stat-delta");
    deltaEl.textContent = `${delta >= 0 ? "+" : ""}${delta}%`;
    deltaEl.className = delta > 0 ? "delta-up" : "";
    $("#stat-lines").textContent = `${origL} → ${outL}`;
  }

  function copyOutput() {
    const val = cmOutput.getValue();
    if (!val) return;
    navigator.clipboard.writeText(val).then(() => showToast("Copied!")).catch(() => showToast("Couldn't copy — select and copy manually."));
  }

  function downloadOutput() {
    const val = cmOutput.getValue();
    if (!val) return;
    const ext = state.runtime === "luau" ? "luau" : "lua";
    const blob = new Blob([val], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `obfuscated.${ext}`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }

  function clearAll() {
    const src = cmInput.getValue();
    if (src.trim().length > 400) {
      if (!confirm("Clear the input, output, and stats? This can't be undone.")) return;
    }
    cmInput.setValue("");
    cmOutput.setValue("");
    clearError();
    $("#stats-row").style.visibility = "hidden";
    updateInputStats();
  }

  function wireButtons() {
    $("#obfuscate-btn").addEventListener("click", runObfuscation);
    $("#copy-btn").addEventListener("click", copyOutput);
    $("#download-btn").addEventListener("click", downloadOutput);
    $("#clear-btn").addEventListener("click", clearAll);
    $("#sample-btn").addEventListener("click", loadSample);
    $("#runtime-select").addEventListener("change", (e) => setRuntime(e.target.value));
    $all(".level-tabs button").forEach(b => b.addEventListener("click", () => setLevel(b.dataset.level)));
  }

  function wireNav() {
    $all("[data-nav]").forEach(a => {
      a.addEventListener("click", (ev) => {
        const id = a.getAttribute("href");
        if (id && id.startsWith("#")) {
          const target = document.querySelector(id);
          if (target) { ev.preventDefault(); target.scrollIntoView({ behavior: "smooth", block: "start" }); }
        }
      });
    });
  }

  function wireRipples() {
    document.addEventListener("click", (e) => {
      const btn = e.target.closest(".btn");
      if (!btn) return;
      const rect = btn.getBoundingClientRect();
      const size = Math.max(rect.width, rect.height) * 1.4;
      const ripple = document.createElement("span");
      ripple.className = "ripple";
      ripple.style.width = ripple.style.height = size + "px";
      ripple.style.left = (e.clientX - rect.left - size / 2) + "px";
      ripple.style.top = (e.clientY - rect.top - size / 2) + "px";
      btn.appendChild(ripple);
      ripple.addEventListener("animationend", () => ripple.remove());
    });
  }

  function wireScrollReveal() {
    const items = $all("[data-reveal]");
    if (!items.length) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      items.forEach(el => el.classList.add("in-view"));
      return;
    }
    items.forEach((el, i) => { el.style.transitionDelay = (i % 3) * 0.07 + "s"; });
    const io = new IntersectionObserver((entries) => {
      entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add("in-view"); io.unobserve(e.target); } });
    }, { threshold: 0.15 });
    items.forEach(el => io.observe(el));
  }

  document.addEventListener("DOMContentLoaded", () => {
    initEditors();
    setLevel("MEDIUM");
    setRuntime("luau");
    wireToggles();
    wireButtons();
    wireWallet();
    wireAuth();
    wireLock();
    wireNav();
    wireRipples();
    wireScrollReveal();
    renderFeatureAvailability();
    updateInputStats();
    auth.init();
  });
})();
