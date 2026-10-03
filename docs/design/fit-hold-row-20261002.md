# 装配页属性表补「货舱容量（装后）」＋ 装配页标签比对改单点（工作文档 · 2026-10-02）

**状态：进行中 · 已落码待验收**（船长报障 → 当批修复；闸门全绿，等合入与验收）

**经办**：三号（`H:\大鲸鱼\Deepseek-EVE-verify`，分支 `verify`）

**船长原话（照抄）**：「发现遗漏，装配界面的属性中无法查看舰船当前货仓大小」

---

## 一、根因（读现场得到，不是猜）

1. 装配页主表的行 = `shipInfoLines(shipDef)` 过滤几张名单后，再接「装后口径」追加行（`pages/FitPage.tsx`）。
2. 「**货舱容量**」那条**基础行**被页面**原地过滤**掉了（和 槽位 / 采集性能 / CPU 一样，理由是"页面别处有出处"）——
   但**一直没给替代行**（CPU 有右栏「CPU 剩余」条、机舱有合计行、机动速度有装后行）⇒ **整张表里查不到货舱大小**。
3. ⚠ **顺带查出的第二个 bug**：那几条过滤写的是**中文字面量**比对（`l.k !== '货舱容量'` 一类），
   而 `shipInfoLines` 给的 label 早已走 `tr(ui.Handbook.00x)` **按语言出词** ⇒
   **zh 下恰好命中、en 下一律不命中**：英文界面里「槽位 / 采集性能 / 货舱容量」三条基础行会照常显示
   （与装后行重复，且报的是**船体基础值**）。

## 二、落码（4 个文件）

| # | 文件 | 改动 |
|---|---|---|
| 1 | `apps/desktop/.../ui/shipInfo.tsx` | 加 **`fittedHoldLine(capM3)`**（装后口径货舱容量行；标签**复用**船卡那条 `ui.Handbook.010`「货舱容量 / Cargo capacity」，值口径同船卡 `N m³`）＋ **`fitHiddenBaseKeys()`**（装配页原地过滤的基础行**单点**，**按 id 取当前语言 label**，函数而非模块级常量） |
| 2 | `apps/desktop/.../pages/FitPage.tsx` | ① 主表过滤改走 `fitHiddenBaseKeys()`（删掉四条中文字面量比对与那条已失效的 `l10n-keep` 注释）② 在「无人机舱合计」之后追加**装后货舱容量行**（`...(holdCapM3 > 0 ? [fittedHoldLine(holdCapM3)] : [])`，两条都是"容量"读数故相邻）③ `holdCapM3 = cargoCapacityM3Of(state, engine.ctx, effectiveTarget)`（与「货仓」页同源） |
| 3 | `tools/ui-attr-check.ts` | 模型同步：追加键表加 `tr('ui.Handbook.010')`（位置与页面一致）、装配页模型改为**按单点 `fitHiddenBaseKeys()` 过滤**（不再各按各的判据）＋ 新增**静态契约**：装配页不许用中文字面量比对 label（必须走单点） |
| 4 | `docs/design/fit-hold-row-20261002.md` | 本文件 |

**中文文案一字未改**（标签复用既有词条，未新增 id）；`cargoCapacityM3Of` 是既有 core 单点（含货舱扩展件 ＋ 深空物流学/货舱管理学/货舰操作三条乘链）。

## 三、验证

- `typecheck` 四包 0 错 · `content:check` ✅ · `l10n:check` ✅ · `npm run build` ✅。
- `npm run ui:rot-check` 全绿，其中：**属性表同名体检**（45 艘 × 4 处拼装口径：装配页主表 / 图鉴档案 / 蓝图产物 / 舰队页悬停卡 ⇒ 无同名两行）＋ **新增的「装配页标签比对契约」**（无中文字面量比对）。
- **两种语言的实证核对**（临时探针，跑完即删）：zh 与 en 各起一次进程（冷启动口径）⇒
  `fitHiddenBaseKeys()` 分别为「槽位 / 采集性能 / 货舱容量 / CPU」与「Slots / Extraction performance / Cargo capacity / CPU」；
  **45 艘船、两种语言下主表同名两行均为 0**，且**装后货舱容量行 45/45 都在**（旧写法在 en 下漏过滤、会与基础行重复）。

## 四、仍挂账（同一族，等船长定）

- **舰队页悬停卡**那条「货舱容量」目前仍报**船体基础值**（`shipInfoLines` 里的 `ship.cargoM3`，不含货舱扩展件与技能乘链）。
  船长 2026-09-26 的令是「悬停舰船时应该显示**当前**属性」⇒ 按同一条令，这条也该换成装后值；
  但卡的签名只拿得到 `ShipDef + spec`（`UnitSpec.cargoM3` 是船表基础值，`createPlayerSpec` 不产它）⇒
  要改得由舰队页把 `cargoCapacityM3Of(...)` 当 `opts` 传进来（与既有 `droneBayTotal` 同款做法）。**未动，等你一句话。**
- **图鉴档案窗 / 蓝图产物**那两处按船长既有裁定仍走**基础属性**（不属本轮）。

