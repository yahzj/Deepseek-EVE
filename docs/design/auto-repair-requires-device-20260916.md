# 洞外「受损自动修补」改为**需要船体维修装置**（2026-09-16）

> **状态：已落码待验收**（工作文档；船长验收 + 合入 main 后按 AGENTS.md §8 归档三步：
> 并入 roadmap ＋ 词典登记 → 删本文件 → 重跑 `docs:index`）

## 一、船长原话（照抄）

- 第一条：「**虫洞外，原本的损伤严重自动消耗维修组件功能，需要修改。改成需要玩家携带对应的船体维修装置。
  消耗的维修组件类型也跟着装置走。**」
- 第二条：「**记得相关通讯也要一块修改。**」

## 二、改的是什么（旧口径 → 新口径）

| 项 | 旧口径（**作废**） | 新口径 |
|---|---|---|
| 前置条件 | 不看装置：装甲或结构 <50% 就地自动用组件修 | **必须装着船体维修装置**（中槽）；没装 ⇒ **一枚组件都不动、不写日志** |
| 取件序 | 民用优先 → 军用 → 其它带回复值的组件 | **只吃装置指定的那一种**：民用装置 → `repairkit-civ`；MK1/MK2 → `repairkit-mil`；两者都装 ⇒ 两种都能吃（装配顺序） |
| 来源 | 重复清剿只读货舱；低安遇袭＝货舱优先、仓库兜底 | **不变** |
| 修复量 | 组件基础值 × 层容量增幅 × 舰体快修学 | **不变**（组件数值一字未动） |
| 判定返回值 | `outOfKits = !reached` | 新增 `hasDevice`；**没装置时 `outOfKits` 恒为 `false`** ⇒ 低安遇袭**不会**把"没装装置"误判成"断料返港"（只按结构线判） |
| 无组件自愈件（`repairFree` 生体件） | — | **不算**驱动自动修补的装置（没有 `repairKit`，不吃组件） |

**两个调用点**（洞外，全部走单点 `shipyard.repairWithKitsFor`）：
① **重复清剿自动再出发**（`expedition.advanceAutoLoopBounty`，阈值 50% / 目标 60%）；
② **低安遇袭收场**（`encounters.settleEncounterTail`，目标 `encounter.repairTargetFrac`）。
⚠ **手动「使用修理组件」按钮未动**（船长指示只针对"自动消耗"那条链）；洞内维修装置脉冲也不受影响。

## 三、落码清单

| # | 文件 | 改动 |
|---|---|---|
| 1 | `packages/core/src/shipyard.ts` | 新增 `repairKitIdsOf`（装置 → 组件映射，装配顺序去重）；`RepairWithKitsResult` 增 `hasDevice` / `kitIds`；`repairWithKitsFor` 加装置门槛 ＋ **只吃装置指定组件**；`takeRepairKit` 改为按白名单取件（删掉"民用优先/兜底其它组件"）；日志点名实际消耗的组件种类；`repairWithKits` 改为返回完整结果 |
| 2 | `packages/core/src/expedition.ts` | 自动环停环理由分两种说法：**未装装置** / **对应组件耗尽**（玩家下一步动作不同） |
| 3 | `packages/core/src/encounters.ts` | 头注按新口径改写（逻辑本身不变：`outOfKits` 天然为 false） |
| 4 | `apps/.../Handbook.tsx` | 「受损后先修再判」两条改写：写明"需装维修装置 ＋ 只吃与装置对应的组件" |
| 5 | `packages/data/src/messages.ts` | **两条通讯一并改**（船长第二条指示）：`msg-lowsec-rules`（低安须知末条）与 `msg-ambush-retreat`（被袭自动撤离，正文 4 段 ＋ 跳转提示）——都写明"装着维修装置才自动修、组件随装置" |
| 6 | 用例 | 新增 `tests/auto-repair-device.test.ts` **7 条**（没装置不修/民用只吃民用/MK1 只吃军用/装置在但没对应组件＝断料/两装置都能吃/生体件不算/修复量口径不变）；改既有夹具：`b1.test.ts`（4 处装装置 ＋ 新增"没装置"用例）· `expedition.test.ts`（2 处装装置 ＋ 新增"没装置 ⇒ 停环且理由点名"）· `t8.test.ts`、`hull-persist.test.ts`（装装置 ＋ `repairWithKits` 返回值改口） |

## 四、验证（2026-09-16 实测）

- [x] `npm run typecheck` 四包 **0 错**
- [x] `npm run test -w @whale/core` **152 文件 / 1636 用例全绿**（新增 7 ＋ 4 条口径用例）
- [x] `npm run content:check` ✅（通讯/手册文案过"文案纯净契约"——⚠ 过程里踩过一次：PowerShell
      `Set-Content -Encoding UTF8` 把新测试文件写成乱码，已按仓库纪律改用 .NET `WriteAllText` 重写并三查）
- [~] `npm run ui:rot-check` ✅ · 构建与 Pages 核验见 §六
- [x] 负向验证（结构性）：旧口径下"没装置也能修"的路径已被用例钉死为正红（`hasDevice=false` ⇒ `used=0`）

## 五、玩家可见面变化（供公告判定）

- 装了维修装置、带对应组件的船：**行为一字不变**（照旧自动修补）。
- **没装装置的船：不再自动修补**（以前会自动吃组件）——低安遇袭时它只按"结构 <50%"那条线决定是否返港；
  重复清剿会在出发前停环并提示"自动修补需要该船装着船体维修装置"。
- 通讯/手册已同步。**公告待审稿**：`docs/design/announcement-draft-20260916-repair-needs-device.md`（待船长批）。

## 六、遗留与后续

1. **存档/迁移**：零迁移（不新增字段，只改判定）。
2. **词典两条现行词条需要改写**（§8 纪律：工作期间不动旧文档 ⇒ 归档时改）：
   `docs/glossary.md` 的「**修理组件**」条（"自动链"那句）与「**遇袭后自动维修（先修后判）**」条
   （"取件序民用→军用"已成为"取件随装置"）。
3. **公告**：待审稿已写好，请船长批准后写入 `announcements.ts`（或选择不发——历史公告按纪律不回改）。
4. 归档：验收后按 §8 三步并入 roadmap ＋ 词典（含上一条改写）＋ 删本工作文档 ＋ 重跑 `docs:index`。
