import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { Account } from '../src/account.js'

describe('Account 不变量', () => {
  test('AssetAccount 默认 normalBalance=debit，openingBalance 为正', () => {
    const a = new Account({ id: 'cash', name: '现金', category: 'ASSET', openingBalance: 100 })
    assert.equal(a.normalBalance, 'debit')
    assert.equal(a.balance, 100)
    assert.equal(a.isNormalDirection, true)
  })

  test('LiabilityAccount 默认 normalBalance=credit，openingBalance 取负', () => {
    const a = new Account({ id: 'loan', name: '借款', category: 'LIABILITY', openingBalance: 50 })
    assert.equal(a.normalBalance, 'credit')
    // credit 方向的账户，signedBalance 存负数，balance 返回绝对值
    assert.equal(a.balance, 50)
    assert.equal(a.isNormalDirection, true)
  })

  test('AssetAccount 记 debit → signedBalance 增加', () => {
    const a = new Account({ id: 'cash', name: '现金', category: 'ASSET', openingBalance: 0 })
    a.applyPosting('debit', 100)
    assert.equal(a.balance, 100)
  })

  test('AssetAccount 记 credit → signedBalance 减少（可能变负）', () => {
    const a = new Account({ id: 'cash', name: '现金', category: 'ASSET', openingBalance: 100 })
    a.applyPosting('credit', 30)
    assert.equal(a.balance, 70)
  })

  test('LiabilityAccount 记 credit → 余额增加', () => {
    const a = new Account({ id: 'loan', name: '借款', category: 'LIABILITY', openingBalance: 0 })
    a.applyPosting('credit', 200)
    assert.equal(a.balance, 200)
  })

  test('ExpenseAccount 和 AssetAccount 同为 debit 方向', () => {
    const exp = new Account({ id: 'rent', name: '房租', category: 'EXPENSE' })
    const asset = new Account({ id: 'cash', name: '现金', category: 'ASSET' })
    assert.equal(exp.normalBalance, asset.normalBalance)
    assert.equal(exp.normalBalance, 'debit')
  })

  test('IncomeAccount 和 LiabilityAccount 同为 credit 方向', () => {
    const inc = new Account({ id: 'sales', name: '收入', category: 'INCOME' })
    const lia = new Account({ id: 'loan', name: '借款', category: 'LIABILITY' })
    assert.equal(inc.normalBalance, lia.normalBalance)
    assert.equal(inc.normalBalance, 'credit')
  })

  test('金额必须为正', () => {
    const a = new Account({ id: 'cash', name: '现金', category: 'ASSET' })
    assert.throws(() => a.applyPosting('debit', 0), /positive/)
    assert.throws(() => a.applyPosting('credit', -5), /positive/)
  })
})
