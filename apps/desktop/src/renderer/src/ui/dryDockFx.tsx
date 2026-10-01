/**
 * **干船坞线稿**（**2026-10-01 船长令**：「造船厂的在建舰船，建议将扩大队列卡片的高度，将动画移动到卡片内的
 * 上方，并参考左上角 SVG 动画中的船坞，构建一个更大的船坞，舰船的 SVG 放在船坞中间（最好是建到一半的，
 * 少几根线条。）先照着这个做出一个效果」）。
 *
 * 三件事：
 * 1. **坞体语言照抄左上角那枚 `ico-drydock`**（`Glyphs.tsx`：坞台横梁 ＋ 两根坞壁立柱 ＋ 坞底托架），
 *    放大到 320×150 的舞台、补上坞壁斜撑与坞墩（同族细描边，`currentColor` ＋ `strokeWidth 1.6`）；
 * 2. **舰体放在坞正中**，按船长要的「**建到一半**」表现：主船体轮廓是实线（已成形的部分），
 *    上层建筑与内部骨架用**虚线**（正在装的部分），尾段的几根纵向线**故意缺席**——就是"少几根线条"；
 * 3. **动效只碰 `transform` / `opacity`**（约定 §十四）：龙门吊吊钩缓慢起落 ＋ 焊点闪烁；
 *    `prefers-reduced-motion` 与玩家「关特效」（`body.no-fx`）下全部停（口径同本目录其它动效）。
 *
 * ⚠ 纯展示件（`aria-hidden`），不参与交互；尺寸由外层 `.hud-dock-art` 定（固定高度 ⇒ 卡片不跳动）。
 */
export function DryDockFx(): JSX.Element {
  return (
    <svg
      viewBox="0 0 320 150"
      width="100%"
      height="100%"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {/* ── 坞体骨架（照 `ico-drydock` 的三件：横梁 · 两侧立柱 · 坞底托架）── */}
      <path d="M22 34 H298" />
      <path d="M34 34 V118 M286 34 V118" />
      {/* 坞壁斜撑（放大后补的结构感；同一套细描边） */}
      <path d="M34 62 H70 M250 62 H286 M34 90 H70 M250 90 H286" opacity="0.55" />
      <path d="M34 118 H70 M250 118 H286" opacity="0.55" />
      {/* 坞底 ＋ 坞墩（舰体坐在这上面） */}
      <path d="M16 118 H304" />
      <path d="M60 118 V126 M110 118 V126 M160 118 V126 M210 118 V126 M260 118 V126" opacity="0.5" />
      {/* ── 龙门吊（跨在坞上方）＋ 吊钩缆绳 ── */}
      <path d="M78 34 V22 H242 V34" />
      <path d="M78 22 L96 10 M242 22 L224 10" opacity="0.6" />
      <g className="hud-dock-hook">
        <path d="M160 22 V44" opacity="0.75" />
        <path d="M154 44 H166 L160 52 Z" />
      </g>
      {/* ── 半成品舰体（坞正中；船头朝右）──
          实线 = 已成形的船体轮廓；虚线 = 正在装的上层建筑与内部骨架；尾段少几根线 = 还没铺到那里 */}
      <g color="var(--hud-accent-soft)">
        {/* 主船体（实线轮廓） */}
        <path d="M92 84 H238 L268 96 L238 108 H92 Z" />
        {/* 内部骨架（虚线：正在铺） */}
        <path d="M108 84 V108 M132 84 V108 M156 84 V108" strokeDasharray="4 5" opacity="0.75" />
        {/* 上层建筑（虚线：正在装；尾段那两根梯段**故意缺**——船长要的"少几根线条"） */}
        <path d="M150 84 V66 H206 V84" strokeDasharray="5 6" opacity="0.85" />
        <path d="M178 66 V52" strokeDasharray="5 6" opacity="0.7" />
        {/* 舰首末端的合拢段（还没焊上 ⇒ 只有两道短线） */}
        <path d="M268 96 H282 M268 108 H282" opacity="0.45" />
      </g>
      {/* 焊点（两处，错相位闪）——只动 opacity */}
      <circle className="hud-dock-spark" cx="212" cy="70" r="2" />
      <circle className="hud-dock-spark is-late" cx="122" cy="96" r="1.7" />
      {/* 坞台作业灯（细长条，静态） */}
      <path d="M44 28 H60 M260 28 H276" opacity="0.7" />
    </svg>
  )
}
