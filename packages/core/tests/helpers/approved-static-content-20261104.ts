/** 现行 faction-plugin-expansion 与 encrypted-container-research 设计批准的精确新增 ID。 */
export const APPROVED_NEW_FACTION_PLUG_IDS = [
  'plug-pirate-damage-management', 'plug-alien-nanobiomass', 'plug-gravekeeper-charge',
  'plug-titan-drone-command', 'plug-deadarmy-reinforced-hull',
] as const

export const APPROVED_FACTION_PLUG_IDS = [
  'plug-pirate-raider', 'plug-alien-shield-coating', 'plug-gravekeeper-capacitor',
  'plug-titan-compression', 'plug-deadarmy-printing', ...APPROVED_NEW_FACTION_PLUG_IDS,
] as const

export const APPROVED_ENCRYPTED_BOX_IDS = [
  'box-encrypted-a', 'box-encrypted-c', 'box-encrypted-d', 'box-encrypted-e', 'box-encrypted-g',
] as const
