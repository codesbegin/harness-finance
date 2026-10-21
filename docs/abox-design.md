# ABox 实例化策略

> 记录于 2026-10-22。本文档描述运行时 ABox（Assertion Box）如何从业务数据生成，以及过账不一致时的回滚逻辑。

## 为什么要分 TBox / ABox

| | TBox | ABox |
|---|---|---|
| 内容 | 类、属性、公理（schema） | 实例、断言（data） |
| 来源 | `ontology/finance.ttl` 静态文件 | 运行时动态生成 |
| 变更频率 | 低（开发时改） | 高（每笔过账） |
| 推理触发 | classify（类层级） | checkConsistency（数据合规） |

这种分离和 FIBO 的设计哲学一致：TBox 是领域专家维护的"业务规则"，ABox 是用户的数据。推理器对两者做联合推理，但职责清晰。

## ABox 实例化映射

业务对象 → RDF 三元组：

### 账户（Account）
```
acct-<id>  rdf:type  :AssetAccount | :LiabilityAccount | :EquityAccount | :IncomeAccount | :ExpenseAccount .
```

在 `createAccount` 时写入。账户的余额数字**不进 ABox**——余额是业务层 `Account._signedBalance` 的事，本体只负责"这个账户属于哪一类"，reasoner 基于类型做公理推理。

### 分录（JournalEntry）
```
je-<id>  rdf:type          :JournalEntry ;
        :hasDescription    "描述文字" .
```

在 `postEntry` 时写入。

### 过账（Posting）
```
p-<je-id>-<index>  rdf:type          :Posting ;
                  :hasDirection      "debit" | "credit" ;
                  :hasAmount         "10000"^^xsd:nonNegativeInteger ;
                  :affectsAccount    acct-<account-id> .

je-<id>            :hasPosting        p-<je-id>-<index> .
```

金额存**分**（minor units），和 TBox 里 `:hasAmount rdfs:range xsd:nonNegativeInteger` 对齐。业务层用元（number），写入 ABox 时 `Math.round(amount * 100)` 转换。

## 过账时的推理闭环

```
je.post()                      ← 业务层校验借贷平衡（同步，快）
  ↓
ontology.addJournalEntry()     ← 写入 ABox
ontology.addPosting() × N
  ↓
ontology.checkConsistency()    ← reasoner 推理（异步，WASM）
  ↓
一致？── 是 ──→ 存入 entries Map，返回
  │
  否
  ↓
回滚：
  1. 反向 applyPosting 冲销余额
  2. ontology.removeJournalEntry(je.id)  删 ABox 实例
  3. je.status = 'REJECTED'
  4. 抛 FINANCE_ONTOLOGY_INCONSISTENT 给 agent
```

**系统做裁判不做运动员**：reasoner 说不一致，系统只回滚 + 报告理由，不自动修正金额。修正逻辑由 agent 决定（重试 / 问人 / 放弃）。

## 为什么余额不进 ABox

一个直觉的想法是把余额也写成三元组（`acct-X :hasBalance "1000"`）。但：

1. 余额是高频变化的派生值，不是事实——事实应该是"每笔过账"，余额是过账的聚合。
2. 推理器对数值推理支持有限（OWL 2 DL 的 `xsd:nonNegativeInteger` 只能做范围约束，不能做求和）。
3. 借贷平衡这个不变量已经在业务层 `JournalEntry.post()` 里用代码校验了，reasoner 不重复做。

reasoner 真正该做的是**业务层代码表达不了的约束**，比如：
- "一个 AssetAccount 不能直接和 IncomeAccount 发生过账关系"（如果加了这个公理）
- "某个分类的账户不能有负余额"（加 `:hasBalance some xsd:nonNegativeInteger` 约束）
- "IncomeAccount 必须和至少一个 Posting 关联"（基数约束）

这些是 TBox 层的设计，后续逐步加。

## 回滚时为什么要删 ABox

如果不删，被拒绝的分录实例会留在 Store 里，下次 `checkConsistency` 还是会报不一致——但业务层已经回滚了，会造成"数据和本体不一致"的幽灵状态。

`removeJournalEntry(entryId)` 会递归删除：
- 分录本身的所有三元组
- 该分录 `:hasPosting` 指向的所有 posting 实例的所有三元组

TBox 类定义不动。

## 后续：接入 FIBO

FIBO 有 129,990 个 triples、3,371 个类。当前 TBox 是手写的轻量版，后续可以：

1. 把 `:Account rdfs:subClassOf fibo-fbc:FinancialAccount` 等映射加上
2. 不直接加载 FIBO 全量（太大），而是按需 import 子模块
3. 让 reasoner 在我们的轻量 TBox 上推理，FIBO 作为语义参考

这是开发期 TBox 推理的事，不影响运行时 ABox 写入逻辑。
