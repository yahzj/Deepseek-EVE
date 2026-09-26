# 手册优化批（势力染色 ＋ 一次全册优化）· 2026-09-26

> **状态：待船长验收**（实现已完成、六道闸门全绿、真机读数已取；观感审查权在船长）
> 经办：三号（`H:\大鲸鱼\Deepseek-EVE-verify` · 分支 `verify`）· 主树合入后追平 main

## 一、船长原话（照抄）

1. 「**手册内的势力都是一个颜色的，按照设定文档进行下染色。**」
2. 「**然后使用技能，对手册所有内容进行一次优化，然后将优化内容给我看一下。**」

技能：本次按船长的「使用技能」跑 **`ui-ux-pro-max`**（UI/UX 设计智能技能）。用法与命中记在 §四。

## 二、范围 / 不做

**做**：① 势力图鉴（含势力详情容器）按设定文档族色染色；② 手册全册一次优化（可判定的观感/无障碍/一致性项）。
**不做**：不改内容数据、不动数值、不改存档、不动星图与其它模块的样式（发现的一处**星图侧缺口**记在 §五，等船长定）。

## 三、① 势力染色：真因与修法

### 真因（实测，不是推断）

手册的卡片统一走 `toneOf(glyph)` 取色，而 **`toneOf()` 只查 `TONES` 这一张表**（物品/装备/分组共 83 条）。
图标键落在另外两张表的卡片就**静默取到兜底灰**：

| 位置 | 图标键 | 落在哪张表 | 改前实测 |
|---|---|---|---|
| 势力图鉴六张势力卡 | `fam-a/c/d/e/g/h`（族徽线稿） | `ICO_TONES` | **六张卡 `--tone` 全是 `rgb(var(--wui-dim))`、描边同色同值 ⇒ 一个颜色**（船长看到的就是这个） |
| 势力详情里的敌人卡 | `ico-tact` | `ICO_TONES` | 同样全灰 |
| 卡片左上角族徽角标 | `fam-x` | `ICO_TONES` | 内联 `color: toneOf('fam-x')` = 灰，**还压掉**了 `.app-map-famchip.is-fam-X` 的类色（上一批引入的 bug） |

### 修法（三处，均为单点）

1. **`ui/tones.ts` 新增 `toneOfAny(key)`**：按 `TONES → ICO_TONES → NAV_TONES` 顺次查，三张表都没有才回落 `--wui-dim`。
   对物品/装备键的行为与 `toneOf()` **逐字一致**（`TONES` 仍是第一顺位）⇒ 只是不再让另外两张表的键掉进灰兜底。
2. **`GridCell` 新增可选 `tone`**；`IconGrid` / `CellDetail` 一律 `c.tone ?? toneOfAny(c.glyph)`。
   势力卡与势力详情的敌人卡显式传 **`FOE_ACCENT[族]`**（＝ `toneVar('A'..'H')`，与星图族标签、战场敌舰**同源同值**，不新造色板、不写死十六进制）。
3. **族徽角标改用 `FOE_ACCENT[族]`**（不再走 `toneOf('fam-x')`）——顺带补上 **H 族（墨潮帮）**：
   `styles.css` 里从来没有 `.app-map-famchip.is-fam-H` 这条类，走 `FOE_ACCENT` 后八个族一视同仁。

### 读数（真机 · 无头 CDP · 合入后构建）

| 势力卡 | `--tone` | 图标实测色 | 设定文档族色 |
|---|---|---|---|
| 海盗舰系 | `--wui-tone-A` | `rgb(255, 107, 82)` | 海盗锈红 `#ff6b52` ✅ |
| 异形生物 | `--wui-tone-C` | `rgb(159, 230, 164)` | 异形磷光绿 `#9fe6a4` ✅ |
| 守墓古舰 | `--wui-tone-D` | `rgb(159, 208, 242)` | 守墓磷光冰蓝 `#9fd0f2` ✅ |
| 泰坦巨构 | `--wui-tone-E` | `rgb(217, 185, 140)` | 巨构残铁棕 `#d9b98c` ✅ |
| 鱿烬亡军 | `--wui-tone-G` | `rgb(205, 159, 221)` | 鱿烬聚落紫 `#cd9fdd` ✅ |
| 墨潮帮 | `--wui-tone-H` | `rgb(176, 46, 54)` | 墨潮深红（比 A 更深一档）✅ |

其余读数：势力容器标题族徽色 = `rgb(255, 107, 82)`；势力详情敌人卡 `--tone` = `--wui-tone-A`；
专属件角标 18 枚 = `app-map-famchip is-fam-A` ·色 `rgb(255, 107, 82)`· 读屏名「海盗舰系」。

## 四、② 技能驱动的全册优化（逐条：依据 → 改法 → 读数）

