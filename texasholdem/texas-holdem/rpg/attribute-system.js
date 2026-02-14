/**
 * Attribute System — 属性系统
 * 《零之王牌》四属性定义 + 三角克制 + 属性面板管理
 *
 * 四属性：
 *   天命 (Moirai)  — 顺流，强制发好牌，Rino 专精
 *   狂厄 (Chaos)   — 乱流，干扰与诅咒，反派专精
 *   灵视 (Psyche)  — 观察者之眼，识破与读心，Kazu 专精
 *   虚无 (Void)    — Kazu 前台独有，% 魔法减伤
 *
 * 克制环：
 *   Chaos > Moirai > Psyche > Chaos
 *   Void 不参与克制，纯减伤
 *
 * 技能→属性映射：
 *   fortune                          → Moirai
 *   curse                            → Chaos
 *   clarity / refraction / reversal  → Psyche
 *   null_field / void_shield / purge_all → Void
 */

// ========== 属性常量 ==========

export const ATTR = {
  MOIRAI: 'moirai',
  CHAOS:  'chaos',
  PSYCHE: 'psyche',
  VOID:   'void'
};

export const COUNTER_MAP = {
  [ATTR.CHAOS]:  ATTR.MOIRAI,
  [ATTR.MOIRAI]: ATTR.PSYCHE,
  [ATTR.PSYCHE]: ATTR.CHAOS
};

export const ADVANTAGE_MULT  = 1.5;
export const DISADVANTAGE_MULT = 0.75;
const NEUTRAL_MULT = 1.0;

export const EFFECT_TO_ATTR = {
  fortune:      ATTR.MOIRAI,
  curse:        ATTR.CHAOS,
  clarity:      ATTR.PSYCHE,
  refraction:   ATTR.PSYCHE,
  reversal:     ATTR.PSYCHE,
  null_field:   ATTR.VOID,
  void_shield:  ATTR.VOID,
  purge_all:    ATTR.VOID,
  royal_decree: ATTR.MOIRAI,
  heart_read:   ATTR.PSYCHE,
  cooler:       ATTR.CHAOS,
  seal:         ATTR.CHAOS,
  clairvoyance: ATTR.PSYCHE,
  card_swap:    ATTR.CHAOS,
  miracle:      ATTR.MOIRAI,
  lucky_find:   ATTR.MOIRAI
};

const DEFAULT_ATTRIBUTES = {
  [ATTR.MOIRAI]: 0,
  [ATTR.CHAOS]:  0,
  [ATTR.PSYCHE]: 0,
  [ATTR.VOID]:   0
};

// ========== AttributeSystem 类 ==========

export class AttributeSystem {
  constructor() {
    this.panels = new Map();
  }

  registerFromConfig(players) {
    if (!players) return;
    for (const p of players) {
      const attrs = p.attributes
        ? { ...DEFAULT_ATTRIBUTES, ...p.attributes }
        : { ...DEFAULT_ATTRIBUTES };
      this.panels.set(p.id, attrs);
    }
  }

  getAttributes(characterId) {
    return this.panels.get(characterId) || { ...DEFAULT_ATTRIBUTES };
  }

  setAttribute(characterId, attr, value) {
    const panel = this.panels.get(characterId);
    if (!panel) return;
    panel[attr] = Math.max(0, Math.min(200, value));
  }

  addAttribute(characterId, attr, delta) {
    const panel = this.panels.get(characterId);
    if (!panel) return;
    panel[attr] = Math.max(0, Math.min(200, (panel[attr] || 0) + delta));
  }

  getAttributeForEffect(effectType) {
    return EFFECT_TO_ATTR[effectType] || ATTR.MOIRAI;
  }

  getCounterMultiplier(attackerAttr, defenderAttr) {
    if (attackerAttr === ATTR.VOID || defenderAttr === ATTR.VOID) return NEUTRAL_MULT;
    if (attackerAttr === defenderAttr) return NEUTRAL_MULT;
    if (COUNTER_MAP[attackerAttr] === defenderAttr) return ADVANTAGE_MULT;
    if (COUNTER_MAP[defenderAttr] === attackerAttr) return DISADVANTAGE_MULT;
    return NEUTRAL_MULT;
  }

  getAttributeBonus(attrValue) {
    return 1 + (attrValue || 0) / 100;
  }

  getVoidDivisor(voidValue) {
    return 1 + (voidValue || 0) / 100;
  }
}
