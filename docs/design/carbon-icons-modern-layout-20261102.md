# 现代布局 Carbon Icons 升级方案（科幻未来专供 · 2026-11-02）

> 状态：已结合船长两次指令深化，待显式确认  
> 船长原话 1：「路线 A 吧 IBM Carbon Icons很不错，但是我们只做做到设计里“科幻未来”的界面布局的里头，不动旧版的UI」  
> 船长原话 2：「颜色和替换的形状还有抽象化的功能也要一致」  
> 船长原话 3：「”点击 出港 “就用原来的图标就好了。界面上的“手册” ”设置“按钮也在文字左侧增加一个对应逻辑的IBM图标」  
> 责任约定：遵循《AGENTS.md》四步闸门、合规与版本纪律。  

---

## 一、 目标与三大一致性原则

### 1. 目标
在保持**「旧版」（classic）布局 100% 原封不动**的前提下，将**「科幻未来」（modern）**界面布局下的通用交互控件图标升级为 **IBM Carbon Icons**（`@carbon/icons-react`，Apache-2.0 协议），消除 Lucide 的圆角圆头生活化特征，达成军规终端、舰载控制台级别的硬核工业感。

### 2. 船长明确的三大一致性原则
1. **颜色 1:1 绝对一致**：
   - 继承模式一致：全面走 `currentColor`，严格继承父容器的语义色阶（如 `.app-warn` 警告黄、`.is-dangerous` 警报红、`.is-primary` 主调天青、`.app-dim` 幽暗灰、`.app-btn` 标准文字色）；
   - 显式传色一致：若调用点传入 `color` prop（或 `style={{ color }}`），适配层必须 100% 映射到 Carbon 的 `fill={color}` 或对应样式，杜绝色偏或默认黑色漏出。
2. **替换的形状 1:1 对应（视觉隐喻一致）**：
   - 保持玩家认知的连续性，绝对不出现张冠李戴（例如放大镜依然是放大镜、垃圾桶依然是工业垃圾箱、叉依然是交叉线、播放暂停依然是三角与双竖条）；
   - 仅改变线帽与拐角的几何风格：从 Lucide 的圆头圆弧升级为 Carbon 的直角倒角和平头切割。
3. **抽象化的功能 1:1 等价（交互语义一致）**：
   - 尺寸（`size`）与占位盒模型 100% 等同，不引起 1px 的布局抖动；
   - `aria-label`、`aria-hidden`、`title`、点击穿透属性完全等价传递，无障碍与可读性无缝衔接。

---

## 二、 架构设计：双模自适应图标分发层

### 1. 实时布局感知与自适应分发
- **实时布局探测 (`isModernLayout`)**：不仅读取 `localStorage` 偏好，更优先探测 DOM 树根节点 `.app-root.is-layout-modern`。只要界面当前呈现为科幻未来，图标立即生效为 Carbon 风格，避免偏好未写入导致的脱节。
- **双模组件封装 (`UiIcon` / `layoutIcons`)**：
  - 当处于 `modern` 时派发 Carbon 硬朗矢量；
  - 当处于 `classic` 时严格回退至原有 Lucide 图标。
- **全屏常驻导航与核心图标接通 (`Glyphs.tsx`)**：
  - 针对玩家/船长第一眼看到且常驻底部的全部核心导航项（出港、舰船、装配、物品、市场、工业、技能、任务、通讯等）以及高频活动图标（采矿、悬赏、打捞、AI等），在 `isModernLayout()` 为 true 时全面切入 IBM Carbon 工业级矢量（Compass、Rocket、Chip、InventoryManagement、ArrowsHorizontal、Industry、Network_4、Task、Email、Target、Gem、Recycle、Bot），旧版经典布局下则 100% 保持历史手绘线稿。

### 2. 14 个消费文件涵盖的图符映射矩阵

