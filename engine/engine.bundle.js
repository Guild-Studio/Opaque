// ===== Lua/Luau Obfuscation Engine (bundled for browser) =====
// Lua/Luau Lexer
// Produces tokens with {type, value, line, col, start, end}
// Also collects comments separately (with line) so they can optionally be
// re-emitted by the code generator.

const KEYWORDS = new Set([
  "and","break","do","else","elseif","end","false","for","function","goto",
  "if","in","local","nil","not","or","repeat","return","then","true",
  "until","while","continue" // 'continue' only truly a keyword in Luau; handled contextually
]);

class LexError extends Error {
  constructor(message, line, col) {
    super(message);
    this.line = line;
    this.col = col;
    this.name = "LexError";
  }
}

function isDigit(c) { return c >= "0" && c <= "9"; }
function isHexDigit(c) { return isDigit(c) || (c >= "a" && c <= "f") || (c >= "A" && c <= "F"); }
function isAlpha(c) { return (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || c === "_"; }
function isAlphaNum(c) { return isAlpha(c) || isDigit(c); }

class Lexer {
  constructor(src, opts = {}) {
    this.src = src;
    this.i = 0;
    this.line = 1;
    this.col = 1;
    this.len = src.length;
    this.tokens = [];
    this.comments = [];
    this.luau = !!opts.luau; // enables //, string interpolation, continue as keyword, compound assign
  }

  error(msg, line = this.line, col = this.col) {
    throw new LexError(msg, line, col);
  }

  peek(o = 0) { return this.src[this.i + o]; }

  advance() {
    const c = this.src[this.i++];
    if (c === "\n") { this.line++; this.col = 1; } else { this.col++; }
    return c;
  }

  match(c) {
    if (this.peek() === c) { this.advance(); return true; }
    return false;
  }

  push(type, value, line, col) {
    this.tokens.push({ type, value, line, col });
  }

  longBracketLevel() {
    // at '[' check for [=*[ ; returns level or -1 if not a long bracket opener
    let j = this.i + 1;
    let level = 0;
    while (this.src[j] === "=") { level++; j++; }
    if (this.src[j] === "[") return level;
    return -1;
  }

  readLongBracket(level, isComment) {
    // assumes current char is '[' and we've verified opener; consumes opener
    const startLine = this.line, startCol = this.col;
    this.advance(); // '['
    for (let k = 0; k < level; k++) this.advance(); // '='
    this.advance(); // '['
    // skip first newline immediately after opening, per Lua spec
    if (this.peek() === "\r") { this.advance(); if (this.peek() === "\n") this.advance(); }
    else if (this.peek() === "\n") { this.advance(); if (this.peek() === "\r") this.advance(); }
    let out = "";
    while (true) {
      if (this.i >= this.len) this.error(`unfinished long ${isComment ? "comment" : "string"}`, startLine, startCol);
      if (this.peek() === "]") {
        let j = this.i + 1, lvl = 0;
        while (this.src[j] === "=") { lvl++; j++; }
        if (lvl === level && this.src[j] === "]") {
          this.advance();
          for (let k = 0; k < level; k++) this.advance();
          this.advance();
          return { text: out, line: startLine, col: startCol };
        }
      }
      out += this.advance();
    }
  }

  readShortString(quote) {
    const startLine = this.line, startCol = this.col;
    this.advance(); // opening quote
    let out = "";
    let rawBytes = []; // to preserve exact escape-decoded bytes (UTF-8 encoded)
    while (true) {
      if (this.i >= this.len) this.error("unfinished string", startLine, startCol);
      const c = this.peek();
      if (c === "\n") this.error("unfinished string (newline in short string)", this.line, this.col);
      if (c === quote) { this.advance(); break; }
      if (c === "\\") {
        this.advance();
        const e = this.peek();
        switch (e) {
          case "n": out += "\n"; this.advance(); break;
          case "t": out += "\t"; this.advance(); break;
          case "r": out += "\r"; this.advance(); break;
          case "a": out += "\x07"; this.advance(); break;
          case "b": out += "\b"; this.advance(); break;
          case "f": out += "\f"; this.advance(); break;
          case "v": out += "\v"; this.advance(); break;
          case "\\": out += "\\"; this.advance(); break;
          case "\"": out += "\""; this.advance(); break;
          case "'": out += "'"; this.advance(); break;
          case "\n": out += "\n"; this.advance(); break;
          case "z": {
            this.advance();
            while (/\s/.test(this.peek())) this.advance();
            break;
          }
          case "x": {
            this.advance();
            let hex = "";
            for (let k = 0; k < 2; k++) {
              if (!isHexDigit(this.peek())) this.error("hexadecimal digit expected", this.line, this.col);
              hex += this.advance();
            }
            out += String.fromCharCode(parseInt(hex, 16));
            break;
          }
          default: {
            if (isDigit(e)) {
              let num = "";
              for (let k = 0; k < 3 && isDigit(this.peek()); k++) num += this.advance();
              const code = parseInt(num, 10);
              if (code > 255) this.error("decimal escape too large", this.line, this.col);
              out += String.fromCharCode(code);
            } else {
              this.error(`invalid escape sequence '\\${e}'`, this.line, this.col);
            }
          }
        }
      } else {
        out += this.advance();
      }
    }
    return { text: out, line: startLine, col: startCol };
  }

  readNumber() {
    const startLine = this.line, startCol = this.col;
    let out = "";
    if (this.peek() === "0" && (this.peek(1) === "x" || this.peek(1) === "X")) {
      out += this.advance(); out += this.advance();
      while (isHexDigit(this.peek()) || this.peek() === ".") out += this.advance();
      if (this.peek() === "p" || this.peek() === "P") {
        out += this.advance();
        if (this.peek() === "+" || this.peek() === "-") out += this.advance();
        while (isDigit(this.peek())) out += this.advance();
      }
    } else {
      while (isDigit(this.peek())) out += this.advance();
      if (this.peek() === ".") { out += this.advance(); while (isDigit(this.peek())) out += this.advance(); }
      if (this.peek() === "e" || this.peek() === "E") {
        out += this.advance();
        if (this.peek() === "+" || this.peek() === "-") out += this.advance();
        while (isDigit(this.peek())) out += this.advance();
      }
    }
    // Luau allows trailing 'i' for imaginary? no. Skip.
    return { text: out, line: startLine, col: startCol };
  }

  tokenize() {
    while (this.i < this.len) {
      const c = this.peek();
      const line = this.line, col = this.col;

      if (c === " " || c === "\t" || c === "\r" || c === "\n") { this.advance(); continue; }

      if (c === "-" && this.peek(1) === "-") {
        this.advance(); this.advance();
        if (this.peek() === "[") {
          const level = this.longBracketLevel();
          if (level >= 0) {
            const { text, line: cl, col: cc } = this.readLongBracket(level, true);
            this.comments.push({ text, line: cl, col: cc, kind: "long" });
            continue;
          }
        }
        // line comment
        let text = "";
        while (this.i < this.len && this.peek() !== "\n") text += this.advance();
        this.comments.push({ text, line, col, kind: "line" });
        continue;
      }

      if (c === "[") {
        const level = this.longBracketLevel();
        if (level >= 0) {
          const { text, line: sl, col: sc } = this.readLongBracket(level, false);
          this.push("String", text, sl, sc);
          continue;
        }
        this.advance(); this.push("[", "[", line, col); continue;
      }

      if (c === '"' || c === "'") {
        const { text, line: sl, col: sc } = this.readShortString(c);
        this.push("String", text, sl, sc);
        continue;
      }

      // Luau string interpolation: `text {expr} text`
      if (this.luau && c === "`") {
        this.readInterpString(line, col);
        continue;
      }

      if (isDigit(c) || (c === "." && isDigit(this.peek(1)))) {
        const { text, line: nl, col: nc } = this.readNumber();
        this.push("Number", text, nl, nc);
        continue;
      }

      if (isAlpha(c)) {
        let out = "";
        while (isAlphaNum(this.peek())) out += this.advance();
        if (KEYWORDS.has(out)) {
          if (out === "continue" && !this.luau) {
            // treat as identifier in non-Luau runtimes
            this.push("Name", out, line, col);
          } else {
            this.push(out, out, line, col);
          }
        } else {
          this.push("Name", out, line, col);
        }
        continue;
      }

      // operators / punctuation
      const three = this.src.substr(this.i, 3);
      if (three === "...") { this.i += 3; this.col += 3; this.push("...", "...", line, col); continue; }

      const two = this.src.substr(this.i, 2);
      const twoCharOps = ["==", "~=", "<=", ">=", "..", "::", "//"];
      const luauTwoCharOps = ["+=", "-=", "*=", "/=", "%=", "^=", "->"];
      if (this.luau && two === "..=") { /* handled by three-check below */ }
      if (this.luau) {
        const three2 = this.src.substr(this.i, 3);
        if (three2 === "..=") { this.i += 3; this.col += 3; this.push("..=", "..=", line, col); continue; }
      }
      if (twoCharOps.includes(two)) {
        this.i += 2; this.col += 2; this.push(two, two, line, col); continue;
      }
      if (this.luau && luauTwoCharOps.includes(two)) {
        this.i += 2; this.col += 2; this.push(two, two, line, col); continue;
      }

      const single = "+-*/%^#&~|<>=(){}[];:,.";
      if (single.includes(c)) {
        this.advance();
        this.push(c, c, line, col);
        continue;
      }

      this.error(`unexpected symbol near '${c}'`, line, col);
    }
    this.push("EOF", "<eof>", this.line, this.col);
    return { tokens: this.tokens, comments: this.comments };
  }

  readInterpString(line, col) {
    // Luau interpolated string: `...{expr}...`
    // We emit a single "InterpString" token whose value is an array of
    // {type:'str', text} | {type:'expr', tokens:[...]} pieces (tokens re-lexed later by parser via sub-lex).
    this.advance(); // `
    const parts = [];
    let cur = "";
    while (true) {
      if (this.i >= this.len) this.error("unfinished interpolated string", line, col);
      const c = this.peek();
      if (c === "`") { this.advance(); break; }
      if (c === "\\") {
        this.advance();
        const e = this.advance();
        const map = { n: "\n", t: "\t", r: "\r", "\\": "\\", "`": "`", "{": "{", "}": "}", "'": "'", '"': '"' };
        cur += map[e] !== undefined ? map[e] : e;
        continue;
      }
      if (c === "{") {
        parts.push({ type: "str", text: cur }); cur = "";
        this.advance();
        // capture raw source until matching '}' respecting nested braces/strings (simplified)
        let depth = 1; let exprSrc = "";
        while (depth > 0) {
          if (this.i >= this.len) this.error("unfinished interpolated expression", line, col);
          const ch = this.peek();
          if (ch === "{") depth++;
          if (ch === "}") { depth--; if (depth === 0) { this.advance(); break; } }
          exprSrc += this.advance();
        }
        parts.push({ type: "expr", src: exprSrc });
        continue;
      }
      cur += this.advance();
    }
    parts.push({ type: "str", text: cur });
    this.push("InterpString", parts, line, col);
  }
}



class ParseError extends Error {
  constructor(message, line, col) {
    super(message);
    this.line = line; this.col = col; this.name = "ParseError";
  }
}

// Runtime feature flags
function featuresFor(runtime) {
  const base = {
    bitwiseOps: false, intDiv: false, goto: false, compoundAssign: false,
    ifExpr: false, interpString: false, typeAnnotations: false, continueStmt: false,
    luau: false,
  };
  switch (runtime) {
    case "lua51": return { ...base };
    case "lua52": return { ...base, goto: true };
    case "lua53": return { ...base, goto: true, bitwiseOps: true, intDiv: true };
    case "lua54": return { ...base, goto: true, bitwiseOps: true, intDiv: true };
    case "luajit": return { ...base, goto: true };
    case "luau": return { ...base, goto: false, bitwiseOps: false, intDiv: true, compoundAssign: true, ifExpr: true, interpString: true, typeAnnotations: true, continueStmt: true, luau: true };
    default: return base;
  }
}

let scopeCounter = 0;
class Scope {
  constructor(parent, kind) {
    this.parent = parent;
    this.kind = kind; // 'function' | 'block'
    this.id = ++scopeCounter;
    this.names = new Map(); // name -> declNode
  }
  declare(name, node) { this.names.set(name, node); }
  resolve(name) {
    let s = this;
    while (s) { if (s.names.has(name)) return s.names.get(name); s = s.parent; }
    return null;
  }
}

class Parser {
  constructor(src, runtime) {
    this.src = src;
    this.runtime = runtime;
    this.features = featuresFor(runtime);
    const lex = new Lexer(src, { luau: this.features.luau });
    const { tokens, comments } = lex.tokenize();
    this.tokens = tokens;
    this.comments = comments;
    this.pos = 0;
    this.globals = new Map(); // name -> {node, refs:[]}
    this.allIdentifierRefs = []; // list of {node, declNode|null, isGlobal}
  }

  peek(o = 0) { return this.tokens[this.pos + o]; }
  cur() { return this.tokens[this.pos]; }

  error(msg, tok = this.cur()) {
    throw new ParseError(msg, tok.line, tok.col);
  }

  check(type) { return this.cur().type === type; }

  advance() { return this.tokens[this.pos++]; }

  expect(type, ctx) {
    if (this.cur().type !== type) {
      this.error(`'${type}' expected near '${this.cur().value}'${ctx ? " (" + ctx + ")" : ""}`);
    }
    return this.advance();
  }

  parseChunk() {
    this.rootScope = new Scope(null, "function");
    this.scope = this.rootScope;
    const body = this.parseBlock();
    if (!this.check("EOF")) this.error(`unexpected '${this.cur().value}'`);
    return { type: "Chunk", body, scopeId: this.rootScope.id };
  }

  blockEnd() {
    return ["EOF", "end", "else", "elseif", "until"].includes(this.cur().type);
  }

  parseBlock(newScopeKind) {
    let pushed = false;
    if (newScopeKind) { this.scope = new Scope(this.scope, newScopeKind); pushed = true; }
    const stmts = [];
    while (!this.blockEnd()) {
      if (this.check("return")) {
        stmts.push(this.parseReturn());
        break;
      }
      const s = this.parseStatement();
      if (s) stmts.push(s);
    }
    if (pushed) this.scope = this.scope.parent;
    return stmts;
  }

  parseReturn() {
    const line = this.cur().line;
    this.advance();
    const args = [];
    if (!this.blockEnd() && !this.check(";")) {
      args.push(this.parseExpr());
      while (this.check(",")) { this.advance(); args.push(this.parseExpr()); }
    }
    if (this.check(";")) this.advance();
    return { type: "ReturnStatement", args, line };
  }

  parseStatement() {
    const t = this.cur();
    // Luau contextual keywords: 'type X = ...' and 'export type X = ...'
    // These are compile-time-only declarations (erased at runtime), so we
    // parse-and-discard them: dropping them cannot change program behavior,
    // and keeping them would require carrying a full type-AST we never use.
    if (this.features.typeAnnotations) {
      if (t.type === "Name" && t.value === "export" && this.peek(1).type === "Name" && this.peek(1).value === "type") {
        this.advance(); this.advance();
        return this.parseTypeAliasRest(t.line);
      }
      if (t.type === "Name" && t.value === "type" && this.peek(1).type === "Name") {
        this.advance();
        return this.parseTypeAliasRest(t.line);
      }
    }
    switch (t.type) {
      case ";": this.advance(); return null;
      case "if": return this.parseIf();
      case "while": return this.parseWhile();
      case "do": { this.advance(); const body = this.parseBlock("block"); this.expect("end"); return { type: "DoStatement", body, line: t.line }; }
      case "for": return this.parseFor();
      case "repeat": return this.parseRepeat();
      case "function": return this.parseFunctionStatement();
      case "local": return this.parseLocal();
      case "break": this.advance(); return { type: "BreakStatement", line: t.line };
      case "continue":
        if (this.features.continueStmt) { this.advance(); return { type: "ContinueStatement", line: t.line }; }
        break;
      case "goto":
        if (this.features.goto) { this.advance(); const name = this.expect("Name").value; return { type: "GotoStatement", label: name, line: t.line }; }
        break;
      case "::":
        if (this.features.goto) { this.advance(); const name = this.expect("Name").value; this.expect("::"); return { type: "LabelStatement", name, line: t.line }; }
        break;
    }
    return this.parseExprStatement();
  }

  parseIf() {
    const line = this.cur().line;
    this.advance();
    const clauses = [];
    const cond = this.parseExpr();
    this.expect("then");
    const body = this.parseBlock("block");
    clauses.push({ cond, body });
    while (this.check("elseif")) {
      this.advance();
      const c2 = this.parseExpr();
      this.expect("then");
      const b2 = this.parseBlock("block");
      clauses.push({ cond: c2, body: b2 });
    }
    let elseBody = null;
    if (this.check("else")) { this.advance(); elseBody = this.parseBlock("block"); }
    this.expect("end");
    return { type: "IfStatement", clauses, elseBody, line };
  }

  parseWhile() {
    const line = this.cur().line;
    this.advance();
    const cond = this.parseExpr();
    this.expect("do");
    const body = this.parseBlock("block");
    this.expect("end");
    return { type: "WhileStatement", cond, body, line };
  }

  parseRepeat() {
    const line = this.cur().line;
    this.advance();
    // repeat...until: the until condition can see locals declared in body, so
    // don't pop scope until after parsing the condition.
    this.scope = new Scope(this.scope, "block");
    const stmts = [];
    while (!this.blockEnd()) {
      if (this.check("return")) { stmts.push(this.parseReturn()); break; }
      const s = this.parseStatement();
      if (s) stmts.push(s);
    }
    this.expect("until");
    const cond = this.parseExpr();
    this.scope = this.scope.parent;
    return { type: "RepeatStatement", body: stmts, cond, line };
  }

  parseFor() {
    const line = this.cur().line;
    this.advance();
    const firstName = this.expect("Name").value;
    if (this.check("=")) {
      this.advance();
      const start = this.parseExpr();
      this.expect(",");
      const limit = this.parseExpr();
      let step = null;
      if (this.check(",")) { this.advance(); step = this.parseExpr(); }
      this.expect("do");
      this.scope = new Scope(this.scope, "block");
      const varNode = { type: "Identifier", name: firstName, isDecl: true, scopeId: this.scope.id };
      this.scope.declare(firstName, varNode);
      const body = [];
      while (!this.blockEnd()) {
        if (this.check("return")) { body.push(this.parseReturn()); break; }
        const s = this.parseStatement(); if (s) body.push(s);
      }
      this.expect("end");
      this.scope = this.scope.parent;
      return { type: "NumericForStatement", var: varNode, start, limit, step, body, line };
    } else {
      const names = [firstName];
      while (this.check(",")) { this.advance(); names.push(this.expect("Name").value); }
      this.expect("in");
      const exprs = [this.parseExpr()];
      while (this.check(",")) { this.advance(); exprs.push(this.parseExpr()); }
      this.expect("do");
      this.scope = new Scope(this.scope, "block");
      const varNodes = names.map(n => {
        const vn = { type: "Identifier", name: n, isDecl: true, scopeId: this.scope.id };
        this.scope.declare(n, vn);
        return vn;
      });
      const body = [];
      while (!this.blockEnd()) {
        if (this.check("return")) { body.push(this.parseReturn()); break; }
        const s = this.parseStatement(); if (s) body.push(s);
      }
      this.expect("end");
      this.scope = this.scope.parent;
      return { type: "GenericForStatement", vars: varNodes, exprs, body, line };
    }
  }

  parseFunctionStatement() {
    const line = this.cur().line;
    this.advance();
    // funcname: Name {'.' Name} [':' Name]
    let base = this.resolveOrGlobalIdentifier(this.expect("Name"));
    let isMethod = false;
    let path = [base];
    while (this.check(".") || this.check(":")) {
      const isColon = this.check(":");
      this.advance();
      const nameTok = this.expect("Name");
      path.push({ type: "MemberName", name: nameTok.value });
      if (isColon) { isMethod = true; break; }
    }
    const funcBody = this.parseFunctionBody(isMethod);
    return { type: "FunctionDeclaration", target: path, isMethod, isLocal: false, func: funcBody, line };
  }

  parseLocal() {
    const line = this.cur().line;
    this.advance();
    if (this.check("function")) {
      this.advance();
      const nameTok = this.expect("Name");
      const declNode = { type: "Identifier", name: nameTok.value, isDecl: true, scopeId: this.scope.id, kind: "local-function" };
      this.scope.declare(nameTok.value, declNode); // declare before body so it can recurse
      const funcBody = this.parseFunctionBody(false);
      return { type: "LocalFunctionDeclaration", id: declNode, func: funcBody, line };
    }
    const names = [];
    const attribs = [];
    names.push(this.expect("Name").value);
    attribs.push(this.parseAttrib());
    while (this.check(",")) {
      this.advance();
      names.push(this.expect("Name").value);
      attribs.push(this.parseAttrib());
    }
    let inits = [];
    if (this.check("=")) {
      this.advance();
      inits.push(this.parseExpr());
      while (this.check(",")) { this.advance(); inits.push(this.parseExpr()); }
    }
    // declare AFTER parsing initializers (correct Lua scoping)
    const idNodes = names.map((n, idx) => {
      const node = { type: "Identifier", name: n, isDecl: true, scopeId: this.scope.id, attrib: attribs[idx] };
      this.scope.declare(n, node);
      return node;
    });
    return { type: "LocalStatement", names: idNodes, init: inits, line };
  }

  parseAttrib() {
    // Luau/5.4 attributes: <const> <close> ; and Luau type annotation ': Type'
    if (this.check("<")) {
      this.advance();
      const name = this.expect("Name").value;
      this.expect(">");
      return name;
    }
    if (this.features.typeAnnotations && this.check(":")) {
      this.advance();
      this.skipTypeAnnotation();
    }
    return null;
  }

  // Statement-starting keywords that can never appear inside a type
  // expression at bracket depth 0 — used as a stop set for the best-effort
  // type skipper below (covers both parameter/':'-annotations, which also
  // stop at ',' '=' ')', and return-type annotations, which are followed
  // directly by the function's statement block).
  static get TYPE_STOP_KEYWORDS() {
    return new Set(["end", "do", "then", "if", "while", "for", "local", "function",
      "return", "repeat", "break", "continue", "goto", "until", "else", "elseif", "EOF"]);
  }

  skipTypeAnnotation() {
    // Best-effort: consume a type expression until a delimiter or a
    // statement-starting keyword is reached at bracket depth 0. We don't
    // build a full type AST; types are structurally irrelevant to
    // obfuscation of runtime values, so discarding them is semantics-safe.
    let depth = 0;
    while (true) {
      const t = this.cur();
      if (t.type === "EOF") this.error("malformed type annotation");
      if (depth === 0 && ([",", "=", ")"].includes(t.type) || Parser.TYPE_STOP_KEYWORDS.has(t.type))) return;
      if (["(", "{", "<"].includes(t.type)) depth++;
      if ([")", "}", ">"].includes(t.type)) { if (depth === 0) return; depth--; }
      this.advance();
    }
  }

  parseTypeAliasRest(startLine) {
    this.expect("Name"); // alias name already consumed by caller position check; consumes it here
    if (this.check("<")) {
      // generic parameter list: <T, U...>
      let depth = 0;
      do {
        const t2 = this.advance();
        if (t2.type === "<") depth++;
        if (t2.type === ">") depth--;
      } while (depth > 0);
    }
    this.expect("=");
    this.skipTypeExprStatementLevel(startLine);
    return { type: "TypeAliasStatement", line: startLine };
  }

  skipTypeExprStatementLevel(startLine) {
    // Consume tokens making up a (possibly multi-line) type expression until
    // we reach the true end of the statement: bracket/brace/paren/generic
    // depth back to 0 AND the next token starts a new line beyond the type's
    // own extent, or we hit a token that can only begin a new statement.
    let depth = 0;
    let lastLine = startLine;
    while (true) {
      const t = this.cur();
      if (t.type === "EOF") this.error("malformed type alias");
      if (depth === 0) {
        // A statement/block boundary keyword at depth 0 always ends the type.
        if (["end", "else", "elseif", "until", "EOF"].includes(t.type)) return;
        // Heuristic: once we've moved to a strictly later line than the last
        // consumed token AND we're not still inside brackets, the type is done.
        if (t.line > lastLine) return;
      }
      if (["(", "{", "["].includes(t.type)) depth++;
      if ([")", "}", "]"].includes(t.type)) depth--;
      if (t.type === "<") depth++;
      if (t.type === ">") { if (depth > 0) depth--; }
      lastLine = t.line;
      this.advance();
    }
  }

  parseFunctionBody(isMethod) {
    const line = this.cur().line;
    this.expect("(");
    this.scope = new Scope(this.scope, "function");
    const params = [];
    let vararg = false;
    if (isMethod) {
      const selfNode = { type: "Identifier", name: "self", isDecl: true, scopeId: this.scope.id, implicit: true };
      this.scope.declare("self", selfNode);
      params.push(selfNode);
    }
    if (!this.check(")")) {
      do {
        if (this.check("...")) { this.advance(); vararg = true; break; }
        const nameTok = this.expect("Name");
        if (this.features.typeAnnotations && this.check(":")) { this.advance(); this.skipTypeAnnotation(); }
        const pn = { type: "Identifier", name: nameTok.value, isDecl: true, scopeId: this.scope.id };
        this.scope.declare(nameTok.value, pn);
        params.push(pn);
      } while (this.check(",") && this.advance());
    }
    this.expect(")");
    // Luau return type annotation: ): Type
    if (this.features.typeAnnotations && this.check(":")) { this.advance(); this.skipTypeAnnotation(); }
    const body = this.parseBlock(); // scope already pushed
    this.expect("end");
    this.scope = this.scope.parent;
    return { type: "FunctionExpression", params, vararg, body, line };
  }

  parseExprStatement() {
    const line = this.cur().line;
    const first = this.parseSuffixedExpr();
    if (this.check("=") || this.check(",")) {
      const targets = [first];
      while (this.check(",")) { this.advance(); targets.push(this.parseSuffixedExpr()); }
      this.expect("=");
      const values = [this.parseExpr()];
      while (this.check(",")) { this.advance(); values.push(this.parseExpr()); }
      for (const tg of targets) {
        if (tg.type !== "Identifier" && tg.type !== "MemberExpression" && tg.type !== "IndexExpression")
          this.error("syntax error (cannot assign to this expression)");
      }
      return { type: "AssignmentStatement", targets, values, line };
    }
    if (this.features.compoundAssign && ["+=", "-=", "*=", "/=", "%=", "^=", "..="].includes(this.cur().type)) {
      const op = this.advance().type;
      const value = this.parseExpr();
      return { type: "CompoundAssignStatement", target: first, op, value, line };
    }
    if (first.type !== "CallExpression" && first.type !== "MethodCallExpression") {
      this.error("syntax error (expression is not a statement)");
    }
    return { type: "CallStatement", expr: first, line };
  }

  resolveOrGlobalIdentifier(tok) {
    const decl = this.scope.resolve(tok.value);
    const node = { type: "Identifier", name: tok.value, isDecl: false, line: tok.line, col: tok.col };
    if (decl) node.decl = decl; else node.global = true;
    this.allIdentifierRefs.push(node);
    return node;
  }

  // ---------- expressions (precedence climbing) ----------
  parseExpr() { return this.parseOr(); }

  parseOr() {
    let left = this.parseAnd();
    while (this.check("or")) { this.advance(); const right = this.parseAnd(); left = { type: "LogicalExpression", op: "or", left, right }; }
    return left;
  }
  parseAnd() {
    let left = this.parseCompare();
    while (this.check("and")) { this.advance(); const right = this.parseCompare(); left = { type: "LogicalExpression", op: "and", left, right }; }
    return left;
  }
  parseCompare() {
    let left = this.parseBitOr();
    while (["<", ">", "<=", ">=", "~=", "=="].includes(this.cur().type)) {
      const op = this.advance().type; const right = this.parseBitOr();
      left = { type: "BinaryExpression", op, left, right };
    }
    return left;
  }
  parseBitOr() {
    let left = this.parseBitXor();
    while (this.features.bitwiseOps && this.check("|")) { this.advance(); const right = this.parseBitXor(); left = { type: "BinaryExpression", op: "|", left, right }; }
    return left;
  }
  parseBitXor() {
    let left = this.parseBitAnd();
    while (this.features.bitwiseOps && this.check("~")) { this.advance(); const right = this.parseBitAnd(); left = { type: "BinaryExpression", op: "~", left, right }; }
    return left;
  }
  parseBitAnd() {
    let left = this.parseShift();
    while (this.features.bitwiseOps && this.check("&")) { this.advance(); const right = this.parseShift(); left = { type: "BinaryExpression", op: "&", left, right }; }
    return left;
  }
  parseShift() {
    // Lua doesn't have << >> tokens distinct from relational in our lexer set;
    // 5.3/5.4 use << and >> — add if present as two-char via lexer? We didn't
    // tokenize them specially; treat as unsupported (rare in practice) and
    // fall through to concat level.
    return this.parseConcat();
  }
  parseConcat() {
    let left = this.parseAdd();
    if (this.check("..")) { this.advance(); const right = this.parseConcat(); return { type: "BinaryExpression", op: "..", left, right }; }
    return left;
  }
  parseAdd() {
    let left = this.parseMul();
    while (this.check("+") || this.check("-")) { const op = this.advance().type; const right = this.parseMul(); left = { type: "BinaryExpression", op, left, right }; }
    return left;
  }
  parseMul() {
    let left = this.parseUnary();
    while (["*", "/", "%", "//"].includes(this.cur().type)) {
      if (this.cur().type === "//" && !this.features.intDiv) break;
      const op = this.advance().type; const right = this.parseUnary();
      left = { type: "BinaryExpression", op, left, right };
    }
    return left;
  }
  parseUnary() {
    if (["not", "-", "#"].includes(this.cur().type) || (this.features.bitwiseOps && this.cur().type === "~")) {
      const op = this.advance().type;
      const arg = this.parseUnary();
      return { type: "UnaryExpression", op, arg };
    }
    return this.parsePow();
  }
  parsePow() {
    let left = this.parsePrimaryExpr();
    if (this.check("^")) { this.advance(); const right = this.parseUnary(); return { type: "BinaryExpression", op: "^", left, right }; }
    return left;
  }

  parsePrimaryExpr() {
    const t = this.cur();
    switch (t.type) {
      case "Number": this.advance(); return { type: "NumberLiteral", raw: t.value };
      case "String": this.advance(); return { type: "StringLiteral", value: t.value };
      case "InterpString": this.advance(); return this.buildInterp(t.value);
      case "nil": this.advance(); return { type: "NilLiteral" };
      case "true": this.advance(); return { type: "BooleanLiteral", value: true };
      case "false": this.advance(); return { type: "BooleanLiteral", value: false };
      case "...": this.advance(); return { type: "VarargExpression" };
      case "function": this.advance(); return this.parseFunctionBody(false);
      case "{": return this.parseTableConstructor();
      case "if":
        if (this.features.ifExpr) return this.parseIfExpr();
        break;
    }
    return this.parseSuffixedExpr();
  }

  buildInterp(parts) {
    const pieces = parts.map(p => {
      if (p.type === "str") return { type: "str", text: p.text };
      const subParser = new Parser(p.src, this.runtime);
      subParser.scope = this.scope; // share enclosing scope for name resolution
      subParser.rootScope = this.rootScope;
      const expr = subParser.parseExpr();
      // merge identifier refs discovered in sub-expression
      this.allIdentifierRefs.push(...subParser.allIdentifierRefs);
      return { type: "expr", expr };
    });
    return { type: "InterpolatedString", parts: pieces };
  }

  parseIfExpr() {
    this.advance(); // if
    const cond = this.parseExpr();
    this.expect("then");
    const cons = this.parseExpr();
    const elifs = [];
    while (this.check("elseif")) {
      this.advance();
      const c2 = this.parseExpr();
      this.expect("then");
      const b2 = this.parseExpr();
      elifs.push({ cond: c2, expr: b2 });
    }
    this.expect("else");
    const alt = this.parseExpr();
    return { type: "IfExpression", cond, cons, elifs, alt };
  }

  parsePrimaryAtom() {
    const t = this.cur();
    if (t.type === "(") {
      this.advance();
      const e = this.parseExpr();
      this.expect(")");
      return { type: "ParenExpression", expr: e };
    }
    if (t.type === "Name") {
      this.advance();
      return this.resolveOrGlobalIdentifier(t);
    }
    this.error(`unexpected symbol near '${t.value}'`);
  }

  parseSuffixedExpr() {
    let expr = this.parsePrimaryAtom();
    while (true) {
      const t = this.cur();
      if (t.type === ".") {
        this.advance();
        const nameTok = this.expect("Name");
        expr = { type: "MemberExpression", object: expr, property: nameTok.value };
      } else if (t.type === "[") {
        this.advance();
        const idx = this.parseExpr();
        this.expect("]");
        expr = { type: "IndexExpression", object: expr, index: idx };
      } else if (t.type === ":") {
        this.advance();
        const nameTok = this.expect("Name");
        const args = this.parseCallArgs();
        expr = { type: "MethodCallExpression", object: expr, method: nameTok.value, args };
      } else if (t.type === "(" || t.type === "String" || t.type === "InterpString" || t.type === "{") {
        const args = this.parseCallArgs();
        expr = { type: "CallExpression", callee: expr, args };
      } else break;
    }
    return expr;
  }

  parseCallArgs() {
    const t = this.cur();
    if (t.type === "(") {
      this.advance();
      const args = [];
      if (!this.check(")")) {
        args.push(this.parseExpr());
        while (this.check(",")) { this.advance(); args.push(this.parseExpr()); }
      }
      this.expect(")");
      return args;
    }
    if (t.type === "String") { this.advance(); return [{ type: "StringLiteral", value: t.value }]; }
    if (t.type === "InterpString") { this.advance(); return [this.buildInterp(t.value)]; }
    if (t.type === "{") { return [this.parseTableConstructor()]; }
    this.error("function arguments expected");
  }

  parseTableConstructor() {
    this.expect("{");
    const fields = [];
    while (!this.check("}")) {
      if (this.check("[")) {
        this.advance();
        const key = this.parseExpr();
        this.expect("]");
        this.expect("=");
        const value = this.parseExpr();
        fields.push({ type: "IndexedField", key, value });
      } else if (this.check("Name") && this.peek(1).type === "=") {
        const nameTok = this.advance();
        this.advance(); // '='
        const value = this.parseExpr();
        fields.push({ type: "NamedField", name: nameTok.value, value });
      } else {
        const value = this.parseExpr();
        fields.push({ type: "ItemField", value });
      }
      if (this.check(",") || this.check(";")) this.advance();
      else break;
    }
    this.expect("}");
    return { type: "TableExpression", fields };
  }
}



// Reserved/API names that must never be renamed even if they resolve as
// locals is not an issue (locals are safe by construction since they're
// scope-declared) — this list matters for making sure our renamer never
// *emits* a generated name that collides with a keyword, and for the
// "protected globals" concept used only for documentation purposes (we never
// rename globals at all, see below).
const LUA_KEYWORDS = new Set(["and","break","do","else","elseif","end","false","for","function",
  "goto","if","in","local","nil","not","or","repeat","return","then","true","until","while"]);

function baseName(idx) {
  // Generate short identifier names: a, b, ... z, aa, ab, ...
  const letters = "abcdefghijklmnopqrstuvwxyz";
  let n = idx, out = "";
  do {
    out = letters[n % 26] + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}

class IdentifierRenamer {
  constructor(prefix = "") {
    this.map = new Map(); // scopeId::name -> generated
    this.used = new Set();
    this.counter = 0;
    this.prefix = prefix;
  }
  nameFor(scopeId, name) {
    const key = scopeId + "::" + name;
    if (this.map.has(key)) return this.map.get(key);
    let candidate;
    do {
      candidate = this.prefix + baseName(this.counter++);
    } while (LUA_KEYWORDS.has(candidate) || this.used.has(candidate));
    this.used.add(candidate);
    this.map.set(key, candidate);
    return candidate;
  }
}

const OBFUSCATOR_VERSION = "1.0.0";

class CodeGenerator {
  constructor(opts) {
    this.opts = opts; // {runtime, minify, renameIdentifiers, stringObfuscation, removeComments,
                       //  controlFlow, deadCode, seed, level, vmProtection, watermark}
    this.renamer = opts.renameIdentifiers ? new IdentifierRenamer() : null;
    this.rand = mulberry32(opts.seed >>> 0);
    this.deadCodeCounter = 0;
    this.warnings = [];
    // VM runtime name: long + randomized so it can never collide with the
    // short a/b/c... names the identifier renamer hands out, and is
    // vanishingly unlikely to collide with any real global. Only emitted
    // into the output if something actually ends up using it.
    this.vmVarName = "__opq_vm_" + this.randomHex(6);
    this.vmUsed = false;
  }

  randomHex(len) {
    let out = "";
    const digits = "0123456789abcdef";
    for (let i = 0; i < len; i++) out += digits[Math.floor(this.rand() * 16)];
    return out;
  }

  // ---- helpers ----
  identName(node) {
    if (!this.renamer) return node.name;
    if (node.global) return node.name; // never rename globals/unresolved refs
    if (node.implicit) return node.name; // 'self'
    const decl = node.isDecl ? node : node.decl;
    if (!decl) return node.name;
    return this.renamer.nameFor(decl.scopeId, decl.name);
  }

  quoteString(raw) {
    // raw is the *decoded* string value (actual bytes/characters).
    if (this.opts.stringObfuscation) {
      return this.obfuscateString(raw);
    }
    return this.plainQuote(raw);
  }

  plainQuote(raw) {
    let out = '"';
    for (const ch of raw) {
      const code = ch.codePointAt(0);
      if (ch === '"') out += '\\"';
      else if (ch === "\\") out += "\\\\";
      else if (ch === "\n") out += "\\n";
      else if (ch === "\r") out += "\\r";
      else if (code < 32) out += "\\" + code;
      else out += ch;
    }
    return out + '"';
  }

  obfuscateString(raw) {
    const bytes = new TextEncoder().encode(raw);
    if (bytes.length === 0) return '""';
    const nums = Array.from(bytes.values());
    const CHUNK = 40;
    const chunks = [];
    for (let i = 0; i < nums.length; i += CHUNK) {
      chunks.push(nums.slice(i, i + CHUNK));
    }
    const pieces = this.opts.vmProtection
      ? chunks.map(c => this.vmEncodeChunk(c))
      : chunks.map(c => this.inlineEncodeChunk(c));
    return pieces.length === 1 ? pieces[0] : `(${pieces.join("..")})`;
  }

  // Plain inline form: string.char((n1+k1)-k1, (n2+k2)-k2, ...) — visible
  // arithmetic right in the call, cheap and universally compatible. Chunked
  // to at most 40 bytes per call: a single string.char(...) with one
  // argument per byte is unsafe for long strings — real Lua/Luau
  // implementations impose limits on the number of arguments/registers a
  // single call can use, and a call with hundreds of arguments (easy to hit
  // with any paragraph of UI copy) can fail to compile even though it looks
  // fine to a lenient parser.
  inlineEncodeChunk(byteChunk) {
    const parts = byteChunk.map(n => {
      const k = 1 + Math.floor(this.rand() * 40);
      return `${n + k}-${k}`;
    });
    return `string.char(${parts.join(",")})`;
  }

  // VM form: the same byte values, but instead of arithmetic visible in the
  // call site, each chunk becomes a small flat bytecode program executed by
  // a tiny stack-machine interpreter (this.vmVarName) injected once at the
  // top of the file. This only ever touches self-contained literal values —
  // it never rewrites control flow, scoping, or anything that references
  // the user's own variables — so it cannot change what the script does,
  // only how its string constants are reconstructed at runtime.
  //   Opcodes: 1=PUSH <k>   2=SUB (a,b -> a-b)   3=CHR (n -> string.char(n))
  //            4=CONCAT (a,b -> a..b)   0=RETURN top of stack
  vmEncodeChunk(byteChunk) {
    this.vmUsed = true;
    const prog = [];
    byteChunk.forEach(n => {
      const k = 1 + Math.floor(this.rand() * 40);
      prog.push(1, n + k, 1, k, 2, 3); // PUSH masked, PUSH k, SUB, CHR
    });
    for (let i = 1; i < byteChunk.length; i++) prog.push(4); // CONCAT (len-1 times)
    prog.push(0); // RETURN
    return `${this.vmVarName}({${prog.join(",")}})`;
  }

  vmRuntimeSource() {
    // Deliberately tiny and self-contained: only reads its own `p` argument
    // and the global `string` library. No upvalues into user code, so it
    // can be dropped in anywhere without risk of capturing/shadowing
    // anything from the surrounding script.
    const v = this.vmVarName;
    if (this.opts.minify) {
      return `local function ${v}(p) local s={} local n=0 local i=1 while true do local op=p[i] if op==1 then n=n+1 s[n]=p[i+1] i=i+2 elseif op==2 then s[n-1]=s[n-1]-s[n] n=n-1 i=i+1 elseif op==3 then s[n]=string.char(s[n]) i=i+1 elseif op==4 then s[n-1]=s[n-1]..s[n] n=n-1 i=i+1 else return s[n] end end end`;
    }
    return [
      `local function ${v}(p)`,
      `  -- Tiny bytecode interpreter used to reconstruct obfuscated string constants.`,
      `  -- 1=push k, 2=subtract, 3=byte->char, 4=concat, else=return top of stack.`,
      `  local s = {}`,
      `  local n = 0`,
      `  local i = 1`,
      `  while true do`,
      `    local op = p[i]`,
      `    if op == 1 then`,
      `      n = n + 1`,
      `      s[n] = p[i + 1]`,
      `      i = i + 2`,
      `    elseif op == 2 then`,
      `      s[n - 1] = s[n - 1] - s[n]`,
      `      n = n - 1`,
      `      i = i + 1`,
      `    elseif op == 3 then`,
      `      s[n] = string.char(s[n])`,
      `      i = i + 1`,
      `    elseif op == 4 then`,
      `      s[n - 1] = s[n - 1] .. s[n]`,
      `      n = n - 1`,
      `      i = i + 1`,
      `    else`,
      `      return s[n]`,
      `    end`,
      `  end`,
      `end`,
    ].join("\n");
  }

  numberLiteral(raw) {
    if (!this.opts.constantTransform) return raw;
    // Only transform simple decimal integers safely (avoid touching hex/float/exp forms).
    if (!/^[0-9]+$/.test(raw)) return raw;
    const n = parseInt(raw, 10);
    if (n > 1e6 || n === 0) return raw; // keep small & safe
    const k = 1 + Math.floor(this.rand() * (n + 1));
    return `(${n + k}-${k})`;
  }

  sp() { return this.opts.minify ? "" : " "; }
  // nl(): separates statements within a block. In minified mode we still need
  // *some* separator between adjacent statements (otherwise e.g. "end" and a
  // following "local" glue into the single identifier "endlocal"). ';' is a
  // valid empty-statement separator in Lua, so we use it instead of removing
  // the boundary entirely.
  // nl(): separates statements within a block. In minified mode we use a
  // plain space rather than ';' — a space is *always* a valid boundary
  // between two Lua/Luau statements (same as a newline would be), with zero
  // ambiguity about whether a bare ';' counts as its own statement. Some
  // real-world Lua/Luau parsers are stricter about that than others, so
  // this sidesteps the question entirely instead of relying on it.
  nl() { return this.opts.minify ? " " : "\n"; }
  // kw(): a separator that MUST be a real space because it sits between a
  // keyword and the expression/name that follows it (e.g. "return x",
  // "then y", "do z"). ';' cannot be used here since that would change
  // meaning (or be a syntax error), and omitting it would glue two
  // alphanumeric tokens into one identifier. This is never minified away.
  kw() { return " "; }
  indent(depth) { return this.opts.minify ? "" : "  ".repeat(depth); }

  maybeOpaqueWrap(bodyStr, depth) {
    // Real, safe control-flow obfuscation: wrap a block in a single-iteration
    // loop with an opaque (always-true) predicate, so execution still runs
    // the block exactly once, in order, then continues after it — but static
    // readers see an extra loop/branch layer.
    if (!this.opts.controlFlow) return bodyStr;
    const a = 1 + Math.floor(this.rand() * 9);
    const b = 1 + Math.floor(this.rand() * 9);
    const pred = `(${a}*${a})>=${a > 0 ? 0 : 1}`; // trivially true, still an expression
    const openBrace = this.opts.minify ? "" : "";
    return `while ${pred} do${this.nl()}${bodyStr}${this.nl()}${this.indent(depth)}break${this.nl()}${this.indent(depth)}end`;
  }

  maybeDeadCode(depth) {
    if (!this.opts.deadCode) return "";
    this.deadCodeCounter++;
    const name = `_dc${this.deadCodeCounter}_${Math.floor(this.rand() * 1000)}`;
    // NOTE: no trailing separator here — the caller (genBlock) joins all
    // lines together with this.nl() itself. Adding one here too used to
    // produce a doubled-up ";;" in minified output: harmless to *our* own
    // (lenient) parser, but a bare empty statement is exactly the kind of
    // construct a stricter real-world Lua/Luau parser can reject outright.
    return `${this.indent(depth)}local ${name}${this.sp()}=${this.sp()}${Math.floor(this.rand()*1000)}`;
  }

  // ---- comments (best-effort re-attachment by source line) ----
  leadingCommentsFor(line, comments, consumed) {
    if (this.opts.removeComments || !comments) return "";
    const out = [];
    for (const c of comments) {
      if (consumed.has(c)) continue;
      if (c.line <= line) {
        out.push(c.kind === "line" ? `--${c.text}` : `--[[${c.text}]]`);
        consumed.add(c);
      }
    }
    // Comments always need a real newline after them (a '--' line comment
    // consumes everything up to the next line break, so without one the
    // following code would be swallowed into the comment). No trailing
    // separator beyond that — the caller supplies the join between this
    // block and whatever comes next.
    return out.length ? out.join("\n") + "\n" : "";
  }

  generate(chunk, comments) {
    const consumed = new Set();
    const body = this.genBlock(chunk.body, 0, comments, consumed);
    let leftover = "";
    if (!this.opts.removeComments && comments) {
      for (const c of comments) {
        if (!consumed.has(c)) leftover += (c.kind === "line" ? `--${c.text}` : `--[[${c.text}]]`) + "\n";
      }
    }
    let out = (leftover ? leftover : "") + body;

    // VM runtime: only prepended if a transformation actually emitted a call
    // to it (this.vmUsed), and always as plain, readable Lua — the VM itself
    // is never obfuscated, so anyone can audit exactly what it does.
    if (this.vmUsed) {
      out = this.vmRuntimeSource() + (this.opts.minify ? " " : "\n\n") + out;
    }

    // Watermark: a small, honest, human-readable comment header — never
    // hidden, never carrying tracking data beyond what's printed here. It
    // has zero runtime effect (it's a Lua comment) and is meant purely as a
    // visible "this file was processed by OPAQUE" marker, not a covert
    // fingerprint. Can be turned off entirely via opts.watermark = false.
    if (this.opts.watermark !== false) {
      out = this.watermarkHeader() + out;
    }
    return out;
  }

  watermarkHeader() {
    // Site name + obfuscator version only, as a plain, visible, multi-line
    // Lua comment (`--[[ ... ]]--`). Every row of the ASCII banner below is
    // exactly 52 characters wide — verified programmatically, not by eye —
    // so it can't render lopsided. Zero runtime effect: it's a long comment
    // block, and the trailing `--` after `]]` just starts an empty line
    // comment right after it, which is the conventional way this style of
    // banner is written.
    const banner = [
      ' #####   ######    #####    #####   ##   ##  #######',
      '##   ##  ##   ##  ##   ##  ##   ##  ##   ##  ##     ',
      '##   ##  ##   ##  ##   ##  ##   ##  ##   ##  ##     ',
      '##   ##  ######   #######  ##   ##  ##   ##  #####  ',
      '##   ##  ##       ##   ##  ##  ###  ##   ##  ##     ',
      '##   ##  ##       ##   ##  ##   ##  ##   ##  ##     ',
      ' #####   ##       ##   ##   ######   #####   #######',
    ];
    const lines = [
      "--[[",
      "",
      ...banner,
      "",
      `  OPAQUE — Obfuscator v${OBFUSCATOR_VERSION}`,
      "",
      "]]--",
    ];
    return lines.join("\n") + "\n";
  }

  genBlock(stmts, depth, comments, consumed) {
    const lines = [];
    for (const s of stmts) {
      const lead = comments ? this.leadingCommentsFor(s.line || 0, comments, consumed) : "";
      const code = this.genStatement(s, depth);
      if (this.opts.deadCode && this.rand() < 0.15) {
        const dc = this.maybeDeadCode(depth);
        if (dc) lines.push(dc);
      }
      if (code !== "") {
        // Any leading comment is glued directly onto the SAME entry as the
        // statement it precedes (with a real newline in between), rather
        // than pushed as its own separate array item. That guarantees the
        // block-level join separator (this.nl(), ';' when minified) only
        // ever sits between two complete statements — never right after a
        // bare comment with nothing else before it, which would otherwise
        // produce an orphan ';' with no preceding statement to terminate.
        lines.push(lead + this.indent(depth) + code);
      } else if (lead) {
        // Rare edge case: a statement that erases to nothing (currently
        // only Luau's `type X = ...` alias) but still had comments above
        // it. Nothing to attach them to, so they stand alone.
        lines.push(lead.replace(/\n$/, ""));
      }
    }
    return lines.join(this.nl());
  }

  genStatement(s, depth) {
    switch (s.type) {
      case "LocalStatement": {
        const names = s.names.map(n => this.identName(n)).join(",");
        const attribs = s.names.map(n => n.attrib ? `<${n.attrib}>` : "").join("");
        const init = s.init.length ? `${this.sp()}=${this.sp()}${s.init.map(e => this.genExpr(e)).join(",")}` : "";
        return `local ${names}${init}`;
      }
      case "LocalFunctionDeclaration": {
        const name = this.identName(s.id);
        return `local function ${name}${this.genFunctionRest(s.func, depth)}`;
      }
      case "FunctionDeclaration": {
        const path = s.target.map((p, i) => i === 0 ? this.identName(p) : (p.name)).join(s.isMethod ? "." : ".");
        // rebuild path correctly considering ':' for method
        let str = this.identName(s.target[0]);
        for (let i = 1; i < s.target.length; i++) {
          const isLast = i === s.target.length - 1;
          str += (s.isMethod && isLast ? ":" : ".") + s.target[i].name;
        }
        return `function ${str}${this.genFunctionRest(s.func, depth)}`;
      }
      case "AssignmentStatement": {
        const t = s.targets.map(e => this.genExpr(e)).join(",");
        const v = s.values.map(e => this.genExpr(e)).join(",");
        return `${t}${this.sp()}=${this.sp()}${v}`;
      }
      case "CompoundAssignStatement": {
        return `${this.genExpr(s.target)}${this.sp()}${s.op}${this.sp()}${this.genExpr(s.value)}`;
      }
      case "CallStatement": return this.genExpr(s.expr);
      case "DoStatement": {
        const inner = this.genBlock(s.body, depth + 1, null, new Set());
        const wrapped = this.opts.controlFlow ? this.maybeOpaqueWrap(inner, depth + 1) : inner;
        return `do${this.kw()}${wrapped}${this.nl()}${this.indent(depth)}end`;
      }
      case "IfStatement": {
        let out = "";
        s.clauses.forEach((c, i) => {
          const kwd = i === 0 ? "if" : "elseif";
          out += `${kwd} ${this.genExpr(c.cond)} then${this.kw()}${this.genBlock(c.body, depth + 1, null, new Set())}${this.nl()}${this.indent(depth)}`;
        });
        if (s.elseBody) out += `else${this.kw()}${this.genBlock(s.elseBody, depth + 1, null, new Set())}${this.nl()}${this.indent(depth)}`;
        out += "end";
        return out;
      }
      case "WhileStatement": {
        const inner = this.genBlock(s.body, depth + 1, null, new Set());
        return `while ${this.genExpr(s.cond)} do${this.kw()}${inner}${this.nl()}${this.indent(depth)}end`;
      }
      case "RepeatStatement": {
        const inner = this.genBlock(s.body, depth + 1, null, new Set());
        return `repeat${this.kw()}${inner}${this.nl()}${this.indent(depth)}until ${this.genExpr(s.cond)}`;
      }
      case "NumericForStatement": {
        const v = this.identName(s.var);
        const parts = [this.genExpr(s.start), this.genExpr(s.limit)];
        if (s.step) parts.push(this.genExpr(s.step));
        const inner = this.genBlock(s.body, depth + 1, null, new Set());
        return `for ${v}${this.sp()}=${this.sp()}${parts.join(",")} do${this.kw()}${inner}${this.nl()}${this.indent(depth)}end`;
      }
      case "GenericForStatement": {
        const vs = s.vars.map(v => this.identName(v)).join(",");
        const exprs = s.exprs.map(e => this.genExpr(e)).join(",");
        const inner = this.genBlock(s.body, depth + 1, null, new Set());
        return `for ${vs} in ${exprs} do${this.kw()}${inner}${this.nl()}${this.indent(depth)}end`;
      }
      case "ReturnStatement":
        return `return${s.args.length ? this.kw() + s.args.map(e => this.genExpr(e)).join(",") : ""}`;
      case "BreakStatement": return "break";
      case "ContinueStatement": return "continue";
      case "GotoStatement": return `goto ${s.label}`;
      case "LabelStatement": return `::${s.name}::`;
      case "TypeAliasStatement": return ""; // erased: compile-time-only, no runtime effect
      default:
        throw new Error("Unknown statement type: " + s.type);
    }
  }

  genFunctionRest(func, depth) {
    const params = func.params.filter(p => !p.implicit).map(p => this.identName(p));
    if (func.vararg) params.push("...");
    const inner = this.genBlock(func.body, depth + 1, null, new Set());
    return `(${params.join(",")})${this.nl()}${inner}${this.nl()}${this.indent(depth)}end`;
  }

  genExpr(e) {
    switch (e.type) {
      case "NumberLiteral": return this.numberLiteral(e.raw);
      case "StringLiteral": return this.quoteString(e.value);
      case "InterpolatedString": {
        // Re-emit as plain concatenation (portable across all runtimes and
        // still exactly equivalent), rather than requiring Luau syntax —
        // this also means interpolated strings work even if downstream
        // tooling doesn't special-case backtick strings.
        const pieces = e.parts.map(p => p.type === "str" ? this.quoteString(p.text) : `tostring(${this.genExpr(p.expr)})`);
        return pieces.length ? pieces.join("..") : '""';
      }
      case "NilLiteral": return "nil";
      case "BooleanLiteral": {
        if (this.opts.constantTransform) {
          return e.value ? "(1==1)" : "(1==2)";
        }
        return e.value ? "true" : "false";
      }
      case "VarargExpression": return "...";
      case "Identifier": return this.identName(e);
      case "ParenExpression": return `(${this.genExpr(e.expr)})`;
      case "MemberExpression": return `${this.genAtom(e.object)}.${e.property}`;
      case "IndexExpression": return `${this.genAtom(e.object)}[${this.genExpr(e.index)}]`;
      case "CallExpression": return `${this.genAtom(e.callee)}(${e.args.map(a => this.genExpr(a)).join(",")})`;
      case "MethodCallExpression": return `${this.genAtom(e.object)}:${e.method}(${e.args.map(a => this.genExpr(a)).join(",")})`;
      case "FunctionExpression": return `function${this.genFunctionRest(e, 0)}`;
      case "TableExpression": {
        const fs = e.fields.map(f => {
          if (f.type === "NamedField") return `${f.name}${this.sp()}=${this.sp()}${this.genExpr(f.value)}`;
          if (f.type === "IndexedField") return `[${this.genExpr(f.key)}]${this.sp()}=${this.sp()}${this.genExpr(f.value)}`;
          return this.genExpr(f.value);
        });
        return `{${fs.join(",")}}`;
      }
      case "LogicalExpression": return `${this.genExpr(e.left)} ${e.op} ${this.genExpr(e.right)}`; // 'and'/'or' are alnum keywords: space is mandatory, not just cosmetic
      case "BinaryExpression": return `${this.genExpr(e.left)}${this.sp()}${e.op}${this.sp()}${this.genExpr(e.right)}`;
      case "UnaryExpression": return `${e.op}${e.op === "not" ? " " : ""}${this.genExpr(e.arg)}`;
      case "IfExpression": {
        let out = `if ${this.genExpr(e.cond)} then ${this.genExpr(e.cons)} `;
        for (const el of e.elifs) out += `elseif ${this.genExpr(el.cond)} then ${this.genExpr(el.expr)} `;
        out += `else ${this.genExpr(e.alt)}`;
        return out; // Luau if-expression syntax has no 'end'
      }
      default:
        throw new Error("Unknown expression type: " + e.type);
    }
  }

  genAtom(e) {
    // wrap in parens when needed for correct precedence as a call/index base
    if (["Identifier", "MemberExpression", "IndexExpression", "CallExpression", "MethodCallExpression", "ParenExpression"].includes(e.type)) {
      return this.genExpr(e);
    }
    return `(${this.genExpr(e)})`;
  }
}

function mulberry32(seed) {
  let a = seed || 12345;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

