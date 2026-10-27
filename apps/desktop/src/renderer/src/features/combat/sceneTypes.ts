import { battleArcsFor } from '@whale/core'
import type { CSSProperties } from 'react'
import type { ShipRole } from '@whale/core'
import type { GameEngine } from '../../game/engine'
import type { ToastFn } from '../../pages/common'
/** 场景只读视图和交互接线；不参与战斗结算。 */
export type BattleSceneProps = {
rangeMode: boolean
screenRef: import('react').RefObject<HTMLDivElement>
stage: "live" | "outro"
onClose: () => void
tr: (id: string, params?: Record<string, string | number>) => string
inWormhole: boolean
retreatAsk: boolean
setRetreatAsk: import('react').Dispatch<import('react').SetStateAction<boolean>>
onToast: ToastFn
engine: Pick<GameEngine, "state" | "ctx" | "wormholeSpeedActive" | "wormholeSpeedOptions" | "setWormholeSpeed" | "battleSetDesireAt" | "retreatNow">
ended: boolean
defeat: boolean
sceneName: string
secs: number
meStats: { meShots: number; meHits: number; meDmg: number; foeShots: number; foeHits: number; }
speedOptions: number[]
speedActive: number
arcs: NonNullable<ReturnType<typeof battleArcsFor>>
foeCharging: number
ammoChips: import('@whale/core').DamageType[]
repairLedgers: { tag: string; ledger: import('@whale/core').BattleRepairLedger; }[]
repairRunning: boolean
repairDetail: string
repairTotal: number
stageRef: import('react').RefObject<HTMLDivElement>
fitRef: import('react').RefObject<HTMLDivElement>
laneRef: import('react').RefObject<HTMLDivElement>
starField: { cfg: { cls: string; n: number; mult: number; rMin: number; rMax: number; oMin: number; oMax: number; }; pts: import('./battleViewCore').StarPt[]; }[]
starLayerRefs: import('react').MutableRefObject<(HTMLDivElement | null)[]>
dims: import('./battleViewCore').Dims
meGunX: number
lay: { meLeft: number; foeLeft: number; me: import('./battleViewCore').Anchor; my: import('./battleViewCore').Anchor[]; foe: import('./battleViewCore').Anchor[]; sizes: number[]; foeBottom: number; formation: import('./battleViewCore').FoeFormation; usable: number; myBarW?: number; }
meArcEls: import('react').JSX.Element[]
foeGunX: number
foeInBand: boolean
foeR0: number
foeR1: number
foeColor: string
mainMeArc: { label: string; kind: "gun" | "beam" | "fixed"; type: import('@whale/core').DamageType | null; minM: number; maxM: number; reloadMs: number; src?: import('@whale/core').WeaponSrc; artId?: string; count?: number; isMain?: boolean; }
meMainR1: number
multiMe: boolean
myDrawOrder: { u: { tag: string; shipId: string; defId: string; name: string; className: string; leader: boolean; drones: Array<{ artId: string; count: number; deployed?: number; }>; hp: { s: number; a: number; h: number; }; hpMax: { s: number; a: number; h: number; }; alive: boolean; boosting: boolean; ammoIds?: Partial<Record<import('@whale/core').DamageType, string>>; }; slot: number; }[]
state: import('@whale/core').GameState
meFx: { cls: string; style: CSSProperties; }
arrivalSide: "foe" | "me" | null
arriveDxMe: number
ARRIVAL_FLY_MS: 950
ARRIVAL_STAGGER_MS: 60
meFlip: boolean
meColRef: import('react').RefObject<HTMLDivElement>
meShip: import('@whale/core').ShipDef | undefined
meRole: ShipRole
meSize: number
combat: { distanceM: number; myDesireM: number; meHp: { s: number; a: number; h: number; }; foeHp: Record<string, { s: number; a: number; h: number; name: string; }>; shots: number; hits: number; lockTag: string | null; }
droneWings: { key: string; owner: string; artId: string; model: import('./droneArt').DroneModel; phase: "out" | "back" | "deck"; elapsed: number; st: import('./droneArt').DroneSortie | undefined; show: number; total: number; }[]
foeWings: { tag: string; artId: string; count: number; alive: number; rangeBuff: boolean; hangar?: number; }[]
droneDownRef: import('react').MutableRefObject<{ key: number; artId: string; x: number; y: number; tx: number; ty: number; born: number; foe?: boolean; }[]>
droneBoxRef: import('react').RefObject<HTMLDivElement>
droneElsRef: import('react').MutableRefObject<Map<string, HTMLSpanElement>>
foeSortieRef: import('react').MutableRefObject<Map<string, import('./droneArt').DroneSortie>>
now: number
meFxRootRef: import('react').RefObject<HTMLDivElement>
foeColRef: import('react').RefObject<HTMLDivElement>
foeAnomaly: import('@whale/core').AnomalyDef | undefined
foeFormation: import('./battleViewCore').FoeFormation
foeRowBoxes: (row: 0 | 1) => import('react').ReactNode[]
noticeItems: { key: string; text: string; }[]
webEls: import('react').JSX.Element[]
muzzleEls: import('react').JSX.Element[]
boltEls: import('react').JSX.Element[]
acidFxRef: import('react').MutableRefObject<import('./battleAcidFx').AcidFx[]>
meAnchorByTag: Map<string, import('./battleViewCore').Anchor>
layFx: { meLeft: number; foeLeft: number; me: import('./battleViewCore').Anchor; my: import('./battleViewCore').Anchor[]; foe: import('./battleViewCore').Anchor[]; sizes: number[]; foeBottom: number; formation: import('./battleViewCore').FoeFormation; usable: number; myBarW?: number; }
popupEls: import('react').JSX.Element[]
farM: number
nearM: number
visM: number
pct: (m: number) => number
sliderV: number
pushDragV: (v: number) => void
scheduleCommit: (v: number) => void
flushDrag: () => void
dragV: number | null
sliderToDesire: (v: number) => number
applyTactic: (t: "assault" | "mid" | "kite") => void
}
