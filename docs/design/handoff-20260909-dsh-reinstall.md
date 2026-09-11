# 二号会话续接卡(2026-09-09 DSH 重装;交给新继承人)
> **⚠ 2026-09-11 状态标注（一号补，重要）**：本件**仍然有效、不要当已收口件**——§三 的**三项挂账全仓无结案记录**，已并入 `docs/review/pending-decisions-20260910.md` **§十二 · 早期挂账并入**（含 roadmap 的 **O6：`2026-09-09-ship-size-tier` 公告未获批未写入**）。


> 用途:DSH 需重装(思考速度问题),本卡固化"大鲸鱼二号"全部在途状态与纪律。
> 新继承人开工:先读 AGENTS.md + docs/development-conventions.md + 本卡 + 相关 design,再动代码。

## 一、仓库与分支事实(2026-09-09 核对)
- 主树 `H:\大鲸鱼\Deepseek-EVE`(分支 main):HEAD = **4c60d5e**(一号「公告写入:精炼与组装机收益再调 2026-09-08-industry-profit」);工作区干净。
- 二号工作区 `H:\大鲸鱼\Deepseek-EVE-d2`(同仓 worktree,分支 d2/workspace):HEAD = **2b753a7**(本会话最后一笔 = 舰船分级批次 A9 变更记录);工作区干净。
- **d2 落后 main 一笔(4c60d5e)**:继承后第一步 = d2 merge main(该笔 = 一号公告数据写入 announcements.ts + 变更记录,冲突面小)→ typecheck/core 复验 → 后续工作照常。
- 二号纪律:永不直接写主树;d2 提交 → 终验 → 主树 ff-only;主树有未提交在途文件时绝不触碰(等一号提交完成再合)。

## 二、本会话已完成并已合入 main(2b753a7 及之前)
1. 无人机舱大改(阶段 1-3 + 测试档;doc=drone-bay-rework.md)——数值方向仍待船长实测(见下);
2. 悬赏胜率预估改蒙特卡洛推演(win-estimate-mc.md;玩家可见展示 = 21 局真实模拟均值 + engine 预热缓存);
3. 舰船归类修正(蝠鲼/皇带鱼 = 航运;徽标「工业」→「采矿」;采矿舰操作改名);
4. **舰船尺寸分级重构 + 掠食者巡洋舰线(本会话战斗批,已合入 main;doc=ship-size-tier-rework.md)**:
   - 21 艘按等效质量(armored×0.65)落新档 tier(护卫 T1/驱逐 T2/巡洋 T3/主力 T4/旗舰 T5);
   - 改名:隼枭→鲣鱼级护卫舰、伯劳→马鲛级护卫舰、蜂群→梭鱼级无人机护卫、哨兵→王鲭级无人机母舰(全链文案同步);
   - 新增 T3 巡洋 4 艘:长尾鲨(sh-thresher)/电鳐(sh-electricray)/锤头鲨(sh-hammerhead)/牛鲨(sh-bullshark),全奇货 3.4~4.4M·声望 8~10;
   - UI 大分类标注(labels SHIP_SIZE_CLASS)+ 词典登记 + 手册「势力与舰船」条目 + 掠食者部门 lore;
   - battle-calibrate 增 T3 巡洋行;make-test-save 注册 cruiser 实测档(见四);
   - 验证:typecheck×4 + core 545 + content:check + desktop build 绿。

## 三、未完成/待船长决策(按优先级)
1. **公告写入**:待审稿在 ship-size-tier-rework.md §八(id 2026-09-09-ship-size-tier)——船长批准后才写入 announcements.ts(发布审核纪律);
2. **巡洋数值方向**:校准(MK3 满配·全技能·@96 顶)= 电鳐 26s / 牛鲨 32s / 锤头 39s / 长尾鲨 53s,对照 S4 38s——激光强/导弹慢;等船长用 cruiser 实测档复测后定(可接受族差 or 微调船体命中修正/档差);
3. **渠道工船例外口径终审**:矿/货/重装工船不随尺寸入奇货(设计稿 §五记录,待船长确认;若要全类型严格入奇货,只需改旗鱼/座头鲸/玳瑁/蝠鲼 4 行 rarity);
4. **无人机数值方向**(旧待办):drone 实测档已备,等船长实测(此前校准显示旧口径超炮流;新清单制已结构性变化);
5. **组装机收益体检/展示调整 = 已移交一号**(非二号职责);
6. 主树累积多笔【待验收/待发布】批次(含一号若干 + 二号三轮)= 推送闸门,等船长统一验收、公告过审后推送(origin 落后很多)。

## 四、测试档(用 make-test-save 生成,均在 docs/test-saves/)
- `test-save-drone-*.json`:无人机实测(梭鱼中装驾驶/王鲭重装/灰鲭鲨 S2 对照);
- `test-save-cruiser-20260909-111734.json`:巡洋实测(锤头鲨炮巡驾驶 + 电鳐/长尾鲨/牛鲨,全 MK3 满配,声望 13 全星系);
- 用法:替换 %APPDATA%\whale-idle\save.json(工具会自动备份原档到 docs/test-saves/user-backup-*)。

## 五、DSH 重装/继承人衔接
- 仓库与存档不因 DSH 重装受影响;新会话从本卡 + AGENTS.md + conventions 恢复上下文即可;
- 重装后第一步(见一):d2 merge main(追平 4c60d5e)→ typecheck ×4 + core 全量 → 再处理「三、」清单;
- 主树在途若有未提交文件 = 一号活动,先只读观察并报告,不触碰;
- 工作区无残留临时探针(一次性脚本均已删除并清理);git status 应为干净。

## 六、本批快速复核点(如新继承人需验证)
- `npm run typecheck` ×4 全绿;`npm run test -w @whale/core` 545+;`npm run content:check`(25 艘,分布 industrial=6 armed=11 armored=3 hauler=5);
- 校准:`npx tsx tools/battle-calibrate.ts`(含 T3 巡洋行与无人机 D1-D3 行)。
