# harness-finance

**A DDD double-entry ledger built for agents. Natural-language bookkeeping for one-person companies, solopreneurs, and small teams.**

> 基于 Cordis 本体论与领域驱动设计（DDD）的财务系统。为 agent 设计，人用自然语言记账，子 agent 自动判断分录方向。

## Why

Most accounting tools are built for accountants. This one is built for **agents**:

- OPC / solo first — you type "spent $42 on office supplies" and the agent books the right debits/credits
- Sub-agent judgment — the agent picks accounts, categories, and amounts; you only review exceptions
- Team-ready — when you outgrow solo, the same ledger works for a small team with approval thresholds
- Double-entry by default — every transaction balances; trial balance is a single tool call away
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

## Error codes

| Code | Meaning | Agent should |
|---|---|---|
| FINANCE_UNKNOWN_ACCOUNT | Account id not found | Call create_account first |
| FINANCE_UNBALANCED_ENTRY | Debits != credits | Recompute postings |
| FINANCE_INVALID_POSTING | Amount <= 0 | Ask the user for the correct amount |
| FINANCE_APPROVAL_REQUIRED | Posting above threshold | Pause, ask human, retry with approved=true |

## Status

Alpha. Currently shipping: domain model, FinanceService, 4 Cordis tools, approval threshold guard.

## License

MIT
