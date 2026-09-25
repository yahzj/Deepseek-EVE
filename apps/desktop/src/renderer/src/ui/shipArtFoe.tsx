/**
 * **敌舰逐舰线稿（30 条）** —— 2026-09-26 船长裁定「乙案：旧版敌人按敌舰不同逐一手绘」。
 *
 * 背景：改前敌舰取形**只到族**（`FOE_ART` 键 = 族字母 A~H），于是 A 族 5 条卡画同一张图、
 * C 族 5 条（幼虫/成虫/孢群/噬口）也画同一张图，族内毫无差异。本文件给出**一条舰一张图**。
 *
 * **画布口径**（与既有敌舰资产一致，未新立）：240×110，舰艏朝右，翻转由渲染层整体镜像；
 * 船体纵带 `y36~96`，高耸件（塔/桅）可上探但**塔尖留 4px**；主轮廓不写类（继承 currentColor +
 * 渲染层 2.2 线宽），面板线 `.shipart-panel`，族色点缀 `.shipart-acc` / `.shipart-accf`。
 * **尾焰不画在资产里**——渲染层按 `ui/shipMounts.ts` 的 `engines` 挂点自动挂。
 *
 * ⚠ **改形必须同步改挂点**：`shipMounts.ts` 的 `FOE_SHIP_MOUNTS` 逐条注明坐标取自本文件哪条路径端点；
 * 路径端点与挂点坐标对不上就是 bug。
 *
 * ⚠ 观感审查权在船长（约定 §九）：本文件是**形状与差异**的载体，好不好看由船长判。
 * 逐舰形象要点见工作文档 `docs/design/foe-ship-art-20260926.md` §三。
 */
import type { ReactNode } from 'react'

// ───────────────────────── 画法基元 ─────────────────────────
// 说明：只把「推进器 / 炮座 / 方框 / 舰桥塔」四类重复件做成函数，**舰体轮廓一律逐舰手写**——
// 轮廓才是各舰的辨识特征，若也参数化，30 条会退化成同一张图的缩放（正是本批要修的毛病）。

type Pt = [number, number]

/** 折线：点列 → `M… L…`（每段 ≥2 点；`Pt` 会被规范成坐标对） */
function line(...pts: Pt[]): string {
  return `M${pts.map(([x, y]) => `${x} ${y}`).join(' L')}`
}
/** 闭合多边形（首点自动回环） */
function poly(...pts: Pt[]): string {
  return `${line(...pts)} Z`
}
/** 把若干子路径串成一条 path：可传点列（折线）、单个点（接着上一点连）、或 `Z` 这类单指令字符串 */
function s(...parts: (string | Pt | Pt[])[]): string {
  return parts.reduce<string>((acc, it) => {
    if (typeof it === 'string') return acc ? `${acc} ${it}` : it
    const pts: Pt[] = typeof it[0] === 'number' ? [it as Pt] : (it as Pt[])
    const seg = pts.length >= 2 ? line(...pts) : ''
    if (!seg) return acc
    return acc ? `${acc} ${seg}` : seg
  }, '')
}

/** 推进器喷口：矩形管 + 尾缘两条短线；`engines` 挂点取矩形**左缘中点** */
function nozzle(x: number, y: number, w: number, h: number): string {
  return s(poly([x, y], [x + w, y], [x + w, y + h], [x, y + h]), [[x + 1, y + 1], [x + 1, y + h - 1]], [[x + 3, y + 1], [x + 3, y + h - 1]])
}
/** 炮座：矩形基座 + 一条上抬炮管，管口即 `muzzles` 挂点（管端 6×4） */
function turret(x: number, y: number, bw: number, bh: number, bl: number, cy: number): string {
  return s(poly([x, y], [x + bw, y], [x + bw, y + bh], [x, y + bh]), poly([x + bw, cy - 2], [x + bw + bl, cy - 2], [x + bw + bl, cy + 2], [x + bw, cy + 2]))
}
/** 方框（面板 / 舱门 / 外挂块 / 集装箱） */
function box(x: number, y: number, w: number, h: number): string {
  return poly([x, y], [x + w, y], [x + w, y + h], [x, y + h])
}
/** 舱段圆柱：外框 + 若干横向肋环（泰坦巨构用） */
function cyl(x0: number, x1: number, y0: number, y1: number, ribs: number[]): string {
  return s(box(x0, y0, x1 - x0, y1 - y0), ...ribs.map((rx): Pt[] => [[rx, y0], [rx, y1]]))
}
/** 舰桥塔：`tiers` 自下而上逐层递收（塔顶信标另写，坐标要进挂点） */
function bridge(x0: number, x1: number, y0: number, tiers: { h: number; i: number }[]): string {
  const out: string[] = []
  let a = x0
  let b = x1
  let y = y0
  for (const t of tiers) {
    out.push(box(a, y - t.h, b - a, t.h))
    y -= t.h
    a += t.i
    b -= t.i
  }
  return out.join(' ')
}
/** 蜂窝六边舱（G 族签名）：以 (cx,cy) 为心的六边形 */
function hex(cx: number, cy: number, r: number): string {
  const w = r * 0.866
  return poly([cx - w, cy - r], [cx + w, cy - r], [cx + w * 2, cy], [cx + w, cy + r], [cx - w, cy + r], [cx - w * 2, cy])
}
/** 孢子囊 / 静滞舱（C、D 族用）：椭圆近似六边胶囊 */
function pod(cx: number, cy: number, rx: number, ry: number): string {
  return `M${cx - rx} ${cy} Q${cx - rx} ${cy - ry} ${cx} ${cy - ry} Q${cx + rx} ${cy - ry} ${cx + rx} ${cy} Q${cx + rx} ${cy + ry} ${cx} ${cy + ry} Q${cx - rx} ${cy + ry} ${cx - rx} ${cy} Z`
}

// ───────────────────────── A 族 · 海盗（5 条）─────────────────────────
// 语言：破旧粗短、焊接外挂、斜排劫掠炮、角旗。区分点写在每条注释里。

