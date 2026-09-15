/**
 * 科幻线性图标集（图鉴/界面通用）。
 *
 * 设计（中文说明）：
 * - 全部图标同一语言：24×24 viewBox、1.7px 描边、几何构成（圆环徽/方框徽/盾徽/菱形徽），
 *   统一 stroke 质感 = "整体统一、接近科幻风格"；
 * - 颜色不在图标内写死：stroke 用 currentColor，调用方用 tone（色相变量）上色；
 * - 形状按内容体系分族：物品=圆环徽、装备=方框徽、舰船角色=大形徽、蓝图=图纸矩形、
 *   技能=圆徽；每种形状内部用不同几何区分分类。
 */
import type { ReactNode } from 'react'

/** glyph 名 → 矢量内容（以 <g> 为单位，使用 currentColor 描边） */
const SHAPES: Record<string, ReactNode> = {
  /* ── 物品（圆环徽：外环 + 内部几何） ── */
  ore: (
    <g>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M12 6.6l4.4 5.4-4.4 5.4-4.4-5.4z" />
      <path d="M12 9l2.2 3-2.2 3-2.2-3z" />
    </g>
  ),
  mineral: (
    <g>
      <circle cx="12" cy="12" r="8.4" />
      <rect x="7.4" y="7.4" width="9.2" height="9.2" rx="1.3" />
      <path d="M12 7.4v9.2" />
    </g>
  ),
  gas: (
    <g>
      <circle cx="12" cy="12" r="8.4" />
      <circle cx="7" cy="9.6" r="1.8" />
      <circle cx="11.8" cy="15.4" r="2.3" />
      <circle cx="16.6" cy="8.8" r="1.5" />
    </g>
  ),
  ice: (
    <g>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M12 6.8l4.6 2.6v5.2L12 17.2l-4.6-2.6V9.4z" />
      <path d="M12 11.2v1.6M10.6 12h2.8" />
    </g>
  ),
  ammo: (
    <g>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M12 6.2l5.7 8.3H6.3z" />
    </g>
  ),
  drone: (
    <g>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M12 8.9l3.1 3.1-3.1 3.1-3.1-3.1z" />
      <path d="M6 6l2.6 2.6M18 6l-2.6 2.6M6 18l2.6-2.6M18 18l-2.6-2.6" />
    </g>
  ),
  /* ── 残骸 / 修理组件（2026-09-10 补齐：此前这两个种类无图形，列表里落兜底圆环徽） ── */
  wreck: (
    <g>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M7.6 10.2l7.6-1.5.6 4.4-7.4 1.6z" />
      <path d="M11.4 8.9l-1 2.6 1.7 1.3-1.2 2.1" />
      <circle cx="16.2" cy="15.6" r="1" />
    </g>
  ),
  kit: (
    <g>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M8.3 15.7l4.9-4.9" />
      <path d="M13.4 8.2l2.4 2.4-1.7 1.7-2.4-2.4z" />
      <path d="M9 15l-1.2 1.2" />
    </g>
  ),
  fragment: (
    <g>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M13.6 7.4l3 2.6-1.4 4.6-4.6.4-1.6-3.4z" />
      <path d="M12.2 11.2l1.6 1.4" />
      <path d="M8.6 15.4l1.4.8" />
    </g>
  ),
  /* ── 货柜（2026-09-13 F4 补：遗迹安全货柜 = 带回后拆解的大件）──
     造型与其它种类同语言（细描边 + currentColor）：一个带锁扣的箱体 + 两道加固梁。 */
  container: (
    <g>
      <circle cx="12" cy="12" r="8.4" />
      <rect x="7.2" y="8.8" width="9.6" height="6.4" rx="1" />
      <path d="M7.2 11.2h9.6" />
      <path d="M11.4 10.2v2" />
    </g>
  ),
  /* ── 谜质储存器（2026-09-13 F3c 补：本趟虫洞内生效的装置）──
     造型与货柜同语言但**一眼可分**：圆环里一颗菱形晶体 + 上下两道束缚带（"装起来的谜质"）。 */
  matter: (
    <g>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M12 8.4l2.8 3.6-2.8 3.6-2.8-3.6z" />
      <path d="M8.6 9.6h6.8" />
      <path d="M8.6 14.4h6.8" />
    </g>
  ),
  /* ── 虫洞谜质（精华形态 · 船长 2026-09-15：「谜质在虫洞结束时不再删除，而是转化成虫洞谜质存入仓库…
     具备研究价值…目前纯粹作为虫洞的金钱收益」）——与装置形（`matter` 圆环+晶体）同语言但**一眼可分**：
     纯**菱形晶格**（无外环）+ 内辉小点 = "散装可交易的谜质"。 */
  essence: (
    <g>
      <path d="M12 3.4l6.6 5.4-2.7 8.6H8.1L5.4 8.8z" />
      <path d="M12 7.4l3.1 2.7-1.3 3.7h-3.6L9 10.1z" />
      <circle cx="12" cy="11.4" r="1.1" />
    </g>
  ),
  /* ── 奢侈品（船长 2026-09-15：贵重品货柜的拆解产物 ·「纯粹用来卖钱」）——礼盒 + 缎带结。 */
  luxury: (
    <g>
      <path d="M5.4 10.6h13.2v8.8H5.4z" />
      <path d="M4.4 7.4h15.2v3.2H4.4z" />
      <path d="M12 7.4v12" />
      <path d="M12 7.4c-2.7 0-4.1-1.3-3.4-2.7.6-1.2 2.5-.9 3.4 2.7zm0 0c2.7 0 4.1-1.3 3.4-2.7-.6-1.2-2.5-.9-3.4 2.7z" />
    </g>
  ),  /* ── 遗迹安全货柜（2026-09-13 F3c 补：船长「安全货仓…的SVG图标也需要绘制」）──
     与通用 `container` 区分：**没有外环**，是一个带加固角 + 挂锁 + 铅封带的箱体。 */
  'box-relic': (
    <g>
      <path d="M4.8 9.2h14.4v8.6a1.4 1.4 0 0 1-1.4 1.4H6.2a1.4 1.4 0 0 1-1.4-1.4z" />
      <path d="M4.8 12.6h14.4" />
      <path d="M9.2 9.2V6.6h5.6v2.6" />
      <circle cx="12" cy="15.2" r="1.5" />
      <path d="M12 16.7v1.3" />
    </g>
  ),
  /* ── 图纸货柜（2026-09-14 船长：「给虫洞的遗迹打捞新增图纸货柜。占 2 格大小。」）──
     与安全货柜同为"带回后拆开"的货柜，故沿用同一套箱体语言；靠**扁长比例**（2×1）与
     **箱盖上的卷轴筒**区分：图纸货柜装的是图纸，不是设备。 */
  'box-bp': (
    <g>
      <path d="M3.6 11.6h16.8v5a1.4 1.4 0 0 1-1.4 1.4H5a1.4 1.4 0 0 1-1.4-1.4z" />
      <path d="M3.6 14.2h16.8" />
      <path d="M8.8 11.6V9.6h6.4v2" />
      <circle cx="12" cy="8" r="1.6" />
    </g>
  ),
  /* ── 贵重品货柜 / 军用备货柜（船长 2026-09-15：「新增贵重品货柜，2格…」「新增军用备货柜4格…」）──
     两者与安全 / 图纸货柜**同一套箱体语言**（细描边 + currentColor + 24 号 viewBox），
     但各给一处"装箱标识"，让玩家在货仓格里一眼分清这三类箱子：
     · 贵重品柜 = 箱体 + **缎带竖带 + 中央宝石 + 顶部提手**（"装着值钱货的礼箱"）； */
  'box-valuables': (
    <g>
      <path d="M4.6 10.4h14.8v7a1.4 1.4 0 0 1-1.4 1.4H6a1.4 1.4 0 0 1-1.4-1.4z" />
      <path d="M4.6 13h14.8" />
      <path d="M12 10.4v8.4" />
      <circle cx="12" cy="13" r="1.5" />
      <path d="M9.8 7.6a2.2 2.2 0 0 1 4.4 0" />
    </g>
  ),
  /* · 军用备货柜 = 箱体 + **两道吊扣 + 交叉军械标记**（"制式军械箱"）。 */
  'box-military': (
    <g>
      <path d="M4.4 9.6h15.2v7.8a1.4 1.4 0 0 1-1.4 1.4H5.8a1.4 1.4 0 0 1-1.4-1.4z" />
      <path d="M4.4 12.8h15.2" />
      <path d="M6.8 9.6V7.2h3v2.4M14.2 9.6V7.2h3v2.4" />
      <path d="M9.8 15.2l4.4 2.2M14.2 15.2l-4.4 2.2" />
    </g>
  ),
  /* ── AI 核心（2026-09-14 船长：「在遗迹的打捞内，添加阿尔法、贝塔、伽马 AI 核心的掉落。
        AI 核心单独占 1 格」）──
     它与货柜/谜质都不同类：不是"装东西的箱"，而是**一枚裸核心**。故另起一套语言 ——
     方正的**载板**（四角螺栓）+ 板心的**运算核心圆**（外环 + 内核点 + 两道引脚）。
     三档只换色调不换造型（伽马 → 贝塔 → 阿尔法，越稀有越暖越亮），与图纸货柜同款做法。 */
  'ai-core': (
    <g>
      <rect x="6.4" y="6.4" width="11.2" height="11.2" rx="1.6" />
      <circle cx="12" cy="12" r="3.6" />
      <circle cx="12" cy="12" r="1.2" />
      <path d="M12 6.4V3.8M12 20.2v-2.6M6.4 12H3.8M20.2 12h-2.6" />
    </g>
  ),
  /* ── AI 核心（`aicore` = 大类级键；2026-09-14）──
     与 `ai-core`（具体三种核心的共用造型）同一张线稿：大类级键是"按 kind 兜底"那条路的入口
     （物品图鉴/列表在拿不到具体 id 键时落到这里），故两处都登记、造型一致。 */
  aicore: (
    <g>
      <rect x="6.4" y="6.4" width="11.2" height="11.2" rx="1.6" />
      <circle cx="12" cy="12" r="3.6" />
      <circle cx="12" cy="12" r="1.2" />
      <path d="M12 6.4V3.8M12 20.2v-2.6M6.4 12H3.8M20.2 12h-2.6" />
    </g>
  ),
  /* ── 谜质装置 20 台（2026-09-13 F3c：每台一枚专属线稿）──
     全部沿用"圆环徽 + 内部几何"这套物品语言，靠**内部纹样**区分用途（远看同族、近看可辨）。 */
  /* 探索：测绘 / 时序 / 星云 / 扩展 */
  'mat-surveyor': (
    <g>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M12 12l4.4-3.2" />
      <path d="M6.8 12a5.2 5.2 0 0 1 5.2-5.2" />
      <circle cx="12" cy="12" r="1" />
    </g>
  ),
  'mat-chrono': (
    <g>
      <circle cx="12" cy="12" r="8.4" />
      <circle cx="12" cy="12" r="4.6" />
      <path d="M12 9.4V12l2 1.5" />
    </g>
  ),
  'mat-nebula': (
    <g>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M8.6 10.2h4a1.7 1.7 0 1 0-1.7-1.7" />
      <path d="M8.4 13.8h5.4a1.8 1.8 0 1 1-1.8 1.8" />
    </g>
  ),
  'mat-expander': (
    <g>
      <circle cx="12" cy="12" r="8.4" />
      <rect x="9" y="9" width="6" height="6" rx="1" strokeDasharray="2 2" />
      <path d="M6.4 12H4.8M17.6 12h1.6M12 6.4V4.8M12 17.6v1.6" />
    </g>
  ),
  /* 作业与收益：起重机 / 钻机 / 富集 */
  'mat-crane': (
    <g>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M8.8 7.8h6.4" />
      <path d="M12 7.8v5" />
      <path d="M12 12.8a1.9 1.9 0 1 0 1.9 1.9" />
    </g>
  ),
  'mat-drill': (
    <g>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M12 7v4.6" />
      <path d="M9.4 11.6h5.2L12 16.4z" />
    </g>
  ),
  'mat-enricher': (
    <g>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M12 13.8l2.2 2.2-2.2 2.2-2.2-2.2z" />
      <path d="M9.8 11L12 8.8l2.2 2.2" />
      <path d="M12 8.8v2.6" />
    </g>
  ),
  /* 威胁：压制 / 守卫解析 / 撤离掩护 */
  'mat-suppressor': (
    <g>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M12 6.6v4.2" />
      <path d="M9.6 8.6L12 11l2.4-2.4" />
      <path d="M8 14.2h8" />
    </g>
  ),
  'mat-boss-analyzer': (
    <g>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M12 6.2l1.9 2.3h-3.8z" />
      <circle cx="12" cy="13.4" r="3.4" />
      <circle cx="12" cy="13.4" r="1" />
    </g>
  ),
  'mat-extract-cover': (
    <g>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M8 8.4h2.6v7.2H8" />
      <path d="M12.4 12h4.8" />
      <path d="M14.8 9.8L17.2 12l-2.4 2.2" />
    </g>
  ),
  /* 抗性三片：护盾 / 装甲 / 结构（单层单系） */
  'mat-shield-res': (
    <g>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M12 6.6l4.4 1.6v3.4c0 2.6-1.8 4.4-4.4 5.4-2.6-1-4.4-2.8-4.4-5.4V8.2z" />
    </g>
  ),
  'mat-armor-res': (
    <g>
      <circle cx="12" cy="12" r="8.4" />
      <rect x="7.2" y="8.2" width="7" height="5.2" rx="1" />
      <rect x="9.8" y="11.4" width="7" height="5.2" rx="1" />
    </g>
  ),
  'mat-hull-res': (
    <g>
      <circle cx="12" cy="12" r="8.4" />
      <rect x="7.2" y="8" width="9.6" height="8" rx="1" />
      <path d="M7.2 8l9.6 8M16.8 8l-9.6 8" />
    </g>
  ),
  /* 命中 / 回避 / 干扰 */
  'mat-tracker': (
    <g>
      <circle cx="12" cy="12" r="8.4" />
      <circle cx="12" cy="12" r="4" />
      <path d="M12 6.2v2.4M12 15.4v2.4M6.2 12h2.4M15.4 12h2.4" />
    </g>
  ),
  'mat-gyro': (
    <g>
      <circle cx="12" cy="12" r="8.4" />
      <ellipse cx="12" cy="12" rx="5.8" ry="2.6" />
      <ellipse cx="12" cy="12" rx="5.8" ry="2.6" transform="rotate(62 12 12)" />
    </g>
  ),
  'mat-jammer': (
    <g>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M9.2 9.4a3.6 3.6 0 0 1 0 5.2" />
      <path d="M7.2 7.6a6.6 6.6 0 0 1 0 8.8" />
      <path d="M14.4 14.4l3.4 3.4M17.8 14.4l-3.4 3.4" />
    </g>
  ),
  /* 射程 / 盲区 / 弹药增效 / 装填 */
  'mat-rangefinder': (
    <g>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M5.8 12h11.6" />
      <path d="M14.6 9.8L17.4 12l-2.8 2.2" />
      <path d="M9 10.2v3.6" />
    </g>
  ),
  'mat-blindspot': (
    <g>
      <circle cx="12" cy="12" r="8.4" />
      <circle cx="12" cy="14.6" r="2.6" />
      <path d="M12 6.6v4" />
      <path d="M9.8 8.6L12 10.8l2.2-2.2" />
    </g>
  ),
  'mat-ammo-dmg': (
    <g>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M12 7.2c1.4 1.3 2.2 2.9 2.2 4.7v3.3H9.8v-3.3c0-1.8.8-3.4 2.2-4.7z" />
      <path d="M12 15.2v2" />
    </g>
  ),
  'mat-reload': (
    <g>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M16.4 12a4.4 4.4 0 1 1-1.5-3.3" />
      <path d="M16.6 6.6v2.8h-2.8" />
    </g>
  ),
  /* ── B2 批：溢火结转 / 弹药回收 / 机群回收网 / 战地维修 ── */
  'mat-volley': (
    <g>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M9.4 9.6L6.6 12l2.8 2.4" />
      <path d="M14.6 9.6L17.4 12l-2.8 2.4" />
      <circle cx="12" cy="12" r="1.4" />
    </g>
  ),
  'mat-ammo-back': (
    <g>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M10.6 10h2.8v6.6h-2.8z" />
      <path d="M10.6 10c0-1.2.6-2.1 1.4-2.1s1.4.9 1.4 2.1" />
      <path d="M15.8 7.6h-3.4" />
      <path d="M13.6 6.4L12.4 7.6l1.2 1.2" />
    </g>
  ),
  'mat-drone-net': (
    <g>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M12 6.6l1.8 2.2h-3.6z" />
      <path d="M8.2 11.2h7.6v5.4H8.2z" />
      <path d="M8.2 13.9h7.6M12 11.2v5.4" />
    </g>
  ),
  'mat-field-repair': (
    <g>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M12 7.4v6.4M8.8 10.6h6.4" />
      <path d="M8.6 15.2a4.4 4.4 0 0 0 6.8 0" />
    </g>
  ),
  /* ── 装备（方框徽：外框 + 内部机件） ── */
  miner: (
    <g>
      <rect x="7" y="7" width="10" height="10" rx="1.7" />
      <path d="M12 8.2l3.8 3.8-3.8 3.8-3.8-3.8z" />
      <path d="M12 10.4v3.2" />
    </g>
  ),
  cargo: (
    <g>
      <rect x="7" y="7" width="10" height="10" rx="1.7" />
      <path d="M7.8 11.2h8.4M7.8 14.4h8.4" />
    </g>
  ),
  turret: (
    <g>
      <rect x="7" y="7" width="10" height="10" rx="1.7" />
      <circle cx="12" cy="12" r="2.7" />
      <path d="M12 7.6v2.3M12 14.1v2.3M7.6 12h2.3M14.1 12h2.3" />
    </g>
  ),
  /* V18B-1 导弹架（方框徽：导弹弹体斜置） */
  missile: (
    <g>
      <rect x="7" y="7" width="10" height="10" rx="1.7" />
      <path d="M15.6 8.4l-6.6 6.6M13.6 8.4h2v2M10.4 15.6h-2v-2" />
      <path d="M8.9 15.1L15.1 8.9" />
    </g>
  ),
  shield: (
    <g>
      <rect x="7" y="7" width="10" height="10" rx="1.7" />
      <path d="M12 8.9c1.5 1 2.7 1.4 3.5 1.5v2.8c0 2.4-1.5 3.8-3.5 4.5-2-.7-3.5-2.1-3.5-4.5v-2.8c.8-.1 2-.5 3.5-1.5z" />
    </g>
  ),
  armor: (
    <g>
      <rect x="7" y="7" width="10" height="10" rx="1.7" />
      <path d="M8.2 9.6h7.6M8.8 12.3h6.4M8.2 15h7.6" />
    </g>
  ),
  propulsion: (
    <g>
      <rect x="7" y="7" width="10" height="10" rx="1.7" />
      <path d="M12 8.6c1.7 2 2.7 3.4 2.7 5a2.7 2.7 0 1 1-5.4 0c0-1.6 1-3 2.7-5z" />
      <path d="M12 7.4V8.5" />
    </g>
  ),
  /* V18 无人机装置（方框徽：停机甲板 / 导控阵列） */
  'drone-rack': (
    <g>
      <rect x="7" y="7" width="10" height="10" rx="1.7" />
      <path d="M9.3 9.8h1.6v1.6H9.3zM13.1 9.8h1.6v1.6h-1.6z" />
      <path d="M9 14.8h6" />
    </g>
  ),
  'drone-tac': (
    <g>
      <rect x="7" y="7" width="10" height="10" rx="1.7" />
      <path d="M12 9.4l2.6 2.6-2.6 2.6-2.6-2.6z" />
      <path d="M8 8l1.8 1.8M16 8l-1.8 1.8M8 16l1.8-1.8M16 16l-1.8-1.8" />
    </g>
  ),
  /* 2026-09-10 无人机中继天线（方框徽：中继塔 + 信号弧） */
  'drone-relay': (
    <g>
      <rect x="7" y="7" width="10" height="10" rx="1.7" />
      <path d="M12 16.5v-4.2" />
      <path d="M12 12.6l1 1-1 1-1-1z" />
      <circle cx="12" cy="8.2" r="0.9" />
      <path d="M8.8 10.6c-1.1.7-1.1 2.5 0 3.2" fill="none" />
      <path d="M15.2 10.6c1.1.7 1.1 2.5 0 3.2" fill="none" />
    </g>
  ),
  /* V18B-2 激光炮（方框徽：光束横贯） */
  laser: (
    <g>
      <rect x="7" y="7" width="10" height="10" rx="1.7" />
      <path d="M8.4 15.6L15.6 8.4M8.4 8.4l7.2 7.2" />
      <path d="M10.9 8.4h4.7v4.7" />
    </g>
  ),
  /* V18.1 支援件（方框徽：上升增益箭头） */
  support: (
    <g>
      <rect x="7" y="7" width="10" height="10" rx="1.7" />
      <path d="M12 15.2V9.4M9.8 11.4L12 9l2.2 2.4" />
    </g>
  ),
  /* 2026-09-11 协处理器（方框徽：算力芯片——内芯 + 四向引脚） */
  cpu: (
    <g>
      <rect x="7" y="7" width="10" height="10" rx="1.7" />
      <rect x="9.9" y="9.9" width="4.2" height="4.2" rx="0.8" />
      <path d="M12 7.4v2.5M12 14.1v2.5M7.4 12h2.5M14.1 12h2.5" />
    </g>
  ),
  /* 打捞器 / 锁定装置（2026-09-10 补齐：此前这两个槽位无图形，列表里落兜底圆环徽） */
  salvager: (
    <g>
      <rect x="7" y="7" width="10" height="10" rx="1.7" />
      <path d="M12 8.6v4.2" />
      <path d="M9.2 14.6l2.8-1.8 2.8 1.8" />
      <path d="M9.2 15.6v-1M14.8 15.6v-1" />
    </g>
  ),
  'target-lock': (
    <g>
      <rect x="7" y="7" width="10" height="10" rx="1.7" />
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 7.6v1.8M12 14.6v1.8M7.6 12h1.8M14.6 12h1.8" />
    </g>
  ),
  /* ── 舰船角色（大形徽：双层几何轮廓） ── */
  industrial: (
    <g>
      <path d="M12 3.4l9.2 8.6-9.2 8.6-9.2-8.6z" />
      <path d="M12 7.6l5.2 4.4-5.2 4.4-5.2-4.4z" />
    </g>
  ),
  armed: (
    <g>
      <path d="M12 2.9c2.6 1.8 4.9 2.4 6.4 2.6v6.1c0 4.7-3 7.7-6.4 9.1-3.4-1.4-6.4-4.4-6.4-9.1V5.5c1.5-.2 3.8-.8 6.4-2.6z" />
      <circle cx="12" cy="12.2" r="2" />
      <path d="M12 8.4v1.8M12 14.2v1.8M7.4 12.2h1.8M14.8 12.2h1.8" />
    </g>
  ),
  armored: (
    <g>
      <path d="M12 3.8l7 4v8.4l-7 4-7-4V7.8z" />
      <path d="M12 7.2l4.4 2.6v5.2L12 17.6l-4.4-2.6V9.8z" />
    </g>
  ),
  hauler: (
    <g>
      <rect x="3.6" y="7.2" width="16.8" height="9.6" rx="1.8" />
      <path d="M7.4 12h9.2M13.6 9.4l2.6 2.6-2.6 2.6" />
    </g>
  ),
  /* ── 蓝图（图纸矩形） ── */
  blueprint: (
    <g>
      <rect x="6.2" y="3.8" width="11.6" height="16.4" rx="1.5" />
      <path d="M6.2 8.6h11.6M9.6 11.8h4.8M9.6 14.6h3" />
    </g>
  ),
  /* ── 技能组（圆徽） ── */
  'group-舰船': (
    <g>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M7.4 16.6L16.6 7.4M11.6 7.4h5v5" />
    </g>
  ),
  'group-工业': (
    <g>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M12 7.4l4 2.3v4.6L12 16.6l-4-2.3V9.7z" />
      <circle cx="12" cy="12" r="1.4" />
    </g>
  ),
  'group-战斗': (
    <g>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M9 9l6 6M15 9l-6 6" />
    </g>
  ),
  'group-工程': (
    <g>
      <circle cx="12" cy="12" r="8.4" />
      <rect x="8.4" y="8.4" width="7.2" height="7.2" rx="1.2" />
      <circle cx="12" cy="12" r="1.2" />
    </g>
  ),
  'group-贸易': (
    <g>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M12 6.6l3.4 3.4-3.4 3.4-3.4-3.4zM12 13.6l3.4 3.4-3.4 3.4-3.4-3.4z" />
    </g>
  ),
  /* ── 界面导航/功能概念（2026-09-05 图标全 SVG 线性化：与物品/装备同语言） ── */
  /* 星图/出港（2026-09-05 船长：实心四角星——闪星） */
  'nav-map': (
    <g>
      <path fill="currentColor" stroke="none" d="M12 2L14.9 9.1L22 12L14.9 14.9L12 22L9.1 14.9L2 12L9.1 9.1Z" />
    </g>
  ),
  /* 舰船/舰队（2026-09-05 船长：帆船不像星舰，改火箭造型） */
  'nav-ship': (
    <g>
      <path d="M4.8 16.6c-1.4 1.24-1.9 4.6-1.9 4.6s3.4-.5 4.6-1.9c.65-.77.64-1.96-.08-2.74a2 2 0 0 0-2.62-.06z" />
      <path d="M12.5 14.5l-3-3a20.3 20.3 0 0 1 1.9-3.6A11.9 11.9 0 0 1 22 2c0 2.5-.7 6.9-5.5 10.1a20.6 20.6 0 0 1-4 1.9z" />
      <path d="M9.5 12H4.8s.5-2.8 1.8-3.7c1.5-1 4.6 0 4.6 0" />
      <path d="M12.5 15v4.6s2.8-.5 3.7-1.8c1-1.5 0-4.6 0-4.6" />
    </g>
  ),
  'nav-fit': (
    <g>
      <rect x="8.1" y="8.1" width="3.4" height="3.4" rx="0.8" />
      <rect x="12.5" y="8.1" width="3.4" height="3.4" rx="0.8" />
      <rect x="8.1" y="12.5" width="3.4" height="3.4" rx="0.8" />
      <rect x="12.5" y="12.5" width="3.4" height="3.4" rx="0.8" />
    </g>
  ),
  'nav-items': (
    <g>
      <rect x="5.4" y="6.8" width="13.2" height="10.4" rx="1.5" />
      <path d="M5.4 10.6h13.2" />
      <path d="M8 6.8V5h8v1.8" />
    </g>
  ),
  'nav-market': (
    <g>
      <path d="M6.4 9.2h8.4a2.8 2.8 0 0 1 2.8 2.8" />
      <path d="M15.2 6.4l2.4 2.4-2.4 2.4" />
      <path d="M17.6 14.8H9.2a2.8 2.8 0 0 1-2.8-2.8" />
      <path d="M8.8 17.6l-2.4-2.4 2.4-2.4" />
    </g>
  ),
  'nav-industry': (
    <g>
      <path d="M12 4.9l6.2 3.6v7L12 19.1l-6.2-3.6v-7z" />
      <circle cx="12" cy="12" r="2.4" />
    </g>
  ),
  'nav-skills': (
    <g>
      <circle cx="12" cy="12" r="8.2" />
      <path d="M12 7.6v8.8M7.6 12h8.8" />
    </g>
  ),
  /* 通讯/收件箱（2026-09-11 船长定：导航新增「通讯」页，图标采用邮件的样式） */
  'nav-mail': (
    <g>
      <rect x="3.4" y="6.4" width="17.2" height="11.4" rx="1.8" />
      <path d="M4.6 7.8l7.4 5.2 7.4-5.2" />
    </g>
  ),
  /* 官方章鱼人（2026-09-11 船长定：绘制章鱼头代表官方，之后都用于代表官方章鱼人）
     造型：圆钝外套膜头部（顶部小凸起）+ 两只实心眼 + 六条外扩腕足；与舰船资产同一套线稿语言。
     ★ 复用规则：所有 NPC 势力的物种都是「章鱼人」(data/src/commsFactions.ts)，头像一律用本图标，
       不同行会/立场只靠**色调**区分（协会 #9fd8ff / 打捞队工会 #6fe3f0），不要另画新头像。
     2026-09-11 船长复看：「盒内图形要更大、且线太粗」⇒ 几何按 1.4× 放大（铺满 24 格视框，头像盒尺寸不变），
     并在本组写死 strokeWidth 0.7 覆盖 Glyph 默认的 1.7（50px 显示下由约 3.5px 降到约 1.46px，
     与导航图标同视觉粗细：19px 下 1.7 单位 ≈ 1.35px）。 */
  'faction-octopus': (
    <g strokeWidth="0.7">
      <path d="M12 3.56c-3.43 0 -6.16 2.73 -6.16 6.09v4.41c0 1.26 1.01 2.24 2.24 2.24h7.84c1.23 0 2.24 -0.98 2.24 -2.24V9.65c0 -3.36 -2.73 -6.09 -6.16 -6.09Z" />
      <path d="M12 0.83V3.56" />
      <path d="M8.08 11.4c2.66 1.4 5.18 1.4 7.84 0" />
      <circle cx="9.06" cy="8.25" r="1.89" fill="currentColor" stroke="none" />
      <circle cx="14.94" cy="8.25" r="1.89" fill="currentColor" stroke="none" />
      <path d="M8.99 16.3c-0.7 1.82 -2.03 3.15 -3.85 4.27" />
      <path d="M10.6 16.3c-0.14 1.75 -0.84 3.29 -2.1 4.9" />
      <path d="M12 16.3v5.04" />
      <path d="M13.4 16.3c0.14 1.75 0.84 3.29 2.1 4.9" />
      <path d="M15.01 16.3c0.7 1.82 2.03 3.15 3.85 4.27" />
    </g>
  ),
  /* 矿带开采/采矿（2026-09-05 船长：原工具形似扳手，改矿镐——竖柄+镐头双弯臂） */
  'nav-mine': (
    <g>
      <path d="M12 21V9.6" />
      <path d="M12 9.6C9.9 9.8 7.3 8.4 6.2 5.6" />
      <path d="M12 9.6c2.1.2 4.7-1.2 5.8-4" />
      <path d="M6.2 5.6l-.8-1.6M17.8 5.6l.8-1.6" />
    </g>
  ),
  'nav-bounty': (
    <g>
      <circle cx="12" cy="12" r="2.7" />
      <path d="M12 3.2v4.4M12 16.4v4.4M3.2 12h4.4M16.4 12h4.4" />
    </g>
  ),
  /* 残骸打捞（原 🛰 卫星：中心舱体 + 太阳能翼 + 天线——贴近原图标语义） */
  'nav-salvage': (
    <g>
      <circle cx="12" cy="12.4" r="2.5" />
      <rect x="3" y="10" width="5.4" height="4.8" rx="1" />
      <rect x="15.6" y="10" width="5.4" height="4.8" rx="1" />
      <path d="M12 4.4v5M12 4.4l1.7 1.7M12 4.4l-1.7 1.7" />
    </g>
  ),
  'nav-task': (
    <g>
      <rect x="5.6" y="4.8" width="12.8" height="14.4" rx="1.8" />
      <path d="M8.6 9.4h6.8M8.6 12.6h6.8M8.6 15.8h4.2" />
    </g>
  ),
  'nav-ai': (
    <g>
      <rect x="6.9" y="9" width="10.2" height="9.2" rx="2.4" />
      <path d="M12 5.4v2.6" />
      <circle cx="12" cy="4.9" r="1.1" />
      <path d="M9.7 12.6h.9v.9h-.9zM13.4 12.6h.9v.9h-.9z" />
    </g>
  ),
  'nav-shop': (
    <g>
      <path d="M12 4.6l7.4 7.4L12 19.4 4.6 12z" />
      <path d="M12 9.4l2.6 2.6-2.6 2.6-2.6-2.6z" />
    </g>
  ),
  /* ── 虫洞（终局玩法入口 · 2026-09-13 船长：「给虫洞系统绘制一个合适的SVG」）──
     画法：**一笔旋涡**（2 圈螺旋收进中心）。选型经过：先按「空间裂隙」画了三版（透镜裂口 + 括号弧 /
     窄缝 + 折向缝心的短弧 / 锯齿裂缝），13px 下分别读成「眼睛」「立着的剑」「打结的藤」⇒ 船长改选旋涡。
     刻意**不加外圈**（圆环徽＝物品族语汇）、**不带箭头**（圆箭头＝`ico-loop`「重复清剿」），
     与全仓图标同语言：24×24 · 1.7px 描边 · currentColor · 无填充 · 无渐变。 */
  'nav-wormhole': (
    <g>
      <path d="M12 3.6a8.4 8.4 0 1 1-8.4 8.4 5.6 5.6 0 1 1 5.6 5.6 2.8 2.8 0 1 1 2.8-2.8" />
    </g>
  ),
  /* ── 虫洞敌族徽（丁 · 2026-09-14 船长定案：一处虫洞锁一族，列表里给玩家看） ──
     五枚同语言：24×24 · 1.7px 描边 · currentColor · 无填充；外框统一"六边格"（族徽语汇，区别于
     圆环=物品 / 方框=装备 / 盾=防护），内部各用一处几何点出该族的气质：
     A 劫掠支队=交叉刃 · C 巢群游猎=三点群 · D 守墓巡哨=陵柱 · E 巨构残响=菱形残壳 · G 亡军封锁=封锁斜栅 */
  'fam-a': (
    <g>
      <path d="M12 3.2l7.6 4.4v8.8L12 20.8l-7.6-4.4V7.6z" />
      <path d="M8.6 8.6l6.8 6.8" />
      <path d="M15.4 8.6l-6.8 6.8" />
    </g>
  ),
  'fam-c': (
    <g>
      <path d="M12 3.2l7.6 4.4v8.8L12 20.8l-7.6-4.4V7.6z" />
      <circle cx="12" cy="9.6" r="1.7" />
      <circle cx="9" cy="14.6" r="1.4" />
      <circle cx="15" cy="14.6" r="1.4" />
    </g>
  ),
  'fam-d': (
    <g>
      <path d="M12 3.2l7.6 4.4v8.8L12 20.8l-7.6-4.4V7.6z" />
      <path d="M9.4 8.4v7.2M12 8.4v7.2M14.6 8.4v7.2" />
      <path d="M8.2 17.2h7.6" />
    </g>
  ),
  'fam-e': (
    <g>
      <path d="M12 3.2l7.6 4.4v8.8L12 20.8l-7.6-4.4V7.6z" />
      <path d="M12 7.6l3.4 4.4L12 16.4l-3.4-4.4z" />
      <path d="M12 12v4.4" />
    </g>
  ),
  'fam-g': (
    <g>
      <path d="M12 3.2l7.6 4.4v8.8L12 20.8l-7.6-4.4V7.6z" />
      <path d="M8.4 15.6l7.2-7.2" />
      <path d="M8.4 11.2l4.4-4.4" />
      <path d="M11.2 15.6l4.4-4.4" />
    </g>
  ),
  /* ── 界面操作概念（批2，2026-09-05：按钮/徽标字符图标 SVG 化） ── */
  'ico-home': (
    <g>
      <path d="M4 11l8-6.6L20 11" />
      <path d="M6.2 9.4V19h11.6V9.4" />
      <path d="M10.2 19v-4.4h3.6V19" />
    </g>
  ),
  'ico-lock': (
    <g>
      <rect x="6.6" y="10.6" width="10.8" height="8.2" rx="1.8" />
      <path d="M9.2 10.4V8.2a2.8 2.8 0 0 1 5.6 0v2.2" />
      <circle cx="12" cy="14.6" r="1.2" />
      <path d="M12 15.8v1.2" />
    </g>
  ),
  'ico-clock': (
    <g>
      <circle cx="12" cy="12" r="8.2" />
      <path d="M12 7.4V12l3.2 2" />
    </g>
  ),
  'ico-loop': (
    <g>
      <path d="M19.4 10.2A7.6 7.6 0 1 0 19.6 14" />
      <path d="M19.4 6.4v3.8h-3.8" />
    </g>
  ),
  'ico-flag': (
    <g>
      <path d="M6.2 20.4V4.6" />
      <path d="M6.2 5.2c3.8-2 6.4.6 9.8-.9v7c-3.4 1.5-6-1.1-9.8.9z" />
    </g>
  ),
  /* 玩家标记（收藏）星标（2026-09-10）：五角星线稿，未标记=空心、已标记=金色实心（填色由 CSS 给） */
  'ico-star': (
    <g>
      <path d="M12 3.6L14.12 9.09L19.99 9.4L15.42 13.11L16.94 18.8L12 15.6L7.06 18.8L8.58 13.11L4.01 9.4L9.88 9.09Z" />
    </g>
  ),
  'ico-scan': (
    <g>
      <circle cx="12" cy="12" r="5.6" />
      <path d="M12 12l4.2-4.2" />
      <path d="M9 3.4h6M3.4 9v6M15 20.6H9M20.6 15V9" />
    </g>
  ),
  'ico-swap': (
    <g>
      <path d="M8 6.6h8.4a3 3 0 0 1 0 6H11" />
      <path d="M14.8 4l2 2.6-2 2.4" />
      <path d="M16 17.4H7.6a3 3 0 0 1 0-6H13" />
      <path d="M9.2 20l-2-2.6 2-2.4" />
    </g>
  ),
  'ico-cross': (
    <g>
      <path d="M12 5.4v13.2M5.4 12h13.2" />
    </g>
  ),
  /* 建站吊车（原 🏗：塔柱 + 吊臂 + 吊钩） */
  'ico-crane': (
    <g>
      <path d="M9 20.4V5" />
      <path d="M9 5h6.4" />
      <path d="M15.4 5v2.6" />
      <path d="M15.4 7.6v2.6M14 10.2h2.8" />
      <path d="M6.2 20.4h5.6" />
    </g>
  ),
  /* 通讯天线（原 📡：抛物面弧 + 天线杆 + 底座） */
  'ico-antenna': (
    <g>
      <path d="M5.6 14.4a7.8 7.8 0 0 1 12.8 0" />
      <path d="M12 14.4v5.2" />
      <path d="M9.6 19.6h4.8" />
      <circle cx="12" cy="10.6" r="1" />
    </g>
  ),
  /* 战术情报雷达（原 🛰 侦察情报：扫描环 + 扫掠针） */
  'ico-tact': (
    <g>
      <circle cx="12" cy="12" r="5" />
      <path d="M12 12l4.2-4.2" />
      <path d="M9.6 8.4a4.4 4.4 0 0 1 2.4-1.2" />
    </g>
  ),
  /* 长途运输（2026-09-09：货箱 + 右侧运输箭头——两站航线货运） */
  'nav-haul': (
    <g>
      <rect x="4.6" y="10.2" width="9" height="7" rx="1.3" />
      <path d="M9.1 6.9v3.3" />
      <path d="M9.1 6.9l-1.8 1.8M9.1 6.9l1.8 1.8" />
      <path d="M15.6 13.7h3.6" />
      <path d="M17.4 11.9l1.8 1.8-1.8 1.8" />
    </g>
  ),
  /* 提示标记（2026-09-13 船长：「将各个界面的说明…隐藏起来，只在标题名字的后面显示一个圆形感叹号图标，
     当玩家悬停时才显示这些说明」）——**圆环 + 一道竖点**（感叹号）；颜色不写死走 currentColor，
     由 `.app-hint-ico` 给暗色、悬停提亮（与全仓图标同语言：24×24 · 1.7px · 无填充）。 */
  'ico-hint': (
    <g>
      <circle cx="12" cy="12" r="8.2" />
      <path d="M12 7.3v5.8" />
      <circle cx="12" cy="16.3" r="1" />
    </g>
  ),
  fallback: (
    <g>
      <circle cx="12" cy="12" r="8.4" />
      <circle cx="12" cy="12" r="2.4" />
    </g>
  ),
}

