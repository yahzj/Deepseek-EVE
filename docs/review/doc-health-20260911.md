# 文档体检（2026-09-11 · 一号主持，三路只读审计）

> **触发**：船长「顺便检查下现有文档，将明显过时的东西进行清理，精简文档」。
> **方法**：三路并行只读审计（① 早期/中期设计稿 76 份 ② 2026-09-06~11 近期稿 + 公告待审稿 + 交接件 68 份
> ③ 根目录文档 + `docs/review/` + 资源），**逐条以「文件:行 / grep 命中 / 代码现值」为据**，禁止凭感觉判旧。
> **本件是审计的收尾归档**：已修的直接写进文件，**未修的逐条留在这里**（含依据与建议），供日后增量清理。
> 审计纪律：全程只读，零写入、零 git；所有行号以 **2026-09-11 07:5x 快照**为准。

## 0. 结论先行

- **文档总量**：`docs/` 共 260 个文件 / 17 MB。其中 md **128 份 / 1.4 MB**（`roadmap.md` 288 KB 占五分之一）；
  `docs/design/` md **116 份** = 设计稿 100 + 公告待审稿 7 + 交接件 9；二进制资源 **14 MB**
  （`docs/Small 512x512/**` 星云源图 7.5 MB + `docs/test-saves/*.json` 6.6 MB）。
- **最过时的两份**：根 `README.md`（还停在"M0~V12、战斗 P2 待做"）与 `docs/architecture.md`（"当前结构版本 v18"，
  实际 **v24**；里程碑表停在 V16.1/T10）——**均已在本轮修正**。
- **"术语权威"自身有矛盾**：`docs/glossary.md` B3 节有 **4 组新旧口径并存**（其中 3 组旧行还标着"定稿"），
  已全部标注作废并指向新行；另修 4 处失效引用（"老大"/缺三号/"副本"/"待实施"）。
- **零删件**：三路一致判定**没有可以无脑删的文件**。可整理的是「**归档**」（搬进 `docs/design/archive/`）
  与「**加状态标注**」两类，均列在 §3、§4，**等船长点头再动**。
- **代码侧零改动**：本轮全程 docs-only（含 `README.md`/`AGENTS.md`/约定文档），未动任何 `packages/**`、`apps/**`、`tools/**`。

## 1. 本轮已修（docs-only；两批提交）

### 第一批 `0611d5e`

| 文件 | 修了什么 |
|---|---|
| `README.md` | 删掉 M0~V12 逐里程碑流水（194 行 → 约 120 行），改为「现在的形态」总览表（口径现场实测：技能 78 项/7 组、矿带 17、装备 98、舰船 25、蓝图 89+24、市场卡 281、星系 20、工业 AI 工位满技能 20）+ 常用命令表补齐 13 个 npm 工具 + 文档入口表；并写明"流水与路线图只在 roadmap/design 维护，本页不再留第二份" |
| `AGENTS.md` | §4「两 agent 并行」→「**多 agent 并行**」并补记**三号工作树 `…-verify`（分支 verify，不叫 d3）**；§0 会话清单补三号；§0.1 文档清单的「89 份」→"现约 100 份，以目录为准"并补列交接件 |
| `docs/development-conventions.md` | §三 物理隔离条补第三工作树、二号 → 二号/三号（含三号合入舞步）——**只补记既有事实，未改规则** |
| `docs/development-conventions-changelog.md` | 追加一条变更记录 |
| `docs/glossary.md` | 「精炼炉」由"母港单工位（refineRun）"改为"**循环批处理工位表 `refineRuns`（v19 起）**，主控亲自至多 1 台、其余各由一枚闲置 AI 核心驱动" |
| `docs/design/industry-ai-slot-expansion.md` | 补 2026-09-10 变更注：`industrySkillIds + industrySlotsPerLevel` → **`industrySkillSlots` 映射表**；站内工位 15 → **20**；content:check 双向护栏 |
| `docs/design/captain-skill-audit-batch.md` | §⑩ 补变更注（上限字段更名 `aiCoreCap`；"设施侧并行上限 = 核心库存"作废） |

### 第二批（本条所在批）

