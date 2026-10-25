/**
 * SQLite Repository — 基于 better-sqlite3 的持久化实现。
 *
 * 设计要点：
 *   - 同步 API（better-sqlite3 是同步的），和 FinanceService 的调用方式一致。
 *   - 两个 Repository 共享同一个 Database 连接，EntryRepository 读分录时 JOIN accounts 表组装 Account 对象。
 *   - 建表用 CREATE TABLE IF NOT EXISTS，首次启动自动初始化。
 *   - 金额全部存整数（分），不丢精度。
 */

import Database from 'better-sqlite3'
import type { Account } from '../account.js'
import { Account as AccountModel } from '../account.js'
import type { JournalEntry } from '../journal-entry.js'
import { JournalEntry as JournalEntryModel, Posting } from '../journal-entry.js'
import type { AccountCategory, Direction, JournalEntryStatus } from '../types.js'
import type { AccountRepository, EntryRepository } from './types.js'

const SCHEMA = `
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  signed_balance INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS entries (
  id TEXT PRIMARY KEY,
  description TEXT NOT NULL,
  status TEXT NOT NULL,
  date INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS postings (
  id TEXT PRIMARY KEY,
  entry_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  direction TEXT NOT NULL,
  amount INTEGER NOT NULL,
  memo TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_postings_entry ON postings(entry_id);
CREATE INDEX IF NOT EXISTS idx_postings_account ON postings(account_id);
`;

interface AccountRow {
  id: string
  name: string
  category: AccountCategory
  signed_balance: number
  created_at: number
}

interface EntryRow {
  id: string
  description: string
  status: JournalEntryStatus
  date: number
}

interface PostingRow {
  id: string
  entry_id: string
  account_id: string
  direction: Direction
  amount: number
  memo: string
}

export class SQLiteAccountRepository implements AccountRepository {
  constructor(private readonly db: Database.Database) {}

  save(account: Account): void {
    const snapshot = account.toSnapshot()
    const stmt = this.db.prepare(`
      INSERT INTO accounts (id, name, category, signed_balance, created_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        category = excluded.category,
        signed_balance = excluded.signed_balance
    `)
    stmt.run(
      snapshot.id,
      snapshot.name,
      snapshot.category,
      snapshot.signedBalance,
      Date.now(),
    )
  }

  findById(id: string): Account | null {
    const row = this.db.prepare('SELECT * FROM accounts WHERE id = ?').get(id) as AccountRow | undefined
    if (!row) return null
    return AccountModel.restore({
      id: row.id,
      name: row.name,
      category: row.category,
      signedBalance: row.signed_balance,
    })
  }

  listAll(): Account[] {
    const rows = this.db.prepare('SELECT * FROM accounts ORDER BY created_at').all() as AccountRow[]
    return rows.map(r => AccountModel.restore({
      id: r.id,
      name: r.name,
      category: r.category,
      signedBalance: r.signed_balance,
    }))
  }
}

export class SQLiteEntryRepository implements EntryRepository {
  constructor(private readonly db: Database.Database) {}

  save(entry: JournalEntry): void {
    const snapshot = entry.toSnapshot()
    const tx = this.db.transaction(() => {
      this.db.prepare(`
        INSERT INTO entries (id, description, status, date)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          description = excluded.description,
          status = excluded.status,
          date = excluded.date
      `).run(
        snapshot.id,
        snapshot.description,
        snapshot.status,
        snapshot.date.getTime(),
      )

      // 先删旧 postings（如果是更新），再插新的
      this.db.prepare('DELETE FROM postings WHERE entry_id = ?').run(snapshot.id)

      const insertPosting = this.db.prepare(`
        INSERT INTO postings (id, entry_id, account_id, direction, amount, memo)
        VALUES (?, ?, ?, ?, ?, ?)
      `)
      snapshot.postings.forEach((p, i) => {
        insertPosting.run(
          `${snapshot.id}-${i}`,
          snapshot.id,
          p.accountId,
          p.direction,
          p.amount,
          p.memo,
        )
      })
    })
    tx()
  }

  findById(id: string): JournalEntry | null {
    const entryRow = this.db.prepare('SELECT * FROM entries WHERE id = ?').get(id) as EntryRow | undefined
    if (!entryRow) return null

    const postingRows = this.db.prepare('SELECT * FROM postings WHERE entry_id = ? ORDER BY rowid').all(id) as PostingRow[]

    // 收集所有相关账户 ID，一次性查出
    const accountIds = [...new Set(postingRows.map(p => p.account_id))]
    const accountRows = this.db.prepare(
      `SELECT * FROM accounts WHERE id IN (${accountIds.map(() => '?').join(',')})`,
    ).all(...accountIds) as AccountRow[]
    const accountsById = new Map<string, Account>()
    for (const row of accountRows) {
      accountsById.set(row.id, AccountModel.restore({
        id: row.id,
        name: row.name,
        category: row.category,
        signedBalance: row.signed_balance,
      }))
    }

    return JournalEntryModel.restore(
      {
        id: entryRow.id,
        description: entryRow.description,
        status: entryRow.status,
        date: new Date(entryRow.date),
        postings: postingRows.map(p => ({
          accountId: p.account_id,
          direction: p.direction,
          amount: p.amount,
          memo: p.memo,
        })),
      },
      accountsById,
    )
  }

  listRecent(limit: number): JournalEntry[] {
    const rows = this.db.prepare(
      'SELECT id FROM entries ORDER BY date DESC LIMIT ?',
    ).all(limit) as Array<{ id: string }>
    const result: JournalEntry[] = []
    for (const row of rows) {
      const je = this.findById(row.id)
      if (je) result.push(je)
    }
    return result
  }

  count(): number {
    const row = this.db.prepare('SELECT COUNT(*) as c FROM entries').get() as { c: number }
    return row.c
  }
}

/**
 * 初始化 SQLite 数据库，返回所有 Repository。
 *
 * @param dbPath 数据库文件路径，':memory:' 用于测试
 */
export function createSQLiteRepositories(dbPath: string = 'harness-finance.db') {
  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.exec(SCHEMA)
  return {
    accounts: new SQLiteAccountRepository(db),
    entries: new SQLiteEntryRepository(db),
    db,
  }
}
