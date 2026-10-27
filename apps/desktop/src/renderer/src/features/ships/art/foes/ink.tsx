/** 功能域职责拆分，保持原计算与顺序。 */
import { poly, s, line, box, pod, bridge } from './primitives'

/** ㉖ 墨潮突击舰（T1 / orbit）：全族最矮最尖 —— 前段锐角撞角直插，后段小方箱、双喷口 */
export const H_CORVETTE = (
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
export const H_TORPEDO = (
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
export const H_JAMMER = (
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
export const H_BATTLECRUISER = (
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
export const H_FLAGSHIP = (
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
