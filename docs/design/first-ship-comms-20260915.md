# 首艘自造船通讯（`msg-first-ship`）· 工作文档

> **状态：进行中**（三号 · `verify40` · 2026-09-15）
> 归档指向：本批验收并合入 main 后，关键内容并入 `docs/design/comms-20260911.md` 新增 §19，**本工作文档删除**（细节以 git 历史兜底）。
>
> ⛔ **2026-09-16 部分作废（Q1）**：船长报障「**购买舰船也会触发第一艘自造船的通讯，这不对**」⇒
> 二选一裁决取「**甲：造过才发**」，**Q1 的「丙（老档缺字段读档即补发）」作废**——那一支把"字段缺失"
> 当成了"造过船"。现行口径 = `firstShipBuilt === true` 才发（见 `packages/core/src/comms.ts` 的
> `shipBuilt` 分支与本批工作文档 `docs/design/first-ship-trigger-fix-20260916.md`）。

## 一、船长原话（照抄）

1. 「**新增通讯发送的节点：当玩家造好第一条船后，弹出通讯祝贺玩家，并告诉玩家新建造的舰船在舰船仓库页面。**」
2. 三问裁决：「**丙，甲，甲**」。
3. 文案指示：「**文案删除③和④。添加一条告诉玩家，想销售舰船也是在舰船仓库进行，只有没有装配的完好舰船才能入库。**」

## 二、范围与不做

**做**：新增一条通讯消息 + 新触发器 `shipBuilt` + 随档三态标记 `state.firstShipBuilt` + 唯一置位点 + 体检契约/死触发器守卫 + 用例。
**不做**：不改既有消息与既有触发器的行为；不动弹窗机制（沿用「除教程外默认弹」口径）；不改舰船仓库与市场出售逻辑；**不新增界面代码**（跳转走既有 `hint` 通道）；**不另发公告**（属体验打磨，同 `msg-ambush-retreat` 先例）。

## 三、裁决落法

| # | 问题 | 裁决 | 落法 |
|---|---|---|---|
| Q1 | 老档（本功能前开的档）怎么办 | ~~**丙**~~ ⛔ **2026-09-16 作废**（改判**甲：造过才发**） | 原落法：缺字段 = 老档 ⇒ **读档即补发**——⛔ 已被船长报障推翻（它让"没造过船的老档"也收到祝贺信）；**现行** = 只认 `firstShipBuilt === true`，老档第一次真造船时才送达 |
| Q2 | 发件方与内容类型 | **甲** | **深空工业协会 · 工业部**（`dept-industry`；该部门白名单只允许「提示」⇒ `kind: '提示'`） |
| Q3 | 「造好第一条船」计数口径 | **甲** | **任一组装机产出都算**：主控亲手开线 ＋ AI 核心代造（含离线期间造出的）——置位点就在两者共用的出水口 |
| Q4 | 文案 | 删③④、补一条 | 见 §四 |

## 四、消息文案（终稿）

- **主题**：`产能致意：第一艘自造船下线`
- **正文**：
  1. 工业部看到你那条组装机线交出了第一艘船。从这条船开始，你手上的产能不再只出零件与弹药。
  2. 这艘船停在舰船页的「舰船仓库」里——组装机造好的船一律先进仓库、同型堆叠计数。到那一档点「转入舰队」，它就编进机库，之后可以切换驾驶，也可以装上 AI 核心派出去干活。
  3. 卖船也在这里：舰船仓库里可以直接出售——有收购单当场成交，没人收购就自动挂卖单，随时可以撤单退回仓库。
  4. 另有一条入仓的规矩：只有卸下模块、结构与装甲都完好、货仓清空的船才收得进去；正在驾驶或带着 AI 任务的船要先空出来。
- **跳转**：`hint = { text: '舰船页 · 「舰船仓库」可转入舰队或出售', page: 'ship', shipTab: 'store' }`
- **弹窗**：不写 `popup` 字段 ⇒ 走默认弹窗（船长原话「弹出通讯」正是默认口径）。

## 五、事实核对（落码前逐条查过，不凭记忆）

| 事实 | 出处 |
|---|---|
| 造船的**唯一出水口** | `manufacturing.ts` 的 `settlePiece()` → `kind === 'ship'` 分支：`state.shipStore[id] + 1`；`startManufacturing` 是唯一入队口，主控线与 AI 核心线共用 |
| 入仓条件（文案第 4 段的依据） | `shipyard.shipStorable()`：非驾驶中 · 无 AI 指派 · 未锁定 · 不在返航卸货 · **货仓清空** · **卸下模块** · **满耐久（结构与装甲都完好）** · 有自定义名需确认清除 |
| 卖船入口（文案第 3 段的依据） | 舰船页「舰船仓库」档按型「出售 1 艘」→ `engine.sellStoredShipAt`：有收购单即时成交，无收购单转限价卖单、可撤单退回仓库 |
| 顺带查出的**契约漂移** | `tools/content-check.ts` 的 `SHIP_TABS` 仍写 `['fleet','fit','ai']`——`'fit'` 早已不存在、`'store'` 缺失（2026-09-14「舰船市场」整档换「舰船仓库」时漏同步）⇒ 本批同步为 `['fleet','ai','store']`，否则本信的 `shipTab:'store'` 会被体检当场拦下 |

