# 入侵族名用正式称呼（R 族 = 光环）· 2026-10-01

**状态**：进行中（待船长验收）
**经办**：三号（`H:\大鲸鱼\Deepseek-EVE-verify`，分支 `verify`）

## 船长原话（照抄）

> 「入侵的通讯应该采取更正式的名称，不应该直接用X族。」

追问位置后船长答：

> 「我是在入侵的通讯标内看到的。」

## 现象与根因（逐环有据）

船长在**入侵通讯的标题**里读到「**R 族**入侵」。

1. 二号本批把第二族 **R（光环）** 加进 `WEEKEND_FAMILIES`，并令**调试档必出 R 族**
   （`WEEKEND_DEBUG_FAMILY = 'R'`，见 `weekend-debug-family-20261001.test.ts`）——
   船长的档正是调试档（**只读取证**：`%APPDATA%\whale-idle\save.json` 的
   `state.weekendEvent` = `{ seq: 2, family: 'R', coreId: 'galaxy-shard' }`）。
2. 通讯侧的族名表（原在 `weekendComms.ts` 的 `WEEKEND_FAMILY_NAME_ZH` / `_ID`）**只登记了 A/C/G/H**，
   **漏了 R**。
3. 兜底那句写作 `` `${family} 族` `` ⇒ 把**内部族代号**原样印给玩家：
   标题「航线警告：**R 族**入侵」、正文「现在，**R 族**的舰队正在入侵这片空域…」。
4. 又因 `weekendFamilyNameId('R')` 返回 `undefined` ⇒ 通讯参数里**没有 `p1Id`**
   ⇒ **英文界面同样显示中文**「R 族」（连翻译都轮不上）。
5. 同一族的**悬赏名**还有三处同款写法 `` `${family} 族舰队 · ${卡名}` ``
   （`weekendBounty.ts` ×2 · `weekendBattle.ts` ×1）⇒ 星图上每条被占星系都印「**H/R 族**舰队 · …」。

## 改动台账

| # | 文件 | 改动 |
|---|---|---|
| 1 | `packages/core/src/weekendEvent.ts` | 族名表**迁到本文件**（族池 `WEEKEND_FAMILIES` 旁）并补 **`R: '光环'`** / `core.weekend.024`；兜底由 `` `${family} 族` `` 改为中性「未知势力」（`weekendFamilyNameId` 兜底 `core.weekend.025`）；新增 `weekendFoeFleetNameOf()` |
| 2 | `packages/core/src/weekendComms.ts` | 删本地族名表，改为**转发** `weekendEvent` 的两个函数（对外接口不变，`index.ts` 与渲染层不用改） |
| 3 | `packages/core/src/weekendBounty.ts` | 悬赏名两处（派生卡 / H·R 独立卡）改用 `weekendFoeFleetNameOf()` |
| 4 | `packages/core/src/weekendBattle.ts` | 遇袭·出击那条名字改用 `weekendFoeFleetNameOf()` |
| 5 | `packages/data/src/l10n/table.ts` | 新增 `core.weekend.024`「光环 / Corona Systems」＋ `core.weekend.025`「未知势力 / Unknown faction」；`core.combat.004`、`ui.consumable.002` 两处 ⟪文案调整 2026-10-01⟫ |
| 6 | `packages/core/src/combat.ts` | 墨潮捕获网战报的**中文兜底串**同步改「异形生物」（与 `core.combat.004` 同源） |
| 7 | `packages/core/tests/weekend-event.test.ts` | 新增三组钉子：**族名表覆盖全族池** · **R 族 = 光环（调试档那封预警信）** · **悬赏名用正式族名** |
| 8 | `packages/core/tests/weekend-bounty.test.ts`·`web-immunity-20260930.test.ts` | 旧文案断言同步，并各加一条「不许把族代号印给玩家」 |
| 9 | `tools/l10n-render-probe.ts` | 新增「入侵通讯 · 族名」专项：**渲染层真身**复算 H/R 两族 × 中英的标题与正文 |

### 文案调整（whale-copy §2.7 台账）

| 日期 | id / 位置 | 改动 | 依据（船长原话） |
|---|---|---|---|
| 2026-10-01 | `core.weekend.024`（新增） | 光环 / Corona Systems | 船长既有定名口径（`data/l10n.ts` 的 `WRECK_FAMILY_EN.r` ＋ `ui.Handbook.381`），**不另立新名** |
| 2026-10-01 | `core.weekend.025`（新增） | 未知势力 / Unknown faction（兜底） | 同上批报障：宁可给中性称呼，也不许族代号进玩家可见范围 |
| 2026-10-01 | `core.combat.004` | 中「C 族」→「异形生物」；英 `Aberrant` → `Alien` | 「不应该直接用X族」＋ 对齐权威族名表（`WRECK_FAMILY_EN.c`） |
| 2026-10-01 | `ui.consumable.002` | 中「墨潮帮（H 族）」→「墨潮帮」；英 `Ink Tide Syndicate (family H)` → `Ink Tide` | 同上（且英文名与 `core.weekend.023` 对齐） |
| 2026-10-01 | 悬赏名（`weekendBounty` ×2 / `weekendBattle` ×1） | `` `${family} 族舰队 · …` `` → 正式族名 | 同上 |

