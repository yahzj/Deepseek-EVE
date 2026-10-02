# 洞内「禁止打捞普通残骸」（工作文档 · 2026-10-02）

- **状态：已落码 · 待船长验收**（船长 2026-10-02 两轮裁定：选**甲案** ⇒「**只做甲，坐在货仓背包处。**」）
- 经办：一号（主树 `H:\大鲸鱼\Deepseek-EVE`）
- 归档时：关键结论并入 `docs/roadmap.md` 一条精简条目后删除本文件（§八 文档工作流）

## 1. 船长原话（照抄）

> 「玩家希望虫洞内有个不拾取普通残骸，有什么好办法？」（一号出设计总结后）
> 「**只做甲，坐在货仓背包处。**」
> 文案三条（船长原文，逐字落地）：「**禁止打捞普通残骸**」「**当前禁止打捞普通残骸**」「**本次打捞跳过 N 堆普通残骸**」
> 其余（落档方式 · 缺省值 · 该格标记）：「**其他按你推荐**」。

## 2. 口径（甲案 · 已实现）

| 项 | 口径 |
|---|---|
| 适用范围 | **手动进洞的「打捞」动作**（`wormholeSalvage.wormholeSalvageAt`）；⚠ **不含**自动探索（那是收益模拟）、不含采集（虚空母矿）、不含战果结算的随行战利品 |
| 开关落点 | **货仓页**（`panels/Wormhole.tsx` 的 `WhHold`，与「整理」按钮同一动作行）——船长指定 |
| 开关形态 | `.app-btn is-small` ＋ `is-on` 高亮 ＋ `aria-pressed` ＋ **文案随状态变**（先例 = 技能页「自动续用」开关） |
| 文案映射 | 标签 = `ui.Wormhole.379`「禁止打捞普通残骸」· 打开时状态 = `core.wormholeSalvage.044`「当前禁止打捞普通残骸」（**与 core 的拒绝原因同一条 id**，按"同文并条"）· 打捞日志 = `core.wormholeSalvage.045`「本次打捞跳过 {p1} 堆普通残骸」 |
| 判据 | 堆按 **`isRareWreck(itemId)`** 二分（`wormholeSalvage.ts` 已在用的单点）；**形状件（货柜）不参与打捞回收**，原路不变 |
| 打开后 | 一次动作**只取稀有堆**（普通堆原地不动）；动作照旧 **1 回合**；`{p1}` = 本格此刻**还剩多少堆普通残骸** |
| 只剩普通时 | **拒绝动作且不扣回合**（`core.wormholeSalvage.044`；打捞器没开工 ⇒ 不浪费回合、不消耗"遗迹首捞"判定） |
| 该格标记 | **不记"捞空/完成"**（普通堆还在）——已核实**不影响深入**（`wormholeDescend` 前置只有：战斗结束 / 本层 BOSS 已清 / 回合>0 / 站在入口格） |
| 落档 | `WormholeState.noCommonWreckSalvage`（**可选布尔**，缺省关）⇒ 跨趟常驻 · **老档零迁移** |

## 3. 改动台账（逐文件）

