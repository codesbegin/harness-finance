import { test, describe, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { OntologyService } from '../src/ontology/service.js'
import { FinanceService } from '../src/service.js'

interface TestContext {
  ctx: Context
  ontology: OntologyService
}

/** 模拟一个 Cordis 上下文：挂上 ontology，供 FinanceService 构造使用。 */
function makeCtx(): TestContext {
  const ctx = {} as unknown as Context & { ontology: OntologyService }
  const ontology = new OntologyService(ctx as unknown as Context)
  ctx.ontology = ontology
  return { ctx: ctx as unknown as Context, ontology }
}

/**
 * ABox 启动重建测试。
 *
 * 背景：domain 数据可以持久化到 SQLite，但 ABox 是进程内的 N3 Store，
 * 重启后是空的。FinanceService 构造时会调 rebuildAbox() 从 repository 重建，
 * 这个测试锁住"重启后 ABox 与重启前一致"的行为。
 */
describe('ABox 启动重建（SQLite 持久化）', () => {
  let dir: string | undefined

  afterEach(() => {
    if (!dir) return
    try {
      fs.rmSync(dir, { recursive: true, force: true })
    } catch {
      // Windows 上连接未关闭时目录可能删不掉；临时目录会由系统清理
    }
    dir = undefined
  })

  test('重启后从 SQLite 重建 ABox，实例计数与重启前一致', async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-finance-rebuild-'))
    const dbPath = path.join(dir, 'ledger.db')

    // 第一个"进程"：建 3 个账户 + 2 笔分录
    const first = makeCtx()
    const svc1 = new FinanceService(first.ctx, { storage: 'sqlite', dbPath })
    const cash = svc1.createAccount({ name: '现金', category: 'ASSET' })
    const salary = svc1.createAccount({ name: '工资', category: 'INCOME' })
    const coffee = svc1.createAccount({ name: '咖啡', category: 'EXPENSE' })

    await svc1.postEntry({
      description: '发工资',
      postings: [
        { accountId: cash.id, direction: 'debit', amount: 5000 },
        { accountId: salary.id, direction: 'credit', amount: 5000 },
      ],
    })
    await svc1.postEntry({
      description: '买咖啡',
      postings: [
        { accountId: coffee.id, direction: 'debit', amount: 30 },
        { accountId: cash.id, direction: 'credit', amount: 30 },
      ],
    })

    const before = first.ontology.aboxSummary()
    assert.equal(before.accounts.total, 3)
    assert.equal(before.entries, 2)
    assert.equal(before.postings.total, 4)
    assert.equal(before.postings.totalDebit, 5030)
    assert.equal(before.postings.totalCredit, 5030)
    assert.equal(before.postings.balanced, true)

    // 第二个"进程"：新的 OntologyService + 新的 FinanceService，同一个 db 文件
    const second = makeCtx()
    const svc2 = new FinanceService(second.ctx, { storage: 'sqlite', dbPath })

    const after = second.ontology.aboxSummary()
    assert.equal(after.accounts.total, before.accounts.total)
    assert.equal(after.entries, before.entries)
    assert.equal(after.postings.total, before.postings.total)
    assert.equal(after.postings.totalDebit, before.postings.totalDebit)
    assert.equal(after.postings.totalCredit, before.postings.totalCredit)
    assert.equal(after.postings.balanced, true)

    // domain 视图也应完整（账户余额从 db 读回）
    assert.equal(svc2.listAccounts().length, 3)
    assert.equal(svc2.listEntries().length, 2)
  })

  test('空库启动不产生幻影实例', () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-finance-empty-'))
    const dbPath = path.join(dir, 'empty.db')

    const { ctx, ontology } = makeCtx()
    new FinanceService(ctx, { storage: 'sqlite', dbPath })

    const summary = ontology.aboxSummary()
    assert.equal(summary.accounts.total, 0)
    assert.equal(summary.entries, 0)
    assert.equal(summary.postings.total, 0)
    assert.equal(summary.postings.balanced, true)
  })
})
