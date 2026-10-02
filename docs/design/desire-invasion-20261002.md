# 入侵的期望距离记错星系（2026-10-02 · 二号 · **已落码 · 待验收**）

> **本文件是本次工作的临时文档**（§八）：工作期间只改它 ＋ 代码/数据/测试；船长验收并合入后按归档三步办。

## 一、船长原话（照抄）

> 「**在打入侵时，玩家设置的目标距离并不会保存。这个问题需要解决下**」

（同日批复待裁决两点：「**其余按你推荐来**」⇒ ① 历史脏数据**不清不迁**（无法区分"入侵误写"与"玩家真的给母港设过"，迁移属猜）② `desire-per-galaxy` 语义在入侵上改为**按被占星系记**。）

## 二、为什么由二号接（不抢一号的活）

一号 `adbe8a30` 修的是**遭遇槽**（入侵伏击/旗舰战，宿主判据由"只认旗舰战"放宽）；而**普通入侵走远征槽**
（`startExpeditionAt`），两条路不同。他这份工作文档 `player-bugfix-20261002.md` 当时仍标「进行中」，
故先报告船长、获批后由二号接手。

## 三、真因（探针实测 · `tools/_probe-invasion-desire.mts`，落码后已删）

| 场次 | 抽到的卡 | 卡自带星系 | **实际作战星系** | 旧口径写入 | 按键 `galaxy-redring` 读回 |
|---|---|---|---|---|---|
| 1 | `ink-harass` | **`galaxy-hub`** | `galaxy-redring` | ok | **null** |
| 2 | `ink-raid` | **`galaxy-hub`** | `galaxy-redring` | ok | **null** |
| 3 | `ink-harass` | **`galaxy-hub`** | `galaxy-redring` | ok | **null** |

1. **数据**：`ink-harass` / `ink-raid` 等**入侵池卡写死 `galaxyId: 'galaxy-hub'`**（`packages/data/src`）——
   它们本就不属于任何被占星系（写法没错，错的是拿它当键）。
2. **取键**：期望距离的**写**（`setBattleDesire`）与**读**（`beginBattleAt` → `startBattleFor` 的回落）
   旧口径都取 `anomaly.galaxyId` ⇒ 全落在**母港**那把键上：
   - ① 被占星系一份都没记（= 船长报的"不保存"）；
   - ② 🔴 **母港那份设定被入侵悄悄改掉**（报障里没提到，是本次查出来的第二层）。
3. **旧注释是错的**：`expedition.ts` 原写「远征/入侵主动出击的目标卡**自带被占星系**」——与数据不符，
   这正是后来人不敢动这里的原因（旗舰战那条注释反倒说对了：隐藏卡的 `galaxyId` 就是母港）。

**已排除**：不是 UI 没落盘 —— `engine.battleSetDesireAt` 确实调到 core 且 `persist` 有效
（一号 2026-10-02 修的那条已生效）。

## 四、改动（逐条）

| 落点 | 改法 |
|---|---|
| `packages/core/src/expedition.ts` · `setBattleDesire` | 写入键 → **`state.expedition.foeGalaxyId ?? anomaly.galaxyId`** |
| 同文件 · `beginBattleAt` | 由"传 `undefined` 让引擎按卡星系回落"改为**显式**读 `desirePrefOf(state, exp.foeGalaxyId ?? 卡自带星系)`；⚠ 没设过时传下来的是 **`null`**（强制默认档）而非 `undefined`，否则又掉回按卡星系读 |
| 同文件 · 那段错误注释 | 改写为实测结论（并写明旗舰战那条同理） |
| `packages/core/tests/desire-invasion-20261002.test.ts` | **新增 3 条**（原无用例守这条）：① 三连场每场重抽卡仍记得住 ② **不污染母港** ③ 下一场开战按记忆站 |

**零行为变化保证**：普通远征/普通悬赏没有 `foeGalaxyId` ⇒ `?? 卡自带星系` 逐字不变。

## 五、验证

- **复现探针（修前 → 修后）**：偏好表 `{"galaxy-hub":5000}` → **`{"galaxy-redring":5000}`**；
  按键 `galaxy-redring` 读回 `null` → **`5000`**。
- 新增用例 **3/3 绿**（读数：三连场抽到 `ink-harass / ink-raid / ink-harass`，偏好表只含被占星系）。
- **core 全量 286 文件 / 3009 用例全绿**（修前同数；本次新增 3 条后为 3012，见提交时的读数）。
- 闸门：typecheck 四包 · content:check · l10n:check · ui:rot-check（提交钩子四道）全绿。

## 六、涉及模块（§十八）

**远征与赏金域**（`expedition.ts` 的两处取键）＋ 用例 ⇒ **单域**。

## 七、不做 / 遗留

- **不清历史脏数据**（船长批「按你推荐来」）：`desirePrefByGalaxy['galaxy-hub']` 里若已有被入侵误写的值，
  保留原样 —— 无法区分"误写"与"玩家真的给母港设过"，迁移等于猜。
- ⚠ **本批不含**「R 族开场双方距离过近」那条新报障（船长同日提，另起一件查）。
