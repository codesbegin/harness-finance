import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRegistry from '@deepseek-ai/dsh-tools'
import OntologyService from '../src/ontology/service.js'
import FinanceService from '../src/service.js'
import toolPlugin from '../src/tool.js'

export interface FinanceHostOptions {
  storage?: 'memory' | 'sqlite'
  dbPath?: string
  ontologyPath?: string
  requireApprovalAbove?: number
}

export interface FinanceHost {
  ctx: Context
  tools: Map<string, any>
  close(): Promise<void>
}

/**
 * 启动一个真实的 Cordis 宿主，并把 harness-finance 作为插件装进去。
 *
 * 这不是 mock：SystemPrompt / ToolRegistry / OntologyService / FinanceService
 * 都是真实实现，9 个工具走真实的 defineTool 注册与参数校验。
 */
export async function createFinanceHost(options: FinanceHostOptions = {}): Promise<FinanceHost> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRegistry)

  const tools = new Map<string, any>()
  const register = ctx.tools.register.bind(ctx.tools)
  ctx.tools.register = ((definition: any) => {
    tools.set(definition.name, definition)
    return register(definition)
  }) as typeof ctx.tools.register

  await ctx.plugin(OntologyService, options.ontologyPath ? { ontologyPath: options.ontologyPath } : {})
  await ctx.plugin(FinanceService, {
    storage: options.storage ?? 'memory',
    ...options.dbPath ? { dbPath: options.dbPath } : {},
  })
  await ctx.plugin(toolPlugin, { requireApprovalAbove: options.requireApprovalAbove ?? 10000 })

  return {
    ctx,
    tools,
    async close() {
      ctx.ontology.dispose()
      await ctx.fiber.dispose()
    },
  }
}
