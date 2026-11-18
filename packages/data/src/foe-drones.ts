
import foeDronesParameters from './static/foeDrones.json'
import { enemyParameterOf } from '@whale/core'
import type { FoeDroneDef } from "@whale/core";
import { L10N } from './l10n/table'

export const FOE_DRONE_C_JAWCLAW: FoeDroneDef = {
  id: 'foe-drone-c-jawclaw', name: L10N['item.alien.001']!.zh, family: 'C', role: 'combat',
  defense: { shieldHp: enemyParameterOf(foeDronesParameters, "foe-drone-c-jawclaw", "defense_shieldHp"), armorHp: enemyParameterOf(foeDronesParameters, "foe-drone-c-jawclaw", "defense_armorHp"), hullHp: enemyParameterOf(foeDronesParameters, "foe-drone-c-jawclaw", "defense_hullHp"), evasion: enemyParameterOf(foeDronesParameters, "foe-drone-c-jawclaw", "defense_evasion") },
  dmg: enemyParameterOf(foeDronesParameters, "foe-drone-c-jawclaw", "dmg"), damageType: 'kinetic', hitRate: enemyParameterOf(foeDronesParameters, "foe-drone-c-jawclaw", "hitRate"), falloff: enemyParameterOf(foeDronesParameters, "foe-drone-c-jawclaw", "falloff"), maxRangeM: enemyParameterOf(foeDronesParameters, "foe-drone-c-jawclaw", "maxRangeM"), reloadMs: enemyParameterOf(foeDronesParameters, "foe-drone-c-jawclaw", "reloadMs"),
}

export const FOE_DRONE_E_ALERT: FoeDroneDef = {
  id: "foe-drone-e-alert",
  name: "警戒机",
  family: "E",
  role: "combat",
  defense: {
    shieldHp: enemyParameterOf(foeDronesParameters, "foe-drone-e-alert", "defense_shieldHp"),
    armorHp: enemyParameterOf(foeDronesParameters, "foe-drone-e-alert", "defense_armorHp"),
    hullHp: enemyParameterOf(foeDronesParameters, "foe-drone-e-alert", "defense_hullHp"),
    armorResist: { kinetic: enemyParameterOf(foeDronesParameters, "foe-drone-e-alert", "defense_armorResist_kinetic") },
    evasion: enemyParameterOf(foeDronesParameters, "foe-drone-e-alert", "defense_evasion"),
  },
  dmg: enemyParameterOf(foeDronesParameters, "foe-drone-e-alert", "dmg"),
  damageType: "kinetic",
  hitRate: enemyParameterOf(foeDronesParameters, "foe-drone-e-alert", "hitRate"),
  falloff: enemyParameterOf(foeDronesParameters, "foe-drone-e-alert", "falloff"),
  maxRangeM: enemyParameterOf(foeDronesParameters, "foe-drone-e-alert", "maxRangeM"),
  reloadMs: enemyParameterOf(foeDronesParameters, "foe-drone-e-alert", "reloadMs"),
};
const FOE_DRONE_G_BEE = (
  id: string,
  damageType: "kinetic" | "explosive" | "plasma",
): FoeDroneDef => ({
  id,
  name: "蜂群机",
  family: "G",
  role: "scout",
  defense: {
    shieldHp: enemyParameterOf(foeDronesParameters, "g-bee-shared", "defense_shieldHp"),
    armorHp: enemyParameterOf(foeDronesParameters, "g-bee-shared", "defense_armorHp"),
    hullHp: enemyParameterOf(foeDronesParameters, "g-bee-shared", "defense_hullHp"),
    evasion: enemyParameterOf(foeDronesParameters, "g-bee-shared", "defense_evasion"),
  },
  dmg: enemyParameterOf(foeDronesParameters, "g-bee-shared", "dmg"),
  damageType,
  hitRate: enemyParameterOf(foeDronesParameters, "g-bee-shared", "hitRate"),
  falloff: enemyParameterOf(foeDronesParameters, "g-bee-shared", "falloff"),
  maxRangeM: enemyParameterOf(foeDronesParameters, "g-bee-shared", "maxRangeM"),
  reloadMs: enemyParameterOf(foeDronesParameters, "g-bee-shared", "reloadMs"),
});

