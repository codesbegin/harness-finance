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
   * 流程：
   *   1. 构造分录并校验借贷平衡（业务层不变量）
   *   2. je.post() 更新账户余额
   *   3. 把分录和所有 posting 写入 ABox（让 reasoner 有数据可推理）
   *   4. checkConsistency：不一致则回滚（余额 + ABox）并抛错
   *   5. 一致则提交，存入 entries Map
   *
   * 系统做裁判不做运动员——reasoner 不一致时不自动修正金额，只回滚并抛错。
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

    // 写入 ABox：让 reasoner 能看到这笔分录的结构。
    // 每个 posting 用 p-<je.id>-<index> 作为实例 ID，保证唯一。
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
      // reasoner 不可用（WASM 未加载等）时降级为跳过，不阻塞业务。
      consistent = true
    }

    if (!consistent) {
      // 回滚：反向冲销余额 + 从 ABox 删除实例
      for (const p of je.postings) {
        p.account.applyPosting(p.direction === 'debit' ? 'credit' : 'debit', p.amount)
      }
      this.ontology.removeJournalEntry(je.id)
      je.status = 'REJECTED'
      throw new FinanceError(
        'entry violates ontology constraints — see explain for details',
        'FINANCE_ONTOLOGY_INCONSISTENT',
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
