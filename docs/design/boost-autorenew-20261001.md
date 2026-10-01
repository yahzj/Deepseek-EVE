# 技能加速「自动续用」开关 ＋ 工业页标签顺序（工作文档）

- **状态：进行中**（2026-10-01 开工；实现与四闸门已完成，待船长验收与合入）
- 经办：三号（worktree `Deepseek-EVE-verify`，分支 `verify`）
- 归档时：关键结论并入 `docs/roadmap.md` 一条精简条目后删除本文件（§十五 文档工作流）

## 1. 船长原话（照抄）

> 「将实验室的子页面标签移动到蓝图书架前面。给技能加速页面添加一个循环使用的开关。当当前加速效果过时时，
> 自动使用相同效果的技能加速消耗品，离线期间也一样」

## 2. 五条裁定（船长 2026-10-01 全取推荐案）

| 项 | 定案 |
|---|---|
| 开关默认态 | **关**（随档保存；老档缺字段按关读 ⇒ 零迁移、不升版本号） |
| 没料时 | **自动关掉开关** ＋ 一条提示（只写一次） |
| 续用时机 | **无缝**：剩余生效时间不足以练完当前这一级就补（不是"过期后再补"） |
| 日志 | **在线逐枚写**；离线**只在"离线结算完成"汇总里写一句** |
| 范围 | 在线每拍 · 离线大推进 · 离线分片（重复清剿那条路）**全覆盖** |

## 3. 实现落点

| 文件 | 改动 |
|---|---|
| `packages/core/src/state.ts` | 新增存档字段 `boostAutoRenew?: boolean`（可选 ⇒ 老档零迁移） |
| `packages/core/src/save.ts` | 读：`src.boostAutoRenew === true`；写：**只在 true 时落键**（与 `skillBoostUntilMs` 同款） |
| `packages/core/src/consumables.ts` | 新增**自动补用的唯一实现** `syncBoostRenew()` ＋ `boostAutoRenewOn()` / `setBoostAutoRenew()` ＋ 离线记账（`setOfflineBoostTally` / `offlineBoostRenewCount`） |
| `packages/core/src/engine.ts` | ① `advanceSkillQueue` 第三参 `SkillCatalog` → `ctx`（判据要与训练时长同一套乘区）；② **`advanceGame` 每拍第一件事**调一次；③ 队列循环内**每级后**再调一次 |
| `packages/core/src/simulation.ts` | 离线开始时开记账、收尾取枚数并进"离线结算完成"那句（新槽 `p5` / `p5Id` / `p5p1`） |
| `packages/core/src/index.ts` | 导出界面需要的 4 个符号 |
| `apps/desktop/src/renderer/src/game/engine.ts` | 桥接 `boostAutoRenewOn()` / `setBoostAutoRenewNow(on)`（成功才落盘 + 通知） |
| `apps/desktop/src/renderer/src/pages/SkillsTreePage.tsx` | 「技能加速」块状态条右侧加开关（沿用 `.app-btn.is-small.is-on`，**不自造控件/不新增样式**） |
| `apps/desktop/src/renderer/src/pages/IndustryPage.tsx` | 实验室标签整块移到蓝图书架**之前**（精炼炉 → 组装机 → 造船厂 → **实验室** → 蓝图书架）；门槛逻辑与保活机制未动 |
| `packages/data/src/l10n/table.ts` | 新文案 5 条（下节） |
| `packages/core/tests/boost-autorenew-20261001.test.ts` | **新增 15 条用例**（契约 · 开关 · 无缝补用 · 料尽 · 离线） |
| `tools/param-miss-check.ts` | 并入上一批的"模板被无参/漏参使用"判据（船长批「按你推荐来」⇒ 探针转正） |

### 判据与语义（实现要点）

1. **判据顺序**：开关关着 ⇒ 早退｜**库存 0 ⇒ 当场关掉开关并提示**（排在"是否生效"之前，避免开关空亮）｜
   剩余时间 > "练完当前这一级所需" ⇒ 早退｜否则补一枚（货仓优先扣料）。
2. **"无缝"的定义**：补用后**不重置** `progressMs`（本级继续练完，新一剂覆盖后面的时间）。
   ⚠ 实现时踩过一次坑：把判据写成 `synapticAccelerantActive` 早退（二元判断）⇒ "快到期但还在生效"时永不补，
   无缝语义直接失效 —— **被本批用例当场逮住**，已改成"剩余时间 vs 本级所需"的比较。
3. **队列空着也照补**：开关的语义是"让加速一直生效"，与队列有没有活无关；空队列时判据退化为
   "剩余 ≤ 60 秒（`SYNAPTIC_ACCELERANT_RENEW_TAIL_MS`）才算到期"，既不会空转烧料，又能在真开练时立刻接上。
4. **离线**：整段离线只在开始时开记账，期间逐枚**不写日志**、只累计；收尾由 `core.simulation.003` 那句汇总交代。

## 4. 新增 / 改动的玩家可见文案（id 制 · 中英齐）

| id | 中文 | 用途 |
|---|---|---|
| `ui.boost.008` | 自动续用 | 开关标签 |
| `ui.boost.009` | 效果不足以练完当前这一级时，自动用掉一枚同效果的加速剂；道具用光时自动关闭。离线期间同样生效。 | 开关悬停 |
| `core.consumable.013` | ✦ 突触加速剂自动续用：接下来 {p1} 小时训练时长继续减半。 | 在线逐枚日志 |
| `core.consumable.015` | ⚠ 技能加速自动续用已关闭：突触加速剂用光了。 | 料尽自动关的提示 |
| `core.consumable.016` | 仓库里没有突触加速剂：自动续用无从补起。 | 没料时想开开关的当场拒绝 |
| `core.simulation.003` | ；自动续用突触加速剂 ×{p1} | 离线汇总那一槽（槽译文） |

## 5. 验证（2026-10-01）

- `npm run typecheck` ✅ 四包全绿
- `npm run test -w @whale/core` ✅ **276 文件 / 2,921 用例**（含本批新增 15 条）
- `npm run content:check` ✅ · `npm run l10n:check` ✅ · `npm run l10n:params` ✅（含新第三段判据：模板用法 0 处漏参）
- `npm run ui:rot-check` ✅（动了界面 ⇒ 第五道闸门必跑）
- 探针：实现期用过两个一次性探针（真值打印），**收尾已删**；其中"参数漏喂"那套判据已转正进 `l10n:params`。

## 6. ⟪文案调整台账⟫（§十三）

| 日期 | id / 位置 | 原 → 新 | 依据 |
|---|---|---|---|
| 2026-10-01 | `core.simulation.002`（离线结算汇总那句） | 加一槽 `{p5}`（自动续用枚数），中英同步 | 船长令（本文件 §1）裁定④"离线只在汇总里写一句" |

> 其余 5 条（`ui.boost.008/009` · `core.consumable.013/015/016` · `core.simulation.003`）都是**新写**的 ⇒
> 按 §十三 不必打 `⟪文案调整⟫` 记号（`git blame` 已足够）。

## 7. 待裁决点

1. **开关位置与观感**：放在「技能加速」块状态条右侧（同一行，与倒计时同排）。观感审查权在船长 —— 要挪到别处
   （如道具行右侧）说一声，我改。
2. **文案用字**：上表 6 条（尤其 `ui.boost.009` 的悬停说明）如有措辞偏好，指出即改。
3. **`plugs.ts` 那条措辞**（上一批的收尾项）仍等一句话。