| 文件 | 改动 |
|---|---|
| `packages/core/src/wormhole.ts` | `WormholeState` 新增可选字段 `noCommonWreckSalvage`（含口径注释）· 新增**唯一读取点** `noCommonWreckSalvageOn()` · 新增开关 `setNoCommonWreckSalvage()`（关 = 删字段，与读档归一"只在为真时写"同形）· 补 `CommandResult` 类型导入 |
| `packages/core/src/wormholeSalvage.ts` | `wormholeSalvageAt`：① 取材前加**筛选预检**（只剩普通 ⇒ 拒绝、不扣回合）② 取材循环改为"关着时 `idx=0`（与旧 `piles.shift()` **逐字等价**）／开着时取第一个稀有堆"，`piles.shift()` → `piles.splice(idx,1)` ③ 动作收尾写「本次打捞跳过 N 堆普通残骸」日志 |
| `packages/core/src/save.ts` | **读档归一**补一行：`...(wRaw.noCommonWreckSalvage === true ? { noCommonWreckSalvage: true } : {})`（与 `nebulaHintShown`/`siegeHintShown` 同形；漏登记 = 每次读档把玩家开关静默重置）。⚠ **写档侧不用改**（`serializeSaveFile` 是整份 `state` 序列化） |
| `packages/core/src/index.ts` | 导出 `noCommonWreckSalvageOn` / `setNoCommonWreckSalvage` |
| `packages/data/src/l10n/table.ts` | 新增 3 条 id：`ui.Wormhole.379` · `core.wormholeSalvage.044` · `core.wormholeSalvage.045`（中英齐；中文为船长原文，英文按 `glossary-en.md` 口径：残骸 `Wreck` / 稀有 `Rare Wreck` / 打捞 `Salvage` / 堆 `pile`） |
| `apps/desktop/src/renderer/src/game/engine.ts` | 新增 `noCommonWreckSalvageOn()` / `setNoCommonWreckSalvageNow()`（照「自动续用」那一对写：成功即 `persist` ＋ `notify`）；补 core 导入 |
| `apps/desktop/src/renderer/src/panels/Wormhole.tsx` | `WhHold` 里读 `noCommonWreck` ＋ 货仓页动作行加开关按钮（含注释说明文案映射与先例） |
| `packages/core/tests/wormhole-rare-only.test.ts` | **新增用例文件**（4 条，见 §5） |

**删除**：无。

## 4. 不做（边界）

- **不做乙案**（自动探索那条模拟产线）——船长「只做甲」。
- 不动**采集**（虚空母矿）· 不动**战果结算**的随行战利品 · 不动掉落与堆生成（稀有权重/堆数/体积一律不变）· 不动背包格与"超格丢货"口径 · 不动数值。

## 5. 验证

- **新增用例 4 条**（`tests/wormhole-rare-only.test.ts`）：
  ① 打开后**只收稀有**、普通留在原地、仍扣 1 回合、日志 `{p1}` = 剩余普通堆数（实测读数：本格 **稀有 1 堆 / 普通 6 堆**）；
  ② **只剩普通 ⇒ 拒绝且不扣回合**（`errorId = core.wormholeSalvage.044`）；
  ③ 关着时**老行为**（稀有拿完接着拿普通）；
  ④ 开关**随档往返**（写档/读档后仍为开；关掉后字段不落档）。
- **实测会红**：临时把筛选判据改成失效（`rareOnly = false`）⇒ ① ② **当场红**（`expected undefined to be defined` / `expected true to be false`），还原后 4 条全绿 ⇒ 非空断言。
- **闸门**：`typecheck` 四包 ✅ · core **288 文件 / 3022 用例** ✅（＋1 文件 / ＋4 条）· `content:check` ✅ ·
  `l10n:check` ✅ · `l10n:params` ✅ · **`ui:rot-check` ✅**（动 UI 必跑）· 桌面构建 ✅。

## 6. 已知取舍（如实记账）

1. **货柜掷骰随"实际收走的堆数"减少**：残骸堆里的 5% 货柜掷骰是**每收一堆掷一次**（既有口径未动）⇒ 打开开关后收的堆少了，掷骰机会随之减少。这是"少拿就少掷"的自然结果，未加补偿。
2. **打开后该格永不"捞空/完成"**（普通堆还在）⇒ `grid.activated` 不记；已核实不挡深入、也不挡信标（信标自己激活）。
3. 日志里的 N 取"**本格此刻还剩多少堆普通残骸**"（每次打捞都会写一条；玩家一眼能看到还剩多少没拿）。若你要的是"本次本该拿、因开关没拿的堆数"，改一行即可。
4. 开关是**跨趟常驻**（落档）；换句话：开过一次以后每趟进洞都默认开着，直到玩家在货仓页关掉。

## 7. 跨模块自报（§十八）

落在**虫洞域**（core `wormhole*.ts` ＋ 界面 `panels/Wormhole.tsx`，同一功能域）· `save.ts` / `l10n/table.ts` / `index.ts` 属**共享底层**（改动理由全落在本域）。
⚠ 按纪律：`save.ts` 是提交钩子的**需裁决**文件 ⇒ 本批**已在落码前把设计（含"要改 save.ts"）报船长并获批**（「其他按你推荐」），提交时用 `--no-verify` 并在汇报里逐条说明改动面。
