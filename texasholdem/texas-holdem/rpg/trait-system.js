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

  // --- 主手特质：角色专属 ---
  null_armor: {
    slot: 'vanguard',
    name: '虚无铠装',
    description: 'Void减伤效果+30%，但自身fortune效果-15%',
    effect: { type: 'void_amp_fortune_penalty', voidBonus: 0.3, fortunePenalty: 0.15 }
  },
  crimson_crown: {
    slot: 'vanguard',
    name: '绯红王冠',
    description: '天命系技能力量+25%，但受到的诅咒效果+15%',
    effect: { type: 'fortune_amp_curse_vuln', fortuneBonus: 0.25, curseVuln: 0.15 }
  },
  death_ledger: {
    slot: 'vanguard',
    name: '死亡账簿',
    description: '诅咒穿透目标25%的Void减伤和Psyche反制',
    effect: { type: 'curse_penetration', value: 0.25 }
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
  },

  // --- 副手特质：角色专属 ---
  steady_hand: {
    slot: 'rearguard',
    name: '不动心',
    description: '被动mana回复+3/回合，前台角色受curse伤害-10%',
    effect: { type: 'calm_support', manaRegen: 3, curseReduction: 0.1 }
  },
  obsessive_love: {
    slot: 'rearguard',
    name: '执念之爱',
    description: '筹码落后时天命+20%且常驻fortune(P10)，领先时-10%且反fortune(P-5)',
    effect: { type: 'desperate_devotion', behind: 0.2, ahead: -0.1, passiveBehind: 10, passiveAhead: -5 }
  },
  binding_protocol: {
    slot: 'rearguard',
    name: '拘束协议',
    description: '封印拘束节省魔力，技能mana消耗-50%，但力量-10%',
    effect: { type: 'mana_efficiency', costMult: 0.5, powerMult: 0.9 }
  },

  // --- 主手特质：Lilika 专属 ---
  laser_eye: {
    slot: 'vanguard',
    name: '镭射之眼',
    description: 'Psyche反制效果+25%（curse消除/转化更强），但mana回复-20%',
    effect: { type: 'psyche_amp_mana_penalty', psycheBonus: 0.25, manaRegenPenalty: 0.2 }
  },

  // --- 副手特质：Lilika 专属 ---
  service_fee: {
    slot: 'rearguard',
    name: '手续费',
    description: '技能命中时窃取目标15%mana（最多10点），但fortune效果-20%',
    effect: { type: 'mana_siphon', siphonRate: 0.15, siphonCap: 10, fortunePenalty: 0.2 }
  },

  // --- 主手特质：Poppo 专属 ---
  four_leaf_clover: {
    slot: 'vanguard',
    name: '四叶草',
    description: '筹码低于50%时被动fortune+40%，低于20%时被动fortune+80%（越惨越强）',
    effect: { type: 'underdog_fortune', midThreshold: 0.5, midBonus: 0.4, lowThreshold: 0.2, lowBonus: 0.8 }
  },

  // --- 副手特质：Poppo 专属 ---
  cockroach: {
    slot: 'rearguard',
    name: '不死身',
    description: '每手牌第一次受到curse时效果减半（限1次/手），被动mana回复+5/回合',
    effect: { type: 'survival_instinct', firstCurseReduction: 0.5, manaRegen: 5 }
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
   * @param {object} [playerIdMap] - { heroId, seats: { BTN: id, ... } }
   *   如果提供，使用真实游戏 ID；否则回退到顺序分配（hero=0, NPC=1,2,...）
   */
  registerFromConfig(config, playerIdMap) {
    this.traits.clear();

    if (playerIdMap && playerIdMap.heroId != null) {
      // 使用真实游戏 ID
      if (config.hero) {
        this._registerChar(playerIdMap.heroId, config.hero);
      }
      if (config.seats && playerIdMap.seats) {
        for (const seat in playerIdMap.seats) {
          const s = config.seats[seat];
          if (!s) continue;
          this._registerChar(playerIdMap.seats[seat], s);
        }
      }
    } else {
      // 回退：顺序分配
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
        return { has: true, value: def.effect, slot: slot };
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
