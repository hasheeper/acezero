/**
 * Switch System — 前台/后台切换系统
 * 《零之王牌》双位一体 (Vanguard / Rearguard) 管理
 *
 * 设计：
 *   - 一场牌局由两名角色共同参与（Rino + Kazu）
 *   - 前台 (Vanguard)：坐在桌上，承担压力，决定基础属性面板
 *   - 后台 (Rearguard)：站在身后，提供魔力供给，决定技能库
 *   - 可随时切换位置，改变战术风格
 *
 * 规则：
 *   - Kazu 必须在其中一个位置
 *   - Mode A (默认)：Kazu 前台(高魔抗) + Rino 后台(高爆发施法)
 *   - Mode B (特攻)：Rino 前台(天胡起手) + Kazu 后台(净化保姆)
 *   - 切换有冷却（防止无限切换）
 *   - 切换消耗少量 Sanity（心理压力）
 *
 * Hook 架构：
 *   emit('switch:before', { from, to })
 *   emit('switch:after', { vanguard, rearguard, mode })
 */

// ========== 常量 ==========

export const POSITION = {
  VANGUARD:  'vanguard',
  REARGUARD: 'rearguard'
};

export const MODE = {
  A: 'mode_a',
  B: 'mode_b'
};

export const SWITCH_COOLDOWN = 2;
export const SWITCH_SANITY_COST = 5;

// ========== SwitchSystem 类 ==========

export class SwitchSystem {
    /**
     * @param {object} opts
     * @param {number} opts.rinoId   - Rino 的角色 ID（默认 0）
     * @param {number} opts.kazuId   - Kazu 的角色 ID（默认 -2）
     * @param {object} opts.attributeSystem - AttributeSystem 实例
     */
    constructor(opts) {
      opts = opts || {};
      this.rinoId = opts.rinoId != null ? opts.rinoId : 0;
      this.kazuId = opts.kazuId != null ? opts.kazuId : -2;
      this.attributeSystem = opts.attributeSystem || null;

      // 当前模式（默认 Mode A：Kazu 前台）
      this.currentMode = MODE.A;

      // 冷却计数器
      this.switchCooldown = 0;

      // 事件系统
      this._listeners = {};
    }

    // ========== 状态查询 ==========

    /**
     * 获取当前前台角色 ID
     */
    getVanguardId() {
      return this.currentMode === MODE.A ? this.kazuId : this.rinoId;
    }

    /**
     * 获取当前后台角色 ID
     */
    getRearguardId() {
      return this.currentMode === MODE.A ? this.rinoId : this.kazuId;
    }

    /**
     * 获取当前模式
     */
    getMode() {
      return this.currentMode;
    }

    /**
     * 获取模式描述
     */
    getModeLabel() {
      if (this.currentMode === MODE.A) {
        return 'Mode A — Kazu 前台(魔抗) / Rino 后台(施法)';
      }
      return 'Mode B — Rino 前台(天胡) / Kazu 后台(净化)';
    }

    /**
     * 指定角色是否在前台
     */
    isVanguard(characterId) {
      return this.getVanguardId() === characterId;
    }

    /**
     * 是否可以切换（冷却已结束）
     */
    canSwitch() {
      return this.switchCooldown <= 0;
    }

    /**
     * 获取剩余冷却轮数
     */
    getCooldownRemaining() {
      return Math.max(0, this.switchCooldown);
    }

    // ========== 核心操作 ==========

    /**
     * 执行前后台切换
     * @returns {boolean} 是否成功切换
     */
    performSwitch() {
      if (!this.canSwitch()) {
        this.emit('switch:blocked', {
          reason: 'cooldown',
          remaining: this.switchCooldown
        });
        return false;
      }

      const oldMode = this.currentMode;
      const newMode = oldMode === MODE.A ? MODE.B : MODE.A;

      this.emit('switch:before', {
        fromMode: oldMode,
        toMode: newMode,
        fromVanguard: this.getVanguardId(),
        toVanguard: newMode === MODE.A ? this.kazuId : this.rinoId
      });

      this.currentMode = newMode;
      this.switchCooldown = SWITCH_COOLDOWN;

      this.emit('switch:after', {
        mode: this.currentMode,
        vanguardId: this.getVanguardId(),
        rearguardId: this.getRearguardId(),
        label: this.getModeLabel(),
        sanityCost: SWITCH_SANITY_COST
      });

      return true;
    }

    /**
     * 每轮结束时调用，减少冷却
     */
    onNewHand() {
      if (this.switchCooldown > 0) {
        this.switchCooldown--;
      }
    }

    /**
     * 重置到默认状态
     */
    reset() {
      this.currentMode = MODE.A;
      this.switchCooldown = 0;
    }

    // ========== 属性路由 ==========

    /**
     * 获取当前前台角色的属性面板
     * 前台属性决定：基础防御、物理牌运
     */
    getVanguardAttributes() {
      if (!this.attributeSystem) return null;
      return this.attributeSystem.getAttributes(this.getVanguardId());
    }

    /**
     * 获取当前后台角色的属性面板
     * 后台属性决定：MP 上限、技能库、被动加成
     */
    getRearguardAttributes() {
      if (!this.attributeSystem) return null;
      return this.attributeSystem.getAttributes(this.getRearguardId());
    }

    /**
     * 获取用于力量对抗的"主手属性值"
     * 规则：技能由后台施放，但前台属性提供基础加成
     *
     * @param {string} effectType - 技能效果类型
     * @returns {object} { primaryAttr, primaryValue, attrBonus, voidDivisor }
     */
    getCombatAttributes(effectType) {
      if (!this.attributeSystem) {
        return {
          primaryAttr: 'moirai',
          primaryValue: 0,
          attrBonus: 1.0,
          voidDivisor: 1.0
        };
      }

      const attr = this.attributeSystem.getAttributeForEffect(effectType);
      const rearAttrs = this.getRearguardAttributes();
      const vanAttrs = this.getVanguardAttributes();

      // 主属性来自后台（施法者）
      const primaryValue = rearAttrs ? (rearAttrs[attr] || 0) : 0;
      const attrBonus = this.attributeSystem.getAttributeBonus(primaryValue);

      // Void 减伤来自前台（承受者）
      const voidValue = vanAttrs ? (vanAttrs.void || 0) : 0;
      const voidDivisor = this.attributeSystem.getVoidDivisor(voidValue);

      return {
        primaryAttr: attr,
        primaryValue: primaryValue,
        attrBonus: attrBonus,
        voidDivisor: voidDivisor
      };
    }

    /**
     * 获取前台角色的 Void 减伤除数
     * 用于削弱敌方所有魔法效果
     */
    getVoidDivisor() {
      if (!this.attributeSystem) return 1.0;
      const vanAttrs = this.getVanguardAttributes();
      const voidValue = vanAttrs ? (vanAttrs.void || 0) : 0;
      return this.attributeSystem.getVoidDivisor(voidValue);
    }

    // ========== 事件系统 ==========

    on(event, fn) {
      if (!this._listeners[event]) this._listeners[event] = [];
      this._listeners[event].push(fn);
    }

    off(event, fn) {
      if (!this._listeners[event]) return;
      this._listeners[event] = this._listeners[event].filter(f => f !== fn);
    }

    emit(event, data) {
      var fns = this._listeners[event];
      if (fns) {
        for (var i = 0; i < fns.length; i++) {
          try { fns[i](data); } catch (e) { console.error('[SwitchSystem]', event, e); }
        }
      }
    }
  }

