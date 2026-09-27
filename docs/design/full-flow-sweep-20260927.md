# 全流程体检（2026-09-27 · 一号 · main）

> 状态：**进行中**（体检已完成并汇报；两处待办按船长令挂起）
> **船长原话（照抄）**：「**那试试帮我测试下全流程，旧工具有些过时了。**」
> 同日四条裁定（照抄）：「**1旧工具用的时候再更新。2可以。3清单有什么用，4暂时不用**」

## 1. 跑了什么 · 结果

### 1.1 主闸门（13 项全绿）

| 闸门 | 读数 |
| --- | --- |
| `typecheck`（core/data/ui/desktop） | ✅ 17.2s |
| `test -w @whale/core` | ✅ **2644 用例全绿** |
| `content:check` · `l10n:check` | ✅ · ✅ |
| `ui:rot-check` · `ui:tip-check` · `ui:theme-check` · `ui:layout-css:check` | ✅ 四项全过（两份拆分 CSS 与源码一致） |
| `save:roundtrip-audit` | ✅ 102 真档，**0 键丢失**（v17 那份低于可迁移下限属既有信息项） |
| `save:guard-check`（存档丢失防线 · 4 场景） | ✅ 正常 / 存储被禁 / 旧档读不出（旧档原封不动）/ 放行写入 |
| `save:webfile-check`（本地存档文件绑定 · 7 项） | ✅ 绑定 / 双写 / 优先读（甲案）/ 解绑 / 不支持环境 |
| `tools:audit` · `mod:order` · `skill:audit` | ✅（`tools:audit` 自报"20 需重检 / 52 未登记"，见 §2） |
| `price:audit` · `liquidity:audit` · `salvage:econ` · `battle:layout` | ✅ |

### 1.2 浏览器类（需自起环境：`web` 预览 4199 ＋ 自己的无头 Chrome CDP 9333）

- ✅ `filters:export`（产物见 §3）· ✅ `ui:probe --make-saves`（只打印输入档约定）
- ✅ `ui:battle-fit`：**复跑 7 次全绿**（干净浏览器 2 次 · 先跑存档体检再跑 2 次 · 冷启动 3 次）
- ❌ `ui:overflow`：点不到导航项「市场」；实测导航只有 8 项（市场/工业未解锁）
  ⇒ **它注入的三份夹具档没生效**，页面停在新档状态（三份档本身在：v25/v28/v29，均可迁移）
- ❌ `ui:geom`：缺两份夹具档（`c-exactfull` / `d-over`）；且头部版本自检仍写「存档结构 **v24**」，当前 **v31**

## 2. "旧工具过时"的确证（`tools:audit` 读数）

- **【需重检】20 个**（记录版本落后 ≥2 个大版本）：`battle-layout · bounty-stats · chain-balance · commit-msg ·
  counter-audit · docs-index · foe-dps-overcap · l10n-check · l10n-wrap · stealth-readings · tip-audit ·
  tools-audit · tuning-expired · ui-geom · ui-probe · wh-family-review · wh-ships-review · wh-ui-check ·
  wh-weapon-dps · wormhole-econ`
- **【未登记版本自检】52 个**（老工具头注释里没有那三条自检）。
- **实跑 22 个**（含上表 8 个）⇒ **"记录落后" ≠ "坏掉"**：`bounty:stats / balance:chains / wormhole:econ /
  tuning:expired / battle:stealth-readings / foe:export / battle:layout / ship:hp / faction:audit /
  ironman:check / bp:margin / bp:ship-ids / recycle:compare / travel:matrix / weekend:board / bounty:econ /
  manufacture:econ / mod:order / skill:audit / price:audit / liquidity:audit / salvage:econ` **全部 PASS**。
- **真跑不动的只有"夹具驱动"的三个 UI 探针**：`ui:probe` / `ui:geom` / `ui:overflow`
  （根因是输入档：`tools/_ui-artifacts/saves/*` 四档缺两档 ＋ `docs/test-saves/` 三份中后期档注入不生效）。
- `commit:msg` 直接跑报 FAIL 属**设计如此**（消息要从 stdin 进；喂 stdin 实测正常）。

## 3. 待办与裁定

| 项 | 船长裁定 | 现状 |
| --- | --- | --- |
| 批量"旧工具重检"（重导夹具 ＋ 更新版本自检 ＋ 20 个逐个登记） | **用到时再更新** | **不做**；用哪个工具时顺手更新它 |
| `ui:battle-fit` 报的 2px 越界（390×844 横屏 classic） | 「2可以」（原意：修） | **未能复现**（7 次全绿）⇒ **未改 CSS**（盲改会动到现在全绿的手机观感）。可选项：给探针加"布局稳定后再量"的等待（防抖动）——等船长点 |
| `docs/exports/筛选清单-20260927-094030.{txt,xlsx}` | 问"清单有什么用" | 用途见 §4；**暂留未入库**，等船长定留/删 |
| 本地 `main` 落后 origin 3 个提交 | **暂时不用** | 不动 |

## 4. 「筛选清单」是什么（回答船长第 3 问）

`filters:export` 的两段产物（同一份内容的两种格式）：

- **A 界面现场**（跑起来的应用 · 只读注入真档）：逐个一级页 → 逐个页签，把**当前可见的筛选栏与控件**按文档顺序抄下来
  （栏标签 / 层级 / 顺序 / 文案 / 类名 / 是否选中）⇒ 这就是"玩家现在看到的筛选层级"；
- **B 代码定义表**：直接 import `ui/itemSubs.ts` 的筛选表（全仓唯一实现）＋ `l10n/table.ts` 解出**中英双语**
  ⇒ 「键 ↔ 文案 ↔ 使用处」对照，改完结构回接实现时按"键"落码。
- 格式：`.txt` 便于 diff/检索，`.xlsx` 便于翻。**用途**＝重排/改名/增删筛选那类活先看它（仓库里 2026-09-23 那份是入库的）。

## 5. 归档待办（船长验收 ＋ 合入后）

本文件的关键读数并入 roadmap 一条（含"旧工具用到时再更新"这条口径），随后删除本工作文档并重跑 `docs:index`。
