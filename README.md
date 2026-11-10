# harness-finance

**A DDD double-entry ledger built for agents. Natural-language bookkeeping for one-person companies, solopreneurs, and small teams.**

> 基于 Cordis 本体论与领域驱动设计（DDD）的财务系统。为 agent 设计，人用自然语言记账，子 agent 自动判断分录方向。个人财务只是试验场景，真正目标是建一个确定性的本体底座，让业务规则机器可验证。

## Why

Most accounting tools are built for accountants. This one is built for **agents**:

- OPC / solo first — you type "spent $42 on office supplies" and the agent books the right debits/credits
- Sub-agent judgment — the agent picks accounts, categories, and amounts; you only review exceptions
- Team-ready — when you outgrow solo, the same ledger works for a small team with approval thresholds
- Double-entry by default — every transaction balances; trial balance is a single tool call away
- Ontology-backed — OWL TBox defines business rules; the reasoner rejects inconsistent entries with an explain, not a guess
- Survives restarts — domain data lives in SQLite; the ABox is rebuilt from it on startup, so the ontology view never silently goes empty
- Cordis plugin — drops into any Cordis-based agent host as `ctx.finance`

## Install

```bash
pnpm add @codesbegin/harness-finance
```

## Concepts

| Concept | What it means |
|---|---|
| Account | A ledger account (asset / liability / equity / income / expense). |
| Posting | One line of a journal entry: account + direction (debit/credit) + amount. |
| JournalEntry | A balanced set of postings. Must debit == credit before it posts. |
| Trial balance | Aggregated balances by category. `balanced=true` means the books are in order. |
| Approval threshold | Postings above `requireApprovalAbove` return `needsApproval=true` and wait for human confirmation. |
| Ontology TBox | Turtle axioms (account disjointness, etc.) enforced by the reasoner on every post. |
| ABox | Per-instance triples (accounts, entries, postings) synced to the N3 store; checked for consistency after each post; rebuilt from SQLite on startup. |
| ABox balanced | `aboxSummary().postings.balanced` — whether the ABox data layer projection is intact (debit flow == credit flow). |

## Agent tools

| Tool | Use case |
|---|---|
| `ledger_summary` | One-shot overview: ABox stats (incl. balanced flag), account counts, total debit/credit, per-account balances. Call this first for open-ended questions. |
| `create_account` | Add a new account (asset / liability / equity / income / expense). |
| `list_accounts` | See all accounts and their current balances. |
| `post_entry` | Post a balanced entry; over-threshold postings ask for human approval. |
| `trial_balance` | Check if the books balance, by category. |
| `trial_balance_detail` | Per-account signed balances ("how much cash do I have?"). |
| `list_entries` | Browse recent entries (newest first). |
| `search_entries` | Filter entries by keyword / account / category / status / min amount. |
| `get_entry` | Full detail of one entry, including all postings. |

## Error codes

These are **agent-facing** — each code tells the agent what to do next:

| Code | Meaning | Agent should |
|---|---|---|
| `FINANCE_UNKNOWN_ACCOUNT` | Account id not found | Call `create_account` first |
| `FINANCE_UNBALANCED_ENTRY` | Debits != credits | Recompute postings so they sum to zero |
| `FINANCE_INVALID_POSTING` | Amount <= 0 | Ask the user for the correct amount |
| `FINANCE_UNKNOWN_ENTRY` | Entry id not found | Call `list_entries` to find the right id |
| `FINANCE_APPROVAL_REQUIRED` | Largest posting exceeds threshold | Pause, ask the human, retry with `approved=true` |
| `FINANCE_LOCKED_LEDGER` | Ledger is closed / locked | Ask the user to reopen or create a new ledger |
| `FINANCE_ONTOLOGY_INCONSISTENT` | Entry violates OWL constraints | Read `explain`, do NOT retry blindly; figure out which account is wrong and ask the human |

## Status

Alpha. Currently shipping:

- Domain model: `Account` / `JournalEntry` / `Posting` with double-entry invariants
- `FinanceService` with 10 Remote methods: getLedger / createAccount / listAccounts / ledgerSummary / postEntry / trialBalance / trialBalanceDetail / listEntries / searchEntries / getEntry
- 9 Cordis tools exposed to agents, with approval-threshold guard and `ledger_summary` cold-start overview
- Ontology layer: TBox Turtle + N3 ABox store + lazy Konclude OWL reasoner + ABox summary (incl. balanced flag) / export-dot
- ABox rebuild on startup: `FinanceService` reconstructs the N3 instance store from SQLite repositories (accounts + entries + postings), so restarts do not zero out the ontology view
- SQLite persistence (better-sqlite3) with repository pattern; In-memory mode for dev/test
- Unit tests for domain invariants, repository CRUD, entry search, ABox↔domain sync consistency, and ABox restart rebuild
- TBox/ABox CLI (`scripts/reason.ts`) with DOT export, sample ABox, `--strict` health-check, and reasoner-failure degradation

## Design notes

- [docs/abox-design.md](docs/abox-design.md) — ABox 设计
- [docs/reasoner-capabilities.md](docs/reasoner-capabilities.md) — reasoner 能力
- [docs/read-model-design.md](docs/read-model-design.md) — 读模型设计
- [docs/persistence-design.md](docs/persistence-design.md) — SQLite 持久化设计
- [docs/query-patterns.md](docs/query-patterns.md) — 查询模式
- [docs/ontology-visualization.md](docs/ontology-visualization.md) — 本体可视化路线
- [docs/fibo-integration-strategy.md](docs/fibo-integration-strategy.md) — FIBO 接入策略
- [docs/abox-domain-consistency.md](docs/abox-domain-consistency.md) — ABox 与 domain 层一致性契约

## License

All Rights Reserved. See [LICENSE](./LICENSE).
