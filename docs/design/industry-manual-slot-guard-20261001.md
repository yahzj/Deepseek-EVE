# 新工业 HUD 页：主控手动位守卫复原（工作文档）

- **状态：进行中**（2026-10-01 开工；实现已落、闸门全绿，**等船长验收**）
- 经办：一号（主树 `H:\大鲸鱼\Deepseek-EVE`）
- 归档时：关键结论并入 `docs/roadmap.md`（＋必要时 `docs/single-source.md` 已当场登记）后删除本文件（§十五）

## 1. 船长原话（照抄）

> 「我发现新的工业UI里，剩主控空闲时，可以无限打断主控当前活动，建议改成和旧的工业一样，主控正在活动时，禁止按钮」

船长裁定（本批提问后，原话）：**甲案 —— 只封「手动工作位被占」**——即照旧工业页原口径复原，
**主控在采矿/打捞/远征/巡逻时点开工，仍走 09-21 令的"直接切 / 先警告再切"**，本批不动那一层。

## 2. 现状核查（改前）

**新的工业 HUD 页（`pages/IndustryHudPage.tsx`）——三处主控开工键，一处守卫都没有：**

| 位置 | 改前禁用判据 | 缺的那一档 |
|---|---|---|
| 精炼炉/回收炉/拆解 投料行 · 主控键 | `have <= 0` | 手动工作位 |
| 组装机 / 造船厂 · 开工键 | `!learned` | 同上（且它是"有核心走核心、没核心才主控"） |
| 实验室 · 开工键 | `lockTip !== null \|\| 材料不足一批` | 同上 |

**旧的工业 UI——这一档本来就有：**

- 精炼炉卡（`pages/IndustryPage.tsx`）：`manualNote` = 已亲自开着一台炉 → `ui.IndustryPage.018`；
  已亲自开着一条制造线 → `ui.IndustryPage.019`；野外 → `ui.IndustryPage.010`；返航途中 → `ui.IndustryPage.015`。
- 旧外壳组装机（`panels/Industry.tsx`）：`manualBuildNote` = 已有主控制造线 → `ui.Industry.025`；
  已有主控炉 → `ui.Industry.026`；野外 → `ui.IndustryPage.010`。
- ⚠ 旧页的**实验室卡**其实也只查了野外/返航（2026-09-29 新加该页时的缺口）——本批在新页一并补上。

**"无限打断"的成因**：新页没有守卫 ⇒ 点下去直接走 core 的换线路径（`haltActivityForSwitch` ＋ 统一日志）
⇒ 手上那条被停、**当前那一批进度丢弃**，而且**每点一次都能再换一次**。

## 3. §九之八 技能判定（`ui-ux-pro-max` · ux 域）

- **Confirmation Dialogs**（Severity **High**）：「Prevent accidental destructive actions / **Do: Confirm before
  delete/irreversible actions** / Don't: Delete without confirmation」⇒ 改前是**静默**丢当前那批进度，正踩在这条上。
- **Disabled States**（Severity Medium）：「Clearly indicate non-interactive elements / Do: **Reduce opacity and
  change cursor** / Don't: Confuse disabled with normal state」⇒ 置灰必须**看得出是灰的**，且**给出理由**。

**我的意见**：支持船长方向（旧页同级相似项 §六 ＋ 上面那条 High）。**风险与护栏**：理由只走按钮既有的
`title`（§九之七：一个元素只允许一个悬停机制）· 组装机/造船厂那颗键**只在这一下真会落到主控上时**才置灰
（有可用核心时走 AI，不该被手动位挡住）· 只封手动位这一格，不碰跨活动切换（09-21 令）。

## 4. 落地记录

| 落点 | 内容 |
|---|---|
| `core/activityGate.ts` | 新增**单点** `manualSlotOf(state)`：手动工作位（精炼炉/回收炉/拆解台/制造线/实验室共用的那 1 个名额）此刻被谁占着（`'refine' \| 'manufacturing' \| 'lab' \| null`）· **AI 核心驱动不算** · `active === false` 的行不算。⚠ 注释写明**不要拿 `mainActivityOf` 当这把尺**（它有优先级，旧档双占时会答错） |
| `core/index.ts` | 导出 `manualSlotOf` |
| `docs/single-source.md` ＋ `tools/arch-guard.ts` | 两处同时登记该单点（F3 核对一致性） |
| `data/l10n/table.ts` | 新增 `ui.hud.212`（置灰理由，中英）——**序号取 212 不是 210**：`ui.hud.210/211` 是已删条目，**id 一经使用不复用**（§十一之三） |
| `pages/IndustryHudPage.tsx` | 三个页签按同一句话置灰：投料行主控键 `disabled={have <= 0 \|\| manualNote !== null}` · 组装机/造船厂 `disabled={!learned \|\| manuManualNote !== null}`（`manuManualNote = core === null ? manualNote : null`）· 实验室 `disabled={lockTip !== null \|\| 材料不足 \|\| manualNote !== null}`；三处 `title` 都把理由排在最前 |
| 用例 | `tests/activity-lab-20261001.test.ts` 新增「手动工作位判定（单点 manualSlotOf）」3 条：空档 ⇒ null · 三种主控线各答对档 · AI 驱动与 `active:false` 都不占位 |

**文案口径**：不按机器分句——手动位只有 1 个名额，占它的是哪一台对玩家都一样：
「主控正亲自运转着另一条产线：先停掉它，才能亲自开这条（AI 核心不受此限）。」
旧页那两句（`ui.IndustryPage.018/.019`、`ui.Industry.025/.026`）仍由旧页自己用着，本页不复制第二份同义串。

## 5. 闸门（读数）

`typecheck` ✅ · core 全量 **2952 条** ✅（本批 +3）· `content:check` ✅ · `l10n:check` / `l10n:params` ✅ ·
`arch:guard`（含新单点的 F2/F3）✅ · `ui:rot-check` ✅ · 桌面构建 ✅。
**未起浏览器**：本批是按钮 `disabled`/`title` 判据，属"看代码即可判定"；**观感（置灰是否一眼可辨）请船长过目**。

## 6. 待裁决 / 已知取舍

1. **主控在采矿/打捞/远征/巡逻时点开工** ⇒ 本批**未**置灰（仍走"直接切 / 先警告再切"，按船长裁「甲」）。
   若日后要连这一层也封，需同时定"星图/活动栏等其它入口是否同步"，否则两套口径并存。
2. **旧页的实验室卡**（`IndustryPage.tsx`）仍只查野外/返航，没有手动位守卫——本批只改新 HUD 页；
   要不要把旧页也补齐（两套外壳口径一致）**等船长一句话**。
3. 野外/返航途中的置灰：旧页有、新页仍**没有**（点下去由 core 拒绝并 toast 提示）。本批未加——
   船长报的是"打断"，这一格不涉及打断。要一并补齐也请说一声。
