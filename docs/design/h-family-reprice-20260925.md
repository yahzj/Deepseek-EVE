# H 族按新规调整（威胁重定价 · 入侵抽签 · 遇袭强度 ×0.75）

- 状态：**落码完成 · 待验收**（2026-09-25 · 二号 · d2）——四闸门全绿（typecheck / test 2,333 例 / content:check / l10n:check / build + docs:index），**未推送**
- 本文件 = 本批**唯一**工作记录（工作期间不改进旧文档；归档时把结论并入 roadmap / 词典 / 设计稿，本文件删除）

## 一、船长原话（照抄，按时间序）

1. 「我们回到H族上，按照新规对H族进行调整」
2. 「Q1，非旗舰威胁按照90/108/129定，旗舰因为是小队战，之后在讨论。Q2按照敌舰设定的属性比例重定，旗舰依旧是单独讨论。Q3伏击 ×0.5移除。旗舰卡单独。」
3. 「哦，看了下，伏击恢复×0.5，没问题。（伏击并不是袭击舰队）这边的残骸就不冻结了。」
4. 「能否让入侵遭遇的敌人卡是随机抽取的」
5. 「我希望的情况是，外围玩家主动出击和被动遇袭都是从骚扰和袭击舰队中抽取。核心区，则是抽取袭击和主力舰队。遇袭的时候遭遇的敌人按强度\*0.75算。」
6. 「确认」（对设计总结的显式确认）

## 二、范围（本批做）

1. **H 三张非旗舰卡重定价**：威胁 90 / 108 / 129（骚扰 / 袭击 / 主力）；
   属性 = **每艘船的血与单发同乘一个 K**（血 = 舰级血 × K · 单发 = 舰级单发 × K ⇒ 血÷DPS = 舰级自然比），
   K 取"最大且使 达成预算 = 5X ÷ 3 ≤ F(威胁) − 0.05"（与 12 张重定价批同款收敛口径）。
   - 骚扰 `ink-harass`：K = 2.2842（hpMul 2.2842 · dmgMul 1.4276）⇒ 血 3,325.80 · 峰值 DPS 116.00 · X 621.12 · 达成 1,035.20 ≤ 1,038
   - 袭击 `ink-raid`：K = 2.8281（hpMul 2.8281 · dmgMul 1.6969）⇒ 血 5,113.20 · 峰值 DPS 136.61 · X 835.76 · 达成 1,392.94 ≤ 1,393
   - 主力 `ink-main`：K = 1.3004（hpMul 1.3004 · dmgMul 0.7431）⇒ 血 7,167.80 · 峰值 DPS 173.18 · X 1,114.14 · 达成 1,856.90 ≤ 1,857
2. **入侵敌人卡随机抽取**：池 = 外围 {骚扰 90, 袭击 108} · 核心 {袭击 108, 主力 129}（等概率）；
   抽签走**入侵自己的随机子流**（`hash32`，不消费主随机序列）；
   悬赏板 + 主动出击 = 该星系"驻留"的那支（(种子, 本场入侵起始时刻, 星系 id)）；遇袭 = 每场重抽（再掺时刻档）。
3. **遇袭强度 ×0.75（真倍率）**：新增 `FoeOverride.strengthMul`（缩放 `hpMul`/`dmgMul`）；
   威胁标签 = 缩放后的**实测建档价**反解（骚扰 76 · 袭击 91 · 主力 109）；`WEEKEND_AMBUSH_MUL = 0.5`（标签）→ `WEEKEND_AMBUSH_STRENGTH_MUL = 0.75`（强度）。
4. **残骸不冻结**：`wreckGroups.ts` 的 `h-wh.threat` 45 → 93（= 四张卡回收口径体量的平均）；密度/注入/碎片门槛/档位应零变化（须 `content:check` 实测复核）。

## 三、不做（本批）

