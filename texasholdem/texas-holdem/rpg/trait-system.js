/**
 * Trait System — 特质系统
 * 《零之王牌》角色被动天赋模块
 *
 * 每个角色有两个特质槽位：
 *   - vanguard trait（主手特质）：影响防御、牌运、物理层
 *   - rearguard trait（副手特质）：影响魔力、技能增幅、精神层
 *
 * 特质是被动天赋，始终生效，不消耗 mana。
 * 特质目录 TRAIT_CATALOG 定义所有可用特质及其效果。
 * 角色的特质由 JSON 配置声明（trait 字段）。
 *
 * 依赖：无（独立模块）
 */

// ========== 特质类型 ==========

export const TRAIT_SLOT = {
  VANGUARD: 'vanguard',
  REARGUARD: 'rearguard'
};

// ========== 特质目录 ==========

export const TRAIT_CATALOG = {
  // --- 主手特质（防御/物理层） ---
  blank_body: {
    slot: 'vanguard',
    name: '空白体质',
    description: '天生的概率死角，削弱所有被动魔运力量',
    effect: { type: 'weaken_passive', value: 0.3 }
  },
  iron_nerve: {
    slot: 'vanguard',
    name: '铁壁心志',
    description: '精神防御极高，降低受到的诅咒效果',
    effect: { type: 'resist_curse', value: 0.25 }
  },
  wild_surge: {
    slot: 'vanguard',
    name: '狂野脉冲',
    description: '混沌体质，被动魔运效果随机波动±50%',
    effect: { type: 'chaos_fluctuation', value: 0.5 }
  },
  stone_wall: {
    slot: 'vanguard',
    name: '磐石之壁',
    description: 'Void 属性额外 +20，减伤能力增强',
    effect: { type: 'void_bonus', value: 20 }
  },

  // --- 副手特质（魔力/精神层） ---
  fate_weaver: {
    slot: 'rearguard',
    name: '命运编织者',
    description: '主动 fortune 技能效果 +20%',
    effect: { type: 'boost_fortune', value: 0.2 }
  },
  hex_pulse: {
    slot: 'rearguard',
    name: '咒脉共振',
    description: '诅咒技能冷却 -1 回合',
    effect: { type: 'reduce_cooldown_curse', value: 1 }
  },
  mana_tide: {
    slot: 'rearguard',
    name: '魔力潮汐',
    description: 'mana 回复量 +2/回合',
    effect: { type: 'mana_regen_bonus', value: 2 }
  },
  glass_cannon: {
    slot: 'rearguard',
    name: '玻璃大炮',
    description: '所有主动技能伤害 +30%，但 mana 上限 -20%',
    effect: { type: 'damage_up_mana_down', damage: 0.3, mana: -0.2 }
  }
};

// ========== TraitSystem 类 ==========

export class TraitSystem {
  constructor() {
    // key: ownerId, value: { vanguard: traitKey|null, rearguard: traitKey|null }
    this.traits = new Map();
  }

  /**
   * 从 game-config.json 注册所有角色的特质
   * 统一接口：每个角色有 vanguard.trait 和 rearguard.trait
   * @param {object} config - 完整的 game config
   */
  registerFromConfig(config) {
    this.traits.clear();

    if (config.hero) {
      this._registerChar(0, config.hero);
    }

    if (config.seats) {
      const order = ['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB'];
      let idx = 1;
      for (const seat of order) {
        const s = config.seats[seat];
        if (!s) continue;
        this._registerChar(idx, s);
        idx++;
      }
    }
  }

  /**
   * @private
   */
  _registerChar(ownerId, char) {
    const vTrait = (char.vanguard && char.vanguard.trait) || null;
    const rTrait = (char.rearguard && char.rearguard.trait) || null;
    this.traits.set(ownerId, { vanguard: vTrait, rearguard: rTrait });
  }

  /**
   * 获取角色的特质
   * @param {number} ownerId
   * @returns {{ vanguard: string|null, rearguard: string|null }}
   */
  getTraits(ownerId) {
    return this.traits.get(ownerId) || { vanguard: null, rearguard: null };
  }

  /**
   * 获取特质的完整定义
   * @param {string} traitKey
   * @returns {object|null}
   */
  getTraitDef(traitKey) {
    return TRAIT_CATALOG[traitKey] || null;
  }

  /**
   * 检查角色是否拥有某个特质效果类型
   * @param {number} ownerId
   * @param {string} effectType - 如 'weaken_passive', 'resist_curse'
   * @returns {{ has: boolean, value: number, slot: string|null }}
   */
  hasEffect(ownerId, effectType) {
    const t = this.getTraits(ownerId);
    for (const slot of ['vanguard', 'rearguard']) {
      const key = t[slot];
      if (!key) continue;
      const def = TRAIT_CATALOG[key];
      if (def && def.effect && def.effect.type === effectType) {
        return { has: true, value: def.effect.value, slot: slot };
      }
    }
    return { has: false, value: 0, slot: null };
  }

  /**
   * 获取所有已注册角色的特质摘要
   */
  getSummary() {
    const result = [];
    for (const [id, t] of this.traits) {
      const entry = { ownerId: id, vanguard: null, rearguard: null };
      if (t.vanguard && TRAIT_CATALOG[t.vanguard]) {
        entry.vanguard = { key: t.vanguard, name: TRAIT_CATALOG[t.vanguard].name };
      }
      if (t.rearguard && TRAIT_CATALOG[t.rearguard]) {
        entry.rearguard = { key: t.rearguard, name: TRAIT_CATALOG[t.rearguard].name };
      }
      result.push(entry);
    }
    return result;
  }
}
