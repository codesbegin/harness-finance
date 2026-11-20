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

function serializeError(e: unknown): { isError: true; code: string; message: string; explain?: string[][] } {
  if (e instanceof FinanceError) {
    return { isError: true, code: e.code, message: e.message, explain: e.explain }
  }
  return { isError: true, code: 'FINANCE_UNKNOWN', message: e instanceof Error ? e.message : String(e) }
}

const v = {
  bool: { type: 'boolean' } as const,
  str: { type: 'string' } as const,
  num: { type: 'number' } as const,
  obj: (properties: Record<string, unknown>) => ({ type: 'object', properties, additionalProperties: false }) as const,
  arr: (items: unknown) => ({ type: 'array', items }) as const,
  record: (_value: unknown) => ({ type: 'object', additionalProperties: true }) as const,
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
      + 'If post_entry returns needsApproval=true, stop and ask the human to confirm; retry with approved=true only after explicit consent. '
      + 'If post_entry returns FINANCE_ONTOLOGY_INCONSISTENT, the entry violated ontology constraints — read the explain field for details, '
      + 'do NOT retry blindly; figure out which account is wrong and ask the human. '
      + 'Use ledger_summary first when the user asks an open-ended question like "how are my finances doing?" — it returns account counts, '
      + 'total debit/credit, and per-account balances in one call.',
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
    output: {
      schema: v.obj({
        ok: v.bool,
        account: v.obj({ id: v.str, name: v.str, category: v.str }),
        isError: v.bool,
        code: v.str,
        message: v.str,
      }),
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    execute(args) {
      try {
        const acc = ctx.finance.createAccount({
          name: args.name,
          category: args.category.toUpperCase() as 'ASSET' | 'LIABILITY' | 'EQUITY' | 'INCOME' | 'EXPENSE',
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
    output: {
      schema: v.obj({
        ok: v.bool,
        accounts: v.arr(v.obj({
          id: v.str, name: v.str, category: v.str, balance: v.num,
        })),
      }),
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    execute() {
      return Promise.resolve({ ok: true, accounts: ctx.finance.listAccounts() })
    },
    presentCall: () => ({ card: 'generic', title: 'List accounts', kind: 'read' }),
  }))

  ctx.tools.register(defineTool({
    name: 'ledger_summary',
    description: 'One-shot overview of the ledger: ABox triple count, account totals by category, entry/posting counts, total debit/credit (and whether the ABox data layer is balanced), and per-account balances. Use this first for open-ended questions like "how are my finances?" or "what is my net position?".',
    parameters: {},
    output: {
      schema: v.obj({
        ok: v.bool,
        ledger: v.str,
        ontology: v.obj({
          totalTriples: v.num,
          accounts: v.obj({ total: v.num, byCategory: v.record(v.num) }),
          entries: v.num,
          postings: v.obj({ total: v.num, totalDebit: v.num, totalCredit: v.num, balanced: v.bool }),
        }),
        accounts: v.arr(v.obj({
          id: v.str, name: v.str, category: v.str, balance: v.num,
        })),
      }),
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    execute() {
      return Promise.resolve({ ok: true, ...ctx.finance.ledgerSummary() })
    },
    presentCall: () => ({ card: 'generic', title: 'Ledger summary', kind: 'read' }),
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
    output: {
      schema: v.obj({
        ok: v.bool,
        id: v.str,
        status: v.str,
        totalDebit: v.num,
        totalCredit: v.num,
        needsApproval: v.bool,
        maxAmount: v.num,
        threshold: v.num,
        isError: v.bool,
        code: v.str,
        message: v.str,
        explain: v.arr(v.arr(v.str)),
      }),
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args) {
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
        const result = await ctx.finance.postEntry({ description: args.description, postings })
        return Promise.resolve({ ok: true, ...result, ...args.approved ? { approvedBy: 'human' } : {} })
      } catch (e) {
        return Promise.resolve(serializeError(e))
      }
    },
    presentCall: args => ({ card: 'generic', title: 'Post entry', kind: 'other', rawInput: args.description }),
  }))

  ctx.tools.register(defineTool({
    name: 'trial_balance',
    description: 'Get trial balance summarized by account category. Use trial_balance_detail for per-account breakdown.',
    parameters: {},
    output: {
      schema: v.obj({
        ok: v.bool,
        byCategory: v.arr(v.obj({
          category: v.str, debit: v.num, credit: v.num,
        })),
        totalDebit: v.num,
        totalCredit: v.num,
        balanced: v.bool,
      }),
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    execute() {
      return Promise.resolve({ ok: true, ...ctx.finance.trialBalance() })
    },
    presentCall: () => ({ card: 'generic', title: 'Trial balance', kind: 'read' }),
  }))

  ctx.tools.register(defineTool({
    name: 'trial_balance_detail',
    description: 'Per-account trial balance with signed balance. Use this to answer questions like "how much cash do I have?" or "what is my credit card debt?".',
    parameters: {},
    output: {
      schema: v.obj({
        ok: v.bool,
        accounts: v.arr(v.obj({
          accountId: v.str,
          accountName: v.str,
          category: v.str,
          normalBalance: v.str,
          balance: v.num,
          signedBalance: v.num,
        })),
      }),
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    execute() {
      return Promise.resolve({ ok: true, accounts: ctx.finance.trialBalanceDetail() })
    },
    presentCall: () => ({ card: 'generic', title: 'Trial balance detail', kind: 'read' }),
  }))

  ctx.tools.register(defineTool({
    name: 'list_entries',
    description: 'List recent journal entries (newest first). Use this to answer "what did we record recently?".',
    parameters: {
      limit: { type: 'number', description: 'Max entries to return (default 20).' },
    },
    output: {
      schema: v.obj({
        ok: v.bool,
        entries: v.arr(v.obj({
          id: v.str,
          description: v.str,
          status: v.str,
          totalDebit: v.num,
          totalCredit: v.num,
          postingCount: v.num,
        })),
      }),
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    execute(args) {
      const limit = typeof args.limit === 'number' && args.limit > 0 ? args.limit : 20
      return Promise.resolve({ ok: true, entries: ctx.finance.listEntries(limit) })
    },
    presentCall: () => ({ card: 'generic', title: 'List entries', kind: 'read' }),
  }))

  ctx.tools.register(defineTool({
    name: 'search_entries',
    description: 'Search journal entries by keyword, account, category, status, or minimum amount. Use this to answer questions like "how much did we spend on office supplies?" or "show all large cash transactions".',
    parameters: {
      description: { type: 'string', description: 'Keyword to match in entry description (case-insensitive).' },
      account_id: { type: 'string', description: 'Only entries involving this account.' },
      category: {
        type: 'string',
        enum: ['asset', 'liability', 'equity', 'income', 'expense'],
        description: 'Only entries involving accounts of this category.',
      },
      status: { type: 'string', description: 'Filter by entry status (DRAFT / POSTED / LOCKED / REJECTED).' },
      min_amount: { type: 'number', description: 'Only entries with totalDebit >= this value (minor units).' },
      limit: { type: 'number', description: 'Max results to return (default 50).' },
    },
    output: {
      schema: v.obj({
        ok: v.bool,
        entries: v.arr(v.obj({
          id: v.str,
          description: v.str,
          status: v.str,
          totalDebit: v.num,
          totalCredit: v.num,
          postingCount: v.num,
        })),
      }),
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    execute(args) {
      return Promise.resolve({
        ok: true,
        entries: ctx.finance.searchEntries({
          ...args.description ? { description: args.description } : {},
          ...args.account_id ? { accountId: args.account_id } : {},
          ...args.category ? { category: args.category.toUpperCase() as 'ASSET' | 'LIABILITY' | 'EQUITY' | 'INCOME' | 'EXPENSE' } : {},
          ...args.status ? { status: args.status } : {},
          ...args.min_amount !== undefined ? { minAmount: args.min_amount } : {},
          ...args.limit !== undefined ? { limit: args.limit } : {},
        }),
      })
    },
    presentCall: () => ({ card: 'generic', title: 'Search entries', kind: 'read' }),
  }))

  ctx.tools.register(defineTool({
    name: 'get_entry',
    description: 'Get full detail of one journal entry, including all postings. Use this to answer "what exactly was spent on X?".',
    parameters: {
      entry_id: { type: 'string', required: true, description: 'Entry ID from list_entries.' },
    },
    output: {
      schema: v.obj({
        ok: v.bool,
        entry: v.obj({
          id: v.str,
          description: v.str,
          status: v.str,
          totalDebit: v.num,
          totalCredit: v.num,
          postingCount: v.num,
          postings: v.arr(v.obj({
            accountId: v.str,
            accountName: v.str,
            category: v.str,
            direction: v.str,
            amount: v.num,
          })),
        }),
        isError: v.bool,
        code: v.str,
        message: v.str,
      }),
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    execute(args) {
      try {
        const detail = ctx.finance.getEntry(args.entry_id)
        return Promise.resolve({ ok: true, entry: detail })
      } catch (e) {
        return Promise.resolve(serializeError(e))
      }
    },
    presentCall: args => ({ card: 'generic', title: 'Get entry', kind: 'read', rawInput: args.entry_id }),
  }))
}

export default { name, inject, Config, apply }
