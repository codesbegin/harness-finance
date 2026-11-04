import { test, describe, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import type { Context } from '@deepseek-ai/cordis'
import { OntologyService } from '../src/ontology/service.js'
import { FinanceService } from '../src/service.js'

/**
 * ABox 与 domain 层一致性契约测试。
 *
 * domain 层（Account / JournalEntry 对象）和 ABox（N3 Store 里的实例三元组）
 * 是同一笔账的两套视图。postEntry 时 FinanceService 会同步写两边，
 * 这个测试锁住"投影必须对齐"的不变量：
 *
 *   1. 账户数 / 分录数 / 过账数在两边必须一致
 *   2. ABox 借贷总额必须平衡（每笔分录本身平衡，数据层投影也必须平衡）
 *   3. 失败的分录（不平 / 未知账户）不得污染 ABox
 *
 * 注意：ABox postings.totalDebit 是"过账流量"（所有 debit posting 金额之和），
 * 而 trialBalance().totalDebit 是"账户余额存量"（debit-normal 账户余额之和），
 * 语义不同，这里不拿它们做相等断言。
 */

describe('ABox ↔ domain 一致性', () => {
  let svc: FinanceService
  let ontology: OntologyService

  beforeEach(() => {
    // 最小 ctx：OntologyService 和 FinanceService 构造只需要 ctx 引用存在。
    // ontologyPath 省略时用默认路径（仓库根 ontology/finance.ttl）。
    const ctx = {} as unknown as Context
    ontology = new OntologyService(ctx)
    svc = new FinanceService(ctx, { storage: 'memory' })
  })

  function seedTwoAccounts() {
    svc.createAccount({ name: '现金', category: 'ASSET' })
    svc.createAccount({ name: '工资', category: 'INCOME' })
  }

  test('postEntry 后三处计数对齐：账户 / 分录 / 过账', async () => {
    seedTwoAccounts()
    await svc.postEntry({
      description: '发工资',
      postings: [
        { accountId: 'acct-1', direction: 'debit', amount: 5000 },
        { accountId: 'acct-2', direction: 'credit', amount: 5000 },
      ],
    })

    // domain 视图
    assert.equal(svc.listAccounts().length, 2)
    assert.equal(svc.listEntries().length, 1)
    assert.equal(svc.listEntries()[0].postingCount, 2)

    // ABox 投影
    const summary = ontology.aboxSummary()
    assert.equal(summary.accounts.total, 2)
    assert.equal(summary.entries, 1)
    assert.equal(summary.postings.total, 2)
  })

  test('ABox 借贷总额平衡且与累计过账金额相等', async () => {
    seedTwoAccounts()
    await svc.postEntry({
      description: '发工资',
      postings: [
        { accountId: 'acct-1', direction: 'debit', amount: 5000 },
        { accountId: 'acct-2', direction: 'credit', amount: 5000 },
      ],
    })
    await svc.postEntry({
      description: '交房租',
      postings: [
        { accountId: 'acct-2', direction: 'debit', amount: 1000 },
        { accountId: 'acct-1', direction: 'credit', amount: 1000 },
      ],
    })

    const summary = ontology.aboxSummary()
    // 两笔分录，共 4 个 posting，每笔 5000 / 1000，借贷各累计 6000
    assert.equal(summary.postings.total, 4)
    assert.equal(summary.postings.totalDebit, 6000)
    assert.equal(summary.postings.totalCredit, 6000)
    assert.equal(summary.postings.balanced, true)
  })

  test('借贷不平的分录：domain 抛错且 ABox 不被污染', async () => {
    seedTwoAccounts()
    const before = ontology.aboxSummary()

    await assert.rejects(
      svc.postEntry({
        description: '不平分录',
        postings: [
          { accountId: 'acct-1', direction: 'debit', amount: 100 },
          { accountId: 'acct-2', direction: 'credit', amount: 200 },
        ],
      }),
      /FINANCE_UNBALANCED_ENTRY|unbalanced/i,
    )

    const after = ontology.aboxSummary()
    assert.equal(after.entries, before.entries)
    assert.equal(after.postings.total, before.postings.total)
    assert.equal(svc.listEntries().length, 0)
  })

  test('未知账户的分录：domain 抛错且 ABox 不被污染', async () => {
    seedTwoAccounts()
    const before = ontology.aboxSummary()

    await assert.rejects(
      svc.postEntry({
        description: '未知账户',
        postings: [
          { accountId: 'acct-999', direction: 'debit', amount: 100 },
          { accountId: 'acct-2', direction: 'credit', amount: 100 },
        ],
      }),
      /FINANCE_UNKNOWN_ACCOUNT|not found/i,
    )

    const after = ontology.aboxSummary()
    assert.equal(after.entries, before.entries)
    assert.equal(after.postings.total, before.postings.total)
  })

  test('createAccount 后 ABox 按类别正确计数', () => {
    svc.createAccount({ name: '现金', category: 'ASSET' })
    svc.createAccount({ name: '工资', category: 'INCOME' })
    svc.createAccount({ name: '房租', category: 'EXPENSE' })
    svc.createAccount({ name: '信用卡', category: 'LIABILITY' })
    svc.createAccount({ name: '资本', category: 'EQUITY' })

    const summary = ontology.aboxSummary()
    assert.equal(summary.accounts.total, 5)
    assert.deepEqual(summary.accounts.byCategory, {
      AssetAccount: 1,
      IncomeAccount: 1,
      ExpenseAccount: 1,
      LiabilityAccount: 1,
      EquityAccount: 1,
    })
  })
})
