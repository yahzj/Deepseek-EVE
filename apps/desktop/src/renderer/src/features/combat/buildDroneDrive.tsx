/** 战斗界面职责：buildDroneDrive，保持原调用顺序。 */
















import { DRONE_DWELL_MS, DRONE_SHOW_MAX, DRONE_SORTIE_BACK_MS, DRONE_SORTIE_OUT_MS, droneModelOrFallback, droneRandomOffsets } from './droneArt'






export function buildDroneDrive({ arcs, droneSortieRef, now, dronePrevShowRef, visDistRef, visM, droneDriveRef, meAnchorByTag, foeSortieRef, foeSizes, meSize, farM, nearM }: {
foeSizes: number[]
meSize: number
farM: number
nearM: number
arcs: NonNullable<ReturnType<typeof import('@whale/core').battleArcsFor>>
droneSortieRef: import('react').MutableRefObject<Map<string, import('../../ui/droneArt').DroneSortie>>
now: number
dronePrevShowRef: import('react').MutableRefObject<Map<string, number>>
visDistRef: import('react').MutableRefObject<number>
visM: number
droneDriveRef: import('react').MutableRefObject<{ foeSizes: number[]; meSize: number; farM: number; nearM: number; wings: Array<{ key?: string; owner?: string; artId: string; model: import('../../ui/droneArt').DroneModel; show: number; st?: import('../../ui/droneArt').DroneSortie; deck: boolean; foe?: string; rangeBuff?: boolean; }>; meAnchors: Map<string, { x: number; y: number; }>; }>
meAnchorByTag: Map<string, import('../../panels/battleViewCore').Anchor>
foeSortieRef: import('react').MutableRefObject<Map<string, import('../../ui/droneArt').DroneSortie>>
}) {
/**
   * 我方机群机体层（2026-09-14 船长「逐舰机群」）：**逐舰**出机体——数据源 = core 视图里每艘
   * 编队舰自己的 `myUnits[].drones`（按该舰**存活**池归并）。主控那条与旧口径同源（同 artId、
   * 同架数、同锚点）⇒ 单船路径与主控路径逐像素不变。
   * ⚠ 键从 `artId` 改成 **`舰tag:artId`**（与敌方那侧 `${tag}:${artId}` 同构）：机体元素表、
   *   出击状态表、上一帧机体数表与弹道侧**四处必须用同一个键**，否则击落演出会找不到机体。
   */
  const droneWings = arcs.myUnits.flatMap((u) =>
    (u.drones ?? []).filter(d => (d.deployed ?? d.count) > 0).map((d) => {
      const key = `${u.tag}:${d.artId}`
      // **兜底取机型**（2026-09-12）：漏登记机型时画"未知机型"灰机体 + 名字回退成 id，
      // 不再静默消失（G 族蜂群机曾因漏登记而在战斗里看不见）。
      const model = droneModelOrFallback(d.artId)
      const st = droneSortieRef.current.get(key)
      const cycleMs = DRONE_SORTIE_OUT_MS + DRONE_DWELL_MS + DRONE_SORTIE_BACK_MS
      const elapsed = st ? now - st.startAt : Number.POSITIVE_INFINITY
      const phase: 'out' | 'back' | 'deck' = model.resident
        ? 'out'
        : elapsed < DRONE_SORTIE_OUT_MS + DRONE_DWELL_MS
          ? 'out'
          : elapsed < cycleMs
            ? 'back'
            : 'deck'
      const deployed = d.deployed ?? d.count
      const show = model.resident ? 1 : Math.max(1, Math.min(deployed, DRONE_SHOW_MAX))
      // 记下本帧渲染的机体数：下一拍的击落演出靠它定位"即将消失的末位机体"（见 fx 消费处）
      dronePrevShowRef.current.set(key, show)
      return {
        key,
        owner: u.tag,
        artId: d.artId,
        model,
        phase,
        elapsed,
        st,
        show,
        total: deployed,
      }
    }),
  );
  /** 敌方机群（第二层）：与 `droneWings` 同构——起点换成**敌舰机库口**、阵位在**我方舰旁**（镜像） */
  const foeWings = (arcs.foeDrones ?? []).filter((w) => w.alive > 0);
  /** 交给 rAF 驱动层：布局元数据 + 各机型机群（含本轮出击状态）；位置计算完全走 dronePoseAt */
  visDistRef.current = visM
  droneDriveRef.current = {
    foeSizes,
    meSize,
    farM,
    nearM,
    meAnchors: meAnchorByTag,
    wings: [
      ...droneWings.map((w) => ({
        key: w.key,
        owner: w.owner,
        artId: w.artId,
        model: w.model,
        show: w.show,
        st: w.st,
        deck: w.phase === 'deck',
      })),
      // **敌机也交给同一套驱动**（2026-09-11 S5 修正）：旧版敌机机体不在 `wings` 里 ⇒ 机群层盒子
      // 从未被平移到我方舰位（玩家不带无人机时 `d.wings` 为空）⇒ 敌机位置全错、还随布局漂移。
      ...foeWings.map((w) => {
        const sk = `${w.tag}:${w.artId}`
        const fcyc0 =
          DRONE_SORTIE_OUT_MS + DRONE_DWELL_MS + DRONE_SORTIE_BACK_MS;
        // **首轮也要飞出来**（船长 2026-09-11：「进入敌方射程后，敌方无人机似乎第一次不会飞出」）：
        // 出击状态原先只在"该机**开火**"那一刻才盖章 ⇒ 敌机的**第一发**是在机体还没出现时打出来的。
        // ⚠ **但不能"机群一出现就起一轮"**（船长 2026-09-11 追加：「每次进入战斗界面时，敌机会
        //   固定飞出一次」）：本 ref 是**组件内的**，重进战斗界面会重挂 ⇒ 又初始化一次 ⇒ 多飞一趟。
        // ⇒ 初始值取"**本轮已收舱**"（`startAt = now − 一轮时长`）：机体先停在甲板，
        //   **由它自己的第一发开火**盖章起一轮（机体随之飞出，弹道也按到位延迟显示）——
        //   既不空打、也不会每次重进界面白飞一趟。
        if (!foeSortieRef.current.get(sk)) {
          foeSortieRef.current.set(sk, {
            startAt: now - fcyc0,
            offs: droneRandomOffsets(DRONE_SHOW_MAX),
          })
        }
        const st = foeSortieRef.current.get(sk)
        const fcyc =
          DRONE_SORTIE_OUT_MS + DRONE_DWELL_MS + DRONE_SORTIE_BACK_MS
        const fel = st ? now - st.startAt : Number.POSITIVE_INFINITY
        return {
          artId: w.artId,
          model: droneModelOrFallback(w.artId),
          // **分批出击**（2026-09-12 船长「限制敌机单次出击数量」）：机体数按**本批在空架数**画
          // （引擎在 `foeDrones[].alive` 里已排除在库备用机）——缺省与旧口径一致（= 存活架数）。
          show: Math.min(w.alive, DRONE_SHOW_MAX),
          st,
          // **受击增程**（2026-09-11 船长）：本体挨打后该舰机群阵位后撤（`foeDroneStation`）
          rangeBuff: w.rangeBuff === true,
          // **收舱待命 = 不显示**（与我方同款：`is-deck` 走 CSS `display:none`）。
          // ⚠ 旧版常显 ⇒ 敌机在每轮之间**停在敌舰甲板上朝右不动**（船长实测："初始位于敌舰尾部、
          //   朝向朝右"）——敌机的可见时段应当与我方一致：只有出海那 1.4 秒。
          deck: !st || fel >= fcyc,
          foe: w.tag,
        }
      }),
    ],
  }

return { droneWings, foeWings }
}
