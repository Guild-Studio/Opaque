"use strict";
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

module.exports = { Lexer, LexError, KEYWORDS };
