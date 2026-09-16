/**
 * 舰船战斗图形资产 · 虫洞族专属 15 艘（三号 2026-09-16 补图批）。
 *
 * 背景：2026-09-13「洞内专属舰船 15 艘」上线时**没有配独立图形** ⇒ 这 15 艘在舰队卡 /
 * 舰船仓库 / 战斗画面一律回退 `ShipSprite` 的 role 兜底剪影（140×64 旧形）。船长 2026-09-16：
 * 「**新增的舰船没有SVG图形，按照之前的规则每艘需要单独的SVG图形**」。
 *
 * 规格与语言 = 沿用 `docs/design/ship-battle-art/README.md`（2026-09-09 船长定）：
 * - 画布 **240×110** 本地坐标、**舰首一律朝右**（翻转由渲染层整体镜像）；
 * - 无类元素 = 主轮廓（继承 currentColor / strokeWidth 2.2 / fill none）；
 *   `shipart-panel` = 装甲面板线（1px · 40%）· `shipart-acc` = 族色细线 · `shipart-accf` = 族色实心点；
 * - **族血统**（同 README §三 敌族分型表的造型关键词，这 15 艘就是那五族的舰）：
 *   A 掠袭 = 粗短破旧 + 角旗天线 + 斜排劫掠炮 · C 巢群 = 有机曲线 + 发光裂隙 + 非对称肢节（固定磷光绿）
 *   D 陵墓 = 残破古典舰体 + 长舰首 + 冷青磷光 · E 巨构 = 厚重装甲层 + 断裂截面
 *   G 亡军 = 蜂窝舱段 + 补丁帆 + 吊臂；
 * - **同族三档 = 体量阶梯**：护卫舰（T1）短、驱逐舰（T2）长、巡洋舰（T3）宽厚；
 *   轮廓族型一致、个体差异在舰桥/炮位/舱段（README §五「家族感 + 个体特征」）。
 *
 * ⚠ 发光件用**固定族色**类（`shipart-volt-g`/`-fill-g` 磷光绿、`shipart-volt-i`/`-fill-i` 冷青）——
 * 与敌族形同款：玩家舰的主色随 role（armed 暖红 / armored 银灰），族色只由这些类表达。
 * ⚠ 每艘的引擎喷口 / 真实炮口坐标**同步登记**在 `shipMounts.ts`（漏登记 ⇒ 尾焰回落单焰、
 * 开火锚回落舰艏）；`content:check` 的「舰船图形契约」按 `ships.ts` 全表逐艘核这两张表。
 */
import type { ReactNode } from 'react'

