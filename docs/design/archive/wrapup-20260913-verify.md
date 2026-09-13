# 三号工作树 · 会话收尾归档（2026-09-13）

> **生成即归档**：按 `docs/design/archive/README.md` §3.3 口径（"会话收尾时按船长「收尾归档」指示
> 直接生成的归档件，**不进一线目录**"），本件由船长「没问题，进行收尾归档」直接生成。
> **给接手人**：你是**三号**（核验与收尾），工作树 = `H:\大鲸鱼\Deepseek-EVE-verify`（分支 `verify`，
> **永不直接写主树** `H:\大鲸鱼\Deepseek-EVE`，也**不叫 d3**）。开工顺序 = 本件 → `AGENTS.md`
> （尤其 §2 四步闸门 / §3 验证闭环 / §4 工作区与合入纪律 / §5.1 **禁子代理** / §5.2 冲突先提醒 /
> §1「验收视图默认 = 本地」）→ `docs/roadmap.md` 顶部变更记录 → 按船长派活读对应设计稿 → 最后才看代码现状。

## 0. 当前快照（2026-09-13 收尾）

| 项 | 值 |
|---|---|
| 工作树 / 分支 | `H:\大鲸鱼\Deepseek-EVE-verify` / `verify` |
| HEAD（写本件时） | `a06fda9c`（本件提交后 +1；写卡时 `main` 已前进到 `3839a216` ⇒ 合入前需先并 main） |
| `origin/main` | `f8509d2f` ⇒ **本地未推 33 条**（含三号 6 条 + 一号虫洞/可见性多批；推送闸门见 §7） |
| 四连基线 | typecheck 四包 **0 错** · core **113 文件 / 1149 用例**全绿 · `content:check` ✅ · 桌面 build ✅ |
| 工作区 | **干净**；`tools/_*` 临时探针 **0**（一次性探针全部落在 gitignore 的 `tools/_ui-artifacts/`） |
| 主树本地产物 | `apps/desktop/out/renderer/assets/index-chFC5vUy.js`（10:01 重建，含三号本会话全部改动） |
| 三树 | `main` = `3839a216`（一号）· `verify` = `a06fda9c`（三号）· `d2/workspace` = `cf86ce6a`（二号）· **三树工作区均干净** |
| 验收视图 | **船长默认看本地那份**（`AGENTS.md` §1）⇒ 改完主动提醒他**重启本地** |

## 1. 本会话交付线（三号 · 全部已合入 main）

| # | 交付 | 主要提交 | 状态 |
|---|---|---|---|
| 1 | **三处敌族舰影**：常驻悬赏卡 / 赏金任务窝点卡 / 敌对派系活跃置顶卡，最左侧固定舰影列（口径与舰队卡逐条同款：132 宽 · gap 10 · 容器实测宽 < 702 整列不渲染） | `2da16372` | 已合入（`8f08ec4e` 并 main） |
| 2 | **未探索悬赏卡隐藏**（船长选「乙」）：`BountyPanel` 加 `listed` 过滤 + 条数改按可见数 + 空态；**作废** V13「悬赏情报例外：列表照常可见」 | 同上 | 已合入 |
| 3 | **入场效果位置取证**：实测旧「跃迁环」层偏低 **142~234px**、我方再偏右 37.5px（根因＝锚在泳道中线 + 列左边缘） | 探针读数（见 §4） | 已并入下一项 |
| 4 | **入场效果重做**（船长二次裁定：舰船本体从屏幕外减速飞入）：我方整列 / 敌方逐舰，`is-arriving` + `--arrive-dx/--arrive-ms/--arrive-delay`；**旧跃迁环覆盖层整层删除** | `2b1c1fe9` | 已合入（`da6a7e90` 并 main） |
| 5 | **口径固化 + 边界登记**：新增设计稿 `battle-arrival-flyin-20260913.md`；测试档说明措辞同步；补「极端时序」边界 | `c33e14c7` · `a06fda9c` | 已合入 |

## 2. 接手必读口径（本会话新增或改动，别踩）

1. **悬赏卡的舰影列（三处共用一套）**：`.app-ano-card.is-foe-art` / `.app-station-card.is-foe-art`；
   取形 = `FOE_ART` 敌族形（A~G，240×110）、取色 = `FOE_ACCENT` 族色（与战斗画面同源）、
   族读数据侧 `foeFamilyOf(卡)`：常驻卡 = 本卡 · 窝点卡 = **主题悬赏卡** · 派系置顶卡 = **置顶代表卡**。
   窄窗自适应常量与 `ShipPage` 同值（132 + 10 + 560 = 702）。
2. **未探索星系的悬赏卡不再列出**（`BountyPanel` 的 `listed`；星系条目缺失的脏数据不隐藏——与卡内
   `unexplored` 逐字同式）；**星图侧照旧**：剪影节点 ⚔N 徽标 + 剪影行动窗「悬赏情报 N 处」仍是协会共享情报。
   ⇒ **V13 旧条款「悬赏情报例外：列表照常可见」已作废**（`v13-exploration.md` §四 + 状态行、`architecture.md` 均已标）。
3. **战斗入场动画 = 舰船本体飞入**（不是覆盖图形）：入场那侧元素挂 `is-arriving` +
   `--arrive-dx`（起点位移，按布局现算）/ `--arrive-ms`（950）/ `--arrive-delay`（i×60ms），
   关键帧 `app-bts-arrive-fly`；**只走 transform/opacity**、终点恒 `translateX(0)` ＝ 战斗位置；
   窗口 `ARRIVAL_FX_MS = 1300`（战斗时钟口径，只演一次）；**洞内 = 敌方、洞外 = 我方**（沿用首版口径）。
