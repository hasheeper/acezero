/**
 * Combat Formula — 战斗公式系统
 * 《零之王牌》新力量对抗公式
 *
 * 核心公式：
 *   EffectivePower = SkillLevel × 10 × (1 + 主手属性/100) × 属性克制倍率
 *
 * 对抗流程：
 *   1. 计算每个 force 的 raw power（含属性加成 + 克制倍率）
 *   2. 同类型力量互相抵消（fortune vs fortune, curse vs curse）
 *   3. 主动压制被动（等级差额外削弱）
 *   4. 命运之锚 / 概率死角 被动效果
 *   5. Void 减伤（前台 Kazu 时，敌方所有效果 ÷ voidDivisor）
 *
 * 依赖：
 *   - AttributeSystem（属性面板 + 克制关系）
 *   - SwitchSystem（前台/后台状态 + 属性路由）
 *
 * 本模块不直接修改 monte-of-zero.js，而是提供一个
 * enhanceForces(forces) 方法，在 _resolveForceOpposition 之前调用，
 * 将属性加成和克制倍率注入到每个 force 的 power 中。
 */

// ========== CombatFormula 类 ==========

export class CombatFormula {
    /**
     * @param {object} opts
     * @param {AttributeSystem} opts.attributeSystem
     * @param {SwitchSystem}    opts.switchSystem
     */
    constructor(opts) {
      opts = opts || {};
      this.attributeSystem = opts.attributeSystem || null;
      this.switchSystem = opts.switchSystem || null;
      this.heroId = opts.heroId != null ? opts.heroId : 0;
    }

    /**
     * 增强 forces 列表：为每个 force 注入属性加成和克制倍率
     * 在 _resolveForceOpposition 之前调用
     *
     * @param {Array} forces - 原始 forces 列表
     * @param {object} context - { players } 用于确定敌方属性
     * @returns {Array} 增强后的 forces（修改了 power 值）
     */
    enhanceForces(forces, context) {
      if (!this.attributeSystem || !this.switchSystem) {
        return forces; // 无属性系统时，保持原始行为
      }

      const enhanced = forces.map(f => ({ ...f }));

      for (const force of enhanced) {
        const enhancement = this._calculateEnhancement(force, enhanced, context);
        force.power = Math.round(force.power * enhancement.totalMultiplier * 10) / 10;
        // 附加元数据供 UI 和日志使用
        force._attrBonus = enhancement.attrBonus;
        force._counterMult = enhancement.counterMult;
        force._primaryAttr = enhancement.primaryAttr;
      }

      return enhanced;
    }

    /**
     * 应用 Void 减伤到敌方 forces
     * 在力量对抗结算之后、最终计算命运分之前调用
     *
     * @param {Array} resolvedForces - 对抗结算后的 forces
     * @returns {Array} 应用 Void 减伤后的 forces
     */
    applyVoidReduction(resolvedForces) {
      if (!this.attributeSystem || !this.switchSystem) {
        return resolvedForces;
      }

      const voidDivisor = this.switchSystem.getVoidDivisor();
      if (voidDivisor <= 1.0) return resolvedForces; // 无 Void 属性

      const playerSide = this.switchSystem.rinoId;

      for (const f of resolvedForces) {
        // Void 只减伤敌方对我方的效果
        if (f.ownerId === playerSide) continue; // 己方 force 不受影响
        if (f.type === 'null_field' || f.type === 'void_shield' || f.type === 'reversal') continue; // meta 力不受影响

        // 敌方 fortune（帮敌人赢）和 curse（害我方）都被削弱
        if (f.effectivePower > 0) {
          f.effectivePower = Math.round((f.effectivePower / voidDivisor) * 10) / 10;
          f._voidReduced = true;
          f._voidDivisor = voidDivisor;
        }
      }

      return resolvedForces;
    }