export const FOE_DRONE_G_BEE_KIN: FoeDroneDef = FOE_DRONE_G_BEE(
  "foe-drone-g-bee-kin",
  "kinetic",
);
export const FOE_DRONE_G_BEE_EXP: FoeDroneDef = FOE_DRONE_G_BEE(
  "foe-drone-g-bee-exp",
  "explosive",
);
export const FOE_DRONE_G_BEE_PLA: FoeDroneDef = FOE_DRONE_G_BEE(
  "foe-drone-g-bee-pla",
  "plasma",
);

export const FOE_DRONE_C_SPORE: FoeDroneDef = {
  id: "foe-drone-c-spore",
  name: "孢群机",
  family: "C",
  role: "assault",
  defense: {
    shieldHp: enemyParameterOf(foeDronesParameters, "foe-drone-c-spore", "defense_shieldHp"),
    armorHp: enemyParameterOf(foeDronesParameters, "foe-drone-c-spore", "defense_armorHp"),
    hullHp: enemyParameterOf(foeDronesParameters, "foe-drone-c-spore", "defense_hullHp"),
    armorResist: { kinetic: enemyParameterOf(foeDronesParameters, "foe-drone-c-spore", "defense_armorResist_kinetic"), explosive: enemyParameterOf(foeDronesParameters, "foe-drone-c-spore", "defense_armorResist_explosive"), plasma: enemyParameterOf(foeDronesParameters, "foe-drone-c-spore", "defense_armorResist_plasma") },
    hullResist: { kinetic: enemyParameterOf(foeDronesParameters, "foe-drone-c-spore", "defense_hullResist_kinetic"), explosive: enemyParameterOf(foeDronesParameters, "foe-drone-c-spore", "defense_hullResist_explosive"), plasma: enemyParameterOf(foeDronesParameters, "foe-drone-c-spore", "defense_hullResist_plasma") },
    evasion: enemyParameterOf(foeDronesParameters, "foe-drone-c-spore", "defense_evasion"),
  },
  dmg: enemyParameterOf(foeDronesParameters, "foe-drone-c-spore", "dmg"),
  damageType: "plasma",
  hitRate: enemyParameterOf(foeDronesParameters, "foe-drone-c-spore", "hitRate"),
  falloff: enemyParameterOf(foeDronesParameters, "foe-drone-c-spore", "falloff"),
  maxRangeM: enemyParameterOf(foeDronesParameters, "foe-drone-c-spore", "maxRangeM"),
  reloadMs: enemyParameterOf(foeDronesParameters, "foe-drone-c-spore", "reloadMs"),
};

export const FOE_DRONE_H_HEAVY: FoeDroneDef = {
  id: 'foe-drone-h-heavy',
  name: '墨潮重袭机',
  family: 'H',
  role: 'assault',
  defense: {
    shieldHp: enemyParameterOf(foeDronesParameters, "foe-drone-h-heavy", "defense_shieldHp"),
    armorHp: enemyParameterOf(foeDronesParameters, "foe-drone-h-heavy", "defense_armorHp"),
    hullHp: enemyParameterOf(foeDronesParameters, "foe-drone-h-heavy", "defense_hullHp"),
    shieldResist: { kinetic: enemyParameterOf(foeDronesParameters, "foe-drone-h-heavy", "defense_shieldResist_kinetic"), explosive: enemyParameterOf(foeDronesParameters, "foe-drone-h-heavy", "defense_shieldResist_explosive"), plasma: enemyParameterOf(foeDronesParameters, "foe-drone-h-heavy", "defense_shieldResist_plasma") },
    armorResist: { kinetic: enemyParameterOf(foeDronesParameters, "foe-drone-h-heavy", "defense_armorResist_kinetic"), explosive: enemyParameterOf(foeDronesParameters, "foe-drone-h-heavy", "defense_armorResist_explosive"), plasma: enemyParameterOf(foeDronesParameters, "foe-drone-h-heavy", "defense_armorResist_plasma") },
    hullResist: { kinetic: enemyParameterOf(foeDronesParameters, "foe-drone-h-heavy", "defense_hullResist_kinetic"), explosive: enemyParameterOf(foeDronesParameters, "foe-drone-h-heavy", "defense_hullResist_explosive"), plasma: enemyParameterOf(foeDronesParameters, "foe-drone-h-heavy", "defense_hullResist_plasma") },
    evasion: enemyParameterOf(foeDronesParameters, "foe-drone-h-heavy", "defense_evasion"),
  },
  dmg: enemyParameterOf(foeDronesParameters, "foe-drone-h-heavy", "dmg"),
  damageType: 'explosive',
  hitRate: enemyParameterOf(foeDronesParameters, "foe-drone-h-heavy", "hitRate"),
  falloff: enemyParameterOf(foeDronesParameters, "foe-drone-h-heavy", "falloff"),
  maxRangeM: enemyParameterOf(foeDronesParameters, "foe-drone-h-heavy", "maxRangeM"),
  reloadMs: enemyParameterOf(foeDronesParameters, "foe-drone-h-heavy", "reloadMs"),
}