/** ① 海盗快艇（T1 / brawl）：全族最小 —— **外露骨架肋条 + 单喷口 + 无炮塔**，靠"空壳"与同族他舰区分 */
const A_SKIFF = (
  <>
    <path d={poly([150, 54], [174, 46], [196, 46], [210, 54], [210, 64], [196, 72], [174, 72], [150, 66], [82, 66], [60, 48], [44, 48], [36, 56], [36, 68], [44, 76], [60, 76], [82, 52])} />
    <path className="shipart-panel" d={s([[80, 52], [138, 52]], [[80, 66], [140, 66]], [[96, 62], [178, 54]], [[120, 66], [184, 60]], [[94, 54], [120, 46]])} />
    <path d={s(line([60, 48], [60, 76]), line([80, 52], [80, 72]))} />
    <path className="shipart-panel" d={line([78, 76], [78, 52])} />
    <path className="shipart-panel" d={line([76, 50], [74, 24])} />
    <path className="shipart-accf" d={poly([74, 24], [58, 30], [74, 36])} />
    <path d={s(poly([176, 46], [176, 38]), poly([186, 46], [186, 38]))} />
    <path d={s(box(148, 44, 18, 4), box(148, 68, 18, 4))} />
    <path className="shipart-acc" d={line([150, 54], [166, 54])} />
    <path d={nozzle(44, 52, 8, 18)} />
  </>
)

/** ② 劫掠护卫舰（T1 / orbit）：细长船体 + **舰艏撞角跨板（尖橇，全族最锐）** + 舷侧抓钩 + 三列斜排劫掠炮 */
const A_CORVETTE = (
  <>
    <path d={poly([142, 38], [166, 40], [204, 58], [212, 62], [204, 68], [166, 76], [142, 78], [98, 76], [64, 66], [48, 58], [64, 46], [98, 40])} />
    <path d={poly([204, 58], [212, 62], [204, 68], [196, 63])} />
    <path className="shipart-panel" d={s([[104, 44], [150, 46]], [[104, 72], [150, 70]], [[126, 42], [126, 74]], [[156, 44], [156, 72]])} />
    <path d={s(line([150, 42], [150, 34]), line([164, 42], [164, 32]))} />
    <path d={s(nozzle(40, 52, 8, 16))} />
    <path d={s(box(66, 52, 16, 12))} />
    <path className="shipart-acc" d={line([75, 52], [75, 64])} />
    <path className="shipart-panel" d={s(line([86, 40], [78, 32]), line([86, 76], [78, 84]))} />
    <path d={s(turret(110, 34, 12, 7, 18, 37), turret(138, 34, 12, 7, 18, 37), turret(110, 69, 12, 7, 18, 66))} />
    <path className="shipart-accf" d={pod(58, 40, 3, 2)} />
    <path className="shipart-accf" d={pod(58, 76, 3, 2)} />
  </>
)

/** ③ 劫掠电子舰（T1 / orbit）：厚方箱体 + **背上一具大碟形干扰天线**（全族唯一），双喷口 */
const A_RAIDER = (
  <>
    <path d={poly([196, 42], [212, 48], [216, 58], [216, 66], [210, 74], [186, 80], [104, 80], [64, 74], [48, 66], [48, 50], [64, 42], [104, 38], [186, 38])} />
    <path d={s(line([64, 42], [104, 38]), line([64, 74], [104, 80]))} />
    <path className="shipart-panel" d={s([[64, 46], [104, 42]], [[64, 70], [104, 74]])} />
    <path d={s(box(104, 38, 18, 42), box(122, 36, 44, 8), box(166, 38, 34, 40))} />
    <path className="shipart-panel" d={s([[192, 42], [192, 76]], [[176, 40], [176, 78]])} />
    <path d={s(line([186, 38], [186, 30]))} />
    <path className="shipart-accf" d={poly([186, 10], [196, 18], [196, 30], [186, 38], [176, 30], [176, 18])} />
    <path className="shipart-panel" d={s(line([196, 20], [202, 30]), line([176, 20], [170, 30]))} />
    <path d={s(box(120, 26, 4, 12), box(142, 22, 4, 16))} />
    <path className="shipart-acc" d={line([136, 44], [136, 74])} />
    <path d={s(nozzle(128, 48, 8, 10), nozzle(128, 60, 8, 10))} />
  </>
)

/** ④ 劫掠狙击舰（T2 / kite）：细长船体 + **舰艏带支撑肋的裸管主炮**（全族最长炮） */
const A_SNIPER = (
  <>
    <path d={poly([152, 42], [172, 44], [188, 50], [188, 68], [172, 74], [152, 76], [118, 76], [62, 72], [44, 64], [36, 56], [44, 50], [62, 44], [118, 42])} />
    <path className="shipart-panel" d={s([[70, 44], [156, 46]], [[70, 72], [156, 70]], [[98, 42], [98, 74]], [[126, 43], [126, 75]])} />
    <path d={s(line([158, 50], [216, 50]), line([158, 58], [204, 58]), [[216, 50], [204, 58]])} />
    <path d={s(line([182, 52], [182, 44]), line([206, 54], [206, 44]))} />
    <path className="shipart-accf" d={poly([212, 50], [204, 54], [212, 58], [220, 54])} />
    <path d={s(box(52, 48, 14, 4), box(56, 44, 18, 4))} />
    <path className="shipart-panel" d={line([160, 42], [158, 34])} />
    <path d={s(box(120, 34, 22, 7), box(146, 34, 22, 7))} />
    <path className="shipart-acc" d={line([152, 36], [152, 40])} />
    <path d={nozzle(36, 48, 8, 16)} />
  </>
)

/** ⑤ 海盗头目舰（T3 / brawl）：族内最厚 —— **加高舰桥 + 长天线 + 四炮座 + 两舷外挂装甲块** */
const A_WARLORD = (
  <>
    <path d={poly([190, 44], [204, 48], [214, 56], [214, 68], [204, 78], [176, 82], [104, 82], [70, 78], [56, 68], [56, 52], [70, 42], [104, 38], [176, 38])} />
    <path className="shipart-panel" d={s([[104, 42], [176, 42]], [[104, 78], [176, 78]], [[104, 52], [196, 52]], [[104, 68], [200, 68]], [[104, 60], [210, 60]], [[126, 38], [126, 82]], [[152, 38], [152, 82]])} />
    <path d={bridge(128, 168, 38, [{ h: 9, i: 3 }, { h: 7, i: 2 }])} />
    <path className="shipart-panel" d={s(line([134, 29], [162, 29]), line([146, 22], [144, 8]))} />
    <path className="shipart-accf" d={poly([144, 6], [128, 12], [144, 18])} />
    <path d={s(turret(104, 38, 12, 6, 18, 41), turret(104, 76, 12, 6, 18, 73))} />
    <path d={s(box(52, 46, 12, 8), box(52, 66, 12, 8), box(44, 50, 8, 20))} />
    <path className="shipart-panel" d={s(line([48, 54], [48, 66]), line([62, 48], [62, 52]))} />
    <path d={s(nozzle(68, 56, 8, 10), nozzle(68, 66, 8, 10))} />
  </>
)

