# 通讯英文回补（32 封 · 草稿待船长过目）（工作文档 · 2026-10-02）

**状态：进行中 · 已落码待验收**（2026-10-02 船长令「**进行落码吧**」；落码前的草稿阶段按 `whale-copy` 规程 §4 先过目后写码）
**经办**：三号（`H:\大鲸鱼\Deepseek-EVE-verify`，分支 `verify`）

## 1. 船长原话（照抄）

> 「**通讯英文回补放行。**」
>
> 过目后（同日）：「**等我的三句话，1是笔误，应该是声望。2没问题，3没问题。进行落码吧**」

（上文是三号 2026-10-02 的请示：「B-1 通讯英文回补（23 条）—— 英文界面现在显示旧正文或回落中文，是玩家可见缺陷，中文你已定稿。⚠ 需要你放行：你 10-01 说过「先不做英文」，现在做等于改判」）

## 2. 缺口读数（改前 · 探针实测，非估算）

**33 条登记了英文的通讯里，32 条的英文与中文脱节**（只有 `msg-lab-contraband` 一致——它是 10-01 18:20 中英同批重写的）：

| 类别 | 条数 | 英文界面现在会怎样 |
|---|---|---|
| **段数不符** | **14 条** | `commsBodyText()` 按行数对齐，**整段回落中文** ⇒ 英文界面整封显示中文 |
| 段数相同、内容旧 | 18 条 | 显示的是**改稿前**的英文（内容与中文对不上） |

段数不符的 14 条：`first-repair`(3/2) · `first-produce`(3/2) · `first-order`(3/1) · `first-ship`(3/2) · `first-wormhole`(3/2) ·
`msg-survey-memo`(3/2) · `msg-industry-shift`(3/1) · `msg-refinery-note`(3/1) · `msg-salvage-crew`(3/4) · `msg-site-thanks`(3/2) ·
`msg-exile-swarm`(4/1) · `msg-wh-siege`(4/3) · `msg-lowsec-rules`(5/2) · `msg-redring-outpost`(3/4)。

> 计数口径：探针的原始汇总行报「段数不符 19 条」= **重复计数**（COMMS_MESSAGES 内含 FIRST_TASK_MESSAGES，13 封「第一次」被数了两遍：5×2 ＋ 9 ＝ 19）⇒ 去重后实为 **14 条**；同理「段数同但旧」去重后为 **18 条**。
>
> 说明：起因是 10-01 那批「船长改稿落地 22 条」（`c5819548`）＋「9 封从零重写」（`bef8223c`）只改了中文侧——当时船长说「先不做英文」。

## 3. 落笔口径

1. **逐段对齐**：英文段数与中文**逐条相等**（不符就整段回落中文 ⇒ 等于没做）。
2. **术语走冻结口径**：`采集器 = Mining Laser` · `打捞器 = Salvager` · `近防炮 = Point Defense Gun (PD)` · `虚空晶 = Void Crystal` ·
   `亡军 = Deadarmy`（`鱿鱼亡军` ⇒ **Squid Deadarmy**）· `红环航道 = Redring Corridor` · `烬火星区 = Cinder Sector` · `奥罗荒环 = Auro Waste Ring` · `强化采集器 MK1 = Reinforced Mining Laser MK1`。
3. **保留既有英文的声口**：上一版英文（一号/三号合写）的句式与用词能对上的照用，只重排"中文改过"的部分——不重造文风。
4. 通讯语域：**角色口吻 ＋ 第二人称**，一段一件事；不塞机制清单。

## 4. 草稿（逐条 · 中英对照）

### 4.1 「第一次」13 封（`firstTaskMessages.ts`）

**first-scan（3 段）**
1. 中：星图上那些只剩剪影的位置，就是还没解读的未知信号；派一艘深空扫描艇过去就能点亮它。
   英：On the star map, those silhouettes are unknown signals nobody has read yet. Send a deep-space scanning craft over and one lights up.
2. 中：点亮之后，那处星系的航线、矿带、悬赏与残骸情报才会进入可作业清单；越危险的星系，扫得越久。
   英：Only once a system is lit do its routes, belts, bounties and wreck sites enter your work list. The more dangerous the system, the longer the scan.
3. 中：检查发现了仓库内积压的一台强化采集器 MK1，下一步要下矿带，正好装上它。
   英：The self-check turned up one Reinforced Mining Laser MK1 sitting in storage. A belt is next on the list, so fit it now.

**first-mine（3 段）**
1. 中：矿带产出原矿，精炼炉把原矿炼成原材料，而绝大多数蓝图要的正是原材料。
   英：Belts yield raw ore, the refinery turns raw ore into materials, and most blueprints ask for materials.
