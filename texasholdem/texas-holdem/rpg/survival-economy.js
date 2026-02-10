/**
 * Survival Economy — 生存资源管理系统
 * 《零之王牌》Mana 不自动回复 + 掠夺回蓝 + 大胜回蓝 + 反噬
 *
 * 设计哲学：
 *   魔运 (Mana) 是稀缺资源，不会每轮自动回复。
 *   玩家必须通过激进行为（掠夺、大胜）来回复魔力。
 *   耗尽魔力会触发反噬 (Backlash)。
 *   这创造了"想作弊但必须忍耐"的核心张力。
 *
 * 回复手段：
 *   1. 掠夺 (Siphon)：在 Turn/River 阶段迫使敌人弃牌，吸收气势回蓝
 *   2. 大胜 (Epic Win)：以时髦牌型获胜，魔力大幅回涌
 *   3. 场下休息 (Rest)：牌局外的 RP 剧情回复（未来实现）
 *   4. 基础涓流 (Trickle)：极微量的被动回复（可选，防止完全卡死）
 *
 * 反噬 (Backlash)：
 *   Mana 降至 0 时触发，系统级恶运力量持续数轮
 *
 * Hook 架构：
 *   emit('mana:siphon', { amount, source })
 *   emit('mana:epicwin', { amount, handRank })
 *   emit('mana:depleted', { playerId })
 *   emit('backlash:trigger', { power, duration })
 */

// ========== 常量 ==========

export const SIPHON_BASE = 8;

export const EPIC_WIN_REWARDS = {
    'Royal Flush':    40,
    'Straight Flush': 35,
    'Four of a Kind': 25,
    'Full House':     20,
    'Flush':          18,
    'Straight':       15,
    'Three of a Kind': 10,
    'Two Pair':        5,
    'Pair':            0,   // 一对不算大胜
    'High Card':       0
  };

const STYLE_STREAK_BONUS = 5;

export const TRICKLE_AMOUNT = 2;

export const BACKLASH_POWER = 50;
export const BACKLASH_DURATION = 3;

const SIPHON_MIN_PHASE = 'turn';

// ========== SurvivalEconomy 类 ==========

export class SurvivalEconomy {
    /**
     * @param {object} opts
     * @param {object} opts.skillSystem - SkillSystem 实例（用于操作 mana）
     */
    constructor(opts) {
      opts = opts || {};
      this.skillSystem = opts.skillSystem || null;

      // 追踪状态
      this.lastWinRank = null;       // 上次获胜牌型
      this.styleStreak = 0;          // 连续不同牌型获胜次数
      this.siphonEnabled = true;     // 掠夺是否启用
      this.trickleEnabled = true;    // 涓流是否启用

      // 事件系统
      this._listeners = {};
    }

    // ========== 回复机制 ==========

    /**
     * 掠夺回蓝：敌人在 Turn/River 阶段弃牌时触发
     *
     * @param {number} playerId - 玩家 ID
     * @param {string} phase - 当前阶段 ('preflop', 'flop', 'turn', 'river')
     * @param {number} foldedEnemyCount - 本轮弃牌的敌人数量
     * @returns {number} 实际回复量
     */
    onEnemyFold(playerId, phase, foldedEnemyCount) {
      if (!this.siphonEnabled) return 0;
      if (!this._isLatePhase(phase)) return 0;
      if (foldedEnemyCount <= 0) return 0;

      const amount = SIPHON_BASE * foldedEnemyCount;
      this._addMana(playerId, amount);

      this.emit('mana:siphon', {
        playerId: playerId,
        amount: amount,
        phase: phase,
        foldedCount: foldedEnemyCount
      });

      return amount;
    }

