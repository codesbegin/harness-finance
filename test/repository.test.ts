import { test, describe, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { Account } from '../src/account.js'
import { JournalEntry, Posting } from '../src/journal-entry.js'
import { createSQLiteRepositories } from '../src/repository/sqlite.js'

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

  function postEntry(id: string, description: string, amount: number) {
    const cash = repos.accounts.findById('cash')!
    const rent = repos.accounts.findById('rent')!
    const je = new JournalEntry({ id, description })
    je.addPosting(new Posting({ account: rent, direction: 'debit', amount }))
    je.addPosting(new Posting({ account: cash, direction: 'credit', amount }))
    je.post()
    repos.entries.save(je)
    return je
  }

  test('save 分录 → findById 能读回完整 postings', () => {
    seedAccounts()
    postEntry('je-1', '付房租', 3000)

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
    postEntry('je-1', '分录1', 100)
    postEntry('je-2', '分录2', 200)
    postEntry('je-3', '分录3', 300)

    const recent = repos.entries.listRecent(2)
    assert.equal(recent.length, 2)
    assert.equal(recent[0].id, 'je-3')
    assert.equal(recent[1].id, 'je-2')
  })

  test('count 返回分录总数', () => {
    seedAccounts()
    assert.equal(repos.entries.count(), 0)
    postEntry('je-1', 'x', 100)
    assert.equal(repos.entries.count(), 1)
  })

  test('save 同一 entry id 覆盖旧 postings', () => {
    seedAccounts()
    postEntry('je-1', '原始', 100)
    postEntry('je-1', '更新后', 200)

    const found = repos.entries.findById('je-1')
    assert.equal(found!.description, '更新后')
    assert.equal(found!.postings.length, 2)
    assert.equal(found!.totalDebit, 200)
  })

  test('search 按 description 关键词过滤', () => {
    seedAccounts()
    postEntry('je-1', '付房租', 100)
    postEntry('je-2', '办公用品采购', 200)
    postEntry('je-3', '房租押金', 300)

    const results = repos.entries.search({ description: '房租' })
    assert.equal(results.length, 2)
    assert.deepEqual(results.map(r => r.id).sort(), ['je-1', 'je-3'])
  })

  test('search 按 accountId 过滤', () => {
    seedAccounts()
    // 再加一个 income 账户，做一笔收入分录
    repos.accounts.save(new Account({ id: 'salary', name: '工资', category: 'INCOME' }))
    const cash = repos.accounts.findById('cash')!
    const salary = repos.accounts.findById('salary')!

    const jeIncome = new JournalEntry({ id: 'je-income', description: '发工资' })
    jeIncome.addPosting(new Posting({ account: cash, direction: 'debit', amount: 5000 }))
    jeIncome.addPosting(new Posting({ account: salary, direction: 'credit', amount: 5000 }))
    jeIncome.post()
    repos.entries.save(jeIncome)

    postEntry('je-expense', '付房租', 100)

    // 只查涉及 salary 账户的分录
    const results = repos.entries.search({ accountId: 'salary' })
    assert.equal(results.length, 1)
    assert.equal(results[0].id, 'je-income')
  })

  test('search 按 category 过滤', () => {
    seedAccounts()
    postEntry('je-1', '付房租', 100)

    // 加一笔 income
    repos.accounts.save(new Account({ id: 'salary', name: '工资', category: 'INCOME' }))
    const cash = repos.accounts.findById('cash')!
    const salary = repos.accounts.findById('salary')!
    const jeIncome = new JournalEntry({ id: 'je-income', description: '发工资' })
    jeIncome.addPosting(new Posting({ account: cash, direction: 'debit', amount: 5000 }))
    jeIncome.addPosting(new Posting({ account: salary, direction: 'credit', amount: 5000 }))
    jeIncome.post()
    repos.entries.save(jeIncome)

    const expenseOnly = repos.entries.search({ category: 'EXPENSE' })
    assert.equal(expenseOnly.length, 1)
    assert.equal(expenseOnly[0].id, 'je-1')

    const incomeOnly = repos.entries.search({ category: 'INCOME' })
    assert.equal(incomeOnly.length, 1)
    assert.equal(incomeOnly[0].id, 'je-income')
  })

  test('search 按 minAmount 过滤', () => {
    seedAccounts()
    postEntry('je-small', '咖啡', 50)
    postEntry('je-medium', '聚餐', 500)
    postEntry('je-large', '电脑', 5000)

    const large = repos.entries.search({ minAmount: 1000 })
    assert.equal(large.length, 1)
    assert.equal(large[0].id, 'je-large')
  })

  test('search 多个条件 AND 组合', () => {
    seedAccounts()
    postEntry('je-1', '付房租', 3000)
    postEntry('je-2', '房租押金', 500)  // 也是房租但金额小
    postEntry('je-3', '办公用品', 100)

    // 描述含"房租" 且 金额 >= 1000
    const results = repos.entries.search({ description: '房租', minAmount: 1000 })
    assert.equal(results.length, 1)
    assert.equal(results[0].id, 'je-1')
  })

  test('search 结果按时间倒序', () => {
    seedAccounts()
    postEntry('je-1', '第一个', 100)
    postEntry('je-2', '第二个', 200)
    postEntry('je-3', '第三个', 300)

    const results = repos.entries.search({ description: '' })
    assert.equal(results[0].id, 'je-3')
    assert.equal(results[2].id, 'je-1')
  })
})
