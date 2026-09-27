# 舰船插件「CPU 上限」无效 — 工作文档

- **状态**：进行中（2026-09-27 开工 · 一号 · 主树 `main`）
- **来源**：船长转述外部玩家报障。

## 船长原话（照抄）

> 玩家反应，CPU上限的插件装上后无效

## 根因

插件（**2026-09-26 船长令**那批）走 `FleetShipState.plugs` 的**独立插件槽**，**不进 `fitted`**
（`plugs.ts` 头注自己就写着：「因此 `allFittedModules`（只扫 `fitted`）**看不见插件**，插件效果由
**战斗建档侧单独一段累加**」）。

而 CPU 预算的单点 `equipment.cpuBudgetOf` **只有 `fitted` 那一段**：

```ts
for (const m of allFittedModules(fitted, ctx)) bonus += m.cpuBonus ?? 0
```

⇒ 数据侧 `packages/data/src/plugs.ts` 里已经写好的「协处理插件 `cpuBonus: 80`」**装上后预算纹丝不动**。
`cpuBudgetOf` 是 CPU 预算的全仓单点（装配校验 `fitModule`/`swapModuleAt`、装配页 CPU 条、战斗建档
`cpuLeft`、`tools/playthrough-sim` 全走它）⇒ 这一处漏了，**所有**消费点一起错。

⚠ 顺带核对：`combat.ts` 那段"单独累加"的注释里自称**已接**「CPU 预算」，但全仓 `cpuBonus` 的读取点
只有 `cpuBudgetOf` 一处 ⇒ **战斗侧其实也没接**，注释与实现不符（本次一并转正，注释里已改正）。

## 修法（甲：补单点）

`cpuBudgetOf` 里补一段插件累加（走现成的 `plugs.plugModulesOf`）：

```ts
for (const p of plugModulesOf(state, ctx, shipId)) bonus += p.cpuBonus ?? 0
```

- **为什么放这里**：单点修一处 ⇒ 装配校验 / 装配页 / 战斗建档 / 工具全线一致，不会留下"界面说 180、
  校验按 100 判"这类两套口径。
- **为什么不需要替身位**：插件**不可拆、不可替换、恒随船** ⇒ 预演 `fittedOverride` 时它们照样在，
  与"预算随件走"的防套利口径（卸协处理器白拿预算）**无关**。
- **不吃多件递减**：与原口径一致（船长裁决「③不吃」：不可拆的固定件，装几件就是几件全额）。

## ⚠ 同源未修（**待船长裁决**）

同一批插件字段里还有两条**同样只定义、没接线**（全仓只出现在类型定义处）：

| 字段 | 数据侧 | 现状 |
|---|---|---|
| `midSlotsAdd`（中层舱段插件 +1 中槽） | `packages/data/src/plugs.ts:91` | **未接线** |
| `lowSlotsAdd`（下层舱段插件 +1 低槽） | `packages/data/src/plugs.ts:100` | **未接线** |

**为什么本次没顺手修**：它与 CPU 预算是两种难度 —— 槽位数量体现在 `fitted.mid/low` **数组长度**上
（`rackBays` 按长度取位）⇒ 要让它生效得在**装插件时扩容数组**，并处理"老档已装插件但数组没扩容"的
迁移；影响面覆盖装配页布局、槽位校验、存档结构 ⇒ 属于一次独立改动，适合单独一批做。
**建议**：与本次一起排下一批（修法同上：槽位单点 `labels.shipSlotsOf` 加插件那份）。

## 验证

- 用例 `packages/core/tests/cpu-coprocessor.test.ts` 追加 3 条（插件 +80 ⇒ 预算 100→180 · 插件不占 CPU ·
  110 CPU 的炮"没插件装不下 / 装了装得下"）。
- 闸门：typecheck · core 全量 · content:check · l10n:check · ui:rot-check · 构建。
