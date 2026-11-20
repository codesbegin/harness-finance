import { readFileSync } from 'node:fs'
import { createFinanceHost } from './host.js'

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

const host = await createFinanceHost({ storage: 'memory' })
console.log(`harness-finance ${pkg.version}`)
console.log(`host: Cordis 4.1.0 + dsh-tools 0.2.2-rc.5`)
console.log(`tools (${host.tools.size}): ${[...host.tools.keys()].join(', ')}`)

const create = host.tools.get('create_account')
const cash = await create.execute({ name: '现金', category: 'asset' }, {})
const salary = await create.execute({ name: '工资', category: 'income' }, {})

const post = host.tools.get('post_entry')
const posted = await post.execute({
  description: '工资入账',
  postings: [
    { account_id: cash.account.id, direction: 'debit', amount: 5000 },
    { account_id: salary.account.id, direction: 'credit', amount: 5000 },
  ],
}, {})

const trial = host.tools.get('trial_balance')
const balance = await trial.execute({}, {})

console.log(JSON.stringify({ create_account: [cash, salary], post_entry: posted, trial_balance: balance }, null, 2))
await host.close()
