# 虫洞战利品两件（稀有残骸闸门漏摘修复 ＋ 谜质说明）· 工作文档

> **状态：进行中**（三号 · `verify40` · 2026-09-15）
> 归档指向：验收并合入 main 后，关键内容并入 `docs/design/wormhole-extraction-endgame-20260912.md` 相关小节 ＋
> 词典对应词条，**本工作文档删除**（细节以 git 历史兜底）。

## 一、船长原话（照抄）

> 「**虫洞谜质添加说明：不建议出售。精炼炉好像缺少虫洞的稀有残骸回收？稀有残骸是按种族划分吗？**」

**三问的答案（结论先行）**

1. **谜质说明**：按原话在其物品说明里加「不建议出售」（§四，含一句张力登记）。
2. **精炼炉缺虫洞稀有残骸回收**：**确实缺，是 BUG** —— 洞内稀有残骸的物品卡上**还留着施工期的
   `unreleased` 闸门**（2026-09-14 虫洞上线时漏摘），而精炼炉「残骸回收」列表走玩家可见目录 ⇒
   它被挡在列表外（§二 取证链）。
3. **稀有残骸是按种族划分吗**：**是**，按**敌族（A/C/D/E/G 五族）**分池（§五）。

## 二、报障取证链（逐环节核过，不是推测）

| 环节 | 事实 | 出处 |
|---|---|---|
| ① 洞内真会打出稀有残骸 | 墓场「每 3 堆普通判一次（35%）」· 遗迹 2~3 堆 · 舰船信号固定 1 堆 | `core/wormholeSalvage.ts`（`WORMHOLE_RARE_JUDGE_CHANCE` 等） |
| ② 它带得回空间站 | 撤离收口把背包逐类 `addWare`（`wreck-*` 走拆解口径报账） | `core/wormholeBattle.ts` `deliverExtraction`（背包循环 + `addWare`） |
| ③ 物品卡注册时**被标了 `unreleased`** | `items.set(id, isWhCard ? { ...rareWreckItemDefOf(...), unreleased: true } : ...)`，注释写"随虫洞一起上线" | `data/src/context.ts` 第 62 行（**根因**） |
| ④ 精炼炉列表走**玩家可见目录** | 残骸档 = `visibleItemDefs(ctx)` 里 `kind === 'wreck'` 且持有 > 0 | `apps/desktop/.../IndustryPage.tsx`（`allItemDefs = visibleItemDefs(engine.ctx)`）；`core/inventory.ts` `itemReleased` |
| ⑤ 上线时**其他虫洞内容都摘了闸门，唯独物品没人管** | 体检那条"虫洞专属内容必须已上线"契约只枚举 **装备 / 舰船 / 装备图纸 / 舰船图纸 / 无人机**（前缀 `mod-wh-`/`sh-wh-`/`bp-wh-`/`sbp-wh-`/`drone-wh-`）——**物品根本不在里面**；而稀有残骸的物品 id 是 `wreck-rare-wh-*`（前缀 `wreck-rare-`） | `tools/content-check.ts` ⑥ 段（`WH_PREFIXES`） |

⇒ **后果**（= 船长看到的）：洞内打捞带回来的稀有残骸进了仓库，但精炼炉「残骸回收」里**没有这张卡**，
玩家开不了高级箱；顺带它在**手册物品图鉴**里也看不到（同一道闸门）。引擎侧一切正常（玩法不受闸门影响）。

## 三、修法（三处，均为"补做上线动作"）

1. `data/src/context.ts`：删掉 `isWhCard` 分支上的 `unreleased: true`（= 设计稿写的**上线动作**），
   并把那段"随虫洞一起上线"的注释改写成沿革（记明 2026-09-15 补做 + 漏摘后果）。
2. `tools/content-check.ts` ⑥ 段：把**物品**纳入"虫洞专属内容必须已上线"契约——
   `wreck-rare-wh-*` 前缀进判据 ＋ 逐张洞内敌卡断言"存在对应的稀有残骸物品"（防"打捞带回来的箱子开不了"）。
3. `core/tests/item-visibility.test.ts`：新增一条用例钉住"洞内稀有残骸在玩家可见目录里、
   且是**高级箱画像**（`recycleProfileOf(...).rare === true`）"。
