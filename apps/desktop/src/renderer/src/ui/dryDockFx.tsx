/**
 * **干船坞线稿**（**2026-10-01 船长令**：「造船厂的在建舰船，建议将扩大队列卡片的高度，将动画移动到卡片内的
 * 上方，并参考左上角 SVG 动画中的船坞，构建一个更大的船坞，舰船的 SVG 放在船坞中间（最好是建到一半的，
 * 少几根线条。）先照着这个做出一个效果」）。
 *
 * ## 第二版（同日 · 船长复核「观感上，给人感觉像是一个房子的侧视图」）
 *
 * **病根**：第一版画的是「两侧竖直矩形墙 ＋ 平屋顶 ＋ 跨梁」——那套轮廓读起来就是**房子**。
 * 干船坞的形态特征恰好相反（据干船坞工程剖面资料与 EVE「大型舰船维护阵列」的观感归纳，
 * 形制参考见 `docs/design/hud-industry-filter-20261001.md`）：
 * 1. **坞室 = 下沉的 U 型凹槽**（不是地面上的 box）⇒ **地面线在坞口处断开**、坞体向地下挖进去；
 * 2. **坞壁厚重且带阶梯肩线**，不是薄墙；
 * 3. **船坐在坞墩上**（龙骨墩 ＋ 两列侧撑），**不贴墙、不落地**——"在船坞里"最强的一条视觉线索；
 * 4. 顶部**只有吊装设备**（龙门吊横梁 ＋ 吊钩），**没有屋顶**。
 *
 * ## 形状与非动效纪律
 *
 * - 形状一律 SVG 线稿（`currentColor` ＋ 细描边；§6）；CSS 只负责氛围光与动效；
 * - 动效只碰 `transform` / `opacity`（吊钩起落 ＋ 焊点闪烁），`prefers-reduced-motion` 与玩家
 *   「关特效」（`body.no-fx`）下全停（§十四）；
 * - **"建到一半"**：主船体轮廓实线（已成形的部分）· 上层建筑与内部骨架虚线（正在装的）·
 *   **尾段几根纵向线故意缺席**、舰首合拢段只留两道短线（船长要的"少几根线条"）。
 *
 * ⚠ 纯展示件（`aria-hidden`），不参与交互；高度由外层 `.hud-dock-art` 定死 ⇒ 卡片不跳动。
 */
export function DryDockFx(): JSX.Element {
  return (
    <svg
      viewBox="0 0 360 170"
      width="100%"
      height="100%"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {/* ── 地面线：坞口处**断开**（坞是挖下去的，不是盖起来的）── */}
      <path d="M4 58 H92 M268 58 H356" opacity="0.5" />
      <path d="M4 62 H92 M268 62 H356" opacity="0.28" />

      {/* ── 坞室：下沉的 U 型凹槽（外壁 ＋ 内部阶梯肩线 ＋ 底板）── */}
      <path d="M92 58 V152 H268 V58" />
      <path d="M103 68 V142 H257 V68" opacity="0.75" />
      <path d="M114 78 H134 M226 78 H246" opacity="0.5" />
      <path d="M114 122 H134 M226 122 H246" opacity="0.5" />
      <path d="M120 147 H240" opacity="0.35" />

      {/* ── 坞墩：龙骨墩（船坐在它上面 ⇒ 悬空感）＋ 两列侧撑 ── */}
      <path d="M120 142 H240" />
      <path d="M124 142 L128 134 H236 L240 142" opacity="0.9" />
      <path d="M150 134 V128 H176 V134 M198 134 V128 H224 V134" opacity="0.7" />
      <path d="M132 122 L152 108 M228 122 L208 108" opacity="0.55" />

      {/* ── 坞门端（右端）＋ 门机轨道（竖排三道；**没有屋顶**）── */}
      <path d="M268 58 V152" opacity="0.85" />
      <path d="M280 70 H296 M280 96 H296 M280 122 H296" opacity="0.4" />

      {/* ── 吊装设备：龙门吊横梁（两端落在坞壁外侧的立柱上）＋ 吊钩 ── */}
      <path d="M86 34 H292" />
      <path d="M86 34 V58 M292 34 V58" />
      <path d="M86 34 L104 20 M292 34 L274 20" opacity="0.5" />
      <g className="hud-dock-hook">
        <path d="M189 34 V52" opacity="0.7" />
        <path d="M183 52 H195 L189 60 Z" />
      </g>

      {/* ── 半成品舰体（坞正中；龙骨落在坞墩顶面 y=134；船头朝右）── */}
      <g color="var(--hud-accent-soft)">
        {/* 主船体：已成形的部分 —— 实线轮廓 */}
        <path d="M128 106 H248 L276 120 L248 134 H128 Z" />
        {/* 内部骨架：正在铺 —— 虚线 */}
        <path d="M146 106 V134 M168 106 V134 M190 106 V134" strokeDasharray="4 5" opacity="0.75" />
        {/* 上层建筑：正在装 —— 虚线；**尾段那两根梯段故意缺**（"少几根线条"） */}
        <path d="M162 106 V88 H222 V106" strokeDasharray="5 6" opacity="0.85" />
        <path d="M192 88 V72" strokeDasharray="5 6" opacity="0.7" />
        {/* 舰首合拢段：还没焊上 ⇒ 只有两道短线 */}
        <path d="M276 120 H290 M276 134 H290" opacity="0.45" />
      </g>

      {/* 焊点（两处，错相位闪；只动 opacity） */}
      <circle className="hud-dock-spark" cx="230" cy="92" r="2" />
      <circle className="hud-dock-spark is-late" cx="152" cy="120" r="1.7" />
      {/* 坞壁作业灯（静态细条） */}
      <path d="M96 64 H108 M252 64 H264" opacity="0.6" />
    </svg>
  )
}
