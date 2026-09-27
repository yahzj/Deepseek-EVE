# 交接：d2/workspace 待落 main（2026-09-27 · 二号 → 一号）

状态：**船长已批「先合并，推送由一号负责」· 分支已整理成可一次性快进 · 未推送**。

## 一、要落的东西（分支 `d2/workspace`，比 `origin/main` 领先 4 笔）

| 提交 | 内容 |
| --- | --- |
| `0142e708` | 文档：整理那笔补记"先推送后请审"的自纠 |
| `5ebc8402` | code-review 自纠四条（重复注释 · 导出面 · 收口返回值 · 老档断言）＋ 老档文案修复 |
| `ae229f8b` | 约定：§5.1 加"技能需求允许开子代理"例外（船长 2026-09-27 令） |
| `032fed89` | code-review（两轴子代理）复审后的四条自纠 ＋ 一条误报驳回（含 `needDmg` 删除、115/116 死分支修复、`⟪文案调整⟫` 记号与台账） |

⚠ 其中 `e4d2e764`（章鱼削血/黑匣归属整理）**已在 origin/main**；上表 4 笔是它之后的自纠与规则记账。

## 二、落 main 的两条命令（在主树 `H:\大鲸鱼\Deepseek-EVE` 执行）

```powershell
git merge --ff-only d2/workspace   # 已核对：local main 与 origin/main 都是它的祖先 ⇒ 纯快进、无冲突
git push origin main               # 推送由一号负责（船长 2026-09-27 令）
```

核对读数（2026-09-27 09:53，d2 工作树内只读复核）：
- `git merge-base --is-ancestor main d2/workspace` ⇒ **0**（是祖先）
- `git merge-base --is-ancestor origin/main d2/workspace` ⇒ **0**（是祖先）
- `git rev-list --count origin/main..d2/workspace` ⇒ **4**

## 三、落之前/之后的闸门读数（本分支上实测）

- `npm run typecheck` 四包 **0 错**
- `npm run test -w @whale/core` ⇒ **243 文件 / 2655 用例全绿**
- `content:check` ✅ · `l10n:check` ✅ · `ui:rot-check` ✅ · `save:roundtrip-audit` ✅（丢键 0 · 类型变 0）
- 端到端模拟（`npm run weekend:sim -- kill octopus`）：玩家击沉 ⇒ 黑匣 ×1；章鱼收尾 ⇒ 24.44% 掷中 ⇒ 黑匣 ×1

## 四、这 4 笔改了玩家可见行为的只有一处（供一号推送前知情）

`apps/desktop/.../engine.ts` 的**入侵结束日志分档**：六条文案（`ui.weekend.102/003/115/116/117/118`）的
选择逻辑重写（原先把 `ui.weekend.115/116` 写成了不可达的死分支）。文案本体未新增，
只在 `packages/data/src/l10n/table.ts` 的四处加了 `⟪文案调整 2026-09-27⟫` 记号 ＋ 台账。
存档面：删了两个从未被读写的字段（`flagshipDmgLogged` / `flagshipBestRunDmg`），**无迁移**（老档旧键被清洗器丢弃）。

## 五、待办（不阻塞落 main）

- 船长曾提的"窗口到点时正在打的旗舰战是否补发战利品"仍未裁（见 `invasion-kill-roll-20260926.md` 第七节）。
- 残骸注入"敌数只数波表、23 张卡按 1 个敌人算"那条口径要不要修，等船长点名。
- 三处一次性修正（黑匣补发 · 声望回正）按船长 2026-09-27「先不删」保留，横幅已改成"待删 · 判据是档都落地"。