/** 调色板：分类色调（科幻 UI 亮色系） */
export const TONES: Record<string, string> = {
  ore: '#5ee6c8',
  mineral: '#6cb6ff',
  gas: '#c792ea',
  ice: '#9ce6f5',
  ammo: '#ff8373',
  drone: '#ffc46b',
  wreck: '#b8a37a', // 残骸：旧黄铜/锈色（回收料的观感）
  kit: '#8fd96b', // 修理组件：维修绿（与矿石青绿区分）
  fragment: '#b48cff', // 蓝图碎片：比蓝图紫更沉一档
  container: '#e0b060', // 货柜：黄铜箱体色（与残骸的旧黄铜区分一档，更亮）
  matter: '#a6f0ff', // 谜质储存器：谜质冷辉青（与货柜黄铜、蓝图紫都不撞）
  essence: '#69e2ff', // 虫洞谜质：比装置形更亮的冷辉青（同一族、亮一档）
  luxury: '#f2d98a', // 奢侈品：浅金（与货柜黄铜 #e0b060 拉开一档）
  aicore: '#8aa0b8', // AI 核心（大类级兜底色；具体三种按稀有度分色，见下面 `ai-core-*`）
  /* ── 遗迹安全货柜（F3c）：造型共用 `box-relic`，**按族分色**（与"按族掉落"这条口径对齐）── */
  'box-relic': '#e0b060',
  'box-relic-a': '#ff8373', // A 海盗：红
  'box-relic-c': '#c792ea', // C 异形：紫
  'box-relic-d': '#cdd6e0', // D 守墓：灰白
  'box-relic-e': '#5ee6c8', // E 巨构：青
  'box-relic-g': '#ffca58', // G 亡军：黄
  /* ── 图纸货柜（2026-09-14）：造型共用 `box-bp`，**按层档分色**（浅 → 中 → 深，越深越冷越艳）── */
  'box-bp': '#e0b060',
  'box-bp-shallow': '#9fe8ff', // 浅层：淡青（最浅那层）
  'box-bp-mid': '#ffca58', // 中层：琥珀
  'box-bp-deep': '#e07bff', // 深层：品红紫
  /* ── 贵重品货柜 / 军用备货柜（2026-09-15）：各一枚专属造型，色调与"箱里装什么"对齐 ── */
  'box-valuables': '#f2d98a', // 与奢侈品同族浅金（打开就是奢侈品）
  'box-military': '#8fb0c8', // 钢青灰（制式军械）
  /* ── AI 核心（2026-09-14）：造型共用 `ai-core`，**按稀有度分色**（伽马 → 贝塔 → 阿尔法，越稀有越暖越亮）── */
  'ai-core': '#8aa0b8',
  'ai-core-gamma': '#7fd4a8', // 伽马：青绿（最常见）
  'ai-core-beta': '#ffca58', // 贝塔：琥珀
  'ai-core-alpha': '#ff9d5c', // 阿尔法：炽橙（最稀有 · 与"1000 万"的量级对上）
  /* ── 谜质装置 20 台：按**用途族**分色（探索青蓝 / 作业青绿 / 威胁琥珀红 / 抗性按层 / 其余各自一色）── */
  'mat-surveyor': '#6fe3f0',
  'mat-chrono': '#7fc7ff',
  'mat-nebula': '#9ce6f5',
  'mat-expander': '#a6f0ff',
  'mat-crane': '#5ee6c8',
  'mat-drill': '#7de3a8',
  'mat-enricher': '#ffd166',
  'mat-suppressor': '#ff8373',
  'mat-boss-analyzer': '#ff9f6b',
  'mat-extract-cover': '#ffb454',
  'mat-shield-res': '#6cb6ff',
  'mat-armor-res': '#cdd6e0',
  'mat-hull-res': '#ffb454',
  'mat-tracker': '#ffca58',
  'mat-gyro': '#7fc7ff',
  'mat-jammer': '#c792ea',
  'mat-rangefinder': '#a6f0ff',
  'mat-blindspot': '#8fd96b',
  'mat-ammo-dmg': '#ff8373',
  'mat-reload': '#ffc46b',
  /* B2 批： */
  'mat-volley': '#ffd166',
  'mat-ammo-back': '#ffb454',
  'mat-drone-net': '#7fc7ff',
  'mat-field-repair': '#8fd96b',
  miner: '#5ee6c8',
  cargo: '#ffd166',
  turret: '#ff8373',
  missile: '#ff9a6b',
  laser: '#c792ea',
  shield: '#6cb6ff',
  armor: '#cdd6e0',
  propulsion: '#ffb454',
  'drone-rack': '#ffc46b',
  'drone-tac': '#ffb454',
  'drone-relay': '#7fc7ff', // 2026-09-10 中继天线：通讯青（与导控黄/甲板橙区分）
  support: '#ff8ab5',
  cpu: '#7de3a8', // 2026-09-11 协处理器：算力青绿（与装配页导航同色系，且不与既有槽位色撞）
  salvager: '#6fe3f0', // 打捞器：与「打捞」同色
  'target-lock': '#ffca58', // 锁定装置：准星亮黄
  industrial: '#5ee6c8',
  armed: '#ff8373',
  armored: '#cdd6e0',
  hauler: '#ffd166',
  blueprint: '#d4a0ff',
  'group-舰船': '#6cb6ff',
  'group-工业': '#5ee6c8',
  'group-战斗': '#ff8373',
  'group-工程': '#ffd166',
  'group-贸易': '#ffb454',
}

