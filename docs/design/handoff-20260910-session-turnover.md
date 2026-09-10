# 交接文档 · 大鲸鱼深空工业 · 2026-09-10（一号 → 新一号）

> **给接手人的话**：你对本项目**零上下文**，这页就是全部起点。按 §0 的顺序读、按 §8 检查单核对，
> 半小时内就能进入可交付状态。**所有决策与状态都在仓库里**（文档 + 提交 + 测试档），不在任何人的对话记忆里。
>
> 本会话（一号）交付批次见 §4；**待船长决策清单见 §5（唯一权威）**；踩过的坑见 §7——§7 每条都真实发生过。

## 0. 一分钟开工

1. **读**：`AGENTS.md`（仓级约定，开工必读）→ 本页 → `docs/development-conventions.md`（权威正文，接手时通读一次）→
   `docs/roadmap.md` 顶部 10 条（最近批次）；本会话批次的细节见 `docs/design/handoff-20260910-rarebox-batch.md`。
2. **确认基线与工作区干净**：`git -C H:\大鲸鱼\Deepseek-EVE status --porcelain`（应为空）、`git worktree list`、`git log --oneline -5`。
3. **跑一次四连验证**（§6）：typecheck → core 测试 → content:check → desktop build。全绿才算环境可用。
4. **然后才接活**。船长给新需求时按 §2 的四步闸门走。

## 1. 工作区与铁律（不可协商）

| 项 | 事实 |
|---|---|
| 主树 | `H:\大鲸鱼\Deepseek-EVE`（分支 `main`）——**一号与船长独占** |
| 二号工作区 | `H:\大鲸鱼\Deepseek-EVE-d2`（分支 `d2/workspace`）——**二号永不直接写主树**，改动在 d2 提交后合入 main |
| 三号工作区 | `H:\大鲸鱼\Deepseek-EVE-verify`（分支 `verify`）——核验与收尾 |
| 真档（玩家存档） | `%APPDATA%\whale-idle\save.json`——**只读**；要改档一律走 `tools/make-test-save.ts` + 备份，绝不覆写船长正在玩的档 |
| 推送闸门 | **本地 main 领先 `origin/main` 126 个提交，全部未推送**（**2026-09-10 收尾更新：已达 172**）。规则：开发中只做本地 commit；该工作**确实完成**（自测全绿 + 船长验收）后，才把**代码与公告一起推一次** |
| 提交标注 | 未完成/未验收的提交在信息里标「待验收/待发布」 |

铁律（违反会被船长纠）：
- **中文优先**：面向船长的一切（沟通、文档、注释、游戏文案、日志）都用中文，少用英文缩写。
- **汇报结论先行**，列清「改了哪些文件 + 行为变化 + 验证结果 + 已知取舍」，不藏改动。
- **一级页不滚**：导航直系页（星图/舰船/装配/物品/市场/工业/技能）整页无滚动条；滚动只进二级窗（标签页内列表/卡网格）。
  **禁止硬裁内容**去迁就滚动——放不下要单独提方案。
- **视觉物件一律 SVG 线稿**（舰船/敌舰/状态飘浮物/开火闪光等），禁 CSS 拼形状；背景氛围光效可用 CSS。
- **UI 新增先复刻同级相似项**（同组相似项 → 同页其它区块 → 同模块其它页 → 全仓 `app-*` 家族），先复刻结构与类名再最小差异。
- **公告需船长逐条批准**才写入 `packages/data/src/announcements.ts`；公告禁第一/第二人称，禁开发/验收话语。
- 术语以 `docs/glossary.md` 为权威，新术语先登记再用。

## 2. 船长的工作方式（四步闸门 + 交互习惯）

**四步闸门**（触发：新大功能/系统级/存档结构改动、涉及设计取舍或数值体系、需求模糊）：
1. **集中提问**（一次问完，用问答卡给选项 + 推荐项）；
2. **中文设计总结**（方案 + 取舍 + 涉及模块/数值 + 边界），结尾写「请确认」；
3. **等显式确认**（「可以/没问题/确认」才算；「没有反对」不算）；
4. **确认后实现**，并把决策落进 `docs/design/…`（标注状态：已确认）。