- **旗舰部队卡一字不动**（威胁 / 属性 / 波表 / 回收口径都不碰）⇒ 留待船长单独的"旗舰轮"。
- 引擎侧接线（悬赏替换进事件节拍与悬赏板、遇袭掷骰接进 tick、黑匣入库与定价、日志与通讯）= **M1-b 收尾另批**。
- A/C/G 三族的**主动出击**口径（78/120 覆写）不动（它们还在用虫洞池卡，等换独立卡那批一起收；已知不一致、登记在案）。

## 四、已知取舍（落码时如实保留）

1. 抽签粒度 = 板面/主动按星系定一支 · 遇袭每场重抽。
2. 主力卡那架机群相对偏弱约 42%（机群不吃多舰补偿、与炮台共用同一条 `dmgMul`）；要精确对齐需给该条目加 `droneFireShare`，本轮不做。
3. 主力卡第 2 波舰体 DPS 名义 162.4 越 150 线 ⇒ 按既有"超出部分 15% 折扣"实收 160.55，K 按折扣后收敛。
4. `waves[].hpShare` 保持现值不动（舰级路径下只影响命名档 / 排波次），在卡注写明它对本卡已惰性。
5. 遇袭标签：H 族用**缩放后实测价**（诚实）；A/C/G 三族沿用"主动威胁 × 强度倍率"的占位口径（与它们主动标签同一把尺）。

## 五、证据与验证

- 求解与实测：`tools/_h-solve.ts`、`tools/_h-winrate-probe.ts`（一次性探针，**收尾已删**）
- 参考行读数：中位单舰 S2 灰鲭鲨4×MK2+支援 × 全技能 Lv3（舰体 366 血）⇒ 三张卡 **0/9 · 0/9 · 0/9**（改前 9/9 全胜、残血 93~100%）
- 四闸门：`typecheck` · `test -w @whale/core`（2,333 例全绿，含新增 14 例）· `content:check` · `l10n:check` · `build` ＋ `docs:index --check`

## 六、落码清单（改了什么）

| 文件 | 改动 |
|---|---|
| `packages/data/src/wormholeFoes.ts` | 三张卡 `threat` 90/108/129 ＋ `hpMul`/`dmgMul`（K 2.2842 / 2.8281 / 1.3004 与各自 `÷补偿`）＋ 头注与逐卡注释重写（旧"血 = F×0.5 / 守恒"叙述标作废）；旗舰卡只加"本轮未动"的说明 |
| `packages/core/src/combat.ts` | 新增 `FoeOverride.strengthMul`（真缩放 `hpMul`/`dmgMul`，`firepowerAnchor` 同缩）＋ `foeStrengthOf` / `foeThreatOfAnomaly`（定价反解的唯一入口）；`startBattleFor` / `startFleetBattleFor` 把覆写存进战斗态；`advanceBattleFor` 重建敌卡时套用覆写（**修掉"只有第 0 波吃到覆写"**） |
| `packages/core/src/state.ts` | `BattleState.foeOverride?`（随档；类型内联避免循环）· `EncounterState.foeStrengthMul?` |
| `packages/core/src/save.ts` | `BATTLE_FIELDS.foeOverride = persist` ＋ `cleanBattle` 逐字段清洗（坏值丢、老档缺省零迁移） |
| `packages/core/src/weekendEvent.ts` | `WEEKEND_AMBUSH_MUL(0.5)` → **`WEEKEND_AMBUSH_STRENGTH_MUL(0.75)`**（语义：标签 → 真强度）；`weekendAmbushThreatOf` 删除，改为 `weekendAmbushPickOf`（抽卡 ＋ 倍率 ＋ 标签）；新增 `weekendFoePoolOf` / `weekendDrawFoeCardId` / `weekendGarrisonFoeCardId` / `weekendFoeCardsSelfPriced`；`weekendFoeCardOf` 收敛为"旗舰卡路由" |
| `packages/core/src/weekendBattle.ts` | `WeekendBattleSpec.foeStrengthMul?`；主动出击 = 驻留卡（威胁读卡面）· 遇袭 = 抽卡 ＋ ×0.75 ＋ 实测价标签；`waves` 改报该卡自身波数 |
| `packages/core/src/weekendBounty.ts` | 悬赏替换：H 族换成**抽到的那张独立卡**（真实 id · 覆写 `galaxyId`/名字/奖励 · 威胁 = 卡面）；A/C/G 仍走原卡派生 |
| `packages/core/src/encounters.ts` | 被占星系的遇袭改用 `weekendAmbushPickOf`（不再"就近选卡"）；遭遇记录带 `foeStrengthMul`，迎战时传进 `startBattleFor`（收掉 2026-09-23 那条"已登记待补"） |
| `packages/core/src/expedition.ts` | 被占星系悬赏战：**H 族不再传 78/120 覆写**（卡面威胁就是实测价）；A/C/G 不变 |
| `packages/core/src/wreckGroups.ts` | `h-wh.threat` 45 → **93**（成员回收口径体量平均；行为零变化） |
| `packages/core/src/index.ts` | 导出面同步（删 2 个旧符号、加 6 个新符号与 `WeekendAmbushPick`） |
| 测试 | 新增 `tests/h-reprice-20260925.test.ts`（14 例：定价式自检 · 逐舰血÷DPS = 舰级比 · 越线折扣 · 遇袭 ×0.75 与标签反解 · 抽签确定性与跨星系变化 · 残骸声明值）；改 `foe-dps-cap`（全表上界 115 → 129）· `weekend-battle` · `weekend-bounty` · `weekend-event` · `ink-tide-20260924`（E2E 改用 `strengthMul` 缩放） |

