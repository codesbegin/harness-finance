import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { createFinanceHost } from '../scripts/host.js'

describe('完整宿主', () => {
  test('插件装进真实 Cordis 后 9 个工具可用，post_entry 返回完整结果', async () => {
    const host = await createFinanceHost({ storage: 'memory' })
    try {
      assert.equal(host.tools.size, 9)
      assert.deepEqual([...host.tools.keys()].sort(), [
        'create_account', 'get_entry', 'ledger_summary', 'list_accounts',
        'list_entries', 'post_entry', 'search_entries', 'trial_balance',
        'trial_balance_detail',
      ])

      const create = host.tools.get('create_account')
      const cash = await create.execute({ name: '现金', category: 'asset' }, {})
      const salary = await create.execute({ name: '工资', category: 'income' }, {})
      assert.equal(cash.account.category, 'ASSET')
      assert.equal(salary.account.category, 'INCOME')

      const post = host.tools.get('post_entry')
      const posted = await post.execute({
        description: '工资入账',
        postings: [
          { account_id: cash.account.id, direction: 'debit', amount: 5000 },
          { account_id: salary.account.id, direction: 'credit', amount: 5000 },
        ],
      }, {})
      assert.equal(posted.ok, true)
      assert.match(posted.id, /^je-/)
      assert.equal(posted.status, 'POSTED')
      assert.equal(posted.totalDebit, 5000)
      assert.equal(posted.totalCredit, 5000)

      const summary = host.ctx.finance.ledgerSummary()
      assert.equal(summary.ontology.accounts.total, 2)
      assert.equal(summary.ontology.entries, 1)
      assert.equal(summary.ontology.postings.total, 2)
      assert.equal(summary.ontology.postings.balanced, true)
    } finally {
      await host.close()
    }
  })
})
