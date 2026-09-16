/**
 * 舰船战斗图形资产（三号，2026-09-09 起）：每舰独立 SVG 矢量形（240×110 本地坐标，舰首朝右）。
 *
 * 风格契约（与 docs/design/ship-battle-art/README.md 一致）：
 * - 元素类（CSS 在 styles.css，.shipart-*）：无类 = 主轮廓（继承 currentColor 2.2 描边）；
 *   shipart-panel = 装甲面板线（1px/40%）；shipart-acc = 族色细线；shipart-accf = 族色实心点；
 *   shipart-volt = 能量青放电纹（电鳐/敌族发光件）；
 * - 引擎口在舰体左端（尾焰由 ShipSprite 统一绘制，锚点 ~x28 y55）；
 * - 数据逐舰补录中：已录 defId 走独立形；未录 defId 回退 role 旧形（组件内放大适配）。
 */
import type { ReactNode } from 'react'
import { FOE_ART_EXTRA, SHIP_ART_EXTRA } from './shipArtData'
import { SHIP_ART_WH } from './shipArtWh'

export const SHIP_ART: Record<string, ReactNode> = {
  ...SHIP_ART_EXTRA,
  ...SHIP_ART_WH,
  /* ── 鲣鱼级护卫舰（箭头机身 + 后掠双翼 + 机头炮） ── */
  'sh-falconet': (
    <g>
      <path d="M204 55 L150 38 L76 38 L44 46 L36 55 L44 64 L76 72 L150 72 Z" />
      <path d="M98 38 L122 21 L131 21 L108 38" />
      <path d="M98 72 L122 89 L131 89 L108 72" />
      <path className="shipart-panel" d="M104 38 L122 27 M104 72 L122 83" />
      <path d="M200 55 L224 58 L224 63 L200 66" />
      <path className="shipart-accf" d="M224 57.5 L230 60.5 L224 63.5 Z" />
      <path d="M42 50 h10 v10 h-10 z M42 52.5 h10 M42 57.5 h10" />
      <path className="shipart-panel" d="M160 49 h18 v8 h-18 z M164 50.5 v5 M170 50.5 v5 M176 50.5 v5" />
      <path className="shipart-panel" d="M92 44 h40 M92 66 h40 M150 46 v18" />
      <circle className="shipart-accf" cx="86" cy="55" r="1.4" />
    </g>
  ),
  /* ── 灰鲭鲨级驱逐舰（低趴长身 + 脊炮 ×2 + 上下双引擎 + 前掠翼；2026-09-09 方向可读性修正
        v3 定稿：舰艏单点流线锐锥 x236 + 尾端平切喷口面 + 前掠翼恢复(船长确认)——尖头平尾,
        方向一眼可辨） ── */
  'sh-mako': (
    <g>
      <path d="M236 56 L198 36 L118 36 C86 36 66 44 58 50 L52 50 L52 62 L58 66 C66 72 86 76 118 76 L190 76 Z" />
      <path d="M104 36 L132 15 L142 15 L122 36" />
      <path d="M104 76 L132 97 L142 97 L122 76" />
      <path d="M38 46 h12 v8 h-12 z M38 60 h12 v8 h-12 z" opacity=".85" />
      <path d="M138 42 h12 v8 h-12 z" />
      <path d="M150 42 L194 42" strokeWidth="2.6" />
      <path className="shipart-acc" d="M194 42 L200 42" />
      <path d="M92 43 h10 v7 h-10 z" />
      <path d="M102 43 L122 44" strokeWidth="2.2" />
      <path d="M158 62 h8 v4 h-8 z M164 62 v7" />
      <path d="M112 63 h6 v4 h-6 z M116 63 v6" />
      <path className="shipart-panel" d="M146 47 h16 v7 h-16 z M148 48.5 h12 M148 52 h12" />
      <path className="shipart-panel" d="M80 48 h36 M80 64 h36 M126 44 v24 M104 55 h76" />
      <circle className="shipart-accf" cx="98" cy="56" r="1.4" />
      <circle className="shipart-accf" cx="150" cy="66" r="1" />
    </g>
  ),
  /* ── 锤头鲨级炮击巡洋舰（粗壮舰体 + 锤头装甲首 + 三联主炮） ── */
  'sh-hammerhead': (
    <g>
      <path d="M206 58 L182 36 L128 30 L92 30 C70 33 56 42 50 52 L45 60 L50 70 C58 78 76 84 100 85 L160 85 L196 78 L212 66 Z" />
      <path d="M196 78 L214 62 L224 62 L206 86 Z" opacity=".85" />
      <path d="M214 62 L232 58 L232 66 L224 66 Z" />
      <path d="M164 30 h18 v14 h-18 z M148 30 h12 v11 h-12 z" />
      <path d="M150 26 L182 26" opacity=".8" />
      <path className="shipart-panel" d="M167 32 h12 M153 32 h6" />
      <path d="M196 50 h14 v10 h-14 z" />
      <path d="M210 51 L246 52" strokeWidth="2.8" />
      <path className="shipart-acc" d="M246 52 L252 52" strokeWidth="2" />
      <path d="M150 46 h12 v9 h-12 z" />
      <path d="M162 47 L196 48" strokeWidth="2.2" />
      <path d="M150 62 h12 v9 h-12 z" />
      <path d="M162 63 L196 64" strokeWidth="2.2" />
      <path d="M100 60 h8 v5 h-8 z M106 60 v8" />
      <path d="M70 58 h7 v4 h-7 z M75 58 v6" />
      <path className="shipart-panel" d="M96 34 v50 M128 32 v52 M62 44 v24" />
      <path className="shipart-panel" d="M104 84 L120 96 L138 96 L124 85 M158 84 L168 96" />
      <path d="M54 42 h8 v26 h-8 z M62 42 h8 v26 h-8 z" opacity=".85" />
      <circle className="shipart-accf" cx="140" cy="85" r="1.6" />
      <circle className="shipart-accf" cx="92" cy="40" r="1.2" />
    </g>
  ),
  /* ── 2026-09-16 补图批（船长：「新增的舰船没有SVG图形，按照之前的规则每艘需要单独的SVG图形」）：
        下面 3 艘是 2026-09-12「T4/T5 模子 + 鹦鹉螺」那批，此前一直回退 role 兜底剪影。
        虫洞族专属 15 艘在 `shipArtWh.tsx`（同批补）。 ── */

  /* 鹦鹉螺级测绘巡洋舰（T3 · 掠食者武装）—— 分段螺旋装甲环（鹦鹉螺壳意象）+ 测绘桅杆天线阵 + 舷侧扫描窗 */
  'sh-nautilus': (
    <g>
      <path d="M206 58 L180 38 L124 32 C96 32 68 38 52 48 L40 58 L48 68 C64 78 94 84 126 84 L178 82 L202 68 Z" />
      <path d="M206 58 L226 56 L226 62 L204 64 Z" opacity=".85" />
      <path className="shipart-panel" d="M40 58 C58 44 88 36 124 34 C152 33 176 40 190 52" />
      <path className="shipart-panel" d="M48 58 C66 46 92 40 124 38 C148 37 170 43 184 53" />
      <path d="M124 32 L124 16 L142 10" />
      <path className="shipart-acc" d="M124 20 h17" strokeWidth="2" />
      <path className="shipart-acc" d="M128 25 h11" strokeWidth="1.6" />
      <path className="shipart-accf" d="M142 10 L151 12 L142 16 Z" />
      <path className="shipart-panel" d="M96 46 h40 v18 h-40 z M101 50 h30 M101 56 h30 M101 62 h30" />
      <path className="shipart-panel" d="M96 70 h44 v8 h-44 z" />
      <path d="M74 52 h10 v5 h-10 z M74 62 h10 v5 h-10 z" />
      <path d="M40 46 h11 v10 h-11 z M40 62 h11 v10 h-11 z" opacity=".9" />
      <circle className="shipart-accf" cx="184" cy="68" r="1.5" />
      <circle className="shipart-accf" cx="102" cy="42" r="1.2" />
    </g>
  ),

  /* 巨齿鲨级战列舰（T4 · 掠食者武装）—— 厚重舰体 + 舰首巨齿獠牙（史前巨齿意象）+ 三联主炮 + 舷侧副炮列 */
  'sh-megalodon': (
    <g>
      <path d="M212 58 L190 34 L128 28 C96 28 66 34 48 44 L34 56 L44 70 C60 82 92 88 128 88 L184 86 L206 70 Z" />
      <path d="M212 58 L234 54 L234 62 L210 64 Z" />
      <path className="shipart-accf" d="M212 58 L197 50 L207 45 Z" />
      <path className="shipart-accf" d="M206 68 L189 71 L196 78 Z" />
      <path className="shipart-panel" d="M128 30 v56 M96 32 v54 M64 40 v36 M172 30 v54 M196 36 v46" />
      <path d="M150 40 h30 v16 h-30 z M155 44 h20 M155 51 h20" />
      <path d="M180 44 L206 42" strokeWidth="2.8" />
      <path className="shipart-acc" d="M206 42 L212 42" />
      <path d="M104 46 h11 v7 h-11 z M104 58 h11 v7 h-11 z M104 70 h11 v7 h-11 z" />
      <path d="M34 44 h12 v10 h-12 z M34 62 h12 v10 h-12 z" opacity=".9" />
      <circle className="shipart-accf" cx="176" cy="76" r="1.6" />
      <circle className="shipart-accf" cx="86" cy="82" r="1.3" />
    </g>
  ),

  /* 邓氏鱼级旗舰（T5 · 掠食者武装）—— 头部装甲盾板（邓氏鱼头盾意象）+ 极厚舰体 + 四联舷炮 + 双联主炮 */
  'sh-dunkleosteus': (
    <g>
      <path d="M216 58 L196 30 L132 22 C96 22 62 30 44 42 L28 56 L40 72 C58 86 94 92 132 92 L190 90 L212 72 Z" />
      <path d="M216 58 L236 54 L236 62 L214 64 Z" />
      <path d="M196 30 L206 22 L215 26 L208 37 Z" opacity=".9" />
      <path d="M196 86 L206 94 L215 90 L208 79 Z" opacity=".9" />
      <path className="shipart-panel" d="M132 24 v66 M96 26 v62 M62 36 v42 M176 24 v64 M198 32 v50" />
      <path d="M154 34 h34 v18 h-34 z M160 39 h22 M160 46 h22" />
      <path d="M188 38 L214 36" strokeWidth="3" />
      <path d="M188 48 L214 50" strokeWidth="3" />
      <path className="shipart-acc" d="M214 36 L221 36 M214 50 L221 50" strokeWidth="2" />
      <path d="M104 40 h12 v7 h-12 z M104 52 h12 v7 h-12 z M104 64 h12 v7 h-12 z M104 76 h12 v7 h-12 z" />
      <path d="M28 44 h13 v10 h-13 z M28 60 h13 v10 h-13 z" opacity=".9" />
      <circle className="shipart-accf" cx="180" cy="82" r="1.6" />
      <circle className="shipart-accf" cx="146" cy="84" r="1.4" />
      <circle className="shipart-accf" cx="70" cy="30" r="1.2" />
    </g>
  ),
}

