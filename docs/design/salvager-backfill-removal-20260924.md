# 打捞器全员补发（临时补丁）拆除（2026-09-24）

状态：**进行中** —— 改动**已落码**，四闸门自测全绿，**待船长验收**；
归档按 AGENTS.md §8（船长验收 + 合入 main 后当批做：关键内容并入 roadmap → 删本文件 → 重跑 `docs:index`）。

## 船长原话（照抄）

1. 「打捞器全员补发可以拆除。」（2026-09-24，回复一号的遗留清单）
2. 补丁本身的两次令（**2026-09-22**）：「玩家依旧出现被打捞器卡进度的情况，给所有玩家发一个打捞器 MK1 吧。」
   → 追问后定：「这次补发直接所有人无条件发，**发放完成后下次更新删除补发**。」

## 范围 / 不做

- **做**：把 2026-09-22 那次"全员无条件补发打捞器 MK1"的临时补丁**连根拆净**（函数、调用、存档去重键、
  白名单、用例、孤儿文案 id、roadmap 登记行）。
- **不做**：**已发出的打捞器不回收**（沿用船长 2026-09-22 口径「已发出的装备不回收」）；
  不动「第一次打捞残骸」这条任务本身（它的起手道具 `mod-salvager-1` 是另一条链路，`firstTasks.ts` 的数据，照常发）。
- **不改历史留档**：`docs/development-conventions.md` §二、`docs/glossary.md`、changelog 里关于
  「刷新可重复领取打捞器」那次报障与由此立的「随档字段两处落笔」规则 —— 属**事故留档**，
  按 §8「工作期间不改旧文档」与「台账只追加」**一律不动**。

## 拆除清单（roadmap 登记 5 步 · **实际连带 12 处**）

roadmap 的「未完成功能清单」原行只登记了 5 步（删函数 / 删调用 / 删字段 / 删两条用例 / 删本行）。
照单执行会**直接红**（类型穷尽护栏 + 白名单死键），实际连带如下：

| # | 类别 | 文件 | 落点 |
| --- | --- | --- | --- |
| 1 | 引擎 | `packages/core/src/firstRewards.ts` | `backfillSalvagerIfMissing` 函数本体 ＋ `SALVAGER_MODULE_ID` 常量 ＋ 整段注释 |
| 2 | 引擎 | `packages/core/src/engine.ts` | import 里的 `backfillSalvagerIfMissing` |
| 3 | 引擎 | `packages/core/src/engine.ts` | 每拍那一行调用 ＋ 上方注释块 |
| 4 | 存档面 | `packages/core/src/state.ts` | `ImportantTaskState.salvagerGift?: boolean` 字段 ＋ 注释 |
| 5 | 存档面 | `packages/core/src/save.ts` | `normalizeState` 白名单里那一行 spread ＋ 注释（**漏删 = 白名单留死键**） |
| 6 | 用例 | `packages/core/tests/first-tasks.test.ts` | `it('全员补发打捞器 MK1：…')` 整个用例 ＋ 注释 |
| 7 | 用例 | `packages/core/tests/first-tasks.test.ts` | 「奖励真的按新口径发」那条里**另一块**补发断言（原 148 / 152 行） |
| 8 | 用例 | `packages/core/tests/save.test.ts` | `ALL_KEYS: Record<keyof ImportantTaskState, true>` 里那一行（**不删 = typecheck 红**） |
| 9 | 用例 | `packages/core/tests/save.test.ts` | 「每个字段都随档往返」里构造态的那一行 |
| 10 | 用例 | `packages/core/tests/simulation.test.ts` | 离线事件计数用例里"先标成已发过"的那一行 ＋ 注释（补发没了 ⇒ 噪声也没了） |
| 11 | 文案 | `packages/data/src/l10n/table.ts` | 孤儿 id `core.firstRewards.008`（补发日志，拆除后再无调用点） |
| 12 | 登记 | `docs/roadmap.md` | 「未完成功能清单」里那一行（该清单自带的收口规则：完成即删条） |

**另加三处收尾（不留悬空引用）**：`save.ts` 与 `save.test.ts` 共三处注释原文以 `salvagerGift` 为实例讲
「随档字段两处落笔」这道规则 —— 规则本身照旧，只在实例后加一行 `🔧 2026-09-24 补注` 说明补丁已拆、字段已删。

**用例侧的净变化**：删 1 整例 + 3 块断言；**新增 1 条负向断言**（`first-tasks.test.ts` 里
`expect(s1.moduleBay['mod-salvager-1'] ?? 0, '补发已拆除 ⇒ 不再无条件发打捞器').toBe(0)`）——
把"拆除已完成"这件事钉住，将来谁把补发加回来会当场红。

## 待裁决点

- **当年那笔挂账**：2026-09-22 记录里留了一句「**已被刷新多领的那几台要不要回收**」（当时按"已发出不回收"未收）。
  本次拆除按同一口径**不回收**；若要收，另开一单（扣回装备库 `mod-salvager-1`）。

## 验证

- **四闸门**：`typecheck` 四包 0 错 · core **201 文件 / 2270 用例全绿**（拆除前 2271 ⇒ 净减 1：
  删 1 整例 ＋ 删 3 块断言 ＋ 新增 1 条负向断言）· `content:check` ✅ · `l10n:check` ✅（无死引用）·
  `ui:rot-check` ✅ · `save:roundtrip-audit` ✅（84 份往返 · **丢键 0** · 类型变化 0）· 桌面 `build` ✅。
- **负向验证**：拆除后新增的那条断言（`'补发已拆除 ⇒ 不再无条件发打捞器'` = 0）在补丁存在时**如实变红**，
  拆除后全绿 ⇒ 它真能拦住"补发被加回来"。
- **测试档 1 份失败**：`test-save-b1-20260904-182854.json` 是 v17、早于可迁移下限 v24 —— **老账，与本次无关**
  （拆除前后读数一致）。
- **边界**：不动任何数值曲线与存档版本（`salvagerGift` 本就"只在 true 时落键、零迁移"，删它同样零迁移）；
  不动「第一次打捞残骸」任务的起手道具链路；已发出的打捞器不回收。