2. 中：原矿按市价直接卖也能赚钱，不过送进精炼炉再卖通常更划算。
   英：Selling raw ore at market price does pay, but running it through the refinery first usually pays better.
3. 中：检查发现了一批仓库内积压 1,000 单位橄榄岩，精炼炉每批吃 100 单位，这批料够开十炉。
   英：The self-check turned up 1,000 units of Peridotite in storage. The refinery takes 100 units a batch, so this is ten batches.

**first-refine（3 段）**
1. 中：精炼炉在原料充足的时候会持续运转，各种生产所需的基础材料都是通过精炼炉获取。
   英：The refinery keeps running as long as it has feed; the base materials every production line needs all come out of it.
2. 中：「精炼学」每级 +6% 产出，「高级回收处理」每级 +3%，两条练满合计 165%。
   英：Refining adds 6% output per level and Reprocessing adds 3%; both maxed comes to 165%.
3. 中：检查发现了一张仓库内积压的「动能弹药生产线」蓝图，它的材料是钛钢合金，正好由原矿炼出来。
   英：The self-check turned up a Kinetic Ammo blueprint in storage. Its material is Tritanium Alloy, which raw ore refines into.

**first-bounty（3 段）**
1. 中：各个星系都有常驻悬赏。完成悬赏是我们前期直接获得声望和信用点的唯一途径。
   英：Every system keeps standing bounties. Running them is the one direct way to earn standing and credits early on.
2. 中：声望是章鱼人协会的通行证。只有积攒生物才能解锁更多市场物品和功能。　⚠ 见 §5 疑点①
   英：Standing is your pass with the Association. Banking it is what unlocks more market goods and more functions.
3. 中：检查发现了一艘仓库内积压的低级战舰，已将其编入舰队。
   英：The self-check turned up a low-tier warship in storage; it has been moved into the fleet.

**first-repair（2 段）**
1. 中：大部分情况下战斗结束后护盾会自行回满，装甲与结构的损伤则会保留，需要依靠修理组件与港内工位处理。
   英：Shields refill on their own after a fight, but armor and hull damage carries over — that takes repair kits, or a berth back at a station.
2. 中：检查发现了仓库内积压的民用船体维修装置 ×1 与民用修理组件 ×20。
   英：The self-check turned up 1 Civilian Hull Repair Unit and 20 Civilian Repair Kits in storage.

**first-salvage（3 段）**
1. 中：星系里的残骸点可以派船打捞，捞回来的残骸送进精炼炉就能回收出各种材料。
   英：Wreck sites in a system can be salvaged by sending a ship over, and the wreckage you bring back is recovered into materials of every kind.
2. 中：想要打捞就必须给舰船安装打捞器。
   英：To salvage at all, the ship has to be fitted with a salvager.
3. 中：检查发现了仓库内积压的附 1,000 m³ 高安海盗残骸，送进回收炉就是材料与旧件。
   英：The self-check turned up 1,000 m³ of high-sec pirate wreckage in storage; through the recycling unit it becomes materials and old modules.

**first-skill（3 段 —— 第 2 段中文内含换行，英文同样保持一段两行）**
1. 中：技能数据库丢失，技能需要重新进行训练。
   英：The skill database is gone. Every skill has to be trained again from scratch.
2. 中：为了更方便展开活动，需要先掌握「AI 核心操作学」。
   　　「AI 核心操作学」在「技能」页的「工程」里，切过去就能看到；它是调度副船与自动产线的前置，越早练越省事。
   英：To get more done at once, train AI Core Operation first.
   　　It sits under Engineering on the Skills page. That is the prerequisite for dispatching support ships and running automated lines, so the earlier you train it the less trouble later.
3. 中：检查发现了仓库内积压的一枚基础 AI 核心，下一步派副船正好用得上。
   英：The self-check turned up one Basic AI Core in storage; you will want it for the support ship assignment next.

**first-ai（3 段）**
1. 中：闲置舰船配上一枚 AI 核心就能自己出航。采矿、打捞、驻留待命都能接，每项指派占一枚核心。
   英：An idle ship with an AI core can put to space on its own: mining, salvaging and standing by are all on offer, and each assignment takes one core.
2. 中：战斗、运输与虫洞扫描太复杂，只能依赖舰载 AI。　⚠ 见 §5 疑点③
   英：Combat, hauling and wormhole scanning are too complex to hand to a core; those the shipboard AI flies itself.
3. 中：检查发现了仓库内积压的 150 单位钛钢合金与 50 单位银纹超金属，下一步开线正好用这批料。
   英：The self-check turned up 150 units of Tritanium Alloy and 50 of Silvervein Supermetal in storage — exactly the feed the next line needs.

