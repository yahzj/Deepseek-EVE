# 工具区台账（tools/）

## 声音正式入库（2026-11-04）

- 音效台点「导出正式入库包」下载 `whale-sfx-pack-<时间戳>.zip` 后，在仓库根运行 `npm run audio:install`（`tsx tools/audio-install.ts`）：校验 zip 内 `manifest.json`（`whale-idle-sfx-pack` v1）与 `assets` 路径映射，按语义 id 写入 `apps/desktop/src/renderer/src/assets/{sfx,bgm,ambient}/`；默认清理同一事件的旧扩展名/变体，`--dry-run` 只预览、`--keep-variants` 保留变体并警告；可传包路径或 `--pack=`，缺省自动找仓库根/下载目录最新包。只读包、不读个人档；体积超限（sfx 300KB / bgm 5MB / ambient 2MB）与非 mp3 仅警告不阻断。
- 入库后跑 `npm run audio:check`（语义清单/素材目录/本地化/入库包往返与非法包拒绝/纯规则）；运行期另用 `npm run audio:smoke`（网页构建+无头浏览器，含导出捕获）与 `npm run audio:smoke:desktop`（桌面构建，file:// 与发布门禁）。

## 势力图鉴与非推进器速度（2026-11-03）

- 先`npm run build`，再`node tools/faction-codex-native-check.cjs`：读取当前内容目录和独立合成遭遇档，使用隐藏Electron核对中英七族装备/舰船/图纸分栏和计数、逐一打开补回的14件模块及1张图纸详情，检查正式存盘未改变遭遇、装备及图纸库存；结果输出控制台，不读取个人档，不代替观感验收。
- 构建后`node tools/independent-speed-native-check.cjs`：独立合成装配档，隐藏Electron中英核对生体脉搏加速器、几丁质骨架层与矢量推进器MK2参数卡，非推进器不含点火/冷却、推进器保留周期，并核对正式存盘装配不变；结果输出控制台。两工具均只清理经绝对路径和唯一前缀检查的自建临时userData，结束由自身Electron退出。

## 统一手动发布（2026-11-02）

- `.github/scripts/release-plan.cjs` 为 `publish.yml` 的版本与产物校验助手：`resolve` 把已推送引用锁定成默认分支内的40位SHA并校验Windows标签/包版本；`manifest` 记录构建源码及产物SHA-256；`verify` 拒绝下载产物版本、校验和或文件清单不符。只由工作流或独立夹具调用，不创建标签、推送或调用线上API。统一操作入口及切换注意事项见 `.github/RELEASING.md`。
- `npm run test -w @whale/core -- --run tests/manual-publish-20261102.test.ts`：本地独立Git仓库、合成zip/exe和工作流语法树/条件校验，覆盖发布引用消歧、祖先限制、标签/版本、产物篡改和全部所选构建成功才上线；只清理自建且已核验边界的临时目录，不触发实际发布。

## 信号空间自动探索估算（2026-11-02）

- `node tools/signal-auto-yield-comparison.cjs`：四舰队×两科技×五族×五原型×256个散布配对种子，对照旧原样、仅阻止守卫绕过的内存诊断和新估算，共51,200组配对/153,600次结算；`--smoke`每格3种子。TypeScript语法树仅在内存追踪逐层收成，校验200个未插桩旧入口控制样本及生产源码SHA-256不变；不读个人档、旧文档或Git历史，不调参数。每次另写`tools/_ui-artifacts/signal-auto-yield-comparison-<时间戳>/report.json`和`paired-samples.jsonl`。同256种子跨条件复用，不冒称独立样本或玩家自然权重。
- `node tools/signal-auto-yield-report.cjs <对照输出目录>`：只读取上述`report.json`，在该目录另写`comparison.md`，已有文件拒绝覆盖；包含分类均值、分位数、同条件波动和守卫诊断，不开箱或折现金。结果及已知收益目标缺口见`docs/design/signal-auto-yield-comparison-20261102.md`。

- `npx tsx tools/signal-auto-estimate-check.ts`：四种合法合成舰队、两档科技、五族各100种子，共4000组；核对同配置推进固定、普通资源容量、合法奖励、正式派队不提前发货及快照读档。`--smoke`为每格5种子。每次新建`tools/_ui-artifacts/signal-auto-estimate-<时间戳>/readings.json`，分类数量不是信用点收益，不读取个人档；合成逻辑在`signal-auto-estimate-fixture.ts`。
- `npx tsx tools/make-signal-auto-estimate-save.ts`：独立合成满技能/科技的四舰79/125预算停港档、10处信号，正常速度且未代出发；正式装配及两轮读档、落盘回读，另写唯一`docs/test-saves/test-save-signal-auto-estimate-<上海时间>.json`，拒绝覆盖。加载与备份恢复见`docs/test-saves/signal-auto-estimate-20261102.md`。
- 先`npm run build`，再`node tools/signal-auto-estimate-native-check.cjs`：最新生产文件、隐藏离屏Electron、独立临时userData，合成已派队任务回拨保存时间6分钟，经真实离线入口核对快照奖励、任务释放、仓库/核心入账与正式存盘。夹具仅关闭无关被动母矿产线，输出新建`tools/_ui-artifacts/signal-auto-native-<时间戳>/`；只关闭自有PID并删除已核验绝对边界的自建目录。不读取个人档，不作为观感或全局经济验收。

## 编队支援与离线简报（2026-11-01）

- `npx tsx tools/make-fleet-support-save.ts`：独立合成五舰90/125预算停港档，后勤预装护盾投送力场MK2、目标锁定阵列MK3及两架修理无人机，其他型号备件在装备库。`fleet-support-fixture.ts`复用正式装配与CPU检查；生成器经两轮正式读档和落盘回读，输出唯一`docs/test-saves/test-save-fleet-support-<上海时间>.json`，拒绝覆盖，不读取个人档。加载步骤见`docs/test-saves/fleet-support-20261101.md`。
- 先`npm run build`，再`node tools/fleet-support-native-check.cjs`：本树生产文件、隐藏离屏Electron和独立临时userData，验证单份离线简报内容、关闭、无回看入口、无存档统计字段及三种桌面窗口几何。输出`tools/_ui-artifacts/fleet-support-final-20261101/`。合成战斗预置胜利仅验证结算接线，不作战斗胜率结论；只清理核验边界内的自建目录与自有PID，不读取个人档。

## 修理无人机（2026-11-01）

