/**
 * OntologyService — 本体加载与推理层。
 *
 * 持有一个 N3 Store，启动时加载 ontology/finance.ttl（TBox）。
 * ABox（用户的账户、分录实例）在运行时动态加入 Store。
 *
 * 推理能力由 rdf-reasoner-konclude（OWL 2 DL tableau，WASM）提供：
 *   - classify()     类层级分类
 *   - isEntailed()   蕴涵查询（给定一个三元组，判断是否被本体蕴含）
 *   - explain()      解释为什么某个三元组被蕴含
 *   - checkConsistency()  检查 ABox 是否矛盾
 *
 * reasoner 是 lazy 初始化的——第一次调用推理方法时才 new RdfReasoner()，
 * 避免冷启动慢。
 */

import { Context } from '@deepseek-ai/cordis'
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import s from '@deepseek-ai/schemastery'
import { Store, Parser, DataFactory } from 'n3'
import { RdfReasoner, INFERRED_GRAPH_IRI } from 'rdf-reasoner-konclude'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

declare module '@deepseek-ai/cordis' {
  interface Context {
    ontology: OntologyService
  }
}

const { namedNode, literal, quad } = DataFactory

export interface OntologyConfig {
  /** 自定义 Turtle 文件路径（默认用内置 finance.ttl）。 */
  ontologyPath?: string
}

const DEFAULT_ONTOLOGY = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..', '..', 'ontology', 'finance.ttl',
)

export class OntologyService extends TypertRemoteService {
  static inject = [] as const

  static Config: s<OntologyConfig> = s.object({
    ontologyPath: s.string().optional(),
  })

  private readonly store: Store
  private reasoner: RdfReasoner | null = null
  private readonly ttlPath: string

  constructor(ctx: Context, config: OntologyConfig = {}) {
    super(ctx, 'ontology')
    this.store = new Store()
    this.ttlPath = config.ontologyPath ?? DEFAULT_ONTOLOGY
    this.loadTBox()
  }

  /** 加载 TBox（finance.ttl）到 Store。 */
  private loadTBox(): void {
    const ttl = fs.readFileSync(this.ttlPath, 'utf-8')
    const parser = new Parser()
    parser.parse(ttl, (err, q) => {
      if (err) throw new Error(`failed to parse ontology: ${err.message}`)
      if (q) this.store.addQuad(q)
    })
  }

  /** 确保 reasoner 已初始化（lazy）。 */
  private async getReasoner(): Promise<RdfReasoner> {
    if (!this.reasoner) {
      this.reasoner = new RdfReasoner()
      await this.reasoner.ready
    }
    return this.reasoner
  }

  // ---------- 远程方法 ----------

  /** 查询某个概念的 label 和 comment（给 agent 读）。 */
  queryConcept(iri: string): { iri: string; label: string | null; comment: string | null } {
    const subj = namedNode(iri)
    const labels = this.store.getObjects(subj, namedNode('http://www.w3.org/2000/01/rdf-schema#label'), null)
    const comments = this.store.getObjects(subj, namedNode('http://www.w3.org/2000/01/rdf-schema#comment'), null)
    return {
      iri,
      label: labels[0]?.value ?? null,
      comment: comments[0]?.value ?? null,
    }
  }

  /** 列出所有顶层类（给 agent 看本体结构）。 */
  listClasses(): string[] {
    return this.store.getQuads(null, namedNode('http://www.w3.org/1999/02/22-rdf-syntax-ns#type'), namedNode('http://www.w3.org/2002/07/owl#Class'), null)
      .map(q => q.subject.value)
      .filter(v => v.startsWith('http://harness-finance.local/ontology#'))
  }

  /**
   * 加入一个账户实例到 ABox。
   * 例如：addAccount('acct-1', 'ASSET') → 声明 acct-1 rdf:type AssetAccount。
   */
  addAccount(accountId: string, category: 'ASSET' | 'LIABILITY' | 'EQUITY' | 'INCOME' | 'EXPENSE'): void {
    const iri = `http://harness-finance.local/ontology#acct-${accountId}`
    const classMap: Record<string, string> = {
      ASSET: 'AssetAccount',
      LIABILITY: 'LiabilityAccount',
      EQUITY: 'EquityAccount',
      INCOME: 'IncomeAccount',
      EXPENSE: 'ExpenseAccount',
    }
    this.store.addQuad(quad(
      namedNode(iri),
      namedNode('http://www.w3.org/1999/02/22-rdf-syntax-ns#type'),
      namedNode(`http://harness-finance.local/ontology#${classMap[category]}`),
    ))
  }

  /** 推理：给定一个三元组是否被本体蕴含。 */
  async isEntailed(subject: string, predicate: string, object: string): Promise<boolean | null> {
    const reasoner = await this.getReasoner()
    const q = quad(namedNode(subject), namedNode(predicate), namedNode(object))
    return reasoner.isEntailed(this.store, q)
  }

  /** 推理：检查当前 Store 是否一致。 */
  async checkConsistency(): Promise<boolean> {
    const reasoner = await this.getReasoner()
    return reasoner.checkConsistency(this.store)
  }

  /** 推理：解释为什么某个三元组被蕴含。 */
  async explain(subject: string, predicate: string, object: string): Promise<string[][]> {
    const reasoner = await this.getReasoner()
    const q = quad(namedNode(subject), namedNode(predicate), namedNode(object))
    return reasoner.explain(this.store, q)
  }

  /** 清理：terminate reasoner worker。 */
  dispose(): void {
    this.reasoner?.terminate()
    this.reasoner = null
  }
}

export default OntologyService
