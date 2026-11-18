export interface Pt2 {
  x: number
  y: number
}
export interface ShipMounts {
  engines: Pt2[]
  muzzles: Pt2[]
}

export const SHIP_MOUNTS: Record<string, ShipMounts> = {
  'sh-shrike': {
    engines: [{ x: 46, y: 50 }, { x: 46, y: 64 }],
    muzzles: [{ x: 190, y: 44 }, { x: 222, y: 58 }],
  },
  'sh-tigershark': {
    engines: [{ x: 48, y: 50 }, { x: 48, y: 66 }],
    muzzles: [{ x: 196, y: 41 }, { x: 144, y: 40 }],
  },
  'sh-whiteshark': {
    engines: [{ x: 52, y: 51.5 }, { x: 52, y: 65.5 }],
    muzzles: [{ x: 242, y: 47 }, { x: 242, y: 53 }, { x: 196, y: 44 }, { x: 150, y: 44 }],
  },
  'sh-swarm': {
    engines: [{ x: 46, y: 49.5 }, { x: 46, y: 64.5 }],
    muzzles: [],
  },
  'sh-sentinel': {
    engines: [{ x: 48, y: 50.5 }, { x: 48, y: 62.5 }, { x: 60, y: 50.5 }, { x: 60, y: 62.5 }],
    muzzles: [],
  },
  'sh-thresher': {
    engines: [{ x: 46, y: 57 }],
    muzzles: [{ x: 185, y: 30 }, { x: 153, y: 34 }, { x: 127, y: 36 }],
  },
  'sh-electricray': {
    engines: [{ x: 60, y: 51.5 }, { x: 60, y: 65.5 }],
    muzzles: [{ x: 222, y: 46 }, { x: 222, y: 52 }, { x: 222, y: 58 }, { x: 222, y: 64 }],
  },
  'sh-bullshark': {
    engines: [{ x: 52, y: 52 }, { x: 52, y: 68 }],
    muzzles: [{ x: 226, y: 46 }],
  },
  'sh-falconet': {
    engines: [{ x: 42, y: 55 }],
    muzzles: [{ x: 224, y: 60.5 }],
  },
  'sh-mako': {
    engines: [{ x: 38, y: 50 }, { x: 38, y: 64 }],
    muzzles: [{ x: 194, y: 42 }, { x: 122, y: 43.5 }],
  },
  'sh-hammerhead': {
    engines: [{ x: 54, y: 55 }, { x: 62, y: 55 }],
    muzzles: [{ x: 246, y: 52 }, { x: 196, y: 48 }, { x: 196, y: 64 }],
  },
  'sh-tortoise': { engines: [{ x: 60, y: 52 }], muzzles: [] },
  'sh-hawksbill': {
    engines: [{ x: 56, y: 53 }, { x: 56, y: 70 }],
    muzzles: [],
  },
  'sh-xuanwu': {
    engines: [{ x: 54, y: 50 }, { x: 54, y: 66 }, { x: 66, y: 50 }, { x: 66, y: 66 }],
    muzzles: [],
  },
  'sh-flyingfish': {
    engines: [{ x: 60, y: 50 }, { x: 60, y: 66 }],
    muzzles: [],
  },
  'sh-sailfish': {
    engines: [{ x: 56, y: 50.5 }, { x: 56, y: 67.5 }],
    muzzles: [],
  },
  'sh-swordfish': {
    engines: [{ x: 52, y: 50.5 }, { x: 52, y: 67.5 }],
    muzzles: [],
  },
  'sh-bowhead': {
    engines: [{ x: 60, y: 51.5 }, { x: 60, y: 66.5 }],
    muzzles: [],
  },
  'sh-manatee': {
    engines: [{ x: 49, y: 50.5 }, { x: 49, y: 63.5 }],
    muzzles: [{ x: 204, y: 58 }],
  },
  'sh-colossal': {
    engines: [{ x: 58, y: 52 }, { x: 58, y: 68 }],
    muzzles: [],
  },
  sandcat: { engines: [{ x: 64, y: 52.5 }], muzzles: [] },
  burrower: { engines: [{ x: 60, y: 52 }], muzzles: [] },
  whale: { engines: [{ x: 62, y: 51 }, { x: 62, y: 69 }], muzzles: [] },
  pioneer: {
    engines: [{ x: 64, y: 50.5 }, { x: 64, y: 67.5 }],
    muzzles: [],
  },
  'sh-humpback': {
    engines: [{ x: 62, y: 50.5 }, { x: 62, y: 67.5 }],
    muzzles: [],
  },
  'whale-king': {
    engines: [{ x: 58, y: 50 }, { x: 58, y: 66 }, { x: 70, y: 50 }, { x: 70, y: 66 }],
    muzzles: [],
  },
  'sh-wh-a-frigate': {
    engines: [{ x: 52, y: 55 }],
    muzzles: [
      { x: 122, y: 54 },
      { x: 144, y: 65 },
    ],
  },
  'sh-wh-a-destroyer': {
    engines: [{ x: 48, y: 49.5 }, { x: 48, y: 63.5 }],
    muzzles: [
      { x: 147, y: 47 },
      { x: 147, y: 59 },
      { x: 147, y: 67 },
    ],
  },
  'sh-wh-a-cruiser': {
    engines: [{ x: 42, y: 49 }, { x: 42, y: 65 }],
    muzzles: [
      { x: 147, y: 43 },
      { x: 147, y: 57 },
      { x: 147, y: 67 },
    ],
  },
  'sh-wh-c-frigate': { engines: [], muzzles: [{ x: 216, y: 55 }] },
  'sh-wh-c-destroyer': { engines: [], muzzles: [{ x: 234, y: 55 }] },
  'sh-wh-c-cruiser': { engines: [], muzzles: [{ x: 236, y: 58 }] },
  'sh-wh-d-frigate': { engines: [{ x: 48, y: 57 }], muzzles: [] },
  'sh-wh-d-destroyer': {
    engines: [{ x: 42, y: 56 }],
    muzzles: [
      { x: 107, y: 50 },
      { x: 107, y: 60 },
      { x: 107, y: 70 },
    ],
  },
  'sh-wh-d-cruiser': {
    engines: [{ x: 38, y: 51 }, { x: 38, y: 67 }],
    muzzles: [
      { x: 176, y: 47 },
      { x: 186, y: 60 },
      { x: 186, y: 72 },
    ],
  },
  'sh-wh-e-frigate': {
    engines: [{ x: 60, y: 59 }],
    muzzles: [
      { x: 170, y: 50 },
      { x: 170, y: 61 },
    ],
  },
  'sh-wh-e-destroyer': { engines: [{ x: 48, y: 60 }], muzzles: [{ x: 186, y: 58 }] },
  'sh-wh-e-carrier': {
    engines: [{ x: 40, y: 60 }],
    muzzles: [
      { x: 176, y: 49 },
      { x: 176, y: 68 },
    ],
  },
  'sh-wh-g-frigate': { engines: [{ x: 52, y: 57 }], muzzles: [{ x: 190, y: 55 }] },
  'sh-wh-g-destroyer': { engines: [{ x: 44, y: 58 }], muzzles: [] },
  'sh-wh-g-cruiser': {
    engines: [{ x: 40, y: 51 }, { x: 40, y: 67 }],
    muzzles: [
      { x: 198, y: 45 },
      { x: 198, y: 57 },
      { x: 198, y: 65 },
    ],
  },
  'sh-nautilus': {
    engines: [{ x: 40, y: 51 }, { x: 40, y: 67 }],
    muzzles: [
      { x: 85, y: 54 },
      { x: 85, y: 64 },
    ],
  },
  'sh-megalodon': {
    engines: [{ x: 34, y: 49 }, { x: 34, y: 67 }],
    muzzles: [{ x: 208, y: 43 }],
  },
  'sh-orca': {
    engines: [{ x: 32, y: 50 }, { x: 32, y: 66 }],
    muzzles: [{ x: 210, y: 48 }],
  },
  'sh-helicoprion': {
    engines: [{ x: 34, y: 48 }, { x: 34, y: 68 }],
    muzzles: [{ x: 206, y: 40 }],
  },
  'sh-dunkleosteus': {
    engines: [{ x: 28, y: 49 }, { x: 28, y: 65 }],
    muzzles: [
      { x: 216, y: 36 },
      { x: 216, y: 50 },
    ],
  },
}

