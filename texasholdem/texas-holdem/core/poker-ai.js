/* global Hand */

/**
 * Poker AI - 德州扑克AI决策系统
 * 
 * 支持三个维度的个性配置：
 * 1. 风险喜好 (Risk Appetite): rock, balanced, aggressive, maniac, passive
 * 2. 难度等级 (Difficulty): noob, regular, pro
 * 3. 情绪状态 (Emotion): calm, confident, tilt, fearful, desperate, euphoric
 * 
 * AI决策基于：
 * - 当前手牌强度（使用pokersolver评估）
 * - 底池赔率 (Pot Odds)
 * - 个性化阈值和噪音
 * - 价值下注逻辑（强牌必须下注榨取价值）
 * - 情绪修正（影响噪音、诈唬、下注尺度等）
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
      entryThreshold: 55,      // 紧凑但不至于全弃
      raiseThreshold: 80,      // 加注门槛极高
      valueBetThreshold: 65,   // 价值下注门槛
      bluffFrequency: 0.03,    // 几乎不诈唱
      betSizeMultiplier: 0.6,  // 下注尺度保守
      callDownThreshold: 55    // 跟注到底的门槛高
    },
    balanced: {
      description: '平衡型，标准打法',
      entryThreshold: 30,      // 标准入场，愿意看翻牌
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

  // ========== 情绪状态配置 ==========
  // 情绪是叠加在 risk + difficulty 之上的运行时修正层
  // 所有值都是 delta（加减），应用于基础 profile 之上
  const EMOTION_PROFILES = {
    calm: {
      description: '冷静 — 无修正，标准状态',
      noiseDelta: 0,
      entryDelta: 0,
      raiseDelta: 0,
      bluffDelta: 0,
      betSizeDelta: 0,
      foldResistDelta: 0,     // 负值 = 更不容易弃牌
      optimismDelta: 0
    },
    confident: {
      description: '自信 — 连赢后膨胀，敢打敢冲但不失理智',
      noiseDelta: -3,          // 略微更精准
      entryDelta: -5,          // 入场门槛降低
      raiseDelta: -8,          // 更愿意加注
      bluffDelta: 0.05,        // 略增诈唬
      betSizeDelta: 0.15,      // 下注尺度增大
      foldResistDelta: -0.10,  // 更不容易弃牌
      optimismDelta: 5
    },
    tilt: {
      description: '上头 — 被 Bad Beat 后情绪失控，决策混乱',
      noiseDelta: 15,          // 判断力大幅下降
      entryDelta: -20,         // 什么牌都想玩
      raiseDelta: -15,         // 疯狂加注
      bluffDelta: 0.20,        // 大量诈唬
      betSizeDelta: 0.4,       // 下注尺度暴涨
      foldResistDelta: -0.25,  // 极度不愿弃牌
      optimismDelta: 20
    },
    fearful: {
      description: '恐惧 — 被大额下注吓到，畏手畏脚',
      noiseDelta: 5,
      entryDelta: 15,          // 入场门槛大幅提高
      raiseDelta: 20,          // 几乎不加注
      bluffDelta: -0.08,       // 不敢诈唬
      betSizeDelta: -0.2,      // 下注尺度缩小
      foldResistDelta: 0.15,   // 更容易弃牌
      optimismDelta: -10
    },
    desperate: {
      description: '绝望 — 筹码见底，孤注一掷',
      noiseDelta: 10,
      entryDelta: -15,         // 什么都想搏
      raiseDelta: -20,         // 频繁 All-in
      bluffDelta: 0.25,        // 大量诈唬（背水一战）
      betSizeDelta: 0.6,       // 下注尺度极大
      foldResistDelta: -0.20,  // 不愿弃牌
      optimismDelta: 15
    },
    euphoric: {
      description: '狂喜 — 刚赢大锅，飘飘然，容易轻敌',
      noiseDelta: 8,           // 注意力分散
      entryDelta: -10,         // 觉得自己无敌
      raiseDelta: -5,
      bluffDelta: 0.10,
      betSizeDelta: 0.2,
      foldResistDelta: -0.15,  // 不愿放弃好运
      optimismDelta: 12
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
      // Broadway 高张加分：两张都是 T+ 的非对子牌应该更强
      // AKs=72, AKo=62, AQs=69, KQs=66 — 更接近真实排名
      if (high >= 14 && low >= 13) score += 20; // AK
      else if (high >= 14 && low >= 12) score += 15; // AQ
      else if (high >= 14 && low >= 11) score += 12; // AJ
      else if (high >= 13 && low >= 12) score += 12; // KQ
      else if (high >= 14 && low >= 10) score += 8;  // AT
      else if (high >= 13 && low >= 11) score += 8;  // KJ
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
     * @param {string} personality.emotion - 情绪状态: calm/confident/tilt/fearful/desperate/euphoric
     */
    constructor(personality = {}) {
      const riskType = personality.riskAppetite || 'balanced';
      const difficultyType = personality.difficulty || 'regular';
      const emotionType = personality.emotion || 'calm';
      
      this.riskBase = RISK_PROFILES[riskType] || RISK_PROFILES.balanced;
      this.difficultyBase = DIFFICULTY_PROFILES[difficultyType] || DIFFICULTY_PROFILES.regular;
      this.emotion = EMOTION_PROFILES[emotionType] || EMOTION_PROFILES.calm;
      this.riskType = riskType;
      this.difficultyType = difficultyType;
      this.emotionType = emotionType;
      
      // 合并：基础 profile + 情绪 delta
      this.risk = this._applyEmotion(this.riskBase, this.emotion);
      this.difficulty = this._applyEmotionDifficulty(this.difficultyBase, this.emotion);
    }

    /**
     * 运行时切换情绪（不重建实例）
     * @param {string} emotionType - 新情绪
     */
    setEmotion(emotionType) {
      this.emotionType = emotionType;
      this.emotion = EMOTION_PROFILES[emotionType] || EMOTION_PROFILES.calm;
      this.risk = this._applyEmotion(this.riskBase, this.emotion);
      this.difficulty = this._applyEmotionDifficulty(this.difficultyBase, this.emotion);
    }

    _applyEmotion(base, emo) {
      return {
        description: base.description,
        entryThreshold:    Math.max(0, Math.min(100, base.entryThreshold + (emo.entryDelta || 0))),
        raiseThreshold:    Math.max(0, Math.min(100, base.raiseThreshold + (emo.raiseDelta || 0))),
        valueBetThreshold: Math.max(0, Math.min(100, base.valueBetThreshold + (emo.raiseDelta || 0) * 0.5)),
        bluffFrequency:    Math.max(0, Math.min(0.8, base.bluffFrequency + (emo.bluffDelta || 0))),
        betSizeMultiplier: Math.max(0.2, base.betSizeMultiplier + (emo.betSizeDelta || 0)),
        callDownThreshold: Math.max(0, Math.min(100, base.callDownThreshold + (emo.entryDelta || 0) * 0.5))
      };
    }

    _applyEmotionDifficulty(base, emo) {
      return {
        description: base.description,
        // 🔧 理性上限：noiseRange 最高 35（防止 noob+tilt=40 导致完全随机）
        noiseRange:        Math.min(35, Math.max(0, base.noiseRange + (emo.noiseDelta || 0))),
        potOddsAwareness:  Math.max(0, Math.min(1, base.potOddsAwareness - (emo.noiseDelta || 0) * 0.01)),
        positionAwareness: base.positionAwareness,
        valueBetAwareness: Math.max(0, Math.min(1, base.valueBetAwareness - (emo.noiseDelta || 0) * 0.02)),
        // 🔧 理性上限：optimism 最高 25（防止 noob+tilt=35 让垃圾牌看起来像中等牌）
        optimism:          Math.min(25, Math.max(0, base.optimism + (emo.optimismDelta || 0)))
      };
    }

    /**
     * 做出决策
     * @param {Object} context - 决策上下文
     */
    decide(context) {
      const { holeCards, boardCards, pot, toCall, aiStack, phase, minRaise, activeOpponentCount } = context;
      const playerName = context.playerName || '?';
      
      // 魔运等级：有魔运的高手更自信，不容易弃牌
      const magicLevel = context.magicLevel || 0;
      
      // 1. 计算原始手牌强度
      let rawStrength = this.calculateRawStrength(holeCards, boardCards, phase);
      
      // 1.5 获取手牌名称（用于日志）
      let handName = phase === 'preflop' ? 'Preflop' : '?';
      if (phase !== 'preflop' && boardCards && boardCards.length > 0) {
        try {
          const hr = evaluateHandStrength(holeCards, boardCards);
          handName = hr.name || '?';
        } catch (e) { handName = '?'; }
      }
      
      // 2. 添加难度噪音 + 盲目乐观值（只影响感知，不影响 rawStrength）
      const noise = (Math.random() - 0.5) * this.difficulty.noiseRange;
      const optimism = (this.difficulty.optimism || 0) * 0.5;
      let adjustedStrength = Math.max(0, Math.min(100, rawStrength + noise + optimism));
      
      // 2.5 魔运自信加成：有魔运的AI感知到命运偏向自己，更不容易弃牌
      // magicLevel 1~5 → +5~+25 的心理加成
      if (magicLevel > 0) {
        adjustedStrength += magicLevel * 5;
        adjustedStrength = Math.min(100, adjustedStrength);
      }
      
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
      
      const isBluffing = Math.random() < effectiveBluffFreq && rawStrength <= 20;
      
      // 5. 决策逻辑
      const decision = this.makeDecision(context, adjustedStrength, rawStrength, potOdds, isBluffing, opponents, magicLevel);
      
      // 6. 详细日志
      const holeStr = holeCards.map(cardToString).join(' ');
      const tag = this.riskType + '/' + this.difficultyType + '/' + this.emotionType;
      console.log(
        '[AI] ' + playerName + ' (' + tag + ') ' + phase +
        ' | 手牌: ' + holeStr + ' [' + handName + ']' +
        ' | raw=' + rawStrength +
        ' adj=' + Math.round(adjustedStrength) +
        (noise !== 0 ? ' noise=' + (noise > 0 ? '+' : '') + Math.round(noise) : '') +
        (optimism > 0 ? ' opt=+' + Math.round(optimism) : '') +
        (magicLevel > 0 ? ' magic=+' + (magicLevel * 5) : '') +
        (isBluffing ? ' BLUFF' : '') +
        ' | pot=' + pot + ' toCall=' + toCall + ' stack=' + aiStack +
        ' opp=' + opponents +
        ' → ' + decision.action.toUpperCase() +
        (decision.amount > 0 ? ' ' + decision.amount : '') +
        (decision.reason ? ' (' + decision.reason + ')' : '')
      );
      
      return decision;
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
      
      // 统计公共牌对子数量
      const boardCounts = {};
      for (const r of boardRanks) boardCounts[r] = (boardCounts[r] || 0) + 1;
      const boardPairCount = Object.values(boardCounts).filter(c => c >= 2).length;
      const boardHasTrips = Object.values(boardCounts).some(c => c >= 3);
      
      if (handResult.rank === 2) { // Pair
        if (boardPair && !holeConnectsToBoard && !holePocket) {
          // 🚨 公共牌对子，手牌没贡献 = 实际上是高牌！
          strength = 18;
        } else if (holeConnectsToBoard) {
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
        if (boardPairCount >= 2 && !holeConnectsToBoard && !holePocket) {
          // 🚨 两对都在公共牌上！手牌只是踢脚
          strength = 22;
        } else if (boardPair && !holePocket) {
          const myPairRank = Math.max(...holeRanks.filter(hr => boardRanks.includes(hr)), 0);
          if (myPairRank === 0) {
            // 两对都是公共牌的（另一种检测路径）
            strength = 22;
          } else if (myPairRank < Math.max(...boardRanks)) {
            strength -= 10;
          }
        }
      }
      
      if (handResult.rank === 4) { // Three of a Kind
        if (boardHasTrips && !holeConnectsToBoard) {
          // 🚨 三条全在公共牌上，手牌没贡献
          strength = 30;
        } else if (boardPair && holeConnectsToBoard && !holePocket) {
          // 公共牌对子 + 手牌配对 = 真三条，但不如口袋对子强
          strength -= 5;
        }
        // 口袋对子 + 公共牌 = 暗三条，最强，保持原分
      }
      
      if (handResult.rank === 7) { // Full House
        if (boardHasTrips && !holePocket) {
          // 公共牌三条 + 手牌没配对 = 公共葫芦，大家都有
          const myContribution = holeRanks.some(hr => boardRanks.includes(hr));
          if (!myContribution) {
            strength = 40; // 大幅降低：公共葫芦谁都有
          }
        } else if (boardPairCount >= 2) {
          // 公共牌两对 + 手牌配了一张 = 弱葫芦
          if (!holeConnectsToBoard && !holePocket) {
            strength = 42; // 公共牌两对 + 踢脚 = 谁都有
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

    makeDecision(context, adjustedStrength, rawStrength, potOdds, isBluffing, opponents, magicLevel) {
      const { pot, toCall, aiStack, minRaise, phase } = context;
      
      // ========== 无人下注时的决策 ==========
      if (toCall === 0) {
        return this.decideWhenCheckedTo(adjustedStrength, rawStrength, pot, aiStack, minRaise, phase, isBluffing, opponents);
      }
      
      // ========== 面对下注时的决策 ==========
      return this.decideWhenFacingBet(adjustedStrength, rawStrength, pot, toCall, aiStack, minRaise, potOdds, isBluffing, phase, opponents, magicLevel);
    }

    /**
     * 无人下注时的决策 - 关键修复：强牌必须下注榨取价值
     */
    decideWhenCheckedTo(adjustedStrength, rawStrength, pot, aiStack, minRaise, phase, isBluffing, opponents) {
      // 价值下注意识：专家更懂得用强牌下注
      const valueBetAwareness = this.difficulty.valueBetAwareness;
      const shouldValueBet = Math.random() < valueBetAwareness;
      
      // 强牌必须下注（价值下注）
      if (rawStrength >= 75 && shouldValueBet) {
        const raiseAmount = this.calculateRaiseAmount(rawStrength, pot, aiStack, minRaise);
        return { action: ACTIONS.RAISE, amount: raiseAmount, reason: '超强牌价值下注 raw≥75' };
      }
      
      if (rawStrength >= this.risk.valueBetThreshold && shouldValueBet) {
        const raiseAmount = this.calculateRaiseAmount(rawStrength, pot, aiStack, minRaise);
        return { action: ACTIONS.RAISE, amount: raiseAmount, reason: '强牌价值下注 raw≥' + this.risk.valueBetThreshold };
      }
      
      // 诈唬下注（不能超过 40% 筹码，防止意外全押诈唬）
      if (isBluffing && phase !== 'preflop') {
        const bluffAmount = Math.min(
          this.calculateRaiseAmount(50, pot, aiStack, minRaise),
          Math.floor(aiStack * 0.4)
        );
        if (bluffAmount >= minRaise) {
          return { action: ACTIONS.RAISE, amount: bluffAmount, reason: '诈唬下注 cap40%' };
        }
        return { action: ACTIONS.CHECK, amount: 0, reason: '诈唬但金额不足' };
      }
      
      // 中等牌力：根据风险喜好决定
      // 🔧 安全阀：rawStrength < 25 = 垃圾牌，不走价值下注路径
      if (rawStrength >= 25 && adjustedStrength >= this.risk.raiseThreshold) {
        const raiseAmount = this.calculateRaiseAmount(adjustedStrength, pot, aiStack, minRaise);
        return { action: ACTIONS.RAISE, amount: raiseAmount, reason: '中等牌力下注 adj≥' + this.risk.raiseThreshold };
      }
      
      // 弱牌：过牌
      return { action: ACTIONS.CHECK, amount: 0, reason: rawStrength < 25 ? '垃圾牌过牌 raw<25' : '牌力不足过牌' };
    }

    /**
     * 面对下注时的决策
     */
    decideWhenFacingBet(adjustedStrength, rawStrength, pot, toCall, aiStack, minRaise, potOdds, isBluffing, phase, opponents, magicLevel) {
      // 底池承诺快速通道：筹码极少且底池巨大时，跳过所有恐惧逻辑直接跟
      const potCommitRatio = pot / (toCall + 0.01);
      if (toCall >= aiStack * 0.8 && potCommitRatio >= 5) {
        return { action: ACTIONS.ALL_IN, amount: aiStack, reason: '底池承诺 pot/call=' + Math.round(potCommitRatio) };
      }

      // 生存本能 v2：多层次恐惧机制
      const betRatio = toCall / (pot + 0.01);
      const stackRatio = toCall / (aiStack + 0.01);
      
      let pressureLevel = 0;
      if (betRatio > 0.3) pressureLevel++;
      if (betRatio > 0.6) pressureLevel++;
      if (stackRatio > 0.4) pressureLevel++;
      if (stackRatio > 0.7) pressureLevel++;
      
      if (phase === 'preflop' && stackRatio < 0.05) {
        pressureLevel = 0;
      }
      
      const magicReduction = (magicLevel || 0) * 5;
      const preflopDiscount = phase === 'preflop' ? 30 : 0;
      const survivalThreshold = Math.max(5, 30 + pressureLevel * 15 - magicReduction - preflopDiscount);
      
      if (rawStrength < survivalThreshold && pressureLevel >= 1) {
        let foldChance = 0.95;
        
        if (this.riskType === 'rock') {
          foldChance = 0.99;
        } else if (this.riskType === 'passive') {
          foldChance = 0.85;
        } else if (this.riskType === 'maniac') {
          foldChance = 0.70;
        } else if (this.riskType === 'aggressive') {
          foldChance = 0.80;
        }
        
        if (this.difficultyType === 'pro') {
          foldChance *= 0.9;
        }
        
        if (magicLevel > 0) {
          foldChance *= Math.max(0.2, 1 - magicLevel * 0.15);
        }
        
        if (isBluffing && pressureLevel <= 1) {
          foldChance *= 0.5;
        }
        
        if (phase === 'preflop' && pressureLevel <= 1) {
          foldChance *= 0.12;
        } else if (phase === 'preflop' && pressureLevel <= 2) {
          foldChance *= 0.4;
        }
        
        const foldResist = this.emotion.foldResistDelta || 0;
        if (foldResist !== 0) {
          foldChance = Math.max(0.05, Math.min(0.99, foldChance + foldResist));
        }
        
        if (Math.random() < foldChance) {
          return { action: ACTIONS.FOLD, amount: 0, reason: '生存本能 pressure=' + pressureLevel + ' threshold=' + survivalThreshold + ' fold%=' + Math.round(foldChance * 100) };
        }
      }
      
      // 需要全押才能跟
      if (toCall >= aiStack) {
        const potOddsRatio = pot / (aiStack + 0.01);
        if (potOddsRatio >= 3) {
          return { action: ACTIONS.ALL_IN, amount: aiStack, reason: '底池承诺allin pot/stack=' + Math.round(potOddsRatio) };
        }
        if (potOddsRatio >= 1.5 && adjustedStrength >= 15) {
          return { action: ACTIONS.ALL_IN, amount: aiStack, reason: '赔率allin pot/stack=' + Math.round(potOddsRatio * 10) / 10 };
        }
        if (rawStrength >= 60) {
          return { action: ACTIONS.ALL_IN, amount: aiStack, reason: '强牌allin raw≥60' };
        }
        if (this.riskType === 'maniac' && adjustedStrength >= 45 && Math.random() < 0.2) {
          return { action: ACTIONS.ALL_IN, amount: aiStack, reason: '疯子乱推' };
        }
        return { action: ACTIONS.FOLD, amount: 0, reason: 'allin弃牌 raw=' + rawStrength + ' potRatio=' + Math.round(potOddsRatio * 10) / 10 };
      }
      
      // 底池赔率检查
      const potOddsCheck = this.difficulty.potOddsAwareness;
      const isPotOddsFavorable = potOdds < (adjustedStrength / 100) * potOddsCheck + (1 - potOddsCheck) * 0.5;
      
      // 河牌圈特殊处理：弱牌面对下注几乎必弃
      if (phase === 'river' && rawStrength <= 20 && toCall > pot * 0.25) {
        if (this.riskType !== 'passive' || Math.random() > 0.2) {
          return { action: ACTIONS.FOLD, amount: 0, reason: '河牌弱牌弃 raw≤20' };
        }
      }
      
      // 超强牌：加注
      if (rawStrength >= 75) {
        const raiseAmount = this.calculateRaiseAmount(rawStrength, pot, aiStack, minRaise);
        if (raiseAmount > toCall * 2) {
          return { action: ACTIONS.RAISE, amount: raiseAmount, reason: '超强牌加注 raw≥75' };
        }
        return { action: ACTIONS.CALL, amount: toCall, reason: '超强牌跟注(加注不够大)' };
      }
      
      // 强牌：跟注或加注
      if (adjustedStrength >= this.risk.raiseThreshold) {
        if (rawStrength >= 25) {
          const raiseAmount = this.calculateRaiseAmount(adjustedStrength, pot, aiStack, minRaise);
          if (raiseAmount > toCall * 2) {
            return { action: ACTIONS.RAISE, amount: raiseAmount, reason: '强牌加注 adj≥' + this.risk.raiseThreshold };
          }
        }
        return { action: ACTIONS.CALL, amount: toCall, reason: '强牌跟注 adj≥' + this.risk.raiseThreshold };
      }
      
      // 中等牌力：根据赔率和风险喜好决定
      if (adjustedStrength >= this.risk.callDownThreshold) {
        if (isPotOddsFavorable || this.riskType === 'passive') {
          return { action: ACTIONS.CALL, amount: toCall, reason: '中等跟注 adj≥' + this.risk.callDownThreshold + (isPotOddsFavorable ? ' 赔率好' : ' passive') };
        }
      }
      
      // 诈唬加注
      if (isBluffing && pressureLevel === 0 && Math.random() < 0.4) {
        const bluffAmount = Math.min(
          this.calculateRaiseAmount(55, pot, aiStack, minRaise),
          Math.floor(aiStack * 0.4)
        );
        if (bluffAmount >= minRaise) {
          return { action: ACTIONS.RAISE, amount: bluffAmount, reason: '诈唬加注 cap40%' };
        }
      }
      
      // 弱牌但赔率合适：跟注站会跟
      if (this.riskType === 'passive' && adjustedStrength >= 15) {
        return { action: ACTIONS.CALL, amount: toCall, reason: 'passive跟注站' };
      }
      
      // 弱牌：弃牌
      const effectiveEntry = phase === 'preflop' ? Math.max(10, this.risk.entryThreshold - 15) : this.risk.entryThreshold;
      if (adjustedStrength < effectiveEntry && !isBluffing) {
        return { action: ACTIONS.FOLD, amount: 0, reason: '弱牌弃 adj<' + effectiveEntry };
      }
      
      // 默认跟注
      return { action: ACTIONS.CALL, amount: toCall, reason: '默认跟注' };
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

  // ========== SkillAI — 技能决策模块 ==========
  // 纯函数，无状态。所有技能相关的 AI 决策集中在这里。
  // skill-system.js 通过回调委托到这里，不直接耦合。
  //
  // 两大职责：
  //   1. shouldUseSkill — NPC 是否使用某个主动技能（4属性 × 3难度）
  //   2. pickCurseTarget — Curse 选目标（3难度）

  const PHASE_INDEX = { preflop: 0, flop: 1, turn: 2, river: 3 };

  const SkillAI = {

    // ================================================================
    //  shouldUseSkill — NPC 技能使用决策
    // ================================================================

    /**
     * NPC 是否应该使用某个主动技能
     *
     * @param {string} difficulty    - 'noob' | 'regular' | 'pro'
     * @param {object} skill         - skill 注册对象 (effect, attr, tier, manaCost, ...)
     * @param {object} owner         - gameContext.players 中的 owner 对象
     * @param {object} ctx           - gameContext { phase, pot, players, board }
     * @param {Array}  pendingForces - skillSystem.pendingForces
     * @param {object} mana          - { current, max }
     * @returns {boolean}
     */
    shouldUseSkill(difficulty, skill, owner, ctx, pendingForces, mana) {
      // river 阶段无牌可发，发牌类技能无意义
      if (ctx.phase === 'river') return false;

      switch (skill.attr) {
        case 'moirai': return SkillAI._decideMoirai(difficulty, skill, owner, ctx, pendingForces, mana);
        case 'chaos':  return SkillAI._decideChaos(difficulty, skill, owner, ctx, pendingForces, mana);
        case 'psyche': return SkillAI._decidePsyche(difficulty, skill, owner, ctx, pendingForces, mana);
        case 'void':   return SkillAI._decideVoid(difficulty, skill, owner, ctx, pendingForces, mana);
        default:       return Math.random() < 0.2;
      }
    },

    // ---- Moirai (天命: fortune) ----
    // 核心问题：什么时候用大吉 vs 小吉？什么阶段用？
    _decideMoirai(difficulty, skill, owner, ctx, forces, mana) {
      const pi = PHASE_INDEX[ctx.phase] || 0;
      const pot = ctx.pot || 0;

      switch (difficulty) {
        case 'noob': {
          // 本能型：有就用，不区分大小，不看局势
          // preflop 也可能用（浪费），概率随阶段略增
          return Math.random() < (0.25 + pi * 0.12);
        }
        case 'regular': {
          // 底池感知：底池大用大吉，底池小用小吉省 mana
          // preflop: T3 有一定概率，T2 低概率（赌一把的心态）
          if (pi === 0) {
            if (skill.tier === 3) return Math.random() < 0.2;
            if (skill.tier === 2) return Math.random() < 0.1;
            return false; // T1 preflop 不用
          }
          // mana 紧张时只用 T3
          if (mana && mana.current < mana.max * 0.3 && skill.tier !== 3) return false;
          // 底池越大越积极（相对于盲注，而非固定值）
          var blinds = ctx.blinds || 20;
          var potFactor = Math.min(1, pot / (blinds * 12));
          var tierBoost = skill.tier === 1 ? 0.18 : skill.tier === 2 ? 0.12 : 0;
          return Math.random() < (0.25 + potFactor * 0.35 + tierBoost);
        }
        case 'pro': {
          // 手牌感知：强牌才用大吉（放大优势），弱牌不浪费
          // turn/river 优先（信息更完整）
          if (pi === 0) return false;
          // 评估手牌强度
          var strength = SkillAI._getHandStrength(owner, ctx);
          // 弱牌（<40）不用 T1/T2，省 mana 弃牌
          if (strength < 40 && skill.tier <= 2) return false;
          // mana 管理：预留 mana 给高价值技能
          if (mana && mana.current < skill.manaCost * 1.5 && skill.tier !== 1) return false;
          // 强牌 + 后期 = 积极使用
          var strengthFactor = Math.min(1, strength / 80);
          var phaseFactor = pi * 0.12;
          return Math.random() < (strengthFactor * 0.5 + phaseFactor);
        }
        default: return false;
      }
    },

    // ---- Chaos (狂厄: curse) ----
    // 核心问题：诅咒谁？什么时候诅咒？
    _decideChaos(difficulty, skill, owner, ctx, forces, mana) {
      var pi = PHASE_INDEX[ctx.phase] || 0;
      var pot = ctx.pot || 0;

      switch (difficulty) {
        case 'noob': {
          // 筹码导向 + 随机：谁筹码多打谁，但有随机性
          // 不管 mana，有就花
          return Math.random() < (0.25 + pi * 0.1);
        }
        case 'regular': {
          // 底池感知：底池大时更积极（收益高）
          if (pi === 0) return Math.random() < 0.12; // preflop 偶尔
          if (mana && mana.current < mana.max * 0.3 && skill.tier !== 3) return false;
          var blinds2 = ctx.blinds || 20;
          var potFactor = Math.min(1, pot / (blinds2 * 12));
          return Math.random() < (0.2 + potFactor * 0.45);
        }
        case 'pro': {
          // 战术型：自己牌力中等时用（弱牌弃牌更好，强牌不需要）
          if (pi === 0) return false;
          var strength = SkillAI._getHandStrength(owner, ctx);
          // 太弱（<25）不值得投入 mana，弃牌更好
          if (strength < 25) return false;
          // 太强（>75）不需要诅咒，自己赢面够大
          if (strength > 75 && skill.tier >= 2) return false;
          // mana 管理
          if (mana && mana.current < skill.manaCost * 1.5 && skill.tier !== 1) return false;
          // 中等牌力 + 后期 = 最佳诅咒时机
          var midStrengthBonus = (strength >= 30 && strength <= 65) ? 0.2 : 0;
          var phaseFactor = pi * 0.1;
          return Math.random() < (0.15 + midStrengthBonus + phaseFactor);
        }
        default: return false;
      }
    },

    // ---- Psyche (灵视: clarity / refraction / reversal) ----
    // 核心问题：什么时候反制？预防性使用还是反应性使用？
    _decidePsyche(difficulty, skill, owner, ctx, forces, mana) {
      var pi = PHASE_INDEX[ctx.phase] || 0;
      // 检测敌方 Chaos forces
      var enemyChaos = forces.filter(function(f) {
        return f.attr === 'chaos' && f.ownerId !== owner.id;
      });
      var hasChaos = enemyChaos.length > 0;
      // 检测敌方 Chaos 总 power
      var chaosPower = enemyChaos.reduce(function(sum, f) { return sum + (f.power || 0); }, 0);

      switch (difficulty) {
        case 'noob': {
          // 几乎不用：不懂反制价值，偶尔随机触发
          // 有敌方 Chaos 时稍微积极一点（本能反应）
          return Math.random() < (hasChaos ? 0.15 : 0.05);
        }
        case 'regular': {
          // 反应式：检测到敌方 Chaos 才用
          // 优先用低阶（澄澈省 mana），高阶留给大威胁
          if (!hasChaos) return Math.random() < 0.1; // 无 Chaos 时偶尔用（信息价值）
          // mana 紧张时只用 T3
          if (mana && mana.current < mana.max * 0.3 && skill.tier !== 3) return false;
          // Chaos power 越大越积极
          var urgency = Math.min(1, chaosPower / 30);
          // T3 优先（省 mana），除非 Chaos 很强
          if (skill.tier === 3) return Math.random() < (0.5 + urgency * 0.3);
          if (skill.tier === 2) return Math.random() < (0.2 + urgency * 0.5);
          // T1 只在 Chaos power 很高时用
          return Math.random() < (chaosPower >= 25 ? 0.55 : 0.15);
        }
        case 'pro': {
          // 预判式：即使没 Chaos 也会在关键轮次预防性使用
          // 优先高阶（折射/真理 > 澄澈，信息+反制双重价值）
          // mana 精细管理
          if (mana && mana.current < skill.manaCost * 1.2) return false;

          if (hasChaos) {
            // 有 Chaos 时：根据威胁等级选择对应技能
            var urgency2 = Math.min(1, chaosPower / 40);
            // 高 Chaos → 用高阶技能
            if (skill.tier === 1) return Math.random() < (chaosPower >= 25 ? 0.7 : 0.2);
            if (skill.tier === 2) return Math.random() < (0.3 + urgency2 * 0.4);
            return Math.random() < (0.4 + urgency2 * 0.2); // T3 兜底
          }

          // 无 Chaos 时：预防性使用（信息价值）
          // flop/turn 是关键决策点，预防性释放
          if (pi >= 1 && pi <= 2) {
            // 优先高阶（信息价值更大）
            if (skill.tier <= 2) return Math.random() < 0.2;
            return Math.random() < 0.12;
          }
          return false; // preflop 不预防
        }
        default: return false;
      }
    },

    // ---- Void (虚无: null_field / void_shield / purge_all) ----
    // null_field 和 void_shield 是 passive，不需要决策
    // 只有 purge_all (现实) 是 active
    _decideVoid(difficulty, skill, owner, ctx, forces, mana) {
      // 只有 purge_all 需要决策（其他是 passive）
      if (skill.effect !== 'purge_all') return false;

      var totalForces = forces.length;

      switch (difficulty) {
        case 'noob': {
          // 不懂核弹级技能的价值，几乎不用
          return totalForces >= 4 && Math.random() < 0.15;
        }
        case 'regular': {
          // 场上 force ≥ 3 时才用（核弹不乱扔）
          return totalForces >= 3 && Math.random() < 0.35;
        }
        case 'pro': {
          // 精准时机：敌方刚释放 T1/T2 技能后立即清场
          // 或者场上敌方 forces 对自己不利时
          var enemyForces = forces.filter(function(f) { return f.ownerId !== owner.id; });
          var allyForces = forces.filter(function(f) { return f.ownerId === owner.id; });
          // 敌方力量远超己方时才用（净化对自己有利）
          var enemyPower = enemyForces.reduce(function(s, f) { return s + (f.power || 0); }, 0);
          var allyPower = allyForces.reduce(function(s, f) { return s + (f.power || 0); }, 0);
          if (enemyPower <= allyPower) return false; // 己方优势不清场
          // 敌方有 T1 技能时更积极
          var hasEnemyT1 = enemyForces.some(function(f) { return f.tier === 1; });
          return Math.random() < (hasEnemyT1 ? 0.6 : 0.3);
        }
        default: return false;
      }
    },

    // ---- 工具函数 ----

    /**
     * 获取 NPC 当前手牌强度 (0-100)
     * preflop 用 preflopStrength，flop+ 用 pokersolver
     */
    _getHandStrength(owner, ctx) {
      if (!owner.cards || owner.cards.length < 2) return 30; // 默认中等
      var board = ctx.board || [];
      if (board.length === 0) {
        return evaluatePreflopStrength(owner.cards);
      }
      var result = evaluateHandStrength(owner.cards, board);
      return HAND_STRENGTH_MAP[result.rank] || 30;
    },

    // ================================================================
    //  pickCurseTarget — Curse 选目标
    // ================================================================

    /**
     * 为 Curse 选择最佳目标
     *
     * 策略由 difficulty 决定：
     *   noob    → Chip Leader:      筹码最多的对手 + 随机性
     *   regular → Pot Commitment:   诅咒投入底池最多的对手（沉没成本最大）
     *   pro     → Threat Assessment: 综合下注量+筹码量评估威胁度
     *
     * @param {string} difficulty - 'noob' | 'regular' | 'pro'
     * @param {number} casterId  - 施法者 ID
     * @param {Array}  players   - gameContext.players
     * @returns {number} targetId
     */
    pickCurseTarget(difficulty, casterId, players) {
      if (!players || !players.length) {
        return casterId === 0 ? 1 : 0;
      }

      var candidates = players.filter(function(p) {
        return p.id !== casterId && !p.folded && p.chips > 0;
      });

      if (candidates.length === 0) {
        return casterId === 0 ? 1 : 0;
      }

      switch (difficulty) {
        case 'pro':     return SkillAI._targetByThreat(candidates);
        case 'regular': return SkillAI._targetByPotCommitment(candidates);
        default:        return SkillAI._targetByChips(candidates);
      }
    },

    /**
     * Chip Leader + Random — 筹码最多的对手，但有 30% 随机
     * 适用：noob AI（直觉型，谁钱多打谁，但不精准）
     */
    _targetByChips(candidates) {
      // 30% 纯随机
      if (Math.random() < 0.3) {
        return candidates[Math.floor(Math.random() * candidates.length)].id;
      }
      // 70% 选筹码最多的
      candidates.sort(function(a, b) { return (b.chips || 0) - (a.chips || 0); });
      return candidates[0].id;
    },

    /**
     * Pot Commitment — 诅咒投入底池最多的对手（加权随机）
     * 适用：regular AI
     * 逻辑：投入越多权重越高，但不是100%确定性
     */
    _targetByPotCommitment(candidates) {
      var weights = candidates.map(function(p) {
        return Math.max(1, (p.totalBet || 0) + (p.currentBet || 0) + (p.chips || 0) * 0.1);
      });
      return SkillAI._weightedPick(candidates, weights);
    },

    /**
     * Threat Assessment — 综合威胁度评估（加权随机）
     * 适用：pro AI（"拥有魔力的高手能感知势头"）
     * 逻辑：威胁分 = 下注量×0.7 + 筹码量×0.3，按威胁分加权随机
     */
    _targetByThreat(candidates) {
      var maxInvested = Math.max(1, Math.max.apply(null, candidates.map(function(p) { return (p.totalBet || 0) + (p.currentBet || 0); })));
      var maxChips = Math.max(1, Math.max.apply(null, candidates.map(function(p) { return p.chips || 0; })));

      var weights = candidates.map(function(p) {
        var invested = (p.totalBet || 0) + (p.currentBet || 0);
        return Math.max(0.1, (invested / maxInvested) * 0.7 + ((p.chips || 0) / maxChips) * 0.3);
      });
      return SkillAI._weightedPick(candidates, weights);
    },

    /**
     * 加权随机选择 — 权重越高被选中概率越大，但不是100%确定
     */
    _weightedPick(candidates, weights) {
      var total = weights.reduce(function(s, w) { return s + w; }, 0);
      var r = Math.random() * total;
      var cumulative = 0;
      for (var i = 0; i < candidates.length; i++) {
        cumulative += weights[i];
        if (r <= cumulative) return candidates[i].id;
      }
      return candidates[candidates.length - 1].id;
    }
  };

  // ========== 导出 ==========
  global.PokerAI = PokerAI;
  global.PokerAI.ACTIONS = ACTIONS;
  global.PokerAI.RISK_PROFILES = RISK_PROFILES;
  global.PokerAI.DIFFICULTY_PROFILES = DIFFICULTY_PROFILES;
  global.PokerAI.EMOTION_PROFILES = EMOTION_PROFILES;
  global.PokerAI.evaluateHandStrength = evaluateHandStrength;
  global.PokerAI.evaluatePreflopStrength = evaluatePreflopStrength;
  global.PokerAI.cardToString = cardToString;
  global.PokerAI.SkillAI = SkillAI;

})(typeof window !== 'undefined' ? window : global);
