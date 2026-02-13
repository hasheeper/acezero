/* global Hand, EquityEstimator */

/**
 * Poker AI - 德州扑克AI决策系统 (v2 — 效用函数架构)
 * 
 * 三层架构：
 *   第 2 层 (底层): 胜率评估 — noob 查表 / regular+ 蒙特卡洛 / pro+ 魔运修正
 *   第 1 层 (中层): 效用函数 — 6 维权重打分 + Softmax 加权随机选择
 *   第 3 层 (顶层): 情绪修正 — 温度 delta 影响理性程度
 * 
 * 四档质变：
 *   noob    — 查表胜率 + 高温度(随机) + 二极化下注 + 只看自己牌
 *   regular — 蒙特卡洛 + 标准温度 + 线性泄露下注 + 多因素均衡
 *   pro     — MC+魔运修正 + 低温度(理性) + 固定比例下注 + 魔运权重最高
 *   boss    — 同pro + 极低温度 + 反向欺骗下注 + 攻击倾向最高
 * 
 * 三维个性配置：
 *   1. 风险喜好 (Risk Appetite): rock, balanced, aggressive, maniac, passive
 *   2. 难度等级 (Difficulty): noob, regular, pro, boss
 *   3. 情绪状态 (Emotion): calm, confident, tilt, fearful, desperate, euphoric
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
    },
    boss: {
      description: 'Boss级，碾压+剧本',
      noiseRange: 3,
      potOddsAwareness: 1.0,
      positionAwareness: 1.0,
      valueBetAwareness: 1.0,
      optimism: 0
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

  // ========== 效用函数系统 (Utility System) ==========
  // 替代 if-else 瀑布，所有因素同时参与打分

  // 候选动作模板
  const ACTION_CANDIDATES = [
    { action: ACTIONS.FOLD,  sizing: null },
    { action: ACTIONS.CHECK, sizing: null },
    { action: ACTIONS.CALL,  sizing: null },
    { action: ACTIONS.RAISE, sizing: 'small'  },  // ~33% pot
    { action: ACTIONS.RAISE, sizing: 'medium' },  // ~66% pot
    { action: ACTIONS.RAISE, sizing: 'large'  },  // ~100% pot
    { action: ACTIONS.RAISE, sizing: 'allin'  }   // all-in
  ];

  // 四档权重向量: [手牌, 赔率, 位置, 对手, 魔运, 攻击]
  const UTILITY_WEIGHTS = {
    noob:    { hand: 0.70, potOdds: 0.05, position: 0.00, opponent: 0.00, magic: 0.05, aggro: 0.20 },
    regular: { hand: 0.40, potOdds: 0.20, position: 0.10, opponent: 0.00, magic: 0.15, aggro: 0.15 },
    pro:     { hand: 0.20, potOdds: 0.15, position: 0.10, opponent: 0.15, magic: 0.30, aggro: 0.10 },
    boss:    { hand: 0.15, potOdds: 0.10, position: 0.05, opponent: 0.10, magic: 0.35, aggro: 0.25 }
  };

  // Softmax 温度：越低越理性（几乎总选最优），越高越随机
  const TEMPERATURE = {
    noob:    2.0,
    regular: 1.0,
    pro:     0.5,
    boss:    0.3
  };

  // 风险喜好对攻击倾向的修正
  const RISK_AGGRO_DELTA = {
    rock:       -0.10,
    balanced:    0.00,
    aggressive:  0.10,
    maniac:      0.20,
    passive:    -0.15
  };

  // 情绪对温度的修正
  const EMOTION_TEMP_DELTA = {
    calm: 0, confident: -0.1, tilt: 0.8, fearful: 0.3, desperate: 0.3, euphoric: 0.2
  };

  // ---- 评分函数 ----

  /**
   * 手牌评分：equity 越高，raise/call 越好；equity 低时 fold 好
   * @param {number} equity - 0~1 胜率
   * @param {string} action - 动作类型
   * @returns {number} -1 ~ +1
   */
  function scoreHand(equity, action) {
    if (action === ACTIONS.FOLD) {
      // equity 低时 fold 得分高，equity 高时 fold 得分极低
      return (1 - equity) * 0.6 - 0.3; // equity=0 → +0.3, equity=0.5 → 0, equity=1 → -0.3
    }
    if (action === ACTIONS.CHECK) {
      // check 是中性选择，弱牌时略好
      return 0.1 - equity * 0.15; // equity=0 → +0.1, equity=1 → -0.05
    }
    // call / raise: equity 越高越好
    const base = equity * 1.5 - 0.4; // equity=0 → -0.4, equity=0.5 → +0.35, equity=1 → +1.1
    return Math.max(-1, Math.min(1, base));
  }

  /**
   * 底池赔率评分：call 时赔率好=正分，赔率差=负分
   * @param {number} equity   - 0~1
   * @param {number} potOdds  - toCall / (pot + toCall)
   * @param {string} action
   * @param {number} toCall
   * @param {number} pot
   * @returns {number}
   */
  function scorePotOdds(equity, potOdds, action, toCall, pot) {
    if (action === ACTIONS.FOLD || action === ACTIONS.CHECK) return 0;
    if (action === ACTIONS.CALL) {
      // 赔率好 = equity > potOdds → 正分
      const edge = equity - potOdds;
      return Math.max(-1, Math.min(1, edge * 3));
    }
    // raise: 只有 equity 足够时才奖励加注，否则惩罚
    // equity < 0.35 时加注是负分（别用垃圾牌加注）
    const raiseEdge = equity - 0.35;
    return Math.max(-0.5, Math.min(0.5, raiseEdge * 2));
  }

  /**
   * 位置评分：后位 raise 加分，前位 raise 减分
   * @param {string} action
   * @param {number} opponents - 剩余对手数
   * @param {string} phase
   * @returns {number}
   */
  function scorePosition(action, opponents, phase) {
    if (action === ACTIONS.FOLD || action === ACTIONS.CHECK) return 0;
    // 简化：对手越少 = 位置越好（接近按钮位）
    // 多人局 raise 风险大
    const posBonus = Math.max(-0.3, 0.3 - opponents * 0.15);
    if (action === ACTIONS.CALL) return posBonus * 0.3;
    return posBonus; // raise 受位置影响更大
  }

  /**
   * 对手建模评分（pro/boss 专用，其他档位权重=0 所以不影响）
   * @param {object} ctx - 决策上下文
   * @param {string} action
   * @returns {number}
   */
  function scoreOpponent(ctx, action) {
    // 对手 mana 低 → raise 加分（没魔运反制）
    const oppManaRatio = ctx.opponentManaRatio != null ? ctx.opponentManaRatio : 0.5;
    if (action === ACTIONS.FOLD || action === ACTIONS.CHECK) return 0;
    if (action === ACTIONS.CALL) return 0;
    // raise 时，对手 mana 越低越好
    return (1 - oppManaRatio) * 0.5;
  }

  /**
   * 魔运态势评分：己方魔运优势 → raise 加分，劣势 → fold 加分
   * @param {number} magicLevel - 己方最高魔运等级 0~5
   * @param {number} netForce   - 净魔运力量（可为负）
   * @param {string} action
   * @returns {number}
   */
  function scoreMagic(magicLevel, netForce, action) {
    // 归一化到 -1 ~ +1
    const advantage = Math.tanh((netForce || 0) * 0.02 + (magicLevel || 0) * 0.1);
    if (action === ACTIONS.FOLD) {
      return -advantage * 0.5; // 魔运优势时 fold 得分低
    }
    if (action === ACTIONS.CHECK) {
      return -advantage * 0.2;
    }
    // call/raise: 魔运优势越大越好
    return advantage * 0.6;
  }

  /**
   * 攻击倾向评分：raise/allin 固定加分
   * @param {string} action
   * @param {string} sizing
   * @returns {number}
   */
  function scoreAggro(action, sizing) {
    if (action === ACTIONS.FOLD) return -0.3;
    if (action === ACTIONS.CHECK) return -0.1;
    if (action === ACTIONS.CALL) return 0;
    // raise 越大分越高
    if (sizing === 'small') return 0.2;
    if (sizing === 'medium') return 0.35;
    if (sizing === 'large') return 0.45;
    if (sizing === 'allin') return 0.55;
    return 0.3;
  }

  // ---- Softmax ----

  function softmaxSelect(utilities, temperature) {
    const t = Math.max(0.1, temperature);
    const maxU = Math.max(...utilities);
    const exps = utilities.map(u => Math.exp((u - maxU) / t));
    const sumExp = exps.reduce((s, e) => s + e, 0);
    const probs = exps.map(e => e / sumExp);

    const r = Math.random();
    let cumulative = 0;
    for (let i = 0; i < probs.length; i++) {
      cumulative += probs[i];
      if (r <= cumulative) return { index: i, probs };
    }
    return { index: probs.length - 1, probs };
  }

  // ---- 下注尺度分档 ----

  /**
   * 根据难度档位计算下注金额
   * noob:    二极化（min-raise 或 all-in）
   * regular: 线性泄露（强牌大注弱牌小注）
   * pro:     固定比例 60-75% pot
   * boss:    反向欺骗（20% 概率强牌小注、弱牌大注）
   */
  function calculateBetSize(difficulty, sizing, equity, pot, stack, minRaise) {
    let amount;

    if (difficulty === 'noob') {
      // 二极化：min-raise 或随机大注，但不会随机梭哈
      if (sizing === 'allin') {
        amount = stack;
      } else if (Math.random() < 0.35) {
        // 偶尔下大注（2-3x pot），但不是 all-in
        amount = Math.floor(pot * (1.5 + Math.random() * 1.5));
      } else {
        amount = minRaise;
      }
    } else if (difficulty === 'regular') {
      // 线性泄露：equity 直接映射到下注比例（可被读）
      // equity 0.3 → 30% pot, equity 0.8 → 80% pot
      const sizingMap = { small: 0.33, medium: 0.66, large: 1.0, allin: 999 };
      const targetRatio = sizingMap[sizing] || 0.5;
      // 牌力修正：强牌自然下大注（泄露线索）
      const leakRatio = 0.3 + equity * 0.7;
      const finalRatio = Math.min(targetRatio, leakRatio);
      amount = sizing === 'allin' ? stack : Math.floor(pot * finalRatio);
    } else if (difficulty === 'pro') {
      // 固定比例：不泄露信息
      const fixedRatio = 0.60 + Math.random() * 0.15; // 60-75% pot
      if (sizing === 'allin') {
        amount = stack;
      } else {
        amount = Math.floor(pot * fixedRatio);
      }
    } else {
      // boss: 反向欺骗
      const invert = Math.random() < 0.20;
      const base = invert ? (1 - equity) : equity;
      const ratio = 0.4 + base * 0.6;
      if (sizing === 'allin') {
        amount = stack;
      } else {
        amount = Math.floor(pot * ratio);
      }
    }

    amount = Math.max(amount, minRaise);
    amount = Math.min(amount, stack);
    return amount;
  }

  // ========== 行为状态机 (Behavior FSM) ==========
  // 驱动效用权重和温度的动态变化
  // 状态由局中事件自动触发转移，不同难度有不同的状态集和衰减速度

  const FSM_STATES = {
    CAUTIOUS: 'cautious',   // 谨慎：基准状态
    HUNTING:  'hunting',    // 狩猎：赢了大锅后激进
    TILTED:   'tilted',     // 上头：被 Bad Beat 后混乱
    CORNERED: 'cornered'    // 被逼：筹码见底，孤注一掷
  };

  // 状态对效用权重和温度的修正
  const FSM_MODIFIERS = {
    cautious: { aggroDelta: 0,     tempDelta: 0,    label: '谨慎' },
    hunting:  { aggroDelta: 0.15,  tempDelta: -0.1, label: '狩猎' },
    tilted:   { aggroDelta: 0.35,  tempDelta: 0.8,  label: '上头' },
    cornered: { aggroDelta: 0.25,  tempDelta: 0.3,  label: '被逼' }
  };

  // 上头持续手数（按难度）
  const TILT_DURATION = {
    noob:    5,
    regular: 3,
    pro:     1,
    boss:    0   // boss 不会上头（用阶段脚本替代）
  };

  // 各难度可用的状态集
  const DIFFICULTY_STATES = {
    noob:    [FSM_STATES.CAUTIOUS, FSM_STATES.TILTED],                                          // 只有 2 态
    regular: [FSM_STATES.CAUTIOUS, FSM_STATES.HUNTING, FSM_STATES.TILTED, FSM_STATES.CORNERED], // 完整 4 态
    pro:     [FSM_STATES.CAUTIOUS, FSM_STATES.HUNTING, FSM_STATES.TILTED, FSM_STATES.CORNERED], // 完整 4 态
    boss:    [FSM_STATES.CAUTIOUS, FSM_STATES.HUNTING, FSM_STATES.CORNERED]                     // 3 态，无 tilt
  };

  class BehaviorFSM {
    /**
     * @param {string} difficulty - noob/regular/pro/boss
     * @param {number} initialChips - 起始筹码（用于判断 CORNERED）
     */
    constructor(difficulty, initialChips) {
      this.difficulty = difficulty || 'regular';
      this.state = FSM_STATES.CAUTIOUS;
      this.initialChips = initialChips || 1000;
      this.tiltCounter = 0;       // 上头剩余手数
      this.foldStreak = 0;        // 连续弃牌计数
      this.availableStates = DIFFICULTY_STATES[this.difficulty] || DIFFICULTY_STATES.regular;
    }

    /**
     * 获取当前状态的修正值
     * @returns {{ aggroDelta: number, tempDelta: number, state: string, label: string }}
     */
    getModifiers() {
      const mod = FSM_MODIFIERS[this.state] || FSM_MODIFIERS.cautious;
      return {
        aggroDelta: mod.aggroDelta,
        tempDelta: mod.tempDelta,
        state: this.state,
        label: mod.label
      };
    }

    /**
     * 手牌结束后触发事件，驱动状态转移
     * @param {string} event - 事件类型
     * @param {object} data  - 事件数据
     *
     * 事件类型:
     *   'win_big'    — 赢了大锅 (pot > 10×BB)        data: { pot, bb }
     *   'bad_beat'   — 被 Bad Beat (翻前领先但输)     data: {}
     *   'win_normal' — 普通赢                         data: {}
     *   'lose'       — 输了                           data: {}
     *   'fold'       — 弃牌                           data: {}
     *   'chip_check' — 每手结束检查筹码               data: { chips }
     */
    onEvent(event, data) {
      const prev = this.state;
      data = data || {};

      // 1. 上头衰减（每手 -1）
      if (this.tiltCounter > 0) {
        this.tiltCounter--;
        if (this.tiltCounter <= 0 && this.state === FSM_STATES.TILTED) {
          this.state = FSM_STATES.CAUTIOUS;
        }
      }

      // 2. 事件驱动转移
      switch (event) {
        case 'win_big':
          if (this._canEnter(FSM_STATES.HUNTING)) {
            this.state = FSM_STATES.HUNTING;
            this.foldStreak = 0;
          }
          break;

        case 'bad_beat':
          if (this._canEnter(FSM_STATES.TILTED)) {
            this.state = FSM_STATES.TILTED;
            this.tiltCounter = TILT_DURATION[this.difficulty] || 3;
            this.foldStreak = 0;
          }
          break;

        case 'win_normal':
          this.foldStreak = 0;
          // 赢了就从 CORNERED 恢复
          if (this.state === FSM_STATES.CORNERED) {
            this.state = FSM_STATES.CAUTIOUS;
          }
          // 赢了就从 HUNTING 回到 CAUTIOUS（一次性）
          // 不做：让 HUNTING 持续到下次输
          break;

        case 'lose':
          this.foldStreak = 0;
          // 输了就从 HUNTING 回到 CAUTIOUS
          if (this.state === FSM_STATES.HUNTING) {
            this.state = FSM_STATES.CAUTIOUS;
          }
          break;

        case 'fold':
          this.foldStreak++;
          // 连续弃牌 3 手 → 从 CAUTIOUS 切到 HUNTING（不耐烦）
          if (this.foldStreak >= 3 && this.state === FSM_STATES.CAUTIOUS) {
            if (this._canEnter(FSM_STATES.HUNTING)) {
              this.state = FSM_STATES.HUNTING;
              this.foldStreak = 0;
            }
          }
          break;

        case 'chip_check':
          // 筹码 < 30% 起始值 → CORNERED
          if (data.chips != null && data.chips < this.initialChips * 0.3) {
            if (this._canEnter(FSM_STATES.CORNERED) && this.state !== FSM_STATES.TILTED) {
              this.state = FSM_STATES.CORNERED;
            }
          }
          // 筹码恢复 > 50% → 脱离 CORNERED
          if (data.chips != null && data.chips >= this.initialChips * 0.5) {
            if (this.state === FSM_STATES.CORNERED) {
              this.state = FSM_STATES.CAUTIOUS;
            }
          }
          break;
      }

      // 3. 日志
      if (this.state !== prev) {
        console.log('[FSM] ' + prev + ' → ' + this.state +
          ' (event=' + event + ' diff=' + this.difficulty + ')');
      }
    }

    /**
     * 检查该难度是否可以进入某状态
     */
    _canEnter(state) {
      return this.availableStates.indexOf(state) !== -1;
    }

    /**
     * 重置（新一局）
     */
    reset(initialChips) {
      this.state = FSM_STATES.CAUTIOUS;
      this.tiltCounter = 0;
      this.foldStreak = 0;
      if (initialChips != null) this.initialChips = initialChips;
    }
  }

  // ========== Boss 阶段脚本 (Phase 6) ==========
  // Boss 不用通用 FSM，而是按筹码阶段执行预设脚本
  // 三阶段：从容(>70%) → 认真(30-70%) → 狂暴(<30%)

  const BOSS_PHASES = {
    COMPOSED: 'composed',   // 从容：像 pro 一样精准
    SERIOUS:  'serious',    // 认真：加大魔运投入
    ENRAGED:  'enraged'     // 狂暴：全力输出
  };

  const BOSS_PHASE_MODIFIERS = {
    composed: { aggroDelta: 0,    tempDelta: 0,    magicDelta: 0,    handFloor: 45, label: '从容' },
    serious:  { aggroDelta: 0.15, tempDelta: -0.05, magicDelta: 0.10, handFloor: 50, label: '认真' },
    enraged:  { aggroDelta: 0.30, tempDelta: -0.15, magicDelta: 0.20, handFloor: 60, label: '狂暴' }
  };

  class BossScript {
    constructor(initialChips) {
      this.initialChips = initialChips || 1000;
      this.phase = BOSS_PHASES.COMPOSED;
      this.weaknessTiltCounter = 0; // 弱点触发后的 tilt 手数
    }

    /**
     * 根据当前筹码更新阶段
     * @param {number} chips - 当前筹码
     */
    updatePhase(chips) {
      const prev = this.phase;
      const ratio = chips / Math.max(1, this.initialChips);

      if (ratio > 0.70) {
        this.phase = BOSS_PHASES.COMPOSED;
      } else if (ratio > 0.30) {
        this.phase = BOSS_PHASES.SERIOUS;
      } else {
        this.phase = BOSS_PHASES.ENRAGED;
      }

      // 弱点 tilt 衰减
      if (this.weaknessTiltCounter > 0) {
        this.weaknessTiltCounter--;
      }

      if (this.phase !== prev) {
        console.log('[BossScript] ' + prev + ' → ' + this.phase +
          ' (chips=' + chips + ' ratio=' + (ratio * 100).toFixed(0) + '%)');
      }
    }

    /**
     * 弱点触发：Boss 被特定技能反制后陷入动摇
     * @param {number} duration - 动摇持续手数
     */
    triggerWeakness(duration) {
      this.weaknessTiltCounter = duration || 2;
      console.log('[BossScript] WEAKNESS TRIGGERED! tilt for ' + this.weaknessTiltCounter + ' hands');
    }

    /**
     * 获取当前阶段的修正值
     * 弱点触发时覆盖为 tilt 模式
     */
    getModifiers() {
      // 弱点 tilt 覆盖一切
      if (this.weaknessTiltCounter > 0) {
        return {
          aggroDelta: 0.30,
          tempDelta: 1.5,       // 温度暴涨 → 随机
          magicDelta: -0.20,    // 魔运权重暴跌
          handFloor: 30,        // 手牌保底降低
          phase: 'weakness',
          label: '动摇'
        };
      }

      const mod = BOSS_PHASE_MODIFIERS[this.phase] || BOSS_PHASE_MODIFIERS.composed;
      return {
        aggroDelta: mod.aggroDelta,
        tempDelta: mod.tempDelta,
        magicDelta: mod.magicDelta,
        handFloor: mod.handFloor,
        phase: this.phase,
        label: mod.label
      };
    }

    reset(initialChips) {
      this.phase = BOSS_PHASES.COMPOSED;
      this.weaknessTiltCounter = 0;
      if (initialChips != null) this.initialChips = initialChips;
    }
  }

  // ========== 对手建模 (Phase 7) ==========
  // pro/boss 专用：追踪对手行为模式，影响 scoreOpponent 评分
  // 注意：1-3 手对局中数据极少，权重本身就低 (pro:0.15, boss:0.10)
  // 更多是"感觉 AI 在观察你"的叙事工具

  class OpponentModel {
    constructor() {
      // 每个对手的统计数据，按 playerId 索引
      this.stats = {};
    }

    /**
     * 获取或初始化某对手的统计
     */
    _getStats(playerId) {
      if (!this.stats[playerId]) {
        this.stats[playerId] = {
          handsPlayed: 0,
          vpipCount: 0,       // 主动入池次数
          pfrCount: 0,        // 翻前加注次数
          aggActions: 0,      // 攻击性动作（raise/allin）
          totalActions: 0,    // 总动作数
          foldToBetCount: 0,  // 面对下注弃牌次数
          facedBetCount: 0,   // 面对下注次数
          lastAction: null,
          lastBetSize: 0
        };
      }
      return this.stats[playerId];
    }

    /**
     * 记录对手的一个动作
     * @param {number} playerId
     * @param {string} action - fold/check/call/raise/allin
     * @param {object} ctx - { phase, toCall, amount, pot }
     */
    recordAction(playerId, action, ctx) {
      const s = this._getStats(playerId);
      s.totalActions++;
      s.lastAction = action;

      if (ctx && ctx.phase === 'preflop') {
        if (action === 'call' || action === 'raise' || action === 'allin') {
          s.vpipCount++;
        }
        if (action === 'raise' || action === 'allin') {
          s.pfrCount++;
        }
      }

      if (action === 'raise' || action === 'allin') {
        s.aggActions++;
        s.lastBetSize = ctx ? ctx.amount || 0 : 0;
      }

      if (ctx && ctx.toCall > 0) {
        s.facedBetCount++;
        if (action === 'fold') {
          s.foldToBetCount++;
        }
      }
    }

    /**
     * 记录一手结束（增加 handsPlayed）
     */
    recordHandEnd(playerId) {
      const s = this._getStats(playerId);
      s.handsPlayed++;
    }

    /**
     * 获取对手的行为画像
     * @param {number} playerId
     * @returns {{ vpip, pfr, aggFreq, foldToBet, handsPlayed }}
     */
    getProfile(playerId) {
      const s = this._getStats(playerId);
      const hands = Math.max(1, s.handsPlayed);
      const actions = Math.max(1, s.totalActions);
      const faced = Math.max(1, s.facedBetCount);

      return {
        vpip:       s.vpipCount / hands,
        pfr:        s.pfrCount / hands,
        aggFreq:    s.aggActions / actions,
        foldToBet:  s.foldToBetCount / faced,
        handsPlayed: s.handsPlayed,
        lastAction: s.lastAction,
        lastBetSize: s.lastBetSize
      };
    }

    /**
     * 计算对手建模评分（替代原来的静态 scoreOpponent）
     * @param {number} playerId - 主要对手 ID（筹码最多的活跃对手）
     * @param {number} oppManaRatio - 对手平均 mana 百分比
     * @param {string} action - 候选动作
     * @returns {number} -1 ~ +1
     */
    score(playerId, oppManaRatio, action) {
      if (action === ACTIONS.FOLD || action === ACTIONS.CHECK) return 0;

      const profile = this.getProfile(playerId);
      let bonus = 0;

      // 对手容易弃牌 → raise 加分
      if (profile.foldToBet > 0.5 && profile.handsPlayed >= 2) {
        bonus += (profile.foldToBet - 0.3) * 0.6;
      }

      // 对手很激进 → call 加分（让他犯错），raise 减分
      if (profile.aggFreq > 0.5 && profile.handsPlayed >= 2) {
        if (action === ACTIONS.CALL) {
          bonus += (profile.aggFreq - 0.3) * 0.4;
        } else {
          bonus -= 0.1; // 对激进对手 raise 风险高
        }
      }

      // 对手 mana 低 → raise 加分（没魔运反制）
      if (oppManaRatio != null) {
        bonus += (1 - oppManaRatio) * 0.3;
      }

      return Math.max(-1, Math.min(1, bonus));
    }

    reset() {
      this.stats = {};
    }
  }

  // ========== PokerAI 类 ==========
  class PokerAI {
    /**
     * @param {Object} personality - 个性配置
     * @param {string} personality.riskAppetite - 风险喜好: rock/balanced/aggressive/maniac/passive
     * @param {string} personality.difficulty - 难度等级: noob/regular/pro/boss
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

      // 行为状态机（Phase 4）
      this.fsm = new BehaviorFSM(difficultyType);

      // Boss 阶段脚本（Phase 6）— 仅 boss 难度
      this.bossScript = difficultyType === 'boss' ? new BossScript() : null;

      // 对手建模（Phase 7）— pro/boss 专用
      this.opponentModel = (difficultyType === 'pro' || difficultyType === 'boss')
        ? new OpponentModel() : null;
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
     * 做出决策 — 效用函数版
     * @param {Object} context - 决策上下文
     */
    decide(context) {
      const { holeCards, boardCards, pot, toCall, aiStack, phase, minRaise, activeOpponentCount } = context;
      const playerName = context.playerName || '?';
      const magicLevel = context.magicLevel || 0;
      const netForce = context.netForce || 0;
      const opponents = activeOpponentCount || 1;
      const raiseCount = context.raiseCount || 0;

      // 1. 胜率评估 — 分档
      let equity;
      const rawStrength = this.calculateRawStrength(holeCards, boardCards, phase);

      if (this.difficultyType === 'noob') {
        // noob: 查表（只看自己牌，不懂公共牌纹理的精确影响）
        equity = rawStrength / 100;
      } else if (typeof EquityEstimator !== 'undefined') {
        // regular+: 蒙特卡洛
        if (this.difficultyType === 'pro' || this.difficultyType === 'boss') {
          const mc = EquityEstimator.estimateWithMagic(holeCards, boardCards || [], opponents, netForce, 200);
          equity = mc.perceivedEquity;
        } else {
          const mc = EquityEstimator.estimate(holeCards, boardCards || [], opponents, 200);
          equity = mc.equity;
        }
      } else {
        // fallback: 查表
        equity = rawStrength / 100;
      }

      // 1.5 获取手牌名称（用于日志）
      let handName = phase === 'preflop' ? 'Preflop' : '?';
      if (phase !== 'preflop' && boardCards && boardCards.length > 0) {
        try {
          const hr = evaluateHandStrength(holeCards, boardCards);
          handName = hr.name || '?';
        } catch (e) { handName = '?'; }
      }

      // 2. 构建可用候选动作（equity 用于硬性门控 all-in）
      const candidates = this._buildCandidates(toCall, aiStack, minRaise, pot, equity, phase);

      // 3. 计算每个候选动作的效用分
      const potOdds = toCall > 0 ? toCall / (pot + toCall) : 0;
      const w = Object.assign({}, UTILITY_WEIGHTS[this.difficultyType] || UTILITY_WEIGHTS.regular);
      const riskAggroDelta = RISK_AGGRO_DELTA[this.riskType] || 0;

      // FSM 状态修正
      const fsmMod = this.fsm.getModifiers();
      let aggroDelta = riskAggroDelta + fsmMod.aggroDelta;
      let extraTempDelta = fsmMod.tempDelta;

      // Boss 阶段脚本修正（覆盖 FSM 的部分效果）
      let bossLabel = '';
      if (this.bossScript) {
        this.bossScript.updatePhase(aiStack);
        const bossMod = this.bossScript.getModifiers();
        aggroDelta += bossMod.aggroDelta;
        extraTempDelta += bossMod.tempDelta;
        // 魔运权重动态调整
        w.magic = Math.max(0, Math.min(1, w.magic + bossMod.magicDelta));
        bossLabel = bossMod.label;
      }

      // 对手建模：pro/boss 用 OpponentModel 替代静态 scoreOpponent
      const heroId = context.heroId != null ? context.heroId : 0;
      const oppManaRatio = context.opponentManaRatio != null ? context.opponentManaRatio : 0.5;

      // Pot-committed 快速通道：剩余筹码极少，toCall 几乎等于全部身家时直接 call
      // 条件：pot odds < 5% 且 toCall >= 80% 剩余筹码（真正的 pot-committed）
      // 例：投了 8.3金，只剩 42银，再跟 42银 看 30金底池 → 必须 call
      // 反例：20银 bet into 400 pot，手里还有 900 → 不触发，走正常决策（可能 raise）
      const potOddsRatio = toCall > 0 ? toCall / (pot + toCall) : 0;
      const stackCommit = toCall > 0 ? toCall / Math.max(1, aiStack) : 0;
      if (toCall > 0 && potOddsRatio < 0.05 && stackCommit >= 0.8 && equity > 0.08) {
        console.log('[AI] ' + playerName + ' pot-committed: toCall=' + toCall +
          ' pot=' + pot + ' odds=' + (potOddsRatio * 100).toFixed(1) + '% stack=' + (stackCommit * 100).toFixed(0) + '% → auto CALL');
        return { action: ACTIONS.CALL, amount: toCall };
      }

      // 筹码承诺惩罚：toCall 占 stack 比例越高，call/raise 需要越高 equity 才值得
      // commitRatio: 0 = 免费, 0.5 = 半个筹码, 1.0 = 全押
      const commitRatio = toCall > 0 ? Math.min(1, toCall / Math.max(1, aiStack)) : 0;
      // 当 pot odds 很好时（toCall << pot），减轻惩罚
      const potOddsFactor = potOddsRatio < 0.15 ? potOddsRatio / 0.15 : 1.0;
      // 软惩罚：equity 足够高时不惩罚，低时才惩罚
      const commitPenalty = commitRatio > 0.15
        ? Math.max(-0.5, (equity - 0.35) - commitRatio * 0.4) * potOddsFactor
        : 0;

      const utilities = candidates.map(c => {
        const a = c.action;
        const s = c.sizing;
        const uHand     = scoreHand(equity, a);
        const uPotOdds  = scorePotOdds(equity, potOdds, a, toCall, pot);
        const uPosition = scorePosition(a, opponents, phase);
        const uOpponent = this.opponentModel
          ? this.opponentModel.score(heroId, oppManaRatio, a)
          : scoreOpponent(context, a);
        const uMagic    = scoreMagic(magicLevel, netForce, a);
        const uAggro    = scoreAggro(a, s) + aggroDelta;

        let u = w.hand * uHand
              + w.potOdds * uPotOdds
              + w.position * uPosition
              + w.opponent * uOpponent
              + w.magic * uMagic
              + w.aggro * uAggro;

        // 筹码承诺惩罚：call/raise 在高承诺时被惩罚
        if (commitPenalty < 0 && (a === ACTIONS.CALL || a === ACTIONS.RAISE)) {
          u += commitPenalty;
          // raise 额外惩罚（比 call 更危险）
          if (a === ACTIONS.RAISE) u += commitPenalty * 0.5;
        }

        // 弱牌加注抑制：equity < 0.25 时 raise 大幅惩罚（垃圾牌别加注）
        // eq=0.02 → penalty = -1.38, eq=0.15 → -0.50, eq=0.24 → -0.05
        if (a === ACTIONS.RAISE && equity < 0.25) {
          u -= (0.25 - equity) * 6.0;
        }

        // 3-bet cap：本轮已有多次加注时，再加注需要更强的牌
        // raiseCount=0(首次下注) → 无惩罚
        // raiseCount=1(3-bet) → 轻微惩罚
        // raiseCount=2(4-bet) → 重惩罚
        // raiseCount>=3(5-bet+) → 极重惩罚
        if (a === ACTIONS.RAISE && raiseCount >= 1) {
          const reraiseThreshold = 0.30 + raiseCount * 0.10; // 1→0.40, 2→0.50, 3→0.60
          if (equity < reraiseThreshold) {
            u -= (reraiseThreshold - equity) * (2.0 + raiseCount);
          }
        }

        // All-in 惩罚：需要极强牌力才合理
        // eq=0.28 → penalty = -1.08, eq=0.50 → -0.20, eq=0.60 → 0
        if (a === ACTIONS.RAISE && s === 'allin' && equity < 0.60) {
          u -= (0.60 - equity) * 4.0;
        }

        // Overbet 惩罚：非 all-in 的 raise 金额远超底池时惩罚
        if (a === ACTIONS.RAISE && s !== 'allin') {
          const sizingMap = { small: 0.33, medium: 0.66, large: 1.0 };
          const estBet = pot * (sizingMap[s] || 0.5);
          if (estBet > pot * 2) {
            u -= Math.min(0.5, (estBet / pot - 2) * 0.15);
          }
        }

        return u;
      });

      // 4. Softmax 选择（FSM + Boss脚本 + 情绪修正温度）
      const baseTemp = TEMPERATURE[this.difficultyType] || 1.0;
      const emotionTempDelta = EMOTION_TEMP_DELTA[this.emotionType] || 0;
      const temperature = Math.max(0.1, baseTemp + emotionTempDelta + extraTempDelta);

      const { index: chosenIdx, probs } = softmaxSelect(utilities, temperature);
      const chosen = candidates[chosenIdx];

      // 5. 计算下注金额
      let amount = 0;
      if (chosen.action === ACTIONS.CALL) {
        amount = Math.min(toCall, aiStack);
      } else if (chosen.action === ACTIONS.RAISE) {
        amount = calculateBetSize(this.difficultyType, chosen.sizing, equity, pot, aiStack, minRaise);
        // 如果 raise sizing 是 allin，标记为 allin
        if (amount >= aiStack) {
          amount = aiStack;
        }
      }

      // 6. 构建 reason
      const topUtils = candidates.map((c, i) => {
        const label = c.action === ACTIONS.RAISE ? c.action + '_' + c.sizing : c.action;
        return label + ':' + utilities[i].toFixed(2);
      });
      const fsmTag = fsmMod.state !== 'cautious' ? ' fsm=' + fsmMod.label : '';
      const bossTag = bossLabel ? ' boss=' + bossLabel : '';
      const reason = 'eq=' + (equity * 100).toFixed(0) + ' T=' + temperature.toFixed(1) +
        fsmTag + bossTag +
        ' [' + topUtils.join(' ') + ']' +
        ' p=' + (probs[chosenIdx] * 100).toFixed(0) + '%';

      const decision = { action: chosen.action, amount, reason };

      // 7. 详细日志
      const holeStr = holeCards.map(cardToString).join(' ');
      const tag = this.riskType + '/' + this.difficultyType + '/' + this.emotionType;
      const stateTag =
        (bossLabel ? '/' + bossLabel : '') +
        (fsmMod.state !== 'cautious' ? '/' + fsmMod.label : '');
      console.log(
        '[AI] ' + playerName + ' (' + tag + stateTag + ') ' + phase +
        ' | 手牌: ' + holeStr + ' [' + handName + ']' +
        ' | eq=' + (equity * 100).toFixed(0) + ' raw=' + rawStrength +
        ' magic=' + magicLevel + ' net=' + netForce +
        ' | pot=' + pot + ' toCall=' + toCall + ' stack=' + aiStack +
        ' opp=' + opponents +
        ' T=' + temperature.toFixed(1) +
        ' → ' + decision.action.toUpperCase() +
        (decision.amount > 0 ? ' ' + decision.amount : '') +
        ' (p=' + (probs[chosenIdx] * 100).toFixed(0) + '%)'
      );

      return decision;
    }

    /**
     * 构建当前局面下的合法候选动作
     */
    _buildCandidates(toCall, stack, minRaise, pot, equity, phase) {
      const candidates = [];

      // 硬性门控：equity 不够时直接移除 all-in 选项
      // 高温度 noob 无法通过 softmax 随机选到 all-in
      const allinThreshold = phase === 'preflop'
        ? (this.difficultyType === 'noob' ? 0.40 : 0.50)
        : 0.45;
      const allowAllin = (equity || 0) >= allinThreshold;

      if (toCall > 0) {
        // 面对下注：可以 fold / call / raise
        candidates.push({ action: ACTIONS.FOLD, sizing: null });
        if (toCall < stack) {
          candidates.push({ action: ACTIONS.CALL, sizing: null });
        }
        // raise 选项（只有筹码够时）
        if (stack > toCall + minRaise) {
          candidates.push({ action: ACTIONS.RAISE, sizing: 'small' });
          candidates.push({ action: ACTIONS.RAISE, sizing: 'medium' });
          if (pot > 0) candidates.push({ action: ACTIONS.RAISE, sizing: 'large' });
        }
        // all-in 需要足够牌力
        if (allowAllin) {
          candidates.push({ action: ACTIONS.RAISE, sizing: 'allin' });
        }
      } else {
        // 无人下注：可以 check / raise
        candidates.push({ action: ACTIONS.CHECK, sizing: null });
        if (stack > minRaise) {
          candidates.push({ action: ACTIONS.RAISE, sizing: 'small' });
          candidates.push({ action: ACTIONS.RAISE, sizing: 'medium' });
          if (pot > 0) candidates.push({ action: ACTIONS.RAISE, sizing: 'large' });
        }
        if (allowAllin) {
          candidates.push({ action: ACTIONS.RAISE, sizing: 'allin' });
        }
      }

      return candidates;
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
    // 核心逻辑：技能概率与筹码投入挂钩，投入越多越需要技能保护/提升
    _decideMoirai(difficulty, skill, owner, ctx, forces, mana) {
      const pi = PHASE_INDEX[ctx.phase] || 0;
      const pot = ctx.pot || 0;
      const commit = SkillAI._getCommitRatio(owner);

      switch (difficulty) {
        case 'noob': {
          // 本能型：有就用，不区分大小，投入多时更积极
          return Math.random() < (0.15 + commit * 0.3 + pi * 0.08);
        }
        case 'regular': {
          // 底池+投入感知：投入多或底池大时积极
          if (pi === 0) {
            if (skill.tier === 3) return Math.random() < 0.15;
            if (skill.tier === 2) return Math.random() < 0.08;
            return false;
          }
          if (mana && mana.current < mana.max * 0.3 && skill.tier !== 3) return false;
          var blinds = ctx.blinds || 20;
          var potFactor = Math.min(1, pot / (blinds * 15));
          // 投入占比是主要驱动力
          return Math.random() < (0.10 + commit * 0.45 + potFactor * 0.20 + pi * 0.05);
        }
        case 'boss':
        case 'pro': {
          if (pi === 0) return false;
          if (mana && mana.current < skill.manaCost * 1.5 && skill.tier !== 1) return false;
          // 投入越多越积极，手牌强度作为次要参考
          var strength = SkillAI._getHandStrength(owner, ctx);
          var strengthMod = strength >= 50 ? 0.15 : 0; // 强牌额外加成
          return Math.random() < (0.08 + commit * 0.50 + strengthMod + pi * 0.08);
        }
        default: return false;
      }
    },

    // ---- Chaos (狂厄: curse) ----
    // 核心逻辑：投入越多越需要诅咒对手来保护自己的投资
    _decideChaos(difficulty, skill, owner, ctx, forces, mana) {
      var pi = PHASE_INDEX[ctx.phase] || 0;
      var pot = ctx.pot || 0;
      var commit = SkillAI._getCommitRatio(owner);

      switch (difficulty) {
        case 'noob': {
          // 本能型：投入多时更积极
          return Math.random() < (0.15 + commit * 0.25 + pi * 0.08);
        }
        case 'regular': {
          if (pi === 0) return Math.random() < 0.08;
          if (mana && mana.current < mana.max * 0.3 && skill.tier !== 3) return false;
          var blinds2 = ctx.blinds || 20;
          var potFactor = Math.min(1, pot / (blinds2 * 15));
          return Math.random() < (0.10 + commit * 0.40 + potFactor * 0.20);
        }
        case 'boss':
        case 'pro': {
          if (pi === 0) return false;
          if (mana && mana.current < skill.manaCost * 1.5 && skill.tier !== 1) return false;
          // 投入多时积极诅咒，太强不需要
          var strength = SkillAI._getHandStrength(owner, ctx);
          if (strength > 80) return false; // 碾压局不浪费 mana
          return Math.random() < (0.10 + commit * 0.45 + pi * 0.08);
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
        case 'boss':
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
        case 'boss':
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
     * 筹码投入比：已投入筹码 / 初始筹码 (0~1)
     * commit=0: 还没投入, commit=0.5: 投了一半, commit=1.0: 全押
     * 注意：totalBet 已包含 currentBet，不要重复计算
     */
    _getCommitRatio(owner) {
      var invested = Math.max(owner.totalBet || 0, owner.currentBet || 0);
      var startStack = invested + (owner.chips || 0);
      return startStack > 0 ? Math.min(1, invested / startStack) : 0;
    },

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

      // all-in 玩家仍是有效目标（chips===0 但未弃牌）
      var candidates = players.filter(function(p) {
        return p.id !== casterId && !p.folded;
      });

      if (candidates.length === 0) {
        // 无有效目标时，选任意非施法者
        var fallback = players.filter(function(p) { return p.id !== casterId; });
        return fallback.length > 0 ? fallback[0].id : (casterId === 0 ? 1 : 0);
      }

      switch (difficulty) {
        case 'boss':
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
  global.PokerAI.BehaviorFSM = BehaviorFSM;
  global.PokerAI.FSM_STATES = FSM_STATES;
  global.PokerAI.BossScript = BossScript;
  global.PokerAI.BOSS_PHASES = BOSS_PHASES;
  global.PokerAI.OpponentModel = OpponentModel;

})(typeof window !== 'undefined' ? window : global);