| 文件 | 修了什么 |
|---|---|
| `docs/architecture.md` | ① 结构版本 **v18 → v24** 并补 **v19~v24** 六行（精炼多工位 / 原料不锁定 / 制造多线 / 承伤持久化 / 序章 / 任务中心；此后多为 v24 兼容字段）；② `advanceGame(state, deltaMs, ctx, opts?)` 签名与 `opts` 三项；③ 日志口径改为"**存档不含日志**，`DEFAULT_LOG_CAP=300` 只是本局内存上限"；④ 数据层一句话与 §决策 4 的矛盾合并；⑤ 里程碑表补 **V16.2/V17 系/V18 系/T11** 摘要行 + "2026-09-07 起批次见 roadmap"指针（不再逐条追平） |
| `docs/development-conventions.md` | ① 补**章节编号说明**（**第四章自建文件起即缺号**，不回收不重排，以免破坏全仓按号引用；已用 git 首版核实是历史遗留、非本轮丢失）；② 开篇"每轮开工先读本文件"→ 与 `AGENTS.md §0` 一致的"先读 AGENTS.md、按索引只读需要的几份"；③ §二"先读：AGENTS.md → 本文件 → …"同步；④ 「Hindsight 记忆」→ DSH 记忆工具；⑤ §三 标题去掉"大鲸鱼二号" |
| `docs/glossary.md` | ① B3 节 4 组旧口径标**作废**并指向新行（base 曲线 / 保底 5 / 击杀注入 `威胁×0.4` / 回升 4h）；② 「保底稳态产出」按现码改正（阈值 **10**、mul = max(0.5, 密度/10) → 稳态系数 **1.0**）；③ 「市场蓝图出现率」"待实施"→ **已落地**（`blueprintWeight 0.05`、寿命 6h、碎片 25/250）；④ 「老大」→「**船长**（旧记老大）」；⑤ 「一号/二号」→ 补 **三号**；⑥ 「主仓库/副本」→「主仓库/**工作树**」（副本模型已废） |
| `docs/design/drone-losses-20260910.md` | §二表「回收 10% / 每级 +8%」→ 标注**基础 20% / 每级 +6%**（并补当日追加的"优先回收高价值 + 战报明细 + 战报 12 秒"） |
| `docs/design/market-rarity-tier-20260909.md` | 头部加"§一 是决策原文留档、现行值以 §二 为准"；§一.7 的 0.25 标注已被 0.15 取代 |
| `docs/design/power-ladder-rework.md` | 头部「待确认」→ **"已是证据与口径权威件"**（§六 暂停复调、§7.3 最终口径、§7.4 推进器复核），并写明工具与证据路径 |
| `docs/design/b3-salvage.md` | 头部「汇总待确认」→ **已实现并上线**，并声明"数值以顶部 🔁 段为准、正文旧数（保底 5 / 4h / 档位 20-30）为立稿留档" |
| `docs/design/wave-battles-20260909.md` | 「待终审」→ **已确认并实现·待验收/待发布**（`waves` 已落码） |
| `docs/design/ship-size-tier-rework.md` | 「实现中、不合并 main」→ **已确认并实现、已合入 main**（⑧ 划掉）；未发布的只剩公告 O6 |
| `docs/design/ship-battle-art/README.md` | 枪口锚「35→39」→ **35→42 / 66→79**（与 `battleViewCore.tsx` 的 `NOSE_MAIN/NOSE_ESC` 同源），并把"待目测=能否接入"改为"已收口，待目测的是 09-10 挂点对齐" |
| `docs/design/captain-skill-audit-batch.md` | 卷 B1「MK2 需 100 片 / MK3 需 1000 片」→ **25 / 250** |

## 2. 未修：早期稿的事实漂移（**33 份**，逐条留档）

> 判据 = 与**当前代码**矛盾（已给 file:line）。这些稿子多为 2026-09-04~06 的立稿，数值被后续批次覆盖。
> **处理建议（见 §5 待船长定）**：统一加"历史留档"横幅 + 只逐个修**高危险项**（会被后人照抄进代码的）。
> 标 ✱ = 建议优先修（错的是**现行机制**，不是旧数字）。

| 文件 | 过时点（可核） | 建议 |
|---|---|---|
| ✱ `v12-combat.md` | §七「超时按剩余血量比判胜」**作废**（`combat.ts:2259-2261`：一律判负并按撤退处理）；§二/§四「无人机不损毁」已被 `balance.ts:232` 推翻；稿头"P2 待做"vs 已完成 | 改超时/无人机两句 + 补状态 |
| ✱ `v18b2-lasers.md` | 「转化 50%、远端 ×0.65」vs `combat.ts:74`「幅度 = 命中衰减的 **0.8 倍**（2026-09-08 船长定）」（例 ×0.44）；`combat.ts:549` 旧注释同源 | 改 0.8/×0.44，顺手清 `combat.ts:549` 注释（**改代码注释属代码侧，另报船长**） |
| ✱ `t9-substations.md` | Q3/Q4 被推翻：`stations.ts:5`「建材只收**精炼矿物**、排除原矿」、`:7`「**建成前不视为任何站点**」；「母港独有市场/制造台」被 `location.ts:98 isAtHomeLike` 推翻 | 三处改写 |
| ✱ `c6-drone-vs-gun-20260910.md` | §九表 220/184、183/175 已被 `drone-roles-20260910.md:122`（245/206）与 `battle-data/drone-vs-gun-shipbonus-20260910.txt` 取代 | §九 标"已被取代"；同步 `drone-bay-rework.md:54` 的引用点 |
| ✱ `v9-market.md` | 池量段「三钛池 24 万→30 万、流量 800→1 万」已被 `marketCatalog.ts:47`（poolTarget 2,722,080 / flow 22,684）取代；§八「31 张商品卡」→ 现 281 张 | 只改池量、卡数两处并加指针 |
| ✱ `m1-design.md` | 「任何物品按牌价全量卖站」vs `balance.ts:122` 贸易税 5% + 让利吸收额 | 修订卖出段 |
| ✱ `t4-mining-trips.md` | §1「点开采先出航」vs `mining.ts:232`「**去程取消：指令即视为已抵达**」；"涉及文件"仍列已删的 `switchMiningShip`（全仓 0 命中） | 按头注重写 §1/§2 |
| ✱ `c2-craft-cost.md` | §二价表被 2026-09-10 basePrice 批取代（`mod-cargo-1` 28k → 29,200、`mod-miner-2` 181k → 466,000、`mod-cargo-3` 1,122k → 2,400,000） | 表改指 `npm run price:audit` |
| ✱ `refine-balance-50.md` | §一「min(1.6, 1.0+8%×精炼学+4%×高级回收)」vs `balance.ts:21-25`（1.2 / 6% / 3%）；§四声称的 content-check 产值护栏 grep 0 命中；`m1-design.md:49`、`v10-content.md:76` 仍把它当现行引用 | 降级为**历史锚**并改指 `manufacture-refine-worker-econ.md` |
| `v10-content.md` | §3.4「装备 6→24」vs `modules.ts` 现 98 件；槽位"miner/cargo/turret+3 占位"vs `types.ts` 十四槽；无人机 4 架 1.5/3/6/10 m³ vs 现 5 架 5/10/20/40；`belt-fluxite/crimsonite` 已改名 | 修 6 处 |
| `v10b-combat-data.md` | 稿头"弹药每型单档通用弹"过期（现有 `ammo-kinetic-2`）；无人机 4 → 5 架；`WeaponSize` 确已移除 | 顶部补两句横幅 |
| `v17-modules.md` | §一「42 件」vs 现 98 件；§三「同槽二选一」仍写成现行 vs `modules.ts:37`「**V18.1 已取消同类唯一**」 | 补家族清单 + §三 加取消行 |
| `v17b-weapons.md` | `modules.ts:172-176` kin-1 实为 **3220 m / 1540 ms / minRange 250**（稿写 250–4.6 km / 2.2 s）；稿表 11 件含 exp/pla/proto，代码只剩 civ+kin | 炮表标历史 + 补 V18B 横幅 |
| `v18-slots.md` | `ships.ts:176` 座头鲸 3/2/3（稿 1/2/3）；19 船表缺 6 艘新船；"同类唯一"已删而 §一/§五 仍当硬规则；§三 装备 54 → 98 | §四 改"以 ships.ts 为准" |
| `v18b-missiles.md` | `modules.ts:306-311` 现 7440/3120/1.5、minRangeM 500（稿 6200/2600/1.25、minRange 0） | 按代码更新表 + 补 +20% 横幅 |
| `m0-design.md` | 「×2^(level-1)」vs `training.ts:48` `LEVEL_TIME_COEF [1,2,4,16,64]`；「存档 v1」vs version=24 | 补"以现行代码为准" |
| `m2-design.md` | 「同时只允许一个制造作业」vs v21 多工位；8 分/8k 制造费 vs 现 80 s、制造费已取消；六槽已被高中低取代 | 归档 + 取代标注 |
| `m3-design.md` | 「胜率 = 火力/(火力+威胁)」vs `expedition.ts:117-118` 已改 `battleWinPreview`；6 星系 vs 20；8 目标 vs 26 | 归档 + 取代标注 |
| `m4-design.md` | 炮台 +25%/+60% 与炮台槽已被三类槽取代；A/B/C 基线被经济重做覆盖 | 归档 + 标注 |
| `m5-design.md` | 「奖金 ±15%」vs `balance.ts:77` `rewardJitter 0`；鲸王级 10000 m³ vs `ships.ts:151` 7,000；`shipBay` 被舰队实例化取代 | 修三处 + 取代标注 |
| `t7-time-consistency.md` | 正文「单程约 1 分 24 秒」星图侧已 0 命中 | 按头部 🔁 注记改写正文 |
| `t8-galaxy-stay.md` | 「返航 = 目标↔母港 2×单程」被 `substation-hub-return.md:25` 改为**最近已建成站**（`location.ts:40`、`expedition.ts:79`） | 补 2026-09-08 落点注记 |
| `t10-task-center.md` | `Expedition.tsx:176-177`「常驻悬赏已从任务中心抽出」；默认排序已退役（默认 `'danger'`） | 改写族/标签与排序口径 |
| `b1-lowsec-encounters.md` | 稿内 09-09 行「残骸密度 威胁×0.4」现为**最强悬赏卡注入量 ×0.5** | 改注入口径 + 状态改"已落地" |
| `b3-flavor-content.md` | 表内 6 行档位被 2026-09-10 基础密度口径推翻（`salvageFlavors.ts:64/69/74/99/104/109`）；正文两处仍写「MK3 一律碎片 **1000** 片」（现 250） | 重算 6 行 + 改 250 |
| `ai-design.md` | 「人工智能专家 rank IV」实为 `skills.ts:431` **AI 核心操作学 rank2**；上限"唯一"已被共用上限+工业扩容取代；「奖金 ±15%」同上 | 改技能名/上限/浮动条款 |
| `manufacturing-labor.md` | 「工业自动化」已更名「**产线节拍学**」；尾注"下限 0.6"实为 **0.75** | 改技能名 + 修尾注 |
| `market-detail-rework.md` | 「30 分钟采样 / 48 窗≈24h」vs `balance.ts:101` `tickMs 60 s`（稿、`market.ts:449` 注释、**玩家可见** `MarketPage.tsx` 三处同为 30 分钟） | **先定案**：改稿还是改代码/玩家文案 |
| `weapon-skill-batch.md` | §二族专精 +3% vs `skills.ts:282/289/296` **+5%/级**；火控 r2→r3、装填 r2→r4 且"下限 60%"已拆 | 加"以 skills.ts 为准"注 |
| `win-estimate-mc.md` | §三「批预算 60ms」已被 `engine.ts:388-411` 改为 **8 ms / 每批 2 条** | 改参数行 |
| `blueprint-buildtime-audit-20260909.md` | 装备 12 张耗时列是 **×6 提速前**旧值（`blueprints.ts:103` 现 60 s，原 360 s） | 两列标"已随提速作废" |
| `skill-rank-dispersion.md` | `skills.ts` 贸易谈判学 r4 / 会计学 r3 / 重装舰操作 r3 与稿不符（其余 9 条一致） | **先确认是"漏落码"还是"有意延后"** |
| `copy-sweep/…` 见 §3 | — | — |
| `b3-salvage.md` §五/§六 | 碎片 100/1000 → 25/250；回收 Y 3.9/1.4/0.42 → **5.8/2.06/0.62** | 头部 🔁 已声明以顶部为准，正文两处仍可标旧 |

## 3. 归档候选（**搬进 `docs/design/archive/`，不删**；等船长点头）

> 为什么是"搬"而不是"删"：这些件承载**决策记录**（谁批的、批了哪张、为什么否），删掉就只剩 git 考古。
> 为什么需要点头：`docs/design/*.md` 全仓有 **282 处引用**（其中 112 处在 `roadmap.md`），搬动会留下悬空引用。

| 件 | 理由（可核） |
|---|---|
| 公告待审稿 **7 份**（`announcement-draft-20260909`、`-20260909-blueprint`、`-20260910`、`-20260910-full`、`-20260910-pending`、`-20260910-d2-batches`、`-20260910-drone-losses`） | **每张卡均已处置**：已发布（对照 `announcements.ts` **25 条**，最新 7 条均为 09-10）或船长明判"不发"；7 份顶部多已带「已结案」表 |
| 旧交接件 **3 份**：`handoff-b3-skills`（自述已实施）、`handoff-weapon-skills`（roadmap 已收口）、`handoff-20260910-rarebox-batch`（尾巴已结案、职责被 session-turnover 取代） | 交接使命已终结 |
| 早期立稿 **6 份**：`v7-design`（AI 核心 0~5 级已废）、`opt-task-center-round1`（仅 roadmap 1 处引用）、`perf-monitor`（自标"已归档放置"）、`copy-sweep-candidates`、`copy-cleanup-pending`（两条待办均已闭）、`salvage-autoloop-20260909`（结论已入 `b3-salvage` 与代码） | 结论已被吸收，自身零/低引用 |
| `refine-balance-50.md` | roadmap 明示"现数值以 `manufacture-refine-worker-econ.md` 与词典为准，本稿为历史锚" |

**仍有效、不要动**：`handoff-20260910-session-turnover.md`（当前唯一项目级入口，§5 第 5 条"验收 + 推送"仍开着）、
`handoff-20260909-dsh-reinstall.md`（**最老却仍活**：§三 三项挂账全仓无结案）、
`docs/review/announcement-factcheck-20260910.md`、`pending-decisions-20260910.md`、`toolchain-av-block-20260911.md`。

## 4. 状态标注候选（**原地加一行，不搬**）

| 件 | 建议加的标注 |
|---|---|
| `handover-d2-next-20260910.md` / `handover-d2-20260910.md`（d2 工位） | §7 逐条标进度（第 1/2/3 条已结、**第 4 条点防 PD 六参数仍未结**）；基线 commit 与"未推送数"已过期（各件 120/123/126/172 互相矛盾） |
| `handover-d3-20260910.md` / `handover-verify-20260910.md`（verify 工位） | §3#1 公告 14 张**已结案**；工位是 `…-verify`（**文件名 d3 是历史叫法**，易派错人）；基线 commit 已过期 |
| `captain-skill-audit-batch.md` | 稿头「分卷进行中」→ **各卷已落码/待验收**（A2 §3 限制句已清、⑨⑩⑪ 均有执行记录） |
| `drone-bay-rework.md` / `drone-roles-20260910.md` | 「本轮不实装无人机被击毁」「击落＝下一件工作」→ **已实施**（`settleDroneLosses` / `droneLossReport`） |
| `hull-repair-module-20260909.md` | 「已确认」→ **已确认并实现**（三件齐备，CPU 已 7/17/31） |
| `g-exile-bee-drone-20260910.md` | 「实现中」→ **已确认并实现**（`drone-exile-bee` 已入库） |
| `industry-copy-trim-20260910.md` | §2 悬停示例写死"共用上限 2 + 工业专用 1"→ 已改为**逐技能构成** |
| `page-scroll-layout.md` / `refine-cycles.md` / `c4-calibration-notes.md` / `handbook-guide-rework-20260909.md` | 可精简：过程记录（逐页勾选清单、批预算、文案快照）压成结论 + 指针 |
| `docs/review/A1-bounty-review.md` | 顶部已注"loot 清空、战利品列作废"，但正文仍逐行写"战利品 1~2 种"→ 表头补一行"该列作废" |
| `docs/review/A2-density-review.md` + 3 张 PNG（718 KB） | **唯一未标结案且已被超越**的 review：所述「去程约」「胜利后停留」已 0 命中、星图拥挤判断已被 09-10/09-11 星图改版超越 → 头部标"历史走查，条目已被机制变更取代"；截图只被该件自身引用，建议标"截图 = 2026-09-05 版"或移出仓库 |

## 5. 待船长定（4 件）

1. **§3 归档候选**（7 公告稿 + 3 旧交接件 + 6 早期稿 + `refine-balance-50`）——搬进 `docs/design/archive/` ？
   （**推荐：搬**。理由：`docs/design/` 一眼看清"哪些是现行权威"；搬移会留 20+ 处泛引需抽查。）
2. **§2 那 33 份早期稿**——① 只加统一"历史留档"横幅（省事，风险=后人照抄旧数）；② 逐份修事实（彻底，工量大）；
   ③ 先修 ✱ 标记的 9 份高危险项，其余挂横幅（**推荐**）。
3. **`docs/test-saves/` 冗余**——`user-backup-20260910-233010` 与 `-233013` **MD5 完全相同**（265,069 B）、
   `drone`/`redtide` 各留两版（旧版无说明）、共约 1.3 MB 冗余。
   （**推荐：只留一份完全重复的真档备份**；同 case 旧版移入 `docs/test-saves/archive/`。船长真档一律不删。）
4. **`docs/roadmap.md` 288 KB**——实测 178 条带日期条目**全在 2026-09**（无更早月份可切），
   ≤2026-09-06 的 41 条只占 **8.2%**；真正的成本是**多 agent 并发插条的冲突面**，不是体积。
   （**推荐：不切分**，只在文件头补一句"顶部块 = 最新批次 / `## 变更记录` 段 = 更早批次"的说明；文件头当前没有这句话。）

## 6. 资源侧观察（本轮不动）

- `docs/Small 512x512/**`（32 张星云 PNG，**7.5 MB**）：**不进包**（构建吃 `assets/space/*.jpg` 0.96 MB，
  与 `spaceBg.ts` 注释逐字吻合；产物 32 张 hash jpg 与源 jpg 字节一致，无孤儿图）。**建议保留**——
  JPEG q85 是唯一在库产物，源 PNG 一旦无外部备份就不可逆（换压缩质量/重裁都做不了）。
- `docs/test-saves/*.json`（6.6 MB）：20 个测试档 ↔ 20 份真档备份**一一配对**，无孤儿；README 缺 `b3`/`repair`/`redtide`
  三节登记（**本轮已补**）。最新存档停在 09-10 23:33，**09-11 批次（星图显示模式、无人机损毁优化、rank3 技能、
  市场池标定、配方补锚…）无对应 case**——日后要给船长实机验收时需补档。

## 7. 存疑（留给经办人/船长）

1. `market-detail-rework.md` 的「30 分钟采样」：稿、`market.ts:449` 注释、**玩家可见** `MarketPage.tsx` 三处写 30 分钟，
   只有 `balance.ts:101` `tickMs = 60 s` —— 改稿还是改代码/文案？**涉玩家可见文案，须先定案。**
2. `skill-rank-dispersion.md` 三条 rank 与 `skills.ts` 不符：**漏落码**还是**有意延后**？（回填方向错会误导训练时长）
3. 数据自身打架：`ore-veldspar` 收价 `items.ts:23` = **13**、`marketCatalog.ts:35` = **12**（两稿各"对一半"）。
4. 点防 PD「六参数」**源文档未定位**：四处引用都写"二号设计稿 §八"，但 `docs/design/` 检索不到该定稿件。
5. 未推送提交数在四份交接件里记 120 / 123 / 126 / 172，**互相矛盾**且无法核实（推送闸门恢复后以 `git log origin/main..HEAD` 为准）。

---
_维护：本件由一号在 2026-09-11 出具（三路只读审计 + 本人复核）；已修部分见 §1 两个提交，未修部分按 §2/§3/§4 增量清理。_