export const FOE_DRONE_R_PRISM: FoeDroneDef = {
  id: 'foe-drone-r-prism',
  name: '折光机',
  family: 'R',
  role: 'combat',
  defense: {
    shieldHp: enemyParameterOf(foeDronesParameters, "foe-drone-r-prism", "defense_shieldHp"),
    armorHp: enemyParameterOf(foeDronesParameters, "foe-drone-r-prism", "defense_armorHp"),
    hullHp: enemyParameterOf(foeDronesParameters, "foe-drone-r-prism", "defense_hullHp"),
    shieldResist: { kinetic: enemyParameterOf(foeDronesParameters, "foe-drone-r-prism", "defense_shieldResist_kinetic"), explosive: enemyParameterOf(foeDronesParameters, "foe-drone-r-prism", "defense_shieldResist_explosive"), plasma: enemyParameterOf(foeDronesParameters, "foe-drone-r-prism", "defense_shieldResist_plasma") },
    armorResist: { kinetic: enemyParameterOf(foeDronesParameters, "foe-drone-r-prism", "defense_armorResist_kinetic"), explosive: enemyParameterOf(foeDronesParameters, "foe-drone-r-prism", "defense_armorResist_explosive"), plasma: enemyParameterOf(foeDronesParameters, "foe-drone-r-prism", "defense_armorResist_plasma") },
    hullResist: { kinetic: enemyParameterOf(foeDronesParameters, "foe-drone-r-prism", "defense_hullResist_kinetic"), explosive: enemyParameterOf(foeDronesParameters, "foe-drone-r-prism", "defense_hullResist_explosive"), plasma: enemyParameterOf(foeDronesParameters, "foe-drone-r-prism", "defense_hullResist_plasma") },
    evasion: enemyParameterOf(foeDronesParameters, "foe-drone-r-prism", "defense_evasion"),
  },
  dmg: enemyParameterOf(foeDronesParameters, "foe-drone-r-prism", "dmg"),
  damageType: 'plasma',
  hitRate: enemyParameterOf(foeDronesParameters, "foe-drone-r-prism", "hitRate"),
  falloff: enemyParameterOf(foeDronesParameters, "foe-drone-r-prism", "falloff"),
  maxRangeM: enemyParameterOf(foeDronesParameters, "foe-drone-r-prism", "maxRangeM"),
  reloadMs: enemyParameterOf(foeDronesParameters, "foe-drone-r-prism", "reloadMs"),
}

export const FOE_DRONES: readonly FoeDroneDef[] = [
  FOE_DRONE_C_JAWCLAW,
  FOE_DRONE_E_ALERT,
  FOE_DRONE_G_BEE_KIN,
  FOE_DRONE_G_BEE_EXP,
  FOE_DRONE_G_BEE_PLA,
  FOE_DRONE_C_SPORE,
  FOE_DRONE_H_HEAVY,
  FOE_DRONE_R_PRISM,
];