**first-produce（2 段）**
1. 中：组装机要三样东西：蓝图、材料、时间；装上 AI 核心后组装机就能无人值守自动开线。
   英：The assembler needs three things: a blueprint, materials and time. Fit it with an AI core and the line runs unattended.
2. 中：弹药与修理组件这类消耗品最适合常驻开线，市场内对零件的需求量很大，可以作为赚取信用点的手段之一。
   英：Consumables like ammo and repair kits are the best fit for a standing line, and the market absorbs parts in volume — one way to earn credits.

**first-order（1 段 —— 中文内含换行，英文同样一段三行）**
1. 中：我们可以在市场上出售多余物资或者购买缺少的资源。
   　　市场采用订单制。因此可以提前挂单出一个自己期望的价格。
   　　不过如果想快速收购某个稀少的商品，建议挂出五倍以上的价格。
   英：We can sell surplus goods on the market, or buy the resources we are short of.
   　　The market runs on orders, so you can post at whatever price you want ahead of time.
   　　If you need to buy up something scarce quickly, post at five times the going price or more.

**first-ship（2 段）**
1. 中：第一艘自造船已经入库。
   英：The first home-built hull has landed in storage.
2. 中：新建造的舰船都存放在「舰船仓库」，在「舰船仓库」页转入舰队，再到「装配」页配好槽位与弹档就能出港。
   英：New hulls all sit in Ship Storage. Move one into the fleet on the Ships page, then fit its slots and ammo on the Fitting page and it can leave port.

**first-haul（3 段）**
1. 中：站间运输按趟结算，报酬随行情浮动，船上原本的货不受影响。
   英：Station-to-station hauling settles per trip and the pay floats with the market. Cargo already aboard is unaffected.
2. 中：低安航段会遇袭，因此请尽可能提高舰船的战斗力或维修能力。拥有维修能力后，受损的舰船会自动维修继续执行任务。
   英：Low-sec legs draw ambushes, so raise the ship's firepower or its repair capacity as far as you can. With repair capacity fitted, a damaged ship patches itself up and carries on with the run.
3. 中：检查发现了仓库内积压的一艘飞鱼级快运舰，跑长途用它更合适。
   英：The self-check turned up one Flyingfish-class Courier in storage; it suits the long routes better.

**first-wormhole（2 段 —— 第 1 段中文内含换行，英文同样一段三行）**
1. 中：虫洞是危险的未知区域。在这里战斗都是发生在比较近的距离且战斗中几乎无法脱战。
   　　但是虫洞也是虚空晶唯一的来源。在虫洞内可以获取大量虚空晶，各类残骸，以及各种货柜。
   　　货柜可以获取不同的稀有图纸或者装备。是中期快速提升战斗力的手段。
   英：Wormholes are dangerous, unknown space. Fights inside happen at close range, and once one starts there is almost no breaking away.
   　　A wormhole is also the only source of Void Crystal. Inside you can pull out large amounts of it, along with wreckage of every kind and all sorts of containers.
   　　Containers hold rare blueprints and modules — it is how a mid-game fleet gets strong fast.
2. 中：协会已经标记 2 处未探索虫洞坐标，到星图页的「扫描虫洞」标签决定何时进去。
   英：The Association has marked two unexplored wormhole coordinates for you. Decide when to go in from the “Scan for wormholes” tab on the star map.

### 4.2 系统 / 势力通讯 19 封（`messages.ts`）

**msg-briefing（12 段）**
1. 【自检记录｜本舰】 → [Self-check log | this ship]
2. 自检完成。乘员栏为空，船体与记忆均存在缺失扇区。 → Self-check complete. The crew roster is empty; hull and memory both have sectors missing.
3. 身份档案损坏。 → The identity file is corrupt.
4. 【待办｜第一次】 → [To-do | The First Time]
5. 自检程序列着一份清单：第一次扫描、第一次采集原矿、第一次操作精炼炉…… → The self-check has a list: first scan, first raw ore, first turn at the refinery…
6. 建议按自检程序推进。 → Work it in the order the self-check laid out.
7. 每完成一项，信息库就把相关情报补录到收件箱。 → Each time you finish one, the Archive files the related intelligence into your inbox.
8. 【起步】 → [Starting out]
9. 先把母港所在星域扫一遍。 → Start by sweeping the system your home port sits in.
10. 星图上的位置要先点亮，那里的矿带、航道与悬赏才会进入可作业清单。 → A position on the star map has to be lit first; only then do its belts, lanes and bounties enter the work list.
11. 【备注】 → [Note]
12. 清单长期留在任务中心，随时回看。 → The list stays in the Task Center, ready to be read again at any time.

