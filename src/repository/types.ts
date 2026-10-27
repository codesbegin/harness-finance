/**
 * Repository 接口 — 持久化抽象层。
 *
 * 设计原则：
 *   1. FinanceService 只依赖接口，不关心存储是内存 Map 还是 SQLite。
 *   2. Repository 负责把 domain 对象（Account / JournalEntry）整体存取。
 *   3. 未来切 SQLite 时，只换实现，不改 FinanceService。
 */

import type { Account, AccountCategory } from '../account.js'
import type { JournalEntry } from '../journal-entry.js'

export interface AccountRepository {
  save(account: Account): void
  findById(id: string): Account | null
  listAll(): Account[]
}

/**
 * 分录搜索条件。所有字段可选，AND 组合。
 */
export interface EntrySearchQuery {
  /** 描述里包含的关键词（不区分大小写，子串匹配）。 */
  description?: string
  /** 只返回涉及某个账户的分录。 */
  accountId?: string
  /** 只返回某个类别的账户参与的分录。 */
  category?: AccountCategory
  /** 只返回某种状态的分录（DRAFT / POSTED / LOCKED / REJECTED）。 */
  status?: string
  /** 金额 >= 该值的分录（按 totalDebit 比较）。 */
  minAmount?: number
  /** 返回条数上限，默认 50。 */
  limit?: number
}

export interface EntryRepository {
  save(entry: JournalEntry): void
  findById(id: string): JournalEntry | null
  listRecent(limit: number): JournalEntry[]
  count(): number
  /**
   * 按条件搜索分录。所有可选字段 AND 组合，新到旧排序。
   */
  search(query: EntrySearchQuery): JournalEntry[]
}

export interface FinanceRepositories {
  accounts: AccountRepository
  entries: EntryRepository
}
