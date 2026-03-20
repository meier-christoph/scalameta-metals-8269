# Analysis of go-to-definition failure on Windows

## Summary

Go-to-definition on external library symbols fails when using Claude Code's LSP
client on Windows. Hover on the same symbols works. Local symbols work for both.
The bug persists even after Metals has fully indexed the workspace.

## Two distinct issues found

### Issue 1: Claude Code LSP client drops external definitions (primary bug)

When Metals is fully indexed and the definition request is sent, Metals resolves
the symbol correctly (confirmed via direct stdio scripts). However, Claude Code's
LSP tool reports "No definition found."

**Evidence:**
- `scripts/fixed.mjs` talks directly to Metals over stdio → returns correct
  definition in `metaconfig-core_2.13-0.18.2-sources.jar`
- Claude Code's LSP tool on the same indexed Metals instance → "No definition found"
- Metals log shows NO errors and NO trace of the failed requests
- Hover works through Claude Code for the same symbol (returns type info)
- `documentSymbol` works through Claude Code
- Local go-to-definition works through Claude Code

**What this rules out:**
- Not a Metals server bug (direct stdio works)
- Not a build target mapping issue (no "no build target" errors in log)
- Not a compilation issue (workspace compiles cleanly)
- Not an indexing issue (indexed workspace in ~2s, no errors)

**Suspected cause:** Claude Code's LSP client or the metals-lsp plugin filters
or fails to parse definition responses that point to jar-based paths like:
`file:///C:/.../metaconfig-core_2.13-0.18.2-sources.jar/metaconfig/ConfEncoder.scala`

### Issue 2: Race condition when requests sent before indexing (secondary)

LSP clients that fire `textDocument/definition` immediately after `initialized` +
`textDocument/didOpen` (before build import completes) get empty results for
external symbols. Local symbols survive via a guess-based fallback.

**Evidence:**
- `scripts/bad.mjs` sends definition request immediately → empty result `[]`
- `scripts/fixed.mjs` waits for "Indexing complete!" → correct result
- `scripts/good.mjs` sends immediately for local symbol → works (fallback guess)
- Metals logs `no build target found for ...` when requests arrive before import

**This is expected behavior** — Metals can't resolve external symbols without
build targets. However, Metals returns `[]` (success with empty result) instead
of an error code, so clients can't distinguish "not ready" from "not found."

## Investigation timeline

### Step 1: Direct stdio scripts cannot reproduce the bug
- Wrote Node.js scripts that drive Metals over stdin/stdout with JSON-RPC
- When waiting for indexing, both local and external go-to-definition succeed
- **Conclusion:** Metals itself resolves external definitions correctly

### Step 2: Claude Code's LSP tool reproduces the bug
- Local `HelloConfig` go-to-definition → worked
- External `ConfEncoder` go-to-definition → FAILED
- Hover on `ConfEncoder` → worked (returns type info)

### Step 3: Investigated race condition theory
- Metals log showed `no build target found` when requests arrived early
- `scripts/bad.mjs` (no wait) fails, `scripts/fixed.mjs` (waits) succeeds
- Initially appeared to be a timing issue

### Step 4: Disproved race condition as sole cause
- Restarted Claude Code, clean `.metals/`, waited 30+ seconds for full indexing
- Metals log: clean startup, indexed in 1.77s, connected to Bloop, no errors
- Go-to-definition via Claude Code → still "No definition found"
- Hover via Claude Code → works
- **No entries in metals log for the failed requests**
- **No error reports generated in `.metals/.reports/`**

### Step 5: Compared Metals instances
- Claude Code uses: `metals.jar` with `-Dmetals.autoImportBuilds=all`
- Our scripts use: `metals.jar` in project root (coursier bootstrap, same version)
- Direct stdio to either → works
- Through Claude Code's client → external definitions lost

## What to investigate next

### On the Claude Code / metals-lsp plugin side:
1. How does the LSP client handle definition responses with jar-based URIs?
2. Does it filter responses pointing outside the workspace root?
3. Is there a URI parsing issue with paths containing `.jar/` segments?
4. What does the raw JSON-RPC response look like before the client processes it?

### On the Metals side (lower priority):
1. Consider returning an error code instead of `[]` when build import is incomplete
2. The `window/logMessage` "Indexing complete!" is the only readiness signal —
   consider supporting `$/progress` for structured readiness tracking

## Environment details

```
Metals:      1.6.6 (both system-installed and coursier bootstrap)
Bloop:       2.0.19
sbt:         1.12.6
Scala:       2.13.18
Java:        Azul JDK 25.0.1
OS:          Windows 11 Enterprise 10.0.26200
Node.js:     24.9.0
Claude Code: metals-lsp plugin v1.1.1
```

## Files in this repo

```
build.sbt                          — single-module sbt project
src/main/scala/org/example/
  Main.scala                       — references HelloConfig (local symbol)
  HelloConfig.scala                — uses ConfEncoder (external symbol)
scripts/
  good.mjs                         — local symbol, no wait → SUCCESS
  bad.mjs                          — external symbol, no wait → EMPTY
  fixed.mjs                        — external symbol, waits for indexing → SUCCESS
```