**msg-welcome（3 段）**
1. 飞行员，协会的通讯终端已经接到你这条船上。往后协会各部门的公告都会直接发到这里。 → Pilot, the Association comms terminal is now wired into this ship. From here on, notices from every Association department arrive right here.
2. 导航栏「通讯」上有未读时图标会闪，记得及时查看。 → The “Comms” item in the nav flashes while anything is unread — check it when it does.
3. 作为新人如果不知道做什么可以考虑从常驻悬赏开始接起。 → If you are new and unsure where to start, the standing bounties are a good first stop.

**msg-survey-memo（2 段）**
1. 你已经探索了不少星系。想必应该明白星图上那些还没点亮的「未知信号」，扫开之后往往同时解决两件事：一是航路，二是货源——很多矿带与残骸场就在没人去过的星系里。 → You have mapped a good number of systems by now, so you have probably worked out what those unlit “unknown signals” are worth: scanning one settles the route and the supply in the same pass — plenty of belts and wreck fields sit in systems nobody has visited.
2. 顺带提醒：安全等级越低的地方，扫描越就费时间，这时候你应该去提升你的扫描技能了。　⚠ 见 §5 疑点② → One reminder: the lower the security level, the longer an on-site scan takes, and that is the point to train your scanning skills.

**msg-cinder-warning（3 段）**
1. 飞行员，这里是协会航线安全。 → Pilot, this is Association Route Safety.
2. 你刚点亮烬火星区，先给你一句实话：那边能见度极差，进了深处基本靠仪表认路。常年在那片活动的是火力配齐的编队，不是散兵。你的名字进了它们的射程，能不能出来只取决于装甲撑得够不够久。 → You have just lit the Cinder Sector, so here is a straight word: visibility there is terrible, and deep in you navigate by instruments alone. What works that space year-round is fully armed formations, not stragglers. Once you are inside their range, whether you come out depends only on how long your armor holds.
3. 协会不建议没改装的船单舰往里走。真要去，出发前在装配页把装甲和推进器补齐，备弹也多带点——那里的战斗不给第二次装填的机会。 → The Association does not advise taking an unmodified ship in alone. If you go anyway, fill out armor and thrusters on the Fitting page before departure and carry spare ammo — fights there do not hand out a second loading.

**msg-industry-shift（1 段）**
1. 缺钱了？协会工业部提醒一句：空间站内的各种工业设施都是免费开放，因此请不要使用没有安全保证的非官方工业设施。 → Short on credits? A word from the Industry Dept: every industrial facility on a station is free to use, so do not turn to unofficial ones with no safety guarantee.

**msg-refinery-note（1 段 —— 中文内含换行，英文同样一段三行）**
1. 中：老有人问精炼到底划不划算，俺们就给个交底。
   　　精炼肯定是赚的，问题只是赚多赚少。掌握了各种处理技能的老手可是能赚的盆满钵满。
   　　至于新人也不要灰心，毕竟没有人一开始就是老手，学习技能，从现在开始！
   英：People keep asking whether refining is worth it, so the Smelting Group will give it to you straight.
   　　Refining pays, always — the only question is how much. Veterans with the processing skills trained up make a fortune at it.
   　　And newcomers should not be discouraged: nobody starts out a veteran. Train the skills, starting now.

**msg-salvage-crew（4 段）**
1. 飞行员，老陈一队给你留个话。 → Pilot, Old Chen's crew left you a word.
2. 我们这帮人常年各星系转，残骸场里的东西从来不缺，缺的是愿意停船捡的人。普通残骸拆开有保底原材料，另外看运气能出装备和蓝图碎片；窝点打下来的那种稀罕货更值钱，交给回收炉能解体出整件装备。 → Our lot drifts from system to system, and wreck fields never run short of things — what runs short is people willing to stop and pick them up. Common wreckage breaks down into guaranteed raw materials, and with luck it gives up modules and blueprint fragments too. The rare stuff left behind by a lair is worth more: the recycling unit strips whole modules out of it.
3. 记着一件事：残骸按体积记账。货舱塞满就自动返航，想多捡就先把货舱换大。 → One thing to remember: wreckage is booked by volume, and a full hold sends the ship home on its own. Want to carry more? Fit a bigger hold first.
4. 星图的残骸打捞页去看一眼，我们标了几处好场子。 → Take a look at the wreck salvage page on the star map — we marked a few good fields.

**msg-site-thanks（2 段）**
1. 红环前哨站并网运行的第一个班次，基建部全体向你致意。 → On the first shift of the Redring Outpost running on the grid, the whole Infrastructure Dept salutes you.
2. 我们感谢你在空间站建设过程中的贡献，因此决定无偿给予你使用空间站各种设施的权限。 → We thank you for what you put into the station build, and have decided to grant you free use of every facility it carries.