/** 敌舰族群形（键 = FOE_FAMILY 中的族字母；未录族 → **A 形**兜底——2026-09-11 船长：F 族废弃并入 A 族，
 *  兜底点同步改指 A、仅作防崩；正常路径由「敌族显式登记契约」保证每张敌军卡都显式登记族） */
export const FOE_ART: Record<string, ReactNode> = {
  ...FOE_ART_EXTRA,
  /* A 海盗突击舰（粗短破旧 + 角旗 + 斜排劫掠炮） */
  A: (
    <g>
      <path d="M200 52 L206 56 L200 60 L192 66 L150 70 L86 70 C64 70 52 64 44 58 L38 53 L44 48 C52 42 66 40 92 40 L166 40 L188 44 Z" />
      <path d="M200 52 L216 54 L216 57 L200 60 Z" opacity=".8" />
      <path d="M150 40 L150 24 M150 24 L140 16" />
      <path className="shipart-accf" d="M150 24 L138 22 L150 17 Z" opacity=".85" />
      <path className="shipart-panel" d="M120 42 v26 M92 42 v26 M152 42 v24" />
      <path className="shipart-panel" d="M110 46 L132 66 M96 66 L118 44" strokeDasharray="4 3" />
      <path d="M96 58 h8 v4 h-8 z M104 58 l-2 -6" />
      <path d="M124 58 h8 v4 h-8 z M132 58 l-2 -6" />
      <path d="M152 58 h8 v4 h-8 z M160 58 l-2 -6" />
      <path d="M44 46 h10 v14 h-10 z M44 49 h10 M44 57 h10" />
      <path d="M186 56 L198 60 M186 60 L196 63" opacity=".8" />
      <circle className="shipart-accf" cx="176" cy="60" r="1.6" />
    </g>
  ),
  /* F 遭遇巡逻舰（制式规整 + 舷灯条）【已废弃·留档：2026-09-11 船长「废弃F族，将F族融合进A族」——
     'F' 字母位保留为空位，此形已无卡引用；保留仅为旧内容表/旧导出带 'F' 时仍可渲染，不再作为未录族兜底】 */
  F: (
    <g>
      <path d="M206 55 L180 40 L112 40 C92 40 76 45 66 51 L56 56 L62 64 C72 71 92 75 116 75 L168 73 Z" />
      <path className="shipart-acc" d="M92 55 h48" strokeWidth="2" />
      <path d="M150 40 h15 v9 h-15 z" />
      <path className="shipart-panel" d="M153 43 h9" />
      <path d="M206 52 L222 52 L222 56 L206 58 Z" />
      <path d="M104 60 h7 v4 h-7 z M111 60 v6" />
      <path d="M128 62 h6 v4 h-6 z M134 62 v5" />
      <path className="shipart-panel" d="M96 46 h40 M96 62 h40 M138 42 v28" />
      <path d="M62 44 h8 v13 h-8 z M62 61 h8 v13 h-8 z" opacity=".85" />
      <circle className="shipart-accf" cx="118" cy="78" r="1.3" />
    </g>
  ),
}

