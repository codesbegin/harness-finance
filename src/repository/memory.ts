/**
 * InMemoryRepository — 内存实现，用于开发和测试。
 *
 * 就是把 FinanceService 原来的 Map 操作抽出来。
 * 未来 SQLite 实现是同一个接口，FinanceService 不用改。
 */

import type { Account } from '../account.js'
import type { JournalEntry } from '../journal-entry.js'
import type { AccountRepository, EntryRepository } from './types.js'

export class InMemoryAccountRepository implements AccountRepository {
  private readonly data = new Map<string, Account>()

  save(account: Account): void {
    this.data.set(account.id, account)
  }

  findById(id: string): Account | null {
    return this.data.get(id) ?? null
  }

  listAll(): Account[] {
    return [...this.data.values()]
  }
}

export class InMemoryEntryRepository implements EntryRepository {
  private readonly data = new Map<string, JournalEntry>()

  save(entry: JournalEntry): void {
    this.data.set(entry.id, entry)
  }

  findById(id: string): JournalEntry | null {
    return this.data.get(id) ?? null
  }

  listRecent(limit: number): JournalEntry[] {
    return [...this.data.values()].reverse().slice(0, limit)
  }

  count(): number {
    return this.data.size
  }
}
