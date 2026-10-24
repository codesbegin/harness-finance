# 持久化设计 — 从内存到 SQLite

> 记录于 2026-10-25。本文档说清楚为什么先抽 Repository 接口、SQLite 表结构怎么设计、以及迁移路径。

## 为什么先抽象，再实现

直接写 SQLite 会遇到的问题：
- FinanceService 里到处是 `accounts.get(id)` / `entries.set(id, je)`，改成 SQLite 要改十几处。
- domain 对象（Account / JournalEntry）和 SQL 行数据格式不一样，混在 FinanceService 里会让业务逻辑和存储细节耦合。
- 测试要起真实数据库，慢。

**解法**：先定义 `AccountRepository` / `EntryRepository` 接口，FinanceService 只依赖接口。现在用 `InMemoryRepository`（就是原来的 Map），未来换 SQLite 实现时 FinanceService 一行不改。

## SQLite 表结构（预留设计）

```sql
-- 账户表
CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,  -- ASSET / LIABILITY / EQUITY / INCOME / EXPENSE
  balance INTEGER NOT NULL, -- 内部单位（分）
  created_at INTEGER NOT NULL
);

-- 分录表
CREATE TABLE entries (
  id TEXT PRIMARY KEY,
  description TEXT NOT NULL,
  status TEXT NOT NULL,    -- POSTED / REJECTED
  total_debit INTEGER NOT NULL,
  total_credit INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

-- 过账表（一个分录多条过账）
CREATE TABLE postings (
  id TEXT PRIMARY KEY,     -- {entry_id}-{index}
  entry_id TEXT NOT NULL REFERENCES entries(id),
  account_id TEXT NOT NULL REFERENCES accounts(id),
  direction TEXT NOT NULL, -- debit / credit
  amount INTEGER NOT NULL  -- 内部单位（分）
);

CREATE INDEX idx_postings_entry ON postings(entry_id);
CREATE INDEX idx_postings_account ON postings(account_id);
```

## 为什么过账单独建表

一个分录有多个 posting（借/贷各至少一条）。如果把 postings 塞在 entries 表的 JSON 字段里：
- 没法按账户查"这个账户被哪些分录影响过"（报表、审计需要）。
- 没法对 postings 建索引。

拆开后：
- `SELECT * FROM postings WHERE account_id = ?` → 账户流水。
- `SELECT * FROM entries ORDER BY created_at DESC LIMIT ?` → 最近分录。

## 读 JournalEntry 时怎么组装

从 SQLite 读一个 JournalEntry：
1. 查 `entries` 表拿到分录头。
2. 查 `postings` 表拿到所有 posting 行。
3. 每个 posting 行的 `account_id` 去 `accounts` 表查账户对象。
4. 组装成 `JournalEntry` domain 对象返回给 FinanceService。

这是 Repository 的职责，FinanceService 不感知 SQL。

## 金额为什么用整数

所有金额在 SQLite 里存 `INTEGER`（分），不用 `REAL`（浮点）。原因：
- 浮点有精度问题（0.1 + 0.2 ≠ 0.3）。
- 整数运算精确，试算平衡比较直接。
- domain 层已经用 `round(amount * 100)` 转分，存的时候不用再处理。

## 迁移路径

1. ✅ 抽 Repository 接口（本次）
2. ✅ InMemoryRepository 实现（本次）
3. ⬜ 写 `src/repository/sqlite.ts`：建表 + CRUD
4. ⬜ FinanceService 加 `storage: 'sqlite'` 分支，接 better-sqlite3
5. ⬜ 加 migration（如果以后表结构变了）

当前阶段用内存就够了——个人财务一天几十条分录，内存跑几周都没问题。等数据量上来或者要做持久化部署时再上 SQLite。
