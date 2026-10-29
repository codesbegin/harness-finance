/**
 * TBox 推理 CLI（开发时使用）。
 *
 * 用法：
 *   npx tsx scripts/reason.ts                      # 一致性检查 + 类层级
 *   npx tsx scripts/reason.ts --export-dot out.dot  # 导出 Graphviz DOT 类层级图
 *   npx tsx scripts/reason.ts --abox sample.abox.json  # 加载示例 ABox 跑一致性
 *
 * DOT 导出不需要 reasoner——直接从 TBox quads 读 rdfs:subClassOf 关系。
 * 生成的 out.dot 可以用 `dot -Tsvg out.dot -o out.svg` 渲染成图。
 */

import { Store, Parser, DataFactory } from 'n3'
import { RdfReasoner } from 'rdf-reasoner-konclude'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const { namedNode } = DataFactory

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const TBOX_PATH = path.join(__dirname, '..', 'ontology', 'finance.ttl')
const NS = 'http://harness-finance.local/ontology#'

const RDF_TYPE = namedNode('http://www.w3.org/1999/02/22-rdf-syntax-ns#type')
const RDFS_SUBCLASS = namedNode('http://www.w3.org/2000/01/rdf-schema#subClassOf')
const OWL_CLASS = namedNode('http://www.w3.org/2002/07/owl#Class')
const OWL_NOTHING = namedNode('http://www.w3.org/2002/07/owl#Nothing')

interface CliArgs {
  tboxPath: string
  exportDot?: string
  aboxPath?: string
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2)
  const result: CliArgs = { tboxPath: TBOX_PATH }
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--export-dot' && args[i + 1]) {
      result.exportDot = args[++i]
    } else if (args[i] === '--abox' && args[i + 1]) {
      result.aboxPath = args[++i]
    } else if (args[i] === '--tbox' && args[i + 1]) {
      result.tboxPath = args[++i]
    }
  }
  return result
}

function loadTBox(store: Store, ttl: string): void {
  const parser = new Parser()
  parser.parse(ttl, (err, q) => {
    if (err) throw err
    if (q) store.addQuad(q)
  })
}

/**
 * 把 TBox 的 rdfs:subClassOf 关系导出成 Graphviz DOT。
 *
 * 只画我们 namespace 下的类，外部类（owl:Thing、FIBO 映射）不画。
 * 不可满足类（子类等价于 owl:Nothing）标红色。
 */
function exportDot(store: Store, outPath: string): void {
  // 收集我们 namespace 下所有类
  const ourClasses = new Set<string>()
  for (const q of store.getQuads(null, RDF_TYPE, OWL_CLASS, null)) {
    if (q.subject.value.startsWith(NS)) ourClasses.add(q.subject.value)
  }

  // 收集 subClassOf 边（只在我们 namespace 内部连边）
  const edges: Array<[string, string]> = []
  for (const q of store.getQuads(null, RDFS_SUBCLASS, null, null)) {
    if (!ourClasses.has(q.subject.value)) continue
    // object 是匿名 class expression（intersectionOf 等）时跳过
    if (q.object.termType !== 'NamedNode') continue
    if (!ourClasses.has(q.object.value)) continue
    edges.push([q.subject.value, q.object.value])
  }

  // 收集不可满足类（被声明为 equivalentTo Nothing 的）
  const unsat = new Set<string>()
  for (const q of store.getQuads(null, namedNode('http://www.w3.org/2002/07/owl#equivalentClass'), OWL_NOTHING, null)) {
    if (q.subject.value.startsWith(NS)) unsat.add(q.subject.value)
  }

  const shortName = (iri: string) => iri.replace(NS, '')

  const lines: string[] = []
  lines.push('digraph TBox {')
  lines.push('  rankdir=BT;')
  lines.push('  node [shape=box, style="rounded,filled", fillcolor="#eef2ff", fontname="Helvetica"];')
  lines.push('  edge [arrowhead=open, color="#64748b"];')
  lines.push('')

  for (const cls of ourClasses) {
    const name = shortName(cls)
    if (unsat.has(cls)) {
      lines.push(`  "${name}" [fillcolor="#fecaca", color="#dc2626", penwidth=2, label="${name}\n(unsatisfiable)"];`)
    } else {
      lines.push(`  "${name}";`)
    }
  }
  lines.push('')

  for (const [child, parent] of edges) {
    lines.push(`  "${shortName(child)}" -> "${shortName(parent)}";`)
  }

  lines.push('}')
  lines.push('')

  fs.writeFileSync(outPath, lines.join('\n'), 'utf-8')
  console.log(`[reason] DOT exported to ${outPath} (${ourClasses.size} classes, ${edges.length} edges)`) 
}