// ───────────────────────── B 族 · 拾荒（2 条）─────────────────────────
// 语言：切割过的船壳（断口多、无艏）、吊臂爪钩、暴露骨肋、侧挂集装箱。

/** ⑥ 拾荒武装艇（T1 / orbit）：**舰艏是被切掉的方口**（切割楔）+ 单侧吊臂与三爪抓钩 + 暴露肋骨 + 侧挂小集装箱 */
const B_SKIFF = (
  <>
    <path d={poly([214, 48], [226, 54], [226, 66], [214, 72], [188, 76], [150, 76], [150, 44], [188, 44])} />
    <path d={poly([150, 46], [118, 42], [92, 46], [92, 74], [118, 78], [150, 74])} />
    <path d={poly([92, 46], [62, 56], [62, 64], [92, 74])} />
    <path className="shipart-panel" d={s(line([118, 42], [118, 78]), line([136, 44], [136, 76]))} />
    <path className="shipart-panel" d={s(line([92, 46], [84, 54]), line([92, 74], [84, 66]))} />
    <path d={s(line([100, 44], [118, 30], [148, 30], [166, 40]), line([116, 44], [128, 32]))} />
    <path d={s(line([100, 44], [100, 52]), line([118, 30], [118, 36]))} />
    <path className="shipart-acc" d={line([118, 36], [110, 40])} />
    <path className="shipart-accf" d={poly([104, 58], [92, 62], [104, 66], [110, 62])} />
    <path d={s(box(160, 36, 24, 10))} />
    <path className="shipart-panel" d={line([166, 38], [178, 38])} />
    <path d={s(line([186, 44], [186, 36]), line([202, 46], [202, 36]))} />
    <path d={s(box(44, 54, 18, 14), box(44, 44, 10, 8), box(62, 52, 6, 18))} />
    <path className="shipart-panel" d={s(line([48, 58], [58, 58]), line([64, 56], [64, 66]))} />
    <path d={nozzle(28, 52, 8, 16)} />
  </>
)

/** ⑦ 拾荒火力舰（T2 / orbit）：**舰艏一门裸管重炮（两根桁架撑着）** + 吊臂抓钩 + 侧挂大集装箱；上重下轻的拾荒拼装感 */
const B_ARMED = (
  <>
    <path d={poly([154, 52], [166, 44], [196, 44], [214, 48], [214, 68], [196, 74], [166, 74], [154, 70])} />
    <path d={poly([104, 42], [154, 42], [154, 76], [104, 76])} />
    <path d={poly([104, 42], [84, 48], [70, 56], [70, 66], [84, 70], [104, 76])} />
    <path className="shipart-panel" d={s(line([154, 52], [186, 52]), line([154, 64], [196, 64]), line([172, 44], [172, 74]))} />
    <path d={s(line([112, 42], [112, 32]), line([134, 42], [134, 32]), box(110, 24, 26, 8))} />
    <path className="shipart-panel" d={s(line([118, 26], [118, 32]), line([128, 26], [128, 32]))} />
    <path d={s(line([84, 48], [64, 32], [48, 32]), line([64, 32], [58, 42]))} />
    <path className="shipart-accf" d={poly([46, 28], [38, 32], [46, 36], [50, 32])} />
    <path d={s(line([214, 50], [238, 50]), line([214, 60], [238, 60]))} />
    <path className="shipart-accf" d={poly([232, 50], [240, 55], [232, 60])} />
    <path d={s(box(96, 46, 26, 26))} />
    <path className="shipart-panel" d={s(line([96, 56], [122, 56]), line([106, 46], [106, 72]))} />
    <path d={s(box(36, 54, 10, 12), box(36, 66, 10, 8))} />
    <path d={nozzle(54, 54, 8, 14)} />
  </>
)

// ───────────────────────── C 族 · 异形（5 条）─────────────────────────
// 语言：有机曲线（Q 曲线）、节肢、膜翼、孢子囊；**无舷窗、无喷口**（引擎表为空 → 渲染层不画尾焰）。
// ⚠ 异形族**一律不要直角**：直边多了就读成机械舰（与 C 族"生物体"的设定相抵）。

/** ⑧ 畸变幼虫（T1 / brawl）：最小有机水滴 —— **体前一根弯獠牙 + 两侧膜翼**，圆钝无节 */
const C_RIFT_LARVA = (
  <>
    <path d={`${line([196, 64], [172, 46], [132, 40])} Q66 40 46 64 Q66 88 132 88 ${line([172, 82], [196, 64])} Z`} />
    <path d={line([200, 58], [218, 34])} />
    <path className="shipart-acc" d={line([200, 58], [218, 34])} />
    <path className="shipart-accf" d={pod(220, 31, 4, 3)} />
    <path className="shipart-panel" d={s(`M92 42 Q100 64 92 86`, `M128 40 Q138 64 128 88`, `M160 46 Q168 64 160 80`)} />
    <path d={`M70 48 Q40 40 24 46 Q44 54 58 56`} />
    <path d={`M70 80 Q40 88 24 82 Q44 74 58 72`} />
    <path className="shipart-accf" d={pod(184, 60, 5, 4)} />
  </>
)

/** ⑨ 星髓幼虫（T1 / brawl）：更圆更短 —— **背部晶簇（族色结晶）+ 体前一对短螯**，与畸变幼虫"獠牙细长"对开 */
const C_SC_LARVA = (
  <>
    <path d={`${line([188, 64], [168, 48], [124, 42])} Q64 42 48 64 Q64 88 124 88 ${line([168, 82], [188, 64])} Z`} />
    <path className="shipart-panel" d={s(`M112 42 Q120 64 112 86`, `M148 44 Q156 64 148 84`)} />
    <path d={`M100 46 Q86 34 72 40`} />
    <path d={`M96 82 Q82 94 68 88`} />
    <path d={s(line([80, 44], [76, 34]), line([134, 42], [132, 32]))} />
    <path className="shipart-accf" d={poly([106, 44], [118, 26], [126, 46])} />
    <path className="shipart-accf" d={poly([122, 43], [136, 20], [144, 45])} />
    <path className="shipart-accf" d={poly([138, 44], [152, 28], [158, 47])} />
    <path className="shipart-acc" d={`M70 58 Q54 62 48 74`} />
  </>
)

