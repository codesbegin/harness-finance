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

describe('Account 持久化快照（restore / toSnapshot）', () => {
  test('toSnapshot → restore 是可逆的', () => {
    const original = new Account({ id: 'cash', name: '现金', category: 'ASSET', openingBalance: 100 })
    original.applyPosting('debit', 250)
    original.applyPosting('credit', 50)

    const snapshot = original.toSnapshot()
    const restored = Account.restore(snapshot)

    assert.equal(restored.id, original.id)
    assert.equal(restored.name, original.name)
    assert.equal(restored.category, original.category)
    assert.equal(restored.balance, original.balance)
    assert.equal(restored.signedBalance, original.signedBalance)
  })

  test('credit 方向账户的 signedBalance 是负数', () => {
    const loan = new Account({ id: 'loan', name: '信用卡', category: 'LIABILITY', openingBalance: 0 })
    loan.applyPosting('credit', 800) // 花了 800，负债增加
    const snap = loan.toSnapshot()
    // credit 方向的账户，贷余存为负数
    assert.equal(snap.signedBalance, -800)
    const restored = Account.restore(snap)
    assert.equal(restored.balance, 800)
  })

  test('restore 后再 applyPosting 行为正常', () => {
    const a = new Account({ id: 'cash', name: '现金', category: 'ASSET', openingBalance: 100 })
    const restored = Account.restore(a.toSnapshot())
    restored.applyPosting('debit', 50)
    assert.equal(restored.balance, 150)
  })
})
