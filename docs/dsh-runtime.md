# DSH runtime baseline

`harness-finance` is a Cordis plugin. It does not vendor the DeepSeek Harness
monorepo; it pins the published runtime line that the plugin is tested against.

| Item | Value |
|---|---|
| Upstream repository | https://github.com/deepseek-ai/deepseek-harness |
| Upstream baseline | `master` @ `2e39e704` (2026-11-18) |
| Release line | `0.2.2-rc.5` |
| Cordis | `4.1.0` |
| Schemastery | `3.19.0` |
| Typert protocol | `@deepseek-ai/dsh-typert-protocol@0.2.2-rc.5` |
| Tools | `@deepseek-ai/dsh-tools@0.2.2-rc.5` |
| System prompt | `@deepseek-ai/dsh-system-prompt@0.2.2-rc.5` |

`dsh-tools@0.2.2-rc.5` declares these peers, all published on npm and resolved
by pnpm's default peer installation:

- `dsh-agent`, `dsh-scope`, `dsh-session`, `dsh-llm`, `dsh-user-approval`
- `dsh-error` (peer of `dsh-llm`)
- `dsh-brand`, `dsh-util-values`, `dsh-util-crypto`, `dsh-timeout` (transitive)

## Why not copy the monorepo

The upstream checkout is ~220 MB / 22k files / 435 packages, and its internal
packages depend on each other through `workspace:*`. Copying it into this repo
would turn `harness-finance` into a fork of the entire harness. Pinning the exact
release line and exact package versions gives the same runtime, reproducibly.

## Why 0.2.2 and not 0.0.1

The older `0.0.1-rc.*` line has an incomplete peer graph: `dsh-session` peers on
`@deepseek-ai/dsh-type-meta`, which is not published (npm E404). `0.2.2-rc.5`
replaced that peer chain with `dsh-scope` / `dsh-error` and installs cleanly.

## Commands

```bash
pnpm install       # full peer graph, includes native better-sqlite3 build
pnpm dev           # boot the host + 9 tools + sample entry
pnpm test          # 43 tests, including the host end-to-end test
pnpm build         # tsdown library build
```