/** ⑩ 星髓成虫（T2 / brawl）：**三节分节甲壳（节间有缝）+ 背脊结晶列 + 三对节肢桨**，有节（区别于幼虫的无节） */
const C_SC_ADULT = (
  <>
    <path d={`${line([190, 62], [170, 46], [142, 42])} Q134 64 142 90 ${line([170, 80], [190, 62])} Z`} />
    <path d={`${line([142, 42], [116, 40])} Q106 64 116 92 ${line([142, 90], [134, 64])} Z`} />
    <path d={`${line([116, 40], [78, 46])} Q62 64 78 88 ${line([116, 92], [106, 64])} Z`} />
    <path className="shipart-panel" d={s(line([142, 42], [142, 90]), line([116, 40], [116, 92]))} />
    <path d={s(line([84, 46], [66, 34]), line([100, 42], [92, 28]), line([120, 40], [118, 26]), line([150, 44], [154, 28]))} />
    <path className="shipart-accf" d={poly([90, 40], [98, 22], [106, 42])} />
    <path className="shipart-accf" d={poly([110, 40], [120, 18], [128, 41])} />
    <path className="shipart-accf" d={poly([134, 42], [146, 20], [152, 44])} />
    <path d={s(line([120, 92], [100, 102]), line([140, 90], [126, 102]))} />
    <path d={s(line([124, 68], [92, 74]), line([126, 80], [98, 94]))} />
    <path className="shipart-acc" d={`M62 64 Q50 60 42 52`} />
  </>
)

/** ⑪ 孢群异虫（T3 / brawl）：**前部巨大瓣状开口口器（无齿，两瓣）+ 背部孢子囊 + 腹部育囊**，体型最圆鼓 */
const C_SPORE_HIVE = (
  <>
    <path d={`${line([188, 64], [168, 52], [148, 46])} Q142 64 148 86 ${line([168, 82], [188, 64])} Z`} />
    <path d={`${line([148, 46], [96, 42])} Q84 64 96 90 ${line([148, 86], [142, 64])} Z`} />
    <path d={`${line([96, 42], [58, 54])} Q38 64 58 78 ${line([96, 90], [96, 42])} Z`} />
    <path d={s(line([96, 42], [122, 56], [96, 90]), line([96, 42], [122, 74], [96, 90]))} />
    <path className="shipart-panel" d={s(line([96, 42], [96, 90]), line([148, 46], [148, 86]))} />
    <path className="shipart-accf" d={s(pod(112, 32, 13, 9), pod(140, 30, 13, 9), pod(112, 96, 13, 9), pod(140, 98, 13, 9))} />
    <path className="shipart-panel" d={s(line([52, 56], [40, 50]), line([52, 72], [40, 78]))} />
  </>
)

/** ⑫ 噬口巨兽（T4 / brawl）：**全库最大** —— 上下两片巨颚 + 口内一排利齿 + 背部骨刺排 + 尾部两根分叉螯肢；舰体最厚 */
const C_MAW = (
  <>
    <path d={`${line([214, 58], [196, 46], [150, 38], [86, 34])} Q52 52 44 62 ${line([86, 62], [150, 62])} Z`} />
    <path d={`${line([214, 70], [196, 82], [150, 90], [86, 94])} Q52 76 44 66 ${line([86, 66], [150, 66])} Z`} />
    <path d={s(line([58, 54], [66, 64]), line([58, 74], [66, 64]))} />
    <path d={s(line([78, 42], [66, 48]), line([78, 86], [66, 80]))} />
    <path d={s(line([86, 34], [96, 46]), line([104, 33], [110, 45]), line([122, 32], [124, 44]))} />
    <path className="shipart-accf" d={poly([128, 32], [134, 12], [142, 34])} />
    <path d={s(line([150, 38], [150, 62]), line([188, 42], [188, 60]))} />
    <path className="shipart-panel" d={s(line([112, 45], [112, 60]), line([140, 40], [140, 62]))} />
    <path className="shipart-accf" d={pod(202, 64, 5, 6)} />
    <path d={s(line([38, 62], [22, 56]), line([38, 66], [22, 74]))} />
    <path className="shipart-acc" d={line([38, 64], [26, 64])} />
  </>
)

// ───────────────────────── D 族 · 守墓古舰（4 条）─────────────────────────
// 语言：棺椁式长体、穹顶、方尖碑、静滞舱列；光束主炮（细长能量管，不是实心炮塔）。

/** ⑬ 幽灵舰（T2 / orbit）：**裹尸布式层叠外廓（布纹弧线）** + 体侧成对静滞小舱 + 艏端一门长能量炮 */
const D_GHOST = (
  <>
    <path d={poly([192, 40], [210, 44], [218, 52], [218, 66], [208, 76], [176, 84], [132, 82], [96, 72], [70, 60], [70, 52], [96, 42], [132, 38])} />
    <path className="shipart-panel" d={s(`M92 56 Q124 50 156 54 T210 56`, `M78 62 Q110 58 142 62 T208 62`, `M92 70 Q124 76 156 72 T206 70`)} />
    <path d={s(`M74 54 Q106 48 138 52`, `M74 70 Q106 76 138 72`)} />
    <path className="shipart-panel" d={s(line([122, 38], [122, 82]), line([158, 43], [158, 84]))} />
    <path d={line([218, 52], [234, 52])} />
    <path className="shipart-acc" d={line([218, 66], [232, 66])} />
    <path className="shipart-accf" d={pod(236, 59, 3, 4)} />
    <path d={s(pod(96, 60, 9, 7), pod(116, 58, 9, 7), pod(96, 74, 7, 5))} />
    <path d={s(box(62, 52, 10, 16))} />
    <path className="shipart-panel" d={line([66, 56], [70, 56])} />
  </>
)

