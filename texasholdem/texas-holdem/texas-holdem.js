/* global Deck, Hand, PokerAI, MonteOfZero */

(function () {
  'use strict';

  const SUIT_TRANSLATE = {0: 's', 1: 'h', 2: 'c', 3: 'd'};
  const RANK_TRANSLATE = {1: 'A', 2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: 'T', 11: 'J', 12: 'Q', 13: 'K'};

  // ========== 游戏配置（从JSON加载或使用默认值） ==========
  let gameConfig = null;
  let _externalConfigApplied = false;

  // 默认配置（新格式）
  const DEFAULT_CONFIG = {
    blinds: [10, 20],
    chips: 1000,
    hero: {
      vanguard: { name: 'KAZU', level: 3 },
      rearguard: { name: 'RINO', level: 5 },
      skills: {}
    },
    seats: {
      BTN: { vanguard: { name: 'ALPHA', level: 0 }, ai: 'balanced' },
      SB:  { vanguard: { name: 'BETA',  level: 0 }, ai: 'rock' },
      BB:  { vanguard: { name: 'GAMMA', level: 3 }, ai: 'aggressive' },
      UTG: { vanguard: { name: 'DELTA', level: 0 }, ai: 'passive' },
      CO:  { vanguard: { name: 'EPSILON', level: 1 }, ai: 'maniac' }
    }
  };

  // 座位顺序（德州规则：UTG 先行动，BB 最后）
  const SEAT_ORDER = ['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB'];

  // AI 性格→难度映射
  const AI_DIFF_MAP = {
    passive: 'noob', rock: 'regular', balanced: 'regular',
    aggressive: 'pro', maniac: 'noob'
  };

  function _cfg() { return gameConfig || DEFAULT_CONFIG; }
  function getInitialChips() { return _cfg().chips || 1000; }
  function getSmallBlind() { var b = _cfg().blinds; return b ? b[0] : 10; }
  function getBigBlind() { var b = _cfg().blinds; return b ? b[1] : 20; }

  /**
   * 从角色配置提取显示名（vanguard.name 优先）
   */
  function _charName(char) {
    if (char.vanguard && char.vanguard.name) return char.vanguard.name;
    return char.name || '???';
  }

  /**
   * 从 seats 构建玩家配置列表（index 0 = hero, 1+ = NPC）
   */
  function getPlayerConfigs() {
    var cfg = _cfg();
    var result = [];

    // index 0: hero（显示名用 vanguard.name）
    result.push({
      id: 0,
      name: cfg.hero ? _charName(cfg.hero) : 'RINO',
      type: 'human',
      chips: cfg.chips || 1000,
      personality: null
    });

    // index 1+: NPC 按 SEAT_ORDER
    var seats = cfg.seats || {};
    for (var i = 0; i < SEAT_ORDER.length; i++) {
      var s = seats[SEAT_ORDER[i]];
      if (!s) continue;
      var aiStyle = s.ai || 'balanced';
      result.push({
        id: result.length,
        name: _charName(s),
        type: 'ai',
        chips: cfg.chips || 1000,
        personality: { riskAppetite: aiStyle, difficulty: AI_DIFF_MAP[aiStyle] || 'regular' },
        seat: SEAT_ORDER[i]
      });
    }
    return result;
  }

  function getPlayerConfig(index) {
    var list = getPlayerConfigs();
    return list[index] || list[0];
  }

  // 座位位置映射 (顺时针排列，从玩家位置开始)
  // 玩家永远在 bottom 位置，AI 按顺时针分布
  const SEAT_POSITIONS = {
    2: ['bottom', 'top'],
    3: ['bottom-center', 'top-left', 'top-right'],
    4: ['bottom', 'left', 'top', 'right'],
    5: ['bottom', 'bottom-left', 'top-left', 'top-right', 'bottom-right'],
    6: ['bottom', 'bottom-left', 'top-left', 'top-center', 'top-right', 'bottom-right']
  };

  // ========== UI元素 ==========
  const UI = {
    seatsContainer: document.getElementById('seats-container'),
    deckMount: document.getElementById('deck-mount'),
    boardZone: document.getElementById('community-cards'),
    txtBoard: document.getElementById('game-message'),
    potAmount: document.getElementById('pot-amount'),
    potArea: document.getElementById('main-pot-area'),
    potClusters: document.getElementById('pot-clusters'),
    toCallAmount: document.getElementById('to-call-amount'),
    // 下注按钮
    btnFold: document.getElementById('btn-fold'),
    btnCheckCall: document.getElementById('btn-check-call'),
    btnRaise: document.getElementById('btn-raise'),
    raiseControls: document.getElementById('raise-controls'),
    raiseSlider: document.getElementById('raise-slider'),
    raiseAmountDisplay: document.getElementById('raise-amount-display'),
    btnConfirmRaise: document.getElementById('btn-confirm-raise'),
    // 游戏控制
    btnDeal: document.getElementById('btn-deal'),
    btnForceNext: document.getElementById('btn-force-next'),
    // 日志相关
    btnCopyLog: document.getElementById('btn-copy-log'),
    btnToggleLog: document.getElementById('btn-toggle-log'),
    gameLogPanel: document.getElementById('game-log-panel'),
    gameLogContent: document.getElementById('game-log-content'),
    // (玩家数量由外部 JSON 配置决定)
  };

  // ========== 技能系统 (通过 SkillUI 统一管理) ==========
  const moz = new MonteOfZero();
  const skillSystem = new SkillSystem();
  const skillUI = new SkillUI();

  skillUI.init(skillSystem, moz, {
    skillPanel: document.getElementById('skill-panel'),
    manaBar: document.getElementById('mana-bar'),
    manaText: document.getElementById('mana-text'),
    backlashIndicator: document.getElementById('backlash-indicator'),
    mozStatus: document.getElementById('moz-status'),
    forceBalance: document.getElementById('force-balance'),
    foresightPanel: document.getElementById('foresight-panel'),
    senseAlert: document.getElementById('sense-alert')
  });

  moz.onLog = function (type, data) { logEvent('MOZ_' + type, data); };
  skillSystem.onLog = function (type, data) { logEvent('SKILL_' + type, data); };
  skillUI.onLog = function (type, data) { logEvent(type, data); };
  skillUI.onMessage = function (msg) { updateMsg(msg); };

  // ========== 游戏状态 ==========
  let deckLib = null;
  // 玩家数量由 gameConfig.players.length 决定

  let gameState = {
    players: [],           // 玩家数组
    board: [],            // 公共牌
    phase: 'idle',        // idle, preflop, flop, turn, river, showdown
    pot: 0,
    currentBet: 0,        // 当前轮最高下注
    dealerIndex: 0,       // 庄家位置
    turnIndex: 0,         // 当前行动玩家
    lastRaiserIndex: -1,  // 最后加注者
    actionCount: 0        // 本轮行动计数
  };

  // ========== 工具函数 ==========
  function cardToSolverString(card) {
    if (!card) return '';
    return RANK_TRANSLATE[card.rank] + SUIT_TRANSLATE[card.suit];
  }

  function cardsToString(cards) {
    return cards.map(cardToSolverString).join(' ');
  }

  function updateMsg(text) {
    UI.txtBoard.textContent = text;
  }

  function updatePotDisplay() {
    const activeBets = gameState.players.reduce((sum, p) => sum + p.currentBet, 0);
    const totalPot = gameState.pot + activeBets;
    if (UI.potAmount) {
      UI.potAmount.textContent = totalPot.toLocaleString();
    }
    updateCenterChipsVisual(gameState.pot);
  }

  function updateCenterChipsVisual(amount) {
    const container = UI.potClusters;
    if (!container) return;
    container.innerHTML = '';
    if (amount <= 0) return;

    // 决定显示的筹码数量
    let visualCount = 2;
    if (amount > 100) visualCount = 3;
    if (amount > 500) visualCount = 4;
    if (amount > 2000) visualCount = 5;
    if (amount > 5000) visualCount = 6;

    // 根据底池大小选择颜色
    let chipType = 'white';
    if (amount > 50) chipType = 'green';
    if (amount > 200) chipType = 'blue';
    if (amount > 1000) chipType = 'red';
    if (amount > 5000) chipType = 'purple';
    if (amount > 20000) chipType = 'black';

    for (let i = 0; i < visualCount; i++) {
      const chip = document.createElement('div');
      chip.className = `chip-stack ${chipType}`;
      const offset = i * -6;
      chip.style.top = `${offset}px`;
      chip.style.zIndex = i + 1;
      chip.innerHTML = `
        <div class="chip-ring"></div>
        <div class="chip-inlay"></div>
      `;
      container.appendChild(chip);
    }
  }

  // ========== 座位UI生成 ==========
  function createSeatElement(player, position) {
    const seat = document.createElement('div');
    seat.className = 'seat';
    seat.id = `seat-${player.id}`;
    seat.dataset.position = position;
    
    if (player.type === 'human') {
      seat.classList.add('human-player');
    }

    seat.innerHTML = `
      <!-- HUD 角标 -->
      <div class="hud-corner hud-tl"></div>
      <div class="hud-corner hud-tr"></div>
      <div class="hud-corner hud-bl"></div>
      <div class="hud-corner hud-br"></div>
      
      <!-- Dealer Button -->
      <div class="dealer-button" style="display:none;">
        <span>D</span>
      </div>
      
      <!-- 座位信息 -->
      <div class="seat-header">
        <div class="player-name">${player.name}</div>
        <div class="chip-count"><span>$</span>${player.chips.toLocaleString()}</div>
      </div>
      
      <!-- 卡牌区域 -->
      <div class="seat-cards"></div>
      
      <!-- 下注筹码 -->
      <div class="bet-chips" style="display:none;">
        <div class="chip-stack">
          <div class="chip-ring"></div>
          <div class="chip-inlay"></div>
        </div>
        <div class="chip-amount">$0</div>
      </div>
      
      <!-- 状态文字 -->
      <div class="seat-status"></div>
    `;

    return seat;
  }

  function renderSeats() {
    UI.seatsContainer.innerHTML = '';
    const positions = SEAT_POSITIONS[gameState.players.length] || SEAT_POSITIONS[2];
    
    gameState.players.forEach((player, index) => {
      const position = positions[index] || 'bottom';
      const seatElement = createSeatElement(player, position);
      UI.seatsContainer.appendChild(seatElement);
      player.seatElement = seatElement;
    });
  }

  // 根据金额获取筹码类型
  function getChipType(amount) {
    // 货币换算: 1铜 = $1, 1银 = 100铜, 1金 = 100银 = 10000铜
    // 调整阈值使其更适合德州扑克游戏（初始筹码1000）
    // 白色: < 50 (小盲注级别)
    // 绿色: 50-199 (大盲注到小额加注)
    // 蓝色: 200-499 (中等下注)
    // 红色: 500-999 (大额下注)
    // 紫色: 1000-4999 (全押级别)
    // 黑色: 5000+ (超大额)
    
    if (amount >= 100000) return 'black';
    if (amount >= 10000) return 'purple';
    if (amount >= 1000) return 'red';
    if (amount >= 100) return 'blue';
    if (amount >= 11) return 'green';
    return 'white';
  }

  function updateSeatDisplay(player) {
    if (!player.seatElement) return;
    
    const chipCount = player.seatElement.querySelector('.chip-count');
    chipCount.innerHTML = `<span>$</span>${player.chips.toLocaleString()}`;
    
    const betChips = player.seatElement.querySelector('.bet-chips');
    if (player.currentBet > 0 && player.isActive) {
      betChips.style.display = 'flex';
      betChips.querySelector('.chip-amount').textContent = '$' + player.currentBet;
      
      // 根据下注金额设置筹码类型
      const chipStack = betChips.querySelector('.chip-stack');
      const chipType = getChipType(player.currentBet);
      console.log(`[Chip Debug] Player: ${player.name}, Bet: $${player.currentBet}, Chip Type: ${chipType}`);
      chipStack.className = 'chip-stack ' + chipType;
    } else {
      betChips.style.display = 'none';
    }
    
    // 更新状态
    if (player.folded) {
      player.seatElement.classList.add('folded');
    } else {
      player.seatElement.classList.remove('folded');
    }
  }

  function setTurnIndicator(playerIndex) {
    // 移除所有turn-active类
    gameState.players.forEach(p => {
      if (p.seatElement) {
        p.seatElement.classList.remove('turn-active', 'ai-turn');
      }
    });
    
    // 添加当前玩家的指示器
    if (playerIndex >= 0 && playerIndex < gameState.players.length) {
      const player = gameState.players[playerIndex];
      if (player.seatElement && player.isActive && !player.folded) {
        player.seatElement.classList.add('turn-active');
        if (player.type === 'ai') {
          player.seatElement.classList.add('ai-turn');
        }
      }
    }
  }

  function updateDealerButton() {
    gameState.players.forEach((player, index) => {
      const dealerBtn = player.seatElement?.querySelector('.dealer-button');
      if (dealerBtn) {
        dealerBtn.style.display = index === gameState.dealerIndex ? 'flex' : 'none';
      }
    });
  }

  function animateChipsToCenter() {
    gameState.players.forEach(player => {
      if (player.currentBet > 0 && player.seatElement) {
        const betChips = player.seatElement.querySelector('.bet-chips');
        betChips.classList.add('flying');
      }
    });
    
    UI.potArea?.classList.add('collecting');
    
    setTimeout(() => {
      gameState.players.forEach(player => {
        if (player.seatElement) {
          const betChips = player.seatElement.querySelector('.bet-chips');
          betChips.classList.remove('flying');
        }
      });
      UI.potArea?.classList.remove('collecting');
    }, 800);
  }

  // ========== 玩家初始化 ==========
  function initializePlayers(count) {
    const players = [];
    
    for (let i = 0; i < count; i++) {
      const config = getPlayerConfig(i);
      const isHuman = config.type === 'human' || i === 0;
      
      const player = {
        id: i,
        type: isHuman ? 'human' : 'ai',
        name: config.name || (isHuman ? 'RINO [ADMIN]' : `TARGET_${i}`),
        chips: config.chips || getInitialChips(),
        cards: [],
        currentBet: 0,
        totalBet: 0,
        isActive: true,
        folded: false,
        hasActedThisRound: false,
        ai: null,
        personality: config.personality || null
      };
      
      // 为 AI 玩家创建个性化 AI 实例
      if (!isHuman) {
        player.ai = new PokerAI(config.personality || { riskAppetite: 'balanced', difficulty: 'regular' });
      }
      
      players.push(player);
    }
    
    return players;
  }

  // ========== 轮次控制 ==========
  function getNextActivePlayer(startIndex) {
    let index = startIndex;
    let count = 0;
    const maxPlayers = gameState.players.length;
    
    do {
      index = (index + 1) % maxPlayers;
      count++;
      if (count > maxPlayers) return -1; // 防止无限循环
    } while (gameState.players[index].folded || !gameState.players[index].isActive);
    
    return index;
  }

  // 🛡️ 从指定位置开始找第一个未弃牌的活跃玩家
  function findFirstActivePlayer(startIndex) {
    let index = startIndex;
    let count = 0;
    const maxPlayers = gameState.players.length;
    
    while (gameState.players[index].folded || !gameState.players[index].isActive) {
      index = (index + 1) % maxPlayers;
      count++;
      if (count >= maxPlayers) return -1; // 所有人都弃牌了
    }
    
    return index;
  }

  function getActivePlayers() {
    return gameState.players.filter(p => p.isActive && !p.folded);
  }

  // 🎯 检查是否所有玩家都 All-in（或只剩一人有筹码）
  function isEveryoneAllIn() {
    const activePlayers = getActivePlayers();
    if (activePlayers.length <= 1) return false;
    
    // 统计还有筹码的玩家数量
    const playersWithChips = activePlayers.filter(p => p.chips > 0);
    
    // 如果只有 0 或 1 个人还有筹码，说明其他人都 All-in 了
    return playersWithChips.length <= 1;
  }

  function isRoundComplete() {
    const activePlayers = getActivePlayers();
    if (activePlayers.length <= 1) return true;
    
    // 检查是否所有活跃玩家都已行动且下注相同
    // 🛡️ All-in 玩家（chips===0）无法继续下注，不参与 bet-matching 检查
    const maxBet = Math.max(...activePlayers.map(p => p.currentBet));
    const allMatched = activePlayers.every(p => p.currentBet === maxBet || p.chips === 0);
    
    // 确保每个有筹码的玩家至少行动过一次（all-in 玩家跳过）
    const allActed = activePlayers.every(p => p.hasActedThisRound || p.chips === 0);
    
    // Preflop 特殊处理：BB 必须有机会行动（Option权）
    // 即使所有人下注相同，如果 BB 还没主动行动过，不能结束
    if (gameState.phase === 'preflop' && allMatched && maxBet === getBigBlind()) {
      // 找到 BB 玩家
      let bbIndex;
      if (gameState.players.length === 2) {
        bbIndex = (gameState.dealerIndex + 1) % gameState.players.length;
      } else {
        bbIndex = (gameState.dealerIndex + 2) % gameState.players.length;
      }
      const bbPlayer = gameState.players[bbIndex];
      
      // 如果 BB 还没主动行动过，不能结束
      if (!bbPlayer.folded && bbPlayer.isActive && !bbPlayer.hasActedThisRound) {
        return false;
      }
    }
    
    return allMatched && allActed;
  }

  function nextTurn() {
    if (isRoundComplete()) {
      endBettingRound();
      return;
    }
    
    // 如果是本轮第一次行动（actionCount === 0），使用预设的 turnIndex
    // 否则找下一个活跃玩家
    if (gameState.actionCount > 0) {
      gameState.turnIndex = getNextActivePlayer(gameState.turnIndex);
    }
    
    if (gameState.turnIndex === -1) {
      endBettingRound();
      return;
    }
    
    const currentPlayer = gameState.players[gameState.turnIndex];
    
    // 🛡️ 跳过 All-in 玩家（chips===0，无法行动）
    if (currentPlayer.chips === 0) {
      currentPlayer.hasActedThisRound = true;
      gameState.actionCount++;
      setTimeout(nextTurn, 100);
      return;
    }
    
    setTurnIndicator(gameState.turnIndex);
    
    // 更新toCall显示
    const toCall = gameState.currentBet - currentPlayer.currentBet;
    UI.toCallAmount.textContent = '$' + toCall;
    
    if (currentPlayer.type === 'human') {
      updateMsg(`Your turn - ${gameState.phase.toUpperCase()}`);
      enablePlayerControls(true);
      skillUI.update({ phase: gameState.phase, isPlayerTurn: true, deckCards: deckLib ? deckLib.cards : [], board: gameState.board, players: gameState.players }); // 玩家回合：启用技能按钮
    } else {
      updateMsg(`${currentPlayer.name}'s turn...`);
      enablePlayerControls(false);
      skillUI.update({ phase: gameState.phase, isPlayerTurn: false }); // AI回合：禁用技能按钮
      setTimeout(() => aiTurn(currentPlayer), 1000);
    }
  }

  // ========== 玩家操作 ==========
  function enablePlayerControls(enabled) {
    UI.btnFold.disabled = !enabled;
    UI.btnCheckCall.disabled = !enabled;
    UI.btnRaise.disabled = !enabled;
    
    const player = gameState.players[0]; // 人类玩家
    if (!player) return; // 防止初始化时玩家未加载
    
    const toCall = gameState.currentBet - (player.currentBet || 0);
    
    if (toCall === 0) {
      UI.btnCheckCall.textContent = 'CHECK';
    } else {
      UI.btnCheckCall.textContent = `CALL $${toCall}`;
    }
    
    // 更新加注滑块
    // 最小加注额 = 大盲注（或上一次加注的增量，简化为大盲注）
    // 滑块值 = 加注增量（在跟注之上额外加的部分）
    const maxRaise = player.chips - toCall; // 扣除跟注后剩余可加注的量
    const minRaise = Math.min(getBigBlind(), maxRaise > 0 ? maxRaise : player.chips);
    UI.raiseSlider.min = minRaise;
    UI.raiseSlider.max = Math.max(minRaise, maxRaise);
    UI.raiseSlider.value = minRaise;
    UI.raiseAmountDisplay.textContent = '$' + minRaise;
  }

  function playerFold() {
    const player = gameState.players[0];
    player.folded = true;
    player.hasActedThisRound = true;
    updateSeatDisplay(player);
    
    logEvent('PLAYER_FOLD', { playerId: player.id, playerName: player.name });
    updateMsg('You folded.');
    
    gameState.actionCount++;
    setTurnIndicator(-1);
    
    setTimeout(() => {
      if (getActivePlayers().length === 1) {
        endHandEarly();
      } else {
        nextTurn();
      }
    }, 500);
  }

  function playerCheckCall() {
    UI.raiseControls.style.display = 'none';
    const player = gameState.players[0];
    const toCall = gameState.currentBet - player.currentBet;
    
    if (toCall > 0) {
      const callAmount = Math.min(toCall, player.chips);
      player.chips -= callAmount;
      player.currentBet += callAmount;
      player.totalBet += callAmount;
      logEvent('PLAYER_CALL', { playerId: player.id, playerName: player.name, amount: callAmount });
      updateMsg(`You call $${callAmount}`);
    } else {
      logEvent('PLAYER_CHECK', { playerId: player.id, playerName: player.name });
      updateMsg('You check');
    }
    
    player.hasActedThisRound = true;
    updateSeatDisplay(player);
    updatePotDisplay();
    gameState.actionCount++;
    setTurnIndicator(-1);
    
    setTimeout(nextTurn, 500);
  }

  function playerRaise() {
    UI.raiseControls.style.display = 'flex';
  }

  function confirmRaise() {
    const player = gameState.players[0];
    const raiseAmount = parseInt(UI.raiseSlider.value);
    const toCall = gameState.currentBet - player.currentBet;
    
    // 先跟注
    if (toCall > 0) {
      player.chips -= toCall;
      player.currentBet += toCall;
      player.totalBet += toCall;
    }
    
    // 再加注
    const actualRaise = Math.min(raiseAmount, player.chips);
    player.chips -= actualRaise;
    player.currentBet += actualRaise;
    player.totalBet += actualRaise;
    gameState.currentBet = player.currentBet;
    gameState.lastRaiserIndex = 0;
    
    // 区分 BET 和 RAISE：当前轮无人下注时是 BET，否则是 RAISE
    // 注意：此时 gameState.currentBet 已更新，需要用 toCall 判断之前状态
    const isBet = toCall === 0;
    logEvent(isBet ? 'PLAYER_BET' : 'PLAYER_RAISE', { 
      playerId: player.id, 
      playerName: player.name, 
      amount: actualRaise, 
      totalBet: player.currentBet 
    });
    
    player.hasActedThisRound = true;
    UI.raiseControls.style.display = 'none';
    updateMsg(isBet ? `You bet $${actualRaise}` : `You raise $${actualRaise}`);
    updateSeatDisplay(player);
    updatePotDisplay();
    gameState.actionCount++;
    setTurnIndicator(-1);
    
    setTimeout(nextTurn, 500);
  }

  // ========== AI操作 ==========
  function aiTurn(player) {
    // 🛡️ 防止弃牌玩家复活行动
    if (player.folded || !player.isActive) {
      gameState.actionCount++;
      setTimeout(nextTurn, 100);
      return;
    }
    
    const toCall = gameState.currentBet - player.currentBet;
    
    // 计算该 AI 的最高魔运等级（影响弃牌倾向）
    const playerSkills = skillSystem.getPlayerSkills(player.id);
    const maxMagicLevel = playerSkills.reduce((max, s) => Math.max(max, s.level || 0), 0);

    const context = {
      holeCards: player.cards,
      boardCards: gameState.board,
      pot: gameState.pot + gameState.players.reduce((sum, p) => sum + p.currentBet, 0),
      toCall: toCall,
      aiStack: player.chips,
      playerStack: gameState.players[0].chips,
      phase: gameState.phase,
      minRaise: getBigBlind(),
      activeOpponentCount: getActivePlayers().length - 1,
      magicLevel: maxMagicLevel  // 魔运等级 → AI更自信，不容易弃牌
    };
    
    const decision = player.ai.decide(context);
    
    switch (decision.action) {
      case PokerAI.ACTIONS.FOLD:
        aiFold(player);
        break;
      case PokerAI.ACTIONS.CHECK:
        aiCheck(player);
        break;
      case PokerAI.ACTIONS.CALL:
        aiCall(player, decision.amount);
        break;
      case PokerAI.ACTIONS.RAISE:
      case PokerAI.ACTIONS.ALL_IN:
        aiRaise(player, decision.amount);
        break;
    }
  }

  function aiFold(player) {
    player.folded = true;
    player.hasActedThisRound = true;
    updateSeatDisplay(player);
    
    logEvent('AI_FOLD', { playerId: player.id, playerName: player.name });
    
    const status = player.seatElement.querySelector('.seat-status');
    status.textContent = 'FOLD';
    
    gameState.actionCount++;
    setTurnIndicator(-1);
    
    setTimeout(() => {
      if (getActivePlayers().length === 1) {
        endHandEarly();
      } else {
        nextTurn();
      }
    }, 800);
  }

  function aiCheck(player) {
    player.hasActedThisRound = true;
    logEvent('AI_CHECK', { playerId: player.id, playerName: player.name });
    
    const status = player.seatElement.querySelector('.seat-status');
    status.textContent = 'CHECK';
    
    gameState.actionCount++;
    setTurnIndicator(-1);
    setTimeout(nextTurn, 800);
  }

  function aiCall(player, amount) {
    const toCall = gameState.currentBet - player.currentBet;
    const callAmount = Math.min(toCall, player.chips);
    
    player.chips -= callAmount;
    player.currentBet += callAmount;
    player.totalBet += callAmount;
    
    player.hasActedThisRound = true;
    logEvent('AI_CALL', { playerId: player.id, playerName: player.name, amount: callAmount });
    
    const status = player.seatElement.querySelector('.seat-status');
    status.textContent = `CALL $${callAmount}`;
    
    updateSeatDisplay(player);
    updatePotDisplay();
    gameState.actionCount++;
    setTurnIndicator(-1);
    
    setTimeout(nextTurn, 800);
  }

  function aiRaise(player, amount) {
    const toCall = gameState.currentBet - player.currentBet;
    
    // 先跟注
    if (toCall > 0) {
      const callAmount = Math.min(toCall, player.chips);
      player.chips -= callAmount;
      player.currentBet += callAmount;
      player.totalBet += callAmount;
    }
    
    // 再加注
    const raiseAmount = Math.min(amount, player.chips);
    
    // 🛡️ 修复 RAISE $0 问题：如果加注金额 <= 0，说明是 All-in 跟注
    if (raiseAmount <= 0) {
      // 这其实是一个 CALL (All-in)，不是 RAISE
      player.hasActedThisRound = true;
      const actualCallAmount = player.currentBet - (gameState.currentBet - toCall); // 实际跟注金额
      logEvent('AI_CALL', { 
        playerId: player.id, 
        playerName: player.name, 
        amount: actualCallAmount,
        isAllIn: true
      });
      
      const status = player.seatElement.querySelector('.seat-status');
      status.textContent = `CALL $${actualCallAmount} (All-in)`;
      
      updateSeatDisplay(player);
      updatePotDisplay();
      gameState.actionCount++;
      setTurnIndicator(-1);
      
      setTimeout(nextTurn, 800);
      return;
    }
    
    player.chips -= raiseAmount;
    player.currentBet += raiseAmount;
    player.totalBet += raiseAmount;
    gameState.currentBet = player.currentBet;
    gameState.lastRaiserIndex = player.id;
    
    // 区分 BET 和 RAISE：当前轮无人下注时是 BET，否则是 RAISE
    const isBet = toCall === 0;
    player.hasActedThisRound = true;
    
    // 检查是否 All-in
    const isAllIn = player.chips === 0;
    logEvent(isBet ? 'AI_BET' : 'AI_RAISE', { 
      playerId: player.id, 
      playerName: player.name, 
      amount: raiseAmount, 
      totalBet: player.currentBet,
      isAllIn: isAllIn
    });
    
    const status = player.seatElement.querySelector('.seat-status');
    const allInSuffix = isAllIn ? ' (All-in)' : '';
    status.textContent = isBet ? `BET $${raiseAmount}${allInSuffix}` : `RAISE $${raiseAmount}${allInSuffix}`;
    
    updateSeatDisplay(player);
    updatePotDisplay();
    gameState.actionCount++;
    setTurnIndicator(-1);
    
    setTimeout(nextTurn, 800);
  }

  // ========== 发牌动画 ==========
  function distributeCard(player, faceUp, delay) {
    return new Promise((resolve) => {
      if (!deckLib || !deckLib.cards.length) {
        resolve();
        return;
      }
      
      const card = deckLib.cards.pop();
      player.cards.push(card);

      const deckWrapper = document.getElementById('deck-wrapper');
      const targetElement = player.seatElement.querySelector('.seat-cards');
      
      const wrapperRect = deckWrapper.getBoundingClientRect();
      const targetRect = targetElement.getBoundingClientRect();
      
      const cardWidth = 70;
      const gap = 8;
      const cardIndex = player.cards.length - 1;
      const totalCards = player.cards.length;
      const totalWidth = totalCards * cardWidth + (totalCards - 1) * gap;
      const startX = targetRect.left + (targetRect.width - totalWidth) / 2;
      const cardFinalX = startX + cardIndex * (cardWidth + gap) + cardWidth / 2;
      const cardFinalY = targetRect.top + targetRect.height / 2;
      
      const deckCenterX = wrapperRect.left + wrapperRect.width / 2;
      const deckCenterY = wrapperRect.top + wrapperRect.height / 2;
      
      const deltaX = cardFinalX - deckCenterX + 15;
      const deltaY = cardFinalY - deckCenterY;

      card.animateTo({
        delay: delay,
        duration: 250,
        x: deltaX,
        y: deltaY,
        rot: 0,
        onStart: function() {
          card.$el.style.zIndex = 9999;
        },
        onComplete: function() {
          card.setSide(faceUp ? 'front' : 'back');
          targetElement.appendChild(card.$el);
          card.$el.classList.add('aligned-card');
          card.$el.style.transform = 'none';
          card.$el.style.position = 'relative';
          card.x = 0;
          card.y = 0;
          resolve();
        }
      });
    });
  }

  // ========== 蒸特卡洛零模型 - 精确抽牌 ==========
  /**
   * 从牌堆中找到指定牌并将其移到末尾，然后 pop
   * 这样可以复用 deck-of-cards 库的动画系统
   */
  function pickSpecificCard(targetCard) {
    if (!deckLib || !deckLib.cards.length) return null;
    
    const index = deckLib.cards.findIndex(c =>
      c.rank === targetCard.rank && c.suit === targetCard.suit
    );
    
    if (index === -1) {
      // 找不到目标牌，fallback 到普通 pop
      console.warn('[MonteOfZero] Target card not found in deck, falling back to random');
      return deckLib.cards.pop();
    }
    
    // 将目标牌移到末尾
    const [card] = deckLib.cards.splice(index, 1);
    deckLib.cards.push(card);
    return deckLib.cards.pop();
  }

  /**
   * 用命运引擎筛选一张公共牌（委托给 skillUI）
   * @returns {object} deck-of-cards 的 card 对象
   */
  function mozSelectAndPick() {
    if (!deckLib || !deckLib.cards.length) {
      return deckLib.cards.pop();
    }
    
    const result = skillUI.selectCard(deckLib.cards, gameState.board, gameState.players);
    
    if (result && result.card) {
      const picked = pickSpecificCard(result.card);
      // 展示力量对抗面板
      if (result.meta) showForcePK(result.meta);
      skillUI.updateDisplay();
      return picked;
    }
    
    return deckLib.cards.pop();
  }

  // ========== 力量对抗展示 ==========
  let _fpkTimer = null;

  function showForcePK(meta) {
    const overlay = document.getElementById('force-pk-overlay');
    if (!overlay || !meta || !meta.activeForces || meta.activeForces.length === 0) return;

    const forces = meta.activeForces;
    const ICONS = { fortune: '✦', curse: '☠', backlash: '⚡' };
    const TYPE_LABELS = { fortune: '魔运', curse: '厄运', backlash: '反噬' };

    // 按玩家分组
    const byOwner = {};
    for (const f of forces) {
      const key = f.owner || ('ID_' + f.ownerId);
      if (!byOwner[key]) byOwner[key] = { name: key, forces: [], total: 0, isPlayer: false, isSystem: false };
      byOwner[key].forces.push(f);
      byOwner[key].total += (f.power || 0);
    }

    // 标记玩家(ownerId===0)和系统
    const rinoPlayer = gameState.players.find(p => p.id === 0);
    const rinoName = rinoPlayer ? rinoPlayer.name : 'RINO';
    for (const key in byOwner) {
      const g = byOwner[key];
      const firstForce = g.forces[0];
      if (firstForce.ownerId === 0) { g.isPlayer = true; g.name = rinoName; }
      if (firstForce.ownerId === -1 || key === 'SYSTEM') { g.isSystem = true; g.name = 'SYSTEM'; }
    }

    const groups = Object.values(byOwner);
    if (groups.length === 0) return;

    // 构建 HTML
    let html = '<div class="fpk-title">⚡ 命运对抗 ⚡</div>';
    html += '<div class="fpk-players">';

    for (const g of groups) {
      const cssClass = g.isPlayer ? 'fpk-player-ally' : g.isSystem ? 'fpk-player-system' : 'fpk-player-enemy';
      html += '<div class="fpk-player-card ' + cssClass + '">';
      html += '<div class="fpk-player-name">' + g.name + '</div>';
      for (const f of g.forces) {
        const icon = ICONS[f.type] || '?';
        const label = TYPE_LABELS[f.type] || f.type;
        html += '<div class="fpk-force-line">' + icon + ' ' + label + ' <span class="fpk-power">P' + f.power + '</span></div>';
      }
      html += '<div class="fpk-player-total">' + g.total + '</div>';
      html += '</div>';
    }

    html += '</div>';

    // 结果行：fortune 类型的净值
    const playerFortune = groups.filter(g => g.isPlayer).reduce((s, g) => s + g.forces.filter(f => f.type === 'fortune').reduce((a, f) => a + f.power, 0), 0);
    const enemyFortune = groups.filter(g => !g.isPlayer && !g.isSystem).reduce((s, g) => s + g.forces.filter(f => f.type === 'fortune').reduce((a, f) => a + f.power, 0), 0);
    const net = playerFortune - enemyFortune;
    const hasBacklash = groups.some(g => g.isSystem);

    let resultClass, resultText;
    if (hasBacklash) {
      resultClass = 'fpk-lose';
      resultText = '⚠ 反噬中 — 命运惩罚 ' + rinoName;
    } else if (net > 0) {
      resultClass = 'fpk-win';
      resultText = '命运倾斜 → ' + rinoName + ' (+' + net + ')';
    } else if (net < 0) {
      resultClass = 'fpk-lose';
      // 找到最强的敌方
      const strongest = groups.filter(g => !g.isPlayer && !g.isSystem).sort((a, b) => b.total - a.total)[0];
      resultText = '命运抵抗 → ' + (strongest ? strongest.name : 'NPC') + ' (+' + Math.abs(net) + ')';
    } else {
      resultClass = 'fpk-neutral';
      resultText = '命运均衡 — 混沌';
    }
    html += '<div class="fpk-result ' + resultClass + '">' + resultText + '</div>';

    // Style bonus
    if (meta.styleBonus && meta.styleBonus !== 0) {
      const sign = meta.styleBonus > 0 ? '+' : '';
      html += '<div class="fpk-style">时髦命运 ' + sign + meta.styleBonus + '</div>';
    }

    overlay.innerHTML = html;

    // 显示
    overlay.classList.remove('fpk-fade-out');
    overlay.style.display = 'block';

    // 自动隐藏
    if (_fpkTimer) clearTimeout(_fpkTimer);
    _fpkTimer = setTimeout(() => {
      overlay.classList.add('fpk-fade-out');
      setTimeout(() => { overlay.style.display = 'none'; }, 500);
    }, 2500);
  }

  function hideForcePK() {
    const overlay = document.getElementById('force-pk-overlay');
    if (overlay) overlay.style.display = 'none';
    if (_fpkTimer) { clearTimeout(_fpkTimer); _fpkTimer = null; }
  }

  function distributeCommunityCard(delay, cardIndex, specificCard) {
    return new Promise((resolve) => {
      // 如果有指定牌，跳过牌堆检查（牌已被 pickSpecificCard 移除）
      if (!specificCard && (!deckLib || !deckLib.cards.length)) {
        resolve();
        return;
      }
      
      // 如果提供了指定牌，使用它；否则普通 pop
      const card = specificCard || deckLib.cards.pop();
      gameState.board.push(card);

      const deckWrapper = document.getElementById('deck-wrapper');
      const wrapperRect = deckWrapper.getBoundingClientRect();
      
      // 获取对应的ghost card位置
      const ghostCards = UI.boardZone.querySelectorAll('.ghost-card');
      const targetGhost = ghostCards[cardIndex];
      
      if (!targetGhost) {
        resolve();
        return;
      }
      
      const ghostRect = targetGhost.getBoundingClientRect();
      const cardFinalX = ghostRect.left + ghostRect.width / 2;
      const cardFinalY = ghostRect.top + ghostRect.height / 2;
      
      const deckCenterX = wrapperRect.left + wrapperRect.width / 2;
      const deckCenterY = wrapperRect.top + wrapperRect.height / 2;
      
      const deltaX = cardFinalX - deckCenterX;
      const deltaY = cardFinalY - deckCenterY;

      card.animateTo({
        delay: delay,
        duration: 250,
        x: deltaX,
        y: deltaY,
        rot: 0,
        onStart: function() {
          card.$el.style.zIndex = 9999;
        },
        onComplete: function() {
          card.setSide('front');
          // 替换ghost card而不是append
          targetGhost.replaceWith(card.$el);
          card.$el.classList.add('aligned-card');
          card.$el.style.transform = 'none';
          card.$el.style.position = 'relative';
          card.x = 0;
          card.y = 0;
          resolve();
        }
      });
    });
  }

  // ========== 游戏流程 ==========
  function initTable() {
    if (deckLib) deckLib.unmount();
    deckLib = Deck();
    deckLib.mount(UI.deckMount);
    deckLib.shuffle();

    // 重新添加幽灵卡槽
    UI.boardZone.innerHTML = `
      <div class="ghost-card"></div>
      <div class="ghost-card"></div>
      <div class="ghost-card"></div>
      <div class="ghost-card"></div>
      <div class="ghost-card"></div>
    `;

    UI.raiseControls.style.display = 'none';
    updateMsg('');
  }

  function startNewGame() {
    initTable();
    
    // 清空日志
    gameLogger.clear();
    
    // 判断是否需要全新初始化（首局 or 游戏结束后重开）
    const alivePlayers = gameState.players.filter(p => p.chips > 0);
    const needFullReset = gameState.players.length === 0 || alivePlayers.length <= 1;
    
    if (needFullReset) {
      // 全新一局：从配置初始化所有玩家
      const configs = getPlayerConfigs();
      const playerCount = Math.min(Math.max(configs.length, 2), 6);
      gameState.players = initializePlayers(playerCount);
      gameState.dealerIndex = 0;
      skillSystem.reset();
      // 从配置注册所有技能 + 生成UI
      skillUI.registerFromConfig(_cfg());
    } else {
      // 连续对局：保留筹码，重置手牌状态
      gameState.players.forEach(p => {
        p.cards = [];
        p.currentBet = 0;
        p.totalBet = 0;
        p.folded = false;
        p.hasActedThisRound = false;
        // 已淘汰的玩家保持 isActive = false
        if (p.chips > 0) {
          p.isActive = true;
        }
      });
    }
    
    gameState.board = [];
    gameState.phase = 'preflop';
    gameState.pot = 0;
    gameState.currentBet = 0;
    gameState.lastRaiserIndex = -1;
    gameState.actionCount = 0;
    
    // 技能系统：新一手牌开始
    skillUI.onNewHand();
    
    // 渲染座位
    renderSeats();
    updateDealerButton();
    skillUI.updateDisplay();
    
    // 收取盲注
    postBlinds();
    
    // 发牌
    setTimeout(() => {
      dealHoleCards();
    }, 300);
    
    UI.btnDeal.disabled = true;
    updatePotDisplay();
    skillUI.update({ phase: gameState.phase, isPlayerTurn: false });
  }

  function postBlinds() {
    // Heads-Up (2人活跃): 庄家 = SB，对手 = BB
    // 多人桌 (3+活跃): 庄家后一位活跃玩家 = SB，再下一位 = BB
    const activePlayers = gameState.players.filter(p => p.isActive);
    let sbIndex, bbIndex;
    if (activePlayers.length === 2) {
      sbIndex = gameState.dealerIndex; // 庄家是SB
      bbIndex = findFirstActivePlayer((gameState.dealerIndex + 1) % gameState.players.length);
    } else {
      sbIndex = findFirstActivePlayer((gameState.dealerIndex + 1) % gameState.players.length);
      bbIndex = findFirstActivePlayer((sbIndex + 1) % gameState.players.length);
    }
    
    const sbPlayer = gameState.players[sbIndex];
    const bbPlayer = gameState.players[bbIndex];
    
    const sb = Math.min(getSmallBlind(), sbPlayer.chips);
    const bb = Math.min(getBigBlind(), bbPlayer.chips);
    
    sbPlayer.chips -= sb;
    sbPlayer.currentBet = sb;
    sbPlayer.totalBet = sb;
    
    bbPlayer.chips -= bb;
    bbPlayer.currentBet = bb;
    bbPlayer.totalBet = bb;
    
    gameState.currentBet = bb;
    
    // 立即显示盲注筹码
    updateSeatDisplay(sbPlayer);
    updateSeatDisplay(bbPlayer);
    updatePotDisplay();
    
    logEvent('BLINDS', { sb: sbPlayer.name, bb: bbPlayer.name, sbAmount: getSmallBlind(), bbAmount: getBigBlind() });
    updateMsg(`Blinds posted: SB $${getSmallBlind()} / BB $${getBigBlind()}`);
  }

  async function dealHoleCards() {
    const promises = [];
    
    for (let i = 0; i < 2; i++) {
      for (let j = 0; j < gameState.players.length; j++) {
        const player = gameState.players[j];
        if (!player.isActive) continue; // 跳过已淘汰的玩家
        const faceUp = player.type === 'human';
        const delay = (i * gameState.players.length + j) * 150;
        promises.push(distributeCard(player, faceUp, delay));
      }
    }
    
    await Promise.all(promises);
    
    const activeCount = gameState.players.filter(p => p.isActive).length;
    logEvent('DEAL', { playerCount: activeCount });
    
    // 开始第一轮下注
    // Heads-Up (2人活跃): SB（庄位）先行动
    // 多人桌 (3+活跃): BB后第一个活跃玩家先行动 (UTG)
    if (activeCount === 2) {
      gameState.turnIndex = gameState.dealerIndex;
    } else {
      // 找到BB位置，然后UTG是BB后第一个活跃玩家
      const sbIndex = findFirstActivePlayer((gameState.dealerIndex + 1) % gameState.players.length);
      const bbIndex = findFirstActivePlayer((sbIndex + 1) % gameState.players.length);
      gameState.turnIndex = findFirstActivePlayer((bbIndex + 1) % gameState.players.length);
    }
    gameState.actionCount = 0;
    
    setTimeout(() => {
      nextTurn();
    }, 500);
  }

  function collectBetsIntoPot() {
    if (gameState.players.some(p => p.currentBet > 0)) {
      animateChipsToCenter();
    }
    
    setTimeout(() => {
      gameState.players.forEach(player => {
        gameState.pot += player.currentBet;
        player.currentBet = 0;
        player.hasActedThisRound = false;  // 重置行动标志
        updateSeatDisplay(player);
      });
      
      gameState.currentBet = 0;
      gameState.lastRaiserIndex = -1;
      gameState.actionCount = 0;
      updatePotDisplay();
    }, 600);
  }

  function endBettingRound() {
    setTurnIndicator(-1);
    collectBetsIntoPot();
    
    // 技能系统：每轮结束 → 恢复mana + 重置toggle + 检查触发 + NPC决策
    skillUI.onRoundEnd({
      players: gameState.players,
      pot: gameState.pot,
      phase: gameState.phase,
      board: gameState.board
    });
    
    setTimeout(() => {
      switch (gameState.phase) {
        case 'preflop':
          dealFlop();
          break;
        case 'flop':
          dealTurn();
          break;
        case 'turn':
          dealRiver();
          break;
        case 'river':
          showdown();
          break;
      }
    }, 800);
  }

  async function dealFlop() {
    gameState.phase = 'flop';
    
    // 蒙特卡洛零模型：Flop 只筛选第3张牌
    // 前2张纯随机，防止雪崩效应（选K→选K→选K）
    // 第3张经过命运筛选，在已有2张随机牌的基础上微调命运
    await distributeCommunityCard(0, 0);    // 纯随机
    await distributeCommunityCard(200, 0);  // 纯随机
    
    const flopCard3 = mozSelectAndPick();   // 命运筛选
    await distributeCommunityCard(400, 0, flopCard3);
    
    logEvent('FLOP', { cards: cardsToString(gameState.board) });
    
    // 🎯 检查是否所有人都 All-in，如果是则直接发下一张牌
    if (isEveryoneAllIn()) {
      updateMsg('All players all-in - dealing remaining cards...');
      setTimeout(dealTurn, 1000);
      return;
    }
    
    // Post-flop从庄家后第一位开始（即SB位置，或Heads-Up中的BB）
    // 🛡️ 必须跳过已弃牌的玩家
    gameState.turnIndex = findFirstActivePlayer((gameState.dealerIndex + 1) % gameState.players.length);
    gameState.actionCount = 0;  // 重置行动计数
    
    setTimeout(nextTurn, 500);
  }

  async function dealTurn() {
    gameState.phase = 'turn';
    
    // 蒙特卡洛零模型：筛选 Turn 牌
    const turnSelected = mozSelectAndPick();
    await distributeCommunityCard(0, 0, turnSelected);
    
    const turnCard = gameState.board[3];
    logEvent('TURN', { card: cardToSolverString(turnCard), board: cardsToString(gameState.board) });
    
    // 🎯 检查是否所有人都 All-in，如果是则直接发河牌
    if (isEveryoneAllIn()) {
      setTimeout(dealRiver, 1000);
      return;
    }
    
    // 🛡️ 必须跳过已弃牌的玩家
    gameState.turnIndex = findFirstActivePlayer((gameState.dealerIndex + 1) % gameState.players.length);
    gameState.actionCount = 0;  // 重置行动计数
    setTimeout(nextTurn, 500);
  }

  async function dealRiver() {
    gameState.phase = 'river';
    
    // 蒙特卡洛零模型：筛选 River 牌（最关键的一张）
    const riverSelected = mozSelectAndPick();
    await distributeCommunityCard(0, 0, riverSelected);
    
    const riverCard = gameState.board[4];
    logEvent('RIVER', { card: cardToSolverString(riverCard), board: cardsToString(gameState.board) });
    
    // 🎯 检查是否所有人都 All-in，如果是则直接摊牌
    if (isEveryoneAllIn()) {
      setTimeout(showdown, 1000);
      return;
    }
    
    // 🛡️ 必须跳过已弃牌的玩家
    gameState.turnIndex = findFirstActivePlayer((gameState.dealerIndex + 1) % gameState.players.length);
    gameState.actionCount = 0;  // 重置行动计数
    setTimeout(nextTurn, 500);
  }

  function showdown() {
    gameState.phase = 'showdown';
    setTurnIndicator(-1);
    enablePlayerControls(false);
    
    // 翻开所有AI的牌
    gameState.players.forEach(player => {
      if (player.type === 'ai' && !player.folded) {
        player.cards.forEach(card => card.setSide('front'));
      }
    });
    
    setTimeout(determineWinner, 1000);
  }

  function endHandEarly() {
    const winner = getActivePlayers()[0];
    const potWon = gameState.pot + gameState.players.reduce((sum, p) => sum + p.currentBet, 0);
    
    // 🎴 翻开所有玩家的牌（包括已弃牌的）
    gameState.players.forEach(player => {
      if (player.type === 'ai') {
        player.cards.forEach(card => card.setSide('front'));
      }
    });
    
    winner.chips += potWon;
    gameState.pot = 0;
    gameState.players.forEach(p => p.currentBet = 0);
    
    logEvent('RESULT', {
      winner: winner.name,
      potWon: potWon,
      reason: 'All others folded'
    });
    
    updateMsg(`${winner.name} wins $${potWon}!`);
    winner.seatElement.classList.add('winner');
    
    updateSeatDisplay(winner);
    updatePotDisplay();
    
    setTimeout(endGame, 2000);
  }

  function determineWinner() {
    const activePlayers = getActivePlayers();
    const boardStrings = gameState.board.map(cardToSolverString);
    
    const hands = activePlayers.map(player => {
      const playerStrings = player.cards.map(cardToSolverString);
      const hand = Hand.solve([...playerStrings, ...boardStrings]);
      return { player, hand };
    });
    
    // 记录showdown
    hands.forEach(({ player, hand }) => {
      logEvent('SHOWDOWN', {
        playerId: player.id,
        playerName: player.name,
        cards: cardsToString(player.cards),
        handDescr: hand.descr
      });
      
      const status = player.seatElement.querySelector('.seat-status');
      status.textContent = hand.descr;
    });
    
    const allHands = hands.map(h => h.hand);
    const winners = Hand.winners(allHands);
    
    const winnerPlayers = hands.filter(h => winners.includes(h.hand)).map(h => h.player);
    const potWon = gameState.pot;
    const sharePerWinner = Math.floor(potWon / winnerPlayers.length);
    
    winnerPlayers.forEach(winner => {
      winner.chips += sharePerWinner;
      winner.seatElement.classList.add('winner');
      updateSeatDisplay(winner);
    });
    
    gameState.pot = 0;
    
    const winnerNames = winnerPlayers.map(w => w.name).join(', ');
    logEvent('RESULT', {
      winners: winnerNames,
      potWon: potWon,
      handDescr: winnerPlayers[0].seatElement.querySelector('.seat-status').textContent
    });
    
    if (winnerPlayers.length === 1) {
      updateMsg(`${winnerNames} wins $${potWon}!`);
    } else {
      updateMsg(`Split pot: ${winnerNames} ($${sharePerWinner} each)`);
    }
    
    updatePotDisplay();
    setTimeout(endGame, 3000);
  }

  function endGame() {
    gameState.phase = 'idle';
    setTurnIndicator(-1);
    
    // 移除winner类
    gameState.players.forEach(p => {
      if (p.seatElement) {
        p.seatElement.classList.remove('winner');
      }
    });
    
    // 显示日志
    showGameLog();
    
    // 标记淘汰玩家（chips === 0）
    gameState.players.forEach(p => {
      if (p.chips <= 0) {
        p.isActive = false;
        if (p.seatElement) {
          p.seatElement.classList.add('folded');
          const status = p.seatElement.querySelector('.seat-status');
          if (status) status.textContent = 'BUSTED';
        }
      }
    });
    
    // 检查是否只剩一个有筹码的玩家（游戏结束）
    const alivePlayers = gameState.players.filter(p => p.chips > 0);
    if (alivePlayers.length <= 1) {
      const champion = alivePlayers[0];
      if (champion) {
        updateMsg(`${champion.name} wins the game!`);
      }
      UI.btnDeal.disabled = false;
      return;
    }
    
    // 移动庄家按钮（跳过已淘汰的玩家）
    let nextDealer = (gameState.dealerIndex + 1) % gameState.players.length;
    let safety = 0;
    while (gameState.players[nextDealer].chips <= 0 && safety < gameState.players.length) {
      nextDealer = (nextDealer + 1) % gameState.players.length;
      safety++;
    }
    gameState.dealerIndex = nextDealer;
    
    UI.btnDeal.disabled = false;
  }

  // ========== 日志系统（委托给 GameLogger） ==========
  const gameLogger = new GameLogger();
  gameLogger.bindUI({
    panel: UI.gameLogPanel,
    content: UI.gameLogContent,
    btnCopy: UI.btnCopyLog,
    btnToggle: UI.btnToggleLog
  });
  gameLogger.getGameSnapshot = function () {
    return {
      phase: gameState.phase,
      pot: gameState.pot,
      players: gameState.players.map(function (p) {
        return { name: p.name, chips: p.chips, currentBet: p.currentBet };
      })
    };
  };

  function logEvent(type, data) {
    gameLogger.log(type, data);
  }

  function showGameLog() {
    gameLogger.show({
      playerCount: gameState.players.length,
      playerNames: gameState.players.map(function (p) { return p.name; }),
      players: gameState.players.map(function (p) {
        return { name: p.name, cardsStr: p.cards && p.cards.length > 0 ? cardsToString(p.cards) : '[unknown]' };
      }),
      boardStr: cardsToString(gameState.board),
      initialChips: getInitialChips(),
      smallBlind: getSmallBlind(),
      bigBlind: getBigBlind()
    });
  }

  function fitTableToScreen() {
    const table = document.getElementById('poker-table');
    if (!table) return;

    const tableW = 1100;
    // 实际视觉高度 = 表上溢出120 + 牌桌550 + 表下溢出160 = 830
    const totalVisualH = 830;
    const dashboardH = 100; // 底部仪表盘高度
    const availW = window.innerWidth - 20;
    const availH = window.innerHeight - dashboardH - 20;

    let scale = Math.min(availW / tableW, availH / totalVisualH);
    if (!Number.isFinite(scale)) {
      scale = 1;
    }
    if (scale > 1.05) scale = 1.05;

    // 保留 CSS 的 translate(-50%, -50%) 居中 + 缩放
    table.style.transform = `translate(-50%, -50%) scale(${scale})`;
  }

  // ========== 技能系统 UI（已迁移到 skill-ui.js） ==========
  // 所有技能UI逻辑由 skillUI 实例管理，不再硬编码。

  // ========== 事件绑定 ==========
  UI.btnDeal.addEventListener('click', startNewGame);
  UI.btnFold.addEventListener('click', playerFold);
  UI.btnCheckCall.addEventListener('click', playerCheckCall);
  UI.btnRaise.addEventListener('click', playerRaise);
  UI.btnConfirmRaise.addEventListener('click', confirmRaise);
  // copyGameLog / toggleLogPanel 已由 gameLogger.bindUI 绑定

  // 技能按钮由 skillUI._buildSkillButtons 自动生成和绑定
  
  UI.raiseSlider.addEventListener('input', function() {
    UI.raiseAmountDisplay.textContent = '$' + this.value;
  });


  UI.btnForceNext.addEventListener('click', () => {
    if (gameState.phase !== 'idle') {
      endBettingRound();
    }
  });

  window.addEventListener('resize', fitTableToScreen);

  // ========== 配置加载 ==========
  async function loadConfig() {
    // 如果外部配置（postMessage）已经到达，跳过静态文件加载
    if (_externalConfigApplied) {
      console.log('[CONFIG] 外部配置已存在，跳过 game-config.json 加载');
      return;
    }

    // 尝试从根目录加载 game-config.json（相对于 GitPage 根）
    // 路径: ../../game-config.json (从 texasholdem/texas-holdem/ 回到根)
    const configPaths = ['../../game-config.json', 'game-config.json'];
    
    for (const path of configPaths) {
      // 再次检查：fetch 期间外部配置可能已到达
      if (_externalConfigApplied) {
        console.log('[CONFIG] 外部配置已到达，中止 game-config.json 加载');
        return;
      }
      try {
        const response = await fetch(path);
        if (_externalConfigApplied) {
          console.log('[CONFIG] 外部配置已到达，丢弃 game-config.json');
          return;
        }
        if (response.ok) {
          gameConfig = await response.json();
          console.log('[CONFIG] 从', path, '加载:', gameConfig);
          // 注册技能 + 生成UI
          skillUI.registerFromConfig(gameConfig);
          return;
        }
      } catch (e) { /* try next */ }
    }
    
    console.log('[CONFIG] 使用默认内置配置');
  }

  /**
   * 应用外部注入的配置（从主引擎 postMessage 到达）
   * @param {Object} config - 注入的配置对象
   */
  function applyExternalConfig(config) {
    if (!config) return;
    gameConfig = config;
    _externalConfigApplied = true;
    console.log('[CONFIG] 外部配置已应用:', config);
    // 注册技能 + 生成UI
    skillUI.registerFromConfig(config);
  }

  // ========== postMessage 监听 ==========
  // 接收来自主引擎 (index.html) 的配置数据
  window.addEventListener('message', function (event) {
    const msg = event?.data;
    if (!msg || msg.type !== 'acezero-game-data') return;
    console.log('[CONFIG] 收到主引擎 postMessage 配置');
    applyExternalConfig(msg.payload);
  });

  // 主动向父窗口请求配置
  function requestConfigFromEngine() {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ type: 'acezero-data-request' }, '*');
    }
  }

  // ========== 等待 RPG 模块就绪 ==========
  function waitForRPG() {
    if (window.__rpgReady) return Promise.resolve();
    return new Promise(function (resolve) {
      window.addEventListener('rpg:ready', resolve, { once: true });
      // 安全超时：2秒后即使 RPG 没加载也继续（降级运行）
      setTimeout(function () {
        if (!window.__rpgReady) {
          console.warn('[INIT] RPG 模块未在 2s 内加载，降级运行');
        }
        resolve();
      }, 2000);
    });
  }

  // ========== 初始化 ==========
  async function init() {
    await waitForRPG();
    await loadConfig();
    initTable();
    enablePlayerControls(false);
    updatePotDisplay();
    fitTableToScreen();

    // 如果在 iframe 中，主动请求配置
    requestConfigFromEngine();
  }
  
  init();
})();