- `npx tsx tools/make-repair-drone-save.ts`：独立合成满技能五舰、预算90/125、后勤装2架修理机的停港档，不代开战；正式装载/CPU校验、两轮读档与落盘回读。输出`docs/test-saves/test-save-repair-drone-<上海时间>.json`，不读个人档，复测与备份恢复见`docs/test-saves/repair-drone-20261101.md`。

## 运输护航（2026-11-01）

- `npx tsx tools/oarfish-support-calibration.ts`：新版力场/阵列/修理机校准，五配置各20种子满载强制遭遇，三配置分25%/皇带鱼满载/混编整队满仓共56组24小时正式离线自然运输。损伤/机群跨场保留、不手动续运、不调生产参数，独立库存及事件账核对离线简报、结束后正式读档。分别记录运费、非运输现金、目录价补给损耗、沉船资产及期末维修负债；插件无公开售价时用现行图纸材料价估算，不计资本成本或残骸回收。每次另建`tools/_ui-artifacts/oarfish-support-<时间戳>/readings.json`，不读取个人档。`--smoke`仅5场战斗和7组6小时运输，不混入正式样本；结果与限制见`docs/design/oarfish-support-calibration-20261101.md`。依赖旧护航工具仅导出合成夹具，导入不启动旧批次取数或覆盖旧报告。

- `npx tsx tools/make-oarfish-escort-save.ts`：独立合成皇带鱼＋两锤头鲨＋亡军后勤＋哨戒电子五舰停港档，配装沿用护航实战读数，成本110/125；正式序列化、两轮读档、落盘回读及副本运输/三波遇袭校验。另写上海时间命名的唯一JSON，不读个人档、不代出发；加载与固定总货量1,527,660m³复测见`docs/test-saves/oarfish-escort-20261101.md`。

- `npx tsx tools/oarfish-escort-readings.ts`：固定皇带鱼原满配和总承运量1,527,660m³，8档单船/炮击/后勤/电子/无人机组合各20种子，正式指挥预算、装配、出勤、三波增幅敌阵与结算；输出`tools/_ui-artifacts/oarfish-escort-20261101/readings.json`，含每波配置、增幅、战损、补给和胜后续运。护航采用MK2基线，电子舰可装势力电子舱；每场重置全修与充足补给，不据此声称持续收益或总体胜率。不读个人档。

- `npx tsx tools/oarfish-transport-readings.ts`：单皇带鱼满级技能、低槽扩展加4原型货舱的合法配装，核对各航线理论毛时薪、货量威胁贡献、128组正常海盗阵容及20场真实遭遇战；另列仅头目舰测试池容量对照，不改生产池或参数、不读取个人档。输出`tools/_ui-artifacts/oarfish-transport-20261101/readings.json`；`--inspect`另打印货舱/插件对照配装。

- `npx tsx tools/industrial-transport-check.ts`：同一合法三舰队伍、25%/满载、6/24小时真实引擎离线试跑，记录交付、运输收入、遇袭、战损及读档保真；单种子功能检查，不自动调参或声称平衡。

- `npx tsx tools/make-industrial-transport-save.ts`：独立合成满技能、全站已建、三舰运输准备档，不代开运输；正式序列化/读档核对，另写`docs/test-saves/test-save-industrial-transport-<时间>.json`，不读取个人档。
- 构建后运行`node tools/industrial-transport-native-check.cjs`：隐藏离屏Electron、独立临时档，检查1540×940、1100×900、760×700三种窗口的承运弹窗边界；覆盖打开/取消无写入、非法整数范围、收益联动、安全与危险航线模糊威胁、Tab循环、Escape关闭和焦点返回、25%装载、途中无调货入口、安排到站停运、二次确认中断后折返且到港不续运。到港文件状态等待正式60秒自动保存，避免误读旧快照。输出`tools/_ui-artifacts/hauling-stop-lock-20261101/`，保留旧检查目录。只关闭自有PID并删除核验过的自建临时目录，不代表实体手机、观感或平衡验收。

## 敌舰紧凑梯形（2026-11-01）

- 构建后运行`node tools/enemy-compact-native-check.cjs`：本树生产文件、隐藏离屏Electron、独立临时合成档，5/7/9/12敌舰×经典/现代×1540×940、1100×900、760×700，共24组；核对SVG非空、宽窗140像素列距和逐排24像素后移、真实舰体/舰名/血条不互压及不越界。5/7舰用墨潮实际波次，9/12舰通过同波正式支援规格补足，夹具只延后开火用于取证，不作平衡结论。输出`tools/_ui-artifacts/enemy-compact-20261101/report.json`及各组PNG；不读个人档或Git历史，只关闭自有PID并清理核验过边界的自建临时目录。桌面窄窗不等于实体手机、性能或船长观感验收。
- 加`--players`：玩家人数也按5/7/9/12变化，另存`tools/_ui-artifacts/player-trapezoid-20261101/`。加`--mirror`同样检查双方，但另存`tools/_ui-artifacts/mirror-trapezoid-20261101/`保留前轮证据；同时检查玩家主控与僚舰真实舰体中心、双方紧凑列距、逐排反向后移、舰名/血条边界及两两不重叠，并逐舰断言双方中心横坐标之和等于战场左右边界之和、纵坐标一致。敌我共用140像素列距上限和逐排24像素后移上限，窄窗使用同一套边界适配。

## 射程电子战（2026-11-01）

- `npx tsx tools/range-ew-readings.ts [--save]`：独立合成，普通五巡洋、单电子舰、双电子舰、单电子舰加电子舱四套合法满技能MK2配置，种子1/7/13；两张常驻卡走正式开战、返航、结算和港内维修，两张旗舰按满30万血池规格及第4层信号空间守卫仅测战斗。输出`tools/_ui-artifacts/range-ew/calibration.json`与`calibration.md`，含指挥成本、胜负、战损、开场强度、逐武器射程与补给读数。非等成本或最优配装，三种子不代表总体胜率。`--save`另生成未代开战的满技能全舰船测试档，电子舰合法换装一件电子舱，并通过正式读档复核；不读取个人档或Git历史。
- 先`npm run build`，再`node tools/range-ew-native-check.cjs`：本树生产文件、隐藏离屏Electron、独立临时合成档，检查战内详情、舰队明细、已知悬赏预览三条路径，覆盖1540×940、1100×900、760×700窗口；验证强度、逐武器详情、点按展开、Escape关闭及焦点返回、遮挡和内部滚动。输出同目录的`report.json`与三组截图；战内夹具延后开火，仅用于界面取证，不作为平衡结论。不读个人档，只关闭自有PID并删除核验过边界的自建临时目录；桌面窄窗不等于实体手机或观感验收。