| 抽象功能名 | 交互功能语义 | 原 Lucide 图标（旧版） | IBM Carbon 对等图标（科幻未来） | 形状与抽象隐喻说明 |
|---|---|---|---|---|
| `close` | 模态框/窗口关闭、标签移除 | `<X />` | `<Close />` | 锐利交叉线，去圆头端点 |
| `target` | 测算战术目标、瞄准 | `<Crosshair />` | `<Crosshair />` / `<Target />` | 刻度圆环准星，纯工业测距仪感 |
| `play` | 动画/搜寻/测算播放 | `<Play />` | `<PlayFilled />` / `<PlayOutline />` | 紧凑正三角形，切面利落 |
| `pause` | 动画/搜寻/测算暂停 | `<Pause />` | `<PauseFilled />` / `<PauseOutline />` | 双平行等宽竖条 |
| `reset` | 测距/装配重置 | `<RotateCcw />` | `<Reset />` | 逆向回旋箭头，折角平直 |
| `list` | 战斗周期明细清单 | `<List />` | `<List />` | 等距方正列表排线 |
| `pin` | 战斗周期窗口固定 | `<Pin />` | `<Pin />` | 机械锁紧插销 |
| `chevron-down`| 折叠栏展开/收起 | `<ChevronDown />` | `<ChevronDown />` | 锐角倒 V 折线 |
| `chevron-left`| 轮盘页向前翻页 | `<ChevronLeft />` | `<ChevronLeft />` | 锐角向左折线 |
| `chevron-right`| 轮盘页向后翻页 | `<ChevronRight />` | `<ChevronRight />` | 锐角向右折线 |
| `arrow-left` | 轮盘返回上一级 | `<ArrowLeft />` | `<ArrowLeft />` | 直角向左导向箭头 |
| `users` | 舰队人员/指挥预算 | `<Users />` | `<UserMultiple />` | 模块化网格双人轮廓 |
| `radio` | 电子战无线电/测距信号 | `<Radio />` | `<Radio />` | 工业无线电发射源 |
| `history` | 回收炉产出历史 | `<History />` | `<Time />` | 工业仪表盘时钟刻度 |
| `check` | 编队确认勾选 | `<Check />` | `<Checkmark />` | 简练直角转折对勾 |
| `plus` | 加入编队加号/地表新建 | `<Plus />` | `<Add />` | 等长直角正交十字 |
| `radar` | 深空恒星探测雷达 | `<Radar />` | `<Radar />` | 象限坐标网格雷达 |
| `factory` | 探测器工业制造 | `<Factory />` | `<Industry />` / `<Factory />` | 工业制造厂房/齿轮结构 |
| `zoom-in` | 星图视场放大 | `<ZoomIn />` | `<ZoomIn />` | 战术透镜内嵌十字加号 |
| `zoom-out` | 星图视场缩小 | `<ZoomOut />` | `<ZoomOut />` | 战术透镜内嵌减号 |
| `warning` | WebGL 退化告警 | `<AlertTriangle />` | `<WarningAlt />` / `<Warning />` | 军规警报等边三角形 |
| `search` | 天体搜索定位 | `<Search />` | `<Search />` | 硬角透镜镜框 |
| `trash` | 天体废弃/地表拆除 | `<Trash2 />` | `<TrashCan />` | 工业废料容器 |
| `copy` | 种子/坐标复制 | `<Copy />` | `<Copy />` | 双层重叠方正卡片 |
| `zap` | 地表电力负荷 | `<Zap />` | `<Flash />` | 锐角几何闪电折线 |
| `power-off` | 地表建筑停机 | `<PowerOff />` | `<Power />` | 工业切断电源符号 |
| `security` | 地表灾害防护警报 | `<ShieldAlert />` | `<Security />` | 方角盾徽加感叹号 |
| `tools` | 地表建筑维修施工 | `<Hammer />` / `<Wrench />` | `<Tools />` | 正交工模量具 |

---

## 三、 版权与工程合规
- 许可协议：**Apache-2.0**（完全符合商用分发，无 GPL 传染风险）。
- 登记更新：在 `tools/release-rights/index.ts` 的 `RUNTIME_PACKAGES` 增加 `@carbon/icons-react`，确保 `npm run release:rights:check` 通过。

---

## 四、 实施与验证步骤
1. 安装依赖并登记版权；
2. 实现 `ui/layoutIcons.tsx` 双模适配层（注入 `LUCIDE_MAP` 与 `CARBON_MAP`）；
3. 将上述 14 个文件的图标引入切换到适配层（保持原有尺寸与语义传参）；
4. 双布局回归测试：
   - 验证旧版（classic）布局下，14 个文件全部原样展示 Lucide 图标，无样式或位置偏差；
   - 验证科幻未来（modern）布局下，14 个文件全部渲染 Carbon 工业图标，且颜色、尺寸、交互行为 100% 对应；
5. 运行 `npm run release:rights:test`、`npm run typecheck`。