**msg-auro-megastructure（4 段）**
1. 我们发现你将「奥罗荒环」录进星图了。因此在这里给你一些意见：那片环带上的残骸不是普通船壳，是几具还在运转的巨构残骸。 → We see you have logged the Auro Waste Ring onto the star map, so here is a word of advice: the wreckage on that ring is not ordinary hull — it is several megastructures, still running.
2. 巨构残骸的很多核心都还在运转，它们会把进到射程里的东西当靶子。 → Most of their cores are still live, and anything that comes inside their range is treated as a target.
3. 更麻烦的是挂在它身上的警戒机群——那是它的第二套火力，打掉几架还会从机库里补位。机群平时伸不了太远，可只要本体挨了打，残存的自动程序就会放开它们的射程：长臂能一直伸到两万米以外，而且这一场里不会收回去。 → The worse trouble is the sentry swarm riding on it: that is its second set of guns, and shooting down a few only brings replacements out of the hangar. The swarm stays short-ranged most of the time, but once the structure itself takes a hit the surviving automation lets their range out — the long arm reaches past twenty thousand metres and does not pull back for the rest of the engagement.
4. 还有一条实用的：巨构残存的近防炮专打无人机，放出去的东西还没靠近就会被一架架点掉。反过来也一样——想清掉警戒机群，只有带防空属性的武器筛得到目标，装一门近防炮就是为这种场面准备的。 → One more practical note: the megastructure's surviving point defense exists to kill drones, and anything you launch gets picked off one by one before it closes. The reverse holds as well — the only way to clear the sentry swarm is weapons with the point defense attribute, and fitting a point defense gun is exactly what that job calls for.

**msg-exile-swarm（1 段 —— 中文内含换行，英文同样一段两行）**
1. 中：你探到的这片空域有「鱿鱼亡军」活动——它们是不服从协会管理的叛军组织。一直在试图推翻协会。
   　　目前它们的主力已经被协会给击溃了，但是还是有不少的残部在活动。因此在这些星区活动需要小心。
   英：The space you have scanned has Squid Deadarmy activity — a rebel outfit that answers to no one and has been trying to overthrow the Association.
   　　Their main force has already been broken, but plenty of remnants are still operating, so keep your guard up in those sectors.

**msg-wh-siege（3 段）**
1. 你已经到达了虫洞深层。从这一层起，驻守的敌人不再等你上门：他们开始主动围剿你了。 → You are down in the deep layers of the wormhole. From this layer the garrisons stop waiting for you: they start hunting you down.
2. 每回合敌人都会增援，它们会占据各个地点。只有击退地点上的敌人你才能安心进行活动。 → Every turn brings enemy reinforcements, and they take tiles as they come. Only by driving the enemy off a tile can you work there in peace.
3. 在少数时候，敌人甚至会跃迁到你的位置抓你。 → On rare occasions they will even jump straight onto your position to catch you.

**msg-lowsec-rules（2 段 —— 第 2 段中文内含换行，英文同样一段两行）**
1. 观测部报告说你已经探到低安星系了。因此有必要给你发一则注意事项。 → The Observation Dept reports you have scanned into low-sec systems, so a note on the rules is in order.
2. 中：低安星系都是协会无法照顾到的星系，因此经常会有海盗流窜袭击过往的舰船。建议给你在该地区活动的舰船配备一定的战斗力和修理装置。或者干脆加派一艘舰船在该星系巡逻。
   　　不过被袭击了通常只是损失一些货仓物品，在有跃迁的情况下，这些流寇很难真正留下你。
   英：Low-sec systems are ones the Association cannot look after, so pirates roam them and jump passing ships. Fit whatever you send in there with real firepower and a repair unit — or post a second ship to patrol the system outright.
   　　An ambush usually costs you only some cargo, though: with a working warp drive, those raiders rarely manage to hold you.

**msg-redring-outpost（4 段）**
1. 飞行员，见字好。协会基建部有件事想问问你的意思。 → Pilot, greetings. The Infrastructure Dept has something to put to you.
2. 红环航道上没有可用泊位，往来船只要绕远。协会打算在那里放一座前哨站，位置已经勘好了。工程不整包外包，只分材料单：按档交齐建材就推进一档，交到最后一档就并网。 → The Redring Corridor has no usable berth, and ships passing through have to go the long way round. The Association plans to place an outpost there, and the site is already surveyed. The work is not contracted out whole but split into a materials list: deliver one tier of materials and the build advances one stage, and the last tier brings it onto the grid.
3. 建成之后，泊位、维修、补给和换船一并对你开放，往后跑这条线省下的时间不止一点。有意的话，把建材备在货舱里，到地方按单交付就行。协会照档结算，不多收一分。 → Once it is up, berths, repairs, resupply and ship swaps all open to you, and the time saved on this corridor is no small thing. If you are interested, keep the materials in your hold and deliver them on site — the Association settles by tier and takes no extra credit.
4. 星图里选「红环航道」，可以看那份交付单。 → Pick “Redring Corridor” on the star map to read the delivery list.

