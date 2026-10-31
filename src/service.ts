import { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import s from '@deepseek-ai/schemastery'
import { randomUUID } from 'node:crypto'
import { Account, AccountCategory, JournalEntry, Posting } from './index.js'
import { FinanceError } from './errors.js'
import type { AboxSummary, OntologyService } from './ontology/index.js'
import { InMemoryAccountRepository, InMemoryEntryRepository } from './repository/memory.js'
import { createSQLiteRepositories } from './repository/sqlite.js'
import type { AccountRepository, EntryRepository, EntrySearchQuery, FinanceRepositories } from './repository/types.js'

declare module '@deepseek-ai/cordis' {
  interface Context {
    finance: FinanceService
  }
}

export interface FinanceConfig {
  ledger?: string
  storage?: 'memory' | 'sqlite'
  dbPath?: string
}

export interface EntrySummary {
  id: string
  description: string
  status: string
  totalDebit: number
  totalCredit: number
  postingCount: number
}

export interface PostingView {
  accountId: string
  accountName: string
  category: AccountCategory
  direction: 'debit' | 'credit'
  amount: number
}

export interface EntryDetail extends EntrySummary {
  postings: PostingView[]
}

export interface AccountTrialBalance {
  accountId: string
  accountName: string
  category: AccountCategory
  normalBalance: 'debit' | 'credit'
  balance: number
  signedBalance: number
}

/** 账本概览：agent 一次性了解账本状态，不用分别调 listAccounts/listEntries/trialBalance。 */
export interface LedgerSummary {
  ledger: string
  ontology: AboxSummary
  accounts: Array<{ id: string; name: string; category: AccountCategory; balance: number }>
}

export class FinanceService extends TypertRemoteService {
  static inject = ['ontology'] as const

  static Config: s<FinanceConfig> = s.object({
    ledger: s.string().default('default'),
    storage: s.string().enum(['memory', 'sqlite']).default('memory'),
    dbPath: s.string().default('./harness-finance.db'),
  })

  private readonly ledger: string
  private readonly accounts: AccountRepository
  private readonly entries: EntryRepository
  private readonly ontology: OntologyService

  constructor(ctx: Context, config: FinanceConfig = {}) {
    super(ctx, 'finance')
    this.ledger = config.ledger ?? 'default'
    this.ontology = ctx.ontology

    const repos: FinanceRepositories = config.storage === 'sqlite'
      ? createSQLiteRepositories(config.dbPath ?? './harness-finance.db')
      : { accounts: new InMemoryAccountRepository(), entries: new InMemoryEntryRepository() }
    this.accounts = repos.accounts
    this.entries = repos.entries
  }

  @Remote('getLedger')
  getLedger(): string {
    return this.ledger
  }

  @Remote('createAccount')
  createAccount(input: { name: string; category: AccountCategory; openingBalance?: number }): Account {
    const id = `acct-${randomUUID().slice(0, 8)}`
    const acc = new Account({ id, ...input })
    this.accounts.save(acc)
    this.ontology.addAccount(id, acc.category)
    return acc
  }

  @Remote('listAccounts')
  listAccounts(): Array<{ id: string; name: string; category: AccountCategory; balance: number }> {
    return this.accounts.listAll().map(a => ({
      id: a.id,
      name: a.name,
      category: a.category,
      balance: a.balance,
    }))
  }

  /**
   * 账本概览：一次调用拿到 ABox 统计 + 账户列表。
   * agent 冷启动或用户问"我账本现在什么样"时用这个，省得连调三个 Remote。
   */
  @Remote('ledgerSummary')
  ledgerSummary(): LedgerSummary {
    return {
      ledger: this.ledger,
      ontology: this.ontology.aboxSummary(),
      accounts: this.accounts.listAll().map(a => ({
        id: a.id, name: a.name, category: a.category, balance: a.balance,
      })),
    }
  }

  /**
   * 过账核心流程：
   *
   *   1. 加载账户 → 2. 构造 JournalEntry → 3. je.post() 同步 mutate 账户余额（内存）
   *   4. 同步到 ABox → 5. checkConsistency
   *   6a. 一致：把所有受影响账户 save 回 repository，分录也 save
   *   6b. 不一致：reverse 账户余额，reverse 后也要 save 回 repository（否则 SQLite 里余额是错的），
   *        并从 ABox 删除该分录，抛 FINANCE_ONTOLOGY_INCONSISTENT
   *
   * 注意：账户余额在 step 3 就被 mutate 了，repository 里的快照是旧值。
   * 无论走 6a 还是 6b，都必须显式 accounts.save()，SQLite 持久化才生效。
   */
  @Remote('postEntry')
  async postEntry(input: {
    description: string
    postings: Array<{ accountId: string; direction: 'debit' | 'credit'; amount: number }>
  }): Promise<{ id: string; status: string; totalDebit: number; totalCredit: number }> {
    const je = new JournalEntry({ id: `je-${randomUUID().slice(0, 8)}`, description: input.description })
    const affectedAccounts: Account[] = []

    for (const p of input.postings) {
      const acc = this.accounts.findById(p.accountId)
      if (!acc) throw new FinanceError(`account ${p.accountId} not found`, 'FINANCE_UNKNOWN_ACCOUNT')
      if (!(p.amount > 0)) throw new FinanceError('posting amount must be positive', 'FINANCE_INVALID_POSTING')
      je.addPosting(new Posting({ account: acc, direction: p.direction, amount: p.amount }))
      affectedAccounts.push(acc)
    }

    try {
      je.post()
    } catch (e) {
      throw new FinanceError(
        e instanceof Error ? e.message : 'unbalanced entry',
        'FINANCE_UNBALANCED_ENTRY',
      )
    }

    this.ontology.addJournalEntry(je.id, je.description)
    je.postings.forEach((p, i) => {
      this.ontology.addPosting(
        `${je.id}-${i}`,
        je.id,
        p.account.id,
        p.direction,
        p.amount,
      )
    })

    let consistent = true
    try {
      consistent = await this.ontology.checkConsistency()
    } catch {
      // WASM reasoner 加载失败时降级为放行——TBox 静态检查（DOT 导出）仍可用，
      // 不应该让推理器故障阻塞正常记账。
      consistent = true
    }

    if (!consistent) {
      // reverse 账户余额（内存里）
      for (const p of je.postings) {
        p.account.applyPosting(p.direction === 'debit' ? 'credit' : 'debit', p.amount)
      }
      // 关键：把 reverse 后的余额也写回 repository，否则 SQLite 里残留脏数据
      for (const acc of affectedAccounts) this.accounts.save(acc)

      this.ontology.removeJournalEntry(je.id)
      je.status = 'REJECTED'

      const explain: string[][] = [
        [`Entry ${je.id} was rejected because adding it to the ABox made the ontology inconsistent.`],
        [`Description: ${je.description}`],
        ...je.postings.map((p, i) => [
          `Posting ${je.id}-${i}: ${p.direction} ${p.amount} to account ${p.account.id} (${p.account.category})`,
        ]),
        [`Hint: check whether any account in this entry conflicts with existing disjointness axioms.`],
      ]

      throw new FinanceError(
        'entry violates ontology constraints — see explain for details',
        'FINANCE_ONTOLOGY_INCONSISTENT',
        explain,
      )
    }

    // 通过：把所有受影响账户的新余额持久化
    for (const acc of affectedAccounts) this.accounts.save(acc)
    this.entries.save(je)
    return { id: je.id, status: je.status, totalDebit: je.totalDebit, totalCredit: je.totalCredit }
  }

  @Remote('trialBalance')
  trialBalance(): {
    byCategory: Array<{ category: AccountCategory; debit: number; credit: number }>
    totalDebit: number
    totalCredit: number
    balanced: boolean
  } {
    const bucket = new Map<AccountCategory, { debit: number; credit: number }>()
    let d = 0, c = 0
    for (const a of this.accounts.listAll()) {
      const cell = bucket.get(a.category) ?? { debit: 0, credit: 0 }
      if (a.normalBalance === 'debit') { cell.debit += a.balance; d += a.balance }
      else { cell.credit += a.balance; c += a.balance }
      bucket.set(a.category, cell)
    }
    return {
      byCategory: [...bucket.entries()].map(([category, v]) => ({ category, ...v })),
      totalDebit: d,
      totalCredit: c,
      balanced: Math.round(d * 100) === Math.round(c * 100),
    }
  }

  @Remote('trialBalanceDetail')
  trialBalanceDetail(): AccountTrialBalance[] {
    return this.accounts.listAll().map(a => ({
      accountId: a.id,
      accountName: a.name,
      category: a.category,
      normalBalance: a.normalBalance,
      balance: a.balance,
      signedBalance: a.signedBalance,
    }))
  }

  @Remote('listEntries')
  listEntries(limit = 20): EntrySummary[] {
    return this.entries.listRecent(limit).map(je => ({
      id: je.id,
      description: je.description,
      status: je.status,
      totalDebit: je.totalDebit,
      totalCredit: je.totalCredit,
      postingCount: je.postings.length,
    }))
  }

  /**
   * 搜索分录。
   * agent 用这个回答"上个月办公用品花了多少""所有涉及现金的大额支出"。
   */
  @Remote('searchEntries')
  searchEntries(query: EntrySearchQuery): EntrySummary[] {
    return this.entries.search(query).map(je => ({
      id: je.id,
      description: je.description,
      status: je.status,
      totalDebit: je.totalDebit,
      totalCredit: je.totalCredit,
      postingCount: je.postings.length,
    }))
  }

  @Remote('getEntry')
  getEntry(entryId: string): EntryDetail {
    const je = this.entries.findById(entryId)
    if (!je) throw new FinanceError(`entry ${entryId} not found`, 'FINANCE_UNKNOWN_ENTRY')
    return {
      id: je.id,
      description: je.description,
      status: je.status,
      totalDebit: je.totalDebit,
      totalCredit: je.totalCredit,
      postingCount: je.postings.length,
      postings: je.postings.map(p => ({
        accountId: p.account.id,
        accountName: p.account.name,
        category: p.account.category,
        direction: p.direction,
        amount: p.amount,
      })),
    }
  }
}

export default FinanceService
