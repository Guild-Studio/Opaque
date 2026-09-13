"use strict";
const { Lexer } = require("./lexer");

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

module.exports = { Parser, ParseError, featuresFor };
