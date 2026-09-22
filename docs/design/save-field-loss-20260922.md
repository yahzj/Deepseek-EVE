# 刷新可重复领取补发的打捞器（读档丢去重键）· 2026-09-22

- 状态：进行中 · 全闸门绿 · 待船长验收（是否合入 main）
- 经办：二号（工作树 `H:\大鲸鱼\Deepseek-EVE-d2`，分支 `d2/workspace`）
- 范围：**只修读档丢字段这一处 ＋ 加两道护栏**；**不动**补发逻辑本身、**不动**存档版本（仍 v31）、**不回收**已发出的装备

## 一、船长报障（原话照抄）

> 「玩家刷新可以重复领取补发的打捞器」

## 二、根因（先查证，不猜）

补发本身是 **2026-09-22 船长令**的临时补丁（`core/firstRewards.ts` 的 `backfillSalvagerIfMissing`）：引擎首拍给每个档无条件发一台打捞器 MK1，去重键 = `importantTasks['first-salvage'].salvagerGift`（只在真发过那一刻写）。逻辑本身没问题——**丢的是这个键**：

- `core/save.ts` 的 `normalizeState` 是**手工白名单重建** `importantTasks`（`done` / `delivered` / `allExplored` / `started` 四个键，逐个 `...(r.x === true ? {x:true} : {})`），**没有 `salvagerGift`**；
- ⇒ **读档即丢去重键** ⇒ 下一拍 `backfillSalvagerIfMissing` 又当"没补过"发一台 ⇒ **刷新一次 +1 台**（连日志都再写一条）。

**实测复现**（口径：加一条专例，先看它红）：

```
expect(back.importantTasks['first-salvage']?.salvagerGift).toBe(true)
→ 去重键必须随档落盘: expected undefined to be true
```

**同款前车之鉴**：`wormhole.run` 的手工白名单漏过 `turnsBase` / `turnsTechBonus`（同一批里修过）。这类 bug 的共同特征：**不报错、四闸门全绿，只在"刷新/重进"时表现为重复发奖或状态回退**。

## 三、修法

| 文件 | 改动 |
| --- | --- |
| `packages/core/src/save.ts` | `normalizeState` 的 `importantTasks` 白名单补一行 `...(r.salvagerGift === true ? { salvagerGift: true } : {})`，并把"漏一个键就丢"这件事写进注释（点名本次报障与 `wormhole.run` 前车之鉴） |

**为什么不改别处**：补发判定（`salvagerGift === true` 才跳过）本身是对的，把它改成"看装备库有没有"会让"玩家把补发的打捞器卖了/装到别的船上"重新变成可再领；改存档版本则要动迁移链，为一个临时补丁不值。

## 四、两道护栏（这次的真正交付）

### ① 类型穷尽护栏（`packages/core/tests/save.test.ts`）

`Record<keyof ImportantTaskState, true>` 的穷尽对象 ＋ 一条"每个字段都随档往返"的用例：

- 将来给 `ImportantTaskState` **加字段而没在这里补一行** ⇒ `npm run typecheck` 直接红；
- 补了行但**没进 save.ts 白名单** ⇒ 用例红（本次就是它先红）。

### ② 自动护栏：引擎跑过的档，往返不许丢键（同文件）

不依赖任何清单：把**真引擎跑过的档**（引擎 30 拍 ＋ 采矿/精炼/制造/市场挂单/进洞）整体落盘再读回，**递归比对键集合**，报出"引擎写过、读回来没了"的键。

口径两条（都在注释里写明）：

- **空值不算内容**（`false`/`0`/`''`/空表/空对象）：`normalizeState` 一律"只在有值时落键"，读回来缺省 = 同一结果；
- **已停工的残留作业条不算**（内存里 `active === false` 的那条）：玩家切活动时主控上一条会被 `haltActivityForSwitch` 置停，读档**按设计**丢弃它们（`sanitizeRefineRun` 等只收 `active === true`）。

**覆盖面 = 场景真的跑到的子系统**（想扩面就往场景里多加一步）；**局限**：它只看"引擎在当前场景写过的键"，历史档里的老字段靠下面的真档体检。

### ③ 正式工具：存档往返体检（`tools/save-roundtrip-audit.ts` · `npm run save:roundtrip-audit`）

把 `docs/test-saves/*.json` 逐份跑 **读档 → 落盘 → 再读档**，报"第二轮丢掉的键 / 类型变了的键"。

**本次读数**：`往返过的档：75 份成功 / 1 份失败（共 76 份）` · **丢键 0 个 · 类型变化 0 个** · ✅ 通过
（1 份失败是 `test-save-b1-20260904-182854.json`：v17 早于可迁移下限 v24，与本次无关，`save:migrate` 里同样是这条。）

## 五、负向验证（护栏有没有牙）

把 `save.ts` 那一行白名单**改回漏键**再跑，**三条用例同时红**（证明自动护栏确实能抓这一类）：

```
× importantTasks 存档往返：白名单不许漏键 → 字段 salvagerGift 读档后丢了（白名单漏键）
× 存档往返：引擎跑过的档不许丢键（自动护栏） → 这些键引擎写过、读回来没了
× 全员补发打捞器 MK1 → 去重键必须随档落盘: expected undefined to be true
```

改回修复后三条全绿。

## 六、闸门

`typecheck` ✅ · core 测试 **184 文件 / 2102 用例**（+2）✅ · `content:check` ✅ · `l10n:check` ✅ · `ui:rot-check` ✅ · `skilltree:layout-check` ✅ · `save:migrate` 76/76 ✅ · `save:roundtrip-audit` 75/75（丢键 0）✅ · `build` ✅

## 七、已知取舍与不做

- **已被重复领取的那几台不回**：船长既有口径「**已发出的装备不回收**」（roadmap 里登记过）；真要收，得另开一单（按装备库计数扣到 1 台）——本次不做，等船长发话。
- **临时补丁仍在**（船长令「发放完成后下次更新删除补发」）：拆除清单见 `docs/roadmap.md` 那一行，本次**只修漏键、不提前拆**。
- **不升存档版本、不写迁移**：本次是"读档白名单漏了一行"，补一行即闭环，老档无需迁移（缺键 = 没补过 = 照发一次，本来就是设计口径）。
