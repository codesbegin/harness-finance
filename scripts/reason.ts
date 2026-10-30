/**
 * TBox 推理 CLI（开发时使用）。
 *
 * 用法：
 *   npx tsx scripts/reason.ts                               # 一致性检查 + 类层级
 *   npx tsx scripts/reason.ts --export-dot out.dot          # 导出 TBox 类层级图
 *   npx tsx scripts/reason.ts --abox sample.abox.json       # 加载示例 ABox 跑一致性
 *   npx tsx scripts/reason.ts --abox sample.abox.json --export-abox-dot abox.dot
 *
 * DOT 导出不需要 reasoner——直接从 N3 Store 读 quads。
 */

import { Store, Parser, DataFactory } from 'n3'
import { RdfReasoner } from 'rdf-reasoner-konclude'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const { namedNode, literal } = DataFactory

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const TBOX_PATH = path.join(__dirname, '..', 'ontology', 'finance.ttl')
const NS = 'http://harness-finance.local/ontology#'

const RDF_TYPE = namedNode('http://www.w3.org/1999/02/22-rdf-syntax-ns#type')
const RDFS_SUBCLASS = namedNode('http://www.w3.org/2000/01/rdf-schema#subClassOf')
const OWL_CLASS = namedNode('http://www.w3.org/2002/07/owl#Class')
const OWL_NOTHING = namedNode('http://www.w3.org/2002/07/owl#Nothing')

const shortName = (iri: string) => iri.startsWith(NS) ? iri.slice(NS.length) : iri

const CATEGORY_COLORS: Record<string, string> = {
  AssetAccount: '#dcfce7',
  ExpenseAccount: '#fee2e2',
  LiabilityAccount: '#fef3c7',
  EquityAccount: '#e0e7ff',
  IncomeAccount: '#cffafe',
}

interface CliArgs {
  tboxPath: string
  exportDot?: string
  exportAboxDot?: string
  aboxPath?: string
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2)
  const result: CliArgs = { tboxPath: TBOX_PATH }
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--export-dot' && args[i + 1]) result.exportDot = args[++i]
    else if (args[i] === '--export-abox-dot' && args[i + 1]) result.exportAboxDot = args[++i]
    else if (args[i] === '--abox' && args[i + 1]) result.aboxPath = args[++i]
    else if (args[i] === '--tbox' && args[i + 1]) result.tboxPath = args[++i]
  }
  return result
}

function loadTBox(store: Store, ttl: string): void {
  new Parser().parse(ttl, (err, q) => {
    if (err) throw err
    if (q) store.addQuad(q)
  })
}

/** 导出 TBox 类层级图。 */
function exportTboxDot(store: Store, outPath: string): void {
  const ourClasses = new Set<string>()
  for (const q of store.getQuads(null, RDF_TYPE, OWL_CLASS, null)) {
    if (q.subject.value.startsWith(NS)) ourClasses.add(q.subject.value)
  }
  const edges: Array<[string, string]> = []
  for (const q of store.getQuads(null, RDFS_SUBCLASS, null, null)) {
    if (!ourClasses.has(q.subject.value)) continue
    if (q.object.termType !== 'NamedNode') continue
    if (!ourClasses.has(q.object.value)) continue
    edges.push([q.subject.value, q.object.value])
  }
  const unsat = new Set<string>()
  for (const q of store.getQuads(null, namedNode('http://www.w3.org/2002/07/owl#equivalentClass'), OWL_NOTHING, null)) {
    if (q.subject.value.startsWith(NS)) unsat.add(q.subject.value)
  }

  const lines: string[] = [
    'digraph TBox {',
    '  rankdir=BT;',
    '  node [shape=box, style="rounded,filled", fillcolor="#eef2ff", fontname="Helvetica"];',
    '  edge [arrowhead=open, color="#64748b"];',
    '',
  ]
  for (const cls of ourClasses) {
    const name = shortName(cls)
    if (unsat.has(cls)) {
      lines.push(`  "${name}" [fillcolor="#fecaca", color="#dc2626", penwidth=2, label="${name}\\n(unsatisfiable)"];`)
    } else {
      lines.push(`  "${name}";`)
    }
  }
  lines.push('')
  for (const [child, parent] of edges) {
    lines.push(`  "${shortName(child)}" -> "${shortName(parent)}";`)
  }
  lines.push('}')
  fs.writeFileSync(outPath, lines.join('\n'), 'utf-8')
  console.log(`[reason] TBox DOT -> ${outPath} (${ourClasses.size} classes, ${edges.length} edges)`)
}

