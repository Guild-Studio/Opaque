"use strict";
const LUA_KEYWORDS = new Set(["and","break","do","else","elseif","end","false","for","function",
  "goto","if","in","local","nil","not","or","repeat","return","then","true","until","while"]);

function baseName(idx) {
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
    this.map = new Map();
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

class CodeGenerator {
  constructor(opts) {
    this.opts = opts;
    this.renamer = opts.renameIdentifiers ? new IdentifierRenamer() : null;
    this.rand = mulberry32(opts.seed >>> 0);
    this.deadCodeCounter = 0;
    this.warnings = [];
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
    if (node.global) return node.name;
    if (node.implicit) return node.name; // 'self'
    const decl = node.isDecl ? node : node.decl;
    if (!decl) return node.name;
    return this.renamer.nameFor(decl.scopeId, decl.name);
  }

  quoteString(raw) {
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
    const bytes = Buffer.from(raw, "utf8");
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

  inlineEncodeChunk(byteChunk) {
    const parts = byteChunk.map(n => {
      const k = 1 + Math.floor(this.rand() * 40);
      return `${n + k}-${k}`;
    });
    return `string.char(${parts.join(",")})`;
  }

  vmEncodeChunk(byteChunk) {
    this.vmUsed = true;
    const prog = [];
    byteChunk.forEach(n => {
      const k = 1 + Math.floor(this.rand() * 40);
      prog.push(1, n + k, 1, k, 2, 3);
    });
    for (let i = 1; i < byteChunk.length; i++) prog.push(4);
    prog.push(0);
    return `${this.vmVarName}({${prog.join(",")}})`;
  }

  vmRuntimeSource() {
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
    if (!/^[0-9]+$/.test(raw)) return raw;
    const n = parseInt(raw, 10);
    if (n > 1e6 || n === 0) return raw; // keep small & safe
    const k = 1 + Math.floor(this.rand() * (n + 1));
    return `(${n + k}-${k})`;
  }

  sp() { return this.opts.minify ? "" : " "; }
  nl() { return this.opts.minify ? " " : "\n"; }
  kw() { return " "; }
  indent(depth) { return this.opts.minify ? "" : "  ".repeat(depth); }

  maybeOpaqueWrap(bodyStr, depth) {
    if (!this.opts.controlFlow) return bodyStr;
    const a = 1 + Math.floor(this.rand() * 9);
    const b = 1 + Math.floor(this.rand() * 9);
    const pred = `(${a}*${a})>=${a > 0 ? 0 : 1}`;
    const openBrace = this.opts.minify ? "" : "";
    return `while ${pred} do${this.nl()}${bodyStr}${this.nl()}${this.indent(depth)}break${this.nl()}${this.indent(depth)}end`;
  }

  maybeDeadCode(depth) {
    if (!this.opts.deadCode) return "";
    this.deadCodeCounter++;
    const name = `_dc${this.deadCodeCounter}_${Math.floor(this.rand() * 1000)}`;
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

    if (this.vmUsed) {
      out = this.vmRuntimeSource() + (this.opts.minify ? " " : "\n\n") + out;
    }

    if (this.opts.watermark !== false) {
      out = this.watermarkHeader() + out;
    }
    return out;
  }

  watermarkHeader() {
    const runId = this.randomHex(8);
    const when = (this.opts.generatedAt || new Date()).toISOString();
    const lines = [
      `-- Obfuscated with OPAQUE (client-side Lua/Luau obfuscator)`,
      `-- Level: ${this.opts.level || "custom"}  Runtime: ${this.opts.runtime}  Run: ${runId}  Generated: ${when}`,
      `-- This is a visible marker only — it has no effect on the script and carries no hidden tracking.`,
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
        lines.push(lead + this.indent(depth) + code);
      } else if (lead) {
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
      case "TypeAliasStatement": return "";
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
      case "LogicalExpression": return `${this.genExpr(e.left)} ${e.op} ${this.genExpr(e.right)}`;
      case "BinaryExpression": return `${this.genExpr(e.left)}${this.sp()}${e.op}${this.sp()}${this.genExpr(e.right)}`;
      case "UnaryExpression": return `${e.op}${e.op === "not" ? " " : ""}${this.genExpr(e.arg)}`;
      case "IfExpression": {
        let out = `if ${this.genExpr(e.cond)} then ${this.genExpr(e.cons)} `;
        for (const el of e.elifs) out += `elseif ${this.genExpr(el.cond)} then ${this.genExpr(el.expr)} `;
        out += `else ${this.genExpr(e.alt)}`;
        return out;
      }
      default:
        throw new Error("Unknown expression type: " + e.type);
    }
  }

  genAtom(e) {
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

module.exports = { CodeGenerator, IdentifierRenamer, mulberry32 };