(function () {
  "use strict";

  // ---------- level presets (real config, drives the engine directly) ----------
  const LEVEL_PRESETS = {
    LOW:     { renameIdentifiers: true,  stringObfuscation: false, controlFlow: false, deadCode: false, minify: true,  removeComments: true,  constantTransform: false, vmProtection: false, watermark: true },
    MEDIUM:  { renameIdentifiers: true,  stringObfuscation: true,  controlFlow: false, deadCode: false, minify: true,  removeComments: true,  constantTransform: true,  vmProtection: false, watermark: true },
    HIGH:    { renameIdentifiers: true,  stringObfuscation: true,  controlFlow: true,  deadCode: false, minify: true,  removeComments: true,  constantTransform: true,  vmProtection: true,  watermark: true },
    EXTREME: { renameIdentifiers: true,  stringObfuscation: true,  controlFlow: true,  deadCode: true,  minify: true,  removeComments: true,  constantTransform: true,  vmProtection: true,  watermark: true },
  };

  const RUNTIME_LABELS = {
    lua51: "Lua 5.1", lua52: "Lua 5.2", lua53: "Lua 5.3", lua54: "Lua 5.4",
    luajit: "LuaJIT", luau: "Roblox Luau",
  };

  const state = {
    runtime: "luau",
    level: "MEDIUM",
    options: { ...LEVEL_PRESETS.MEDIUM },
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
  // will answer (200 logged in, or 401 logged out). If this file is opened
  // standalone (e.g. via file://, or no backend running), the fetch simply
  // fails and the obfuscator stays locked (see applyAccessState) — there is
  // no anonymous local fallback; accounts are required, but free — there
  // are no tokens or membership tiers right now (may return later).
  try { localStorage.removeItem("opaque_token_balance_v1"); } catch (e) { /* old version's key — no longer used */ }

  function $(sel) { return document.querySelector(sel); }
  function $all(sel) { return Array.from(document.querySelectorAll(sel)); }

  let cmInput, cmOutput;

  function applyAccessState() {
    const grid = $("#tool-grid");
    const unlocked = auth.mode === "server" && !!auth.user;
    grid.classList.toggle("locked", !unlocked);
    if (cmInput) cmInput.setOption("readOnly", !unlocked);
    if (!unlocked) {
      if (auth.mode === "server") {
        $("#lock-title").textContent = "Log in to unlock the obfuscator";
        $("#lock-desc").textContent = "Create a free account, or log in if you already have one — the obfuscator is free to use.";
        $("#lock-cta").textContent = "Log in / Sign up";
        $("#lock-cta").style.display = "";
      } else {
        $("#lock-title").textContent = "No account server detected";
        $("#lock-desc").innerHTML = 'This page needs to be served by the account server to unlock the obfuscator. Run <code style="font-family:inherit">node server/server.js</code> and open this page from that server (e.g. http://localhost:3000) to create a free account. See <code style="font-family:inherit">server/README.md</code> for setup.';
        $("#lock-cta").style.display = "none";
      }
    }
  }
  function wireLock() {
    $("#lock-cta").addEventListener("click", () => {
      if (auth.mode === "server") openAuthModal("register");
    });
  }

  const auth = {
    mode: "local", // 'local' | 'server'
    user: null,    // { email } when logged in server-side
    async init() {
      try {
        const res = await fetch("/api/me", { credentials: "include" });
        if (res.status === 401) { this.mode = "server"; this.user = null; }
        else if (res.ok) { this.mode = "server"; this.user = await res.json(); }
        else { this.mode = "local"; }
      } catch (e) {
        this.mode = "local";
      }
      this.renderHeader();
      applyAccessState();
    },
    renderHeader() {
      const area = $("#account-area");
      if (this.mode === "server" && this.user) {
        area.innerHTML = `<div class="account-chip"><span class="email">${escapeHtml(this.user.email)}</span><button id="logout-btn">Log out</button></div>`;
        $("#logout-btn").addEventListener("click", () => this.logout());
      } else {
        area.innerHTML = `<button class="btn btn-ghost btn-sm" id="login-open-btn">Log in</button>`;
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
      ? "Free account — the obfuscator is free to use."
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
      showToast(mode === "register" ? "Welcome!" : "Logged in.");
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
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeAuthModal(); });
  }

  // ---------------- bug report ----------------
  function openBugReportModal() {
    $("#bug-context-summary").textContent =
      `Runtime: ${state.runtime}  ·  Level: ${state.level}  ·  Engine: v${typeof OBFUSCATOR_VERSION !== "undefined" ? OBFUSCATOR_VERSION : "?"}`;
    $("#bug-report-error").textContent = "";
    $("#bug-report-modal").classList.add("show");
    $("#bug-report-desc").focus();
  }
  function closeBugReportModal() {
    $("#bug-report-modal").classList.remove("show");
    $("#bug-report-form").reset();
    $("#bug-include-code").checked = true;
  }

  async function submitBugReport(e) {
    e.preventDefault();
    const errEl = $("#bug-report-error");
    errEl.textContent = "";
    const description = $("#bug-report-desc").value.trim();
    if (!description) { errEl.textContent = "Please describe what went wrong."; return; }

    const includeCode = $("#bug-include-code").checked;
    const btn = $("#bug-report-submit");
    btn.disabled = true;
    const originalLabel = btn.textContent;
    btn.textContent = "Sending...";
    try {
      const res = await fetch("/api/report-bug", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description,
          runtime: state.runtime,
          level: state.level,
          options: state.options,
          engineVersion: typeof OBFUSCATOR_VERSION !== "undefined" ? OBFUSCATOR_VERSION : null,
          userAgent: navigator.userAgent,
          includeCode,
          inputCode: includeCode && cmInput ? cmInput.getValue() : "",
          outputCode: includeCode && cmOutput ? cmOutput.getValue() : "",
        }),
      });
      const data = await res.json();
      if (!res.ok) { errEl.textContent = data.error || "Something went wrong sending the report."; return; }
      closeBugReportModal();
      showToast("Thanks — bug report sent!");
    } catch (err) {
      errEl.textContent = "Could not reach the server to send this report.";
    } finally {
      btn.disabled = false;
      btn.textContent = originalLabel;
    }
  }

  function wireBugReport() {
    $("#bug-report-open-btn").addEventListener("click", (e) => { e.preventDefault(); openBugReportModal(); });
    $("#bug-report-close").addEventListener("click", closeBugReportModal);
    $("#bug-report-modal").addEventListener("click", (e) => { if (e.target.id === "bug-report-modal") closeBugReportModal(); });
    $("#bug-report-form").addEventListener("submit", submitBugReport);
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeBugReportModal(); });
  }

  // ---------------- suggestions ----------------
  function openSuggestionModal() {
    $("#suggestion-error").textContent = "";
    $("#suggestion-modal").classList.add("show");
    $("#suggestion-text").focus();
  }
  function closeSuggestionModal() {
    $("#suggestion-modal").classList.remove("show");
    $("#suggestion-form").reset();
  }

  async function submitSuggestion(e) {
    e.preventDefault();
    const errEl = $("#suggestion-error");
    errEl.textContent = "";
    const suggestion = $("#suggestion-text").value.trim();
    if (!suggestion) { errEl.textContent = "Please describe your suggestion."; return; }

    const btn = $("#suggestion-submit");
    btn.disabled = true;
    const originalLabel = btn.textContent;
    btn.textContent = "Sending...";
    try {
      const res = await fetch("/api/suggest-feature", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ suggestion, userAgent: navigator.userAgent }),
      });
      const data = await res.json();
      if (!res.ok) { errEl.textContent = data.error || "Something went wrong sending the suggestion."; return; }
      closeSuggestionModal();
      showToast("Thanks — suggestion sent!");
    } catch (err) {
      errEl.textContent = "Could not reach the server to send this suggestion.";
    } finally {
      btn.disabled = false;
      btn.textContent = originalLabel;
    }
  }

  function wireSuggestion() {
    $("#suggestion-open-btn").addEventListener("click", (e) => { e.preventDefault(); openSuggestionModal(); });
    $("#suggestion-close").addEventListener("click", closeSuggestionModal);
    $("#suggestion-modal").addEventListener("click", (e) => { if (e.target.id === "suggestion-modal") closeSuggestionModal(); });
    $("#suggestion-form").addEventListener("submit", submitSuggestion);
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeSuggestionModal(); });
  }

  // Best-effort usage logging (metadata only, never the code) — purely
  // informational, never blocks or fails the run if it doesn't succeed.
  function logRun(meta) {
    if (!(auth.mode === "server" && auth.user)) return;
    fetch("/api/log-run", {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(meta),
    }).catch(() => { /* non-critical */ });
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
        showError("Log in to obfuscate", "Create a free account, or log in if you already have one.");
        openAuthModal("register");
      } else {
        showError("No account server detected", "Run the account server (see server/README.md) and open this page from it to log in and use the obfuscator.");
      }
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
      logRun({ runtime: state.runtime, level: state.level, inputBytes: bytesOf(src) });
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
    wireAuth();
    wireBugReport();
    wireSuggestion();
    wireLock();
    wireNav();
    wireRipples();
    wireScrollReveal();
    renderFeatureAvailability();
    updateInputStats();
    auth.init();
  });
})();
