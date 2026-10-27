import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { Account } from '../src/account.js'
import { Posting, JournalEntry } from '../src/journal-entry.js'

function makeAccount(id: string, category: 'ASSET' | 'EXPENSE' = 'ASSET'): Account {
  return new Account({ id, name: `Test ${id}`, category, openingBalance: 0 })
}

describe('JournalEntry 不变量', () => {
  test('正常过账：借贷相等 → status POSTED', () => {
    const cash = makeAccount('cash', 'ASSET')
    const rent = makeAccount('rent', 'EXPENSE')
    const je = new JournalEntry({ id: 'je-1', description: 'pay rent' })
    je.addPosting(new Posting({ account: rent, direction: 'debit', amount: 100 }))
    je.addPosting(new Posting({ account: cash, direction: 'credit', amount: 100 }))
    je.post()
    assert.equal(je.status, 'POSTED')
    assert.equal(cash.balance, -100)
    assert.equal(rent.balance, 100)
  })

  test('借贷不平 → post() 抛错', () => {
    const cash = makeAccount('cash')
    const rent = makeAccount('rent', 'EXPENSE')
    const je = new JournalEntry({ id: 'je-2', description: 'unbalanced' })
    je.addPosting(new Posting({ account: rent, direction: 'debit', amount: 100 }))
    je.addPosting(new Posting({ account: cash, direction: 'credit', amount: 80 }))
    assert.throws(() => je.post(), /unbalanced.*100.*!=.*80/)
    assert.equal(je.status, 'DRAFT')
  })

  test('少于两个 posting → post() 抛错', () => {
    const cash = makeAccount('cash')
    const je = new JournalEntry({ id: 'je-3', description: 'single posting' })
    je.addPosting(new Posting({ account: cash, direction: 'debit', amount: 50 }))
    assert.throws(() => je.post(), /at least two postings/)
  })

  test('只有 DRAFT 状态能加 posting', () => {
    const cash = makeAccount('cash')
    const rent = makeAccount('rent', 'EXPENSE')
    const je = new JournalEntry({ id: 'je-4', description: 'locked entry' })
    je.addPosting(new Posting({ account: rent, direction: 'debit', amount: 100 }))
    je.addPosting(new Posting({ account: cash, direction: 'credit', amount: 100 }))
    je.post()
    assert.throws(() => je.addPosting(new Posting({ account: cash, direction: 'debit', amount: 1 })), /DRAFT/)
  })

  test('只有 POSTED 状态能 lock', () => {
    const cash = makeAccount('cash')
    const rent = makeAccount('rent', 'EXPENSE')
    const je = new JournalEntry({ id: 'je-5', description: 'lock test' })
    je.addPosting(new Posting({ account: rent, direction: 'debit', amount: 100 }))
    je.addPosting(new Posting({ account: cash, direction: 'credit', amount: 100 }))
    assert.throws(() => je.lock(), /POSTED/)
    je.post()
    je.lock()
    assert.equal(je.status, 'LOCKED')
  })

  test('posting 金额必须为正', () => {
    const cash = makeAccount('cash')
    assert.throws(() => new Posting({ account: cash, direction: 'debit', amount: 0 }), /positive/)
    assert.throws(() => new Posting({ account: cash, direction: 'debit', amount: -10 }), /positive/)
  })

  test('totalDebit / totalCredit 计算正确', () => {
    const cash = makeAccount('cash')
    const rent = makeAccount('rent', 'EXPENSE')
    const je = new JournalEntry({ id: 'je-6', description: 'multi posting' })
    je.addPosting(new Posting({ account: rent, direction: 'debit', amount: 100 }))
    je.addPosting(new Posting({ account: cash, direction: 'credit', amount: 60 }))
    je.addPosting(new Posting({ account: cash, direction: 'credit', amount: 40 }))
    assert.equal(je.totalDebit, 100)
    assert.equal(je.totalCredit, 100)
    assert.equal(je.isBalanced, true)
  })
})

describe('JournalEntry 持久化快照（restore / toSnapshot）', () => {
  test('toSnapshot → restore 是可逆的', () => {
    const cash = makeAccount('cash', 'ASSET')
    const rent = makeAccount('rent', 'EXPENSE')

    const je = new JournalEntry({ id: 'je-snap', description: 'test snapshot' })
    je.addPosting(new Posting({ account: rent, direction: 'debit', amount: 3000 }))
    je.addPosting(new Posting({ account: cash, direction: 'credit', amount: 3000 }))
    je.post()

    const snap = je.toSnapshot()
    const accountsById = new Map([['cash', cash], ['rent', rent]])
    const restored = JournalEntry.restore(snap, accountsById)

    assert.equal(restored.id, je.id)
    assert.equal(restored.description, je.description)
    assert.equal(restored.status, je.status)
    assert.equal(restored.postings.length, 2)
    assert.equal(restored.totalDebit, je.totalDebit)
    assert.equal(restored.totalCredit, je.totalCredit)
  })

  test('restore 后 posting 关联的 account 是同一对象', () => {
    const cash = makeAccount('cash', 'ASSET')
    const rent = makeAccount('rent', 'EXPENSE')

    const je = new JournalEntry({ id: 'je-rel', description: 'link test' })
    je.addPosting(new Posting({ account: rent, direction: 'debit', amount: 100 }))
    je.addPosting(new Posting({ account: cash, direction: 'credit', amount: 100 }))
    je.post()

    const snap = je.toSnapshot()
    const accountsById = new Map([['cash', cash], ['rent', rent]])
    const restored = JournalEntry.restore(snap, accountsById)

    // restore 出来的 posting.account 应该就是 accountsById 里的同一个对象
    const rentPosting = restored.postings.find(p => p.direction === 'debit')!
    assert.equal(rentPosting.account, rent)
  })

  test('restore 后再 post() 会抛错（已经是 POSTED）', () => {
    const cash = makeAccount('cash', 'ASSET')
    const rent = makeAccount('rent', 'EXPENSE')

    const je = new JournalEntry({ id: 'je-repost', description: 'repost test' })
    je.addPosting(new Posting({ account: rent, direction: 'debit', amount: 100 }))
    je.addPosting(new Posting({ account: cash, direction: 'credit', amount: 100 }))
    je.post()

    const snap = je.toSnapshot()
    const accountsById = new Map([['cash', cash], ['rent', rent]])
    const restored = JournalEntry.restore(snap, accountsById)

    assert.throws(() => restored.post(), /POSTED/)
  })
})
