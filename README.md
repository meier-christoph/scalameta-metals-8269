# scalameta/metals #8269

https://github.com/scalameta/metals/issues/8269

## Problem

Go-to-definition on external library symbols returns empty when using Claude
Code's LSP client on Windows. Hover on the same symbols works. Local symbols
work for both.

### Root cause

The bug is in Claude Code's LSP client layer, not in Metals itself:

- Metals correctly resolves external definitions (confirmed by `scripts/fixed.mjs`
  which talks to Metals directly over stdio and gets correct results).
- Claude Code's LSP client loses the definition result somewhere between Metals
  and the tool output. The metals log shows **no errors and no trace** of the
  failed requests — the definition never reaches the caller.
- Hover works through the same client, so the communication path is functional.
  The issue is specific to how go-to-definition responses for external symbols
  (jar-based paths) are handled.

## Environment

- Metals 1.6.6, Bloop 2.0.19, sbt 1.12.6
- Scala 2.13.18, Azul JDK 25.0.1
- Windows 11, Node.js 24.x
- Client: stdio (LSP over stdin/stdout)

## Setup

```shell
# Build metals.jar (once)
coursier bootstrap org.scalameta:metals_2.13:1.6.6 \
  --output metals.jar --standalone --preamble=false --bat=false -f

# Generate bloop project files (once)
sbt bloopInstall
```

## Scripts

Each script cleans `.metals/` on start for a fresh state.

```shell
# GOOD: local symbol, no wait — succeeds via guess-based fallback
node scripts/good.mjs

# BAD: external symbol, no wait — fails (empty result)
node scripts/bad.mjs

# FIXED: external symbol, waits for indexing — succeeds
node scripts/fixed.mjs
```

| Script     | Symbol        | Waits for indexing | Result  |
|------------|---------------|--------------------|---------|
| good.mjs   | HelloConfig   | no                 | SUCCESS |
| bad.mjs    | ConfEncoder   | no                 | EMPTY   |
| fixed.mjs  | ConfEncoder   | yes                | SUCCESS |

Note: `bad.mjs` demonstrates a secondary timing issue (sending requests before
indexing), but the primary bug persists even after indexing when accessed through
Claude Code's LSP client — hover works, go-to-definition does not.
