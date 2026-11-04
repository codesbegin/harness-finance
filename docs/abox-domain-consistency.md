# ABox 与 domain 层的一致性契约

## 为什么有"两套账"

同一个过账动作会同时写两个视图：

1. **domain 层**（`Account` / `JournalEntry` 对象）——业务逻辑的家。借贷平衡、余额累加、状态流转都在这里判定。
2. **ABox 层**（N3 Store 里的实例三元组）——本体视图。`acct-* rdf:type AssetAccount`、`je-* hasPosting p-*`、`p-* hasAmount "500000"`。

这是架构愿景的直接结果：**本体作为确定性底座，让业务规则机器可验证**。
domain 层让 agent 干活舒服，ABox 层让 reasoner 能检查数据是否违反本体公理。
两套视图必须一致，否则本体检查就是查一套无关的数据。

## 投影契约（必须对齐）

| 维度 | domain 视图 | ABox 视图 | 断言 |
|---|---|---|---|
| 账户数 | `listAccounts().length` | `aboxSummary().accounts.total` | 相等 |
| 分录数 | `listEntries().length` | `aboxSummary().entries` | 相等 |
| 过账数 | `Σ je.postings.length` | `aboxSummary().postings.total` | 相等 |
| 借贷总额 | 每笔分录 `totalDebit == totalCredit` | `postings.totalDebit == totalCredit` | 都平衡 |

这个契约在 `test/abox-sync.test.ts` 里被锁住。

## 语义不同：流量 vs 存量（别混用）

**ABox `postings.totalDebit` 是过账流量**：所有 `direction=debit` 的 posting 金额之和。
每笔分录自身平衡，所以 ABox 的借贷总额必然相等——`balanced` 标志
在这里是"数据层投影没坏"的哨兵，不是"账做平了"的证明。

**domain `trialBalance().totalDebit` 是账户余额存量**：所有 debit-normal 账户
（资产、费用）当前余额之和。它才是回答"我净资产多少"时该看的东西。

> ⚠️ 不要断言 `aboxSummary().postings.totalDebit == trialBalance().totalDebit`。
> 前者数流量（每笔都算），后者数存量（余额），数字上通常不相等。

## 同步点与失败路径

`FinanceService.postEntry` 的同步顺序刻意让失败不污染 ABox：

```
1. 加载账户（找不到 → FINANCE_UNKNOWN_ACCOUNT，ABox 没动）
2. je.post()（借贷不平 → FINANCE_UNBALANCED_ENTRY，ABox 没动）
3. 写 ABox（addJournalEntry + addPosting）
4. checkConsistency
5a. 一致 → save accounts + entries
5b. 不一致 → reverse 余额 → 也 save（否则 SQLite 脏数据）
             → removeJournalEntry（从 ABox 删干净）
             → 抛 FINANCE_ONTOLOGY_INCONSISTENT
```

步骤 1-2 在写 ABox 之前完成，所以业务错误（未知账户、不平）
永远不会产生 ABox 残留。步骤 5b 的回滚同时覆盖两个视图：
domain 余额 reverse + ABox 移除分录，保持"两套账要么一起变、要么都不变"。

## balanced 字段怎么用

`aboxSummary().postings.balanced` 是纯 Store 计算的布尔值（`totalDebitCents === totalCreditCents`），
不依赖 reasoner，所以冷启动/降级场景下也能拿到。

agent 的用法建议：

- `balanced=true`：数据层投影完好，可以放心继续问余额类问题。
- `balanced=false`：**只能**发生在 ABox 被外部工具直接写入、或回滚逻辑出 bug 的场景——
  正常过账路径不可能产生这个状态。此时应停止记账，先检查 ABox 同步是否漏了 posting。

这也是"系统做裁判不做运动员"的一处体现：系统只负责**报告**投影坏了，
不自动去改 ABox 里的金额——财务数据不可逆，修账是人的事。

## 已知缺口

- `removeJournalEntry` 只删实例三元组，不删 `hasAmount` 等数据属性的历史——
  目前每次过账都从空 Store 重建 ABox（进程内），不存在增量删除场景；
  如果未来 ABox 落盘持久化，需要给删除加日志。
- 本契约只覆盖 InMemory 模式；SQLite 模式的 ABox 同步与 repository 事务
  边界（`db.transaction()`）还没有独立测试覆盖，值得补。