4. 顺带：`data/src/wormholeFoes.ts` 那句"注册出来的物品一律 `unreleased`（施工期）"已过时，就地更正。

## 四、谜质说明（按原话落）

`data/src/items.ts` 的 `mat-wh-essence`（虫洞谜质）说明：
改前 `'虫洞内存在的奇幻物资，具备研究价值。装在密封匣里的冷辉结晶，回收商按枚收购。'`
⇒ 改后在其后补一句 **不建议出售**。

⚠ **张力登记（如实）**：该物品当前**只收不卖**（市场行 `playerBuyable: false`，NPC 按 **70,000/枚** 收购），
且**不进拆解/精炼/制造链**（船长 2026-09-15 原话：「该物品只收不卖。且具备较高价值，
**目前纯粹作为虫洞的金钱收益**」）⇒ 眼下它唯一的去向就是卖。因此这句「不建议出售」按**前瞻提示**读
（说明里本就有「具备研究价值」）；若船长本意是"留着以后当料"换个说法（如「建议留存」），改一行即可。

## 五、稀有残骸的划分口径（回答第三问，含证据）

**是，按敌族（`foeFamily`：A 海盗 / C 异形 / D 守墓者 / E 巨构 / G 鱿烬亡军）划分**，分三层：

1. **物品层**：每张敌卡有一件稀有残骸物品，id = `wreck-rare-<卡 id>`（20 张窝点卡 ＋ 15 张洞内卡）；
2. **开箱层**：回收炉起炉开高级箱时，**专属装备池按敌族取**（`core/lairs.ts` 的 `FOE_LAIR_GEAR[敌族]`，
   `lairGearOf(anomaly)` 按卡上的 `foeFamily` 查表）——未命中专属件则给**该敌群的主题件**兜底；
3. **内容层**：一处虫洞整趟只属于一族（敌人编成 / 稀有残骸 / 遗迹货柜 / 专属装备与舰船图纸都出自该族），
   公告亦如此写（`data/src/announcements.ts`）。

⇒ 所以"哪个族的箱子出哪个族的东西"成立；洞内 15 张敌卡按族进同一个池子（洞内卡没有"窝点核心"，
注册走的是白名单 `WORMHOLE_RARE_WRECK_CARD_IDS`）。

## 六、验证读数（2026-09-15 落码后实测）

**五连（全绿）**

- `npm run typecheck` —— 四包 **0 错**；
- `npm run test -w @whale/core` —— **150 文件 / 1615 用例全绿**（+1 = 本条新增的可见性用例）；
- `npm run content:check` —— ✅，虫洞内容契约读数由「**90 条**全部已上线」→「**105 条**全部已上线」
  （+15 = 15 张洞内稀有残骸物品纳入契约）；
- `npm run docs:index -- --check` —— ✅（**260 份**）；
- `ui:rot-check` ✅ · `npm run build` ✓ · `npm run build --prefix web` ✓（本批无 UI/样式改动，第五道闸门照跑）。
- 编码三查：7 个文件全部 **CRLF · loneLF 0 · 无 BOM**。

**负向验证（两处 · 各自精准）**：把 `unreleased: true` 加回 `context.ts` ⇒
① 新用例**恰好 1 例红**（「洞内稀有残骸在玩家可见目录里」）；
② 体检**精确点名 15 件**：`✗ 虫洞专属内容契约：残骸 wreck-rare-wh-pirate-scout（稀有残骸（劫掠支队））仍标着 unreleased…`。
复原即全绿。

**落码时踩到并已修的一处自伤**：新体检哨首版读**静态 `ITEMS`** 查稀有残骸 ⇒ 空集、误报 15 处
（它们是 `context.ts` **运行时注册**的，不在静态数组里）；改用真 context 的物品目录
（`buildSimContext().items`）后通过。已在代码注释里登记这条坑。

**可复现命令**

```
npm run test -w @whale/core -- tests/item-visibility.test.ts
npm run content:check
```

## 七、合入与状态

- 本批提交后 `git merge main`（冲突按生成件 `docs/INDEX.md` 处置：取一侧 → 重跑 `docs:index`），
  全闸门复跑绿后主树 `--ff-only` 追平；**主树产物已重建**（船长本地那份才看得到回收列表里的新卡与谜质新说明）。
- **未推送 origin**（推送闸门：要船长一句话）。