/** ⑭ 守墓长舰（T3 / orbit）：**最长棺形 + 艏端方尖碑 + 两舷船桨状叶片列 + 脊顶墓道线 + 成排壁龛**（寺庙感最重） */
const D_LONGSHIP = (
  <>
    <path d={poly([188, 42], [216, 36], [222, 48], [206, 58], [206, 72], [190, 80], [140, 84], [86, 80], [52, 70], [46, 58], [56, 46], [86, 40], [140, 38])} />
    <path className="shipart-panel" d={line([52, 58], [204, 58])} />
    <path d={s(line([100, 40], [100, 80]), line([128, 38], [128, 84]), line([156, 40], [156, 82]))} />
    <path className="shipart-accf" d={poly([216, 36], [222, 48], [206, 58], [206, 40])} />
    <path className="shipart-panel" d={line([210, 44], [212, 52])} />
    <path d={s(pod(112, 66, 9, 5), pod(140, 68, 9, 5), pod(168, 66, 9, 5))} />
    <path d={s(line([96, 80], [88, 94]), line([118, 82], [110, 98]), line([142, 85], [136, 100]), line([166, 83], [160, 96]))} />
    <path d={s(line([86, 46], [94, 46]), line([86, 52], [94, 52]))} />
  </>
)

/** ⑮ 静滞卫舰（T3 / kite）：**两具大静滞环骑在艉部/中部（环心族色舱，族内唯一）** + 极简艉部 + 无艏炮 */
const D_STASIS = (
  <>
    <path d={poly([158, 48], [188, 44], [198, 52], [206, 60], [206, 68], [156, 76], [110, 74], [72, 66], [60, 58], [72, 50], [110, 46])} />
    <path className="shipart-panel" d={line([72, 58], [200, 58])} />
    <path className="shipart-panel" d={s(line([110, 46], [110, 74]), line([136, 46], [136, 75]), line([160, 48], [160, 76]))} />
    <path d={s(poly([118, 40], [132, 40], [144, 50], [144, 74], [132, 84], [118, 84], [106, 74], [106, 50]), poly([74, 40], [88, 40], [100, 50], [100, 74], [88, 84], [74, 84], [62, 74], [62, 50]))} />
    <path className="shipart-acc" d={s(line([118, 48], [132, 48]), line([118, 76], [132, 76]), line([74, 48], [88, 48]), line([74, 76], [88, 76]))} />
    <path className="shipart-accf" d={s(pod(125, 62, 5, 7), pod(81, 62, 5, 7))} />
    <path d={s(poly([62, 60], [48, 56], [48, 72], [62, 66]))} />
    <path className="shipart-panel" d={s(line([50, 60], [50, 68]), line([170, 52], [170, 72]))} />
  </>
)

/** ⑯ 守墓王座舰（T4 / orbit）：族内最大 —— **抬升的王座塔 + 冠顶 + 两舷巨大翼板 + 艏部重炮楔**（王陵） */
const D_THRONE = (
  <>
    <path d={poly([188, 44], [216, 42], [224, 54], [216, 74], [186, 84], [134, 88], [86, 82], [56, 68], [56, 54], [86, 42], [134, 38])} />
    <path className="shipart-panel" d={s(line([96, 46], [96, 82]), line([124, 40], [124, 88]), line([154, 42], [154, 86]), line([186, 44], [186, 83]))} />
    <path d={box(112, 40, 40, 48)} />
    <path className="shipart-panel" d={s(line([112, 52], [152, 52]), line([112, 68], [152, 68]))} />
    <path d={bridge(116, 148, 40, [{ h: 12, i: 4 }, { h: 10, i: 3 }, { h: 8, i: 2 }])} />
    <path className="shipart-acc" d={s(line([124, 30], [140, 30]), line([128, 20], [136, 20]))} />
    <path className="shipart-accf" d={pod(132, 8, 6, 4)} />
    <path d={poly([216, 42], [224, 54], [216, 74], [200, 70], [200, 46])} />
    <path className="shipart-accf" d={poly([220, 50], [226, 55], [220, 68], [212, 60])} />
    <path d={s(poly([80, 86], [96, 100], [148, 102], [170, 88]), poly([80, 40], [96, 26], [148, 24], [170, 38]))} />
    <path className="shipart-panel" d={s(line([96, 92], [158, 92]), line([96, 34], [158, 34]))} />
    <path d={box(64, 52, 12, 18)} />
  </>
)

// ───────────────────────── E 族 · 泰坦巨构（4 条）─────────────────────────
// 语言：巨构舱段（圆柱 + 横向肋环）、**断口/空心剖面**、暴露内构、炮座稀少而巨大；无舰桥。

/** ⑰ 导弹残段（T3 / orbit）：圆柱残段 + **舰艏整段断口（空心开口，看得见内壁）** + 横向舱环 + 艏部导弹巢阵列 */
const E_MISSILE = (
  <>
    <path d={cyl(44, 150, 44, 84, [70, 100, 130])} />
    <path className="shipart-panel" d={s(line([44, 52], [130, 52]), line([44, 76], [130, 76]))} />
    <path d={poly([150, 44], [150, 58], [128, 58], [128, 70], [150, 70], [150, 84])} />
    <path d={s(line([176, 40], [176, 88]), line([128, 58], [128, 70]))} />
    <path d={s(box(134, 46, 12, 7), box(134, 55, 12, 7), box(134, 64, 12, 7), box(134, 73, 12, 7))} />
    <path className="shipart-accf" d={s(pod(150, 49, 4, 3), pod(150, 58, 4, 3), pod(150, 67, 4, 3), pod(150, 76, 4, 3))} />
    <path d={s(line([134, 46], [162, 40]), line([134, 80], [162, 86]))} />
    <path d={box(34, 52, 12, 22)} />
    <path className="shipart-panel" d={s(line([38, 58], [44, 58]), line([38, 68], [44, 68]))} />
  </>
)

/** ⑱ 奥罗残骸段（T3 / orbit）：**长短不齐的舱段拼接 + 断脊桁架 + 侧面机库门 + 上下不对称**（补丁感最强） */
const E_AURO = (
  <>
    <path d={poly([36, 48], [92, 46], [96, 40], [150, 42], [158, 52], [158, 76], [148, 86], [92, 84], [88, 78], [36, 78])} />
    <path className="shipart-panel" d={s(line([60, 46], [60, 78]), line([92, 46], [92, 84]), line([124, 42], [124, 84]))} />
    <path d={s(line([96, 40], [150, 42]), line([56, 42], [56, 32]), line([84, 38], [84, 28]), line([120, 34], [120, 24]), line([150, 36], [150, 26]))} />
    <path className="shipart-accf" d={poly([158, 52], [174, 56], [174, 66], [158, 70])} />
    <path className="shipart-panel" d={box(40, 54, 30, 18)} />
    <path className="shipart-volt-g" d={box(44, 58, 22, 10)} />
    <path d={poly([36, 48], [24, 44], [24, 82], [36, 78])} />
    <path className="shipart-panel" d={s(line([26, 52], [26, 74]), line([36, 56], [44, 56]))} />
  </>
)

