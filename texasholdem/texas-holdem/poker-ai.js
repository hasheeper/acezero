/* global Hand */

/**
 * Poker AI - 德州扑克AI决策系统
 * 
 * 支持两个维度的个性配置：
 * 1. 风险喜好 (Risk Appetite): rock, balanced, aggressive, maniac, passive
 * 2. 难度等级 (Difficulty): noob, regular, pro
 * 
 * AI决策基于：
 * - 当前手牌强度（使用pokersolver评估）
 * - 底池赔率 (Pot Odds)
 * - 个性化阈值和噪音
 * - 价值下注逻辑（强牌必须下注榨取价值）
 */

(function(global) {
  'use strict';

  const SUIT_MAP = { 0: 's', 1: 'h', 2: 'c', 3: 'd' };
  const RANK_MAP = { 1: 'A', 2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: 'T', 11: 'J', 12: 'Q', 13: 'K' };

  // ========== 风险喜好配置 ==========
  // 零号王牌特调：平衡的生态系统，有鱼有鲨鱼
  const RISK_PROFILES = {
    rock: {
      description: '极度保守，只玩超强牌',
      entryThreshold: 70,      // 只玩 Top 10% 起手牌
      raiseThreshold: 80,      // 加注门槛极高
      valueBetThreshold: 65,   // 价值下注门槛
      bluffFrequency: 0.03,    // 几乎不诈唱
      betSizeMultiplier: 0.6,  // 下注尺度保守
      callDownThreshold: 55    // 跟注到底的门槛高
    },
    balanced: {
      description: '平衡型，标准打法',
      entryThreshold: 40,      // 标准入场
      raiseThreshold: 60,
      valueBetThreshold: 55,
      bluffFrequency: 0.12,    // 适度诈唱
      betSizeMultiplier: 0.7,
      callDownThreshold: 35
    },
    aggressive: {
      description: '激进型，喜欢加注施压',
      entryThreshold: 30,      // 较松
      raiseThreshold: 50,
      valueBetThreshold: 45,
      bluffFrequency: 0.22,    // 经常诈唱
      betSizeMultiplier: 0.9,  // 不要每次都满池
      callDownThreshold: 30
    },
    maniac: {
      description: '疯子型，极度激进，频繁诈唱',
      entryThreshold: 15,      // 很松但不是什么都玩
      raiseThreshold: 45,      // 提高：让他多 Call 少 Raise
      valueBetThreshold: 35,
      bluffFrequency: 0.35,    // 高频诈唱但不是一半
      betSizeMultiplier: 1.2,  // 降低：不要每次都超池
      callDownThreshold: 20
    },
    passive: {
      description: '跟注站，喜欢跟注但很少加注',
      entryThreshold: 10,      // 极松，什么烂牌都想看
      raiseThreshold: 90,      // 几乎不加注
      valueBetThreshold: 75,   // 只有超强牌才下注
      bluffFrequency: 0.02,    // 几乎不诈唱
      betSizeMultiplier: 0.4,
      callDownThreshold: 5     // 几乎不弃牌，终极鱼
    }
  };

  // ========== 难度等级配置 ==========
  const DIFFICULTY_PROFILES = {
    noob: {
      description: '小白，决策充满随机性',
      noiseRange: 25,           // 降低：之前45太高，导致把0分牌看成100分
      potOddsAwareness: 0.1,    // 几乎不懂赔率
      positionAwareness: 0.1,   // 位置意识 (0-1)
      valueBetAwareness: 0.3,   // 价值下注意识 (0-1)
      optimism: 15              // 降低：之前30太高，稍微乐观即可
    },
    regular: {
      description: '老鸟，懂基本策略',
      noiseRange: 15,
      potOddsAwareness: 0.6,
      positionAwareness: 0.5,
      valueBetAwareness: 0.7,
      optimism: 10              // 适度乐观
    },
    pro: {
      description: '专家，精准计算',
      noiseRange: 5,
      potOddsAwareness: 1.0,
      positionAwareness: 1.0,
      valueBetAwareness: 1.0,
      optimism: 0               // 理性，不幻想
    }
  };

  // ========== 工具函数 ==========
  function cardToString(card) {
    if (!card) return '';
    return RANK_MAP[card.rank] + SUIT_MAP[card.suit];
  }

  function evaluateHandStrength(holeCards, boardCards) {
    const allCards = [...holeCards, ...boardCards].map(cardToString);
    if (allCards.length < 2) return { rank: 0, name: 'Invalid' };
    
    try {
      const hand = Hand.solve(allCards);
      return { rank: hand.rank || 0, name: hand.name || 'Unknown' };
    } catch (e) {
      return { rank: 0, name: 'Invalid' };
    }
  }

  function evaluatePreflopStrength(holeCards) {
    if (holeCards.length < 2) return 0;
    
    const c1 = holeCards[0];
    const c2 = holeCards[1];
    const r1 = c1.rank === 1 ? 14 : c1.rank;
    const r2 = c2.rank === 1 ? 14 : c2.rank;
    const suited = c1.suit === c2.suit;
    const paired = r1 === r2;
    
    let score = 0;
    
    if (paired) {
      score = 50 + r1 * 3; // AA = 92, KK = 89, ...
    } else {
      const high = Math.max(r1, r2);
      const low = Math.min(r1, r2);
      score = high * 2 + low;
      if (suited) score += 10;
      const gap = high - low;
      if (gap === 1) score += 8;
      else if (gap === 2) score += 5;
      else if (gap === 3) score += 2;
    }
    
    return Math.min(100, score);
  }

  // ========== 常量 ==========
  const ACTIONS = {
    FOLD: 'fold',
    CHECK: 'check',
    CALL: 'call',
    RAISE: 'raise',
    ALL_IN: 'allin'
  };

  // 牌型强度映射 (pokersolver rank -> 0-100 strength)
  const HAND_STRENGTH_MAP = {
    0: 5,    // Invalid
    1: 15,   // High Card - 很弱
    2: 45,   // Pair - 中等
    3: 60,   // Two Pair - 较强
    4: 75,   // Trips/Three of a Kind - 强
    5: 82,   // Straight - 很强
    6: 85,   // Flush - 很强
    7: 92,   // Full House - 极强
    8: 97,   // Quads - 坚果级
    9: 100   // Straight Flush - 无敌
  };

  // ========== PokerAI 类 ==========
  class PokerAI {
    /**
     * @param {Object} personality - 个性配置
     * @param {string} personality.riskAppetite - 风险喜好: rock/balanced/aggressive/maniac/passive
     * @param {string} personality.difficulty - 难度等级: noob/regular/pro
     */
    constructor(personality = {}) {
      const riskType = personality.riskAppetite || 'balanced';
      const difficultyType = personality.difficulty || 'regular';
      
      this.risk = RISK_PROFILES[riskType] || RISK_PROFILES.balanced;
      this.difficulty = DIFFICULTY_PROFILES[difficultyType] || DIFFICULTY_PROFILES.regular;
      this.riskType = riskType;
      this.difficultyType = difficultyType;
    }

    /**
     * 做出决策
     * @param {Object} context - 决策上下文
     */
    decide(context) {
      const { holeCards, boardCards, pot, toCall, aiStack, phase, minRaise, activeOpponentCount } = context;
      
      // 1. 计算原始手牌强度
      let rawStrength = this.calculateRawStrength(holeCards, boardCards, phase);
      
      // 2. 添加难度噪音
      const noise = (Math.random() - 0.5) * this.difficulty.noiseRange;
      let adjustedStrength = Math.max(0, Math.min(100, rawStrength + noise));
      
      // 3. 计算底池赔率
      const potOdds = toCall > 0 ? toCall / (pot + toCall) : 0;
      
      // 4. 检查是否诈唱 - 🎯 多人局禁止乱诈唱
      const opponents = activeOpponentCount || 1;
      let effectiveBluffFreq = this.risk.bluffFrequency;
      
      // 多人局大幅降低诈唱频率（诈唱成功率极低）
      if (opponents > 2) {
        effectiveBluffFreq *= 0.3; // 降到 30%
      } else if (opponents > 1) {
        effectiveBluffFreq *= 0.6; // 降到 60%
      }
      
      const isBluffing = Math.random() < effectiveBluffFreq && adjustedStrength < 40;
      
      // 5. 决策逻辑
      return this.makeDecision(context, adjustedStrength, rawStrength, potOdds, isBluffing, opponents);
    }

    calculateRawStrength(holeCards, boardCards, phase) {
      if (phase === 'preflop') {
        return evaluatePreflopStrength(holeCards);
      }
      
      const handResult = evaluateHandStrength(holeCards, boardCards);
      let strength = HAND_STRENGTH_MAP[handResult.rank] || 15;
      
      // ========== 关键修复：检测手牌是否真正参与了牌型 ==========
      const holeRanks = holeCards.map(c => c.rank === 1 ? 14 : c.rank);
      const boardRanks = boardCards.map(c => c.rank === 1 ? 14 : c.rank);
      
      // 检测公共牌是否有对子
      const boardPair = this.detectBoardPair(boardRanks);
      
      // 检测手牌是否与公共牌配对
      const holeConnectsToBoard = holeRanks.some(hr => boardRanks.includes(hr));
      
      // 检测手牌是否自带对子
      const holePocket = holeRanks[0] === holeRanks[1];
      
      if (handResult.rank === 2) { // Pair
        if (boardPair && !holeConnectsToBoard && !holePocket) {
          // 🚨 公共牌对子，手牌没贡献 = 实际上是高牌！
          strength = 18; // 比 High Card 稍高，因为至少有公共对子保底
        } else if (holeConnectsToBoard) {
          // 手牌与公共牌配对
          const pairRank = Math.max(...holeRanks.filter(hr => boardRanks.includes(hr)));
          const boardHighCard = Math.max(...boardRanks);
          if (pairRank >= boardHighCard) {
            strength += 10; // 顶对加分
          } else if (pairRank < boardHighCard - 2) {
            strength -= 10; // 小对子减分
          }
        }
        // 口袋对子保持原分数
      }
      
      if (handResult.rank === 3) { // Two Pair
        if (boardPair && !holePocket) {
          // 公共牌有对子，我只配了一对
          const myPairRank = Math.max(...holeRanks.filter(hr => boardRanks.includes(hr)), 0);
          if (myPairRank === 0) {
            // 两对都是公共牌的！我只是高牌
            strength = 20;
          } else if (myPairRank < Math.max(...boardRanks)) {
            // 我的对子比公共牌小
            strength -= 10;
          }
        }
      }
      
      // ========== 赌徒心态：听牌幻想加分 ==========
      // 只在 flop 和 turn 阶段生效（还有未来牌可以期待）
      if (phase !== 'river') {
        let potentialBonus = 0;
        
        // 1. 高张奖励：手里有 A 或 K，觉得自己能中顶对
        // 🔧 修复：如果已经有对子了，不再加分
        if (handResult.rank <= 1) { // 只有高牌时才加
          const hasAce = holeCards.some(c => c.rank === 1);
          const hasKing = holeCards.some(c => c.rank === 13);
          if (hasAce) potentialBonus += 12;
          else if (hasKing) potentialBonus += 8;
        }
        
        // 2. 同花听牌检测（简化版）
        const allCards = [...holeCards, ...boardCards];
        const suitCounts = [0, 0, 0, 0];
        allCards.forEach(c => suitCounts[c.suit]++);
        const maxSuitCount = Math.max(...suitCounts);
        
        // 🔧 修复：必须手牌参与听牌才加分
        const flushSuit = suitCounts.indexOf(maxSuitCount);
        const holeFlushCards = holeCards.filter(c => c.suit === flushSuit).length;
        
        if (maxSuitCount >= 4 && holeFlushCards >= 1) {
          potentialBonus += 15; // 四张同花，听花
        } else if (maxSuitCount === 3 && holeFlushCards >= 2) {
          potentialBonus += 5; // 后门花，但必须两张手牌都是
        }
        
        // 3. 顺子听牌检测 - 简化，减少误判
        // 只有当手牌参与顺子时才加分
        if (this.hasOpenEndedStraightDraw(holeRanks, boardRanks)) {
          potentialBonus += 12;
        }
        
        // 4. 盲目乐观值（越蠢的AI越乐观）- 降低影响
        const optimism = (this.difficulty.optimism || 0) * 0.5;
        potentialBonus += optimism;
        
        strength += potentialBonus;
      }
      
      // 归一化，防止超过100
      return Math.min(100, Math.max(5, strength));
    }
    
    // 检测公共牌是否有对子
    detectBoardPair(boardRanks) {
      const counts = {};
      for (const r of boardRanks) {
        counts[r] = (counts[r] || 0) + 1;
        if (counts[r] >= 2) return true;
      }
      return false;
    }
    
    // 检测是否有两头顺听牌（手牌必须参与）
    hasOpenEndedStraightDraw(holeRanks, boardRanks) {
      const allRanks = [...holeRanks, ...boardRanks];
      const uniqueRanks = [...new Set(allRanks)].sort((a, b) => a - b);
      
      // 检查是否有4张连续牌
      for (let i = 0; i <= uniqueRanks.length - 4; i++) {
        const span = uniqueRanks[i + 3] - uniqueRanks[i];
        if (span === 3) {
          // 有4张连续牌，检查手牌是否参与
          const straightRanks = uniqueRanks.slice(i, i + 4);
          const holeInStraight = holeRanks.some(hr => straightRanks.includes(hr));
          if (holeInStraight) return true;
        }
      }
      return false;
    }

    getBoardHighCard(boardCards) {
      if (!boardCards || boardCards.length === 0) return 0;
      return Math.max(...boardCards.map(c => c.rank === 1 ? 14 : c.rank));
    }

    getPairRank(holeCards, boardCards) {
      // 简化：返回手牌中最大的牌
      const ranks = holeCards.map(c => c.rank === 1 ? 14 : c.rank);
      return Math.max(...ranks);
    }

    makeDecision(context, adjustedStrength, rawStrength, potOdds, isBluffing, opponents) {
      const { pot, toCall, aiStack, minRaise, phase } = context;
      
      // ========== 无人下注时的决策 ==========
      if (toCall === 0) {
        return this.decideWhenCheckedTo(adjustedStrength, rawStrength, pot, aiStack, minRaise, phase, isBluffing, opponents);
      }
      
      // ========== 面对下注时的决策 ==========
      return this.decideWhenFacingBet(adjustedStrength, rawStrength, pot, toCall, aiStack, minRaise, potOdds, isBluffing, phase, opponents);
    }

    /**
     * 无人下注时的决策 - 关键修复：强牌必须下注榨取价值
     */
    decideWhenCheckedTo(adjustedStrength, rawStrength, pot, aiStack, minRaise, phase, isBluffing, opponents) {
      // 价值下注意识：专家更懂得用强牌下注
      const valueBetAwareness = this.difficulty.valueBetAwareness;
      const shouldValueBet = Math.random() < valueBetAwareness;
      
      // 强牌必须下注（价值下注）
      // 三条以上(rawStrength >= 75)几乎必须下注
      // 两对(rawStrength >= 60)应该下注
      // 顶对(rawStrength >= 55)经常下注
      if (rawStrength >= 75 && shouldValueBet) {
        // 超强牌：必须下注榨取价值
        const raiseAmount = this.calculateRaiseAmount(rawStrength, pot, aiStack, minRaise);
        return { action: ACTIONS.RAISE, amount: raiseAmount };
      }
      
      if (rawStrength >= this.risk.valueBetThreshold && shouldValueBet) {
        // 强牌：下注榨取价值
        const raiseAmount = this.calculateRaiseAmount(rawStrength, pot, aiStack, minRaise);
        return { action: ACTIONS.RAISE, amount: raiseAmount };
      }
      
      // 诈唬下注
      if (isBluffing && phase !== 'preflop') {
        const bluffAmount = this.calculateRaiseAmount(50, pot, aiStack, minRaise); // 诈唬用中等尺度
        return { action: ACTIONS.RAISE, amount: bluffAmount };
      }
      
      // 中等牌力：根据风险喜好决定
      if (adjustedStrength >= this.risk.raiseThreshold) {
        const raiseAmount = this.calculateRaiseAmount(adjustedStrength, pot, aiStack, minRaise);
        return { action: ACTIONS.RAISE, amount: raiseAmount };
      }
      
      // 弱牌：过牌
      return { action: ACTIONS.CHECK, amount: 0 };
    }

    /**
     * 面对下注时的决策
     */
    decideWhenFacingBet(adjustedStrength, rawStrength, pot, toCall, aiStack, minRaise, potOdds, isBluffing, phase, opponents) {
      // 生存本能 v2：多层次恐惧机制
      const betRatio = toCall / (pot + 0.01);        // 下注占底池比例
      const stackRatio = toCall / (aiStack + 0.01); // 下注占筹码比例
      
      // 计算压力等级 (0-3)
      let pressureLevel = 0;
      if (betRatio > 0.3) pressureLevel++;   // 超过 30% pot
      if (betRatio > 0.6) pressureLevel++;   // 超过 60% pot  
      if (stackRatio > 0.4) pressureLevel++; // 超过 40% 筹码
      if (stackRatio > 0.7) pressureLevel++; // 超过 70% 筹码
      
      // 根据压力等级和牌力决定是否触发生存本能
      // 压力越大，需要的牌力越高才能继续
      const survivalThreshold = 30 + pressureLevel * 15; // 30/45/60/75
      
      if (rawStrength < survivalThreshold && pressureLevel >= 1) {
        // 生存本能触发！
        // 根据玩家类型决定逃跑概率
        let foldChance = 0.95; // 默认 95% 弃牌
        
        if (this.riskType === 'rock') {
          foldChance = 0.99; // Rock 几乎必弃
        } else if (this.riskType === 'passive') {
          foldChance = 0.85; // Passive 稍微犹豫（鱼会送钱）
        } else if (this.riskType === 'maniac') {
          foldChance = 0.70; // Maniac 有 30% 概率疯狗反打
        } else if (this.riskType === 'aggressive') {
          foldChance = 0.80; // Aggressive 有 20% 概率反打
        }
        
        // Pro 玩家更理性，但也不会拿空气跟巨注
        if (this.difficultyType === 'pro') {
          foldChance *= 0.9; // Pro 稍微降低弃牌率，但仍然会弃
        }
        
        // 如果正在诈唬，降低弃牌率（但诈唬面对巨注也应该放弃）
        if (isBluffing && pressureLevel <= 1) {
          foldChance *= 0.5;
        }
        
        if (Math.random() < foldChance) {
          return { action: ACTIONS.FOLD, amount: 0 };
        }
      }
      
      // 需要全押才能跟
      if (toCall >= aiStack) {
        // 提高 All-in 门槛：必须有真货
        if (rawStrength >= 60) {
          return { action: ACTIONS.ALL_IN, amount: aiStack };
        }
        // 疯子有小概率乱推
        if (this.riskType === 'maniac' && adjustedStrength >= 45 && Math.random() < 0.2) {
          return { action: ACTIONS.ALL_IN, amount: aiStack };
        }
        return { action: ACTIONS.FOLD, amount: 0 };
      }
      
      // 底池赔率检查（专家更会利用）
      const potOddsCheck = this.difficulty.potOddsAwareness;
      const isPotOddsFavorable = potOdds < (adjustedStrength / 100) * potOddsCheck + (1 - potOddsCheck) * 0.5;
      
      // 河牌圈特殊处理：弱牌面对下注几乎必弃
      if (phase === 'river' && rawStrength <= 20 && toCall > pot * 0.25) {
        // High Card 或弱对子面对超过 1/4 pot 的下注，弃牌
        if (this.riskType !== 'passive' || Math.random() > 0.2) {
          return { action: ACTIONS.FOLD, amount: 0 };
        }
      }
      
      // 超强牌：加注
      if (rawStrength >= 75) {
        const raiseAmount = this.calculateRaiseAmount(rawStrength, pot, aiStack, minRaise);
        if (raiseAmount > toCall * 2) {
          return { action: ACTIONS.RAISE, amount: raiseAmount };
        }
        return { action: ACTIONS.CALL, amount: toCall };
      }
      
      // 强牌：跟注或加注
      if (adjustedStrength >= this.risk.raiseThreshold) {
        const raiseAmount = this.calculateRaiseAmount(adjustedStrength, pot, aiStack, minRaise);
        if (raiseAmount > toCall * 2) {
          return { action: ACTIONS.RAISE, amount: raiseAmount };
        }
        return { action: ACTIONS.CALL, amount: toCall };
      }
      
      // 中等牌力：根据赔率和风险喜好决定
      if (adjustedStrength >= this.risk.callDownThreshold) {
        if (isPotOddsFavorable || this.riskType === 'passive') {
          return { action: ACTIONS.CALL, amount: toCall };
        }
      }
      
      // 诈唬加注 - 只在小注时才考虑
      if (isBluffing && pressureLevel === 0 && Math.random() < 0.4) {
        const bluffAmount = this.calculateRaiseAmount(55, pot, aiStack, minRaise);
        return { action: ACTIONS.RAISE, amount: bluffAmount };
      }
      
      // 弱牌但赔率合适：跟注站会跟
      if (this.riskType === 'passive' && adjustedStrength >= 15) {
        return { action: ACTIONS.CALL, amount: toCall };
      }
      
      // 弱牌：弃牌
      if (adjustedStrength < this.risk.entryThreshold && !isBluffing) {
        return { action: ACTIONS.FOLD, amount: 0 };
      }
      
      // 默认跟注
      return { action: ACTIONS.CALL, amount: toCall };
    }

    calculateRaiseAmount(strength, pot, stack, minRaise) {
      let multiplier;
      if (strength >= 90) {
        multiplier = 0.8 + Math.random() * 0.4; // 80-120% pot
      } else if (strength >= 70) {
        multiplier = 0.5 + Math.random() * 0.3; // 50-80% pot
      } else if (strength >= 50) {
        multiplier = 0.4 + Math.random() * 0.2; // 40-60% pot
      } else {
        multiplier = 0.3 + Math.random() * 0.2; // 30-50% pot (bluff)
      }
      
      // 应用风险喜好的下注尺度倍数
      multiplier *= this.risk.betSizeMultiplier;
      
      let amount = Math.floor(pot * multiplier);
      amount = Math.max(amount, minRaise);
      amount = Math.min(amount, stack);
      
      return amount;
    }
  }

  // ========== 导出 ==========
  global.PokerAI = PokerAI;
  global.PokerAI.ACTIONS = ACTIONS;
  global.PokerAI.RISK_PROFILES = RISK_PROFILES;
  global.PokerAI.DIFFICULTY_PROFILES = DIFFICULTY_PROFILES;
  global.PokerAI.evaluateHandStrength = evaluateHandStrength;
  global.PokerAI.evaluatePreflopStrength = evaluatePreflopStrength;
  global.PokerAI.cardToString = cardToString;

})(typeof window !== 'undefined' ? window : global);
