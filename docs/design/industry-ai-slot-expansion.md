# 工业产能扩容：AI 核心阶梯与工业专用工位（2026-09-08 定稿）

> 状态：已确认（船长批复：现有技能不动；ai-expert 降 rank2 更名；原「工业自动化」改名让位；
> 新 rank4「工业自动化」每级 **+2** 枚工业专用工位）。背景：AI 核心统一启用上限（a0fbb3e）
> 把站内精炼炉/回收炉/制造线与 AI 副船塞进同一上限后，产业并行产能大幅削减。

## 一、技能表调整（packages/data/src/skills.ts）

1. **ai-expert「人工智能专家」→「AI 核心操作学」**：rank 4 → **2**（60 秒档入门向，不再卡高耗时），
   机制不变（每级 +1 枚共用上限；id 不变，存档零迁移）。
2. **industrial-automation「工业自动化」→「产线节拍学」**（rank3 不变）：名字贴合真实效果
   （精炼炉与组装机作业周期 −5%/级，手动与 AI 同享）；id 不变。
3. **新增 rank4「工业自动化」**（id `industrial-ai-cap`，工业组）：AI 核心驱动的站内精炼炉/
   回收炉/制造线，在 AI 核心共用上限之外**每级 +2 枚工业专用工位**（满级 +10）。

## 二、引擎口径（packages/core/src/ai.ts / industry.ts / manufacturing.ts）

- `industryAiBonus(state, ctx)` = Σ(balance.aiCore.industrySkillIds 内技能等级 × industrySlotsPerLevel)
  ——**只对站内产业生效**；平衡表字段即"未来追加工业 AI 专用扩容技能"的挂点。
- `aiCoreCapBlock(state, ctx, scope = 'ship')`：
  - scope='ship'（AI 副船指派等）：上限 = aiCoreCap（共用，不变）；
  - scope='industry'（精炼炉/回收炉/制造线启动）：上限 = aiCoreCap + industryAiBonus。
- 工业启动三处（industry.ts 精炼炉/回收炉、manufacturing.ts 组装机）改走 industry scope；
  副船指派仍走 ship scope；实体核心占用/归还、效率/调度学、主控手动 1 位均不变。

## 三、UI/文案

- 舰船页 AI 指挥中心：右上角显示 `启用 X/Y`（Y=共用上限；有扩容时追加 `+N 工业`）；
  上限说明行与空态引导补「工业自动化」扩容说明；技能页/手册/教程/核心日志全量更名同步
  （旧公告历史保留原名不动）。

## 四、数值示例

ai-expert 满级 5 → 共用上限 5；「工业自动化」满级 5 → 工业工位 +10；此时站内产业最多
可并行启用 15 枚工位（5 共用 + 10 扩容），AI 副船仍上限 5 且不与产业互抢（产业优先用扩容区）。

## 五、验证

typecheck ×4 绿；core 全绿（ai +1：工业扩容真值表/scope 分路——副船满上限仍拒、产业放行）；
content:check + desktop build 绿。公告稿待船长审核后随批推送（推送闸门内）。