/** ⑲ 巨构残段（T4 / orbit）：**多段圆柱 + 更大断口 + 暴露内构 + 两座巨构炮座**（体量压过前两条） */
const E_TITAN = (
  <>
    <path d={s(cyl(40, 100, 40, 88, [64, 88]), cyl(124, 188, 42, 86, [148, 172]))} />
    <path className="shipart-panel" d={s(line([100, 48], [124, 48]), line([100, 62], [124, 62]), line([100, 78], [124, 78]))} />
    <path d={s(line([106, 48], [118, 62]), line([106, 78], [118, 62]))} />
    <path d={s(line([44, 40], [44, 30]), line([80, 40], [80, 32]), line([144, 42], [144, 30]), line([180, 42], [180, 32]))} />
    <path d={poly([188, 42], [204, 48], [204, 80], [188, 86])} />
    <path className="shipart-accf" d={poly([206, 56], [218, 60], [218, 68], [206, 72])} />
    <path d={s(turret(112, 30, 16, 10, 14, 32), turret(160, 76, 16, 10, 14, 84))} />
    <path d={box(32, 50, 10, 28)} />
    <path className="shipart-panel" d={s(line([36, 58], [40, 58]), line([36, 70], [40, 70]))} />
  </>
)

/** ⑳ 核心舱段（T5 / orbit）：**全库最大** —— 中段被掏空的巨构、正面一个大环形开口、四周残留舱环（无艏无炮塔） */
const E_CORE = (
  <>
    <path d={s(poly([36, 34], [160, 34], [176, 44], [176, 56], [160, 58], [176, 62], [176, 76], [160, 86], [36, 86]))} />
    <path className="shipart-panel" d={s(line([60, 34], [60, 86]), line([88, 34], [88, 86]), line([116, 34], [116, 86]), line([142, 34], [142, 86]))} />
    <path d={poly([176, 44], [196, 44], [212, 50], [212, 70], [196, 76], [176, 76])} />
    <path className="shipart-panel" d={line([196, 44], [196, 76])} />
    <path className="shipart-acc" d={`M212 50 Q228 60 212 70`} />
    <path className="shipart-accf" d={pod(220, 60, 6, 8)} />
    <path d={s(line([36, 34], [30, 24]), line([78, 34], [76, 22]), line([120, 34], [120, 22]), line([150, 34], [154, 24]))} />
    <path d={s(line([40, 86], [34, 96]), line([78, 86], [76, 98]), line([120, 86], [120, 98]))} />
    <path d={box(24, 46, 12, 30)} />
    <path className="shipart-panel" d={s(line([28, 54], [32, 54]), line([28, 68], [32, 68]))} />
  </>
)

// ───────────────────────── G 族 · 鱿烬亡军（5 条）─────────────────────────
// 语言：**蜂窝六边舱 + 补丁帆**（帆上有补丁方块）；残军杂械，多喷口。

/** ㉑ 围攻残兵舰（T1 / orbit）：最小蜂窝艇 + 两侧补丁帆 + 单喷口 + 前部小炮（族内最简） */
const G_SKIFF = (
  <>
    <path d={poly([72, 44], [130, 44], [152, 52], [152, 76], [130, 84], [72, 84], [60, 70], [60, 58])} />
    <path className="shipart-panel" d={s(hex(84, 64, 9), hex(106, 64, 9), hex(128, 64, 9))} />
    <path d={hex(106, 64, 9)} />
    <path d={s(line([76, 44], [70, 28], [140, 28], [140, 44]))} />
    <path className="shipart-panel" d={s(box(84, 32, 8, 6), box(120, 32, 8, 6))} />
    <path d={turret(140, 58, 10, 6, 14, 61)} />
    <path d={nozzle(50, 58, 8, 14)} />
  </>
)

/** ㉒ 残响残舰（T2 / orbit）：更宽蜂窝 + **断掉一半的补丁帆** + 通讯桅 + 细长艏炮 */
const G_ECHO = (
  <>
    <path d={poly([64, 42], [142, 42], [166, 50], [166, 78], [142, 86], [64, 86], [50, 68], [50, 56])} />
    <path className="shipart-panel" d={s(hex(76, 64, 9), hex(98, 64, 9), hex(120, 64, 9), hex(142, 64, 9))} />
    <path d={s(hex(98, 64, 9), hex(120, 64, 9))} />
    <path d={s(line([70, 42], [64, 26], [118, 26], [118, 42]))} />
    <path className="shipart-panel" d={s(box(72, 30, 8, 6), box(88, 30, 8, 6))} />
    <path d={s(line([130, 42], [138, 22]))} />
    <path className="shipart-acc" d={line([130, 42], [126, 24])} />
    <path className="shipart-accf" d={pod(138, 19, 4, 3)} />
    <path d={s(box(150, 56, 20, 4), box(160, 60, 10, 4))} />
    <path d={s(nozzle(42, 58, 8, 12), nozzle(42, 44, 8, 10))} />
  </>
)

/** ㉓ 天底封锁舰（T3 / orbit）：**背部大封锁环**（族内唯一）+ 航向稳定鳍 + 重炮，蜂窝更密 */
const G_NADIR = (
  <>
    <path d={poly([60, 38], [150, 38], [176, 48], [176, 82], [150, 92], [60, 92], [46, 74], [46, 56])} />
    <path className="shipart-panel" d={s(hex(72, 65, 10), hex(96, 65, 10), hex(120, 65, 10), hex(144, 65, 10), hex(84, 45, 7), hex(108, 45, 7), hex(84, 85, 7), hex(108, 85, 7))} />
    <path d={s(hex(120, 65, 10), hex(96, 65, 10))} />
    <path className="shipart-acc" d={`M116 46 Q116 18 152 18 Q188 18 188 46`} />
    <path className="shipart-accf" d={pod(152, 16, 7, 5)} />
    <path d={s(line([116, 46], [116, 38]), line([188, 46], [188, 38]))} />
    <path className="shipart-panel" d={s(line([46, 56], [34, 48]), line([46, 74], [34, 82]))} />
    <path d={turret(150, 44, 16, 8, 22, 48)} />
    <path d={s(nozzle(38, 48, 8, 12), nozzle(38, 70, 8, 12))} />
  </>
)