**经验**：船长回得快、回答常极简（「行」「按甲」「不管」）；他给的**数字**就是结论，不要改他的数；
他问「是否可行/是否被砍」时，**先去真实引擎里量化**再回答（他会追问数）。

## 3. 系统地图（按需查，不必通读）

```
packages/core/src/     引擎：state / industry(精炼炉+回收炉+制造) / manufacturing / market / salvage(残骸与碎片+高级箱)
                       lairs(窝点档位与专属装备) / sideTasks(日板/赏金任务/派系活跃) / expedition / combat
                       equipment / inventory / save(读档与迁移) / balance(全部可调数值) / index(对外导出)
packages/data/src/     静态数据：anomalies(悬赏与窝点卡) / modules(装备) / blueprints / marketCatalog / items
                       announcements(公告，仅船长批准后写入) / context(构建 SimContext)
apps/desktop/src/renderer/src/
                       pages/(一级页：MapPage 星图 / IndustryPage 工业 / MarketPage 市场 …)
                       panels/(二级窗：Expedition 任务中心+星图、Industry 组装机、Handbook 手册 …)
                       ui/(共用：shipInfo、itemView、aiWorkFx、wrecksFlavor…)、styles.css(app-* 家族样式)
tools/                 正式工具（npm scripts）：content-check / balance-check / bounty-econ / salvage-econ /
                       faction-audit / manufacture-econ / battle-calibrate / make-test-save …
docs/                  development-conventions.md(权威) / glossary.md(术语) / roadmap.md(批次) / design/*(设计与交接)
```

**本批相关关键常量位置**：
- `packages/core/src/salvage.ts`：`RECYCLE_CHANCE`（碎片档概率）、`FRAGMENT_RECIPES`（门槛 25/250 + `tier` 字段）、
  `fragmentPoolOf`（**集齐前不重复**的碎片池）、`RARE_BOX_GEAR_CHANCE`（**5/8/10%**）、`RARE_BOX_MINERAL_UNITS`、
  `RARE_WRECK_VOLUME_M3`（30）、`rollRareBoxExtra`（高级箱）。
- `packages/core/src/lairs.ts`：`LAIR_*` 常量（威胁/赏金倍率 2/4/8/酬金/波次/残骸件数）、`FOE_LAIR_GEAR`（五族专属装备）、
  `lairLevelOf`（**地图级别 = 档位上限**）、`FOE_LAIR_TIERS`（三档称呼词表）。
- `packages/core/src/balance.ts`：`market.blueprintWeight`（**0.05**）、`market.blueprintLifeMs`（**6 小时**）、
  `market.rareTier3Weight`、`rewardJitter`（0）。
- `packages/core/src/state.ts` / `save.ts` / `industry.ts`：炉次 `lockUnits`（**稀有残骸每炉锁 1 件 = 30 m³**）。
- `packages/data/src/anomalies.ts`：19 张窝点卡的 `lairCore` + **`lairLevel`**。

## 4. 本会话（一号）已交付批次

| 批次 | 提交 | 要点 |
|---|---|---|
| 内容体检「来源唯一契约」 | `d265de8` | 窝点专属装备不得有蓝图/市场卡/碎片配方/进常规池（含负向验证） |
| 蓝图速率调整 | `f1e385f` | 碎片门槛 100/1000→**25/250**；蓝图书权重 50%→**5%**（含奇货）；蓝图单寿命→**6 小时** |
| 碎片池「集齐前不重复」 | `8f0f2c4` | 已学会/已集齐的模块移出池子；报表改「一行大概剩余残骸预估」 |
| 赏金任务档位按地图级别封顶 | `0b8bed7` | 新增 `lairLevel`、19 张卡标级（E 两张都 3、每族至少一张 3 级）、取消三档保底、同星系取级别最高 |
| 工业页产出显示拥有数 | `9363256` / `60b0c54` | 精炼炉「♨ 产出：」+ 每产物缩进一行 `（仓库 N）`；组装机产物行 `（装备库/仓库/机库 N）` |
| 稀有残骸解禁 | `01c2ae6` | 回收炉不再拒收；卡片回归；全部"暂不受理"文案改口 |
| 高级箱数值 + 每炉锁 1 件 | `42cc3a2` | 命中率 **5/8/10%**；`lockUnits` 让一炉恒等于一件 = 一箱 |
| 归档 + 实机测试存档 | `ec9cc14` | `docs/design/handoff-20260910-rarebox-batch.md` + `test-save-rarebox-20260910-224146.json` |