export const FOE_MOUNTS: Record<string, ShipMounts> = {
  A: {
    engines: [{ x: 44, y: 53 }],
    muzzles: [
      { x: 102, y: 52 },
      { x: 130, y: 52 },
      { x: 158, y: 52 },
      { x: 198, y: 60 },
      { x: 196, y: 63 },
    ],
  },
  B: { engines: [{ x: 64, y: 51.5 }], muzzles: [] },
  C: { engines: [], muzzles: [] },
  D: {
    engines: [{ x: 58, y: 50 }, { x: 58, y: 66 }],
    muzzles: [{ x: 231, y: 49 }],
  },
  E: {
    engines: [{ x: 60, y: 52 }, { x: 60, y: 68 }],
    muzzles: [{ x: 220, y: 50 }],
  },
  F: {
    engines: [{ x: 62, y: 50.5 }, { x: 62, y: 67.5 }],
    muzzles: [{ x: 222, y: 54 }],
  },
  G: { engines: [{ x: 62, y: 53 }], muzzles: [{ x: 220, y: 55 }] },
}

export const FOE_SHIP_MOUNTS: Record<string, ShipMounts> = {
  'foe-alien-acid-burster': { engines: [], muzzles: [{ x: 198, y: 59 }] },
  'foe-alien-brood-worker': { engines: [], muzzles: [{ x: 218, y: 31 }, { x: 220, y: 94 }, { x: 213, y: 57 }, { x: 213, y: 70 }] },
  'foe-alien-hiveback': { engines: [], muzzles: [{ x: 224, y: 57 }] },
  'foe-alien-broodmother': { engines: [], muzzles: [{ x: 231, y: 46 }, { x: 232, y: 77 }] },
  'foe-pirate-skiff': { engines: [{ x: 44, y: 61 }], muzzles: [{ x: 74, y: 36 }] },
  'foe-pirate-corvette': {
    engines: [{ x: 40, y: 60 }],
    muzzles: [
      { x: 140, y: 37 },
      { x: 168, y: 37 },
      { x: 140, y: 66 },
      { x: 212, y: 62 },
    ],
  },
  'foe-pirate-raider': {
    engines: [
      { x: 128, y: 53 },
      { x: 128, y: 65 },
    ],
    muzzles: [{ x: 196, y: 24 }],
  },
  'foe-pirate-sniper': { engines: [{ x: 36, y: 56 }], muzzles: [{ x: 224, y: 54 }] },
  'foe-pirate-warlord': {
    engines: [
      { x: 68, y: 61 },
      { x: 68, y: 71 },
    ],
    muzzles: [
      { x: 134, y: 41 },
      { x: 134, y: 73 },
    ],
  },
  'foe-scav-skiff': {
    engines: [{ x: 28, y: 60 }],
    muzzles: [
      { x: 104, y: 58 },
      { x: 214, y: 48 },
    ],
  },
  'foe-scav-armed': { engines: [{ x: 54, y: 61 }], muzzles: [{ x: 240, y: 55 }] },
  'foe-alien-rift-larva': {
    engines: [],
    muzzles: [
      { x: 202, y: 60 },
      { x: 34, y: 44 },
      { x: 30, y: 78 },
    ],
  },
  'foe-alien-starcore-larva': {
    engines: [],
    muzzles: [
      { x: 112, y: 36 },
      { x: 138, y: 34 },
      { x: 162, y: 41 },
      { x: 50, y: 44 },
    ],
  },
  'foe-alien-starcore-adult': {
    engines: [],
    muzzles: [
      { x: 94, y: 38 },
      { x: 122, y: 34 },
      { x: 150, y: 39 },
      { x: 56, y: 62 },
    ],
  },
  'foe-alien-spore-hive': {
    engines: [],
    muzzles: [
      { x: 36, y: 44 },
      { x: 36, y: 80 },
      { x: 112, y: 33 },
      { x: 140, y: 31 },
      { x: 112, y: 93 },
      { x: 140, y: 95 },
    ],
  },
  'foe-alien-maw': {
    engines: [],
    muzzles: [
      { x: 212, y: 62 },
      { x: 94, y: 36 },
      { x: 124, y: 32 },
      { x: 152, y: 34 },
    ],
  },
  'foe-d-ghost': { engines: [{ x: 62, y: 60 }], muzzles: [{ x: 236, y: 59 }] },
  'foe-d-longship': { engines: [{ x: 88, y: 94 }], muzzles: [{ x: 222, y: 48 }] },
  'foe-d-stasis': {
    engines: [{ x: 48, y: 64 }],
    muzzles: [
      { x: 122, y: 62 },
      { x: 74, y: 62 },
    ],
  },
  'foe-d-throne': { engines: [{ x: 64, y: 61 }], muzzles: [{ x: 226, y: 55 }] },
  'foe-d-invasion-cruiser': { engines: [{ x: 34, y: 57.5 }], muzzles: [{ x: 228, y: 40 }, { x: 228, y: 72 }] },
  'foe-d-invasion-bastion': { engines: [{ x: 28, y: 58.5 }], muzzles: [{ x: 232, y: 61 }] },
  'foe-d-invasion-oathkeeper': { engines: [{ x: 24, y: 45 }, { x: 24, y: 83 }], muzzles: [{ x: 233, y: 50 }, { x: 233, y: 76 }] },
  'foe-d-invasion-eternal-tomb': { engines: [{ x: 18, y: 55 }, { x: 18, y: 74 }], muzzles: [{ x: 232, y: 62 }] },
  'foe-missile-hulk': { engines: [{ x: 34, y: 63 }], muzzles: [{ x: 151, y: 49 }] },
  'foe-auro-hulk': { engines: [{ x: 24, y: 63 }], muzzles: [{ x: 174, y: 61 }] },
  'foe-titan-hulk': {
    engines: [{ x: 32, y: 64 }],
    muzzles: [
      { x: 142, y: 32 },
      { x: 190, y: 84 },
    ],
  },
  'foe-core-section': { engines: [{ x: 24, y: 61 }], muzzles: [{ x: 228, y: 60 }] },
  'foe-g-swarm-skiff': { engines: [{ x: 50, y: 65 }], muzzles: [{ x: 164, y: 61 }] },
  'foe-g-echo-remnant': {
    engines: [
      { x: 42, y: 64 },
      { x: 42, y: 49 },
    ],
    muzzles: [{ x: 170, y: 58 }],
  },
  'foe-g-nadir-lock': {
    engines: [
      { x: 38, y: 54 },
      { x: 38, y: 76 },
    ],
    muzzles: [{ x: 188, y: 48 }],
  },
  'foe-g-remnant-tender': {
    engines: [{ x: 34, y: 65 }],
    muzzles: [
      { x: 196, y: 64 },
      { x: 136, y: 95 },
    ],
  },
  'foe-g-exile-battleship': {
    engines: [
      { x: 32, y: 47 },
      { x: 32, y: 67 },
      { x: 32, y: 87 },
    ],
    muzzles: [
      { x: 136, y: 28 },
      { x: 188, y: 28 },
    ],
  },
  'foe-h-ink-corvette': {
    engines: [
      { x: 52, y: 61 },
      { x: 52, y: 69 },
    ],
    muzzles: [
      { x: 214, y: 64 },
      { x: 176, y: 64 },
      { x: 130, y: 57 },
    ],
  },
  'foe-h-ink-torpedo': {
    engines: [{ x: 62, y: 64 }],
    muzzles: [
      { x: 146, y: 48 },
      { x: 148, y: 51 },
      { x: 146, y: 80 },
      { x: 148, y: 77 },
      { x: 206, y: 64 },
    ],
  },
  'foe-h-ink-jammer': {
    engines: [{ x: 84, y: 71 }],
    muzzles: [
      { x: 130, y: 19 },
      { x: 166, y: 19 },
    ],
  },
  'foe-h-ink-battlecruiser': {
    engines: [{ x: 66, y: 75 }],
    muzzles: [
      { x: 142, y: 30 },
      { x: 174, y: 30 },
      { x: 222, y: 73 },
    ],
  },
  'foe-h-ink-flagship': {
    engines: [
      { x: 56, y: 63 },
      { x: 56, y: 79 },
    ],
    muzzles: [
      { x: 239, y: 62 },
      { x: 240, y: 68 },
      { x: 239, y: 74 },
      { x: 132, y: 100 },
      { x: 178, y: 100 },
      { x: 159, y: 5 },
    ],
  },
  'foe-r-corona-glint': {
    engines: [{ x: 60, y: 64 }],
    muzzles: [{ x: 223, y: 64 }],
  },
  'foe-r-corona-echo': {
    engines: [
      { x: 70, y: 59 },
      { x: 70, y: 71 },
    ],
    muzzles: [{ x: 227, y: 64 }],
  },
  'foe-r-corona-overlay': {
    engines: [
      { x: 78, y: 57 },
      { x: 78, y: 67 },
      { x: 78, y: 77 },
    ],
    muzzles: [{ x: 226, y: 64 }],
  },
  'foe-r-corona-dusk': {
    engines: [
      { x: 52, y: 57.5 },
      { x: 52, y: 67.5 },
      { x: 52, y: 77.5 },
      { x: 52, y: 87.5 },
    ],
    muzzles: [
      { x: 236, y: 59 },
      { x: 236, y: 69 },
    ],
  },
  'foe-r-corona-nexus': {
    engines: [
      { x: 66, y: 58.5 },
      { x: 66, y: 76.5 },
      { x: 80, y: 58.5 },
      { x: 80, y: 76.5 },
    ],
    muzzles: [
      { x: 236, y: 53 },
      { x: 236, y: 66 },
      { x: 236, y: 79 },
      { x: 156, y: 17 },
    ],
  },
}

export function mountsOf(shipId: string | null | undefined, foeKey: string | null | undefined): ShipMounts | undefined {
  if (shipId) {
    const own = SHIP_MOUNTS[shipId] ?? FOE_SHIP_MOUNTS[shipId]
    if (own) return own
  }
  if (foeKey) return FOE_MOUNTS[foeKey]
  return undefined
}