**msg-wormhole-nebula（4 段）**
1. 备忘：虫洞第 4 层起，深处开始出现星云带。以下按你的推进节奏整理一次。 → Memo: from layer 4 of a wormhole, nebula belts start appearing in the deep. Here it is once, in the order you will meet it.
2. 星云会挡住落在里面的地点信号。第一次扫到它，你看不出那是什么地点，只看到云本身。 → A nebula masks the signal of any site inside it: on the first scan you cannot tell what the site is, only see the cloud itself.
3. 应对办法是在原地再扫一次。同一片区域归同一套扫描阵列管，第二遍能把云驱散，信号随即显形。 → The answer is to scan the same spot again — one region is covered by one scanning array, so the second pass disperses the cloud and the signal shows through.
4. 代价是多花一个回合。深层行动的回合本来就紧，规划路线时把「多扫一次」算进预算，别到拐角才发现不够用。 → The cost is one extra turn, and turns are tight in deep operations anyway, so budget that extra scan when you plan a route instead of finding out at the corner that you are short.

**msg-wormhole-unlock（5 段）**
1. 备忘：你的协会声望已达 40，可以接入虫洞扫描阵列。 → Memo: your Association standing has reached 40, so you can connect to a wormhole scanning array.
2. 阵列装在船上，扫的是星域之间那些不稳的虫洞。扫满一个窗口，就能标出一处可进入的虫洞。 → The array is fitted to a ship and scans the unstable wormholes between systems; fill one window and it pins down one enterable wormhole.
3. 标出来的先存着，最多同时存五处，什么时候去由你决定。扫描期间照常会遇上航线上的那些事，遇袭也不影响进度，阵列自己接着扫。 → Found wormholes are kept until you decide to go, five at a time at most. The usual route events still happen while scanning, and an ambush does not stall the work — the array keeps scanning on its own.
4. 开始扫描的位置：星图「出港」页的「扫描虫洞」标签。 → To start a scan: the “Scan for wormholes” tab on the star map’s Undock page.
5. 标出来的每一处都不一样，残骸多、矿脉密、驻守舰队的来路各有各的。进洞之前你就能看明白。进洞前给编队装上「采集器」与「打捞器」——洞里的矿脉靠采集器采，遗迹与残骸靠打捞器捞。 → Every wormhole found is different — one holds more wreckage, one has denser ore veins, and the garrisons inside come from different outfits — and all of it can be read before you go in. Before you enter, fit the squad with mining lasers and salvagers: ore veins inside are worked with mining lasers, ruins and wreckage with salvagers.

**msg-ambush-retreat（4 段）**
1. 刚才那次脱离交火，不是故障，别去拆船。 → That break-off was not a malfunction — do not go taking the ship apart.
2. 你在低安空域挨了打。装甲或结构掉到一半以下，船会按保命规矩自动脱离交火。补不动的，就收手返港待命。 → You took hits in low-sec. With armor or hull below half, the ship breaks off on the survival rule; whatever it cannot patch up, it leaves alone and returns to port to wait for you.
3. 规矩就两条。结构掉一半以下自动脱离，绝不弃船。补得动，留在原地继续干活；补不动，才回家。 → There are two rules. Below half hull it breaks off automatically, and the ship is never abandoned. If it can patch up, it stays where it is and keeps working; only if it cannot does it head home.
4. 自动修补有个前提，船上得有中槽的船体维修装置。它只吃与装置对应的那种修理组件。民用维修装置吃民用修理组件，一批 5 枚、每枚补得少；MK1 与 MK2 吃军用修理组件，一批 3 枚、每枚补得多。两种组件都能在工业页自制，图纸市场有售。断料，或者压根没装维修装置，都是它被送回家的原因。 → Self-repair has one precondition: a mid-slot hull repair unit has to be fitted. It only burns the repair kit that matches the unit — a civilian unit takes Civilian Repair Kits, five to a batch and a small patch each, while MK1 and MK2 take Military Repair Kits, three to a batch and a bigger patch each. Both can be built on the Industry page and the blueprints are sold at market. Running dry, or having no repair unit at all, is what sends it home.