export const SHIP_ART_WH: Record<string, ReactNode> = {
  /* ══════════════════ A 族 · 掠袭（海盗血统） ══════════════════
     造型关键词：粗短破旧壳体 + 角旗天线 + 斜排劫掠炮 + 外挂舱段 */

  /* 掠袭电子舰（T1 · 护卫舰）—— 短壳体 + 舰桥电子天线阵 + 两门斜排炮 */
  'sh-wh-a-frigate': (
    <g>
      <path d="M194 56 L170 42 L118 40 C94 40 74 44 62 50 L52 55 L60 62 C72 70 94 74 120 74 L168 72 Z" />
      <path d="M148 40 L148 22 M148 22 L136 14" />
      <path className="shipart-accf" d="M148 22 L134 19 L148 13 Z" opacity=".85" />
      <path d="M188 58 L200 62 M188 62 L198 65" opacity=".8" />
      <path className="shipart-panel" d="M118 42 v30 M94 44 v28 M146 42 v28" />
      <path className="shipart-panel" d="M160 46 h15 v9 h-15 z M162 48.5 h11 M162 52.5 h11" />
      <path className="shipart-acc" d="M175 50.5 h13" strokeWidth="2" />
      <path d="M112 52 h9 v5 h-9 z M121 52 l-2 -6" />
      <path d="M134 63 h9 v5 h-9 z M143 63 l-2 -6" />
      <path d="M52 47 h10 v16 h-10 z M52 50 h10 M52 60 h10" />
      <circle className="shipart-accf" cx="172" cy="43" r="1.5" />
    </g>
  ),

  /* 掠袭炮艇（T2 · 驱逐舰）—— 加长壳体 + 三联长管动能炮（射程加成）+ 双喷口 */
  'sh-wh-a-destroyer': (
    <g>
      <path d="M214 56 L186 40 L120 38 C92 38 70 43 58 50 L48 55 L56 63 C70 71 94 76 122 76 L182 74 L206 64 Z" />
      <path d="M150 38 L150 20 M150 20 L138 12" />
      <path className="shipart-accf" d="M150 20 L136 17 L150 11 Z" opacity=".85" />
      <path className="shipart-panel" d="M120 40 v34 M92 42 v32 M60 47 v16 M172 40 v34" />
      <path d="M104 48 h10 v6 h-10 z" />
      <path d="M114 48 L146 47" strokeWidth="2.6" />
      <path d="M104 58 h10 v6 h-10 z" />
      <path d="M114 58 L146 59" strokeWidth="2.6" />
      <path d="M104 68 h10 v6 h-10 z" />
      <path d="M114 68 L146 67" strokeWidth="2.6" />
      <path className="shipart-acc" d="M146 47 L152 47 M146 59 L152 59 M146 67 L152 67" />
      <path className="shipart-panel" d="M162 44 h20 v11 h-20 z M165 47 h14 M165 52 h14" />
      <path d="M188 66 L204 70 M188 70 L202 73" opacity=".8" />
      <path d="M48 45 h11 v9 h-11 z M48 59 h11 v9 h-11 z" opacity=".9" />
      <circle className="shipart-accf" cx="172" cy="60" r="1.5" />
    </g>
  ),

  /* 掠袭重型突击巡洋舰（T3 · 巡洋舰）—— 宽厚装甲壳 + 两侧外挂舱段 + 三联斜排炮 + 装甲裙板 */
  'sh-wh-a-cruiser': (
    <g>
      <path d="M208 58 L182 34 L124 30 C92 30 66 36 52 46 L42 56 L50 68 C64 78 90 84 122 84 L176 82 L200 70 Z" />
      <path d="M182 34 L206 30 L206 40 L186 42 Z" opacity=".85" />
      <path d="M152 30 L152 14 M152 14 L140 6" />
      <path className="shipart-accf" d="M152 14 L138 11 L152 5 Z" opacity=".85" />
      <path className="shipart-panel" d="M124 32 v48 M96 34 v46 M64 42 v28 M170 34 v46" />
      <path d="M78 60 h12 v26 h-12 z M78 64 h12 M78 78 h12" opacity=".85" />
      <path d="M164 44 h22 v12 h-22 z M167 47 h16 M167 52 h16" />
      <path d="M100 44 h11 v6 h-11 z" />
      <path d="M111 44 L146 43" strokeWidth="2.8" />
      <path d="M100 56 h11 v6 h-11 z" />
      <path d="M111 56 L146 57" strokeWidth="2.8" />
      <path d="M100 68 h11 v6 h-11 z" />
      <path d="M111 68 L146 67" strokeWidth="2.8" />
      <path className="shipart-acc" d="M146 43 L153 43 M146 57 L153 57 M146 67 L153 67" strokeWidth="2" />
      <path d="M196 66 L210 72 M194 72 L206 77" opacity=".8" />
      <path d="M42 44 h12 v10 h-12 z M42 60 h12 v10 h-12 z" opacity=".9" />
      <circle className="shipart-accf" cx="176" cy="62" r="1.6" />
      <circle className="shipart-accf" cx="86" cy="52" r="1.2" />
    </g>
  ),

  /* ══════════════════ C 族 · 巢群（异形血统） ══════════════════
     造型关键词：有机曲线 + 发光裂隙 + 非对称肢节（无独立喷口 ⇒ 挂点 engines 为空、不画尾焰） */

  /* 幼虫截击舰（T1 · 护卫舰）—— 细长幼虫体 + 前伸颚肢 + 背脊发光裂隙 */
  'sh-wh-c-frigate': (
    <g>
      <path d="M198 54 C186 40 160 34 132 34 C104 34 82 40 68 48 C58 54 54 58 56 60 C60 66 78 72 106 74 C138 76 168 70 186 62 C194 58 200 58 198 54 Z" />
      <path d="M198 54 L214 50 L216 55 L198 58 Z" />
      <path d="M132 34 L142 22 L150 24 L140 34" />
      <path d="M106 74 L98 88 L92 86 L100 72" />
      <path className="shipart-panel" d="M120 36 v38 M156 34 v34 M92 42 v28 M176 40 v26" />
      <path className="shipart-volt-g" d="M112 40 C126 46 132 58 124 70 M158 38 C170 46 172 56 164 66" />
      <path className="shipart-volt-g" d="M88 50 C96 52 100 56 100 60" />
      <path className="shipart-fill-g" d="M134 26 L140 34 L128 32 Z" />
      <path className="shipart-fill-g" d="M96 84 L100 74 L106 82 Z" />
      <circle className="shipart-fill-g" cx="148" cy="52" r="2" />
    </g>
  ),

  /* 甲壳截击舰（T2 · 驱逐舰）—— 分节甲壳 + 双颚肢 + 发光脉络 + 侧肢节 */
  'sh-wh-c-destroyer': (
    <g>
      <path d="M212 56 C200 38 172 28 138 28 C104 28 76 36 60 46 C48 53 44 58 48 62 C56 70 82 78 116 80 C152 82 186 74 204 64 C212 60 216 60 212 56 Z" />
      <path d="M212 56 L232 52 L234 58 L212 61 Z" />
      <path d="M138 28 L150 14 L160 17 L146 28" />
      <path d="M116 80 L106 96 L96 93 L108 78" />
      <path d="M96 44 C84 40 76 42 70 48" />
      <path className="shipart-panel" d="M124 30 v48 M156 28 v48 M186 32 v42 M84 40 v36 M62 46 v22" />
      <path className="shipart-volt-g" d="M108 36 C124 44 130 60 120 76 M164 32 C180 42 184 56 174 70" />
      <path className="shipart-volt-g" d="M76 46 C86 50 90 56 88 62" />
      <path className="shipart-fill-g" d="M142 18 L150 28 L136 26 Z" />
      <path className="shipart-fill-g" d="M104 92 L108 78 L114 90 Z" />
      <circle className="shipart-fill-g" cx="196" cy="60" r="2" />
      <circle className="shipart-fill-g" cx="86" cy="66" r="1.6" />
    </g>
  ),

  /* 巢群重型突击巡洋舰（T3 · 巡洋舰）—— 厚甲壳 + 背脊棘刺 + 两侧巢室 + 密集发光裂隙 */
  'sh-wh-c-cruiser': (
    <g>
      <path d="M216 58 C204 34 172 22 134 22 C96 22 64 32 48 46 C36 56 34 62 42 68 C54 78 86 88 124 88 C162 88 196 78 210 66 C218 62 220 62 216 58 Z" />
      <path d="M216 58 L236 54 L236 62 L214 63 Z" />
      <path d="M134 22 L146 6 L160 10 L144 23" />
      <path d="M100 26 L104 12 L112 14 L108 26" />
      <path d="M52 46 C40 42 32 46 28 54" />
      <path className="shipart-panel" d="M120 24 v62 M156 22 v64 M188 28 v54 M84 36 v52 M58 48 v30" />
      <path d="M74 52 h16 v34 h-16 z M74 58 h16 M74 72 h16" opacity=".8" />
      <path d="M168 44 h24 v14 h-24 z M172 48 h16 M172 53 h16" />
      <path className="shipart-volt-g" d="M104 30 C122 42 128 62 116 84 M166 26 C186 40 190 60 178 78" />
      <path className="shipart-volt-g" d="M68 44 C80 50 84 58 82 66 M206 50 C214 52 218 56 218 60" />
      <path className="shipart-fill-g" d="M138 10 L146 22 L130 20 Z" />
      <path className="shipart-fill-g" d="M104 18 L108 26 L98 25 Z" />
      <circle className="shipart-fill-g" cx="196" cy="68" r="2.2" />
      <circle className="shipart-fill-g" cx="80" cy="70" r="1.8" />
    </g>
  ),

  /* ══════════════════ D 族 · 陵墓（守墓古舰血统） ══════════════════
     造型关键词：残破古典舰体 + 长舰首 + 冷青磷光（固定族色 volt-i / fill-i） */

  /* 哨戒电子舰（T1 · 护卫舰）—— 长舰首 + 哨戒桅杆 + 扫描环 */
  'sh-wh-d-frigate': (
    <g>
      <path d="M200 58 L176 46 L120 44 C96 44 74 47 60 52 L48 56 L58 62 C72 68 94 72 120 72 L170 70 L192 64 Z" />
      <path d="M200 58 L216 56 L218 60 L200 62 Z" opacity=".85" />
      <path d="M148 44 L148 26 M148 26 L136 18" />
      <path className="shipart-panel" d="M120 46 v26 M96 47 v25 M146 46 v24 M64 52 v14" />
      <path className="shipart-volt-i" d="M134 20 C144 20 150 26 150 32 C150 38 144 42 136 42" />
      <path className="shipart-volt-i" d="M156 38 C168 38 174 44 174 50" />
      <path d="M160 48 h16 v10 h-16 z M163 51 h10 M163 55 h10" />
      <path d="M48 50 h10 v14 h-10 z M48 53 h10 M48 61 h10" />
      <path className="shipart-fill-i" cx="148" cy="14" r="2" />
      <circle className="shipart-accf" cx="192" cy="60" r="1.5" />
    </g>
  ),

  /* 陵卫指挥舰（T2 · 驱逐舰）—— 指挥塔 + 侧舷炮列 + 长舰首 + 磷光舷带 */
  'sh-wh-d-destroyer': (
    <g>
      <path d="M216 58 L190 42 L124 38 C96 38 70 43 54 50 L42 56 L52 64 C68 72 94 76 124 76 L184 74 L208 66 Z" />
      <path d="M216 58 L234 55 L234 60 L216 62 Z" opacity=".85" />
      <path d="M148 38 L148 20 L136 12 L136 20" />
      <path className="shipart-panel" d="M124 40 v34 M94 41 v33 M58 48 v18 M176 40 v32 M200 44 v22" />
      <path d="M140 42 h24 v12 h-24 z M144 45 h16 M144 50 h16" />
      <path d="M96 48 h10 v5 h-10 z M96 58 h10 v5 h-10 z M96 68 h10 v5 h-10 z" />
      <path className="shipart-volt-i" d="M60 56 h150" strokeWidth="1.2" />
      <path className="shipart-volt-i" d="M124 16 C138 16 146 22 146 30" />
      <path d="M42 48 h11 v16 h-11 z M42 52 h11 M42 60 h11" />
      <path className="shipart-fill-i" cx="196" cy="52" r="2" />
      <circle className="shipart-accf" cx="112" cy="60" r="1.4" />
    </g>
  ),

  /* 陵寝巡洋舰（T3 · 巡洋舰）—— 宽体 + 多炮塔（炮位最多）+ 盾发生环 + 长舰首 */
  'sh-wh-d-cruiser': (
    <g>
      <path d="M212 58 L186 36 L126 30 C94 30 66 37 50 47 L38 57 L48 69 C64 79 92 84 126 84 L180 82 L204 70 Z" />
      <path d="M212 58 L232 54 L232 61 L210 63 Z" opacity=".85" />
      <path d="M126 30 L126 12 L140 6" />
      <path className="shipart-panel" d="M126 32 v50 M96 34 v48 M62 44 v30 M166 32 v50 M192 38 v40" />
      <path d="M146 40 h28 v14 h-28 z M150 44 h20 M150 50 h20" />
      <path d="M104 42 h11 v6 h-11 z M104 52 h11 v6 h-11 z M104 62 h11 v6 h-11 z" />
      <path d="M170 56 h14 v8 h-14 z M170 68 h14 v8 h-14 z" />
      <path className="shipart-volt-i" d="M52 57 C92 44 140 44 186 54" />
      <path className="shipart-volt-i" d="M120 14 C138 14 148 22 148 32" />
      <path d="M38 46 h12 v10 h-12 z M38 62 h12 v10 h-12 z" opacity=".9" />
      <path className="shipart-fill-i" cx="188" cy="46" r="2.2" />
      <circle className="shipart-accf" cx="86" cy="72" r="1.4" />
      <circle className="shipart-accf" cx="196" cy="74" r="1.4" />
    </g>
  ),

  /* ══════════════════ E 族 · 巨构（泰坦残骸血统） ══════════════════
     造型关键词：厚重装甲层 + 断裂截面 + 外露桁架 */

  /* 构件鱼雷舰（T1 · 护卫舰）—— 拼装构件块 + 双鱼雷发射管 + 断裂截面 */
  'sh-wh-e-frigate': (
    <g>
      <path d="M186 60 L162 46 L116 46 C96 46 78 50 68 55 L60 59 L68 64 C80 70 98 74 118 74 L158 72 L178 64 Z" />
      <path d="M186 60 L204 60 L204 66 L182 66 Z" opacity=".85" />
      <path d="M116 46 L104 40 L88 44 L88 52 L104 54" />
      <path className="shipart-panel" d="M116 48 v24 M96 49 v23 M148 48 v22 M70 55 v10" />
      <path d="M126 50 h10 v5 h-10 z M136 50 L168 49" strokeWidth="2.4" />
      <path d="M126 60 h10 v5 h-10 z M136 60 L168 61" strokeWidth="2.4" />
      <path className="shipart-acc" d="M168 49 L174 49 M168 61 L174 61" />
      <path className="shipart-panel" d="M136 66 h22 v7 h-22 z" strokeDasharray="4 3" />
      <path d="M60 52 h10 v15 h-10 z M60 55 h10 M60 62 h10" />
      <circle className="shipart-accf" cx="150" cy="70" r="1.5" />
    </g>
  ),

  /* 机库无人机作战舰（T2 · 驱逐舰）—— 机库舱段 + 放飞口 + 骨架桁架 */
  'sh-wh-e-destroyer': (
    <g>
      <path d="M204 60 L178 42 L120 42 C94 42 72 47 58 54 L48 60 L58 67 C74 74 98 78 122 78 L172 76 L196 66 Z" />
      <path d="M204 60 L222 59 L222 65 L202 66 Z" opacity=".85" />
      <path d="M120 42 L120 28 L136 24 L136 42" />
      <path className="shipart-panel" d="M120 44 v32 M92 45 v31 M60 54 v12 M158 44 v30 M182 46 v28" />
      <path className="shipart-panel" d="M98 50 h46 v18 h-46 z M104 54 h34 M104 60 h34 M110 50 v18 M126 50 v18 M142 50 v18" />
      <path className="shipart-acc" d="M144 59 h16" strokeWidth="2" />
      <path d="M168 52 h18 v12 h-18 z M171 55 h12" />
      <path d="M48 52 h11 v16 h-11 z M48 56 h11 M48 64 h11" />
      <path className="shipart-fill-g" d="M150 57 L158 59 L150 62 Z" />
      <circle className="shipart-accf" cx="86" cy="72" r="1.5" />
    </g>
  ),

  /* 巨构无人机作战舰（T3 · 巡洋舰）—— 大机库 + 多层甲板 + 外露桁架 + 断裂截面 */
  'sh-wh-e-carrier': (
    <g>
      <path d="M214 60 L188 34 L126 30 C96 30 68 36 52 46 L40 58 L50 70 C66 80 96 86 128 86 L182 84 L206 70 Z" />
      <path d="M214 60 L234 58 L234 65 L212 67 Z" opacity=".85" />
      <path d="M126 30 L112 22 L92 26 L92 38 L112 40" />
      <path d="M52 46 L38 40 L24 44 L24 56 L38 60" opacity=".9" />
      <path className="shipart-panel" d="M126 32 v52 M96 34 v50 M64 44 v32 M170 32 v50 M196 38 v42" />
      <path className="shipart-panel" d="M100 42 h56 v14 h-56 z M106 46 h44 M106 51 h44 M114 42 v14 M130 42 v14 M146 42 v14" />
      <path className="shipart-panel" d="M100 62 h56 v12 h-56 z M106 66 h44 M106 71 h44" />
      <path className="shipart-acc" d="M156 49 h20 M156 68 h20" strokeWidth="2" />
      <path d="M180 44 h18 v12 h-18 z M183 47 h12" />
      <path className="shipart-fill-g" d="M162 47 L170 49 L162 52 Z M162 66 L170 68 L162 71 Z" />
      <circle className="shipart-accf" cx="86" cy="80" r="1.5" />
      <circle className="shipart-accf" cx="196" cy="78" r="1.4" />
    </g>
  ),

  /* ══════════════════ G 族 · 亡军（流亡舰队血统） ══════════════════
     造型关键词：蜂窝舱段 + 补丁帆 + 吊臂 */

  /* 幽影侦察舰（T1 · 护卫舰）—— 细长身 + 蜂窝舱段 + 探针天线阵 */
  'sh-wh-g-frigate': (
    <g>
      <path d="M202 56 L180 44 L124 42 C100 42 78 46 64 52 L52 57 L62 63 C76 69 98 73 124 73 L174 71 L196 62 Z" />
      <path d="M202 56 L220 54 L222 59 L202 61 Z" opacity=".85" />
      <path className="shipart-panel" d="M124 44 v27 M98 45 v26 M66 52 v14 M164 44 v26" />
      <path className="shipart-panel" d="M136 48 h18 v14 h-18 z M136 53 h18 M145 48 v14" />
      <path d="M154 55 L188 55 M170 55 L170 44" opacity=".85" />
      <path d="M118 42 L118 26 M118 26 L108 18" />
      <path className="shipart-volt" d="M108 18 L102 12 M108 18 L104 24" strokeWidth="1.2" />
      <path d="M52 50 h10 v15 h-10 z M52 53 h10 M52 61 h10" />
      <circle className="shipart-accf" cx="188" cy="51" r="1.5" />
    </g>
  ),

  /* 亡军后勤舰（T2 · 驱逐舰）—— 蜂窝货舱模块 + 补丁帆 + 吊臂 */
  'sh-wh-g-destroyer': (
    <g>
      <path d="M210 58 L186 42 L120 40 C94 40 70 45 56 52 L44 58 L54 66 C70 73 96 77 122 77 L180 75 L202 65 Z" />
      <path d="M210 58 L228 57 L228 63 L208 64 Z" opacity=".85" />
      <path className="shipart-panel" d="M120 42 v33 M92 43 v32 M58 52 v14 M176 42 v31" />
      <path className="shipart-panel" d="M96 48 h52 v18 h-52 z M96 54 h52 M96 60 h52 M109 48 v18 M122 48 v18 M135 48 v18" />
      <path className="shipart-acc" d="M148 57 h18" strokeWidth="2" />
      <path d="M120 40 L120 22 L146 16 L146 40" />
      <path className="shipart-panel" d="M120 26 L146 20" strokeDasharray="5 3" />
      <path d="M74 46 L74 30 M74 30 L90 26" />
      <path d="M44 50 h11 v16 h-11 z M44 54 h11 M44 62 h11" />
      <circle className="shipart-accf" cx="188" cy="52" r="1.5" />
      <circle className="shipart-accf" cx="80" cy="34" r="1.2" />
    </g>
  ),

  /* 亡军鱼雷舰（T3 · 巡洋舰）—— 蜂窝舱段 + 三管鱼雷发射器 + 补丁帆 */
  'sh-wh-g-cruiser': (
    <g>
      <path d="M214 58 L188 36 L124 32 C96 32 68 38 52 48 L40 58 L50 69 C66 78 96 83 126 83 L180 81 L206 68 Z" />
      <path d="M214 58 L234 56 L234 63 L212 64 Z" opacity=".85" />
      <path className="shipart-panel" d="M124 34 v48 M94 36 v46 M62 46 v30 M172 34 v47 M198 40 v38" />
      <path className="shipart-panel" d="M96 42 h48 v14 h-48 z M96 48 h48 M112 42 v14 M128 42 v14" />
      <path d="M148 46 h12 v6 h-12 z M160 46 L196 45" strokeWidth="2.4" />
      <path d="M148 56 h12 v6 h-12 z M160 56 L196 57" strokeWidth="2.4" />
      <path d="M148 66 h12 v6 h-12 z M160 66 L196 65" strokeWidth="2.4" />
      <path className="shipart-acc" d="M196 45 L202 45 M196 57 L202 57 M196 65 L202 65" />
      <path d="M124 32 L124 16 L152 10 L152 32" />
      <path className="shipart-panel" d="M124 22 L152 16" strokeDasharray="5 3" />
      <path d="M40 46 h12 v10 h-12 z M40 62 h12 v10 h-12 z" opacity=".9" />
      <circle className="shipart-accf" cx="182" cy="70" r="1.5" />
    </g>
  ),
}
