/**
 * **退役窝点卡白名单**（2026-09-11 船长裁决 = 「按方案 2 执行」）
 *
 * 背景：赏金任务·**窝点**要求卡上有 `lairCore`（核心词）；B 族（武装拾荒者）按船长裁决
 * 「**没有窝点，排除出赏金范围**」⇒ 两张 B 族卡的 `lairCore` 字段已**退役删除**（数据层干净）。
 *
 * **为什么不能"删字段就算完"**：`packages/data/src/context.ts` 的**稀有残骸物品注册**曾经
 * 用 `hasLairCore(a)` 判定——字段一删，`wreck-rare-ano-harbor-escort` /
 * `wreck-rare-ano-abandoned-platform` 就**不再被注册**，而**旧档里已经获得这两件物品的玩家**
 * 会在读档后看到"**未知物品**"（物品 id 解析不到 `ctx.items`）。
 *
 * ⇒ 本白名单把这两张卡**显式保留在注册集合里**：`hasLairCore(a) || RETIRED_LAIR_CARD_IDS.has(a.id)`。
 * 语义分层（务必分清）：
 * - **窝点候选**：由 `core/lairs.ts` 的 `isLairCandidate()` 判（含"B 族一律排除"族规则）⇒ 退役卡**不参与**派发；
 * - **稀有残骸注册**：由本白名单 + `hasLairCore` 判 ⇒ 退役卡**仍注册**（只为旧档兼容，不再新增产出）。
 *
 * **值 = 卡 id（`AnomalyDef.id`）**，不是物品 id（物品 id = `wreck-rare-<卡 id>`，由
 * `rareWreckItemIdOf()` 推导）。守卫 = `tools/content-check.ts`「退役窝点卡契约」（4 条：
 * id 真实存在 / 字段确实为空 / 仍被 `isLairCandidate()` 排除 / 稀有残骸仍可注册）。
 */
export const RETIRED_LAIR_CARD_IDS: ReadonlySet<string> = new Set([
  'ano-harbor-escort', // 新港商路护航令（B 族，原 lairCore「新港拾荒团」）
  'ano-abandoned-platform', // 占港武装通缉（B 族，原 lairCore「占港拾荒团」）
])
