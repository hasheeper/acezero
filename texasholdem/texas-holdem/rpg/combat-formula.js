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
 *   - TraitSystem（特质被动加成）
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
      this.traitSystem = opts.traitSystem || null;
      this.heroId = opts.heroId != null ? opts.heroId : 0;
      // gameContext 由外部每轮注入，供特质判断筹码等动态条件
      this.gameContext = null;
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

      // 每次 enhance 重置 cockroach 首次 curse 减半标记
      this._cockroachUsed = {};

      const enhanced = forces.map(f => ({ ...f }));

      for (const force of enhanced) {
        const enhancement = this._calculateEnhancement(force, enhanced, context);
        force.power = Math.round(force.power * enhancement.totalMultiplier * 10) / 10;
        // 附加元数据供 UI 和日志使用
        force._attrBonus = enhancement.attrBonus;
        force._counterMult = enhancement.counterMult;
        force._primaryAttr = enhancement.primaryAttr;
      }

      // 特质加成（在属性加成之后叠加）
      this._applyTraitBonuses(enhanced, context);

      // 特质被动力注入（obsessive_love 等产生的常驻 force）
      this._injectTraitForces(enhanced);

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
          // null_armor（虚无铠装）：Void 减伤效果 +30%
          let actualDivisor = voidDivisor;
          if (this.traitSystem) {
            const na = this.traitSystem.hasEffect(this.heroId, 'void_amp_fortune_penalty');
            if (na.has && na.value.voidBonus) {
              // voidDivisor 增强 30%：例如 1.6 → 1.6 + (1.6-1)*0.3 = 1.78
              actualDivisor = voidDivisor + (voidDivisor - 1) * na.value.voidBonus;
            }
          }
          // death_ledger 穿透：诅咒无视部分 Void 减伤
          if (f._penetration && f.type === 'curse') {
            // 穿透 25% 意味着减伤效果降低 25%
            actualDivisor = 1 + (actualDivisor - 1) * (1 - f._penetration);
          }
          f.effectivePower = Math.round((f.effectivePower / actualDivisor) * 10) / 10;
          f._voidReduced = true;
          f._voidDivisor = actualDivisor;
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

    // ========== 特质加成 ==========

    /**
     * 应用特质被动加成到 forces
     * 在属性加成之后调用，叠加到 power 上
     * @private
     */
    _applyTraitBonuses(forces, context) {
      if (!this.traitSystem) return;

      for (const f of forces) {
        let traitMult = 1.0;
        let traitTag = null;

        // --- crimson_crown（绯红王冠）：拥有者的 fortune +25%（通用） ---
        if (f.type === 'fortune') {
          const cc = this.traitSystem.hasEffect(f.ownerId, 'fortune_amp_curse_vuln');
          if (cc.has) {
            traitMult *= (1 + cc.value.fortuneBonus);
            traitTag = 'crimson_crown';
          }
        }

        // --- obsessive_love（执念之爱）：筹码落后时 fortune +20%，领先时 -10%（通用） ---
        if (f.type === 'fortune' && this.gameContext) {
          const ol = this.traitSystem.hasEffect(f.ownerId, 'desperate_devotion');
          if (ol.has) {
            const ownerChips = this._getPlayerChips(f.ownerId);
            const maxOppChips = this._getMaxOpponentChipsFor(f.ownerId);
            if (ownerChips < maxOppChips) {
              traitMult *= (1 + (ol.value.behind || 0.2));
              traitTag = (traitTag ? traitTag + '+' : '') + 'obsessive_love(behind)';
            } else if (ownerChips > maxOppChips) {
              traitMult *= (1 + (ol.value.ahead || -0.1));
              traitTag = (traitTag ? traitTag + '+' : '') + 'obsessive_love(ahead)';
            }
          }
        }

        // --- binding_protocol（拘束协议）：power -10%（任何拥有此特质的角色） ---
        {
          const lp = this.traitSystem.hasEffect(f.ownerId, 'mana_efficiency');
          if (lp.has && lp.value.powerMult) {
            traitMult *= lp.value.powerMult;
            traitTag = (traitTag ? traitTag + '+' : '') + 'binding_protocol';
          }
        }

        // --- null_armor（虚无铠装）：拥有者的 fortune -15%（通用） ---
        if (f.type === 'fortune') {
          const na = this.traitSystem.hasEffect(f.ownerId, 'void_amp_fortune_penalty');
          if (na.has && na.value.fortunePenalty) {
            traitMult *= (1 - na.value.fortunePenalty);
            traitTag = (traitTag ? traitTag + '+' : '') + 'null_armor(fortune↓)';
          }
        }

        // --- steady_hand（不动心）：拥有者受到的 curse -10%（通用） ---
        if (f.type === 'curse') {
          // 检查诅咒目标是否拥有 steady_hand
          const curseTargetId = f.targetId != null ? f.targetId : this.heroId;
          if (f.ownerId !== curseTargetId) {
            const sh = this.traitSystem.hasEffect(curseTargetId, 'calm_support');
            if (sh.has && sh.value.curseReduction) {
              traitMult *= (1 - sh.value.curseReduction);
              traitTag = (traitTag ? traitTag + '+' : '') + 'steady_hand';
            }
          }
        }

        // --- crimson_crown 反面：拥有者受到的 curse +15%（通用） ---
        if (f.type === 'curse') {
          const curseTargetId2 = f.targetId != null ? f.targetId : this.heroId;
          if (f.ownerId !== curseTargetId2) {
            const ccVuln = this.traitSystem.hasEffect(curseTargetId2, 'fortune_amp_curse_vuln');
            if (ccVuln.has && ccVuln.value.curseVuln) {
              traitMult *= (1 + ccVuln.value.curseVuln);
              traitTag = (traitTag ? traitTag + '+' : '') + 'crimson_vuln';
            }
          }
        }

        // --- death_ledger：拥有者的 curse 获得穿透标记（任何拥有此特质的角色） ---
        if (f.type === 'curse') {
          const dl = this.traitSystem.hasEffect(f.ownerId, 'curse_penetration');
          if (dl.has) {
            f._penetration = dl.value.value || 0.25;
            traitTag = (traitTag ? traitTag + '+' : '') + 'death_ledger';
          }
        }

        // --- service_fee（手续费）：拥有者的 fortune -20%（通用） ---
        // TODO: mana siphon (窃取目标mana) 需要 post-resolution 钩子连接 SkillSystem.manaPools
        if (f.type === 'fortune') {
          const sf = this.traitSystem.hasEffect(f.ownerId, 'mana_siphon');
          if (sf.has && sf.value.fortunePenalty) {
            traitMult *= (1 - sf.value.fortunePenalty);
            traitTag = (traitTag ? traitTag + '+' : '') + 'service_fee(fortune↓)';
          }
        }

        // --- four_leaf_clover（四叶草）：越惨越强，被动 fortune 加成（通用） ---
        if (f.type === 'fortune' && f.activation === 'passive' && this.gameContext) {
          const flc = this.traitSystem.hasEffect(f.ownerId, 'underdog_fortune');
          if (flc.has) {
            const ownerP = this.gameContext.players ? this.gameContext.players.find(p => p.id === f.ownerId) : null;
            if (ownerP) {
              const startStack = (ownerP.chips || 0) + (ownerP.totalBet || 0);
              if (startStack > 0) {
                const chipRatio = ownerP.chips / startStack;
                if (chipRatio <= (flc.value.lowThreshold || 0.2)) {
                  // 极度绝境：+80%
                  traitMult *= (1 + (flc.value.lowBonus || 0.8));
                  traitTag = (traitTag ? traitTag + '+' : '') + 'four_leaf_clover(绝境)';
                } else if (chipRatio <= (flc.value.midThreshold || 0.5)) {
                  // 劣势：+40%
                  traitMult *= (1 + (flc.value.midBonus || 0.4));
                  traitTag = (traitTag ? traitTag + '+' : '') + 'four_leaf_clover(劣势)';
                }
              }
            }
          }
        }

        // --- cockroach（不死身）：每手牌第一次受 curse 减半（通用） ---
        if (f.type === 'curse') {
          // 检查 curse 目标是否拥有 cockroach 特质
          const curseTargetId = f.targetId != null ? f.targetId : this.heroId;
          if (curseTargetId != null) {
            const cr = this.traitSystem.hasEffect(curseTargetId, 'survival_instinct');
            if (cr.has && cr.value.firstCurseReduction) {
              // 用 _cockroachUsed 标记追踪每手牌是否已触发
              if (!this._cockroachUsed) this._cockroachUsed = {};
              if (!this._cockroachUsed[curseTargetId]) {
                traitMult *= (1 - cr.value.firstCurseReduction);
                traitTag = (traitTag ? traitTag + '+' : '') + 'cockroach(首次减半)';
                this._cockroachUsed[curseTargetId] = true;
              }
            }
          }
        }

        // --- laser_eye（镭射之眼）：Psyche 反制类 force 效果 +25%（通用） ---
        if (f.type === 'clarity' || f.type === 'refraction' || f.type === 'reversal' ||
            f.type === 'heart_read' || f.type === 'clairvoyance') {
          const le = this.traitSystem.hasEffect(f.ownerId, 'psyche_amp_mana_penalty');
          if (le.has && le.value.psycheBonus) {
            // Psyche 反制力量加成（影响 MoZ 中 curse 消除/转化的优先级权重）
            f._psycheAmp = le.value.psycheBonus;
            traitTag = (traitTag ? traitTag + '+' : '') + 'laser_eye(灵视↑)';
          }
        }

        // 应用特质倍率
        if (traitMult !== 1.0 && f.power > 0) {
          f.power = Math.round(f.power * traitMult * 10) / 10;
          f._traitMult = traitMult;
          f._traitTag = traitTag;
        }
      }
    }

    /**
     * 注入特质产生的被动 force（不依赖技能激活）
     * obsessive_love: 筹码落后时常驻 fortune P=10，领先时 curse P=5 指向 hero
     * @private
     */
    _injectTraitForces(forces) {
      if (!this.traitSystem || !this.gameContext) return;

      // --- obsessive_love 被动 fortune/curse（通用：所有拥有该特质的玩家） ---
      if (this.gameContext && this.gameContext.players) {
        for (const p of this.gameContext.players) {
          if (p.folded) continue;
          const ol = this.traitSystem.hasEffect(p.id, 'desperate_devotion');
          if (!ol.has) continue;
          const ownerChips = this._getPlayerChips(p.id);
          const maxOppChips = this._getMaxOpponentChipsFor(p.id);

          if (ownerChips < maxOppChips && ol.value.passiveBehind) {
            forces.push({
              ownerId: p.id,
              ownerName: '执念之爱',
              type: 'fortune',
              power: ol.value.passiveBehind,
              effectivePower: ol.value.passiveBehind,
              tier: 99,
              activation: 'passive',
              source: 'trait',
              _traitTag: 'obsessive_love(被动·落后)',
              _traitInjected: true
            });
          } else if (ownerChips > maxOppChips && ol.value.passiveAhead) {
            const oppId = this._getFirstOpponentIdFor(p.id);
            if (oppId != null) {
              forces.push({
                ownerId: oppId,
                ownerName: '执念反噬',
                type: 'curse',
                power: Math.abs(ol.value.passiveAhead),
                effectivePower: Math.abs(ol.value.passiveAhead),
                targetId: p.id,
                tier: 99,
                activation: 'passive',
                source: 'trait',
                _traitTag: 'obsessive_love(被动·领先)',
                _traitInjected: true
              });
            }
          }
        }
      }
    }

    /**
     * 获取第一个非 hero 的活跃玩家ID
     * @private
     */
    _getFirstOpponentId() {
      return this._getFirstOpponentIdFor(this.heroId);
    }

    /**
     * 获取指定玩家的筹码
     * @private
     */
    _getPlayerChips(playerId) {
      if (!this.gameContext || !this.gameContext.players) return 0;
      const p = this.gameContext.players.find(pp => pp.id === playerId);
      return p ? (p.chips || 0) : 0;
    }

    /**
     * 获取指定玩家的对手中最高筹码
     * @private
     */
    _getMaxOpponentChipsFor(playerId) {
      if (!this.gameContext || !this.gameContext.players) return 0;
      let max = 0;
      for (const p of this.gameContext.players) {
        if (p.id === playerId) continue;
        if (p.folded) continue;
        if ((p.chips || 0) > max) max = p.chips;
      }
      return max;
    }

    /**
     * 获取指定玩家的第一个对手 ID
     * @private
     */
    _getFirstOpponentIdFor(playerId) {
      if (!this.gameContext || !this.gameContext.players) return null;
      for (const p of this.gameContext.players) {
        if (p.id === playerId) continue;
        if (!p.folded) return p.id;
      }
      return null;
    }

    /**
     * 获取 hero 当前筹码
     * @private
     */
    _getHeroChips() {
      if (!this.gameContext || !this.gameContext.players) return 0;
      const hero = this.gameContext.players.find(p => p.id === this.heroId);
      return hero ? (hero.chips || 0) : 0;
    }

    /**
     * 获取对手中最高筹码
     * @private
     */
    _getMaxOpponentChips() {
      if (!this.gameContext || !this.gameContext.players) return 0;
      let max = 0;
      for (const p of this.gameContext.players) {
        if (p.id === this.heroId) continue;
        if (p.folded) continue;
        if ((p.chips || 0) > max) max = p.chips;
      }
      return max;
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

