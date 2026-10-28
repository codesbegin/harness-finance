# Agent 查询模式设计

传统会计软件的查询接口是给人看的：一个报表窗口、一堆筛选条件、导出 Excel。
agent 不需要这些。agent 需要的是**可组合的、有明确返回结构的 Remote 方法**，让它能在多轮对话里逐步缩小答案。

## 我们的查询分层

```
Cordis tool (tool.ts)
  ↓ 参数名是 snake_case，给 LLM 看
FinanceService Remote (service.ts)
  ↓ 参数名是 camelCase，给程序用
EntryRepository (repository/types.ts)
  ↓ 接口，不关心存储
InMemory / SQLite (memory.ts / sqlite.ts)
  ↓ 具体实现
```

每一层都做一件事：
- **tool 层**：把 LLM 的自然语言参数（"找房租相关的"）映射成结构化查询（`description: '房租'`）。
- **Remote 层**：定义稳定的 API 契约，返回 domain 对象的视图（EntrySummary / EntryDetail）。
- **Repository 层**：把查询翻译成存储操作。内存版是数组 filter，SQLite 版是 WHERE 子句。

## 五种核心查询

| 查询 | agent 场景 | 我们的方法 |
|---|---|---|
| 列最近 N 条 | "最近记了什么账？" | `listEntries(limit)` |
| 看某一条详情 | "那笔房租具体怎么拆的？" | `getEntry(id)` |
| 按条件搜索 | "上个月办公用品花了多少？" | `searchEntries(query)` |
| 试算汇总 | "现在账平了吗？" | `trialBalance()` |
| 试算明细 | "我现金还有多少？" | `trialBalanceDetail()` |

### 为什么要有 listEntries 和 searchEntries 两个

它们看起来重叠，但服务于不同的 agent 推理路径：

- **listEntries** 是"我还不知道有什么，先看最近的"。这是 agent 的**探索模式**——对话刚开始，agent 没有具体问题，先扫一眼最近 20 条建立上下文。
- **searchEntries** 是"我有具体条件"。agent 已经知道要找什么（关键词、账户、金额范围），直接过滤。

如果只留 search，agent 在探索模式下就得猜关键词；如果只留 list，agent 找历史账目得拉全表再自己过滤。两个都留，agent 选对工具的成本最低。

## EntrySearchQuery 的设计取舍

```typescript
interface EntrySearchQuery {
  description?: string    // 子串匹配，不区分大小写
  accountId?: string      // 精确匹配
  category?: AccountCategory  // 精确匹配枚举
  status?: string         // 精确匹配状态
  minAmount?: number      // totalDebit >=
  limit?: number          // 默认 50
}
```

### 为什么不用正则

agent 用自然语言记账，不会传正则。子串匹配已经够回答"房租""办公用品"这类问题。加正则只会让 LLM 更容易写错参数。

### 为什么 amount 用 min 不用 range

agent 最常见的问题是"大额支出"，即 `minAmount`。range（min+max）是给财务人员做审计用的，agent 场景里很少出现。如果以后需要，加两个字段就行，不影响接口兼容。

### 为什么 status 是 string 不是枚举

domain 层的 `JournalEntryStatus` 是 `'DRAFT' | 'POSTED' | 'LOCKED' | 'REJECTED'`。Repository 接口故意用 string，因为：
- 未来加新状态时不用改 Repository 接口
- SQLite 里就是 TEXT 列，传什么字符串就查什么
- tool 层负责把 LLM 传的字符串转成大写枚举

## SQLite 实现的关键选择

我们没有用 JOIN 一次性把 entries + postings + accounts 全查出来，而是：

1. 先在 entries 表上跑 WHERE，拿到匹配的 entry ID 列表
2. 再逐条调用 `findById(id)` 组装完整的 JournalEntry

这样写的代价是 N+1 查询。但：
- 个人财务场景下，一个人的账本科目也就几百条，N+1 完全可接受
- 每条 `findById` 只查 1-3 张表（entries + postings + 相关 accounts），开销很小
- 代码简单，和 InMemory 版的逻辑一一对应，容易测

以后数据量真的大了（企业级、十年账），再改成 JOIN 一次取出 + 手动组装。现在 premature optimization 是浪费。

## 给 agent 的错误提示

查询失败时，我们不返回空数组就完事。tool 层的错误码告诉 agent 下一步：

- `FINANCE_UNKNOWN_ENTRY`：你给的 ID 不存在 → 先 listEntries 找正确 ID
- `FINANCE_UNKNOWN_ACCOUNT`：账户不存在 → 先 createAccount

这是**给 LLM 的行动指南**，不是给人看的报错。agent 看到错误码就知道该调哪个工具重试，而不是把错误原样抛给用户。
