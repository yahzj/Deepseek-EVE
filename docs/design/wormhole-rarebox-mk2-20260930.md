# 虫洞稀有残骸高级箱：MK2 池被旧 MK3 回落池挡住（2026-09-30）

- **状态**：进行中（船长已批甲案，实现中）
- **船长原话**：「发现疑似问题，玩家的虫洞稀有残骸回收，疑似还是只有MK3，没有MK2池」→「按你推荐来」
- **范围**：修 `salvage.rollRareBoxExtra` 的取值优先级（甲案）＋ 补两条护栏（用例、`content:check` 契约）。
- **不做**：不动普通洞内残骸的每批彩头口径（`lowSec = region === 'lo'`，洞内恒 false ⇒ 洞内普通残骸掉 MK2 是另一个决定）；
  不改任何掉率常数、不改甲1案扁平池本身（留作最后兜底）。

## 一、问题（引擎实测）

洞内稀有残骸 5 件 `wreck-rare-a/c/d/e/g-wh`：`region=wh` · 档位 `dire` · 威胁 45 · **组主题件 0 件**。

| 回落池 | 内容 |
| --- | --- |
| 扁平池 `wormholeRareBoxThemePoolOf(ctx,'wh')` | 35 件，**全是 `-3`**（甲1案，2026-09-16） |
| 带权重组 `wormholeRareBoxThemeGroupsOf(ctx,'wh')` | MK2 组 36 件 w=1 · MK3 组 35 件 w=0.25 |
| 组主题件 `profile.theme` | 0 件（洞内 5 组从没配过主题件） |

按 `industry.ts:962-968` 的原样参数跑 2 万次：**MK3 模块 18,079 · 族专属装备 1,921 · MK2 模块 0**。

## 二、根因

`packages/core/src/salvage.ts` 的 `rollRareBoxExtra`：先 `rareBoxThemePoolOf(profile, themeFallback)`，
洞内 `themeFallback` 是甲1案那 35 件非空 MK3 池 ⇒ 直接 `pickOne` 返回，**2026-09-24 的带权重组永远走不到**。
函数自己的注释写着「卡面 `theme` 为空时**优先**用这里」——实现与注释相反，属"接了线没生效"。

用例没拦住：`packages/core/tests/rare-box-weight.test.ts` 三次抽样传的扁平池都是 `[]`，
从没出现"扁平池非空 ＋ 带权重组非空"这个真实组合；`tools/content-check.ts:5587` 的契约读的也是扁平池口径。

## 三、甲案（船长已批）

取值优先级改为 **① 卡面 `theme` → ② 带权重组 MK2 w=1 / MK3 w=0.25 → ③ 甲1案扁平池（最后兜底）**。

- 洞外组两个回落池都为空 ⇒ **逐字不变**。
- 洞内未命中族专属时：预期 **MK2 ≈ 80% / MK3 ≈ 20%**（修前 2 万次对照组：MK2 14,353 / MK3 3,655 / 族专属 1,955）。
- 护栏两条：① 用例补"真实调用组合"；② `content:check` 契约改读带权重两组。

## 四、实现与验证

改的文件：

- `packages/core/src/salvage.ts` —— `rollRareBoxExtra` 的取值顺序改为 ① 卡面 `theme` → ② 带权重组 → ③ 扁平兜底池；
  两个回落池参数与函数注释同步写明这条链与"修前 ②③ 反了"的成因。
- `packages/core/tests/rare-box-weight.test.ts` —— 补 ④「真实调用组合：扁平池非空也必须让位给带权重组」
  与 ⑤「两份回落池都空 ⇒ 仍退回扁平池」。
- `tools/content-check.ts` —— 洞内高级箱契约改读**生效池**（原来读的就是那把扁平池，所以一直是绿的），
  并加一条钉子：带权回落组里必须有 MK2 组。
- `packages/core/src/index.ts` —— 导出 `wormholeRareBoxThemeGroupsOf`（与扁平池同族，工具侧契约要用）。

读数（引擎 2 万次 · `industry.ts` 原样参数）：

| | MK2 模块 | MK3 模块 | 族专属装备 |
| --- | --- | --- | --- |
| 修前 | **0** | 18,079 | 1,921 |
| 修后 | **14,353** | 3,655 | 1,992 |

⇒ 未命中族专属时 MK2 79.7% / MK3 20.3%，正是船长 2026-09-24 要的 MK3 ≈ 20%。

⚠ **已知取舍**：洞内开箱的随机序列会变（多一次"按组权重抽组"），洞外一字不变；已开出的箱子是既成事实，
不受影响。普通洞内残骸的每批彩头仍不给 MK2（地区口径，未动）。

**改了一条旧用例的口径**（不是放宽断言）：`packages/core/tests/recycle.test.ts` 里
「洞内稀有残骸：未中族专属时必给一件装备」原本硬写 `mods['mod-turret-kin-3'] === 1`——那正是**修前的
错误行为**（纯 MK3），修后必然红。现改为钉"恰好一件、且在**生效池**内（MK2 组 ∪ MK3 组）"，
"MK3 约占 20%"由 `rare-box-weight.test.ts` ④ 用 2000 次抽样钉；同一 describe 里的回落池断言
也补上了带权重组、并把标题改成三批裁定的实际沿革。

### 闸门

| 闸门 | 结果 |
| --- | --- |
| `npm run typecheck` | 绿 |
| `npm run test -w @whale/core` | **274 文件 / 2887 用例全过** |
| `npm run content:check` | 绿（洞内高级箱契约新口径已打印） |
| `npm run l10n:check` | 绿 |
| `npm run ui:rot-check` | 绿 |
| 引擎复算 | `industry.ts` 原样参数 2 万次：MK2 14,353 / MK3 3,655 / 族专属 1,992 |
