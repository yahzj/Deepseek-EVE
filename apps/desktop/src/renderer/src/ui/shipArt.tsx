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

export const SHIP_ART: Record<string, ReactNode> = {
  ...SHIP_ART_EXTRA,
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
  /* ── 灰鲭鲨级驱逐舰（低趴长身 + 脊炮 ×2 + 上下双引擎） ── */
  'sh-mako': (
    <g>
      <path d="M212 56 L168 41 L104 41 C76 41 60 45 50 51 L44 56 L50 61 C60 67 76 71 104 71 L156 71 Z" />
      <path d="M212 56 L226 52 L226 60 L212 56 Z" opacity=".75" />
      <path d="M104 41 L132 20 L142 20 L122 41" />
      <path d="M104 71 L132 92 L142 92 L122 71" />
      <path d="M54 44 h8 v24 h-8 z M62 44 h8 v24 h-8 z" opacity=".8" />
      <path d="M138 42 h12 v8 h-12 z" />
      <path d="M150 42 L176 42" strokeWidth="2.6" />
      <path className="shipart-acc" d="M176 42 L180 42" />
      <path d="M92 43 h10 v7 h-10 z" />
      <path d="M102 43 L122 44" strokeWidth="2.2" />
      <path d="M158 62 h8 v4 h-8 z M164 62 v7" />
      <path d="M112 63 h6 v4 h-6 z M116 63 v6" />
      <path className="shipart-panel" d="M146 47 h16 v7 h-16 z M148 48.5 h12 M148 52 h12" />
      <path className="shipart-panel" d="M80 48 h36 M80 64 h36 M126 44 v24 M104 55 h80" />
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
}

/** 敌舰族群形（键 = FOE_FAMILY 中的族字母；未录族 → 'F' 制式巡逻形兜底） */
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
  /* F 遭遇巡逻舰（制式规整 + 舷灯条；未列族兜底） */
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
  B: '#e0c864', // 靶机/拾荒：警告黄
  C: '#9fe6a4', // 异形生物：磷光绿（同 volt-g）
  D: '#9fd0f2', // 守墓古舰：磷光冰蓝（同 volt-i）
  E: '#d9b98c', // 泰坦巨构：残铁棕
  F: '#ffab5e', // 制式巡逻：琥珀灯条
  G: '#cd9fdd', // 烬火流亡：聚落紫
}

/** 悬赏卡 → 敌舰族群（22 张非 hidden 卡全表；缺省 F） */
export const FOE_FAMILY: Record<string, string> = {
  'ano-redring-raiders': 'A', // 赤潮
  'ano-shard-bandits': 'A', // 碎晶
  'ano-haze-ambush': 'A', // 灰霾
  'ano-mirage-hijackers': 'A', // 蜃影
  'ano-pirate-post': 'A', // 边境海盗
  'ano-lantern-saboteurs': 'A', // 信标猎手
  'ano-training': 'B', // 演习场靶机
  'ano-harbor-escort': 'B', // 新港护航
  'ano-abandoned-platform': 'B', // 占港拾荒
  'ano-chasm-aberrations': 'C', // 裂谷畸变
  'ano-starcore-boss': 'C', // 星髓
  'ano-maw-hunt': 'C', // 噬口
  'ano-abyss-guard': 'C', // 深渊之门
  'ano-gravekeeper': 'D', // 坟场
  'ano-voidedge-warden': 'D', // 虚海
  'ano-vault-sentinel': 'D', // 穹顶
  'ano-ghost-signal': 'D', // 幽灵舰
  'ano-titan-wreck': 'E', // 泰坦残骸
  'ano-auro-raiders': 'E', // 奥罗残骸
  'ano-cinder-siege': 'G', // 烬火
  'ano-echo-haunt': 'G', // 回音
  'ano-nadir-static': 'G', // 天底静区
}

export function foeFamilyOf(anomalyId: string | null | undefined): string {
  return (anomalyId ? FOE_FAMILY[anomalyId] : undefined) ?? 'F'
}
