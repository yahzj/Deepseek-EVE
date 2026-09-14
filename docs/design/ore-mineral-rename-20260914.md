# 原矿 / 原材料改名：EVE 撞名脱钩（2026-09-14 · 二号 · d2）

> **状态：已确认**（船长 2026-09-14 逐轮裁定，见下方「裁定链」）。
> 本稿是这次改名的**唯一权威对照件**；`docs/glossary.md`「原矿 / 原材料（术语）」条引用本稿。

## 一、起因

船长提问：「**现有的一些从 EVE 内采用的名词是否是 EVE 原创的？**」

全仓考证后把术语分成三类：

| 类 | 内容 | 判定 |
|---|---|---|
| **A 类** | 7 个矿物/矿石名 | **与 EVE 撞名**（6 个 id 是 EVE 原词 + 6 个中文名照 EVE 译名）⇒ 本批处理 |
| B 类 | 高/中/低槽 · 护盾装甲结构三层 · 信号半径/扫描分辨率/锁定范围 · 安全等级 · 舰种分类名（重型突击巡洋舰/截击舰/指挥舰/侦察舰/后勤舰/电子舰） | 词本身是**通用词**，EVE 原创的是**分类体系/用法** ⇒ 本批不动 |
| C 类 | 跃迁（warp，1931 科幻）· 虫洞（1957 物理学）· 加力推进（现实航空 afterburner）· 蓝图/无人机/声望/赏金 · 自造的 9 个矿物矿石名 · 伤害三系（动能/爆炸/等离子）· 全部海洋生物舰名 | **通用词或更早来源或我方自造** ⇒ 与 EVE 无关联，本批不动 |

