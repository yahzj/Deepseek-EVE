# 交接文档 · 大鲸鱼深空工业 · 2026-09-15 夜（三号 → 下一任）

> **给零上下文的接手人**：本卡一页读完即可开工。§0 一分钟开工 → 挂账按 §四。
> 一号的 `handoff-20260914-to-new-pilot1.md` 仍在役（通用工作方式那几节仍有效；本卡只写**三号侧今天的变化**与挂账，不重复抄）。
> 文档总索引 = `docs/INDEX.md`（机器生成）· 指路 = `docs/catalog.md`（手写）· 开工先读两者。

## 0. 一分钟开工

1. 工作区 = `H:\大鲸鱼\Deepseek-EVE-verify`（三号，分支 `verify40`）；主树 `H:\大鲸鱼\Deepseek-EVE` = `main`（一号与船长独占）；二号 `Deepseek-EVE-d2`。
2. **已同步（2026-09-15 晚）**：`main` = `verify40` = **`9e9202fc`**。开工先 `git log --oneline -5`——main 若又前进，`git merge main` 解冲突后再走（roadmap 冲突口径 = 保双侧 + 新条目进滚动窗口，见 §1）。
3. 开跑五连（改任何东西都要）：
   ```
   npm run typecheck
   npm run test -w @whale/core
   npm run content:check
   npm run docs:index -- --check      # 文档批再加这一条
   npm run build   &&   npm run build --prefix web
   ```
   **当前基线（2026-09-15 合并后复跑）**：typecheck 四包 **0 错** · core **146 文件 / 1575 用例全绿** ·
   `content:check` **✅** · `docs:index --check` ✅（251 份）· 工作树**干净**。
4. **未推送**：所有批均「待验收 · 本地提交未推送」，**推送要船长一句话**（见 §四 挂账 ②）。
5. 铁律（一条都没变）：中文汇报结论先行 · 不启动子代理 · 不关任何浏览器进程 · 观感审查权在船长 ·
   施工/开发语不进玩家可见范围 · `git add` 只用**显式路径**（永不 `-A`）。
   ⚠ **今天新增三条**：① **AGENTS.md 仅船长明确指示时修改**；② **工作期间不许改旧文档**（工作文档 → 归档，§十五）；
   ③ **文档类查询先查 `docs/catalog.md` §三 ＋ `docs/INDEX.md`**。

## 1. 今天的文档大改造（接手必认的新机制）

- **`docs/roadmap.md` 改版（1523 KB → 91 KB）**：只剩三块 = ① 待办活面（置顶单 / A~E / 交接开放项）
  ② **最近 20 条批次条目（滚动窗口）** ③ **封存卷索引表**。更早批次**原文封存**进
  `docs/archive/roadmap-<日期>.md`（10 卷，一字未改，含船长原话照抄）。
  **新批次怎么记**：不往 roadmap 写——建工作文档，归档时才并一条精简条目（§十五）。
- **`docs/archive/` = 封存区**（冻结件：只读、不改、不追加；旧称类词条原位必须留"禁用提示行"）。规则见 `docs/archive/README.md`。
- **`docs/catalog.md` = 指路目录**（手写，属"例外清单"可随时改）；**`docs/INDEX.md` = 全仓清册**
  （`npm run docs:index` 生成，**禁手改**；`--check` 校验是否过期；`--stats` 只打统计）。
- **`npm run docs:seal`**：把滚动窗口之外的条目按日原文封存并重排 roadmap——**幂等**（同日卷按首行去重）、
  **守恒校验**（条目数 = 保留 + 封存 + 卷里已有，不等即抛错不写盘）、`--dry-run` 先看计划。
- **AGENTS.md 已压缩（19 KB → 12 KB / 199 行 → 89 行）**：要点化 + 「细则见约定 §X」指针，红线原样保留。
- **glossary 走「乙」裁法做了样品 4 条**（第三章"目标距离 / 主武器 / 推进器周期点火 / 敌速基准"）：
  词条只留现行口径 + 出处 + 关键数值，原话/逐问逐答/读数进 `docs/archive/glossary-detail-03-econ-20260915.md`。
  ⚠ **船长已消档，不再推进**（见 §四 ③）。

## 2. 本批已办（三号 · 今天，均已合入 main，无需重做）