## 六、落点

| 处 | 改动 |
|---|---|
| `packages/core/src/types.ts` | `CommsTrigger` 增 `{ kind: 'shipBuilt' }`（带三态与置位点注释） |
| `packages/core/src/comms.ts` | `commsTriggerMet` 增 `shipBuilt` 分支（三态：true 发 / false 等真建造 / 缺失补发） |
| `packages/core/src/manufacturing.ts` | `settlePiece()` 造船分支置位 `state.firstShipBuilt = true`（只置一次） |
| `packages/core/src/state.ts` | 字段 `firstShipBuilt?: boolean` ＋ `createInitialState` 写 `false` |
| `packages/core/src/save.ts` | 三态归一化 ＋ 落键（写法照 `ambushRetreatSeen`） |
| `packages/data/src/messages.ts` | 追加 `msg-first-ship` |
| `tools/content-check.ts` | `TRIGGER_KINDS` 增 `shipBuilt` · `SHIP_TABS` 修漂移 · 新增死触发器守卫（数据里必须有可造舰船蓝图） |
| `packages/core/tests/comms.test.ts` | 触发器三态 ＋ 幂等 ＋ 老档补发 用例 |
| `packages/core/tests/ship-store.test.ts` | 造船置位断言（挂在既有「⑤ 组装机产出」用例上） |

## 七、验证读数（2026-09-15 落码后实测）

**五连（全绿）**

- `npm run typecheck` —— 四包 **0 错**；
- `npm run test -w @whale/core` —— **148 文件 / 1578 用例全绿**（较本批前基线 1575 **+3 例**：`comms.test.ts` 新增 3 条；`ship-store.test.ts` 的「⑤ 组装机产出」加一条置位断言）；
- `npm run content:check` —— ✅，通讯消息读数 **23 条消息（22 条带跳转）**（较基线 +1 条、+1 跳转）；两条既有预警（`bp-shieldchg-2` / `bp-shieldchg-3`）与本批无关；
- `npm run docs:index -- --check` —— ✅（**253 份**；本工作文档新增后已重出清册）；
- `npm run build` ＋ `npm run build --prefix web` —— ✅。
- `ui:rot-check` **不适用**：本批**零 UI / 样式改动**（弹窗与跳转都走既有通道，未新增界面代码）。
- 编码三查：10 个文件全部 **CRLF · loneLF 0 · 无 BOM**；`git status` 仅本批 10 个文件。

**负向验证（三处 · 各自精准 · 复原即绿）**

1. 撤掉 `manufacturing.ts` 的置位 ⇒ **4 例红**（`comms.test.ts` 3 条 ＋ `ship-store.test.ts` ⑤ 1 条）；
2. 触发器判定改成 `=== true`（= 退回"老档不补发"）⇒ **恰好 1 例红**（老档补发那条）⇒ 证明船长选的「丙」口径真在代码里，而不是只在注释里写着；
3. 把 `SHIP_TABS` 还原成旧值 ⇒ 体检**精确报** `✗ 通讯 msg-first-ship 舰船标签非法：store` ⇒ §五 那处漂移修正确实是本信能过体检的前置条件（同时证明该契约真的在拦）。

**可复现命令**

```
npm run test -w @whale/core -- tests/comms.test.ts tests/ship-store.test.ts
npm run content:check
```

## 八、合入记录（2026-09-15）

- **本批提交**：`e4b789d3`（11 文件 / +277）。**合入 main**：先 `git merge main`（main 已前进 16 条——一号四批：
  战利品与经济扩充 · 限时倍率表 · 越线折扣 · 虫洞大量生成），**冲突仅 `docs/INDEX.md` 一处**（生成件 ⇒
  取一侧后 `npm run docs:index` 重出，259 份）；合并后**全闸门复跑全绿**（typecheck 四包 0 错 · core
  **150 文件 / 1614 用例** · `content:check` ✅ · `docs:index --check` ✅ · `ui:rot-check` ✅ · 双 build ✅）
  ⇒ 合并提交 `d5241f40`，主树 `--ff-only` 追平 ⇒ **`main` = `verify40` = `d5241f40`**，主树干净、零差异。
- **主树产物已重建**（挂账①要求：主树干净后重建，船长的本地那份才含数据批与本信）：
  `npm run build`（desktop）＋ `npm run build --prefix web`；产物核对 = 渲染层 JS 内含本信主题与首段文案。
- **状态**：**待船长验收**；验收后按 §八（约定）三步归档：关键内容并入 `docs/design/comms-20260911.md` 新增
  §19 → 删除本工作文档 → 重跑 `npm run docs:index`。**未推送 origin**（推送闸门：要船长一句话）。