**A 类逐项照抄程度**（考证出处：[EVE University Wiki · Minerals](https://wiki.eveuniversity.org/Minerals)）：

| 我方 id | 原名 | id 是 EVE 原词？ | 中文名是 EVE 译名？ |
|---|---|---|---|
| `min-tritanium` | 三钛合金 | ✅ Tritanium | ✅ |
| `min-pyerite` | 类银超金属 | ✅ Pyerite | ✅ |
| `min-mexallon` | 类晶体胶体 | ✅ Mexallon | ✅（EVE 作「类晶体胶矿」） |
| `min-nocxium` | 超噬矿 | ✅ Nocxium | ❌ 我方自译（EVE 作「超新星诺克石」） |
| `ore-veldspar` | 富凡晶石 | ✅ Veldspar | ≈（EVE 作「凡晶石」） |
| `ore-hemorphite` | 希莫非特 | ✅ Hemorphite | ✅ |
| `ore-scorched` | 灼烧岩 | ❌（`scorched` 自造） | ✅（EVE Scordite 的译名） |

配套已处理项：货币单位 **ISK**（EVE 的 InterStellar Kredits）已于 2026-09-13 改「**信用点**」全面退场。

## 二、裁定链（船长原话，按序）

1. 「**不用**（指不动市场收购倍率），回到上一个问题，**只换 A 类 7 个矿物/矿石名**」⇒ **范围 = 严格这 7 个**。
2. 选项「只改中文名 / 中文名 + id」⇒ 船长选 **只改中文名（id 不动）**。
3. 命名方向：「**尽量简单符合太空风格，或者直接用现实矿产也行**」。
4. 「**单一金属锭不太好，原本都是合金和胶体等材料，原矿可以采用太空地质系**」。
5. 定案：「**按 B 套，但是结构钢改为钛钢合金，铜铝合金改为银纹超金属**」＋第三个原矿选 **赤环岩**。

## 三、定案对照表（**id 一字未动**）

| id（不变） | 原名 | **新名** | 命名依据 |
|---|---|---|---|
| `ore-veldspar` | 富凡晶石 | **橄榄岩** | 现实地幔岩、最常见的超基性岩 —— 对应说明「最常见的低品位矿石，遍布新手星域」 |
| `ore-scorched` | 灼烧岩 | **辉长岩** | 现实深成基性岩（月球/火星陨石主要岩类）—— 对应说明「熔岩包裹的致密矿石」 |
| `ore-hemorphite` | 希莫非特 | **赤环岩** | 对应说明「**红色星环**内的高价值矿石」；不含金属名 ⇒ 与原矿"不表成分"的口径一致 |
| `min-tritanium` | 三钛合金 | **钛钢合金** | 合金（非单一金属）；对应说明「舰船装甲的基本原料，量大价稳」 |
| `min-pyerite` | 类银超金属 | **银纹超金属** | 保留原有材料类名「超金属」与 5 字长度；对应「结构与电子组件的常用材料」 |
| `min-mexallon` | 类晶体胶体 | **晶态胶体** | 胶体（非单一金属）；对应「高端设备与护盾模组的原料」 |
| `min-nocxium` | 超噬矿 | **重钨合金** | 合金（现实钨重合金，军工/航天配重）；对应「稀有矿物，制造旗舰级部件的核心」 |

**命名的三条自定原则**（本批建立，后续新增资源沿用）：
1. **原矿用地质名**（岩/石/晶/矿），**原材料用材料名**（合金/胶体/超金属/聚晶/晶）—— 与 2026-09-12「原矿 / 原材料」术语口径同构，一眼分得清层级。
2. **原矿不表成分**（否则名字里的金属与精炼产出对不上，会误导）。
3. 与保留的自造名（辉云岩 / 曦棱晶 / 玄晶 / 星幽矿 / 虚空母矿 / 同位聚晶 / 星髓晶 / 冥铁合金 / 虚空晶）**整词不冲突**。

## 四、改动清单（26 文件 / +79 −79 行，纯替换）

**玩家可见（11 个文件）**：`data/items.ts`（7 个 `name` + `ore-scorched` 说明）· `data/tutorialSteps.ts`(8) · `core/onboarding.ts`(7) · `data/blueprints.ts`(8) · `data/salvageFlavors.ts`(13) · `data/belts.ts`(3) · `ui/TutorialGuide.tsx`(2) · `data/skills.ts`(1) · `data/dialogues.ts`(1) · `data/stations.ts`(3) · `data/ships.ts`(1)

**契约与测试**：`core/tests/comms.test.ts`(1，教程动作标签断言) · `tools/content-check.ts`(1，说明契约举例注释)

**注释同步（防名词漂移，本批比 2026-09-12 那次多做一步）**：`core/mining.ts` · `core/station.ts` · `core/types.ts` · `core/comms.ts` · `core/tests/recycle.test.ts` · `ui/CommsPage.tsx` · `ui/game/engine.ts` · `data/anomalies.ts` · `data/marketCatalog.ts` · `tools/balance-check.ts` · `tools/liquidity-audit.ts` · `tools/make-test-save.ts` · `tools/salvage-econ.ts`

**一并修掉的两处**：
- `blueprints.ts` 的「重钨合金**合金**框架」叠词（原「超噬矿**合金**框架」替换后产生的重复词）
- 玩家可见处的**孤立简写**补全（「银纹与晶态」→「银纹超金属与晶态胶体」等 5 处）

## 五、边界与不动项

- **id 不动** ⇒ **零存档迁移**（玩家档里的矿石 id、市场池 key、精炼配方全部照旧）。
- **矿带名「灼烧裂隙」不动**（`belt-scorched` 的名字，"灼烧"在此是形容词，不是矿石名）。
- **`docs/` 历史记录不动**（`roadmap.md` 旧条目、26 份存量设计稿里的旧名保持原样）—— 本节所在的对照表是唯一的「旧称 → 新称」桥。
- **`content:check` 的「说明点名矿物」契约按 `def.name` 匹配**（`tools/content-check.ts:438` 起）⇒ 因为 `items.ts` 的 `name` 与各蓝图/物品 `description` **两边同时改**，该契约继续生效（只改一边会让它静默失效）。
- 教程交付走 **id**（`onboarding.ts` 的 `TUTORIAL_DELIVER_ITEM = 'ore-veldspar'`）⇒ 逻辑零影响。

## 六、验证

- `npm run typecheck` ×4 · `npm run test -w @whale/core` · `npm run content:check` · `npm run build` 全绿。
- 旧名（含简写 三钛/类银/类晶体/类胶/超噬/富凡/希莫非特/灼烧）全仓残留扫描 = **0 处**（唯一保留项为矿带名「灼烧裂隙」）。
- 编码三自检：BOM 0 · 裸 LF 0 · 往返解码不一致 0。
- `git diff --numstat` 逐文件**增删行数相等**（证明是纯替换，无丢行/无加行）。
