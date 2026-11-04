/** 功能域职责拆分，保持原计算与顺序。 */
import { cyl, s, line, poly, box, pod, turret } from './primitives'

/** ⑰ 导弹残段（T3 / orbit）：圆柱残段 + **舰艏整段断口（空心开口，看得见内壁）** + 横向舱环 + 艏部导弹巢阵列 */
export const E_MISSILE = (
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
export const E_AURO = (
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
export const E_TITAN = (
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
export const E_CORE = (
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
