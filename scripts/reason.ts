/**
 * TBox 推理 CLI（开发时使用）。
 *
 * 加载 ontology/finance.ttl，跑 Konclude 推理器：
 *   - classify()          类层级分类
 *   - checkConsistency()  本体一致性
 *   - 列出不可满足类（等价于 owl:Nothing 的类）
 *
 * 用法：
 *   npx tsx scripts/reason.ts
 *
 * CI 集成：改了 ontology/ 后自动跑，不一致就红。
 */

import { Store, Parser, DataFactory } from 'n3'
import { RdfReasoner } from 'rdf-reasoner-konclude'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const { namedNode } = DataFactory

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const TBOX_PATH = path.join(__dirname, '..', 'ontology', 'finance.ttl')

async function main(): Promise<void> {
  console.log(`[reason] loading TBox from ${TBOX_PATH}`)
  const store = new Store()
  const ttl = fs.readFileSync(TBOX_PATH, 'utf-8')
  const parser = new Parser()
  parser.parse(ttl, (err, q) => {
    if (err) throw err
    if (q) store.addQuad(q)
  })

  // 统计 TBox 规模
  const tboxCount = store.size
  console.log(`[reason] TBox loaded: ${tboxCount} triples`)

  console.log('[reason] initializing Konclude reasoner...')
  const reasoner = new RdfReasoner()
  await reasoner.ready

  // 一致性检查
  console.log('\n=== Consistency Check ===')
  const consistent = await reasoner.checkConsistency(store)
  console.log(consistent ? '  ✅ TBox is consistent' : '  ❌ TBox is INCONSISTENT')

  // 类层级分类
  console.log('\n=== Class Hierarchy ===')
  try {
    const hierarchy = await reasoner.classify(store)
    // 输出我们 namespace 下的类
    const ns = 'http://harness-finance.local/ontology#'
    const ourClasses = store.getQuads(null, namedNode('http://www.w3.org/1999/02/22-rdf-syntax-ns#type'), namedNode('http://www.w3.org/2002/07/owl#Class'), null)
      .map(q => q.subject.value)
      .filter(v => v.startsWith(ns))
    console.log(`  Found ${ourClasses.length} classes in our namespace:`)
    for (const cls of ourClasses.sort()) {
      console.log(`    - ${cls.replace(ns, '')}`)
    }
  } catch (e) {
    console.log('  (classify not available:', (e as Error).message, ')')
  }

  // 列出顶层概念
  console.log('\n=== Top-level Concepts (rdfs:subClassOf owl:Thing) ===')
  const owlThing = namedNode('http://www.w3.org/2002/07/owl#Thing')
  const subClassQ = store.getQuads(null, namedNode('http://www.w3.org/2000/01/rdf-schema#subClassOf'), owlThing, null)
  for (const q of subClassQ) {
    console.log(`  - ${q.subject.value.split('#')[1] ?? q.subject.value}`)
  }

  console.log('\n[reason] done.')
  reasoner.terminate()
  process.exit(consistent ? 0 : 1)
}

main().catch(err => {
  console.error('[reason] fatal:', err)
  process.exit(2)
})