## 敌方编成调整（2026-10-31）

- `node --import tsx tools/enemy-formation-sustain-check.ts`：五套满技能MK2舰队覆盖23张常驻卡、3种子、每线最多5轮，新旧编成分别测港内全修与正式连续作战；补给库存与损伤跨轮保留，沉船和停环不强制恢复。输出`sustain.json`及`docs/design/enemy-fleet-sustain-20261031.md`，含实际弹药、组件、机群、维修负债和沉船装配估值；`--smoke`仅跑两卡短线、不覆盖正式报告；`--focus`以20种子、每线最多10轮、六套舰队复测穹顶守卫，包含辅助舰空槽加防护对照，独立输出`sustain-focus.json`及`enemy-fleet-vault-focus-20261031.md`；`--render`仅用已有JSON重生成报告，可与`--focus`配合，不重跑战斗或覆盖JSON。`enemy-formation-sustain.ts`为合成与结算夹具，不读取个人档。

- `node --import tsx tools/enemy-formation-report.ts`：将最终328组校准记录与当前建档交叉核对，生成`docs/design/enemy-fleet-comparison-20261031.md`，逐卡列新旧血量、基础峰值DPS、舰数及增幅；王庭按实际互斥分支分别列出，旗舰另附满30万共享血池、被动入侵另列0.75巡游值。只导出报告，不运行实战或修改个人档。
- `node --import tsx tools/enemy-formation-check.ts [--seeds=3] [--static]`：独立合成，逐卡新旧静态强度对照与固定MK2五阶段三武器战斗。输出`tools/_ui-artifacts/enemy-formation-20261031/report.json`；默认328静态行、5886场战斗。阶段为指定技能与合法容量截面，不表示已验证训练采购；旗舰矩阵为卡面血量，共享池由专项覆盖。
- `node --import tsx tools/enemy-formation-journey.ts [--save]`：真实前置/许可/训练、单舰首胜声望和3张卡各12种子正式结算/返航/冷却/维修/弹药估值，输出同目录`journey.json`；`--save`另写20声望独立门槛档。资金/探索/货源预置，失败候选单列，不代表零资金养成或完整全域经济验收。加载说明见`docs/test-saves/enemy-formation-20261031.md`。

## 编队解锁通讯（2026-10-31）

- 构建后运行`node tools/fleet-command-unlock-native-check.cjs`：本树生产产物、隐藏Electron、独立20累计声望/0余额合成档，实际检查解锁弹窗和收件箱两条入口均定位技能页“舰船 / 编队指挥”，显示三项技能且无残留搜索、状态压暗或渲染错误。报告输出`tools/_ui-artifacts/fleet-command-unlock/report.json`，不读取个人档；仅关闭自建进程并清理已核验绝对边界的临时目录。此为桌面交互冒烟，不替代船长观感验收。
- 加`--licenses`：三项编队技能分别加载声望差1/达标的独立合成档，共6组；实际核对详情和列表按钮、T2/T3/T5难度、5万/20万/200万价格、累计声望提示、二次确认和真实IPC保存扣款，并查1100×900窄窗许可操作区不越界。输出同目录`license-report.json`和各组JSON，声望不消耗，未读取个人档；首个失败即停止，不把未跑项记通过。

## 12舰实施前基线（2026-10-30）

- `npx tsx tools/battle-twelve-baseline.ts`：独立合成1/4/12舰对等敌舰、机群开关和3种子，共18个30秒逐拍压力场景；正式装配/战斗入口，不读个人档。输出`tools/_ui-artifacts/battle-twelve-20261030/before.json`，包括Node推进耗时分位数和现行纯函数布局越界。12巡洋仅作压力夹具，不冒称合法预算编队；不代表原生窗口帧率、交互或已完成12舰功能。严格类型检查需同时包含`apps/desktop/src/renderer/src/env.d.ts`及DOM库。

## 指挥成本舰种对照（2026-10-30）

- `npx tsx tools/command-budget-benchmark.ts [--seeds=12]`：从当前目录读取官方武装/装甲舰，通过正式装配入口建立合法模板，再以现有多舰引擎测单舰、2舰和4舰对照。报告写`tools/_ui-artifacts/command-budget-20261030/`，含逐种子胜负/时间/存活/弹药与全部配装。只建独立合成状态，不读个人档、不修改生产规则；不是最优配装、整库回归或精确总体胜率，假设与限制见报告及`docs/design/combat-command-budget-20261030.md`。
- 加`--roles --seeds=6`：扩展到34种战斗舰，按船体武器族选MK2配装；原生机舱至少100立方的5种船另测侦察/重型机群模板，并以2舰/4舰队做电子、指挥、后勤船体特性开关对照。独立写`roster/`子目录，不覆盖默认报告；当前规模234份配装、528格单舰及120格辅助对照，共3888场。辅助对照保持同一舰体/装备，只在隔离上下文关闭特性，不是等成本换舰结论；后勤只测满状态起战，未覆盖持续重伤维修压力。报告不填候选成本，价格只在讨论稿维护。
- 加`--budgets --seeds=12`：从本批现行设计稿的逐船候选表读取价格，校验未知/重复/漏舰/非法成本，42组单舰与混编队×0/3级技能×9卡×12种子，共9072场，84组配装含198舰次。独立写`budgets/`，明列总成本、预算余量、胜率/时间/剩血/存活/弹药/无人机损失/组件消耗；受损组为合成甲35%/结构70%，不是连续挂机。附候选容量25＋三技能每级5/7/8点，调用现行训练公式枚举66种合法等级分配与最短纯训练耗时，不新增正式技能或改生产预算。`--roles`与`--budgets`不能混用；默认与角色模式仍不标候选价格。
- 舰级权重变更后用`--budgets --seeds=12 --out=tools/_ui-artifacts/command-budget-20261030/tier-weight-budgets`另存，不覆盖旧等权`budgets/`报告；工具现在调用现行选靶单点并导出每舰`targetWeight`，不代表旧等权规则。`--out=目录`适用全部模式，后续基线变更先换目录。

## 舰级选靶权重（2026-10-30）