/** 取色调（带兜底） */
export function toneOf(key: string | undefined): string {
  return (key && TONES[key]) || '#8aa0b8'
}

/**
 * **物品 → 图标键**（2026-09-13 F3c · 船长：「货仓内物品采用图标而不是纯文字，
 * 安全货仓和谜质的SVG图标也需要绘制」）。
 *
 * 规则（从具体到笼统）：
 * 1. **遗迹安全货柜**（`box-relic-*`）⇒ 共用 `box-relic` 造型，**颜色按族取**（色调表按物品 id 存）；
 * 1b. **图纸货柜**（`box-bp-*`）⇒ 共用 `box-bp` 造型（扁长条 = 2×1），**颜色按层档取**；
 * 1c. **AI 核心**（`ai-core-*`）⇒ 共用 `ai-core` 造型（载板 + 运算核心圆），**颜色按稀有度取**；
 * 2. **谜质装置**（`mat-*`）⇒ **每台一枚专属线稿**（键 = 物品 id）；
 * 3. 其余物品 ⇒ 沿用按 **大类**（`ItemDef.kind`）的既有图标（矿石/残骸/货柜/修理组件…）。
 *
 * 色调一律走 `toneOf(itemId)`：物品 id 优先，回落图标键（这样"同族不同色"与"同键同色"都成立）。
 */