/**
 * 从 JSON 文件加载 ABox 数据。
 *
 * 格式示例：
 * {
 *   "accounts": [{ "id": "cash", "category": "ASSET" }],
 *   "entries": [{ "id": "je-1", "description": "付房租", "postings": [
 *     { "accountId": "rent", "direction": "debit", "amount": 30 },
 *     { "accountId": "cash", "direction": "credit", "amount": 30 }
 *   ]}]
 * }
 */
function loadAbox(store: Store, aboxPath: string): void {
  const json = JSON.parse(fs.readFileSync(aboxPath, 'utf-8'))
  const categoryClass: Record<string, string> = {
    ASSET: 'AssetAccount',
    LIABILITY: 'LiabilityAccount',
    EQUITY: 'EquityAccount',
    INCOME: 'IncomeAccount',
    EXPENSE: 'ExpenseAccount',
  }

  for (const acct of json.accounts ?? []) {
    store.addQuad(
      namedNode(`${NS}acct-${acct.id}`),
      RDF_TYPE,
      namedNode(`${NS}${categoryClass[acct.category]}`),
    )
  }

  for (const entry of json.entries ?? []) {
    const entrySubj = namedNode(`${NS}je-${entry.id}`)
    store.addQuad(entrySubj, RDF_TYPE, namedNode(`${NS}JournalEntry`))
    store.addQuad(entrySubj, namedNode(`${NS}hasDescription`), 
      DataFactory.literal(entry.description ?? ''))

    entry.postings?.forEach((p: any, i: number) => {
      const pSubj = namedNode(`${NS}p-${entry.id}-${i}`)
      store.addQuad(pSubj, RDF_TYPE, namedNode(`${NS}Posting`))
      store.addQuad(pSubj, namedNode(`${NS}hasDirection`), DataFactory.literal(p.direction))
      store.addQuad(pSubj, namedNode(`${NS}hasAmount`), 
        DataFactory.literal(String(p.amount * 100), 'http://www.w3.org/2001/XMLSchema#nonNegativeInteger'))
      store.addQuad(pSubj, namedNode(`${NS}affectsAccount`), namedNode(`${NS}acct-${p.accountId}`))
      store.addQuad(entrySubj, namedNode(`${NS}hasPosting`), pSubj)
    })
  }

  console.log(`[reason] ABox loaded from ${aboxPath}: ${store.size} total triples`)
}

async function main(): Promise<void> {
  const args = parseArgs()
  console.log(`[reason] loading TBox from ${args.tboxPath}`)

  const store = new Store()
  loadTBox(store, fs.readFileSync(args.tboxPath, 'utf-8'))
  console.log(`[reason] TBox: ${store.size} triples`)

  if (args.aboxPath) {
    loadAbox(store, args.aboxPath)
  }

  // DOT 导出（不需要 reasoner）
  if (args.exportDot) {
    exportDot(store, args.exportDot)
  }

  // 以下需要 Konclude reasoner
  console.log('[reason] initializing Konclude reasoner...')
  const reasoner = new RdfReasoner()
  await reasoner.ready

  console.log('\n=== Consistency Check ===')
  const consistent = await reasoner.checkConsistency(store)
  console.log(consistent ? '  ✅ consistent' : '  ❌ INCONSISTENT')

  // 列我们 namespace 下的类
  console.log('\n=== Classes ===')
  const ourClasses = store.getQuads(null, RDF_TYPE, OWL_CLASS, null)
    .map(q => q.subject.value)
    .filter(v => v.startsWith(NS))
    .sort()
  for (const cls of ourClasses) {
    console.log(`  - ${cls.replace(NS, '')}`)
  }

  reasoner.terminate()
  process.exit(consistent ? 0 : 1)
}

main().catch(err => {
  console.error('[reason] fatal:', err)
  process.exit(2)
})