## 为什么族名表迁到 `weekendEvent.ts`

悬赏侧（`weekendBounty`）与战斗侧（`weekendBattle`）也要取族名，而这两个模块**被 `weekendComms` 反过来 import**
⇒ 族名表留在 `weekendComms` 会绕成**循环依赖**；放到 `weekendEvent`（族池定义处）三个消费方共用，零环。

## 已知取舍（待船长定）

- **悬赏名不再重复族名**：H/R 两族的独立卡卡名自带族名（「墨潮帮骚扰舰队」「光环 · 游弋集群」），
  照旧拼前缀会成「墨潮帮舰队 · 墨潮帮骚扰舰队」⇒ 现改为"卡名已含族名就只印卡名"。
  ⚠ 若船长要保留「XX舰队」这个抬头，说一声即改回（代价是上述重复）。
- **`core.combat.004`（战报）与 `ui.consumable.002`（信号发射器势力名）** 是同款"直接用X族"的残留，
  本批一并修；若船长只想动通讯，这两处可单独回退。
- **旧存档里已投递的通讯无需迁移**：主题/正文都按 id 现渲染 ⇒ 读档即修正。

## 范围外（本批不做）

- 二号 R 族整批的其它内容（舰级/装备/掉落/盲区修正）—— 一个字未动。
- 渲染层里 `weekendFamilyNameId(...) ?? 'core.weekend.023'` 那几处兜底（现在已是死分支）——
  留着不动，避免扩面；若要清理另开一批。

---

## 追加：G 族改名「鱿烬亡军 → 鱿鱼亡军」（2026-10-01 船长令）

> 「**将鱿烬亡军改名鱿鱼亡军。**」

同属「族名」主题 ⇒ 记在同一份工作文档。**英文一律不动**：「Deadarmy」对应的是「亡军」，
与「鱿」无关（船长只改中文）。

### 改动台账（追加）

| # | 文件 | 改动 |
|---|---|---|
| 10 | `packages/data/src/l10n/table.ts` | 4 条 zh：`core.weekend.022`（族全称）· `ui.comms.036`（通讯主题）· `ui.Handbook.362`（势力图鉴）· `ui.shipArt.007`（星图「敌对派系」短名 **鱿烬 → 鱿鱼**，与族名同步取头部） |
| 11 | `packages/core/src/wreckGroups.ts` | 族名表 `G` ＋ 6 处残骸组名 / 稀有组名 / 出矿 note（低安、虫洞两组） |
| 12 | `packages/core/src/weekendEvent.ts` | 通讯族名表 `WEEKEND_FAMILY_NAME_ZH.G` |
| 13 | `packages/data/src/anomalies.ts` · `modules.ts` · `messages.ts` · `wormholeFoes.ts` | 天底静区卡说明 · 两件专属件说明文 · `msg-exile-swarm` 主题与正文 · 洞内敌卡说明 |
| 14 | `packages/data/src/foe-ships.ts` · `factionCodex.ts` · `foe-drones.ts`；`packages/core/src/lairs.ts` · `types.ts` · `wormholeFoes.ts`；`apps/desktop/.../{droneArt,Handbook,shipArt,shipArtFoe,shipMounts}` | 开发侧注释同步（术语一致，非玩家可见） |
| 15 | `packages/core/tests/wreck-groups.test.ts`（断言）· `foe-ship-path.test.ts` · `lair-gear-g.test.ts`（头注） | 旧名断言/注释同步 |
| 16 | `docs/glossary.md` | G 族词条改名 ＋ 三层沿革留档（**术语权威 ⇒ 必须同步，否则两套口径并存**） |

### 有意不动的（请船长定 / 留到归档）

| 位置 | 为什么 |
|---|---|
| `packages/data/src/announcements.ts` 两条**已发布公告** | 「历史公告不回改」是既有实践口径，且公告发布须过船长审核 ⇒ **请船长定**要不要一并改「鱿鱼亡军」 |
| `modules.ts` 的 2026-09-13 沿革注释 · `docs/design/*` · `docs/archive/*` · `docs/roadmap.md` · `docs/INDEX.md` · `docs/test-saves/README.md` | 按 §8「工作期间不改旧文档」留到归档；沿革记录里的旧名按「说明它已作废」的语境保留 |
| 物品名 **鱿蜂无人机 / 鱿蜂群导控 / 流亡中继桅** | 船长只说改**族名**；「鱿蜂」是机型名（不是族名）⇒ 不动（与 2026-09-12 P-36「保留」的既有口径一致） |
| `ui.shipArt.007` 之外的英文位（`WRECK_FAMILY_EN.g` / `core.weekend.022.en` 等） | 均为 `Deadarmy` ⇒ 「亡军」照译，与「鱿」无关 |