export function itemIconOf(itemId: string, kind?: string): string {
  if (itemId.startsWith('box-relic-')) return 'box-relic'
  if (itemId.startsWith('box-bp-')) return 'box-bp'
  // 2026-09-15 两个新货柜各给一枚专属造型（贵重品柜 / 军用备货柜）——它们不带前缀族，故按 id 点名
  if (itemId === 'box-valuables' || itemId === 'box-military') return itemId
  if (itemId.startsWith('ai-core-')) return 'ai-core'
  if (itemId.startsWith('mat-')) return itemId
  return kind ?? 'fallback'
}

/** 物品图标色：**物品 id 优先**（安全货柜按族分色），再回落图标键 */
export function itemToneOf(itemId: string, iconKey: string): string {
  return TONES[itemId] ?? toneOf(iconKey)
}

/** 导航/标签图标专属色调（2026-09-05 船长：每个图标各自纯色，未选中也着色；选中态由按钮高亮区分） */
export const NAV_TONES: Record<string, string> = {
  'nav-map': '#ffe08a',
  'nav-ship': '#6cb6ff',
  'nav-fit': '#7de3a8',
  'nav-items': '#ffd166',
  'nav-market': '#ffa45c',
  'nav-industry': '#42d9b0',
  'nav-skills': '#c792ea',
  'nav-mail': '#9fd8ff',
  /* 官方章鱼人代表头像（2026-09-11 船长定）：与协会同色调，便于"官方 = 青白蓝章鱼"一眼认出 */
  'faction-octopus': '#9fd8ff',
  'nav-mine': '#b5e35f',
  'nav-bounty': '#ff8373',
  'nav-salvage': '#6fe3f0',
  'nav-haul': '#ffc46b',
  'nav-task': '#8fa9d8',
  'nav-ai': '#ff8ab5',
  'nav-shop': '#f7c35c',
  /* 虫洞（终局玩法）：**裂隙紫**（偏品红一档）——与「扫描」#b78bff、「技能」#c792ea 区分，
     活动栏里可能与「训练（技能紫）」并排，故不沿用紫罗兰本体色 */
  'nav-wormhole': '#b06bff',
}

/** 操作图标色调（与 NAV_TONES 同族语汇；默认跟随文本色） */
export const ICO_TONES: Record<string, string> = {
  // 虫洞敌族徽（丁 · 2026-09-14）：五族各一色，与族卡气质对齐
  'fam-a': '#ff9d6a',
  'fam-c': '#8ce07a',
  'fam-d': '#9fb7d6',
  'fam-e': '#c9a2ff',
  'fam-g': '#6fe3f0',
  'ico-home': '#ffd76a',
  'ico-lock': '#ff8373',
  'ico-clock': '#ffe08a',
  'ico-loop': '#6fe3f0',
  'ico-flag': '#ffca58',
  'ico-star': '#ffca58',
  'ico-scan': '#b78bff',
  'ico-swap': '#7de3a8',
  'ico-cross': '#ff8373',
  'ico-crane': '#ffd166',
  'ico-antenna': '#6fe3f0',
  'ico-tact': '#ff9a6b',
}

/** 渲染一个科幻线性图标 */
export function Glyph({
  name,
  size = 26,
  color,
  className,
}: {
  name: string
  size?: number
  color?: string
  className?: string
}) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke={color ?? 'currentColor'}
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {SHAPES[name] ?? SHAPES.fallback}
    </svg>
  )
}
