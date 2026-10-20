import { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import s from '@deepseek-ai/schemastery'
import { randomUUID } from 'node:crypto'
import { Account, AccountCategory, JournalEntry, Posting } from './index.js'
import { FinanceError } from './errors.js'
import type { OntologyService } from './ontology/index.js'

declare module '@deepseek-ai/cordis' {
  interface Context {
    finance: FinanceService
  }
}

export interface FinanceConfig {
  ledger?: string
}

export class FinanceService extends TypertRemoteService {
  static inject = ['ontology'] as const

  static Config: s<FinanceConfig> = s.object({
    ledger: s.string().default('default'),
  })

  private readonly ledger: string
  private readonly accounts = new Map<string, Account>()
  private readonly entries = new Map<string, JournalEntry>()
  private readonly ontology: OntologyService

  constructor(ctx: Context, config: FinanceConfig = {}) {
    super(ctx, 'finance')
    this.ledger = config.ledger ?? 'default'
    this.ontology = ctx.ontology
  }

  @Remote('getLedger')
  getLedger(): string {
    return this.ledger
  }

  @Remote('createAccount')
  createAccount(input: { name: string; category: AccountCategory; openingBalance?: number }): Account {
    const id = `acct-${randomUUID().slice(0, 8)}`
    const acc = new Account({ id, ...input })
    this.accounts.set(id, acc)
    // 同步 ABox：把账户实例加入本体，声明其属于哪个 Account 子类。
    // 后续过账时 reasoner 能基于这个类型做一致性推理。
    this.ontology.addAccount(id, acc.category)
    return acc
  }

  @Remote('listAccounts')
  listAccounts(): Array<{ id: string; name: string; category: AccountCategory; balance: number }> {
    return [...this.accounts.values()].map(a => ({
      id: a.id,
      name: a.name,
      category: a.category,
      balance: a.balance,
    }))
  }

  @Remote('postEntry')
  postEntry(input: {
    description: string
    postings: Array<{ accountId: string; direction: 'debit' | 'credit'; amount: number }>
  }): { id: string; status: string; totalDebit: number; totalCredit: number } {
    const je = new JournalEntry({ id: `je-${randomUUID().slice(0, 8)}`, description: input.description })
    for (const p of input.postings) {
      const acc = this.accounts.get(p.accountId)
      if (!acc) throw new FinanceError(`account ${p.accountId} not found`, 'FINANCE_UNKNOWN_ACCOUNT')
      if (!(p.amount > 0)) throw new FinanceError('posting amount must be positive', 'FINANCE_INVALID_POSTING')
      je.addPosting(new Posting({ account: acc, direction: p.direction, amount: p.amount }))
    }
    try {
      je.post()
    } catch (e) {
      throw new FinanceError(
        e instanceof Error ? e.message : 'unbalanced entry',
        'FINANCE_UNBALANCED_ENTRY',
      )
    }
    this.entries.set(je.id, je)
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
    for (const a of this.accounts.values()) {
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
}

export default FinanceService