- `npx tsx tools/ship-tier-target-weight-check.ts [--save] [--out=目录]`：独立合成马鲛/灰鲭鲨/锤头鲨/玄武四舰，正式MK2装配、12000次实际抽靶读数、序列化往返及正式旗舰入口副本冒烟。默认输出`tools/_ui-artifacts/ship-tier-target-weight-20261030/`的`report.json`；`--save`另写`test-save-ship-tier-target-weight-20261030.json`，只在该独立目录写产物，不读个人档。
- 测试档未代开战。游戏内先备份个人档，再导入合成档，从星图核心打开守墓旗舰准备，自行选择四舰出击；可另装靶标/隐匿观察目标分布。单场不保证固定比例，详见本批设计稿。结束退出并恢复备份；工具不覆盖个人存档、不修改生产编队限制。

## 每日赏金与入侵声望（2026-10-30）

- `npx tsx tools/bounty-standing-check.ts`：真实地图、每档探索范围200个确定种子，通过实际每日任务结算核对0/1/2声望；另从当前数据计算常驻首胜总额、入侵门槛差额和假设收益周期，不代表战斗胜率或实际解锁耗时。
- 构建后`node tools/bounty-standing-native-check.cjs`：两布局×桌面/模拟手机，真实导航检查每日赏金收益行与横向溢出。
- 构建后`node tools/standing-economy-native-check.cjs`：59/60累计声望×两布局×桌面/模拟手机，检查发射器详情/门槛、商店20/60价格、确认金额、实际扣款与累计不变；输出合成门槛档、截图及读数至`tools/_ui-artifacts/standing-economy-20261030/`。两工具均使用独立临时目录与隐藏自建Electron，可用`WHALE_ELECTRON_EXE`指定本机已有运行时，不读个人档，只清理自建进程与已核验路径。
- 手动复测先在游戏内备份当前档并退出，再导入工具生成的59或60门槛档；物品页查看发射器，出港星图选红环航道检查启动限制，常驻悬赏的声望商店检查价格与确认。完成后退出并恢复自己的备份；合成档仅用于验收。

## 存档兼容检查（2026-10-27 · v31）

- `npm run save:migrate`：只读遍历`docs/test-saves/*.json`，当前v31须可读、低版本须以VERSION错误拒读；同时核对钱包、基础核心、指定弹药蓝图库存和首次任务完成状态不变。二号120份样本为44可读、76预期拒读；主树目录136份为59可读、77预期拒读，额外样本不因此入库，不代表所有个人档已检查。
- `npm run save:roundtrip-audit`：只对支持档执行读档→内存序列化→再读档，检查第二轮缺键与类型变化；低版本预期拒读单列，异常与结构变化返回失败。不逐值比较全部资产、不写原样本或个人档。
- 已删除历史专用工具`weekend-compensation.ts`及其命令、`save-enable-ironman.ts`；通用手动管理工具`save-grant-ships.ts`保留，仅船长明确下令才运行。本轮未运行任何补偿写档工具。
- 构建后可用`node tools/black-market-desktop-smoke.cjs`检查真实IPC保存和重载，使用合成档、隐藏自建Electron和独立临时userData。二号缺少二进制时可通过`ELECTRON_OVERRIDE_DIST_PATH`临时引用已核实的本机运行时，不修改依赖或个人目录。

## 支援件与插件多件惩罚（2026-10-23）

- `npx tsx tools/make-test-save.ts support-plug-stacking`：独立合成混装舰和双插件对照，夹具 `support-plug-stacking-fixture.ts`，不读取个人档。
- 构建后 `node tools/support-plug-stacking-native-check.cjs [--electron=本机Electron绝对路径]`：隐藏隔离Electron，中英两布局/桌面手机仿真核对第二件富卡、折权单位和真实保存重载；结果 `tools/_ui-artifacts/support-plug-stacking/`，不是观感或实体手机结论。

## 信号空间T3自动探索科技（2026-10-22）

- `npx tsx tools/make-test-save.ts signal-auto-tech`：通过`signal-auto-tech-fixture.ts`生成全新合成档，未研究T3但已满足T1前置，0级AI技能、空核心库及研究材料齐备；不读取个人档，加载步骤见`docs/test-saves/signal-auto-tech-20261022.md`。
- 构建后`node tools/signal-auto-tech-native-check.cjs [--electron=本机Electron绝对路径]`：隐藏Electron及临时userData，经典桌面/现代手机仿真×0～3级，验证灰色按钮可点击提示、60/70/80%读数、无核心占用、真实派队及IPC重载。产物`tools/_ui-artifacts/signal-auto-tech/`，不作实体手机或观感验收；仅清理自建且已校验路径的临时profile。

## 自动探索母矿核查（2026-10-21）

- `node tools/signal-auto-ore-audit.cjs [--matrix]`：用全新合成状态、正式装配/派队/返航结算，比较当前实现、修前`5685ed39`及资源调整前`51092180^`的自动算法；混合墓场/矿脉与参数扫描分开报告，逐种子断言母矿报告与仓库一致。仅读本地Git历史和代码，不读个人档、不改玩法；输出`tools/_ui-artifacts/signal-auto-ore-audit-20261021/`。矩阵为隔离实验，不代表玩家总体掉率，完整结论见`docs/design/signal-auto-ore-audit-20261021.md`。

## 按卡距离与射程变化（2026-10-21）

- `npx tsx tools/make-test-save.ts battle-card-range`：调用`battle-card-range-fixture.ts`生成全新合成档，短射程记录后换装，保存待确认状态；不读取个人档。加载说明见`docs/test-saves/battle-card-range-20261021.md`。
- 构建后`node tools/battle-card-range-native-check.cjs [--electron=本机Electron绝对路径]`：隐藏Electron、临时userData、经典中文桌面/现代英文手机仿真共8组，实际取消、手动确认展开、悬赏/入侵循环确认后保持最小化及主动还原、IPC重载。输出`tools/_ui-artifacts/battle-card-range/`，只清理自建且核验过路径的profile；不作实体手机或观感结论。

## 五族势力船插验收（2026-10-20）

- `npx tsx tools/make-test-save.ts faction-ship-plugs`：复用`faction-ship-plug-fixture.ts`，全新v31合成档，正式装配入口生成六艘对照舰；输出带时间戳的新文件，说明见`docs/test-saves/faction-ship-plugs-20261019.md`。图纸暂不提供正常获取，测试备件不代表玩家供给。
- 构建后`node tools/faction-ship-plug-native-check.cjs`：隐藏Electron、隔离userData，中文桌面/英文手机仿真核对五件船插及储备甲板富卡、8.4秒有效周期和IPC保存重载；检查运行异常，不读取个人档，不作为实体手机或观感验收。只清理工具自建且核对路径的临时profile。

