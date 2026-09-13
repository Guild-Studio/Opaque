# OPAQUE — Lua/Luau Code Obfuscator

## Recent changes (this update) — obfuscator now gated behind login

- **The obfuscator panel is now locked until you're logged in.** On load,
  the whole tool area (runtime/level/options, both editors, Obfuscate) is
  blurred and disabled behind an overlay. It only unlocks once `/api/me`
  confirms a real, server-side logged-in session — never just because a
  local balance happens to be non-zero.
- **Old local credits are wiped, not just ignored.** Every previous version
  stored a free demo balance in `localStorage` under
  `opaque_token_balance_v1`. On load, that key is now deleted unconditionally
  — a returning visitor from the last version loses that leftover balance
  rather than quietly keeping it, and the tool stays locked for them exactly
  like a first-time visitor until they log in.
- **Three states, all verified end-to-end with Playwright against the real
  server:**
  1. No account server running (`index.html` opened standalone) → locked,
     with an explanation to run `server/server.js` — no anonymous access.
  2. Server running, not logged in → locked, "Log in / Sign up" button
     opens the register tab (100 free credits).
  3. Server running, logged in → fully unlocked, real server-tracked
     balance; logging out re-locks it immediately.

## Previous updates — real accounts, credits, and a database

Added `server/` — a genuine backend (Node.js + SQLite, zero third-party
dependencies) for user accounts and server-side credit balances, so
signing up grants 100 free credits that a user can't just fabricate by
editing their browser storage.

- **Real auth**: `scrypt` password hashing with a per-user random salt
  (never plaintext), session tokens in an httpOnly cookie, checked against
  the database on every request.
- **Real database**: SQLite (`server/opaque.db`, created on first run) with
  `users`, `sessions`, and `usage_history` tables. Uses Node 22's built-in
  `node:sqlite` — no `npm install`, no separate database server to stand
  up. Full details and deployment notes in `server/README.md`.
- **100 free credits on registration**, exactly as asked — granted
  server-side at `POST /api/register`, not just displayed by the frontend.
- **Usage history**, metadata only (runtime, level, input size, cost,
  timestamp) — never the code you obfuscated, consistent with the privacy
  commitments made elsewhere in this project.
- **Graceful fallback, unchanged from before**: `index.html` still works
  completely standalone with no server at all — `app.js` tries `/api/me`
  on load and silently falls back to the old local-only demo wallet
  (`localStorage`) if there's no backend to talk to. You only get real
  accounts if you actually run `server/server.js`.
- Fixed a real bug found while building this: the header's "Log in" button
  always opened the *Create account* tab, so a returning user attempting
  to log in would hit the register endpoint instead and get a 409 error.
  Verified via a full Playwright run against the real server: register →
  100 credits → obfuscate → balance debited correctly → log out → log
  back in → balance correctly restored (not reset to 0, which is what
  exposed the bug in the first place).

## Previous updates

Root-caused the "`Expected identifier when parsing expression, got ';'`"
error you were still seeing after the previous fix. This time it wasn't a
guess: I found the exact bug by inspecting the generated output byte-for-byte.

