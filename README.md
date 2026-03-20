# scalameta/metals #8269

https://github.com/scalameta/metals/issues/8269

## Problem

Go-to-definition on external library symbols returns empty when the request is
sent before Metals finishes build import and indexing. Local symbols survive via
a guess-based fallback; external symbols (in dependency jars) do not.

This race condition is triggered by LSP clients (e.g. Claude Code) that fire
`textDocument/definition` immediately after `initialized` + `textDocument/didOpen`,
without waiting for indexing to complete.

## Environment

- Metals 1.6.6, Bloop 2.0.19, sbt 1.12.6
- Scala 2.13.18, Azul JDK 25.0.1
- Windows 11, Node.js 24.x
- Client: stdio (LSP over stdin/stdout)

## Setup

```shell
# Build metals.jar (once)
coursier bootstrap org.scalameta:metals_2.13:1.6.6 --output metals.jar --standalone --preamble=false --bat=false -f

# Generate bloop project files (once)
sbt bloopInstall
```

## Reproduce

Each script cleans `.metals/` on start for a fresh state.

```shell
# Local symbol — succeeds (Metals uses guess-based fallback)
node scripts/good.mjs

# External symbol — FAILS (empty result, no build target mapped yet)
node scripts/bad.mjs

# External symbol — succeeds (waits for indexing before sending request)
node scripts/fixed.mjs
```

## Expected

All three scripts should return a definition location.

## Actual

`bad.mjs` returns `[]` — Metals logs `no build target found for ...` because
the build import has not completed when the request arrives. `fixed.mjs` proves
the same request succeeds when the client waits for indexing.