**msg-first-ship（4 段）**
1. 组装机线交出了第一艘船。从这条船开始，产能不再只出零件与弹药。 → Your assembler line has handed over its first hull. From this ship on, your output is no longer limited to parts and ammo.
2. 船停在舰船页的「舰船仓库」。组装机造好的船一律先进仓库，同型堆叠计数。 → The hull sits in Ship Storage on the Ships page; anything the assembler finishes lands there first and stacks by type.
3. 点「转入舰队」就编进机库，之后可切换驾驶，也可装上 AI 核心派出去干活。 → Click “Move into fleet” and it joins the hangar; from there you can swap to flying it, or fit an AI core and send it out to work.
4. 卖船也在这里，仓库里可直接出售。有收购单当场成交，没人收购就自动挂卖单，随时可撤单退回仓库。入仓规矩：只有卸下模块、结构与装甲都完好、货仓清空的船才收得进去，正在驾驶或带着 AI 任务的船要先空出来。 → Selling happens there too: ship storage sells directly — a standing buy order fills on the spot, and with no buyer the hull is listed automatically, and a listing can be pulled back to storage at any time. One storage rule: only ships with modules removed, structure and armor intact and an empty hold are accepted; a hull you are flying or one on an AI task has to be freed up first.

**msg-pirate-capture-web（5 段）**
1. 通报一个情况：劫掠海盗里出现了「劫掠电子舰」。它不带重炮，专门张开一张劫掠捕获网。 → Route Safety reports something new: raider groups are fielding a “Raider Electronic Ship”. It carries no heavy guns — its job is to spread a raider snare net.
2. 被网住的那一艘会同时吃四种亏：机动掉到只剩一成、推进器全部熄火、闪避彻底失效、武器射程被压短 500 米。 → The ship caught in it takes four hits at once: mobility down to a tenth, every thruster dead, evasion gone entirely, and weapon range cut by 500 metres.
3. 网是拴在它自己身上的。把它击沉，网立刻松开；把距离拉到 4500 米以外，网也会自己绷断。 → The net is tied to the ship that cast it: sink that ship and it releases at once, and the caught ship is back to normal on the spot; open the range past 4,500 metres and the net snaps on its own.
4. 它整场只张一次网，而且只罩得住当时被它锁定的那一艘。 → The good news: it spreads the net once per engagement and only over whatever it had locked at that moment — once it is broken, no second net comes.
5. 建议：遇到它别急着换目标，先把它点掉。若是编队进洞，让僚舰替被罩住的那一艘顶住火力，或者在它张网之前先打掉。 → So do not rush to switch targets when you meet one: kill it first. Running a squad into a wormhole, have the escorts soak fire for whoever is caught, or simply take it down before it casts.

**msg-blackbox-plug-unlock（3 段）**
1. 你从残骸里得到了一枚黑匣。黑匣内部的数据可以制作特殊舰船插件。 → You pulled a black box out of a wreck. The data sealed inside can be used to build special ship plugs.
2. 协会因此对你开放限定商店窗口，制作插件所需的蓝图在那里用声望兑换。制作舰船插件的组装机也对你开放。 → In light of that, the Association is opening a limited shop window for you: the blueprints for building ship plugs are exchanged there for standing. The assembly unit that builds ship plugs is open to you as well.
3. 插件和装备不一样，装上就拆不下来、也换不了别的。它给这艘船一项大幅加成，下单之前想清楚要做哪一件。装了插件的舰船不能放进舰船仓库，也不能挂到市场上卖。 → A ship plug is not like ordinary equipment: once fitted it cannot be taken off, nor swapped for another. It gives the ship a large bonus, so think over which one you want before you place the order. A ship carrying a plug cannot be put into the ship warehouse, nor listed for sale on the market.

## 5. 三处裁定（2026-10-02 · 船长已定，逐条照抄）

1. **`first-bounty` 第 2 段**：中文是「**只有积攒生物**才能解锁更多市场物品和功能」——按上下文应是「**积攒声望**」（整段在讲声望）⇒ 疑似笔误。
   处置建议：① 你确认是笔误，我改中文为「积攒声望」并按此出英文；② 若"生物"另有所指（比如声望的来源物），说一句我照译。
   **船长裁（照抄）**：「**1是笔误，应该是声望**」
   ⇒ **中文已改**：`packages/data/src/firstTaskMessages.ts` 该句改为「声望是章鱼人协会的通行证。**只有积攒声望**才能解锁更多市场物品和功能。」
   并挂 `⟪文案调整 2026-10-02⟫` 记账注释；英文按**修正后的中文**写：
   「Standing is your pass with the Association: banking it is what unlocks more market goods and more functions.」