## 英文设置切换巡检（2026-10-18）

- `node tools/l10n-en-native-check.cjs [--layout=classic|modern]`：先`npm run build`；使用本树真实App、独立合成档和隐藏Electron，中文启动后真实打开设置点击English。扫描两布局10个一级页面、主要子页签（含任务5页）和手册8页，热切/重载各查，记录文本/悬停/辅助标签中的中文、未解析ID和参数槽。输出`tools/_ui-artifacts/l10n-en-native-20261018/`；先落盘报告再断言，无遗漏且无运行异常才退出0。`localizationComplete`只表示本轮检查通过，不代表实体手机或所有游戏状态验收。不读取个人档。

## 信号发射器与扫描调整验收（2026-10-18）

- `node tools/faction-beacons-ui-check.cjs [--layout=classic|modern]`：先构建；隐藏隔离Electron加载真实App，经典/现代×桌面/手机仿真分别验证R/C/H/D专属发射器生产、退料、交付、选择、点火和IPC重载，另验MK1、两套实验室筛选和T1/T4扫描科技研究。真实引擎推进工期，不改产线秒数；只用合成档，输出`tools/_ui-artifacts/faction-beacons-20261017/`。
- `node tools/fuel-tank-fill-check.cjs`：真FuelTank组件72组像素填充检查，不加载个人档；输出`tools/_ui-artifacts/fuel-tank-fill-20261017/`，不作完整燃料页手操或实体手机观感结论。
- `node tools/gravekeeper-battle-check.cjs [--native]`：四卡三种子完整战斗及十一波距离/运动诊断；`--native`先构建，验证真实App舰影、步进、宿主结算和IPC。独立检查点与自然通关分别记录，不清敌、不强制胜利；输出`tools/_ui-artifacts/gravekeeper-battle-20261017/`。
- `npx tsx tools/make-test-save.ts faction-beacons`：生成独立合成验收档，五种发射器与MK1库存、生产材料及实验室门槛齐备，不读取或覆盖个人档；说明见`docs/test-saves/README.md`。

## 守墓者入侵专项（2026-10-16 · v0.1.0 / 档v31）

- `gravekeeper-gear-fixture.ts`：由`make-test-save.ts gravekeeper-gear`调用，合法炮台/无人机双舰和新三件的独立合成门槛，不读取个人档；实际机制与保存续算见`gravekeeper-gear-20261016.test.ts`。
- `node tools/gravekeeper-native-check.cjs --gear --electron=本机Electron绝对路径`：使用二号最新构建，隔离合成档验证危机/磁轨战斗列表、真实IPC存盘和重载状态保留，不作观感验收；未加`--gear`仍是原入侵旗舰冒烟。

- `npx tsx tools/gravekeeper-invasion-check.ts --sim`：正常装配入口校验的MK2/MK3、动能/激光×四张入侵卡×三种子读数；基础标尺不含动态抗性与苏生。`--save`只写忽略目录，正式测试档走`make-test-save.ts gravekeeper`；无个人档输入。
- `npx tsx tools/gravekeeper-invasion-check.ts --audit`：导出四卡逐波三层血、齐射、装填、射程、机动、回避和挂载；基础定价与30万满池实战分列。专项模拟可加`--sim --card=gravekeeper-flagship --tier=4 --seeds=11,29,47`，不读取个人档；支援挂载保留但未配置条件援军条目，表内只记固定编队。
- `node tools/gravekeeper-native-check.cjs [--electron=本机Electron绝对路径]`：先构建；自建合成旗舰战、隔离userData、隐藏Electron、真实IPC保存/重载，输出`tools/_ui-artifacts/gravekeeper-invasion/`，不作观感验收。只删除自己创建且校验过路径的临时profile。

## 停靠统一专项（2026-10-13 · v0.1.0 / 档v31）

- `npx tsx tools/make-test-save.ts station-action`：调用`station-action-fixture.ts`生成全新合成档，真实采矿主控、带伤空闲副船与仓库研究材料；不读取个人档。
- `node tools/station-action-native-check.cjs [--case=classic|modern]`：先构建；隐藏自建Electron、回环服务和隔离userData，实际点击黑市购买/副船卸货/维修与真实IPC存盘核对。加`--pending`检查安排手动炉、待办保存重载、取消不取消返航、真实到港启动及一批收益；时间步进复用既有本机测试桥。输出`tools/_ui-artifacts/station-action/`，不作观感结论。

## 星系天体样片（2026-10-09 · Godot3.5 / v0.1.0 / 档v31）

- `node tools/pixel-planets-samples.cjs [本机EXE绝对路径] [不存在的独立输出目录绝对路径]`：核验程序SHA256，用原生PixelPlanets场景/shader渲染三类透明PNG；末尾`--scene-set`导出七类星球/四色恒星/黑洞共12张，默认样片不变。默认输出`docs/design/assets/stellar-samples-20261009`，拒绝覆盖，游戏运行不依赖此工具。
- `pixel-planets-export.gd`：通过本机程序`--no-window --script`执行，固定种子/颜色/光源/冻结时间，RGBA透明视口导出，不手写球体算法。
- `python tools/pixel-planets-review.py <样片目录> [复现目录]`：已有Pillow/系统字体制作深浅底及小尺寸审查板，核验透明度/留白/像素复现；不安装依赖、不读写个人档。
- `node tools/pixel-planets-study.cjs <不存在的本树tools/_ui-artifacts输出目录绝对路径>`：用指纹一致的本机原程序导出GUI全部12预设的128/1024分辨率对照，共26张；记录各层实际pixels/seed/time/尺寸。调用`pixel-planets-study-export.gd`，JSON种子转整数后传入原接口，不覆盖素材或个人档。
- `python tools/pixel-planets-study-review.py <研究输出目录> [独立复现目录]`：核验RGBA/层尺寸/逐像素复现，用同一缩放方式生成总览和恒星/海洋抖动对照板。依赖已有Pillow；只处理本树忽略目录，原生导出读数不等于游戏帧率或设备观感验收。
- `node tools/pixel-planets-materials.cjs export <不存在的本树tools/_ui-artifacts输出JSON绝对路径>`：原生透明视口完成绘制后导出16份shader、12预设完整层序/尺度/配色/参数；随后`generate <输出JSON绝对路径>`生成`ui/stellarPixelMaterials.ts`。Godot/WebGL语法适配与光照入口转换在工具内维护，生成文件不手改；游戏运行不依赖EXE、上游仓库或外部服务。
- `node tools/stellar-material-check.cjs`：独立临时配置/隐藏Electron检查真实WebGL原层编译、七类行星与恒星/黑洞非空和时间变化、光向/地貌隔离、近远/无星亮度；对照`830da494`旧着色器复算暗面提亮及轮廓守恒。输出`tools/_ui-artifacts/stellar-material-20261010`，像素读数不是船长观感或实体手机性能验收；不加载个人档。`shaderCode()`供已有原生专项复用同一源，无生产测试入口。
- 来源/许可和参数见`docs/design/assets/stellar-samples-20261009/README.md`；星图已于2026-10-10验收，正常原层实时材质/静态兼容/光照/运动/面积现行规则见`docs/design/planetary-system-search-20261007.md`§十二，原样片本身不直接被游戏导入。

