# 章鱼人削血与旗舰黑匣归属 · 代码整理（2026-09-27 · 二号 · d2）

状态：**已整理 · 自测全绿 · 待船长审核（未验收）**。按 AGENTS.md §8 归档。

> 🔴 **流程自纠（2026-09-27 船长指出：「你是不是忘记要让我审核了」）**：本笔（`e4d2e764`）**先推送、
> 后请审** —— 违了 AGENTS.md §4 的推送闸门（"只有该工作确实完成（自测全绿 ＋ **船长验收口径满足**）才推送"）
> 与 §2 的验收顺序。整理虽零行为变化，但**删了 2 个存档字段与 3 个导出**，属于必须船长点头的改动。
> **处置**：① 本文件与代码提交一并标"待验收 · 未验收"；② 船长不认可 ⇒ `git revert e4d2e764` 一笔回滚
> （本笔自包含，无迁移、无后续依赖）；③ 此后同类"整理/删除"一律**先递审、等点头再推**。

## 船长原话（照抄）

> 「**整理下关于章鱼人削血和BOSS黑匣归属的代码，从昨天到今天反复改，感觉会出现多余代码和重复废码**」

## 一、整理结果（每条都先取证再动）

| # | 发现 | 处理 |
| --- | --- | --- |
| ① | **"章鱼人得手"那段三行写了两次**：`weekendTick` ③（视图/离线判定那一路）与 `weekendTickBoss`（逐拍削血那一路）各写了一遍「掷黑匣 ＋ 写 `flagshipDown` ＋ 结束本场」，而 2026-09-26 那次漏掷的根因**正是"只有一处掷骰"** | 收成单点 **`weekendClaimOctopus(state, ev, nowWallMs)`**，两条路径都调它；沿革注释一并搬到该函数头注 |
| ② | **归属判据写了两遍**：结算快照（core）与引擎结束日志（desktop）各自拼一遍"留档优先 vs `flagshipDown`" | 收成 **`weekendFlagshipOutcomeOf(ev)`**（core，留档优先）；快照与引擎都读它，界面只留"文案分档" |
| ③ | **死字段 `flagshipDmgLogged`**：全仓只有"类型声明 ＋ 存档清洗/写回 ＋ 一条只测往返的用例"，**无任何业务读写**（幂等实际走 `flagshipRunId`） | 删除（类型 · save 两处 · 用例两行） |
| ④ | **只写不读的 `flagshipBestRunDmg`**：同上，注释写着"只作读数/展示"但**没有任何读取点** | 删除（类型 · save 两处 · 写入那一行 · 用例两行） |
| ⑤ | **生产零调用的导出 `weekendNotePlayerWin` / `weekendNoteRepel`**：只有用例在用；同一套 +10%/+5%/+3%/+1% 早已收口在 `weekendResolveBattle` ⇒ 同一口径的第二份实现 | 删除（函数 · barrel 两行）；用例改为直接钉单点 `weekendNoteContribution` ＋ 结局门禁 |
| ⑥ | **`weekendDeadlineMs`**：`weekendFlagshipWindowMs` 的纯别名，自己注释都写"新代码请直接用后者"，生产零调用 | 删除（函数 · barrel 一行 · 用例一行） |
| ⑦ | **只在本文件内用的符号挂在公共导出表上**：`WEEKEND_BLACKBOX_MIN_ON_LAST_HIT` · `WEEKEND_BLACKBOX_MAX_OFF_LAST_HIT` | 从 `index.ts` 导出表移除（符号本身保留给爆率表内部用；外部要用爆率走 `weekendBlackBoxChanceOf`） |
| ⑧ | **"血条还剩多少"三处各算一遍**：`weekendFlagshipHpRemaining`（抬到 ≥1）· `weekendFlagshipDefeated`（≥ 池子）· `weekendBossPoolView` 的 `hpLeft`/`needDmg` | 收成 **`weekendFlagshipRemainingOf(ev)`**（原始剩余），上述三处全部由它派生。⚠ `weekendOctopusTick` 的 `need` **语义不同**（"章鱼还差多少才够得手"）⇒ 刻意不派生，注释里写明 |

## 二、刻意**没**动的（免得改出行为差异）

- **两条到点路径仍然并存**（逐拍削血 vs 视图/离线判定）：它们覆盖**不同时机**（在线逐拍 vs 离线保护失效＋窗口到点），
  合并会改口径 —— 本次只把"得手之后那三行"收成一个单点。
- **`weekendOctopusTick` 的 `need <= 0` 早退**：血条已被玩家打空时**不由章鱼认领**（归玩家），这条守卫保留。
- **一次性补偿**（`compensateMissingWeekendBlackBox`）与声望回正：船长 2026-09-27 复令「先不删」，原样保留。
- **爆率表本身**（`weekendBlackBoxChanceOf`）与"哪条路径该掷"的口径：一字未动。

## 三、验证

- `typecheck` 四包 0 错 · core **243 文件 / 2652 用例全绿**。
- **端到端模拟复跑**（`npm run weekend:sim -- kill octopus`，真档 ＋ 真引擎路径）：
  - `kill`：池子 150,000/150,000 ⇒ `flagshipDown=player` · 黑匣 ×1 · 快照 `outcome=player` ✓
  - `octopus`：p = 97.75% ⇒ 爆率 24.44% ⇒ **掷中** · 黑匣 ×1 · `outcome=octopus` ✓（漏掷那条修复仍在）
- `content:check` ✅ · `l10n:check` ✅ · `ui:rot-check` ✅ · `save:roundtrip-audit` ✅（丢键 0 · 类型变 0）。
- 删字段的存档影响：老档里那两个键会被清洗器丢掉（与其它退役字段同款），**不留迁移**。

## 四、给下一次接手的一句话

这块现在的单一出处：**得手收口 = `weekendClaimOctopus`** · **归属 = `weekendFlagshipOutcomeOf`** ·
**血条剩余 = `weekendFlagshipRemainingOf`** · **爆率 = `weekendBlackBoxChanceOf`** ·
**占比 = `weekendFlagshipSharesOf`**（玩家优先）。要改口径请改这几处，别再往调用点里塞平行实现。