4. **合并冲突「并集」不等于「留 HEAD 版」**：两侧同名条目可能内容不同（本会话「洞内收口审计」条
   main 版更新）⇒ 必须逐字比对后取**较新**那份，再跑三条自检。

## 3. 挂着的未决项（**等船长，别自己开工**）

| 项 | 内容 | 卡在哪 |
|---|---|---|
| **入场动画观感/参数** | 时长 950ms · 错峰 60ms · 缓动 `cubic-bezier(.12,.75,.2,1)` · 起点余量 40px · 要不要拖影/尾焰拉长 | 等船长看过本地后发话（改前先四步闸门） |
| **推送** | 本地**未推 33 条**（三号 6 条 + 一号虫洞/可见性多批） | **船长说推才推**；推后照例写推送回执 |
| **公告口径** | 入场动画按「表现层小改、不单独发公告」处理 | 若要并入虫洞拍板那批，届时补进待审稿 |
| **极端时序边界** | 界面若在开战 **350ms 之后**才挂载 ⇒ 飞入会被 1300ms 窗口截断（正常入口点击即刻挂载、实测首帧 5ms，不触发） | 设计稿 §4 已登记；日后出现按"按挂载起算"一行级修 |

## 4. 关键落点

- **界面**：`panels/Expedition.tsx`（`FoeArt` / `useFoeArtFit` / `BountyPanel.listed` 与空态）·
  `panels/BattleScreen.tsx`（`ARRIVAL_FLY_MS` / `ARRIVAL_STAGGER_MS` / `ARRIVAL_EDGE_MARGIN` /
  `arriveDxMe` / `arriveDxFoe` + 两处 `is-arriving` 接线）· `styles.css`（`.is-foe-art` 三条 +
  `.is-arriving` 与 `app-bts-arrive-fly`）
- **文档**：`docs/design/ship-battle-art/battle-arrival-flyin-20260913.md`（入场动画口径 · **已确认并实现**）·
  `docs/design/v13-exploration.md` §四 · `docs/architecture.md` §探索迷雾 · `docs/test-saves/README.md`（虫洞测试路径措辞）
- **探针**（gitignore 的可重建产物，随取随用）：`tools/_ui-artifacts/{arrive-fly.mjs, arrive-shots.mjs,
  warp-pos.mjs, warp-pos-foe.mjs}` + `shots/*.png`（含 `arrive-mid-1.png` 飞行中被左缘裁切那一帧）
- **工具**：`npm run typecheck` · `npm run test -w @whale/core` · `npm run content:check` · `npm run build`

## 5. 血泪清单（本会话真踩过的，按发生顺序）

1. **PowerShell `Get-Content`/`Select-String` 读 UTF-8 中文会乱码**：我据此差点误报"存档/文档被转码"。
   ⇒ 一律用 `read`/`grep` 工具，或 .NET `ReadAllText(path, UTF8Encoding(false))`。
2. **`edit`/`write` 前必须先用 `read` 工具读过该文件**（否则报 `file changed since it was read`）；
   **`write` 新建文件默认 LF**，入仓文件必须 **CRLF**（本会话新建的设计稿踩了一次，已用 .NET 归一后复查）。
3. **`git checkout -- <路径>` 会丢未暂存改动**（旧血泪）：本会话改用"先 `git diff > 补丁` 再 restore"，
   半成品一律先落补丁（`tools/_ui-artifacts/warp-pos-fix.patch` 就是这么留下的）。
4. **解合并冲突"并集"不能盲留 HEAD**：两侧同名条目内容可能不同（收口审计条 main 版更新）⇒ 逐字比对取较新。
5. **位置类表现层改动别只验结构**：一号那版只验了环数/颜色/绝对定位，**位置偏低 142~234px 没人发现**，
   是船长肉眼报出来的 ⇒ 位置必须量"元素盒 vs 目标盒"偏差。
6. **负向验证必须真红**：本会话三轮都做了（舰影 23→0 · 未探索卡 1→23 张 · 飞入首帧 −217→+36），
   红过再还原并复跑确认读数逐字一致。

## 6. 交接时先做这三件事

1. **核基线**：`git -C verify log --oneline -1` 与 `main` 同点？两边 `git status` 干净？四连复跑一次（约 2 分钟）？
2. **读**：本件 → `AGENTS.md` → `docs/roadmap.md` 顶部 3 条 → 按船长派活读对应设计稿。
3. **等派活**：§3 未决项**不要自行推进**；任何改动走**四步闸门**（集中提问 → 中文设计总结 → **等显式确认** → 实现），
   实现后把决策落进 `docs/design/…`（标注状态），并跑四连 + 负向验证。

## 7. 推送与更新状态

- **未推**：`origin/main` = `f8509d2f`，本地 `main` 领先 **33 条**（三号 6 条 + 一号虫洞 A~F 多批与可见性批）。
  **船长一句话即可推**；口径 = 只推代码与已批公告（本会话两条改动都**不含公告**）。
- **GitHub 今日时通时断**：单次 `push` 常报 `Failed to connect to github.com:443 after ~21s`；
  有效做法 = **密 retry**（每 3~10 秒一次、最多 10~20 次）+ 用 **`git ls-remote origin refs/heads/main`** 核对远程。
- **推送后照例**：写一条「推送回执」进 `docs/roadmap.md`（范围 + 核对 + 波折 + 公告口径），一并推上去，
  保持 `origin/main` = `main`。

---

_起草：三号（`H:\大鲸鱼\Deepseek-EVE-verify`）· 2026-09-13 · 状态：**会话收尾归档件（生成即归档）** ·_
_基线：`verify` = `a06fda9c`（写卡时；`main` 已到 `3839a216`）· 四连全绿（core 113 文件 / 1149 用例）· 工作区干净 · `_` 探针 0_
