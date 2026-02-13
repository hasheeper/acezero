/* global Hand */

/**
 * Equity Estimator — 蒙特卡洛胜率评估器
 *
 * 通过随机模拟剩余公共牌 + 对手手牌，统计胜率。
 * 比查表 (HAND_STRENGTH_MAP) 精准 10 倍：区分顶对/底对、公共牌纹理、听牌概率。
 *
 * 用法：
 *   noob    → 不调用，继续用查表（模拟"只看自己牌"）
 *   regular → EquityEstimator.estimate(hole, board, opponents, 200)
 *   pro/boss→ EquityEstimator.estimateWithMagic(hole, board, opponents, netForce)
 */

(function(global) {
  'use strict';

  const SUIT_MAP = { 0: 's', 1: 'h', 2: 'c', 3: 'd' };
  const RANK_MAP = {
    1: 'A', 2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7',
    8: '8', 9: '9', 10: 'T', 11: 'J', 12: 'Q', 13: 'K'
  };

  // 完整 52 张牌
  const FULL_DECK = [];
  for (let suit = 0; suit < 4; suit++) {
    for (let rank = 1; rank <= 13; rank++) {
      FULL_DECK.push({ rank, suit });
    }
  }

  // ========== 工具函数 ==========

  function cardKey(c) {
    return c.rank * 4 + c.suit;
  }

  function cardToStr(c) {
    return RANK_MAP[c.rank] + SUIT_MAP[c.suit];
  }

  /**
   * Fisher-Yates 部分洗牌：只洗前 n 张，O(n) 而非 O(deck.length)
   */
  function partialShuffle(arr, n) {
    const len = arr.length;
    for (let i = 0; i < n && i < len - 1; i++) {
      const j = i + Math.floor(Math.random() * (len - i));
      const tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
  }

  /**
   * 构建剩余牌堆（排除已知牌）
   */
  function buildRemainingDeck(knownCards) {
    const used = new Set(knownCards.map(cardKey));
    return FULL_DECK.filter(c => !used.has(cardKey(c)));
  }

  // ========== 核心：蒙特卡洛模拟 ==========

  const EquityEstimator = {

    /**
     * 蒙特卡洛胜率估算
     *
     * @param {Array} holeCards    - 手牌 [{rank,suit}, {rank,suit}]
     * @param {Array} boardCards   - 公共牌 (0~5 张)
     * @param {number} numOpponents - 对手数量 (1~8)
     * @param {number} simCount    - 模拟次数 (默认 200)
     * @returns {{ equity: number, wins: number, ties: number, losses: number, sims: number }}
     */
    estimate(holeCards, boardCards, numOpponents, simCount) {
      if (!holeCards || holeCards.length < 2) {
        return { equity: 0.5, wins: 0, ties: 0, losses: 0, sims: 0 };
      }

      numOpponents = Math.max(1, Math.min(8, numOpponents || 1));
      simCount = simCount || 200;

      const board = boardCards || [];
      const boardNeeded = 5 - board.length;
      // 每次模拟需要抽的牌数 = 补完公共牌 + 每个对手 2 张
      const cardsNeeded = boardNeeded + numOpponents * 2;

      const remaining = buildRemainingDeck([...holeCards, ...board]);

      // 预计算已知牌的字符串
      const holeStrs = holeCards.map(cardToStr);
      const boardStrs = board.map(cardToStr);

      let wins = 0;
      let ties = 0;
      let losses = 0;

      for (let sim = 0; sim < simCount; sim++) {
        // 部分洗牌：只需要前 cardsNeeded 张
        partialShuffle(remaining, cardsNeeded);

        // 补完公共牌
        let idx = 0;
        const simBoardStrs = [...boardStrs];
        for (let b = 0; b < boardNeeded; b++) {
          simBoardStrs.push(cardToStr(remaining[idx++]));
        }

        // 我方手牌
        const myCards = [...holeStrs, ...simBoardStrs];
        let myHand;
        try {
          myHand = Hand.solve(myCards);
        } catch (e) {
          continue; // 跳过无效模拟
        }

        // 对手手牌
        let bestResult = 0; // 0=我赢, 1=平, 2=我输
        for (let opp = 0; opp < numOpponents; opp++) {
          const oppHole = [
            cardToStr(remaining[idx++]),
            cardToStr(remaining[idx++])
          ];
          const oppCards = [...oppHole, ...simBoardStrs];
          try {
            const oppHand = Hand.solve(oppCards);
            const cmp = Hand.winners([myHand, oppHand]);
            if (cmp.length === 2) {
              // 平局
              if (bestResult < 1) bestResult = 1;
            } else if (cmp[0] !== myHand) {
              // 对手赢
              bestResult = 2;
              break; // 已经输了，不需要继续比较
            }
          } catch (e) {
            continue;
          }
        }

        if (bestResult === 0) wins++;
        else if (bestResult === 1) ties++;
        else losses++;
      }

      const totalValid = wins + ties + losses;
      const equity = totalValid > 0 ? (wins + ties * 0.5) / totalValid : 0.5;

      return { equity, wins, ties, losses, sims: totalValid };
    },

    /**
     * 带魔运修正的胜率估算（pro/boss 专用）
     *
     * pro/boss "知道"自己开了命运技能后牌会变好，
     * 所以感知胜率 > 物理胜率。
     *
     * @param {Array}  holeCards     - 手牌
     * @param {Array}  boardCards    - 公共牌
     * @param {number} numOpponents  - 对手数量
     * @param {number} netForcePower - 净魔运力量 (己方fortune - 敌方curse，可为负)
     * @param {number} simCount      - 模拟次数
     * @returns {{ physicalEquity: number, perceivedEquity: number, magicBonus: number }}
     */
    estimateWithMagic(holeCards, boardCards, numOpponents, netForcePower, simCount) {
      const result = this.estimate(holeCards, boardCards, numOpponents, simCount);
      const physical = result.equity;

      // 魔运修正系数：每点净力量 +0.5% 感知胜率
      // netForcePower 范围大约 -100 ~ +100，所以修正范围 -50% ~ +50%
      // 但用 sigmoid 压缩，防止极端值
      const rawBonus = (netForcePower || 0) * 0.005;
      const magicBonus = Math.tanh(rawBonus) * 0.3; // 最大 ±30%

      const perceived = Math.max(0, Math.min(1, physical + magicBonus));

      return {
        physicalEquity: physical,
        perceivedEquity: perceived,
        magicBonus: magicBonus
      };
    },

    /**
     * 快速翻前胜率估算（蒙特卡洛版）
     * 比查表精确，但 preflop 模拟方差较大，需要更多次数
     *
     * @param {Array}  holeCards    - 手牌
     * @param {number} numOpponents - 对手数量
     * @param {number} simCount     - 模拟次数 (默认 300，preflop 方差大需要更多)
     * @returns {{ equity: number }}
     */
    estimatePreflop(holeCards, numOpponents, simCount) {
      return this.estimate(holeCards, [], numOpponents, simCount || 300);
    }
  };

  // ========== 导出 ==========
  global.EquityEstimator = EquityEstimator;

})(typeof window !== 'undefined' ? window : global);