/** 敌族轮廓浊色（敌我区分用；继承 currentColor 的元素 = 主轮廓 / .shipart-acc / .shipart-accf；
 *  发光件 .shipart-volt-g/-i/.fill-g/-i 为资产内固定族色不随此表；主舰与僚机同族同色，
 *  靠体量(LAY.MAIN/ESC)与名称后缀区分） */
export const FOE_ACCENT: Record<string, string> = {
  A: '#ff6b52', // 海盗舰系：锈红（README §二 已定）
  B: '#e0c864', // 武装拾荒者：废料黄（拼装壳体的警示漆）
  C: '#9fe6a4', // 异形生物：磷光绿（同 volt-g）
  D: '#9fd0f2', // 守墓古舰：磷光冰蓝（同 volt-i）
  E: '#d9b98c', // 泰坦巨构：残铁棕
  F: '#ffab5e', // 制式巡逻【已废弃·留档：2026-09-11 并入 A 族，字母位空置】：琥珀灯条
  G: '#cd9fdd', // 鱿烬亡军：聚落紫
}

/**
 * 敌族形状/配色一律按**数据侧** `AnomalyDef.foeFamily` 推导（2026-09-11 船长定案）。
 *
 * 旧口径的隐患（本批修掉）：这里曾有一张 **22 行硬编码的 `FOE_FAMILY` 映射**（按 anomaly id 查），
 * 与数据侧 `foeFamily` 字段**各写各的**且无一致性校验——结果**演习场那张卡**在美术侧是 B、
 * 在数据侧为空（落进兜底形），两处真相源长期不一致。
 *
 * **兜底点（2026-09-11 船长改判）**：缺族兜底由 `'F'`（制式巡逻形）**改指 `'A'`（海盗形）**——
 * F 族废弃并入 A 族；本函数是**全仓唯一缺省点**，正常路径下由「敌族显式登记契约」（`content:check`）
 * 保证每张敌军卡都显式登记族，故此兜底**仅作防崩保护**。
 */
export function foeFamilyOf(anomaly: { foeFamily?: string } | null | undefined): string {
  return anomaly?.foeFamily ?? 'A'
}

/**
 * 敌族**短名**（2026-09-11 船长：「星图显示敌对派系时文字颜色按敌族划分、标签化展示」）——
 * 用于星图节点下方的族标签（位置窄，取 2 字短写；词典里的全称是
 * 「海盗舰系 / 异形生物 / 守墓古舰 / 泰坦巨构 / 鱿烬亡军」）。
 */
export const FOE_FAMILY_LABEL: Record<string, string> = {
  A: '海盗',
  B: '拾荒',
  C: '异形',
  D: '守墓',
  E: '巨构',
  F: '巡逻', // 已废弃·留档（F 族并入 A 族；仅防旧数据带 'F' 时无标签可显示）
  G: '鱿烬',
}