    /**
     * 大胜回蓝：以特定牌型获胜时触发
     *
     * @param {number} playerId - 玩家 ID
     * @param {string} handRank - 获胜牌型名称（pokersolver 格式）
     * @param {boolean} isWinner - 是否是赢家
     * @returns {number} 实际回复量
     */
    onHandResult(playerId, handRank, isWinner) {
      if (!isWinner) {
        this.styleStreak = 0;
        this.lastWinRank = null;
        return 0;
      }

      const baseReward = EPIC_WIN_REWARDS[handRank] || 0;
      if (baseReward <= 0) {
        // 低级牌型获胜，不算大胜，但保持连胜
        this.lastWinRank = handRank;
        return 0;
      }

      // 时髦加成：连续以不同牌型获胜
      let styleBonus = 0;
      if (this.lastWinRank && this.lastWinRank !== handRank) {
        this.styleStreak++;
        styleBonus = STYLE_STREAK_BONUS * Math.min(this.styleStreak, 3);
      } else {
        this.styleStreak = 0;
      }

      const totalReward = baseReward + styleBonus;
      this._addMana(playerId, totalReward);

      this.lastWinRank = handRank;

      this.emit('mana:epicwin', {
        playerId: playerId,
        amount: totalReward,
        handRank: handRank,
        baseReward: baseReward,
        styleBonus: styleBonus,
        styleStreak: this.styleStreak
      });

      return totalReward;
    }

    /**
     * 涓流回复：每轮结束时的微量回复
     *
     * @param {number} playerId - 玩家 ID
     * @returns {number} 实际回复量
     */
    onRoundTrickle(playerId) {
      if (!this.trickleEnabled) return 0;

      this._addMana(playerId, TRICKLE_AMOUNT);

      return TRICKLE_AMOUNT;
    }

    // ========== 反噬检查 ==========

    /**
     * 检查是否应该触发反噬
     * 在每次消耗 mana 后调用
     *
     * @param {number} playerId - 玩家 ID
     * @returns {boolean} 是否触发了反噬
     */
    checkBacklash(playerId) {
      if (!this.skillSystem) return false;

      const mana = this.skillSystem.getMana(playerId);
      if (mana.current > 0) return false;

      // Mana 耗尽，触发反噬
      this.emit('backlash:trigger', {
        playerId: playerId,
        power: BACKLASH_POWER,
        duration: BACKLASH_DURATION
      });

      // 通过 skillSystem 激活反噬
      if (this.skillSystem.triggerBacklash) {
        this.skillSystem.triggerBacklash(BACKLASH_POWER, BACKLASH_DURATION);
      }

      this.emit('mana:depleted', { playerId: playerId });

      return true;
    }

    // ========== 经济状态查询 ==========

    /**
     * 获取当前经济状态摘要
     */
    getEconomyStatus(playerId) {
      const mana = this.skillSystem ? this.skillSystem.getMana(playerId) : { current: 0, max: 100 };
      const ratio = mana.max > 0 ? mana.current / mana.max : 0;

      let urgency = 'safe';
      if (ratio <= 0) urgency = 'depleted';
      else if (ratio <= 0.15) urgency = 'critical';
      else if (ratio <= 0.3) urgency = 'low';
      else if (ratio <= 0.5) urgency = 'moderate';

      return {
        mana: mana,
        ratio: ratio,
        urgency: urgency,
        styleStreak: this.styleStreak,
        tricklePerRound: this.trickleEnabled ? TRICKLE_AMOUNT : 0
      };
    }

    /**
     * 估算剩余可用轮数
     * @param {number} playerId
     * @param {number} avgCostPerRound - 平均每轮消耗
     */
    estimateRoundsRemaining(playerId, avgCostPerRound) {
      const mana = this.skillSystem ? this.skillSystem.getMana(playerId) : { current: 0 };
      if (avgCostPerRound <= 0) return Infinity;
      const netCost = avgCostPerRound - (this.trickleEnabled ? TRICKLE_AMOUNT : 0);
      if (netCost <= 0) return Infinity;
      return Math.floor(mana.current / netCost);
    }

    // ========== 重置 ==========

    reset() {
      this.lastWinRank = null;
      this.styleStreak = 0;
    }

    // ========== 内部方法 ==========

    /**
     * @private
     */
    _addMana(playerId, amount) {
      if (!this.skillSystem) return;
      // 使用 skillSystem 的 regenMana（支持自定义 amount）
      this.skillSystem.regenMana(playerId, amount);
    }

    /**
     * @private
     */
    _isLatePhase(phase) {
      return phase === 'turn' || phase === 'river';
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
          try { fns[i](data); } catch (e) { console.error('[SurvivalEconomy]', event, e); }
        }
      }
    }
  }

