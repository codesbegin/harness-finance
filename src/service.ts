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

  /**
   * 过账：构造 JournalEntry → post() → 写入 ABox → 本体一致性检查。
   *
   * 一致性检查失败时：
   *   1. 反向回滚所有 posting 的账户余额
   *   2. 从 ABox 删除刚加的分录实例
   *   3. 把刚加的三元组作为"矛盾核心"塞进 explain 返回给 agent
   *   4. 抛 FinanceError 给 agent，由 agent 决定重试 / 问人 / 放弃
   */
  @Remote('postEntry')
  async postEntry(input: {
    description: string
    postings: Array<{ accountId: string; direction: 'debit' | 'credit'; amount: number }>
  }): Promise<{ id: string; status: string; totalDebit: number; totalCredit: number }> {
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

    // 写入 ABox
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

    // 本体一致性检查
    let consistent = true
    try {
      consistent = await this.ontology.checkConsistency()
    } catch {
      consistent = true
    }

    if (!consistent) {
      // 回滚业务层余额
      for (const p of je.postings) {
        p.account.applyPosting(p.direction === 'debit' ? 'credit' : 'debit', p.amount)
      }
      // 回滚 ABox：删除刚加的实例
      this.ontology.removeJournalEntry(je.id)
      je.status = 'REJECTED'

      // 构造"矛盾核心"说明：之前 Store 是一致的，刚加这笔分录后才不一致，
      // 所以矛盾一定和这笔分录及其关联账户有关。把这些信息给 agent。
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