**顺带修好的两处旧账**（都写进代码注释）：
1. `packages/core/tests/weekend-bounty.test.ts` 里有一行把断言整条吞进注释（字面 `` `n ``），等于那条"派生卡保留原卡 id"没在测 ⇒ 已复原；
2. 开战覆写**只有第 0 波生效**（`advanceBattleFor` 每拍从 ctx 重建敌卡、不读覆写）⇒ 现在随档存下并每拍套用（对多波卡是硬需求）。

## 七、第二批（同日 · 船长令「**修，②**」：入侵敌人的残骸）

**起因**：船长问「入侵敌人的不产生残骸吗」⇒ 探针实测三条硬事实：
① 打捞型号池只收该星系**非 `hidden`** 的卡 ⇒ 四张入侵卡永远进不了池（`wreck-h-wh` 是**死条目**）；
② 胜利注入按"卡的 `galaxyId`"注入 ⇒ H 独立卡自带母港 ⇒ 会注进母港（主动出击接线后会踩，已登记）；
③ 奖励物品 id 写死 `'wreck-rare'` —— **目录里不存在**（真形态 `wreck-rare-<组key>`）⇒ 夺回 ×8 / 旗舰 ×3 发的是**未知物品**（不可回收、不能卖）。

**船长选 ②** ⇒ 给 H 族**新开一个洞外残骸组**，并把"产不出 / 发假物品"一起修掉：

| 文件 | 改动 |
|---|---|
| `packages/core/src/wreckGroups.ts` | `h-wh`（墨潮帮残骸（虫洞））**退役** ⇒ 新组 **`h-hi`（墨潮帮残骸（高安）· 稀有同）**：族 H · 地区 hi · 档位 common · 池 = 常档基础池 · 威胁 93 · 成员仍是四张入侵卡（旧组此前无任何产出路径 ⇒ 无存档可持有 ⇒ 改名零迁移） |
| `packages/data/src/wormholeFoes.ts` | 四张卡的 `region: 'wh'` → **`'hi'`**（卡级地区覆写随组走） |
| `packages/data/src/l10n.ts` · `rarityTier.ts` | 英文名与稀有度表随 id 换（普通 1 / 稀有 4，与其余高安残骸同档；旧 `wreck-h-wh` 两条删除） |
| `packages/data/src/marketCatalog.ts`（自动） | `WRECK_BUY_GOODS` 由 8 行 → **9 行**（洞外组自动获得站内收购行：常档收价 30 ISK·m³、只收不卖） |
| `packages/core/src/salvaging.ts` | **打捞池并入驻留舰队**：`wreckPoolOf` 在被占星系把"抽到的那支独立卡"并进型号池（取法与遇袭同源 `weekendBountyCardsOf`）⇒ 在该星系打捞能出墨潮帮残骸；不传 state/now = 老口径逐字不变 |
| `packages/core/src/weekendBattle.ts` | 新增 `weekendRareWreckIdFor(cardId, ctx)`（按"打的那张卡"的残骸组取稀有残骸 id）；`weekendGrantRewards` 改为**调用方给物品 id**，解析不到就不发（删掉假常量 `WEEKEND_RARE_WRECK_ID`） |
| `packages/core/src/expedition.ts` | 注入目标改为 `weekendBattleInvolvedOf(...)?.galaxyId ?? 卡的星系`（非入侵战斗逐字不变；H 主动出击那半仍待 M1-b 带星系开战） |
| `tools/content-check.ts` · `tools/salvage-econ.ts` | "会产出残骸"判据补上**入侵独立卡**（与"洞内卡按 wh 计"同理）；残骸收购卡行数契约 8 → 9 |
| 测试 | `h-reprice` 增 3 例（组换代/威胁 93/真实物品 id/**被占星系打捞能出 H 残骸 + 未占领抽不到的反证**）；`salvage`/`wreck-groups`/`item-visibility`/`ink-tide` 的地区与组数断言同步 |

**顺带修好的第三处旧账**：`market.ts` 的消化队列排空后残留 `price`（`qty=0` 仍带价）⇒ 存档清洗按"只留 qty>0"把它丢成 0 ⇒ **往返丢信息**（`save.test.ts` 的护栏抓到 `market.digest.<键>.price`）。现加不变量：`qty === 0 ⇒ price/perWindow 一并归零`。

**已知副作用（如实登记）**：新增第 9 张市场收购行 ⇒ **开盘铺簿的随机相位整体平移**。实测同一机制下逐种子差异极大——旧基线 seed 1/2/3/4/5/6 = 1232 / 22832 / **50000** / 22001 / 400 / 401；新增后 = **50000** / 800 / 832 / 50000 / 50000 / 50000（`market.test.ts` 的"收购额度"用例因此改用 seed 1，注释里留了全表读数）。机制未变。

**仍未做（登记）**：H 独立卡当悬赏时的"这一场在哪个星系"（M1-b 接线那批要把所在星系显式带进战斗，与"派生卡 id 归属"同一处）。

## 八、第三批（同日 · 旗舰轮 · 船长逐条裁定）

**船长原话（照抄，按时间序）**：
1. 「**血: 3920 → 39200**」（改入侵母舰的**船卡**）
2. 「感觉整体威胁可以上调了」⇒ 看过"威胁阶梯"（护航强度 = 旧 120 方案的百分比）后：「**取 170 威胁**」
3. 「打算加入新的火力钳制修正，150 有些不够看了」⇒ 看过"现行 150 是软坡、越线只削 15%"的读数后：「**看了下好像不钳制也没事，那先跳过吧**」⇒ 后补确认：「**火力钳制先按照现有的不做改变**」
4. 「**BOSS 血条 15 万（约 2.5 个母舰）来算**」
5. 「只有不落才会有撤离动画啊，因为如果血条清空自然就炸了**选甲**吧，然后既然选了甲就没必要做撤退动画了。**黑匣先做壳**。」

**落码内容**：

| 项 | 落值 |
|---|---|
| 舰级 `FOE_H_INK_FLAGSHIP.hp` | 3,920 → **39,200**（×10 · 船长指定；**脱离 T5 档基线 10×**，无硬契约拦，注释已标） |
| 旗舰卡 `ink-flagship` | 威胁 **170**（卡面，**不再覆写 120**）· `hpMul 1.7753` / `dmgMul 0.9468`（= K ÷ 补偿 1.875）· 系数 **小队 ×10** |
| 卡属性（引擎实测） | 母舰 **69,592 血 / 799 发**（＋2 架重袭机）· 战巡 ×3 4,971/658 · 干扰舰 ×3 1,598/186 · 突击舰 ×4 646/91 · 鱼雷舰 ×4 639/160；**全波 94,439 血 · 峰值 357.7 DPS**（名义 ≈398，吃现行 15% 折扣）· 达成预算 **2,906 ≤ F(170)=2,906** ✓ · **护航强度 = 旧 120 方案的 102%** |
| BOSS 池 | 新常量 `WEEKEND_FLAGSHIP_POOL_HP = **150,000**`，取代"5 × 首战最高伤害"与"母舰卡面满血 ×5"两条自适应公式（母舰 ×10 后 ×5 下限会飙到 ~35 万、与"约 5 场"脱节） |
| 母舰血条（船长选**甲**） | `FoeOverride.bossHp/bossShipId` ⇒ 开战传**池子剩余**（`weekendFlagshipHpRemaining`）；**逐拍重建与读档续战同源**（靠同批修的"覆写随档"）⇒ 单场不死名副其实、打空即击沉 |
| **结算链路修复**（拦路 bug） | `weekendBattleInvolvedOf` 原先认不出旗舰战（卡自带母港 + 核心满态不算"被占"）⇒ 探针实测"打完什么都不结算"（`undefined`/`null`、池子从未立起）；现按"遭遇槽挂该族旗舰卡 + 星系 = 本场核心"识别 ⇒ 记伤害、发奖、判击沉全部接通 |
| 黑匣（船长令"先做壳"） | 新物品 `blackbox-h`「墨潮旗舰黑匣」（`kind: 'kit'` = 无配方豁免档 · 稀有度 4 · 只收不卖市场行 · 中英双语）＋ `weekendGrantRewards` **真入库**（原先只有计数、无物品） |
| 火力钳制 | **不改**（现行 150 / 超出部分 15% 折扣） |

**同批修掉的三处旧账**（各写进代码注释）：
1. **存档往返丢 `market.npcBuy[].bm`**：引擎写的是 **`bm: true`（布尔门槛标记）**，读侧清洗器只留 price/qty/expiresAtGameMs ⇒ 丢键（`save.test.ts` 护栏抓到）。按"原样保留（布尔/数字/null）"修好——⚠ 踩了两次坑（先按数字滤掉布尔；再按"非数字落 null"⇒ 键在但值变 null、取样器视为无意义）。
2. `save.ts` 的 `orderList` 连**字段存在性**都不保 ⇒ 一并修（见上）。
3. `market.test.ts` 的"所有弹药供应单 ≤600"把**池通道**也算进来（弹药 MK2 同时有稀有批量档与 `poolTarget` 池通道）⇒ 按船长选**甲**只约束稀有通道，测试里写明两条通道。

**验证**：typecheck ✓ · `npm run test -w @whale/core` **2,335 例全绿** · content:check ✓（物品总数契约 100 → **101**）· l10n:check ✓ · build ✓ · docs:index ✓；一次性探针（`_bm-probe*.ts`、`_flagship-*`）全部删除。

**未做（本轮不做，登记）**：旗舰**撤退动画**（船长明示"选了甲就没必要做"）· 黑匣**用途**（开特殊装备/改装件，留待改装件那批）· **引擎接线**（被占星系悬赏替换 / 遇袭掷骰接进事件节拍）＝ 下一批，活动开关 `WEEKEND_DEBUG_ONLY` 保持 `true`（船长令「这条不变」）。