（同批还有二号与三号的提交：五族专属装备、敌方混伤、移除悬赏附赠矿石、星图派系标记对齐等——都在 main 上，同属待验收范围。）

**实机测试档**：`docs/test-saves/test-save-rarebox-20260910-224146.json`（含五族稀有残骸 11 件等门槛，
测试路径见 `docs/test-saves/README.md` 的 `rarebox` 条）。生成器新增 case：`npx tsx tools/make-test-save.ts rarebox`。

## 5. ★ 待船长决策清单（唯一权威，接手先看这里）

| # | 事项 | 现状 | 你需要做的 |
|---|---|---|---|
| 1 | **公告：已批复并落地（2026-09-10 结案）** | 船长口径「公告太多——只保留最重要的新增系统，修复向的压缩」→ **14 张压到 3 张**，已写入 `announcements.ts` 顶部（**22 → 25 条**）：`2026-09-10-rare-wreck-exclusive-gear`（稀有残骸解禁 + 五族专属装备）、`-drone-rework`（无人机流派重做）、`-blueprint-fragments`（只留碎片门槛 25/250）；**取消不发**：敌方混伤、组装机循环制造、界面与说明整理 | **无需再批**；三份待审稿顶部已加「已结案」处置表，留档备查 |
| 2 | 派系活跃稀有残骸掉落概率 | **已裁决（2026-09-10 船长）：10% → 5%**，由三号落地（`FACTION_RARE_DROP_CHANCE = 0.05`；`content:check` 改标「船长 2026-09-10 核定」；日供给 9.8 → **9.1 件/天**） | 无需跟进，留档备查 |
| 3 | 高级箱「主题件兜底」金额是否收口 | **已裁决（2026-09-10 船长）：不收口、维持现状**——同日算全：每箱可兑现 3,082 ~ **196.2 万** ISK（最高 = 穹顶守卫，其主题池白名单含 MK3 三武）、期望日产出 ≈**240 万 ISK/天**（日板全清口径），船长认定为低安深层的合理红利 | 无需跟进；日后要拧的旋钮 = 高级箱兜底池剔掉 MK3 成品（等价于只动穹顶守卫一张卡；复跑 `npm run bounty:econ` 尾部小节） |
| 4 | 常驻（common）蓝图书渠道 | 船长已明确「**不管**」（0.425/窗 维持原样） | 无需再问，记录在案 |
| 5 | 本批改动验收 | 一号 8 批 + 二号/三号各若干，全部本地未推送 | 船长验收后按推送闸门推送（代码 + 公告一起） |
| 6 | 星图派系标记 | 三号已按船长口径改为「对齐 + 闪缩 + 烬火星区右移 40」 | 无需跟进，留档备查 |

**另有两处"已知偏差"（若船长问起要能答）**：
- `tools/salvage-econ.ts` 的彩头 EV 已改为**只算可兑现件**（碎片不计 EV，另起一行进度预估）——按船长口径改完。
- 2026-09-08 公告里过期的「集 100/1000 片」已按船长指示修订为「集 25/250 片」。

## 6. 验证闭环与常用命令

```bash
npm run typecheck          # core + data + ui + desktop 四包（tools/ 不在内！）
npm run test -w @whale/core # 引擎全量用例（当前 785 通过）
npm run content:check       # 内容契约体检（窝点契约/窝点级别契约/来源唯一契约/图标/混伤…）
npm run build               # 桌面端构建（electron-vite；产物在 apps/desktop/out/renderer）
npm run balance             # 平衡体检查
npm run bounty:econ         # 悬赏收益 + 日板档位分布 + 稀有残骸高级箱对照（本批新增）
npm run salvage:econ        # 打捞回收经济 + 碎片路线 vs 买书对比 + 碎片进度预估
npm run faction:audit       # 敌对派系活跃掉落概率审计
npm run manufacture:econ    # 制造经济
npx tsx tools/market-rarity-sim.ts --windows 2880   # 市场稀有渠道与蓝图出现间隔
npx tsx tools/make-test-save.ts <case>              # 生成实机测试存档（基于真档注入 + 自动备份）
```