## 地表界面取证（2026-10-10 · v0.1.0 / 档v31）

- `node tools/planetary-native-check.cjs --case=modern-zh-desktop`：独立合成档/隐藏Electron，调查→运输→唤醒→家园改造→分页轮盘/建设确认→暂停/继续/取消→启停/迁移/拆除确认/基础设施保护→清障→特性标签悬停与键盘→真实保存重载；核对轮盘四角边界/控件不重叠/焦点与Esc、纯空地留白、64px网格/8px间距和末排可达。手机可用`--case=classic-en-mobile`（有界300秒）；追加`--surface-only`只跳过人口/运输/改造旧旅程，专测地表UI完整链路，不冒称家园旅程覆盖。只作触摸与旋转几何读数，不作实体手机性能或观感验收。
- 同一工具追加真实Glyph图标深浅底/32与64px对照板，输出`tools/_ui-artifacts/planetary/glyphs.png`；图形需有非空像素并保持原24坐标/1.7线稿，不加载个人档、不添加依赖。

## 装配靶场验收（2026-10-09 · v0.1.0 / 档v31）

- `npx tsx tools/fitting-range-fixture.ts <独立绝对输出路径>`：生成无个人档输入的验收档，真实航母、激光/酸蚀炮/颚钳无人机/加速器/增压腔，不代开靶场。
- `node tools/fitting-range-native-check.cjs`：先构建；两布局×桌面/手机逻辑旋转，按钮、输出、暂停、重置、退出、飘字字号/寿命/减少动态、几何与真实存盘资源守恒；独立隐藏Electron，产物在`tools/_ui-artifacts/fitting-range/`，不是观感验收。

## 星系探索HUD取证（2026-10-09 · v0.1.0 / 档v31）

- `node tools/stellar-native-check.cjs --dynamic-only --case=modern-zh-desktop`：种子3实际动态场景；七类材质/恒星/黑洞真实shader像素检查，近/远/无光源亮度递减、光向与自转分离、真实拖动第一帧投影误差、公转/暂停/减少动态/上下文丢失恢复/地表返回和原坐标守恒。手机可用`--case=classic-en-mobile`；加`--no-gpu`检查降级，深浅主题截图不作观感或实体手机性能结论。
- `node tools/stellar-native-check.cjs --readability-only --case=modern-zh-desktop`：星图实际特性标签、点击/Enter详情与悬浮、参数列尺寸、长/短提示和四角边界、480×360窄窗；手机加`--case=classic-en-mobile`检查旋转逻辑600px限宽。只检查可读性界面与数据守恒，不冒称搜索/人口旧流程回归或观感验收。
- 上述动态专项同时核对公开4/5/6地表规格的本体半径、动态图形/PNG缩放、选中圈与点击下限，及实际圆盘像素面积比例（小尺寸边缘采样允许15%误差）；`--no-gpu`仍核对静态面积比例，不读取隐藏资源或个人档。

- `node tools/stellar-native-check.cjs`：先构建。两布局×中英文×桌面/手机旋转，真实制造/搜索/暂停/继续/地图手势/地表往返/IPC保存与运行错误检查；补取消/丢弃确认、六套主题底色、确认焦点约束及地表返回焦点/视口/选择检查。`--case=modern-zh-desktop`可单场复跑。
- `node tools/stellar-native-check.cjs --scene-only --locale=zh`：六类合成星系×两布局×桌面/手机，深浅主题/减少动态、PNG兼容资产解码/动态加载、Canvas非空像素与SVG投影一致、双星真实运动保持间距和无恒星底色暗化；缩放后重复核对，可加`--case`或`--kind`单场复跑。
- `--stellar-only`仅跑星系制造/搜索/地图/地表往返/保存，跳过无关战损前置；`--kind=neutron`配`--scene-only --case=...`只复测指定公开类型。隐藏窗口触控送达与启动通讯可能波动，工具核对导航实际落页后最多重试3次，不改玩家路径。
- 仅隐藏自建Electron、独立合成档和临时userData、随机回环端口；产物`tools/_ui-artifacts/stellar/`，不是观感验收或实体手机性能结论。

## 异形装备验收（2026-10-09 · v0.1.0 / 档v31）

- `alien-loot-test-fixture.ts`：全新合成档，真实装配与稳定靶舰，不读取个人档。
- `npx tsx tools/make-alien-loot-save.ts`：生成独立验收档，说明见 `docs/test-saves/alien-loot-20261009.md`。
- `node tools/alien-loot-desktop-smoke.cjs`：先构建；隐藏独立Electron窗口、真实IPC存盘/重载与酸蚀状态显示，不作观感结论。

> 本文件是工具区的**索引 + 版本自检台账**。新增工具请两处登记：**本文件** + 工具自己的头注释
> （头注释写"用途 / 运行 / 口径 / 版本自检"四段，体例见 `pd-vs-foe-drone.ts`）。

## 一、版本自检（船长 2026-09-12 定）

> 「工具区需要进行一个备注，和之前的旧数据规则一样，**超过一个大版本的工具要检查是否和现在版本有较大偏差**。」

- **大版本判据 = 存档结构版本**：`packages/core/src/state.ts` 的 `CURRENT_STATE_VERSION`（现 **v24**）。
  它是"数据形状变了"的权威信号（字段增删/迁移），工具最容易被打穿的就是这条路。
