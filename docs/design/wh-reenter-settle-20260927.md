# 报障：下虫洞结束后点其他虫洞「开始探索」直接结算（2026-09-27 · 一号 · main）

> **状态：根因已定位 · 真引擎探针复现成立 · 待船长裁改法**（**未改任何行为**）
> **船长原话（照抄）**：「玩家反应，下虫洞结束后，点击其他虫洞开始探索时，会直接结算。」
> **范围**：按约定 §二「报障处理」——**玩家反馈的问题不在本地存档**，一律从代码与真引擎复现；给出四项结论。
> **不做**：改法涉及交互取舍 ⇒ 先报船长裁（§一 四步闸门），未确认不动工。
> **待裁决点**：改法走甲 / 乙 / 甲＋乙 / 丙（见第四节）。

## 一、复现路径（真引擎 · 一次性探针）

探针 `packages/core/tests/_probe-wh-resettle.test.ts`（**跑完已删**，按 §十 一次性处置）：

1. `wormholeEnter` 起一趟（2×T3）→ `run.bag` 装 100 单位虫洞矿 → `wormholeExtract` → `advanceWormhole` 收口
   ⇒ `state.wormhole.run = null`、`state.wormhole.lastSettle.kind = 'extract'`（结算单落地）；
2. **不动结算单**（等价于玩家没点结算界面的「确认」）；
3. 再 `wormholeEnter` 另一处（另一 seed）⇒ **进洞成功，但旧结算单仍在**。

读数（原样照抄）：

```
[探针] 第一趟进洞 ok = true
[探针] 第一趟撤离 ok = true
[探针] 第一趟收口后：run = null · 结算单 kind = extract
[探针] 第二趟进洞 ok = true
[探针] 第二趟进洞后：run 已建 = true · 旧结算单还在 = true
[探针] ⇒ 渲染层（Wormhole.tsx:544）读到的 settle = 旧结算单 ⇒ 整页只显示结算界面（玩家看到的"直接结算"）
[探针] 读档后旧结算单还在 = true
```

**玩家侧等价路径**（不需要改档、也不需要本地档）：撤离／全损 → 弹出结算界面 →
**点面板右上「关闭」或点弹层遮罩**（这条路径不清结算单，见第二节 ②）→ 回星图 →
在「扫描虫洞」页点另一处库存虫洞「开始探索」⇒ 面板打开，**第一眼就是上一次的结算界面**。

## 二、根因（代码位置 · 五条链，缺一不可）

① **清点只有一个**：`apps/desktop/src/renderer/src/game/engine.ts:2808` 的 `wormholeAckSettle()`
   里 `delete this.state.wormhole.lastSettle` —— **只有结算界面的「确认」按钮**调用它（`:1404`）。
② **关闭路径不拦**：`panels/Wormhole.tsx:1222 handleClose()` 只拦"交火中"
   （`state.wormhole.run?.battle` ⇒ toast 后 `return`），**结算态照放行**；而右上关闭键（`:1336`）
   与弹层遮罩（`:1285` 的 `<div className="app-modal-mask" onClick={handleClose}>`）**都走它**
   ⇒ 玩家能绕过「确认」离开面板。
③ **结算单会落档**：`packages/core/src/save.ts:3797~3820` 把它清洗后**写回存档**
   （`...(lastSettle !== undefined ? { lastSettle } : {})`）⇒ 在结算界面直接退游戏／刷新，下次启动它还在
   （探针第 ④ 步实测）。
④ **进洞不清它**：`packages/core/src/wormhole.ts:1735 wormholeEnter()` 全程不碰 `lastSettle`
   —— 探针实测第二趟进洞后旧结算单仍在。
⑤ **面板判据与"这一趟"无关**：`panels/Wormhole.tsx:543/544`
   `const settle = auto ? null : state.wormhole.lastSettle`，同处注释「**有它 ⇒ 整页只显示结算界面**」
   —— 判据只看"有没有结算单"，既不看它是哪一趟，也不看玩家这次是从哪处库存点进来的。

## 三、玩家可见现象为什么长这样

- 玩家点「开始探索」的真实动作 = `App.tsx:1007 openWormhole(stockId)`：**只打开面板并记住选中的那处库存**
  （`setWhStockPick`），**并不立刻进洞**；真进洞要点准备页的「进入虫洞」（那时才走 `wormholeEnter`）。
- 面板一渲染就撞上第 ⑤ 条 ⇒ **整页被上一次的结算界面占住**，准备页根本没机会显示
  ⇒ 玩家读到的就是"我刚点开始探索，它就**直接结算**了"。
- 点「确认」的实际后果 = `wormholeAckSettle()`（清结算单）＋ `onClose()`（**关掉面板**），**并不会进洞**
  ⇒ 玩家得**再点一次**「开始探索」才真的到准备页。
- **不会丢东西**：那处库存虫洞没被消耗（`wormholeEnter` 才消耗库存），上一趟收益也早已入账
  （结算单只是展示层）⇒ 属**体验缺陷**，不是数据损失。

## 四、改法与影响面（等船长裁）

| 案 | 做法 | 代价／风险 |
| --- | --- | --- |
| **甲** | `wormholeEnter` 成功进洞时清掉 `lastSettle`（一行） | 最小改动；**只治"跨趟残留"**，治不了"点开始探索先撞上旧结算" |
| **乙** | 带 `stockId` 打开面板时若有旧结算单 ⇒ 先显示它、点「确认」后**继续进准备页**（不关面板） | 治本（玩家意图不丢）；要动 `openWormhole` / 结算 `onConfirm` 分支，需真机复读 |
| **丙** | 打开面板时若带 `stockId` ⇒ **直接清掉**旧结算单 | 最省事；但会**吞掉**玩家还没看过的结算信息 |
| **丁** | 不改，只加一句提示 | 不推荐 |

**建议 = 甲 ＋ 乙**：甲保证旧结算单不跨趟存活；乙保证"点了开始探索就一定走到准备页"（结算看完自动继续）。

影响面：`packages/core/src/wormhole.ts`（甲）· `apps/desktop/src/renderer/src/game/engine.ts` ＋
`panels/Wormhole.tsx` ＋ `App.tsx`（乙）；**存档结构不改**（`lastSettle` 本就在档里）；
新增回归用例（防"进洞不清结算单"再犯）；**无玩家文案新增**（不涉 l10n）。

## 五、验证读数

- 真引擎探针读数见第一节；探针**已删**（`git status` 无残留）。
- ⚠ **本次未改任何行为**：只定位与复现；除本工作文档外无代码／数据改动。