**The bug**: the dead-code injector (`maybeDeadCode`, used at HIGH/EXTREME)
appended its own trailing statement-separator, and the block joiner that
calls it *also* adds a separator between every line. Together these produced
a doubled-up `;;` in minified output — a bare, orphan empty statement with
nothing before it. A lenient parser (including my own, which is why my
previous "fix" didn't catch it on re-parse) accepts a stray `;` almost
anywhere, but Luau's actual parser does not treat a semicolon as a valid
statement on its own — it expects an expression to start there instead,
which is exactly the "Expected identifier when parsing expression, got ';'"
error. The same class of bug also existed (unused by default, but latent) in
how re-inserted comments were joined when "Remove comments" was off.

**The fix**: `maybeDeadCode` no longer emits its own separator (the block
joiner already provides it), and comment blocks are now glued directly onto
the statement they precede instead of being joined as independent entries —
so a semicolon can never end up with nothing real behind it.

**How this was verified this time**: rather than testing one fixed
configuration, I fuzzed the *actual* full script you provided (see
`engine/user_repro_script.lua` / `engine/full_script.lua`) across 500+
random seeds at every obfuscation level, grepping the raw output for
`;;`, `do;`, `then;`, `else;`, `repeat;` in addition to re-parsing it —
zero occurrences after the fix, versus a consistent, reproducible presence
before it. Also re-ran the same check live inside a real browser session
(Playwright) across 5 fresh runs with the token/purchase flow exercised in
between, to match how you'd actually use the page.

## Previous updates

- **Real token icon**: the wallet coin now uses your provided token artwork
  (embedded as base64, so the single HTML file stays self-contained).
- **More rounded, more animated UI**: bumped corner radii across cards,
  buttons, and chips; added a hover-lift + click ripple on every `.btn`, a
  subtle pulsing glow on the primary Obfuscate button, a "bump" animation on
  the token counter, and smoother switch/level-tab transitions. Everything
  respects `prefers-reduced-motion`.
- **VM protection (new transformation)**: a genuine small stack-machine
  bytecode interpreter, injected once per file in plain readable Lua. String
  constants are compiled into flat opcode arrays (push / subtract /
  byte-to-char / concat) that the interpreter executes at runtime to
  reconstruct the original bytes — instead of visible inline arithmetic.
  **Deliberately scoped to be safe**: it only ever operates on self-contained
  literal values it's handed directly. It never rewrites control flow,
  scoping, or anything referencing your own variables, so it cannot change
  what your script does — unlike a full control-flow VM (register-based
  bytecode for arbitrary statements), which would be a much bigger and
  riskier undertaking that was deliberately avoided here to protect the "the
  output must keep working" guarantee. Toggle: "VM protection" (auto-enables
  String obfuscation, since that's what it protects). On by default at
  HIGH/EXTREME.
- **Watermark header**: every obfuscated result now starts with a small,
  plain, visible `--` comment (run ID, level, runtime, timestamp). Zero
  runtime effect, no hidden tracking — it's openly documented and has its
  own on/off toggle ("Watermark header"). This is intentionally NOT a covert
  fingerprint; hidden tracking wouldn't be disclosed like this.
- Fixed two flex-layout bugs where raw text nodes next to a nested element
  inside a `display:flex` container were becoming separate flex items,
  breaking word spacing ("Cost: 3 token s", a broken line in the buy-tokens
  demo banner).

## Previous update

- **Fixed a real bug**: `string.char(...)` was emitting one argument per byte
  of every obfuscated string with no limit. Long UI copy (a ~230-character
  paragraph in a real user script) produced a single call with ~230
  arguments — the kind of construct real Lua/Luau implementations can choke
  on even though our own (more lenient) parser accepted it on re-parse.
  Strings are now chunked into `string.char(...)` calls of at most 40 bytes
  each, joined with `..`, for strings of any length. See
  `engine/user_repro_script.lua` for the real script used to catch this.
- **Token/credits system**: obfuscation now costs tokens (cost = level
  multiplier × ⌈input bytes / 400⌉, shown live before you click Obfuscate).
  New visitors start with 100 tokens, tracked in `localStorage`. This is a
  genuinely working consumption system, not a mockup.
- **Buy tokens modal**: three packages, clearly labeled as a **demo** — the
  buttons credit your local balance instantly with no real payment
  processed, since this project has no backend or payment integration.
  `buyPackage()` in `app.js` is the single place to wire up a real payment
  flow (e.g. redirect to a Stripe Checkout session, then credit tokens only
  after your backend confirms payment via webhook — never on the client's
  say-so for real money).
- **Animations**: a single staggered hero entrance, a token-balance "bump"
  animation on change, and a fade-in on the output panel when a new result
  arrives. All respect `prefers-reduced-motion`.

A real obfuscation pipeline (lexer → parser → AST → transforms → code generator)
for Lua 5.1–5.4, LuaJIT, and Roblox Luau, running entirely client-side in a
single HTML file.

## Running it

No build step, no server, no dependencies to install.

1. Open `index.html` in any modern browser (Chrome, Firefox, Safari, Edge).
2. That's it. An internet connection is only needed for two CDN assets:
   Google Fonts and CodeMirror (the code editor widget). If you need a fully
   offline copy, vendor those two dependencies locally and update the two
   `<link>`/`<script>` tags at the top/bottom of `index.html`.

There are no environment variables, no `npm install`, and no backend to run,
because the entire obfuscator — lexer, parser, transformer, code generator —
is plain JavaScript embedded in the page.

## Project layout

This repo/delivery contains the *sources* used to assemble the single
shipped file, so you can maintain them independently instead of editing a
96 KB HTML blob by hand:

```
engine/
  lexer.js      # Tokenizer: strings, numbers, comments, Luau syntax, long brackets
  parser.js     # Recursive-descent parser -> AST, with real scope tracking
  codegen.js    # AST -> source code, with all the transform options
  test.js       # Node-based sanity tests (parse -> transform -> re-parse)
  engine.bundle.js  # Browser build of the three files above (no `require`/Buffer)

obfuscator/
  app.css              # All styles
  app.js               # UI wiring: editors, config panel, obfuscate flow
  index.template.html  # Page markup with /*__CSS__*/ /*__ENGINE__*/ /*__APP__*/ placeholders
  index.html           # The final, single-file build (this is what you deploy)
```

To rebuild `index.html` after editing any source file:

```bash
cd obfuscator
python3 - <<'EOF'
css = open("app.css").read()
engine = open("../engine/engine.bundle.js").read()
app = open("app.js").read()
tpl = open("index.template.html").read()
open("index.html", "w").write(
    tpl.replace("/*__CSS__*/", css)
       .replace("/*__ENGINE__*/", engine)
       .replace("/*__APP__*/", app)
)
EOF
```

If you edit `engine/lexer.js`, `engine/parser.js`, or `engine/codegen.js`,
regenerate `engine/engine.bundle.js` first (strip `require`/`module.exports`,
see the comments in those files) — `engine/test.js` will catch most breakage
if you run `node engine/test.js`.

## Runtimes supported

Lua 5.1, Lua 5.2, Lua 5.3, Lua 5.4, LuaJIT, Roblox Luau. Selecting a runtime
changes which grammar the parser actually accepts (see `featuresFor()` in
`parser.js`) — it is not a cosmetic label.

## Security & privacy

- All processing happens in the browser tab. Nothing is uploaded; there is
  no server component, so there is nothing that logs, stores, or transmits
  your code.
- The tool never executes the code you give it — it only lexes, parses,
  transforms the AST, and regenerates source text.
- Every obfuscated result is re-parsed before being shown to you; if that
  re-parse fails, you get an error, never broken code.

## Known limitations

See the "Limitations" section in the app's Documentation tab, and the
delivery report for the full list. In short: the parser covers the common
core of each Lua/Luau grammar used in real scripts, not 100% of every
edge case in the language reference (e.g. bitwise shift operators `<<`/`>>`
and Lua 5.4's `<const>`/`<close>` attribute *parsing* work, but a handful of
rarely-used constructs will report a clear parse error rather than silently
mis-handling them).

## Testing

`engine/test.js` runs the pipeline against a Roblox-style Luau sample (using
the exact APIs from the brief: `game:GetService`, `WaitForChild`, Luau type
annotations, `continue`, module return tables) and a classic Lua 5.1 sample
(recursion, closures, numeric `for`), at realistic option combinations, then
verifies the obfuscated output re-parses successfully. Run it with:

```bash
node engine/test.js
```
