import { test, describe, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { Account } from '../src/account.js'
import { JournalEntry, Posting } from '../src/journal-entry.js'
import { createSQLiteRepositories } from '../src/repository/sqlite.js'

/**
 * SQLite Repository 单测。
 * 用 :memory: 内存数据库，每次测试独立。
 */
describe('SQLiteAccountRepository', () => {
  let repos: ReturnType<typeof createSQLiteRepositories>

  beforeEach(() => {
    repos = createSQLiteRepositories(':memory:')
  })

  test('save → findById 能读回来', () => {
    const acc = new Account({ id: 'cash', name: '现金', category: 'ASSET', openingBalance: 100 })
    repos.accounts.save(acc)

    const found = repos.accounts.findById('cash')
    assert.ok(found)
    assert.equal(found!.id, 'cash')
    assert.equal(found!.name, '现金')
    assert.equal(found!.category, 'ASSET')
    assert.equal(found!.balance, 100)
  })

  test('findById 不存在返回 null', () => {
    assert.equal(repos.accounts.findById('nope'), null)
  })

  test('listAll 返回所有账户', () => {
    repos.accounts.save(new Account({ id: 'a1', name: '账户1', category: 'ASSET' }))
    repos.accounts.save(new Account({ id: 'a2', name: '账户2', category: 'INCOME' }))
    assert.equal(repos.accounts.listAll().length, 2)
  })

  test('余额变动后 save 覆盖更新', () => {
    const acc = new Account({ id: 'cash', name: '现金', category: 'ASSET', openingBalance: 0 })
    repos.accounts.save(acc)
    acc.applyPosting('debit', 500)
    repos.accounts.save(acc)

    const found = repos.accounts.findById('cash')
    assert.equal(found!.balance, 500)
  })
})

describe('SQLiteEntryRepository', () => {
  let repos: ReturnType<typeof createSQLiteRepositories>

  beforeEach(() => {
    repos = createSQLiteRepositories(':memory:')
  })

  function seedAccounts() {
    repos.accounts.save(new Account({ id: 'cash', name: '现金', category: 'ASSET' }))
    repos.accounts.save(new Account({ id: 'rent', name: '房租', category: 'EXPENSE' }))
  }

  test('save 分录 → findById 能读回完整 postings', () => {
    seedAccounts()
    const cash = repos.accounts.findById('cash')!
    const rent = repos.accounts.findById('rent')!

    const je = new JournalEntry({ id: 'je-1', description: '付房租' })
    je.addPosting(new Posting({ account: rent, direction: 'debit', amount: 3000 }))
    je.addPosting(new Posting({ account: cash, direction: 'credit', amount: 3000 }))
    je.post()

    repos.entries.save(je)

    const found = repos.entries.findById('je-1')
    assert.ok(found)
    assert.equal(found!.description, '付房租')
    assert.equal(found!.status, 'POSTED')
    assert.equal(found!.postings.length, 2)
    assert.equal(found!.totalDebit, 3000)
    assert.equal(found!.totalCredit, 3000)
  })

  test('listRecent 按时间倒序返回', () => {
    seedAccounts()
    const cash = repos.accounts.findById('cash')!
    const rent = repos.accounts.findById('rent')!

    for (let i = 1; i <= 3; i++) {
      const je = new JournalEntry({ id: `je-${i}`, description: `分录${i}` })
      je.addPosting(new Posting({ account: rent, direction: 'debit', amount: 100 * i }))
      je.addPosting(new Posting({ account: cash, direction: 'credit', amount: 100 * i }))
      je.post()
      repos.entries.save(je)
    }

    const recent = repos.entries.listRecent(2)
    assert.equal(recent.length, 2)
    assert.equal(recent[0].id, 'je-3')
    assert.equal(recent[1].id, 'je-2')
  })

  test('count 返回分录总数', () => {
    seedAccounts()
    assert.equal(repos.entries.count(), 0)

    const cash = repos.accounts.findById('cash')!
    const rent = repos.accounts.findById('rent')!
    const je = new JournalEntry({ id: 'je-1', description: 'x' })
    je.addPosting(new Posting({ account: rent, direction: 'debit', amount: 100 }))
    je.addPosting(new Posting({ account: cash, direction: 'credit', amount: 100 }))
    je.post()
    repos.entries.save(je)

    assert.equal(repos.entries.count(), 1)
  })

  test('save 同一 entry id 覆盖旧 postings（不产生重复行）', () => {
    seedAccounts()
    const cash = repos.accounts.findById('cash')!
    const rent = repos.accounts.findById('rent')!

    const je = new JournalEntry({ id: 'je-1', description: '原始' })
    je.addPosting(new Posting({ account: rent, direction: 'debit', amount: 100 }))
    je.addPosting(new Posting({ account: cash, direction: 'credit', amount: 100 }))
    je.post()
    repos.entries.save(je)

    // 再 save 一次（模拟更新）
    const je2 = new JournalEntry({ id: 'je-1', description: '更新后' })
    je2.addPosting(new Posting({ account: rent, direction: 'debit', amount: 200 }))
    je2.addPosting(new Posting({ account: cash, direction: 'credit', amount: 200 }))
    je2.post()
    repos.entries.save(je2)

    const found = repos.entries.findById('je-1')
    assert.equal(found!.description, '更新后')
    assert.equal(found!.postings.length, 2)
    assert.equal(found!.totalDebit, 200)
  })
})