    /**
     * 计算单个 force 的增强倍率
     * @private
     */
    _calculateEnhancement(force, allForces, context) {
      const result = {
        attrBonus: 1.0,
        counterMult: 1.0,
        totalMultiplier: 1.0,
        primaryAttr: null
      };

      // 1. 确定 force 所属属性
      const forceAttr = this.attributeSystem.getAttributeForEffect(force.type);
      result.primaryAttr = forceAttr;

      // 2. 属性加成：来自 force 拥有者的属性面板
      const ownerAttrs = this.attributeSystem.getAttributes(force.ownerId);
      const attrValue = ownerAttrs[forceAttr] || 0;
      result.attrBonus = this.attributeSystem.getAttributeBonus(attrValue);

      // 3. 克制倍率：需要找到对抗目标的主属性
      const opponentAttr = this._getOpponentPrimaryAttr(force, allForces);
      if (opponentAttr) {
        result.counterMult = this.attributeSystem.getCounterMultiplier(forceAttr, opponentAttr);
      }

      // 4. 总倍率
      result.totalMultiplier = result.attrBonus * result.counterMult;

      return result;
    }

    /**
     * 推断对手的主属性
     * 规则：找到与此 force 对抗的敌方 forces 中最强的那个的属性
     * @private
     */
    _getOpponentPrimaryAttr(force, allForces) {
      const hid = this.heroId != null ? this.heroId : 0;
      const isPlayerForce = (force.ownerId === hid || force.ownerId === -2);

      // 找到敌方的同类型 forces
      const opponentForces = allForces.filter(f => {
        const isOpponentPlayer = (f.ownerId === hid || f.ownerId === -2);
        // 不同阵营
        if (isPlayerForce === isOpponentPlayer) return false;
        // 同类型对抗（fortune vs fortune, curse vs curse）
        // 或者 curse 对 fortune（诅咒对抗幸运）
        return f.type === force.type ||
               (force.type === 'fortune' && f.type === 'curse') ||
               (force.type === 'curse' && f.type === 'fortune');
      });

      if (opponentForces.length === 0) return null;

      // 取最强敌方 force 的属性
      const strongest = opponentForces.reduce((a, b) => (b.power > a.power ? b : a));
      return this.attributeSystem.getAttributeForEffect(strongest.type);
    }

    /**
     * 计算完整的力量对抗结果（供 UI 预览用）
     * @param {object} playerForce - 玩家的 force
     * @param {object} enemyForce  - 敌方的 force
     * @returns {object} 对抗详情
     */
    previewCombat(playerForce, enemyForce) {
      if (!this.attributeSystem) {
        return {
          playerPower: playerForce.power,
          enemyPower: enemyForce.power,
          netPower: playerForce.power - enemyForce.power,
          playerAttr: null,
          enemyAttr: null,
          counterMult: 1.0,
          voidDivisor: 1.0
        };
      }

      const pAttr = this.attributeSystem.getAttributeForEffect(playerForce.type);
      const eAttr = this.attributeSystem.getAttributeForEffect(enemyForce.type);

      const pAttrs = this.attributeSystem.getAttributes(playerForce.ownerId);
      const eAttrs = this.attributeSystem.getAttributes(enemyForce.ownerId);

      const pBonus = this.attributeSystem.getAttributeBonus(pAttrs[pAttr] || 0);
      const eBonus = this.attributeSystem.getAttributeBonus(eAttrs[eAttr] || 0);

      const pCounter = this.attributeSystem.getCounterMultiplier(pAttr, eAttr);
      const eCounter = this.attributeSystem.getCounterMultiplier(eAttr, pAttr);

      const pFinal = Math.round(playerForce.power * pBonus * pCounter * 10) / 10;
      const eFinal = Math.round(enemyForce.power * eBonus * eCounter * 10) / 10;

      const voidDivisor = this.switchSystem ? this.switchSystem.getVoidDivisor() : 1.0;
      const eAfterVoid = Math.round((eFinal / voidDivisor) * 10) / 10;

      return {
        playerPower: pFinal,
        enemyPower: eAfterVoid,
        netPower: Math.round((pFinal - eAfterVoid) * 10) / 10,
        playerAttr: pAttr,
        enemyAttr: eAttr,
        playerBonus: pBonus,
        enemyBonus: eBonus,
        playerCounterMult: pCounter,
        enemyCounterMult: eCounter,
        voidDivisor: voidDivisor
      };
    }
  }

