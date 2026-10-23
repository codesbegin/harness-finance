# 读路径设计（CQRS 风格）

> 记录于 2026-10-24。本文档说明为什么 listEntries 返回摘要、getEntry 返回详情，而不是一个方法返回所有东西。

## 问题

agent 记账时经常问两类问题：
1. "最近记了什么？"——需要列表，每条只要关键字段。
2. "这笔钱到底花在哪了？"——需要单笔分录的完整 posting 明细。

如果一个方法返回所有分录的所有 postings，数据量会爆炸（100 条分录 × 5 个 posting = 500 个对象），agent 的 context window 吃不消。

## 解法：读模型分两层

| 方法 | 返回 | 场景 |
|---|---|---|
| `listEntries(limit)` | 摘要数组（id/description/status/totals/postingCount） | "最近记了什么" |
| `getEntry(id)` | 单笔完整详情（含所有 postings） | "这笔钱花在哪" |

agent 先调 listEntries 拿到摘要列表，看到感兴趣的 entry id，再调 getEntry 拉详情。这是典型的**先列表后详情**模式，和邮件客户端、文件管理器一样。

## 为什么不做分页

当前是内存 Map，数据量小（个人财务一天几十条分录），`limit=20` 足够。未来接 SQLite 后再加分页（offset/limit 或游标）。

## 为什么不做搜索

"最近三天的餐饮支出"这种查询需要：
- 按描述模糊搜索
- 按账户类别过滤
- 按日期范围

这些是 SQL WHERE 的事，不是内存 Map 的事。等 SQLite Repository 落地后，再加 `searchEntries({ category?, from?, to?, keyword? })`。

## 和本体的关系

读路径**不查本体**。本体负责 TBox/ABox 一致性推理，不负责业务数据查询。读路径直接读业务层的 Map（未来是 SQLite）。

这和 CQRS 里的**读模型独立于写模型**一致：写模型（postEntry）更新余额和 ABox，读模型（listEntries/getEntry）从业务存储读，不经过 reasoner。

## 后续

- SQLite Repository 落地后，listEntries/getEntry 改读数据库
- 加 searchEntries（SQL WHERE）
- 加 trial-balance-detail（按账户展开余额明细）
