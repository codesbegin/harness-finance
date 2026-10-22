# Reasoner 能力边界

> 记录于 2026-10-23。本文档说清楚 Konclude reasoner 当前能拦什么、不能拦什么，以及为什么。

## 设计原则：系统做裁判不做运动员

reasoner 是**裁判**，不是**业务逻辑**。它做的是：
- 确定性检查数据是否违反公理
- 返回矛盾理由，让 agent 自己决定怎么处理

它**不做**的是：
- 不自动修正金额
- 不自动调整过账方向
- 不替业务层做借贷平衡校验

## reasoner 当前能检测（TBox 公理）

### 1. 账户类别不相交（`owl:disjointWith`）

```turtle
:DebitAccount  owl:disjointWith :CreditAccount .
:AssetAccount   owl:disjointWith :LiabilityAccount , :EquityAccount , :IncomeAccount , :ExpenseAccount .
```

**触发场景**：如果某个数据源（批量导入、第三方同步）给一个账户同时打上 `AssetAccount` 和 `IncomeAccount` 标签，reasoner 会报不一致。

**业务层已拦**：`createAccount` 只接受一个 category 枚举，正常路径不会触发。这个公理是给**未来的数据导入/迁移场景**兜底的。

### 2. Posting 必须关联 Account（domain/range）

```turtle
:affectsAccount rdfs:domain :Posting ; rdfs:range :Account .
```

**触发场景**：如果 ABox 里有个三元组 `:p-1 :affectsAccount "hello"`（对象不是 Account），reasoner 报不一致。

**业务层已拦**：`addPosting` 只传 accountId，且 `accounts.get(accountId)` 不存在会先抛错。

## reasoner 当前不能检测（业务层自己做）

### 1. 借贷平衡（debit total == credit total）

OWL 2 DL 不能对**聚合数值**做推理。`xsd:nonNegativeInteger` 只能做范围约束，不能做"所有 debit 的和等于所有 credit 的和"。

**由谁做**：`JournalEntry.post()` 里的代码校验。这是业务层不变量，reasoner 不重复做。

### 2. 金额必须为正

```turtle
:hasAmount rdfs:range xsd:nonNegativeInteger .
```

这个 TBox 声明了 range，但 Konclude 对 datatype range 的检查在 ABox 层面比较弱。实际上：

**由谁做**：`Account.applyPosting` 和 `postEntry` 里的 `if (!(p.amount > 0))` 检查。

### 3. 账户余额方向（不能为负等）

余额是派生值，不是 ABox 实例。reasoner 看不到余额。

**由谁做**：业务层。未来如果要加"AssetAccount 余额不能为负"这种约束，需要把余额也写进 ABox（用 `:hasBalance` 数据属性），然后用 OWL 的 `owl:minCardinality` 或 SWRL 规则。这是后续工作。

## 未来要加的公理

### 高价值（业务层难表达）

- **跨科目过账约束**："ExpenseAccount 的过账必须关联一个 AssetAccount 或 LiabilityAccount"（比如花钱一定是现金减少或欠款增加）。这个用 OWL 的 `owl:someValuesFrom` 能表达。
- **分录基数**：一个 JournalEntry 至少有 2 个 Posting（不能只有一行）。用 `owl:minCardinality 2` on `:hasPosting`。
- **已结账账户不能再被过账**：用 `:isClosed` 数据属性 + 过账关系不相交。

### 低价值（业务层已经做了）

- 借贷平衡（需要 SWRL/SHACL，OWL 2 DL 做不了）
- 金额精度（业务层控制）

## 为什么不用 SHACL

SHACL（Shape Constraints Language）比 OWL 更适合做数据校验——它能表达"所有 JournalEntry 的 debit sum 等于 credit sum"这种规则。但：

1. Konclude 是 OWL reasoner，不是 SHACL validator。
2. 引入 SHACL 意味着多一个依赖（shacl-js 或 pySHACL）。
3. 当前阶段，业务层代码已经能做借贷平衡校验，reasoner 只需要做"结构合法性"检查。

**后续**：如果 reasoner 的表达能力不够，再加 SHACL 做数据形状校验。OWL 做 TBox 分类推理，SHACL 做 ABox 数据校验，两者互补。
