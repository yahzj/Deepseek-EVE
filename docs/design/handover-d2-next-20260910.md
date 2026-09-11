# 二号交接卡 · 给下一位二号（2026-09-10 会话结束时写）
> **2026-09-11 状态标注（一号补）**：§7 待办 **第 1/2/3 条已结**（公告已批复并写入 3 张、混伤副作用复核选甲·维持现状、lairgear 验收档已交付）；**只剩第 4 条「点防 PD 六参数」等船长一句话**——该六项已收口在 `docs/design/drone-losses-20260910.md` **§6.1**（原写"二号设计稿 §八"是失效引用）。另：§0 的基线 commit 与"未推送数"是易变值、已过期，以 `git log origin/main..HEAD` 为准。


> **先读这三份，再动手**：① 仓库根 `AGENTS.md`（可执行约定精简版）② 本文件（开工卡）
> ③ `docs/design/handover-d2-20260910.md`（上一任二号的**收尾归档**：逐批次改了什么、验证快照、
> 新字段/契约/护栏全集、可调旋钮索引、踩坑记录）。
> 细则冲突一律以 `docs/development-conventions.md`（权威正文）为准。

---

## 0. 你是谁、在哪干活

- 你是**二号**（上一任二号的接任者）。船长是最终决策者，一号在主树工作、三号负责 verify 分支收尾。
- **你的工作区**：`H:\大鲸鱼\Deepseek-EVE-d2`（git worktree，分支 `d2/workspace`）。
- **主树**：`H:\大鲸鱼\Deepseek-EVE`（分支 `main`，**一号与船长独占**）。
- 你在 d2 干活、在 d2 提交；**永不直接写主树文件**。

## 1. 开工三步（每次会话都做）

```powershell
# ① 核对基线：d2 与 main 谁领先、两个工作区脏不脏
git -C H:\大鲸鱼\Deepseek-EVE-d2 log --oneline -1
git -C H:\大鲸鱼\Deepseek-EVE     log --oneline -1
git -C H:\大鲸鱼\Deepseek-EVE-d2 status --porcelain
git -C H:\大鲸鱼\Deepseek-EVE     status --porcelain
# ② 落后 main 就先合过来（见 §3 SOP）
# ③ 跑一遍验证闭环确认起手是绿的（见 §9）
```

## 2. 七条铁律（违反会被船长拍）

1. **一律中文**：沟通、文档、注释、文案、日志。
2. **四步闸门**：集中提问 → 中文设计总结（方案/取舍/数值/边界，末尾写"请确认"）→ **等显式确认**
   （"没有反对"≠确认）→ 才动工。实现中发现要推翻已确认设计 → 停下重走。
   **数值/平衡改动尤其必须先拿到船长的数**（他会逐条改数，照抄他的话）。
3. **完成即合入**：一件活自测全绿 → d2 提交 → 合 main（§3）→ d2 追平。
4. **推送闸门**：只做本地 commit，**绝不 `git push`**；等船长验收 +（大更时）公告批准后，由船长拍一次推。
5. **玩家可见文本要"干净"**：UI/日志/公告/任务/手册里不得出现开发或验收话语（校准/复测/口径/待定/参数名）。
6. **写文件用编辑器工具**：`write`/`edit`。**别用 PowerShell `Set-Content` 改仓库文本**
   （会加 UTF-8 BOM；本会话真踩过）。同理：本机 PowerShell 是 **5.1**，`Select-String` 默认按 ANSI 读文件，
   **中文检索会假阴性** —— 查中文一律用 `grep` 工具或 `read`。
7. **动数据先看护栏**：改 `modules.ts`/`items.ts`/`anomalies.ts` 等先跑 `npm run content:check`，
   它会拦下契约违规（值域、互斥、来源唯一、数量上限…）。

## 3. 合入 SOP（本会话踩坑总结）

```powershell
# ① 先看主树脏不脏：他脏，且脏的文件与你改动重叠 → 停手，报告船长协调（绝不 force）
git -C H:\大鲸鱼\Deepseek-EVE status --porcelain
# ② 主树干净（或脏文件与你无关）→ 在 d2 合 main
git merge main --no-edit            # 冲突通常只在 docs/roadmap.md
# ③ 解冲突后提交合并
git add -A ; git commit --no-edit
# ④ 再把 main 快进到 d2
git -C H:\大鲸鱼\Deepseek-EVE merge --ff-only d2/workspace
```