- **每个工具的头注释写三条**：
  ```
  ⚠ 版本自检（口径同「旧数据不可靠」：超过一个大版本必须核对是否与现状偏差过大）
    - 游戏版本：v0.1.0（package.json）· 存档结构：v24（CURRENT_STATE_VERSION）
    - 本工具最后核对：YYYY-MM-DD（当日核对的内容）
    - 本工具最后跑过：YYYY-MM-DD
    - 判据：CURRENT_STATE_VERSION − v24 ≥ 2 ⇒ 必须重跑核对
  ```
- **体检入口**：`npm run tools:audit`（只读头注释，不执行工具）——输出「需重检 / 未登记 / 在版本内」三档。
  差 ≥2 个大版本 ⇒ **需重检**；差 1 或未登记 ⇒ **待确认**。
- ⚠ **不给老工具批量补登记**（船长 2026-09-12：「**调用时再检查，不用立刻更新**」）——
  口径 = **调用即核对**：谁在哪个会话里*用*某个工具，谁就当场核对它跟当前版本有没有大偏差，
  顺手把这三条补进那个工具的头注释（**用哪个补哪个**，不搞一次性大扫除）。
  在此之前 `tools:audit` 把老工具列为"待确认"就够用——它是台账，不是欠账单。

**为什么要这条**：本仓已有先例——`battle-calibrate` 曾在全表 27 张卡迁入舰级路径后**整表静默空转**
（提案字段对真卡无效、读数一格不变，极易被误读成"提案无效"＝假结论）。工具不会自己报错，
只会**安静地给你一个过时的数**。

## 二、台账（33 个工具）

