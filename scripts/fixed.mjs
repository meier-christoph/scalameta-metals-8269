#!/usr/bin/env node
/**
 * Go-to-definition on EXTERNAL symbol ConfEncoder — succeeds when the client
 * waits for indexing to complete before sending the request.
 *
 * Compare with bad.mjs which sends the request immediately and gets an empty
 * result due to the race condition.
 *
 * See: https://github.com/scalameta/metals/issues/8269
 * Prerequisites: java on PATH, metals.jar in project root, sbt bloopInstall.
 */
import { spawn } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

// ── Config ──────────────────────────────────────────────────────────────────
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const metalsJar = join(projectRoot, "metals.jar");
const relPath = "src/main/scala/org/example/HelloConfig.scala";
const absPath = join(projectRoot, relPath);
const rootUri = pathToFileURL(projectRoot).href;
const fileUri = pathToFileURL(absPath).href;
const fileText = readFileSync(absPath, "utf-8");

// Line 21: `implicit lazy val encoder: ConfEncoder[HelloConfig] =`
const line = 20;      // 0-indexed
const character = 29; // start of "ConfEncoder"
const symbol = "ConfEncoder";

const SILENCE_TIMEOUT_MS = 10_000;
const MAX_WAIT_MS = 120_000;

// ── Clean state ─────────────────────────────────────────────────────────────
rmSync(join(projectRoot, ".metals"), { recursive: true, force: true });

// ── LSP helpers ─────────────────────────────────────────────────────────────
let nextId = 0;
let stdout;
let stdin;

function send(obj) {
  const json = JSON.stringify(obj);
  const buf = Buffer.from(json, "utf-8");
  stdin.write(`Content-Length: ${buf.length}\r\n\r\n`);
  stdin.write(buf);
}

function read(timeoutMs = 30_000) {
  return new Promise((resolve) => {
    let headerBuf = Buffer.alloc(0);
    let contentLength = -1;
    let bodyBuf = Buffer.alloc(0);
    let done = false;
    let leftover = null;

    const timer = setTimeout(() => finish(null), timeoutMs);

    function finish(msg) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      stdout.removeListener("data", onData);
      if (leftover?.length) stdout.unshift(leftover);
      resolve(msg);
    }

    function onData(chunk) {
      if (done) return;
      let data = chunk;

      if (contentLength === -1) {
        headerBuf = Buffer.concat([headerBuf, data]);
        const idx = headerBuf.indexOf("\r\n\r\n");
        if (idx === -1) return;
        const match = headerBuf.toString("ascii", 0, idx).match(/Content-Length:\s*(\d+)/);
        if (!match) return finish(null);
        contentLength = Number(match[1]);
        data = headerBuf.subarray(idx + 4);
      }

      bodyBuf = Buffer.concat([bodyBuf, data]);
      if (bodyBuf.length >= contentLength) {
        leftover = bodyBuf.length > contentLength ? bodyBuf.subarray(contentLength) : null;
        try { finish(JSON.parse(bodyBuf.toString("utf-8", 0, contentLength))); }
        catch { finish(null); }
      }
    }

    stdout.on("data", onData);
  });
}

// ── Start Metals ────────────────────────────────────────────────────────────
console.log("=== go-to-definition on EXTERNAL symbol (wait for indexing) ===");
console.log(`Symbol : ${symbol}`);
console.log(`File   : ${relPath}  (line ${line + 1}, char ${character + 1})`);
console.log();

const proc = spawn("java", ["-jar", metalsJar], { cwd: projectRoot, stdio: ["pipe", "pipe", "pipe"] });
proc.stderr.on("data", () => {});
stdin = proc.stdin;
stdout = proc.stdout;

// ── 1. initialize ───────────────────────────────────────────────────────────
const initId = ++nextId;
send({
  jsonrpc: "2.0", id: initId, method: "initialize",
  params: {
    processId: process.pid,
    rootUri,
    capabilities: { textDocument: { definition: {}, hover: {}, publishDiagnostics: {} } },
    initializationOptions: { inputBoxProvider: false, slowTaskProvider: false, statusBarProvider: "log-message" },
  },
});

console.log("Waiting for initialize response...");
for (;;) {
  const msg = await read(60_000);
  if (!msg) { console.error("Timeout"); process.exit(1); }
  if (msg.id === initId) { console.log("Initialize OK"); break; }
}

// ── 2. initialized + didOpen ────────────────────────────────────────────────
send({ jsonrpc: "2.0", method: "initialized", params: {} });
send({
  jsonrpc: "2.0", method: "textDocument/didOpen",
  params: { textDocument: { uri: fileUri, languageId: "scala", version: 1, text: fileText } },
});

// ── 3. Wait for Metals to finish indexing ───────────────────────────────────
console.log(`Waiting for Metals to finish indexing (${SILENCE_TIMEOUT_MS}ms silence / ${MAX_WAIT_MS}ms max)...`);
const start = Date.now();
while (Date.now() - start < MAX_WAIT_MS) {
  const msg = await read(SILENCE_TIMEOUT_MS);
  if (!msg) { console.log("No activity — assuming ready."); break; }

  if (msg.method != null && msg.id != null) {
    console.log(`  <- request : ${msg.method} (id=${msg.id})`);
    send({ jsonrpc: "2.0", id: msg.id, result: null });
    continue;
  }
  if (msg.method != null) {
    const extra = msg.method === "window/logMessage" ? ` | ${msg.params?.message}` : "";
    console.log(`  <- notify  : ${msg.method}${extra}`);
  }
}

// ── 4. Send definition request AFTER indexing ───────────────────────────────
const defId = ++nextId;
console.log();
console.log(`Sending definition request after indexing completed...`);
send({
  jsonrpc: "2.0", id: defId, method: "textDocument/definition",
  params: { textDocument: { uri: fileUri }, position: { line, character } },
});

for (;;) {
  const msg = await read(30_000);
  if (!msg) { console.log("Timeout waiting for definition response."); break; }

  if (msg.method != null && msg.id != null) {
    send({ jsonrpc: "2.0", id: msg.id, result: null });
    continue;
  }
  if (msg.method != null) continue;

  if (msg.id === defId) {
    console.log();
    console.log("=== DEFINITION RESULT ===");
    console.log(JSON.stringify(msg.result, null, 2));
    const empty = !msg.result || (Array.isArray(msg.result) && msg.result.length === 0);
    console.log(empty ? ">>> EMPTY — go-to-definition FAILED <<<" : ">>> SUCCESS — got definition location <<<");
    break;
  }
}

// ── 5. Shutdown ─────────────────────────────────────────────────────────────
send({ jsonrpc: "2.0", id: ++nextId, method: "shutdown", params: null });
setTimeout(() => {
  send({ jsonrpc: "2.0", method: "exit", params: null });
  setTimeout(() => { if (!proc.killed) proc.kill(); console.log("\nDone."); process.exit(0); }, 500);
}, 500);
