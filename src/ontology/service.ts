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

const NS = 'http://harness-finance.local/ontology#'
const RDF_TYPE = namedNode('http://www.w3.org/1999/02/22-rdf-syntax-ns#type')

const accountIri = (id: string) => namedNode(`${NS}acct-${id}`)
const entryIri = (id: string) => namedNode(`${NS}je-${id}`)
const postingIri = (id: string) => namedNode(`${NS}p-${id}`)

const shortName = (iri: string) => iri.startsWith(NS) ? iri.slice(NS.length) : iri

export interface OntologyConfig {
  /** 自定义 Turtle 文件路径（默认用内置 finance.ttl）。 */
  ontologyPath?: string
}

const DEFAULT_ONTOLOGY = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..', '..', 'ontology', 'finance.ttl',
)

// 账户类别对应节点颜色
const CATEGORY_COLORS: Record<string, string> = {
  AssetAccount: '#dcfce7',     // 绿
  ExpenseAccount: '#fee2e2',   // 红
  LiabilityAccount: '#fef3c7', // 黄
  EquityAccount: '#e0e7ff',     // 靛
  IncomeAccount: '#cffafe',    // 青
}

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

  // ---------- 远程查询方法 ----------

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

  /** 列出我们 namespace 下的所有类。 */
  listClasses(): string[] {
    return this.store.getQuads(null, RDF_TYPE, namedNode('http://www.w3.org/2002/07/owl#Class'), null)
      .map(q => q.subject.value)
      .filter(v => v.startsWith(NS))
  }

  // ---------- ABox 写入 ----------

  /**
   * 加入一个账户实例到 ABox。
   * 例如：addAccount('acct-1', 'ASSET') → 声明 acct-1 rdf:type AssetAccount。
   */
  addAccount(accountId: string, category: 'ASSET' | 'LIABILITY' | 'EQUITY' | 'INCOME' | 'EXPENSE'): void {
    const classMap: Record<string, string> = {
      ASSET: 'AssetAccount',
      LIABILITY: 'LiabilityAccount',
      EQUITY: 'EquityAccount',
      INCOME: 'IncomeAccount',
      EXPENSE: 'ExpenseAccount',
    }
    this.store.addQuad(quad(
      accountIri(accountId),
      RDF_TYPE,
      namedNode(`${NS}${classMap[category]}`),
    ))
  }

  /**
   * 加入一个分录实例到 ABox。
   * 声明 je-<id> rdf:type JournalEntry，并记录 description。
   * 返回分录的 IRI，供后续 linkPosting 用。
   */
  addJournalEntry(entryId: string, description: string): void {
    const subj = entryIri(entryId)
    this.store.addQuad(quad(subj, RDF_TYPE, namedNode(`${NS}JournalEntry`)))
    this.store.addQuad(quad(
      subj,
      namedNode(`${NS}hasDescription`),
      literal(description),
    ))
  }

  /**
   * 加入一个过账实例到 ABox，并关联到账户和分录。
   *
   * @param postingId  posting 实例 ID（如 'p-1'）
   * @param entryId    所属分录 ID（如 'je-1'）
   * @param accountId  影响的账户 ID（如 'acct-1'）
   * @param direction  'debit' | 'credit'
   * @param amount     金额（元，内部转成 minor units 存为整数）
   */
  addPosting(
    postingId: string,
    entryId: string,
    accountId: string,
    direction: 'debit' | 'credit',
    amount: number,
  ): void {
    const subj = postingIri(postingId)
    this.store.addQuad(quad(subj, RDF_TYPE, namedNode(`${NS}Posting`)))
    this.store.addQuad(quad(subj, namedNode(`${NS}hasDirection`), literal(direction)))
    // TBox 定义 hasAmount 为 xsd:nonNegativeInteger（分），这里把元转成分。
    this.store.addQuad(quad(
      subj,
      namedNode(`${NS}hasAmount`),
      literal(String(Math.round(amount * 100)), 'http://www.w3.org/2001/XMLSchema#nonNegativeInteger'),
    ))
    this.store.addQuad(quad(subj, namedNode(`${NS}affectsAccount`), accountIri(accountId)))
    // 关联分录 ↔ posting
    this.store.addQuad(quad(entryIri(entryId), namedNode(`${NS}hasPosting`), subj))
  }

  /**
   * 从 ABox 删除一个分录及其所有过账实例（用于过账回滚）。
   * 只删 ABox 实例，不删 TBox 类定义。
   */
  removeJournalEntry(entryId: string): void {
    const entrySubj = entryIri(entryId)
    // 找到该分录的所有 posting
    const postingQuads = this.store.getQuads(entrySubj, namedNode(`${NS}hasPosting`), null, null)
    for (const q of postingQuads) {
      const postingSubj = q.object
      // 删除 posting 的所有属性
      this.store.deleteQuads(postingSubj, null, null, null)
    }
    // 删除分录本身的所有属性
    this.store.deleteQuads(entrySubj, null, null, null)
  }

  // ---------- ABox 可视化 ----------

  /**
   * 把当前 ABox 实例导出成 Graphviz DOT。
   *
   * 节点：
   *   - 账户（按类别上色）：acct-xxx
   *   - 分录（圆角矩形）：je-xxx，label 带 description
   *   - 过账（菱形）：p-xxx，label 带 direction + 金额
   *
   * 边：
   *   - je-xxx -> p-xxx  (hasPosting)
   *   - p-xxx -> acct-xxx (affectsAccount)
   *
   * 渲染：dot -Tsvg abox.dot -o abox.svg
   */
  exportAboxDot(): string {
    // 收集 ABox 实例（我们 namespace 下、且不是 owl:Class 的）
    const accountNodes = new Map<string, { category: string }>()
    const entryNodes = new Map<string, { description: string }>()
    const postingNodes = new Map<string, { direction: string; amount: string; account: string; entry: string }>()

    // 账户：rdf:type 是我们 namespace 下的 *Account
    for (const q of this.store.getQuads(null, RDF_TYPE, null, null)) {
      if (!q.subject.value.startsWith(NS)) continue
      if (!q.object.value.startsWith(NS)) continue
      const cls = shortName(q.object.value)
      const subj = shortName(q.subject.value)
      if (cls.endsWith('Account') && subj.startsWith('acct-')) {
        accountNodes.set(subj, { category: cls })
      } else if (cls === 'JournalEntry' && subj.startsWith('je-')) {
        entryNodes.set(subj, { description: '' })
      } else if (cls === 'Posting' && subj.startsWith('p-')) {
        postingNodes.set(subj, { direction: '', amount: '', account: '', entry: '' })
      }
    }

    // 分录 description
    for (const q of this.store.getQuads(null, namedNode(`${NS}hasDescription`), null, null)) {
      const subj = shortName(q.subject.value)
      if (entryNodes.has(subj)) {
        entryNodes.get(subj)!.description = q.object.value
      }
    }

    // posting 的 direction / amount / account / 所属 entry
    for (const [postingId, node] of postingNodes) {
      const pSubj = namedNode(`${NS}${postingId}`)
      const dirObj = this.store.getObjects(pSubj, namedNode(`${NS}hasDirection`), null)
      const amtObj = this.store.getObjects(pSubj, namedNode(`${NS}hasAmount`), null)
      const acctObj = this.store.getObjects(pSubj, namedNode(`${NS}affectsAccount`), null)
      node.direction = dirObj[0]?.value ?? '?'
      // 分转元
      const cents = parseInt(amtObj[0]?.value ?? '0', 10)
      node.amount = (cents / 100).toFixed(2)
      node.account = acctObj[0] ? shortName(acctObj[0].value) : '?'
    }

    // 反向找 entry -> posting
    for (const q of this.store.getQuads(null, namedNode(`${NS}hasPosting`), null, null)) {
      const entryId = shortName(q.subject.value)
      const postingId = shortName(q.object.value)
      if (postingNodes.has(postingId)) {
        postingNodes.get(postingId)!.entry = entryId
      }
    }

    const lines: string[] = []
    lines.push('digraph ABox {')
    lines.push('  rankdir=LR;')
    lines.push('  node [fontname="Helvetica", fontsize=11];')
    lines.push('  edge [fontname="Helvetica", fontsize=9, color="#64748b"];')
    lines.push('')

    // 账户节点
    for (const [id, { category }] of accountNodes) {
      const color = CATEGORY_COLORS[category] ?? '#f1f5f9'
      lines.push(`  "${id}" [shape=box, style="rounded,filled", fillcolor="${color}", label="${id}\n(${category})"];`)
    }
    lines.push('')

    // 分录节点
    for (const [id, { description }] of entryNodes) {
      const label = description ? `${id}\n${description}` : id
      lines.push(`  "${id}" [shape=note, style="filled", fillcolor="#fff7ed"];`)
    }
    lines.push('')

    // posting 节点
    for (const [id, { direction, amount }] of postingNodes) {
      lines.push(`  "${id}" [shape=diamond, style="filled", fillcolor="#f3e8ff", label="${direction} ${amount}"];`)
    }
    lines.push('')

    // 边：entry -> posting
    for (const [postingId, { entry }] of postingNodes) {
      if (entry) lines.push(`  "${entry}" -> "${postingId}";`)
    }
    // 边：posting -> account
    for (const [postingId, { account }] of postingNodes) {
      if (account) lines.push(`  "${postingId}" -> "${account}";`)
    }

    lines.push('}')
    lines.push('')
    return lines.join('\n')
  }

  // ---------- 推理 ----------

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

  /** 当前 ABox 三元组数量（给 agent/调试用）。 */
  aboxSize(): number {
    // TBox 是启动时加载的，ABox 是运行时加的。粗略估算：总 size 减 TBox 不好算，
    // 直接返回 store.size，调用方知道语义即可。
    return this.store.size
  }

  /** 清理：terminate reasoner worker。 */
  dispose(): void {
    this.reasoner?.terminate()
    this.reasoner = null
  }
}

export default OntologyService