| # | 技能条目（domain） | 依据档 | 落点与改法 | 读数 / 结果 |
|---|---|---|---|---|
| 1 | **Color Only**（ux·Accessibility·High）：不许只靠颜色传达信息 | High | 染色后族徽角标补**可读名**：`aria-label` 从"势力 A 专属"（族字母，读屏等于没读）改为**势力全称**（`FACTION_CODEX.nameId`，随语言）；单一入口 `crestLabelOf()` | 角标读屏名实测 = 「海盗舰系」 |
| 2 | **Keyboard Navigation**（ux·Accessibility·High）：每个可操作控件都要能纯键盘走通、有可见焦点 | High | 详情窗（`role="dialog"` 覆盖层）此前**只有"点窗口外"一条关法**，全仓也没有全局 Esc 兜底 ⇒ 补 **Esc 关闭**（`useEffect` 挂 `keydown`，卸载即摘；与遮罩点击同一个 `onClose`）；底注文案同步改为「点击窗口外部任意位置关闭，或按 Esc 键」（中英各一条） | 点开敌人卡 → 详情窗 = true；按 Esc → false |
| 3 | **Chip Collection Reflow**（ux·Layout·High）：筛选胶囊必须能换行或给 +n 展开，不许裁切 | High | **核验型条目**：读数证明现状已合规（`.app-task-tabs` = `flex-wrap: wrap`） | 物品图鉴 17 枚胶囊：容宽 = 内容宽 = 971px、**溢出 0**（1280/1366/1600 三档同） |
| 4 | **icon accessible name / decorative aria**（icons·Guideline）：图标按用途给名字或 aria-hidden | High | 搜索框补 `aria-label`（占位符在部分读屏里不算标签）；图标/列表切换补 **`aria-pressed`**（此前只有 `.is-active` 类，读屏读不出当前档） | 搜索框无障碍名 = 「搜索物品图鉴…」；切换按钮 `aria-pressed` = true / false |
| 5 | **No Results**（ux·Search·Medium）：空结果不许是死胡同 | Medium | **核验型条目**：空态已有两句分行文案（搜索无果给"清空搜索或换关键词"、筛选无果给"换个分类或点全部"）⇒ 达标；「一键清空筛选」按钮列为**待定**（要新文案 id，见 §五） | 代码 + 文案核对 |
| 6 | 观感一致性（本仓 §六：新增内容先复刻同级相似项） | — | 势力图鉴**选中态缺失**：点开的势力在下方窗口显示详情，格子上却没有任何"当前项"标记 ⇒ `IconGrid` 加可选 `selectedKey`，选中 = **1px 内描边（`inset` 阴影，不占布局、不跳动）**，颜色取本卡 `--tone`；同时给 `aria-current` | 首张卡：`内描边 = inset 0 0 0 1px rgb(var(--wui-tone-A))`、`aria-current = true`，其余卡为空 |
| 7 | 同上 | — | 势力详情容器标题挂本族**族徽**（走 `Panel` 既有 `hint` 槽，不新增 CSS 类、不动面板结构） | 标题「海盗舰系 · 已遭遇 5/5」+ 族徽 3 段路径、色 = `rgb(255, 107, 82)` |

**技能查询记录（如实）**：`"dense catalog card grid scannability" --domain ux` **0 命中**（技能纪律要求明说未命中）⇒ 换宽查询
`"color coded categories legend" --domain ux`（命中 Color Only / Color Contrast）、`"search filter results list" --domain ux`（命中 No Results / Autocomplete / Chip Reflow）、
`"keyboard escape dialog close" --domain ux`（命中 Keyboard Navigation / Skip Links）、`"icon button accessible label decorative" --domain icons`（命中图标语义与 aria 规则）。
Autocomplete（搜索建议）与 Skip Links（跳转主内容）两条**不适用本册**：手册搜索是本地即时过滤（无异步、无候选下拉），手册本体是覆盖层而非导航密集页。

## 五、待裁决 / 已发现的册外缺口

1. **星图侧的 H 族缺口（册外，未动）**：`styles.css` 的 `.app-map-famchip` 只有 `is-fam-A/B/C/D/E/F/G` ＋ `is-unknown`，
   **没有 `is-fam-H`**，且色板里也只有 `--wui-fam-a` 一枚 fam token（B/C/D/E/F/G 走的是 `--wui-x1xx` 长尾色）。
   ⇒ 星图「敌对派系」若出现墨潮帮，族标签会是**灰**的（手册侧已不受影响）。修它要动 6 套主题的色板键集（`ui:theme-check` 要求键集一致）＋ 三份 `layout-css` 生成件 ⇒ **等船长一句话**。
2. **手册详情窗不做焦点陷阱**：本窗不抢焦点、点外部即关（与"模态"语义不同），只补了 Esc 与无障碍名；要不要升级成真模态（锁焦点、首焦点、关后回焦）请船长定。
3. **敌人卡副行超长**：`app-hand-cell-sub` 单行省略号，"护卫舰 · 近战缠斗 · 爆弹为主（80%） · 副 动能"会被截尾。
   改成两行会**加高卡片**（网格行高变化）⇒ 记为待定，不自作主张。
4. **空态加「一键清空筛选」按钮**：需新增一条中英文案 id，价值中等 ⇒ 等船长点头。
5. **英文断词**：`.app-hand-cell-name` 用 `word-break: break-all`（英文长词会词中折断）。改它会动 `styles.css` ＋ 生成件，且观感需船长看 ⇒ 未改。

## 六、涉及文件

- `apps/desktop/src/renderer/src/ui/tones.ts`：新增 `toneOfAny()`（跨表取色单点，附报障注释）
- `apps/desktop/src/renderer/src/panels/Handbook.tsx`：`GridCell.tone` / `IconGrid` 选中态＋取色 / `crestLabelOf()` / 族徽角标色 / 势力卡与敌人卡族色 / `CellDetail` Esc＋`aria-label` / 势力容器标题族徽 / 搜索框 `aria-label` / 视图切换 `aria-pressed`
- `packages/data/src/l10n/table.ts`：`ui.Handbook.248` 补「或按 Esc 键」（中英同批）

## 七、验证

- 六道闸门全绿：`typecheck`（四包）· `content:check` · `l10n:check` · `ui:rot-check` · `ui:theme-check` · core 测试 **2566/2566**。
- 真机读数：见 §三、§四两张表（无头 CDP ＋ `web/dist` 静态预览 4174 端口 ＋ 势力测试档；读数型验证，**不是观感结论**——观感请船长在本地构建上看）。
- 临时探针已按 §6 纪律清理（本批 `tools/_probe-*.mjs` 用完即删）。