**界面实机核验（无头 Chrome 流程，改 UI 时用）**：
1. `cd web && npm run build`（**构建会清空 `web/dist`**）；
2. **构建之后**再写探针：`web/dist/__probe.js` + 拷一份存档为 `web/dist/__seed.json`，并把 `<script src="./__probe.js">` 注入 `web/dist/index.html`（**用 edit 工具改，别用 PowerShell**）；
3. 在 `web/` 目录下 `npx vite preview --port 4173 --strictPort`（后台任务）；
4. `chrome --headless=old --disable-gpu --no-sandbox --user-data-dir=<临时目录> --window-size=1600,900 --virtual-time-budget=22000 --dump-dom <url>`（Chrome 在 `C:\Program Files\Google\Chrome\Application\chrome.exe`）；
5. 探针把结果写进 `document.title` 的 `PROBE_BEGIN…PROBE_END` 段，从 dump 里解析。

**工具纪律**：临时探针一律 `_` 前缀，任务收尾二选一——有复用价值**转正**（并入 `tools/` 正式工具 + npm script），
一次性就**删除**。本会话删了 3 个探针（均已并入正式工具）。

## 7. 已知坑与教训（都真实踩过）

1. **别用 PowerShell 改仓库里的中文文件**：`Set-Content` / `>` / here-string 会按 ANSI 重编码 → 中文注释整片乱码
   （本会话把 `tools/market-rarity-sim.ts` 改坏过，靠 `git checkout` 还原重做）。**中文一律用 read/write/edit 工具**。
2. **PowerShell 命令里别用双引号包中文**：`"…中文…"` 极易触发解析错误（`UnexpectedToken`），用单引号或直接避免。
3. **PowerShell 5.1 读 UTF-8 文件会乱码**：`Select-String` 对中文检索会假阴性 → **用 grep/read 工具**，或显式 `-Encoding UTF8`。
4. **`git commit -m` 的信息里不要出现直引号 `"`**：会截断命令、把后半段当 pathspec（本会话踩过，改用单引号包整段）。
5. **构建会清空 `web/dist`** → 探针文件必须在构建**之后**放。
6. **`vite preview` 要在 `web/` 目录跑**（dist 相对 config root 解析）；它绑 `localhost` 不是 `127.0.0.1`。
7. **`tools/` 不在 typecheck 覆盖内** → 改完工具必须**跑一次**才算验证。
8. **写测试时注意导出路径**：`advanceRefining` 等函数只在 `packages/core/src/industry.ts`，**core index 未导出**；
   `oreAvailable`、`countModule`、`rareWreckItemIdOf` 等则从 `@whale/core` 走。
9. **改数值前先想契约会不会被打穿**：例：把碎片 `need` 从 100 改成 25 时，引擎原先用 `need === 100` 反推档位——
   直接改会**把两个碎片池打成空数组**；正确做法是加显式 `tier` 字段。同理改命中率会影响依赖"反复取样到命中"的测试。
10. **别改船长的真档**；要给他测就生成测试档（脚本会自动备份原档到 `docs/test-saves/user-backup-*.json`）。

## 8. 接手检查单（逐项打勾）

- [ ] 读完 `AGENTS.md` + 本页；通读 `docs/development-conventions.md`
- [ ] `git status` 干净；`git worktree list` 三个工作区正常；确认 main 领先 origin 的提交数
- [ ] 四连验证全绿（typecheck / core / content:check / build）
- [ ] 读 §5 待决策清单，向船长确认当前优先级
- [ ] 若船长要实测：把 `test-save-rarebox-20260910-224146.json` 的加载步骤复述一遍并确认他已知晓备份位置
- [ ] 接手后第一件事按四步闸门走，别先动代码
