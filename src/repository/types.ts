/**
 * Repository 接口 — 持久化抽象层。
 *
 * 设计原则：
 *   1. FinanceService 只依赖接口，不关心存储是内存 Map 还是 SQLite。
 *   2. Repository 负责把 domain 对象（Account / JournalEntry）整体存取。
 *   3. 未来切 SQLite 时，只换实现，不改 FinanceService。
 *
 * 为什么不是每个表一个 Repository：
 *   - JournalEntry 包含 Posting 数组，Posting 又关联 Account。
 *   - 如果 Account 和 Entry 分开存，读 JournalEntry 时要 join 多张表。
 *   - 现在由 EntryRepository.save 负责级联保存 postings，未来 SQLite 实现时再拆表。
 */

import type { Account } from '../account.js'
import type { JournalEntry } from '../journal-entry.js'

export interface AccountRepository {
  /** 新建或更新账户。 */
  save(account: Account): void

  /** 按 ID 查账户；不存在返回 null。 */
  findById(id: string): Account | null

  /** 列出所有账户（按创建顺序）。 */
  listAll(): Account[]
}

export interface EntryRepository {
  /** 新建或更新分录（含所有 postings）。 */
  save(entry: JournalEntry): void

  /** 按 ID 查分录；不存在返回 null。 */
  findById(id: string): JournalEntry | null

  /** 列出最近 N 条分录（新到旧）。 */
  listRecent(limit: number): JournalEntry[]

  /** 总分录数。 */
  count(): number
}

export interface FinanceRepositories {
  accounts: AccountRepository
  entries: EntryRepository
}
