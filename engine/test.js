const { Parser } = require("./parser");
const { CodeGenerator } = require("./codegen");

const samples = {
  roblox: `
local Players = game:GetService("Players")
local player = Players.LocalPlayer
local character = player.Character
local humanoid = character:WaitForChild("Humanoid")

local function test()
    return true
end

type PlayerData = {
    Speed: number,
    Level: number
}

local playerName = "Samy"
local playerSpeed = 100

local data = {
    playerName = "Samy"
}

local function greet(name: string): string
    if name == "" then
        return "hello stranger"
    else
        return "hello " .. name
    end
end

for i = 1, 10 do
    print(i)
end

local t = {1,2,3}
for i, v in ipairs(t) do
    if v == 2 then
        continue
    end
    print(i, v)
end

local module = {}
function module.Start()
    print("started")
end
return module
`,
  lua51: `
-- classic lua 5.1 script
local function fib(n)
  if n < 2 then return n end
  return fib(n-1) + fib(n-2)
end

local results = {}
for i=1,10 do
  results[i] = fib(i)
end

local function make_counter()
  local count = 0
  return function()
    count = count + 1
    return count
  end
end

local c = make_counter()
print(c(), c(), c())
`,
};

function run(name, src, runtime, opts) {
  console.log("=== " + name + " (" + runtime + ") ===");
  let parser;
  try {
    parser = new Parser(src, runtime);
  } catch (e) { console.error("lexer/parser construction failed", e); return; }
  let ast;
  try {
    ast = parser.parseChunk();
  } catch (e) {
    console.error("PARSE ERROR:", e.message, "at line", e.line, "col", e.col);
    return;
  }
  const gen = new CodeGenerator({ runtime, seed: 42, ...opts });
  let out;
  try {
    out = gen.generate(ast, parser.comments);
  } catch (e) {
    console.error("CODEGEN ERROR:", e.message);
    return;
  }
  console.log(out);
  console.log("--- re-parse check ---");
  try {
    const p2 = new Parser(out, runtime);
    p2.parseChunk();
    console.log("OK: output re-parses successfully.");
  } catch (e) {
    console.error("OUTPUT DID NOT RE-PARSE:", e.message, "line", e.line, "col", e.col);
  }
  console.log();
}

run("roblox-high", samples.roblox, "luau", {
  minify: false, renameIdentifiers: true, stringObfuscation: true,
  removeComments: true, controlFlow: true, deadCode: true, constantTransform: true,
});

run("lua51-medium", samples.lua51, "lua51", {
  minify: true, renameIdentifiers: true, stringObfuscation: true,
  removeComments: true, controlFlow: false, deadCode: false, constantTransform: true,
});
