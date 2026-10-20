import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { Account } from '../src/account.js'
import { Posting, JournalEntry } from '../src/journal-entry.js'

/**
 * 构造一个测试用账户。
 */
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
