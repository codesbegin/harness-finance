# 本体可视化设计

## 为什么需要可视化

本体的价值是让业务规则**机器可验证**。但 OWL Turtle 文件对人是黑盒——你写了一组不相交公理、对象属性、domain/range 约束，推理结果到底是什么，光看文件看不出来。

我们的目标读者有两类：
- **开发者**：改了 TBox 后，想立刻看到类层级长什么样、有没有产生不可满足类
- **非技术用户**：想看"系统现在懂了哪些概念、我这笔记账在本体里对应什么结构"

## 分三步走

### 第一步：TBox 类层级 DOT（已完成 ✅）

`scripts/reason.ts --export-dot out.dot` 直接从 TBox quads 里读 `rdfs:subClassOf` 关系，导出 Graphviz DOT。

```bash
pnpm reason:dot
# 生成 docs/tbox.dot，然后：
dot -Tsvg docs/tbox.dot -o docs/tbox.svg
```

渲染出来的图：
- 类层级是自底向上的树（asset/expense → DebitAccount → Account）
- 不可满足类标红
- 只画我们 namespace 下的类，FIBO 外部类不画

**为什么先做这个**：不需要前端、不需要浏览器、不需要 reasoner 运行成功。纯 N3 Store 查询，可靠。

### 第二步：ABox 实例图 DOT（已完成 ✅）

运行时 ABox 是动态的：每次过账，账户、分录、posting 实例被加进 N3 Store。`exportAboxDot()` 把这些实例导成图：

```bash
pnpm reason:abox-dot
# 加载 ontology/sample.abox.json，生成 docs/abox.dot
dot -Tsvg docs/abox.dot -o docs/abox.svg
```

图的结构：
- **账户节点**（圆角矩形，按类别上色）：绿=资产、红=费用、黄=负债、靛=权益、青=收入
- **分录节点**（note 形状）：显示 description，比如"付房租 3000 元"
- **过账节点**（菱形）：显示方向和金额，比如"debit 3000.00"
- **边**：分录 → 过账（hasPosting），过账 → 账户（affectsAccount）

运行时也能调：`ctx.ontology.exportAboxDot()` 返回 DOT 字符串，agent 可以直接返回给前端或写文件。

**设计选择**：rankdir=LR（从左到右），因为 ABox 是"分录分解成过账再过到账户"的横向关系，不是 TBox 那种纵向继承。

### 第三步：Web UI（远期）

本地起一个 dev server，用 Cytoscape.js 或 D3 渲染：
- 左栏：类层级树（可展开/折叠）
- 右栏：选中某个类后，列出所有 ABox 实例
- 底部：reasoner 输出（一致性状态、不可满足类列表）
- 不一致时：高亮违反的公理，点开看 explain 链

这一步不急。等 TBox 稳定、FIBO 接入后再做。现在做 Web UI 会陷入前端框架选择、打包、热更新这些和本体无关的坑。

## 参考

- **Microsoft Fabric IQ Ontology**：三视图设计（概念视图、逻辑视图、物理视图）。我们现在做了概念视图（TBox 类层级）和逻辑视图（ABox 实例关系），物理视图（SQLite 表）已经有了但没可视化。
- **Protégé**：OWL 本体编辑器的标杆。它的类层级树 + 实例面板布局是金标准，但它是 Java 桌面应用，不适合我们的场景。
- **Graphviz**：简单可靠，缺点是布局对大图不够好。但个人财务场景类不超过 20 个，实例不超过几百个，完全够用。

## 边界

- 可视化**不是**给 agent 用的。agent 查本体用 `listClasses()` / `queryConcept()` / `isEntailed()` 这些 Remote 方法，返回结构化数据。
- 可视化是给人看的——开发者验证 TBox、非技术用户理解系统。
- 不做实时协作编辑、不做拖拽改 TBox。TBox 是代码，应该走 git PR 流程。