| 工具 | npm script | 挂牌状态 |
|---|---|---|
| `audio-install.ts` | `audio:install` | **已登记**（v0.1.0 · 核对/跑过 2026-11-04；音效入库包校验与写盘：store-only zip → manifest v1、路径/目录/扩展名/重复/体积校验，默认清理同事件旧扩展名与变体，`--dry-run` / `--keep-variants`，不读个人档） |
| `battle-ammo-warning-desktop-check.cjs` | 构建后 `node tools/battle-ammo-warning-desktop-check.cjs`，`--portrait-only`仅查手机旋转 | 合成档/隔离userData/隐藏Electron，两布局双语回退、桌面/手机旋转，技能连用与缺弹首击不写/二击开战；v31，2026-10-09，不作观感结论 |
| `synaptic-accelerant-check.ts` | 直接 `npx tsx tools/synaptic-accelerant-check.ts` | 合成状态检查手动续时、训练切换及离线8/32/64h；v31，核对/运行2026-10-09，诊断不符退出1，不读个人档 |
| `synaptic-accelerant-desktop-smoke.cjs` | 构建后 `node tools/synaptic-accelerant-desktop-smoke.cjs` | 隔离userData、隐藏Electron，合成旧档32h离线及IPC重载；v31，2026-10-09，不作观感结论 |
| `l10n-deferred-check.ts` | `l10n:check`内部调用 | v31；只核对英文延期标记/空值与待本地化文档成对，不生成英文、不放宽普通漏译/占位符护栏 |
| `startup-win-worker-check.cjs` | 双端构建后`node tools/startup-win-worker-check.cjs` | v31；隐藏隔离Electron加载桌面file/网页HTTP，合法合成16架机群、真实Worker每卡30局/单实例/输入延迟/长任务与停止清理；不读个人档，不冒称手机性能或观感 |
| `battle-step-preview.ts` / `battle-step-preview-worker.ts` | `npx tsx tools/battle-step-preview.ts`，worker仅由父工具打包 | v31；100/50/10ms步长及补算预算、装填/齐射/回充/机动与5场景多种子对照；内存注入，不改源码或个人档，前后校验哈希 |
| `data-editor-enemy-schema.ts` / `data-editor-enemy-preview.ts` | 编辑器服务调用，预览CLI由候选服务执行 | v31；六类敌人源数字字段、范围、来源和当前core派生预览；不复制战斗算法，不倒写派生值 |
| `data-enemy-migrate.ts` / `data-enemy-alien-migrate.ts` / `data-enemy-metadata.ts` | `npx tsx tools/data-enemy-migrate.ts --baseline`及显式迁移/来源登记 | v31；一次性AST源数字迁移，已迁移源码拒绝重写，六表权威数字与TS公式/引用分离；不得用于日常参数覆盖 |
| `data-editor-native-check.cjs` / `data-editor-visual-check.cjs` | `node tools/data-editor-native-check.cjs --portable`，可选蓝图/速度/六表专项 | v31；迁出目录0.1.2真实程序、同仓隔离保存/恢复与隐藏窗口，依赖必须来自已验证工作树；不读取个人档、不将几何当观感 |
| `wreck-loot-price-audit.ts` | `npx tsx tools/wreck-loot-price-audit.ts`，可调`--batches`/`--rare` | v31；全残骸普通/稀有/完好抽样、可重复装备买价、实际回收/挂售及托管补缺回归；只用合成档，不改正式值/个人档，强制完好命中不代表自然频率 |
| `alien-invasion-check.ts` / `alien-invasion-fixture.ts` | `npx tsx tools/alien-invasion-check.ts --seeds=8`，`--save`生成合成档，`--audit`导出逐舰输出 | v31；新波次/爆虫一次性动能/巢母无限补机与指挥校准，标准A0~A3及高阶合法配装、三族对照；审核分别列循环射击、爆发、护理与后备；无个人档，不改正式数值；审核模式不覆盖校准报告 |
| `alien-invasion-ui-check.cjs` | 构建后`node tools/alien-invasion-ui-check.cjs` | v31；自建隐藏Electron和隔离userData，合成末波检查两布局/两视口；不当观感验收，关闭自有PID |
| `guoqing-audit-recheck.ts` | 直接 `tsx tools/guoqing-audit-recheck.ts` | 国庆C01～C10指定合成路径断言；C05按现行整数政策，全部边界另见专项，不读个人档 |
| `bounty-standing-check.ts` | `npx tsx tools/bounty-standing-check.ts` | 真实地图下按探索级别生成200组确定日板，报告三档构成及0/1/2分档声望；假设当板全部完成，不估算实战胜率/耗时，不读个人档 |
| `bounty-standing-native-check.cjs` | 构建后`node tools/bounty-standing-native-check.cjs` | 隐藏独立Electron，双布局桌面/模拟手机核对0/1/2声望与收益行溢出；输出截图及JSON，只用合成任务，不作观感验收 |
| `guoqing-save-native-check.cjs` | 构建后 `node tools/guoqing-save-native-check.cjs` | 隐藏独立Electron、合成档与真实IPC；导出同快照、立即导入、备份恢复及旧代次启动拒绝，不替代手机分享验证 |
| `save-roundtrip-compare.ts` | 由 `save:roundtrip-audit` 调用 | 全数组元素、长度、类型与实际值比较；仓内第二轮幂等及当代合成领域首读保真，不把非法旧字段首读清洗当成保真失败 |
| `save-reconnect-browser-check.ts` | `npm run save:reconnect-check`（先构建 web） | C02 真实 Web Locks/OPFS/IndexedDB/UI 回归；自建服务与隔离 Edge，模拟权限/选择器，无个人档，端口占用则失败；v31，2026-10-04 |
| `mobile-page-audit.ts` | `npm run ui:mobile-pages`（先构建 web） | 合成解锁档，208 组手机页面/弹层几何＋8 组活动窗口回归，自建服务与隔离 Edge；输出诊断不冒称观感/全弹层验收；v31，2026-10-04 |
| `balance-check.ts` | `balance` | 未登记版本自检 |
| `battle-calibrate.ts` | `battle:calibrate` | 未登记版本自检 |
| `bounty-econ.ts` | `bounty:econ` | 未登记版本自检 |
| `content-check.ts` | `content:check` | 未登记版本自检（**体检契约总入口**） |
| `content-export.ts` / `content-import.ts` / `content-schema.ts` / `content-validate.ts` | `content:export` / `content:import` / — / — | 未登记版本自检 |
| `drone-vs-gun.ts` | `battle:drone-vs-gun` | 未登记版本自检 |
| `faction-audit.ts` | `faction:audit` | 未登记版本自检 |
| `firepower-curve.ts` / `foe-hp-table.ts` | — | 未登记版本自检 |
| **`foe-export.ts`** | `foe:export` | **已登记**（v25 · 核对 2026-09-17；敌人**敌舰明细**导出（xlsx 单 sheet ＋ 同列 CSV）：25 个舰级 × 56 列，含三层三系抗性/名义 DPS 分系/射程与期望交距/挂载件与机群） |
| `hit-profile.ts` | `battle:hit-profile` | 未登记版本自检 |
| `liquidity-audit.ts` | `liquidity:audit` | 未登记版本自检 |
| `loop-stop-check.ts` | — | 未登记版本自检 |
| `make-autoperf-save.ts` / `make-test-save.ts` | — | 未登记版本自检 |
| `manufacture-econ.ts` | `manufacture:econ` | 未登记版本自检 |
| `market-rarity-sim.ts` | — | 未登记版本自检 |
| `mixed-damage-review.ts` | `battle:mixed-review` | 未登记版本自检 |
| `pd-tune.ts` | `battle:pd-tune` | 未登记版本自检 |
| `pd-vs-foe-drone.ts` | `battle:pd-vs-drone` | 未登记版本自检 |
| `playthrough-sim.ts` | — | 未登记版本自检 |
| `price-audit.ts` | `price:audit` | 未登记版本自检 |
| `salvage-econ.ts` | `salvage:econ` | 未登记版本自检 |
| **`tip-audit.ts`** | `ui:tip-check` | **已登记**（v0.1.0 · 核对 2026-09-17；悬停提示**接线**体检：①同元素不许同时带 `title` 与富卡 `hoverTipProps` ②富卡元素祖先链上不许有原生 `title`（跨文件解析组件 DOM 根，只认小写宿主标签）；当日全仓 0 命中。**时机那一半**（进入后 500ms 才置空 vs 浏览器原生延迟同档的竞态）由 `ui/Tooltip.tsx`「指针一进就压」根治，静态查不出） |
| **`l10n-check.ts`** | `l10n:check` | **已登记**（v0.1.0 · 核对 2026-09-19；**唯一本地化表**（id → `{zh,en}`）体检：①id 形态 `<域>.<短名>.<三位序号>`②调用点不得再传中文源串（旧词典写法已废）③死引用（源码用了表里没有 ⇒ 界面会显示 id）④英文值禁残留中日韩字符 ⑤中英占位符 `{n}` 集合逐个相同 ⑥值非空/无首尾空白；另出「未接线条目 / 未译读数 / 同中文串多条目」报告，不阻断） |
| **`l10n-wrap.ts`** | `l10n:wrap` | **已登记**（v0.1.0 · 核对 2026-09-19；P3 界面批**批量接线器**：AST 找出四类安全位置（JSX 文本子节点 · 展示类属性字符串初值 · JSX 三元/逻辑分支 · 旧写法 `t('中文')` 的参数）换成 `tr('ui.<文件短名>.<序号>')`，并**把中英两列追加进唯一表**；英文由 `--en=<json>` 给（缺译一律不包，绝不产出 `en: ''`）；跨行/标点碎片不碰，列「需人工拆句」清单；同一中文串复用既有条目） |
| `travel-matrix.ts` | `travel:matrix` | 未登记版本自检 |
| **`wormhole-econ.ts`** | `wormhole:econ` | **已登记**（v25 · 核对 2026-09-13；虫洞层收益校准：逐层真实战斗 + 期望原矿收益） |
| **`ui-probe.ts`** | `ui:probe` | **已登记**（v24 · 核对 2026-09-12） |
| **`ui-geom.ts`** | `ui:geom` | **已登记**（v24 · 核对 2026-09-12） |
| **`tools-audit.ts`** | `tools:audit` | **已登记**（v24 · 本体检工具自身） |

> 26 个老工具的「未登记」不是缺陷、是**历史**：它们是逐批长出来的，当时没有版本自检这条规矩。
> 按上面的口径**不批量补**，改为**调用时再检查**（谁用谁补）。

## 三、工具产物的落点纪律

- 一次性探针一律 `_` 前缀、收尾二选一（转正 / 删除）；
- **可重建的产物**（截图 / 读数 JSON / 注入档）统一落 `tools/_ui-artifacts/`，**不入库**；
  ⚠ 本条只管**产物放哪**——**不强制产出**：改界面**不要求**必须交无头 Chrome/CDP 实测与截图
  （2026-09-13 船长裁定，见 `docs/development-conventions-changelog.md` 2026-09-11 条与 `AGENTS.md` §1 末条：
  验证标注只在容易被误读的场合才写；界面改动以"四连全绿"为准，按需取证）；
- 工具自己写产物目录时**先 `mkdirSync(recursive)`**，并在缺输入时给出"怎么造"的明确提示，
  不要留下"文件找不到"的谜题。