/** ㉔ 残军补给舰（T3 / orbit）：**长圆柱 + 外露肋环 + 腹部吊挂补给舱 + 尾部双燃料罐**（族内唯一非蜂窝主舱） */
const G_TENDER = (
  <>
    <path d={s(cyl(44, 176, 46, 82, [66, 90, 114, 138, 160]))} />
    <path className="shipart-panel" d={s([[44, 56], [176, 56]], [[44, 72], [176, 72]])} />
    <path d={poly([176, 46], [196, 54], [196, 74], [176, 82])} />
    <path className="shipart-accf" d={pod(188, 64, 5, 7)} />
    <path d={s(box(80, 82, 56, 22))} />
    <path className="shipart-panel" d={s([[108, 82], [108, 104]], [[80, 92], [136, 92]])} />
    <path className="shipart-volt-g" d={box(84, 96, 20, 6)} />
    <path d={s(line([96, 82], [94, 74]), line([120, 82], [120, 74]), line([86, 82], [84, 74]), line([130, 82], [132, 74]))} />
    <path d={s(box(64, 32, 22, 14), box(104, 32, 22, 14))} />
    <path className="shipart-panel" d={s([[70, 36], [80, 36]], [[110, 36], [120, 36]])} />
    <path d={nozzle(34, 56, 10, 18)} />
  </>
)

/** ㉕ 亡军战列舰（T4 / orbit）：族内最大 —— **多层蜂窝 + 两座主炮塔 + 补给栈桥 + 三喷口** */
const G_EXILE = (
  <>
    <path d={poly([54, 32], [166, 32], [190, 42], [196, 54], [196, 76], [186, 88], [166, 96], [54, 96], [40, 78], [40, 50])} />
    <path className="shipart-panel" d={s(hex(64, 48, 9), hex(88, 48, 9), hex(112, 48, 9), hex(136, 48, 9), hex(160, 48, 9), hex(64, 84, 9), hex(88, 84, 9), hex(112, 84, 9), hex(136, 84, 9), hex(160, 84, 9), hex(88, 66, 9), hex(112, 66, 9), hex(136, 66, 9))} />
    <path d={s(hex(112, 66, 9), hex(136, 66, 9), hex(88, 66, 9))} />
    <path d={s(line([70, 32], [66, 22], [156, 22], [150, 32]))} />
    <path className="shipart-panel" d={s(box(84, 24, 10, 6), box(126, 24, 10, 6))} />
    <path d={s(turret(96, 24, 18, 8, 22, 28), turret(148, 24, 18, 8, 22, 28))} />
    <path className="shipart-acc" d={line([112, 32], [112, 22])} />
    <path d={s(box(180, 60, 22, 18))} />
    <path className="shipart-panel" d={line([186, 64], [196, 64])} />
    <path d={s(nozzle(32, 40, 8, 14), nozzle(32, 60, 8, 14), nozzle(32, 80, 8, 14))} />
  </>
)

// ───────────────────────── H 族 · 墨潮帮（5 条）─────────────────────────
// 采用已交 v3 的几何（见 tools/_ui-artifacts/h-fleet-mock/v3.html），坐标原样搬入。
// 语言：机械型 —— 方正舰体、齐整面板线、塔式舰桥、母舰级体量。

/** ㉖ 墨潮突击舰（T1 / orbit）：全族最矮最尖 —— 前段锐角撞角直插，后段小方箱、双喷口 */
const H_CORVETTE = (
  <>
    <path d={poly([214, 64], [142, 52], [104, 52], [96, 56], [96, 72], [104, 76], [142, 76])} />
    <path className="shipart-acc" d={s(line([214, 64], [196, 58]), line([214, 64], [196, 70]))} />
    <path className="shipart-panel" d={poly([150, 52], [176, 64], [150, 76])} />
    <path d={poly([96, 54], [74, 54], [62, 60], [62, 68], [74, 74], [96, 74])} />
    <path className="shipart-panel" d={s([[70, 60], [90, 60]], [[70, 68], [90, 68]])} />
    <path d={s(box(52, 58, 10, 6), box(52, 66, 10, 6))} />
    <path className="shipart-accf" d={pod(206, 64, 4, 3)} />
    <path className="shipart-volt-g" d={box(100, 58, 28, 4)} />
  </>
)

/** ㉗ 墨潮鱼雷舰（T2 / kite）：细长纺锤（全族最长最扁），两侧各 3 具外挂鱼雷管、管口族色 */
const H_TORPEDO = (
  <>
    <path d={poly([216, 64], [186, 55], [84, 57], [70, 64], [84, 71], [186, 73])} />
    <path className="shipart-panel" d={s([[92, 60], [176, 60]], [[92, 68], [176, 68]], [[126, 57], [126, 73]], [[156, 57], [156, 73]])} />
    <path d={s(box(106, 48, 30, 9), box(106, 71, 30, 9))} />
    <path className="shipart-panel" d={s(line([136, 48], [146, 48]), line([136, 80], [146, 80]))} />
    <path className="shipart-accf" d={s(pod(148, 48, 3, 3), pod(148, 80, 3, 3))} />
    <path className="shipart-acc" d={s(line([112, 51], [130, 51]), line([112, 77], [130, 77]))} />
    <path d={box(62, 60, 8, 8)} />
    <path className="shipart-accf" d={pod(206, 64, 4, 3)} />
  </>
)

/** ㉘ 墨潮干扰舰（T3 / orbit）：高而窄的方箱（全族最高耸）+ 顶部两组三层干扰塔 */
const H_JAMMER = (
  <>
    <path d={poly([108, 42], [176, 42], [192, 50], [192, 86], [176, 94], [108, 94], [96, 80], [96, 56])} />
    <path className="shipart-panel" d={s([[112, 50], [174, 50]], [[112, 86], [174, 86]], [[112, 62], [182, 62]], [[112, 74], [182, 74]], [[136, 42], [136, 94]], [[160, 42], [160, 94]])} />
    <path d={poly([96, 56], [84, 50], [84, 66], [96, 62])} />
    <path d={s(box(120, 28, 20, 14), box(126, 19, 8, 9))} />
    <path d={s(box(156, 28, 20, 14), box(162, 19, 8, 9))} />
    <path className="shipart-acc" d={s(line([122, 32], [138, 32]), line([158, 32], [174, 32]))} />
    <path className="shipart-volt-g" d={s(box(124, 38, 12, 4), box(160, 38, 12, 4))} />
    <path className="shipart-accf" d={s(pod(130, 17, 3, 3), pod(166, 17, 3, 3))} />
    <path d={box(84, 62, 12, 18)} />
    <path className="shipart-panel" d={box(84, 64, 6, 14)} />
  </>
)

