# FIBO 接入策略

## 背景

FIBO（Financial Industry Business Ontology，OMG 标准）是金融行业的事实标准本体：

- 129,990 triples
- 3,371 classes
- 覆盖会计、银行、证券、衍生品、贷款、基金等
- Turtle 格式，开源（edmcouncil/fibo）

我们当前的 `ontology/finance.ttl` 是手写的最小 TBox（5 个账户类别 + JournalEntry + Posting + 不相交公理），约 50 triples。

## 问题

直接把整个 FIBO 塞进 N3 Store 会有三个问题：

1. **冷启动慢**：Konclude WASM reasoner 要对 13 万 triples 做分类，启动时间从毫秒级涨到秒级甚至更久。
2. **推理噪声**：FIBO 里有大量我们用不到的类（SWAP 合约、MBS 债券、ISDA 主协议），分类结果会把这些都带出来，agent 看到的 `isEntailed()` 结果充满无关信息。
3. **版本耦合**：FIBO 每半年发一个 release，我们的 TBox 跟它强耦合后，升级成本高。

## 三种接入方式

### 方案 A：全量导入

```turtle
@prefix : <http://harness-finance.local/ontology#> .
# 直接 include 整个 FIBO
```

- ✅ 语义最完整，未来扩展无需重写
- ❌ 冷启动 10x+，推理噪声大
- ❌ 包体积 +30MB（FIBO Turtle 合集）
- **结论**：不适合当前阶段。

### 方案 B：桥接（bridge）

保持我们自己的 TBox 不变，只把我们的类声明为 FIBO 类的子类：

```turtle
:AssetAccount rdfs:subClassOf fibo-fbc-fct:FinancialAsset .
:IncomeAccount rdfs:subClassOf fibo-fbc-pas:Income .
```

- ✅ 我们的 TBox 仍然轻量（~50 triples）
- ✅ 语义上与 FIBO 对齐——外部工具能识别我们的类
- ⚠️ 但 reasoner 要做推理时仍需加载 FIBO 才能真正分类
- **结论**：语义对齐的最小成本，但只在 TBox 推理时加载 FIBO，运行时 ABox 推理不需要。

### 方案 C：子集提取（subset extraction）

从 FIBO 里只挑我们用到的模块：

- `fibo/fibo-fbc/fibo-fbc-fct`（Financial Contracts，含 Financial Asset / Liability）
- `fibo/fibo-fbc/fibo-fbc-pas`（Payments，含 Payment / Income / Expense）
- 约 8,000-15,000 triples，reasoner 仍然扛得住

提取后存为 `ontology/fibo-subset.ttl`，作为 TBox 的一部分加载。

- ✅ 体积可控（~2MB），reasoner 启动 <1s
- ✅ 语义对齐 FIBO 核心概念
- ⚠️ 需要维护一个提取脚本（FIBO 升级时重新跑）
- **结论**：中期推荐路径。

## 推荐路线

```
现在（11-02）
  ↓ 手写 TBox，5 个类别，能跑
  ↓
下一步（TBox 推理稳定后）
  ↓ 方案 B：在 finance.ttl 里加 rdfs:subClassOf 桥接到 FIBO URI
  ↓ 不实际加载 FIBO 文件，只声明关系
  ↓
中期（需要 FIBO 语义时）
  ↓ 方案 C：写 scripts/extract-fibo.ts
  ↓ 从 edmcouncil/fibo 仓库拉 fibo-fbc-fct + fibo-fbc-pas
  ↓ 用 owl2csv 或 rdflib 提取，输出 ontology/fibo-subset.ttl
  ↓ 启动时加载，TBox 推理能用
  ↓
远期（如果做企业级）
  ↓ 方案 A：按需加载整个 FIBO
  ↓
```

## 与运行时 ABox 的关系

**TBox 推理（开发时）**：加载完整 TBox（含 FIBO 子集），跑 classify / validate，CI 守门。

**ABox 推理（运行时）**：agent 过账时只加载我们自己的最小 TBox（5 类别 + 不相交公理），不加载 FIBO。因为：

1. 运行时只需要检查"这个账户是不是和另一个类不相交"，不需要 FIBO 那套复杂金融工具语义
2. 每次过账都做 13 万 triples 的推理太慢
3. FIBO 的复杂公理（cardinality、domain/range）对个人记账场景是过度约束

所以 `OntologyService` 的 TBox 路径应该是可配置的：

```typescript
interface OntologyConfig {
  ontologyPath?: string          // 默认 finance.ttl（运行时 ABox）
  tboxValidationPath?: string    // 开发时 TBox 校验用，含 FIBO 子集
}
```

## 参考

- FIBO GitHub: https://github.com/edmcouncil/fibo
- FIBO 模块图: https://spec.edmcouncil.org/fibo/ontology/
- Microsoft Fabric IQ Ontology 的做法：自定义本体 + 引用 FIBO 类做桥接
- Protégé 的 reasoner 性能参考：HermiT 对 10 万 triples 分类约 2-5s，Konclude WASM 更快但仍有量级差