2. **`msg-survey-memo` 第 2 段**：「扫描**越就**费时间」——按上下文应是「**越**费时间」⇒ 疑似笔误。
   **船长裁（照抄）**：「**2没问题**」⇒ **中文原样保留**（仍是「越就费时间」，我未擅自改中文字），英文按"越费时间"的意思写：
   「One reminder: the lower the security level, the longer an on-site scan takes, and that is the point to train your scanning skills.」
   ⚠ 若日后要顺手把中文这两个字也改掉（一处、中英同批），说一声即可。
3. **`first-ai` 第 2 段**：「战斗、运输与虫洞扫描太复杂，只能依赖**舰载 AI**」（10-01 你裁定把「主控AI」改成了「舰载 AI」）。
   英文里 `shipboard AI` 就是玩家自己 ⇒ 草稿写成 "those the shipboard AI flies itself"（= 这些活只有你自己飞）。若你想强调"暂时做不到"，可换成 "…are still beyond a core to run; those we fly ourselves." —— 挑一个。
   **船长裁（照抄）**：「**3没问题**」⇒ 采用**草稿那版**："Combat, hauling and wormhole scanning are too complex to hand to a core; **those the shipboard AI flies itself.**"

## 6. 落地（2026-10-02 已执行）

**⚠ 一处自我更正**：草稿里写"中文含换行的 5 封"，实际是 **6 封**（`first-skill` · `first-order` · `first-wormhole` · `msg-refinery-note` · `msg-exile-swarm` · `msg-lowsec-rules`）——多行段在英文侧写成 `\n` 转义（**单引号字符串里不能放字面换行**；我第一版写成字面换行、`typecheck` 前自己发现并修回）。

1. 逐条写进 `apps/desktop/src/renderer/src/ui/commsText.ts` 的 `COMMS_BODY_EN`（**段数与中文逐条相等**；中文含换行的那 5 条，英文同样保持"一段多行"）。
2. 跑：`npm run l10n:check` · `content:check` · `l10n:params` · `ui:rot-check` · `typecheck` · core 全量。
3. 探针复核：改后按"英文界面实际渲染"再跑一次对齐读数（段数 0 不符、0 回落）。
4. 归档：关键结论并入 `docs/design/comms-import-20261001.md`（同一条工作流的第三半）＋ roadmap 一条，随后删本文件（§8）。

### 6.1 落码读数（2026-10-02）

| 项 | 改前 | 改后 |
|---|---|---|
| 段数不符（英文界面整封回落中文） | **14 条** | **0 条** |
| 段数同但内容是改稿前的 | 18 条 | **0 条** |
| 英文段合计 | —— | **106 段**（33 条通讯） |
| 英文段与中文段逐字相同（漏译/回落痕迹） | —— | **0 处** |
| 缺英文登记 | 0 条 | 0 条 |

**改动台账**：

| # | 文件 | 改动 |
|---|---|---|
| 1 | `apps/desktop/src/renderer/src/ui/commsText.ts` | `COMMS_BODY_EN` **32 条整体重写**（段数与中文逐条相等）＋ 表头补 `⟪文案调整 2026-10-02⟫` 记账 |
| 2 | `packages/data/src/firstTaskMessages.ts` | `first-bounty` 第 2 段中文笔误修正（「积攒生物」→「积攒声望」）＋ `⟪文案调整 2026-10-02⟫` 记账注释 |
| 3 | `docs/design/comms-en-backfill-20261002.md` | 本文件（草稿 → 台账） |

**护栏缺口（如实登记）**：`COMMS_BODY_EN` **不在任何静态闸门的覆盖面内**（`l10n:check` 只扫源码字面量与 `table.ts`；该表由 `tools/comms-export.ts` 读取、不在体检里）⇒ 目前只有「运行时行数不符就回落中文」这一层兜底。
建议（**未做，等你点头**）：给 `ui:rot-check` 或 `arch:guard` 加一条**通讯英文行数对齐**体检（同 `ui-attr-check` 的做法）——中文改段数时当场报红，不用等玩家看到回落。

## 7. 边界

- 只动英文覆盖表 ＋ **一处中文笔误**（§5-① 船长裁定「1是笔误，应该是声望」）；不动机制、数值、存档、跳转。
- **模块自报（约定 §十八）**：本批主要落在**通讯与公告**域（`ui/commsText.ts`）；另有**一处**落在
  **任务与教程**域（`packages/data/src/firstTaskMessages.ts` 的 `first-bounty` 中文笔误修正）⇒ 机器读数「**跨 2 个域**」。
  该跨域**是船长当轮直接指示的**（原话照抄：「**1是笔误，应该是声望**」）⇒ 按 §十八 记：
  **船长批准：跨 通讯与公告 → 任务与教程**（提交说明里同记）。