/** ㉙ 墨潮战列巡洋舰（T4 / kite）：双层甲板 —— 上层两座凸出三联炮塔、下层副炮列；尾部机库口 */
const H_BATTLECRUISER = (
  <>
    <path d={poly([222, 68], [196, 58], [92, 58], [74, 66], [74, 82], [92, 90], [196, 90], [222, 78])} />
    <path d={poly([186, 58], [176, 44], [108, 44], [100, 58])} />
    <path className="shipart-panel" d={s([[84, 66], [184, 66]], [[84, 84], [184, 84]], [[110, 58], [110, 90]], [[150, 58], [150, 90]])} />
    <path d={s(box(120, 34, 22, 10), box(152, 34, 22, 10))} />
    <path className="shipart-panel" d={s(line([142, 34], [154, 34]), line([174, 34], [186, 34]))} />
    <path className="shipart-accf" d={s(pod(131, 30, 4, 3), pod(163, 30, 4, 3))} />
    <path className="shipart-panel" d={s(poly([104, 52], [112, 52], [112, 58]), poly([124, 52], [132, 52], [132, 58]), poly([144, 52], [152, 52], [152, 58]))} />
    <path className="shipart-acc" d={line([92, 74], [82, 74], [82, 86], [92, 86])} />
    <path className="shipart-volt-g" d={box(84, 78, 6, 4)} />
    <path d={box(66, 70, 8, 10)} />
  </>
)

/** ㉚ 墨潮入侵母舰（T5 旗舰 · **独立形象**）：全族最厚最高 —— 双层厚甲 + 四层递收舰桥塔（塔顶族色信标）
 *  + 腹部双机库门 + 舰首 5 管大孔径鱼雷阵。塔尖 y=4（留 4px 余量） */
const H_FLAGSHIP = (
  <>
    <path d={poly([228, 68], [204, 52], [110, 48], [80, 56], [68, 66], [68, 86], [88, 96], [204, 94], [228, 78])} />
    <path d={poly([200, 52], [190, 38], [116, 36], [104, 48])} />
    <path className="shipart-panel" d={s([[90, 60], [198, 60]], [[90, 74], [208, 74]], [[90, 88], [190, 88]], [[124, 48], [124, 94]], [[166, 48], [166, 92]], [[196, 52], [196, 92]])} />
    <path d={bridge(140, 174, 36, [{ h: 11, i: 4 }, { h: 8, i: 3 }, { h: 7, i: 2 }])} />
    <path className="shipart-panel" d={line([157, 10], [157, 6])} />
    <path className="shipart-acc" d={s(line([146, 30], [168, 30]), line([152, 20], [163, 20]))} />
    <path className="shipart-accf" d={pod(159, 5, 3, 3)} />
    <path d={poly([228, 68], [240, 58], [240, 74], [228, 78])} />
    <path className="shipart-acc" d={s(line([232, 62], [239, 62]), line([232, 68], [240, 68]), line([232, 74], [239, 74]))} />
    <path className="shipart-accf" d={s(pod(234, 60, 2, 2), pod(236, 68, 2, 2), pod(234, 76, 2, 2))} />
    <path d={s(box(100, 96, 36, 10), box(148, 96, 34, 10))} />
    <path className="shipart-volt-g" d={s(box(104, 100, 28, 4), box(152, 100, 26, 4))} />
    <path d={s(box(56, 58, 12, 10), box(56, 74, 12, 10))} />
    <path className="shipart-panel" d={s(box(58, 60, 6, 6), box(58, 76, 6, 6))} />
  </>
)

// ───────────────────────── 汇总表 ─────────────────────────
/**
 * 键 = `packages/data/src/foe-ships.ts` 的 `id`（30 条一一对应）。
 * 未收录的敌舰 → 回退族形 `FOE_ART[族字母]` → 再回退 role 剪影（链路见 `ShipSprite.tsx`）。
 */
export const FOE_SHIP_ART: Record<string, ReactNode> = {
  // A 族 · 海盗
  'foe-pirate-skiff': A_SKIFF,
  'foe-pirate-corvette': A_CORVETTE,
  'foe-pirate-raider': A_RAIDER,
  'foe-pirate-sniper': A_SNIPER,
  'foe-pirate-warlord': A_WARLORD,
  // B 族 · 拾荒
  'foe-scav-skiff': B_SKIFF,
  'foe-scav-armed': B_ARMED,
  // C 族 · 异形
  'foe-alien-rift-larva': C_RIFT_LARVA,
  'foe-alien-starcore-larva': C_SC_LARVA,
  'foe-alien-starcore-adult': C_SC_ADULT,
  'foe-alien-spore-hive': C_SPORE_HIVE,
  'foe-alien-maw': C_MAW,
  // D 族 · 守墓古舰
  'foe-d-ghost': D_GHOST,
  'foe-d-longship': D_LONGSHIP,
  'foe-d-stasis': D_STASIS,
  'foe-d-throne': D_THRONE,
  // E 族 · 泰坦巨构
  'foe-missile-hulk': E_MISSILE,
  'foe-auro-hulk': E_AURO,
  'foe-titan-hulk': E_TITAN,
  'foe-core-section': E_CORE,
  // G 族 · 鱿烬亡军
  'foe-g-swarm-skiff': G_SKIFF,
  'foe-g-echo-remnant': G_ECHO,
  'foe-g-nadir-lock': G_NADIR,
  'foe-g-remnant-tender': G_TENDER,
  'foe-g-exile-battleship': G_EXILE,
  // H 族 · 墨潮帮（v3 几何原样搬入）
  'foe-h-ink-corvette': H_CORVETTE,
  'foe-h-ink-torpedo': H_TORPEDO,
  'foe-h-ink-jammer': H_JAMMER,
  'foe-h-ink-battlecruiser': H_BATTLECRUISER,
  'foe-h-ink-flagship': H_FLAGSHIP,
}
