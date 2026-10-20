import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { FinanceService } from './service.js'
import { FinanceError } from './errors.js'

declare module '@deepseek-ai/cordis' {
  interface Context {
    finance: FinanceService
  }
}

export const name = 'tool-finance'
export const inject = ['finance', 'tools', 'systemPrompt'] as const

export interface Config {
  requireApprovalAbove?: number
}

export const Config: z<Config> = z.object({
  requireApprovalAbove: z.number().step(1).min(0).default(10000),
})

function serializeError(e: unknown): { isError: true; code: string; message: string } {
  if (e instanceof FinanceError) {
    return { isError: true, code: e.code, message: e.message }
  }
  return { isError: true, code: 'FINANCE_UNKNOWN', message: e instanceof Error ? e.message : String(e) }
}

function maxPostingAmount(postings: Array<{ amount: number }>): number {
  return postings.reduce((m, p) => Math.max(m, Number(p.amount) || 0), 0)
}

export function apply(ctx: Context, config: Config): void {
  const threshold = config.requireApprovalAbove ?? 10000

  ctx.systemPrompt.section({
    name: 'tool:finance',
    order: 50,
    text: 'finance tools are backed by a double-entry ledger. Every post_entry must balance (debit == credit). '
      + 'Unknown account errors mean you must create_account first. Unbalanced entry errors mean the postings do not sum to zero. '
      + 'If post_entry returns needsApproval=true, stop and ask the human to confirm; retry with approved=true only after explicit consent.',
  })

  ctx.tools.register(defineTool({
    name: 'create_account',
    description: 'Create a new ledger account. category must be one of: asset / liability / equity / income / expense.',
    parameters: {
      name: { type: 'string', required: true, description: 'Human-readable account name, e.g. Office Supplies.' },
      category: {
        type: 'string',
        required: true,
        enum: ['asset', 'liability', 'equity', 'income', 'expense'],
        description: 'Ledger category; determines normal balance side.',
      },
      opening_balance: { type: 'number', description: 'Optional opening balance in minor units.' },
    },
    output: { schema: {}, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    execute(args) {
      try {
        const acc = ctx.finance.createAccount({
          name: args.name,
          category: args.category as 'asset' | 'liability' | 'equity' | 'income' | 'expense',
          ...args.opening_balance === undefined ? {} : { openingBalance: args.opening_balance },
        })
        return Promise.resolve({ ok: true, account: { id: acc.id, name: acc.name, category: acc.category } })
      } catch (e) {
        return Promise.resolve(serializeError(e))
      }
    },
    presentCall: args => ({ card: 'generic', title: 'Create account', kind: 'other', rawInput: args.name }),
  }))

  ctx.tools.register(defineTool({
    name: 'list_accounts',
    description: 'List all accounts in the current ledger with their current balances.',
    parameters: {},
    output: { schema: {}, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    execute() {
      return Promise.resolve({ ok: true, accounts: ctx.finance.listAccounts() })
    },
    presentCall: () => ({ card: 'generic', title: 'List accounts', kind: 'read' }),
  }))

  ctx.tools.register(defineTool({
    name: 'post_entry',
    description: 'Post a journal entry with balanced debit/credit postings. Amounts in minor units (e.g. cents).',
    parameters: {
      description: { type: 'string', required: true, description: 'What this entry is for.' },
      postings: {
        type: 'array',
        required: true,
        description: 'List of { account_id, direction: debit|credit, amount } objects.',
      },
      approved: {
        type: 'boolean',
        description: 'Set true only after a human explicitly approved this entry. Required when the largest posting exceeds the approval threshold.',
      },
    },
    output: { schema: {}, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    execute(args) {
      const postings = (args.postings as Array<{ account_id: string; direction: 'debit' | 'credit'; amount: number }>)
        .map(p => ({ accountId: p.account_id, direction: p.direction, amount: p.amount }))
      const maxAmount = maxPostingAmount(postings)

      if (maxAmount > threshold && !args.approved) {
        return Promise.resolve({
          ok: false,
          needsApproval: true,
          code: 'FINANCE_APPROVAL_REQUIRED',
          maxAmount,
          threshold,
          message: `Largest posting ${maxAmount} exceeds threshold ${threshold}. Ask the human to confirm, then retry with approved=true.`,
        })
      }

      try {
        const result = ctx.finance.postEntry({ description: args.description, postings })
        return Promise.resolve({ ok: true, ...result, ...args.approved ? { approvedBy: 'human' } : {} })
      } catch (e) {
        return Promise.resolve(serializeError(e))
      }
    },
    presentCall: args => ({ card: 'generic', title: 'Post entry', kind: 'other', rawInput: args.description }),
  }))

  ctx.tools.register(defineTool({
    name: 'trial_balance',
    description: 'Get trial balance by account category; balanced=true means debits == credits.',
    parameters: {},
    output: { schema: {}, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    execute() {
      return Promise.resolve({ ok: true, ...ctx.finance.trialBalance() })
    },
    presentCall: () => ({ card: 'generic', title: 'Trial balance', kind: 'read' }),
  }))
}

export default { name, inject, Config, apply }
