/**
 * InMemoryRepository — 内存实现，用于开发和测试。
 */

import type { Account } from '../account.js'
import type { JournalEntry } from '../journal-entry.js'
import type { AccountRepository, EntryRepository, EntrySearchQuery } from './types.js'

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

  search(query: EntrySearchQuery): JournalEntry[] {
    const limit = query.limit ?? 50
    let results = [...this.data.values()].reverse()

    if (query.description) {
      const kw = query.description.toLowerCase()
      results = results.filter(je => je.description.toLowerCase().includes(kw))
    }

    if (query.accountId) {
      results = results.filter(je => je.postings.some(p => p.account.id === query.accountId))
    }

    if (query.category) {
      results = results.filter(je => je.postings.some(p => p.account.category === query.category))
    }

    if (query.status) {
      results = results.filter(je => je.status === query.status)
    }

    if (query.minAmount !== undefined) {
      results = results.filter(je => je.totalDebit >= query.minAmount!)
    }

    return results.slice(0, limit)
  }
}