/** 导出 ABox 实例图（账户/分录/过账关系）。 */
function exportAboxDot(store: Store, outPath: string): void {
  const accounts = new Map<string, string>()  // id -> category class
  const entries = new Map<string, string>()   // id -> description
  const postings = new Map<string, { dir: string; amount: string; account: string }>()

  // 按类型分类
  for (const q of store.getQuads(null, RDF_TYPE, null, null)) {
    if (!q.subject.value.startsWith(NS) || !q.object.value.startsWith(NS)) continue
    const subj = shortName(q.subject.value)
    const cls = shortName(q.object.value)
    if (cls.endsWith('Account') && subj.startsWith('acct-')) accounts.set(subj, cls)
    else if (cls === 'JournalEntry' && subj.startsWith('je-')) entries.set(subj, '')
    else if (cls === 'Posting' && subj.startsWith('p-')) postings.set(subj, { dir: '', amount: '', account: '' })
  }

  // 分录 description
  for (const q of store.getQuads(null, namedNode(`${NS}hasDescription`), null, null)) {
    const subj = shortName(q.subject.value)
    if (entries.has(subj)) entries.set(subj, q.object.value)
  }

  // posting 属性
  for (const [pid] of postings) {
    const pSubj = namedNode(`${NS}${pid}`)
    const dir = store.getObjects(pSubj, namedNode(`${NS}hasDirection`), null)[0]?.value ?? '?'
    const cents = parseInt(store.getObjects(pSubj, namedNode(`${NS}hasAmount`), null)[0]?.value ?? '0', 10)
    const acct = store.getObjects(pSubj, namedNode(`${NS}affectsAccount`), null)[0]
    postings.get(pid)!.dir = dir
    postings.get(pid)!.amount = (cents / 100).toFixed(2)
    postings.get(pid)!.account = acct ? shortName(acct.value) : '?'
  }

  // entry -> posting 边
  const entryToPostings = new Map<string, string[]>()
  for (const q of store.getQuads(null, namedNode(`${NS}hasPosting`), null, null)) {
    const eid = shortName(q.subject.value)
    const pid = shortName(q.object.value)
    if (!entryToPostings.has(eid)) entryToPostings.set(eid, [])
    entryToPostings.get(eid)!.push(pid)
  }

  const lines: string[] = [
    'digraph ABox {',
    '  rankdir=LR;',
    '  node [fontname="Helvetica", fontsize=11];',
    '  edge [fontname="Helvetica", fontsize=9, color="#64748b"];',
    '',
  ]
  for (const [id, category] of accounts) {
    const color = CATEGORY_COLORS[category] ?? '#f1f5f9'
    lines.push(`  "${id}" [shape=box, style="rounded,filled", fillcolor="${color}", label="${id}\\n(${category})"];`)
  }
  lines.push('')
  for (const [id, desc] of entries) {
    lines.push(`  "${id}" [shape=note, style="filled", fillcolor="#fff7ed", label="${id}\\n${desc}"];`)
  }
  lines.push('')
  for (const [id, { dir, amount }] of postings) {
    lines.push(`  "${id}" [shape=diamond, style="filled", fillcolor="#f3e8ff", label="${dir} ${amount}"];`)
  }
  lines.push('')
  for (const [eid, pids] of entryToPostings) {
    for (const pid of pids) lines.push(`  "${eid}" -> "${pid}";`)
  }
  for (const [pid, { account }] of postings) {
    if (account) lines.push(`  "${pid}" -> "${account}";`)
  }
  lines.push('}')

  fs.writeFileSync(outPath, lines.join('\n'), 'utf-8')
  console.log(`[reason] ABox DOT -> ${outPath} (${accounts.size} accounts, ${entries.size} entries, ${postings.size} postings)`)
}

/** 从 JSON 加载 ABox 实例数据。 */
function loadAbox(store: Store, aboxPath: string): void {
  const json = JSON.parse(fs.readFileSync(aboxPath, 'utf-8'))
  const catClass: Record<string, string> = {
    ASSET: 'AssetAccount', LIABILITY: 'LiabilityAccount', EQUITY: 'EquityAccount',
    INCOME: 'IncomeAccount', EXPENSE: 'ExpenseAccount',
  }
  for (const acct of json.accounts ?? []) {
    store.addQuad(
      namedNode(`${NS}acct-${acct.id}`), RDF_TYPE, namedNode(`${NS}${catClass[acct.category]}`),
    )
  }
  for (const entry of json.entries ?? []) {
    const eSubj = namedNode(`${NS}je-${entry.id}`)
    store.addQuad(eSubj, RDF_TYPE, namedNode(`${NS}JournalEntry`))
    store.addQuad(eSubj, namedNode(`${NS}hasDescription`), literal(entry.description ?? ''))
    entry.postings?.forEach((p: any, i: number) => {
      const pSubj = namedNode(`${NS}p-${entry.id}-${i}`)
      store.addQuad(pSubj, RDF_TYPE, namedNode(`${NS}Posting`))
      store.addQuad(pSubj, namedNode(`${NS}hasDirection`), literal(p.direction))
      store.addQuad(pSubj, namedNode(`${NS}hasAmount`),
        literal(String(p.amount * 100), 'http://www.w3.org/2001/XMLSchema#nonNegativeInteger'))
      store.addQuad(pSubj, namedNode(`${NS}affectsAccount`), namedNode(`${NS}acct-${p.accountId}`))
      store.addQuad(eSubj, namedNode(`${NS}hasPosting`), pSubj)
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

  if (args.aboxPath) loadAbox(store, args.aboxPath)

  if (args.exportDot) exportTboxDot(store, args.exportDot)
  if (args.exportAboxDot) exportAboxDot(store, args.exportAboxDot)

  // 需要 reasoner 的部分
  console.log('[reason] initializing Konclude reasoner...')
  const reasoner = new RdfReasoner()
  await reasoner.ready

  console.log('\n=== Consistency Check ===')
  const consistent = await reasoner.checkConsistency(store)
  console.log(consistent ? '  ✅ consistent' : '  ❌ INCONSISTENT')

  console.log('\n=== Classes ===')
  for (const cls of store.getQuads(null, RDF_TYPE, OWL_CLASS, null)
    .map(q => q.subject.value).filter(v => v.startsWith(NS)).sort()) {
    console.log(`  - ${shortName(cls)}`)
  }

  reasoner.terminate()
  process.exit(consistent ? 0 : 1)
}

main().catch(err => {
  console.error('[reason] fatal:', err)
  process.exit(2)
})