- **`ff-only` 被拒**（`Your local changes to the following files would be overwritten`）= 一号在途改动压在你改的文件上：
  **停手 → 报告（证据/影响/判断/建议）→ 等他提交 → 再三方合并**。会话里发生过两次（`lair.ts`/`salvage.ts`/`types.ts`、
  以及他改了你的测试文件 `lair-gear-g.test.ts`）。
- **`docs/roadmap.md` 是最高频冲突点**（两位 agent 都往顶部插条目）：口径 = **两条并存**。
  实操：`git checkout --theirs -- docs/roadmap.md` → 用编辑器工具把自己的条目重插到顶部 →
  **⚠ 必须再 `git add docs/roadmap.md` 一次**（`checkout --theirs` 后 `add` 过、再编辑就没进暂存区，
  合并提交会漏内容——本会话踩过两次）。
- 合并前**必须**重跑验证闭环（别人的改动可能与你交互）。

## 4. 当前基线（写这份卡时）

| 项 | 值 |
|---|---|
| d2 = main | `408440d`（交接卡提交后会再 +1） |
| core 测试 | **785 / 785** |
| 其它验证 | typecheck ×4 绿 · content:check 通过 · desktop build 绿 |
| 未推送 | **本地领先 origin 120 个提交**（推送闸门） |
| 工作区 | d2 与 main 均**干净**；`tools/` 下**无 `_` 临时探针** |
| 环境事实 | 本机 PowerShell 5.1；`git` warning 里出现 "LF will be replaced by CRLF" 属正常 |

## 5. 你接手的是什么（本会话引入的引擎能力，改它之前先读归档 §3）

- `ModuleDef.repairFree`（无消耗自愈，与 `repairKit` 互斥）
- `ModuleDef.hullResistAdd`（结构层抗性）
- `ModuleDef.speedPenaltyPct`（机动代价：只挂装甲容量件、进战斗只取最重一件）
- `ModuleDef.hullHpBonus`（结构层容量——此前唯一没有容量模块的一层）
- `ItemDef.exclusive`（专属型号：只在高级箱出、四型定位契约豁免区间校验）
- `AnomalyDef.dmgMix` **语义已变更**：正权重键 = 参战系（≥2 系即混伤）——旧的"缺省键权重 1"作废
- 专属池 `FOE_LAIR_GEAR` **可混装模块与物品**（模块进装备库、无人机进物品仓库，一次 10 架）
- `equipment.ownedItemCount` / `salvage.RARE_BOX_DRONE_UNITS` / `lairs.FOE_SUB_DMG` / `LAIR_SUB_DMG_SHARE`
- `combat.foeDamageComposition` / `splitShotByComposition` / `applyFoeShot`（混伤三件套：战斗/预估/界面同源）
- `data/droneRoles.DRONE_ROLE_ANCHORS`（四型锚点机型：阶梯与单发基准只比锚点）

**内容现状**：五族专属装备共 15 件已全部落地（A/C/D/E/G 各 3 件，其中 G 族第一件是专属无人机「流亡蜂无人机」）；
**稀有残骸高级箱已于当日解禁**（一号定稿：专属命中率 **5/8/10%**、**每炉锁死 1 件 = 一炉一箱**）；
敌方混伤已上线（常驻 8:2、窝点 6:4、教学卡纯系）。

## 6. 可调旋钮（改一处即生效，值都写在注释里）

完整表见归档 §4，最常用的四个：
- 混伤配比：常驻 → `packages/data/src/anomalies.ts` 每卡 `dmgMix`；窝点 → `packages/core/src/lairs.ts` `LAIR_SUB_DMG_SHARE`
- 副系归属 → `packages/core/src/lairs.ts` `FOE_SUB_DMG`
- 专属无人机数值/掉落量 → `items.ts` `drone-exile-bee` / `salvage.ts` `RARE_BOX_DRONE_UNITS`
- 15 件专属装备 → `packages/data/src/modules.ts` `mod-lair-*`

## 7. 待办与待船长决策（按优先级）

