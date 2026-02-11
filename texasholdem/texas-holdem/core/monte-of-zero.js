/* global Hand */

/**
 * Monte of Zero Model — 蒙特卡洛零模型 v3
 * 《零之王牌》纯命运引擎
 *
 * v3 重构：纯引擎，不管技能/mana/注册
 *   技能系统由 skill-system.js 管理，
 *   本模块只负责：接收 forces 列表 → 选牌。
 *
 * 公式: Score(Card_X) = Σ (Power × Outcome) + StyleBonus
 *   fortune:  Power × (持有者胜率 0~1)
 *   curse:    Power × (目标败率 0~1)
 *   backlash: Power × (Rino败率 0~1)
 *   style:    STYLE_WEIGHTS[handRank] + drawBonus + monotonyPenalty
 *
 * 时髦命运(Style Bias): 不改变谁赢，改变怎么赢
 *   顺子/同花 >> 对子，听牌状态额外加分，连续同牌型惩罚
 *
 * 现实(purge_all) → 绝对优先，打碎一切命运回归纯随机
 */

(function (global) {
  'use strict';

  // ========== 常量 ==========
  const SUIT_MAP = { 0: 's', 1: 'h', 2: 'c', 3: 'd' };
  const RANK_MAP = { 1: 'A', 2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: 'T', 11: 'J', 12: 'Q', 13: 'K' };

  // pokersolver hand.rank: 9=SF, 8=4K, 7=FH, 6=Flush, 5=Straight, 4=3K, 3=2P, 2=1P, 1=HC
  // 权重设计原则：顺子/同花的加分必须足够大，能在 destinyScore 中产生可见影响
  // destinyScore 典型范围: 5~15，所以 style 需要在 2~8 的量级才能真正影响选牌
  const STYLE_WEIGHTS = {
    9: 25,   // Straight Flush  - 极致戏剧性
    8: 6,    // Four of a Kind  - 强但视觉单调
    7: 8,    // Full House      - 经典赌神牌型
    6: 15,   // Flush           - 同花，视觉冲击强
    5: 12,   // Straight        - 顺子，叙事感强
    4: 3,    // Three of a Kind - 微弱加分
    3: 0,    // Two Pair        - 基线
    2: -3,   // One Pair        - 惩罚，避免单调
    1: 0     // High Card       - 基线
  };

  // ========== 工具函数 ==========
  function cardToSolverString(card) {
    if (!card) return '';
    return RANK_MAP[card.rank] + SUIT_MAP[card.suit];
  }

  // ========== MonteOfZero 类 ==========
  class MonteOfZero {
    constructor() {
      // 上一次筛选的元数据
      this.lastSelectionMeta = null;

      // 日志回调
      this.onLog = null;

      // 是否启用
      this.enabled = true;

      // 调试模式
      this.debugMode = false;
      this.debugTimeline = [];  // 每次 selectCard 的完整时间线

      // 时髦命运 (Style Bias)
      this.styleBias = true;           // 总开关
      this.styleIntensity = 1.0;       // 强度倍率 (0~2)
      this._handHistory = [];          // 近期赢家牌型记录 [{rank, name}]
      this._historyMaxLen = 5;         // 记录最近N手

      // 战斗公式钩子（属性加成 + 克制倍率 + Void 减伤）
      // 由外部注入 CombatFormula 实例
      this.combatFormula = null;
    }

    // ========== 核心：权重叠加选牌 ==========

    /**
     * 从牌堆中选择一张牌（核心方法 v3 — 纯引擎）
     *
     * @param {Array} deckCards - 牌堆中剩余的牌
     * @param {Array} currentBoard - 当前公共牌
     * @param {Array} players - 玩家数组 [{ id, cards, folded }]
     * @param {Array} forces - 当前生效的力列表（由 SkillSystem 提供）
     * @param {object} options - { rinoPlayerId: 0 }
     * @returns {object} { card, meta }
     */
    selectCard(deckCards, currentBoard, players, forces, options) {
      options = options || {};
      const rinoPlayerId = options.rinoPlayerId != null ? options.rinoPlayerId : 0;

      // ---- 调试时间线 ----
      if (this.debugMode) {
        this.debugTimeline = [];
        this._debugPush('ROUND_START', {
          phase: options.phase || '?',
          deckRemaining: deckCards.length,
          boardCards: currentBoard.length,
          inputForces: forces.map(f => ({
            owner: f.ownerName || f.ownerId,
            type: f.type, attr: f.attr, tier: f.tier,
            power: f.power, activation: f.activation, skillKey: f.skillKey
          }))
        });
      }

      if (!this.enabled) {
        if (this.debugMode) this._debugPush('ENGINE_DISABLED', { result: 'random' });
        return this._randomSelect(deckCards);
      }

      // ---- purge_all 检查（现实：绝对优先，打碎一切命运） ----
      const hasPurge = forces.some(f => f.type === 'purge_all');
      if (hasPurge) {
        this._log('PURGE_ALL_OVERRIDE', { message: 'Reality override — destiny shattered back to chaos' });
        if (this.debugMode) this._debugPush('PURGE_ALL', { message: '现实发动 → 全场归零，纯随机' });
        return this._randomSelect(deckCards);
      }

      // ---- 属性加成 + 克制倍率注入（CombatFormula 钩子） ----
      let enhancedForces = forces;
      if (this.combatFormula) {
        enhancedForces = this.combatFormula.enhanceForces(forces, { players: players });
        this._log('COMBAT_ENHANCE', {
          enhanced: enhancedForces.filter(f => f._attrBonus !== undefined).map(f => ({
            owner: f.ownerName || f.ownerId,
            type: f.type,
            rawPower: forces.find(o => o.ownerId === f.ownerId && o.type === f.type)?.power,
            enhancedPower: f.power,
            attr: f._primaryAttr,
            counter: f._counterMult
          }))
        });
      }

      // 过滤掉非发牌力（sense, peek 等），保留 meta 力（null_field, void_shield, reversal）
      const dealForces = enhancedForces.filter(f =>
        f.type === 'fortune' || f.type === 'curse' || f.type === 'backlash'
      );
      const metaForces = enhancedForces.filter(f =>
        f.type === 'null_field' || f.type === 'void_shield' || f.type === 'reversal'
      );

      // 如果没有任何力在生效，纯随机
      if (dealForces.length === 0 && metaForces.length === 0) {
        return this._randomSelect(deckCards);
      }
      if (dealForces.length === 0) {
        return this._randomSelect(deckCards);
      }

      // ---- 生成所有平行宇宙 ----
      const activePlayers = players.filter(p => !p.folded && p.cards && p.cards.length >= 2);
      const universes = this._generateUniverses(deckCards, currentBoard, activePlayers);

      if (universes.length === 0) {
        return this._randomSelect(deckCards);
      }

      if (this.debugMode) {
        this._debugPush('UNIVERSES', { count: universes.length });
      }

      // ---- 权重叠加：为每个宇宙计算命运分 ----
      // 传入 dealForces + metaForces，opposition 需要看到 meta 力
      this._calculateDestinyScores(universes, dealForces.concat(metaForces));

      // ---- 选牌策略：始终使用加权概率 ----
      const sorted = [...universes].sort((a, b) => b.destinyScore - a.destinyScore);

      // 计算每张牌的概率（softmax）
      const temperature = 1.0;
      const scores = universes.map(u => u.destinyScore);
      const maxScore = Math.max(...scores);
      const weights = universes.map(u => Math.exp((u.destinyScore - maxScore) / temperature));
      const totalWeight = weights.reduce((sum, w) => sum + w, 0);
      // 为 sorted 数组计算概率
      const sortedProbs = sorted.map(u => {
        const idx = universes.indexOf(u);
        return weights[idx] / totalWeight;
      });

      let selectedUniverse = this._selectByWeightedRandom(universes);

      // 找出选中牌在排序中的位置
      const selectedRank = sorted.findIndex(u => u.card === selectedUniverse.card);

      // 构建 top candidates 列表（前5名 + 选中的牌如果不在前5）
      const topN = 5;
      const topCandidates = sorted.slice(0, topN).map((u, i) => ({
        card: cardToSolverString(u.card),
        score: u.destinyScore,
        prob: Math.round(sortedProbs[i] * 1000) / 10,
        selected: u.card === selectedUniverse.card,
        rinoWins: u.winnerIds.includes(rinoPlayerId)
      }));
      // 如果选中的牌不在 top5，追加到末尾
      if (selectedRank >= topN) {
        const selIdx = universes.indexOf(selectedUniverse);
        topCandidates.push({
          card: cardToSolverString(selectedUniverse.card),
          score: selectedUniverse.destinyScore,
          prob: Math.round((weights[selIdx] / totalWeight) * 1000) / 10,
          selected: true,
          rank: selectedRank + 1,
          rinoWins: selectedUniverse.winnerIds.includes(rinoPlayerId)
        });
      }

      if (this.debugMode) {
        this._debugPush('CARD_SELECTED', {
          card: cardToSolverString(selectedUniverse.card),
          destinyScore: selectedUniverse.destinyScore,
          styleBonus: selectedUniverse.styleBonus || 0,
          breakdown: selectedUniverse.forceBreakdown,
          rank: selectedRank + 1,
          totalCandidates: universes.length,
          top3: sorted.slice(0, 3).map(u => ({
            card: cardToSolverString(u.card), score: u.destinyScore,
            style: u.styleBonus || 0, breakdown: u.forceBreakdown
          })),
          bottom3: sorted.slice(-3).map(u => ({
            card: cardToSolverString(u.card), score: u.destinyScore
          }))
        });
      }

      // ---- 记录赢家牌型（反单调系统） ----
      const fortuneForces = dealForces.filter(f => f.type === 'fortune');
      const fortuneOwnerIds = [...new Set(fortuneForces.map(f => f.ownerId))];
      this._recordHandResult(selectedUniverse, fortuneOwnerIds);

      // ---- 保存元数据 ----
      this.lastSelectionMeta = {
        activeForces: dealForces.map(f => ({
          ownerId: f.ownerId,
          owner: f.ownerName || f.ownerId,
          type: f.type,
          attr: f.attr,
          tier: f.tier,
          power: f.power
        })),
        totalUniverses: universes.length,
        selectedCard: cardToSolverString(selectedUniverse.card),
        selectedRank: selectedRank + 1,
        destinyScore: selectedUniverse.destinyScore,
        styleBonus: selectedUniverse.styleBonus || 0,
        forceBreakdown: selectedUniverse.forceBreakdown,
        topCandidates: topCandidates,
        winnerIds: selectedUniverse.winnerIds,
        scores: selectedUniverse.scores,
        handDescriptions: selectedUniverse.handDescriptions,
        dramaticShift: this._calculateDramaticShift(universes, selectedUniverse, rinoPlayerId),
        debugTimeline: this.debugMode ? [...this.debugTimeline] : null
      };

      this._log('DESTINY_SELECT', {
        card: this.lastSelectionMeta.selectedCard,
        destinyScore: selectedUniverse.destinyScore,
        styleBonus: selectedUniverse.styleBonus || 0,
        forces: this.lastSelectionMeta.activeForces,
        breakdown: selectedUniverse.forceBreakdown
      });

      return {
        card: selectedUniverse.card,
        meta: this.lastSelectionMeta
      };
    }

    // ========== 先知能力（纯计算，不管技能消耗） ==========

    /**
     * 预览命运的多条路径
     * @param {Array} deckCards
     * @param {Array} currentBoard
     * @param {Array} players
     * @param {Array} forces - 当前力列表
     * @param {number} rinoPlayerId
     * @returns {Array} [{ card, label, score, rinoScore }]
     */
    foresight(deckCards, currentBoard, players, forces, rinoPlayerId) {
      const activePlayers = players.filter(p => !p.folded && p.cards && p.cards.length >= 2);
      const universes = this._generateUniverses(deckCards, currentBoard, activePlayers);

      if (universes.length === 0) return [];

      const dealForces = (forces || []).filter(f =>
        f.type === 'fortune' || f.type === 'curse' || f.type === 'backlash'
      );

      if (dealForces.length > 0) {
        this._calculateDestinyScores(universes, dealForces);
      } else {
        universes.forEach(u => { u.destinyScore = u.scores[rinoPlayerId] || 0; });
      }

      const sorted = [...universes].sort((a, b) => b.destinyScore - a.destinyScore);

      const best = sorted[0];
      const mid = sorted[Math.floor(sorted.length / 2)];
      const worst = sorted[sorted.length - 1];

      return [
        { card: cardToSolverString(best.card), label: 'BEST', score: best.destinyScore, rinoScore: best.scores[rinoPlayerId] },
        { card: cardToSolverString(mid.card), label: 'NEUTRAL', score: mid.destinyScore, rinoScore: mid.scores[rinoPlayerId] },
        { card: cardToSolverString(worst.card), label: 'WORST', score: worst.destinyScore, rinoScore: worst.scores[rinoPlayerId] }
      ];
    }

    // ========== 命运分计算 ==========

    /**
     * 为每个宇宙计算命运分（权重叠加核心 v2 — 力量对抗）
     *
     * 力量对抗规则：
     *   1. 被动技能是微弱底色(power = level×3)，主动技能是决定性力量(power = level×10)
     *   2. 同类型力量(fortune vs fortune)来自不同阵营时互相抵消
     *   3. 主动力量压制被动力量：主动fortune可以削弱敌方被动fortune
     *   4. 等级差产生额外优势：高等级主动技能碾压低等级
     */
    _calculateDestinyScores(universes, forces) {
      // ---- 预处理：力量对抗 ----
      const resolvedForces = this._resolveForceOpposition(forces);

      // ---- 提取命运受益者信息（用于时髦分） ----
      const fortuneForces = resolvedForces.filter(f => f.type === 'fortune' && f.effectivePower > 0);
      const fortuneOwnerIds = [...new Set(fortuneForces.map(f => f.ownerId))];
      // 用原始 power 而非 effectivePower 来缩放时髦分
      // 玩家激活大吉(power=50)的意图应该影响风格偏好，不应被对抗削弱
      const maxRawFortunePower = fortuneForces.length > 0
        ? Math.max(...fortuneForces.map(f => f.power))
        : 0;

      for (const u of universes) {
        let destinyScore = 0;
        const breakdown = {};

        for (const force of resolvedForces) {
          if (force.effectivePower <= 0) continue; // 被完全压制

          let contribution = 0;
          const forceKey = (force.ownerName || force.ownerId) + '_' + force.type;

          switch (force.type) {
            case 'fortune': {
              const ownerScore = u.scores[force.ownerId] || 0;
              const outcome = ownerScore / 100;
              contribution = force.effectivePower * outcome;
              break;
            }
            case 'curse': {
              const targetId = force.targetId != null ? force.targetId : 0;
              const targetScore = u.scores[targetId] || 0;
              const loseRate = 1 - (targetScore / 100);
              contribution = force.effectivePower * loseRate;
              break;
            }
            case 'backlash': {
              const rinoScore = u.scores[force.targetId] || 0;
              const rinoLoseRate = 1 - (rinoScore / 100);
              contribution = force.effectivePower * rinoLoseRate;
              break;
            }
          }

          destinyScore += contribution;
          breakdown[forceKey] = Math.round(contribution * 10) / 10;
        }

        // ---- 时髦命运加分 ----
        const styleBonus = this._calculateStyleBonus(u, fortuneOwnerIds, maxRawFortunePower);
        if (styleBonus !== 0) {
          destinyScore += styleBonus;
          breakdown['style_bias'] = styleBonus;
        }

        u.destinyScore = Math.round(destinyScore * 10) / 10;
        u.forceBreakdown = breakdown;
        u.styleBonus = styleBonus;
      }
    }

    /**
     * 力量对抗：同类型力量互相抵消，主动压制被动
     * 返回带 effectivePower 的 force 列表
     */
    _resolveForceOpposition(forces) {
      // 复制并初始化 effectivePower
      const resolved = forces.map(f => ({
        ...f,
        effectivePower: f.power
      }));

      if (this.debugMode) {
        this._debugPush('OPPOSITION_START', {
          forces: resolved.map(f => ({
            owner: f.ownerName || f.ownerId, type: f.type,
            attr: f.attr, tier: f.tier, power: f.power, activation: f.activation
          }))
        });
      }

      // ======== 阶级压制阶段（T1 优先结算） ========
      this._applyTierSuppression(resolved);

      if (this.debugMode) {
        const suppressed = resolved.filter(f => f._suppressed);
        if (suppressed.length > 0) {
          this._debugPush('TIER_SUPPRESSION', {
            suppressed: suppressed.map(f => ({
              owner: f.ownerName || f.ownerId, type: f.type,
              suppressedBy: f._suppressedBy
            }))
          });
        }
      }

      // ======== 绝缘 (void_shield) 阶段 ========
      // Void T2 被动：敌方 Moirai/Chaos 效果减半
      this._applyInsulation(resolved);

      // 按类型分组（只处理 fortune 和 curse 的对抗）
      const fortuneForces = resolved.filter(f => f.type === 'fortune' && !f._suppressed);
      const curseForces = resolved.filter(f => f.type === 'curse' && !f._suppressed);

      // ---- Fortune 对抗 ----
      // 分为玩家方(ownerId===0)和NPC方
      this._resolveTypeOpposition(fortuneForces);

      // ---- Curse 对抗（如果有多方诅咒） ----
      this._resolveTypeOpposition(curseForces);

      // ======== T2/T3 属性克制加成 ========
      // Chaos > Moirai: curse 对抗 fortune 时获得 10% 克制加成
      const COUNTER_BONUS = 0.10;
      for (const cf of curseForces) {
        if (cf._suppressed) continue;
        // 只在存在对立 fortune 时生效（拔河场景）
        const hasOpposingFortune = fortuneForces.some(ff => !ff._suppressed && ff.ownerId !== cf.ownerId);
        if (hasOpposingFortune) {
          cf.effectivePower = Math.round(cf.effectivePower * (1 + COUNTER_BONUS) * 10) / 10;
          cf._counterBonus = true;
        }
      }

      // Psyche > Chaos: 拥有 psyche 信息技能的一方，削弱敌方 curse
      // 洞察(sense)被动 → -15%，透视(peek)主动 → -25%
      const psycheInfoForces = resolved.filter(f => !f._suppressed && (f.type === 'sense' || f.type === 'peek' || f.effect === 'sense' || f.effect === 'peek'));
      if (psycheInfoForces.length > 0) {
        const psycheOwnerIds = new Set(psycheInfoForces.map(f => f.ownerId));
        const hasActivePeek = psycheInfoForces.some(f => f.type === 'peek' || f.effect === 'peek');
        const clarityReduction = hasActivePeek ? 0.25 : 0.15;
        for (const cf of curseForces) {
          if (cf._suppressed) continue;
          // 只削弱敌方的 curse（不削弱自己的）
          if (psycheOwnerIds.has(cf.ownerId)) continue;
          cf.effectivePower = Math.round(cf.effectivePower * (1 - clarityReduction) * 10) / 10;
          cf._clarityReduced = true;
        }
      }

      if (this.debugMode) {
        const countered = resolved.filter(f => f._counterBonus || f._clarityReduced);
        if (countered.length > 0) {
          this._debugPush('ATTR_COUNTER', {
            countered: countered.map(f => ({
              owner: f.ownerName || f.ownerId, type: f.type,
              effectivePower: f.effectivePower,
              counterBonus: !!f._counterBonus,
              clarityReduced: !!f._clarityReduced
            }))
          });
        }
      }

      // ---- 主动 vs 被动压制：主动技能削弱敌方被动技能 ----
      const playerActiveF = fortuneForces.filter(f => f.ownerId === 0 && f.activation === 'active');
      const npcPassiveF = fortuneForces.filter(f => f.ownerId !== 0 && f.activation === 'passive');
      if (playerActiveF.length > 0 && npcPassiveF.length > 0) {
        // 主动技能 tier 越低（越强），压制越大
        const bestTier = Math.min(...playerActiveF.map(f => f.tier));
        for (const nf of npcPassiveF) {
          if (bestTier < nf.tier) {
            const suppressRatio = Math.max(0.1, 1 - (nf.tier - bestTier) * 0.3);
            nf.effectivePower = Math.round(nf.effectivePower * suppressRatio * 10) / 10;
          }
        }
      }

      // NPC的主动fortune也可以削弱玩家的被动fortune
      const npcActiveF = fortuneForces.filter(f => f.ownerId !== 0 && f.activation === 'active');
      const playerPassiveF = fortuneForces.filter(f => f.ownerId === 0 && f.activation === 'passive');
      if (npcActiveF.length > 0 && playerPassiveF.length > 0) {
        const bestTier = Math.min(...npcActiveF.map(f => f.tier));
        for (const pf of playerPassiveF) {
          if (bestTier < pf.tier) {
            const suppressRatio = Math.max(0.1, 1 - (pf.tier - bestTier) * 0.3);
            pf.effectivePower = Math.round(pf.effectivePower * suppressRatio * 10) / 10;
          }
        }
      }

      // ---- 屏蔽 (null_field): Void T3 被动，削弱所有被动力量 ----
      const nullFieldForces = resolved.filter(f => f.type === 'null_field' && !f._suppressed);
      if (nullFieldForces.length > 0) {
        // 屏蔽力量固定为 power=8，削弱所有被动力量 30%
        const nullReduction = 0.3;
        for (const f of resolved) {
          if (f._suppressed) continue;
          if (f.activation === 'passive' && (f.type === 'fortune' || f.type === 'curse')) {
            f.effectivePower = Math.round(f.effectivePower * (1 - nullReduction) * 10) / 10;
          }
        }
      }

      // ---- 真理 (reversal): Psyche T1，拦截 Chaos 系效果并逆转为己方 fortune ----
      const reversalForces = resolved.filter(f => f.type === 'reversal' && !f._suppressed);
      if (reversalForces.length > 0) {
        const reversalOwner = reversalForces[0]; // 取第一个 reversal 持有者
        const CONVERSION_RATIO = 0.7; // 转化率：70% 的 curse power 变为 fortune

        for (const f of resolved) {
          if (f._suppressed) continue;
          if (f.attr === 'chaos' && f.ownerId !== reversalOwner.ownerId) {
            // 拦截：记录原始 curse power，然后压制
            const stolenPower = Math.round(f.effectivePower * CONVERSION_RATIO * 10) / 10;
            f.effectivePower = 0;
            f._suppressed = true;
            f._suppressedBy = 'reversal';
            f._reversedPower = stolenPower;

            // 逆转：创建一个新的 fortune force 归属于 reversal 持有者
            resolved.push({
              ownerId: reversalOwner.ownerId,
              ownerName: reversalOwner.ownerName,
              type: 'fortune',
              power: stolenPower,
              effectivePower: stolenPower,
              activation: 'active',
              source: 'reversal',
              tier: 1,
              attr: 'psyche',
              skillKey: 'axiom_converted',
              _converted: true,
              _convertedFrom: f.skillKey || f.type
            });

            if (this.debugMode) {
              this._debugPush('REVERSAL_CONVERT', {
                intercepted: { owner: f.ownerName || f.ownerId, type: f.type, originalPower: f.power },
                converted: { owner: reversalOwner.ownerName, type: 'fortune', power: stolenPower },
                ratio: CONVERSION_RATIO
              });
            }
          }
        }
      }

      // ---- Void 减伤（CombatFormula 钩子） ----
      // Kazu 在前台时，敌方所有魔法效果 ÷ voidDivisor
      if (this.combatFormula) {
        this.combatFormula.applyVoidReduction(resolved);
      }

      if (this.debugMode) {
        this._debugPush('OPPOSITION_RESULT', {
          resolved: resolved.map(f => ({
            owner: f.ownerName || f.ownerId, type: f.type, attr: f.attr,
            power: f.power, effectivePower: f.effectivePower,
            suppressed: !!f._suppressed, suppressedBy: f._suppressedBy || null,
            converted: !!f._converted, convertedFrom: f._convertedFrom || null,
            voidReduced: !!f._voidReduced
          }))
        });
      }

      return resolved;
    }

    /**
     * 阶级压制：T1 终极技优先结算
     * 规则：
     *   1. suppressTiers: 无效化同属性的低阶技能 (天命 → 无效化小吉/大吉)
     *   2. suppressAttr: 无效化特定属性的所有技能 (真理 → 净化 Chaos)
     *   3. suppressAll: 清除所有非 Void 技能 (现实 → 物理回滚)
     *   4. T1 vs T1 巅峰对决：power 碰撞，属性克制给 1.5x 优势
     *   5. cannotAffect: 某些属性免疫压制 (真理无法干涉天命)
     */
    _applyTierSuppression(resolved) {
      const t1Forces = resolved.filter(f => f.tier === 1 && !f._suppressed);
      if (t1Forces.length === 0) return;

      // 属性克制环 (用于 T1 vs T1)
      const COUNTER = { chaos: 'moirai', moirai: 'psyche', psyche: 'chaos' };
      const ADV_MULT = 1.5;

      // 先处理 T1 vs T1 碰撞（不同阵营的 T1 互相对抗）
      const playerT1 = t1Forces.filter(f => f.ownerId === 0);
      const npcT1 = t1Forces.filter(f => f.ownerId !== 0);

      if (playerT1.length > 0 && npcT1.length > 0) {
        for (const pt1 of playerT1) {
          for (const nt1 of npcT1) {
            if (pt1._suppressed || nt1._suppressed) continue;

            let pPower = pt1.effectivePower;
            let nPower = nt1.effectivePower;

            // 属性克制加成
            if (pt1.attr && nt1.attr && COUNTER[pt1.attr] === nt1.attr) {
              pPower = Math.round(pPower * ADV_MULT);
            }
            if (nt1.attr && pt1.attr && COUNTER[nt1.attr] === pt1.attr) {
              nPower = Math.round(nPower * ADV_MULT);
            }

            // 碰撞：败者被压制
            if (pPower > nPower) {
              nt1.effectivePower = 0;
              nt1._suppressed = true;
              nt1._suppressedBy = pt1.skillKey;
              // 胜者保留差值比例
              pt1.effectivePower = Math.round(pt1.effectivePower * ((pPower - nPower) / pPower) * 10) / 10;
            } else if (nPower > pPower) {
              pt1.effectivePower = 0;
              pt1._suppressed = true;
              pt1._suppressedBy = nt1.skillKey;
              nt1.effectivePower = Math.round(nt1.effectivePower * ((nPower - pPower) / nPower) * 10) / 10;
            } else {
              // 完全抵消
              pt1.effectivePower = 0;
              nt1.effectivePower = 0;
              pt1._suppressed = true;
              nt1._suppressed = true;
            }
          }
        }
      }

      // 存活的 T1 执行压制效果
      for (const t1 of t1Forces) {
        if (t1._suppressed) continue;

        // 1. suppressTiers: 无效化同属性的低阶技能
        if (t1.suppressTiers) {
          for (const f of resolved) {
            if (f === t1 || f._suppressed) continue;
            if (f.tier && t1.suppressTiers.indexOf(f.tier) >= 0) {
              // 同属性才压制（天命只压制 Moirai 系的小吉/大吉）
              if (f.attr === t1.attr) {
                f.effectivePower = 0;
                f._suppressed = true;
                f._suppressedBy = t1.skillKey;
              }
            }
          }
        }

        // 2. suppressAttr: 无效化特定属性的所有技能 (真理 vs Chaos)
        if (t1.suppressAttr) {
          for (const f of resolved) {
            if (f === t1 || f._suppressed) continue;
            if (f.attr === t1.suppressAttr) {
              f.effectivePower = 0;
              f._suppressed = true;
              f._suppressedBy = t1.skillKey;
            }
          }
        }

        // 3. suppressAll: 清除所有非 Void 技能 (现实)
        if (t1.suppressAll) {
          for (const f of resolved) {
            if (f === t1 || f._suppressed) continue;
            if (f.attr !== 'void') {
              f.effectivePower = 0;
              f._suppressed = true;
              f._suppressedBy = t1.skillKey;
            }
          }
        }
      }
    }

    /**
     * 绝缘 (void_shield): Void T2 被动效果
     * 敌方的 Moirai/Chaos 效果对绝缘持有者减半
     */
    _applyInsulation(resolved) {
      const shieldForces = resolved.filter(f => f.type === 'void_shield' && !f._suppressed);
      if (shieldForces.length === 0) return;

      for (const shield of shieldForces) {
        const shieldOwnerId = shield.ownerId;
        // 找到针对此持有者的敌方 Moirai/Chaos forces
        for (const f of resolved) {
          if (f._suppressed) continue;
          if (f.ownerId === shieldOwnerId) continue; // 己方不受影响
          // 只减半 fortune (Moirai) 和 curse (Chaos) 效果
          if (f.attr === 'moirai' || f.attr === 'chaos' ||
              f.type === 'fortune' || f.type === 'curse') {
            f.effectivePower = Math.round(f.effectivePower * 0.5 * 10) / 10;
            f._insulationReduced = true;
          }
        }
      }
    }

    /**
     * 同类型力量对抗：不同阵营的同类力量互相削弱
     * 主动 vs 被动 → 主动方保留更多力量
     */
    _resolveTypeOpposition(typedForces) {
      if (typedForces.length < 2) return;

      // 分阵营
      const playerSide = typedForces.filter(f => f.ownerId === 0);
      const npcSide = typedForces.filter(f => f.ownerId !== 0);

      if (playerSide.length === 0 || npcSide.length === 0) return;

      // 计算各方总力量
      const playerTotal = playerSide.reduce((s, f) => s + f.effectivePower, 0);
      const npcTotal = npcSide.reduce((s, f) => s + f.effectivePower, 0);

      if (playerTotal <= 0 || npcTotal <= 0) return;

      // 互相抵消：弱方被完全抵消，强方保留差值
      const netPower = playerTotal - npcTotal;

      if (netPower > 0) {
        // 玩家方更强：NPC方全部归零，玩家方按比例保留
        for (const f of npcSide) { f.effectivePower = 0; }
        const ratio = netPower / playerTotal;
        for (const f of playerSide) { f.effectivePower = Math.round(f.effectivePower * ratio * 10) / 10; }
      } else if (netPower < 0) {
        // NPC方更强
        for (const f of playerSide) { f.effectivePower = 0; }
        const ratio = Math.abs(netPower) / npcTotal;
        for (const f of npcSide) { f.effectivePower = Math.round(f.effectivePower * ratio * 10) / 10; }
      } else {
        // 完全抵消
        for (const f of typedForces) { f.effectivePower = 0; }
      }
    }

    // ========== 时髦命运 (Style Bias System) ==========

    /**
     * 计算某个宇宙中命运受益者的牌型时髦分
     * 只对命运的“赢家”计算时髦分，不会改变谁赢，只改变“怎么赢”
     *
     * @param {object} universe - 平行宇宙对象
     * @param {Array} fortuneOwnerIds - 命运受益者ID列表
     * @param {number} maxFortunePower - 最强命运力量（用于缩放时髦影响）
     * @returns {number} styleBonus
     */
    _calculateStyleBonus(universe, fortuneOwnerIds, maxFortunePower) {
      if (!this.styleBias || fortuneOwnerIds.length === 0) return 0;

      let totalStyle = 0;

      for (const ownerId of fortuneOwnerIds) {
        const hand = universe.hands[ownerId];
        if (!hand) continue;

        const rank = hand.rank || 1;
        const baseStyle = STYLE_WEIGHTS[rank] || 0;

        // 听牌加分：如果当前差一张成顺/同花，额外加分鼓励“保留悬念”
        const drawBonus = this._detectDrawPotential(universe, ownerId);

        // 反单调惩罚：连续出同类型牌时降低分数
        const monotonyPenalty = this._getMonotonyPenalty(rank);

        totalStyle += baseStyle + drawBonus + monotonyPenalty;
      }

      // 时髦分随命运力量缩放：弱被动命运几乎不关心时髦，强主动命运积极追求戏剧性
      // 用原始 power: passive 3~6 -> 0.15~0.3, active 30~50 -> 0.75~1.0
      // 最低 0.3 保底，确保即使被动技能也有一定风格偏好
      const powerFactor = Math.max(0.3, Math.min(1.0, maxFortunePower / 40));
      const finalBonus = totalStyle * powerFactor * this.styleIntensity;

      return Math.round(finalBonus * 10) / 10;
    }

    /**
     * 听牌检测：当前是否差一张成顺子或同花
     * 如果是，返回正分数鼓励引擎“保留听牌”而不是立刻完成对子
     */
    _detectDrawPotential(universe, playerId) {
      const hand = universe.hands[playerId];
      if (!hand || !hand.cardPool) return 0;

      const rank = hand.rank || 1;
      // 如果已经成顺/同花，不需要听牌加分
      if (rank >= 5) return 0;

      let bonus = 0;
      const cards = hand.cardPool || [];

      // 检测同花听牌：4张同花色
      const suitCounts = {};
      for (const c of cards) {
        suitCounts[c.suit] = (suitCounts[c.suit] || 0) + 1;
      }
      for (const suit in suitCounts) {
        if (suitCounts[suit] === 4) {
          bonus += 8; // 同花听牌，强加分——下一张可能成同花
          break;
        }
      }

      // 检测顺子听牌：4张连续牌
      const ranks = cards.map(c => c.rank).filter(r => r != null);
      const uniqueRanks = [...new Set(ranks)].sort((a, b) => a - b);
      // 也检查 A-low (A=1 在 pokersolver 中 rank=14，但也可以当 1)
      for (let i = 0; i <= uniqueRanks.length - 4; i++) {
        const span = uniqueRanks[i + 3] - uniqueRanks[i];
        if (span <= 4) { // 4张牌跨度<=4 = open-ended 或 gutshot
          bonus += (span === 3) ? 6 : 4; // open-ended +6, gutshot +4
          break;
        }
      }

      // 3张同花色也给小加分（预热）
      for (const suit in suitCounts) {
        if (suitCounts[suit] === 3) {
          bonus += 2;
          break;
        }
      }

      // 3张连续牌也给小加分
      for (let i = 0; i <= uniqueRanks.length - 3; i++) {
        const span = uniqueRanks[i + 2] - uniqueRanks[i];
        if (span <= 3) {
          bonus += 2;
          break;
        }
      }

      return bonus;
    }

    /**
     * 反单调惩罚：连续出同类型牌时降低分数
     * 连续2手对子 -> -3, 连续3手 -> -6
     */
    _getMonotonyPenalty(currentRank) {
      if (this._handHistory.length === 0) return 0;

      let streak = 0;
      for (let i = this._handHistory.length - 1; i >= 0; i--) {
        if (this._handHistory[i].rank === currentRank) {
          streak++;
        } else {
          break;
        }
      }

      if (streak === 0) return 0;

      // 对子(rank=2)和两对(rank=3)的惩罚更重，因为它们最常见
      const isCommonType = (currentRank <= 3);
      const basePenalty = isCommonType ? -3 : -1.5;
      return basePenalty * streak;
    }

    /**
     * 记录本手赢家牌型（在 selectCard 后调用）
     */
    _recordHandResult(universe, fortuneOwnerIds) {
      if (!universe || fortuneOwnerIds.length === 0) return;

      for (const ownerId of fortuneOwnerIds) {
        if (universe.winnerIds && universe.winnerIds.includes(ownerId)) {
          const hand = universe.hands[ownerId];
          if (hand) {
            this._handHistory.push({ rank: hand.rank || 1, name: hand.name || 'Unknown' });
            if (this._handHistory.length > this._historyMaxLen) {
              this._handHistory.shift();
            }
          }
        }
      }
    }

    // ========== 选牌策略 ==========

    _selectByWeightedRandom(universes) {
      // 使用指数加权（softmax）：分数差距越大，高分牌概率越高
      // temperature=1.0：高分牌被强烈偏好，但仍有小概率抽到低分牌
      // 例：分差10 → 高分牌概率约 e^10 ≈ 22000 倍
      const temperature = 1.0;
      const scores = universes.map(u => u.destinyScore);
      const maxScore = Math.max(...scores);
      // 指数加权（softmax-like），减去 maxScore 防止溢出
      const weights = universes.map(u => {
        const diff = (u.destinyScore - maxScore) / temperature;
        return Math.exp(diff);
      });
      const totalWeight = weights.reduce((sum, w) => sum + w, 0);
      let roll = Math.random() * totalWeight;
      for (let i = 0; i < weights.length; i++) {
        roll -= weights[i];
        if (roll <= 0) return universes[i];
      }
      return universes[universes.length - 1];
    }

    // ========== 内部方法 ==========

    _generateUniverses(deckCards, currentBoard, activePlayers) {
      const boardStrings = currentBoard.map(cardToSolverString);
      const universes = [];

      for (let i = 0; i < deckCards.length; i++) {
        const candidateCard = deckCards[i];
        const futureBoard = [...boardStrings, cardToSolverString(candidateCard)];

        const hands = {};
        const handObjects = [];

        for (const player of activePlayers) {
          const playerCards = player.cards.map(cardToSolverString);
          const allCards = [...playerCards, ...futureBoard];
          try {
            const hand = Hand.solve(allCards);
            hands[player.id] = hand;
            handObjects.push({ playerId: player.id, hand: hand });
          } catch (e) {
            continue;
          }
        }

        if (handObjects.length === 0) continue;

        const allHands = handObjects.map(h => h.hand);
        const winners = Hand.winners(allHands);
        const winnerIds = handObjects
          .filter(h => winners.includes(h.hand))
          .map(h => h.playerId);

        // 赢家: 55~75, 输家: 25~45, 有重叠 + 噪声
        const scores = {};
        const noise = () => (Math.random() - 0.5) * 10;
        for (const ph of handObjects) {
          if (winnerIds.includes(ph.playerId)) {
            scores[ph.playerId] = Math.min(75, 55 + (ph.hand.rank || 0) * 1.5 + noise());
          } else {
            scores[ph.playerId] = Math.max(15, 25 + (ph.hand.rank || 0) * 2 + noise());
          }
        }

        universes.push({
          card: candidateCard,
          hands: hands,
          winnerIds: winnerIds,
          scores: scores,
          destinyScore: 0,
          forceBreakdown: {},
          handDescriptions: Object.fromEntries(
            handObjects.map(h => [h.playerId, h.hand.descr || h.hand.name])
          )
        });
      }

      return universes;
    }

    _randomSelect(deckCards) {
      const idx = Math.floor(Math.random() * deckCards.length);
      return {
        card: deckCards[idx],
        meta: { random: true, activeForces: [] }
      };
    }

    _calculateDramaticShift(universes, selected, rinoPlayerId) {
      if (universes.length < 2) return false;
      let totalScore = 0;
      for (const u of universes) {
        totalScore += (u.scores[rinoPlayerId] || 0);
      }
      const avgScore = totalScore / universes.length;
      const selectedScore = selected.scores[rinoPlayerId] || 0;
      return Math.abs(selectedScore - avgScore) > 30;
    }

    _log(type, data) {
      if (this.onLog) this.onLog(type, data);
      console.log(`[MonteOfZero] ${type}`, data);
    }

    _debugPush(stage, data) {
      if (!this.debugMode) return;
      this.debugTimeline.push({
        stage: stage,
        timestamp: Date.now(),
        data: data
      });
    }

    // ========== 状态查询 ==========

    getState() {
      return {
        enabled: this.enabled,
        styleBias: this.styleBias,
        styleIntensity: this.styleIntensity,
        handHistory: this._handHistory.slice(),
        lastMeta: this.lastSelectionMeta
      };
    }
  }

  // ========== 导出 ==========
  global.MonteOfZero = MonteOfZero;

})(typeof window !== 'undefined' ? window : global);