| # | 批次 | 提交 |
|---|---|---|
| 1 | 重装线三艘货舱 −20%（5,600 / 9,600 / 15,200）＋ 用例 | `c9f8530d` |
| 2 | 文档索引 `docs/INDEX.md` ＋ 生成器 `tools/docs-index.ts` | `7a1b68ca` |
| 3 | roadmap 封存（10 卷）＋ 封存区 ＋ 词典作废词条 | `377afaa7` |
| 4 | 新规则 §十五「工作文档 → 归档」＋ 重装词条 + glossary 乙样品 | `2d1891ff` |
| 5 | 「目录索引」移出 AGENTS → `docs/catalog.md` | `1ec95eef` |
| 6 | catalog 列入例外清单 | `3ef33df5` |
| 7 | 压缩 AGENTS.md（19→12 KB）＋「仅船长特批才改」 | `1ee2f0a2` |
| 8 | 同步：并入 main 新批 + 保双侧解 roadmap 冲突 | `9e9202fc` |

> 更早的批次（星系扫描艇 · 命中公式 · 货柜拆解 · 悬停统一 · 市场右栏 · 虫洞文案 · C 族爆炸抗等）
> 都已在此前合入 main，细节在 `docs/archive/roadmap-<日期>.md` 封存卷里（原条目原文）。

## 3. 关键口径速查（今天定的，查详情先看词典）

- **重装（`armored`）类别边界**：`docs/glossary.md` 词条「重装（armored）· 类别边界」＋ `ships.ts` 段注——
  虫洞专属 C/D 族 6 艘**保持 armored**（船长「保持现状」）；改 armed 会撞 content:check 三条武装舰族契约。
- **命中公式**：命中 =（基础 + 加成 − 回避）× 距离衰减（`combat.ts` hitChance）。
- **敌舰层抗**：C 族全血条 25% 爆炸抗（`foe-ships.ts` `C_FAMILY_RESISTS`）；玩家打敌五处结算已传目标抗性。
- **重装线货舱**：陆龟 5,600 · 玳瑁 9,600 · 玄武 15,200（蓝图说明已同步，`armored-line.test.ts` 钉住）。
- **悬停提示**：`TIP_DELAY_MS = 500` 三路径同源（`ui/Tooltip.tsx`）。

## 4. 挂账（按优先级）

1. **主树有一号在途未提交改动**（合入后复查：`packages/core/src/engine.ts` / `expedition.ts` / `mining.ts` 被改着）——
   **别动它们**；等主树干净后**重建主树产物**（`npm run build` ＋ `npm run build --prefix web`），
   数据批（货舱/虚空晶 3,600/C 族爆炸抗）才会进船长本地那份。**没重建前船长本地看不到这些数。**
2. **推送闸门未过**：全部批「待验收 · 本地提交未推送」，线上 Pages 未变。**推送要船长一句话**，且与公告同批。
3. **工作文档待归档**：`docs/design/docs-archive-20260915.md`（状态：进行中）——船长验收后按 §十五 归档：
   关键内容已在老文档（AGENTS/conventions/changelog/词典/封存卷），**归档即删本卡与工作文档**、重跑 `docs:index`。
4. **消档（船长 2026-09-15「不用了」，不再推进）**：glossary 乙后续批次 · `docs:index --check` 挂进 content:check ·
   `docs/review/A2-*.png` 三张截图删除（**保留现状**）· 约定 §三/§九 逐条审。
5. **内容体检两条老预警**（非本次引入）：`bp-shieldchg-2` / `bp-shieldchg-3` 蓝图书价与档位系数不符——
   content:check 只预警不拦，处置与否听船长。

## 5. 编码与文档纪律速记

- 中文盘写入 = .NET 显式 UTF-8（`WriteAllText` + `UTF8Encoding($false)`），**行尾一律 CRLF**；
  合并/批量写文档后必做三查：BOM/行尾与改前一致 · 全仓往返解码乱码 0 · 与两侧父提交比"父提交有的行还在"。
- 取历史版本 = `git checkout <rev> -- <path>`（不经变量中转）。
- 临时探针一律 `_` 前缀，收尾二选一（转正式入库 / 删除）；探针日志落 `tools/_ui-artifacts/*.log`（gitignore 区）。
- 写 commit 信息多行用 `git commit -F <tempfile>`（PowerShell 里 `-m` 多行会炸）。

---
_维护：本卡是交接件，只在"交接给下一任"时更新；下一任开工后把它并入自己的交接卡或按 §十五 归档。_