| # | 事 | 谁推 | 备注 |
|---|---|---|---|
| 1 | **公告批复** | 等船长 | 待审稿：`docs/design/announcement-draft-20260910-d2-batches.md`（五族专属装备 / 敌方混伤 2 张卡）；另有 `announcement-draft-20260910-drone-losses.md`（无人机损失）；三号/一号的 11 张在 `announcement-draft-20260910-pending.md`。**批一条写一条**进 `packages/data/src/announcements.ts` 顶部（未批不动） |
| 2 | **混伤副作用复核** | 船长实测 | 「堆单系抗」变弱；若承伤涨太多，最省旋钮 = 副系份额（8:2→9:1、6:4→7:3） |
| 3 | **验收存档** | 可主动提 | 是否需要"五族装备 + 流亡蜂无人机 + 各档敌军"实测档（`tools/make-test-save.ts` → `docs/test-saves/`） |
| 4 | 更早遗留旋钮 | 等船长 | 无人机战后基础回收率 10%→20%、点防参数、`FACTION_RARE_DROP_CHANCE`（体检仍打印"待船长核定"） |
| 5 | 新活 | 等船长派 | 一号/三号侧的工业页、星图、赏金经济仍在推进 |

## 8. 与一号、三号的协作界面

- **一号**（主树）：工业页、星图徽标、赏金/蓝图/高级箱经济；**冲突热点文件**：
  `packages/core/src/industry.ts`、`save.ts`、`state.ts`、`salvage.ts`、`sideTasks.ts`、`expedition.ts`、
  `apps/desktop/src/renderer/src/pages/*`、`panels/Expedition.tsx`、`docs/roadmap.md`、
  `docs/design/bounty-tasks-20260910.md`、`docs/glossary.md`。
- **三号**（verify 分支）：收尾与验收链，main 历史里有若干 `Merge branch 'main' into verify`。
- 协调口径：**发现对方在途改动压在你的文件上 → 停手报告**，不抢改、不强推；docs 唯一权威在主树。

## 9. 常用命令速查

```powershell
# 验证闭环（每次交付前跑一遍，四项全绿才算完）
npm run typecheck            # core/data/ui/desktop 四个 workspace
npm run test -w @whale/core  # 单文件：npm run test -w @whale/core -- <文件名关键字>
npm run content:check        # 内容体检：交叉引用 + 各类契约护栏
npm run build -w @whale/desktop
# 产物核对（UI 改动的唯一验证手段：查类名/文案是否进包）
Get-ChildItem apps/desktop/out/renderer/assets/index-*.js | Sort-Object LastWriteTime -Descending | Select-Object -First 1
# 数值/经济工具（结果贴给船长看）
npm run battle:calibrate     # 战斗矩阵（D1/D2/D2b/D3 行）
npm run battle:drone-vs-gun  # 无人机流 vs 炮流
npm run battle:pd-tune       # 点防参数调参
npm run battle:hit-profile   # 命中/衰减剖面
npm run bounty:econ          # 赏金/高级箱经济对照
npm run salvage:econ         # 回收经济
npm run balance              # 平衡体检
```

## 10. 经验教训（本会话踩过，别重复）

1. **别用 PowerShell 改仓库文本**（BOM）；**别用 `Select-String` 查中文**（假阴性）——用 `grep` 工具。
2. **`docs/roadmap.md` 冲突**：两条并存；`checkout --theirs` 后重插自己的条目**必须再 `git add`**。
3. **ff 被拒不是 bug**：是 git 在保护对方的未提交改动 → 停手报告，等对方提交。
4. **测试别依赖取样运气**：本会话把一条"反复开箱撞命中"的用例改成"临时把命中率拉满、只验命中之后的链路"
   （`lair-gear-g.test.ts` 里的写法可直接抄），确定性 + 快 20 倍。
5. **别在同一个文件上和对方并行改**：会话里两次因为抢先改同一文件导致合并受阻。
6. **验证闭环四项一个都不能省**：UI 改动没有测试基建，只能靠 build + 产物核对（查类名/文案在不在包里）。
7. **数值类改动先要船长的数**，别自己"看着办"；他给数时**照原话实现**，有冲突（如与既有契约撞车）**先报告再问**。
