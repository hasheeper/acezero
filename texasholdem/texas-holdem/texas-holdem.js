/* global Deck, Hand, PokerAI, MonteOfZero */

(function () {
  'use strict';

  const SUIT_TRANSLATE = {0: 's', 1: 'h', 2: 'c', 3: 'd'};
  const RANK_TRANSLATE = {1: 'A', 2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: 'T', 11: 'J', 12: 'Q', 13: 'K'};

  // ========== 游戏配置（从JSON加载或使用默认值） ==========
  let gameConfig = null;
  let _externalConfigApplied = false;
  let _configSource = null; // 'injected' | 'static'

  // 默认配置（新格式）
  const DEFAULT_CONFIG = {
    blinds: [10, 20],
    chips: 1000,
    heroSeat: 'CO',
    hero: {
      vanguard: { name: 'KAZU', level: 3 },
      rearguard: { name: 'RINO', level: 5 },
      vanguardSkills: [],
      rearguardSkills: []
    },
    seats: {
      BTN: { vanguard: { name: 'ALPHA', level: 0 }, ai: 'balanced' },
      SB:  { vanguard: { name: 'BETA',  level: 0 }, ai: 'rock' },
      BB:  { vanguard: { name: 'GAMMA', level: 3 }, ai: 'aggressive' },
      UTG: { vanguard: { name: 'DELTA', level: 0 }, ai: 'passive' },
      CO:  { vanguard: { name: 'EPSILON', level: 1 }, ai: 'maniac' }
    }
  };

  // 座位顺序（德州规则：BTN 先发牌，UTG 先行动）
  const SEAT_ORDER = ['BTN', 'SB', 'BB', 'UTG', 'HJ', 'CO'];

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
   * 从 seats + heroSeat 构建玩家配置列表
   * 所有玩家（hero + NPC）按 SEAT_ORDER 排列，hero 在 heroSeat 位置
   * dealerIndex 自动指向 BTN 座位的玩家
   */
  function getPlayerConfigs() {
    var cfg = _cfg();
    var result = [];
    var tableChips = cfg.chips || 1000;
    var heroChips = cfg.heroChips || tableChips;
    var heroSeat = cfg.heroSeat || 'BB';
    var seats = cfg.seats || {};

    // 收集所有有人的座位（hero + NPC），按 SEAT_ORDER 排列
    for (var i = 0; i < SEAT_ORDER.length; i++) {
      var seatId = SEAT_ORDER[i];

      if (seatId === heroSeat) {
        // hero 在这个位置
        result.push({
          id: result.length,
          name: cfg.hero ? _charName(cfg.hero) : 'RINO',
          type: 'human',
          chips: heroChips,
          personality: null,
          seat: seatId
        });
      } else if (seats[seatId]) {
        // NPC 在这个位置
        var s = seats[seatId];
        var aiStyle = s.ai || 'balanced';
        var aiEmotion = s.emotion || 'calm';
        var aiDifficulty = s.difficulty || AI_DIFF_MAP[aiStyle] || 'regular';
        result.push({
          id: result.length,
          name: _charName(s),
          type: 'ai',
          chips: tableChips,
          personality: { riskAppetite: aiStyle, difficulty: aiDifficulty, emotion: aiEmotion },
          seat: seatId
        });
      }
    }

    // 安全兜底：如果 heroSeat 不在任何已定义的座位中（配置错误），追加 hero
    if (!result.some(function(p) { return p.type === 'human'; })) {
      result.unshift({
        id: 0,
        name: cfg.hero ? _charName(cfg.hero) : 'RINO',
        type: 'human',
        chips: heroChips,
        personality: null,
        seat: heroSeat
      });
    }

    // 重新编号 id
    for (var j = 0; j < result.length; j++) {
      result[j].id = j;
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
    // Grimoire 抽屉
    grimoirePlayer: document.getElementById('grimoire-player'),
    magicKey: document.getElementById('magic-key'),
    // (玩家数量由外部 JSON 配置决定)
  };

  // Grimoire 抽屉开关
  if (UI.magicKey) {
    UI.magicKey.addEventListener('click', function () {
      if (UI.grimoirePlayer) UI.grimoirePlayer.classList.toggle('active');
      UI.magicKey.classList.toggle('engaged');
    });
  }

  // ========== Splash / End-hand Modal / Row Toggle ==========
  const splashOverlay  = document.getElementById('splash-overlay');
  const splashDeal     = document.getElementById('splash-deal');
  const endhandModal   = document.getElementById('endhand-modal');
  const endhandTitle   = document.getElementById('endhand-title');
  const endhandResult  = document.getElementById('endhand-result');
  const endhandDeal    = document.getElementById('endhand-deal');
  const endhandLog     = document.getElementById('endhand-log');

  function dismissSplash() {
    if (!splashOverlay) return;
    splashOverlay.classList.add('hidden');
    setTimeout(function () { splashOverlay.style.display = 'none'; }, 500);
  }

  function setGameActive(active) {
    if (active) {
      document.body.classList.add('game-active');
    } else {
      document.body.classList.remove('game-active');
    }
  }

  function showEndhandModal(title, resultText) {
    if (!endhandModal) return;
    if (endhandTitle) endhandTitle.textContent = title || 'HAND COMPLETE';
    if (endhandResult) endhandResult.textContent = resultText || '';
    endhandModal.classList.remove('fade-out');
    endhandModal.style.display = 'flex';
  }

  function dismissEndhandModal() {
    if (!endhandModal) return;
    endhandModal.classList.add('fade-out');
    setTimeout(function () { endhandModal.style.display = 'none'; }, 300);
  }

  // Splash "NEW HAND" → start game + dismiss splash
  if (splashDeal) {
    splashDeal.addEventListener('click', function () {
      dismissSplash();
      startNewGame();
    });
  }

  // End-hand modal "NEW HAND" → dismiss + start
  if (endhandDeal) {
    endhandDeal.addEventListener('click', function () {
      dismissEndhandModal();
      startNewGame();
    });
  }

  // End-hand modal "COPY LOG" → copy AI prompt with full context
  if (endhandLog) {
    endhandLog.addEventListener('click', function () {
      if (typeof gameLogger !== 'undefined' && gameLogger.copyAIPrompt) {
        gameLogger.copyAIPrompt(buildLogContext());
      } else if (UI.gameLogContent) {
        navigator.clipboard.writeText(UI.gameLogContent.textContent).catch(function () {});
      }
      endhandLog.textContent = 'COPIED!';
      setTimeout(function () { endhandLog.textContent = 'COPY LOG'; }, 1500);
    });
  }

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
    foresightPanel: document.getElementById('foresight-panel')
  });

  moz.onLog = function (type, data) { logEvent('MOZ_' + type, data); };
  skillSystem.onLog = function (type, data) { logEvent('SKILL_' + type, data); };
  skillUI.onLog = function (type, data) { logEvent(type, data); };
  skillUI.onMessage = function (msg) { updateMsg(msg); };

  // 暴露全局引用，供调试控制台使用
  window._debug = { skillUI, moz, skillSystem };
  window.skillUI = skillUI;
  window.moz = moz;
  window.skillSystem = skillSystem;
  // 快捷调试开关
  window.debugMode = function (on) {
    moz.debugMode = on !== false;
    console.log('[DEBUG] debugMode =', moz.debugMode);
    return moz.debugMode;
  };

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

  // 保存最近一手的结果文字（供 endGame modal 使用）
  let _lastResultMsg = '';

  // 记录 hero 每手开始时的筹码，用于计算 funds_delta
  let _heroStartChips = 0;

  // ========== 工具函数 ==========
  function getHeroPlayer() {
    return gameState.players.find(function(p) { return p.type === 'human'; }) || gameState.players[0];
  }

  function getHeroIndex() {
    var idx = gameState.players.findIndex(function(p) { return p.type === 'human'; });
    return idx >= 0 ? idx : 0;
  }

  function cardToSolverString(card) {
    if (!card) return '';
    return RANK_TRANSLATE[card.rank] + SUIT_TRANSLATE[card.suit];
  }

  function cardsToString(cards) {
    return cards.map(cardToSolverString).join(' ');
  }

  function updateMsg(text) {
    UI.txtBoard.innerHTML = text;
  }

  function updatePotDisplay() {
    const activeBets = gameState.players.reduce((sum, p) => sum + p.currentBet, 0);
    const totalPot = gameState.pot + activeBets;
    if (UI.potAmount) {
      UI.potAmount.innerHTML = Currency.html(totalPot);
    }
    updateCenterChipsVisual(gameState.pot);
  }

  function updateCenterChipsVisual(amount) {
    const container = UI.potClusters;
    if (!container) return;
    container.innerHTML = '';
    if (amount <= 0) return;

    const vis = Currency.chipVisual(amount);

    for (let i = 0; i < vis.count; i++) {
      const chip = document.createElement('div');
      chip.className = `chip-stack ${vis.color}`;
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
      <!-- 浮动名牌（独立于座位容器外） -->
      <div class="player-name-float">
        <span class="position-badge" style="display:none;"></span>
        <span class="player-name">${player.name}</span>
      </div>

      <!-- HUD 角标 -->
      <div class="hud-corner hud-tl"></div>
      <div class="hud-corner hud-tr"></div>
      <div class="hud-corner hud-bl"></div>
      <div class="hud-corner hud-br"></div>
      
      <!-- Dealer Button -->
      <div class="dealer-button" style="display:none;">
        <span>D</span>
      </div>
      
      <!-- 座位信息（仅筹码） -->
      <div class="seat-header">
        <div class="chip-count">${Currency.html(player.chips)}</div>
      </div>
      
      <!-- 卡牌区域 -->
      <div class="seat-cards"></div>
      
      <!-- 下注筹码 -->
      <div class="bet-chips" style="display:none;">
        <div class="chip-stack">
          <div class="chip-ring"></div>
          <div class="chip-inlay"></div>
        </div>
        <div class="chip-amount"></div>
      </div>
      
      <!-- 状态文字 -->
      <div class="seat-status"></div>
    `;

    return seat;
  }

  function renderSeats() {
    UI.seatsContainer.innerHTML = '';
    const n = gameState.players.length;
    const positions = SEAT_POSITIONS[n] || SEAT_POSITIONS[2];
    
    // hero 永远在 bottom（视觉位置0），其余按顺时针排列
    var heroIdx = gameState.players.findIndex(function(p) { return p.type === 'human'; });
    if (heroIdx < 0) heroIdx = 0;

    for (var step = 0; step < n; step++) {
      var playerIdx = (heroIdx + step) % n;
      var player = gameState.players[playerIdx];
      var position = positions[step] || 'bottom';
      var seatElement = createSeatElement(player, position);
      UI.seatsContainer.appendChild(seatElement);
      player.seatElement = seatElement;
    }
  }

  // 根据银弗数值获取筹码颜色 (委托给 Currency 模块)
  function getChipType(amount) {
    return Currency.chipColor(amount);
  }

  function updateSeatDisplay(player) {
    if (!player.seatElement) return;
    
    const chipCount = player.seatElement.querySelector('.chip-count');
    chipCount.innerHTML = Currency.html(player.chips);
    
    const betChips = player.seatElement.querySelector('.bet-chips');
    if (player.currentBet > 0 && player.isActive) {
      betChips.style.display = 'flex';
      betChips.querySelector('.chip-amount').innerHTML = Currency.htmlAmount(player.currentBet);
      
      // 根据下注金额设置筹码类型
      const chipStack = betChips.querySelector('.chip-stack');
      const chipType = getChipType(player.currentBet);
      console.log(`[Chip Debug] Player: ${player.name}, Bet: ${Currency.amount(player.currentBet)}, Chip Type: ${chipType}`);
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

  // 位置标签：直接使用配置中的 seat 字段（BTN/SB/BB/UTG/HJ/CO）
  // seat 字段在 getPlayerConfigs() 中已从 heroSeat + NPC 座位键正确赋值
  function assignPositions() {
    var players = gameState.players;
    for (var i = 0; i < players.length; i++) {
      players[i].position = players[i].seat || '';
    }
  }

  function updatePositionBadges() {
    gameState.players.forEach(function(player) {
      if (!player.seatElement) return;
      var badge = player.seatElement.querySelector('.position-badge');
      if (!badge) return;
      var pos = player.position || '';
      badge.textContent = pos;
      badge.style.display = pos ? 'inline-block' : 'none';
      // 颜色区分
      badge.className = 'position-badge';
      if (pos === 'BTN') badge.classList.add('pos-btn');
      else if (pos === 'SB') badge.classList.add('pos-sb');
      else if (pos === 'BB') badge.classList.add('pos-bb');
      else badge.classList.add('pos-other');
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
      const isHuman = config.type === 'human';
      
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
        personality: config.personality || null,
        seat: config.seat || ''
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
    UI.toCallAmount.innerHTML = Currency.htmlAmount(toCall);
    
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
    
    const player = getHeroPlayer();
    if (!player) return;
    
    const toCall = gameState.currentBet - (player.currentBet || 0);
    
    if (toCall === 0) {
      UI.btnCheckCall.textContent = 'CHECK';
    } else {
      UI.btnCheckCall.innerHTML = `CALL ${Currency.htmlAmount(toCall)}`;
    }
    
    // 更新加注滑块
    // 最小加注额 = 大盲注（或上一次加注的增量，简化为大盲注）
    // 滑块值 = 加注增量（在跟注之上额外加的部分）
    const maxRaise = player.chips - toCall; // 扣除跟注后剩余可加注的量
    const minRaise = Math.min(getBigBlind(), maxRaise > 0 ? maxRaise : player.chips);
    UI.raiseSlider.min = minRaise;
    UI.raiseSlider.max = Math.max(minRaise, maxRaise);
    UI.raiseSlider.value = minRaise;
    UI.raiseAmountDisplay.innerHTML = Currency.htmlAmount(minRaise);
  }

  function playerFold() {
    const player = getHeroPlayer();
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
    const player = getHeroPlayer();
    const toCall = gameState.currentBet - player.currentBet;
    
    if (toCall > 0) {
      const callAmount = Math.min(toCall, player.chips);
      player.chips -= callAmount;
      player.currentBet += callAmount;
      player.totalBet += callAmount;
      logEvent('PLAYER_CALL', { playerId: player.id, playerName: player.name, amount: callAmount });
      updateMsg(`You call ${Currency.htmlAmount(callAmount)}`);
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
    const player = getHeroPlayer();
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
    gameState.lastRaiserIndex = getHeroIndex();
    
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
    updateMsg(isBet ? `You bet ${Currency.htmlAmount(actualRaise)}` : `You raise ${Currency.htmlAmount(actualRaise)}`);
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
      playerStack: getHeroPlayer().chips,
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
    status.innerHTML = `CALL ${Currency.htmlAmount(callAmount)}`;
    
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
    
    // 🛡️ 修复 RAISE 0 问题：如果加注金额 <= 0，说明是 All-in 跟注
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
      status.innerHTML = `CALL ${Currency.htmlAmount(actualCallAmount)} (All-in)`;
      
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
    status.innerHTML = isBet ? `BET ${Currency.htmlAmount(raiseAmount)}${allInSuffix}` : `RAISE ${Currency.htmlAmount(raiseAmount)}${allInSuffix}`;
    
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
      if (result.meta) {
        showForcePK(result.meta);
        // Psyche 拦截反馈：让玩家看到技能生效了
        _showPsycheMessages(result.meta.psycheEvents);
      }
      skillUI.updateDisplay();
      return picked;
    }
    
    return deckLib.cards.pop();
  }

  // ========== SVG 图标（替代 emoji） ==========
  const _svgIcons = {
    fortune:  '<svg class="fpk-icon" viewBox="0 0 16 16"><path d="M8 1l2.2 4.5L15 6.3l-3.5 3.4.8 4.8L8 12.3 3.7 14.5l.8-4.8L1 6.3l4.8-.8z" fill="#9B59B6"/></svg>',
    curse:    '<svg class="fpk-icon" viewBox="0 0 16 16"><path d="M8 1C5.2 1 3 3.7 3 7c0 2.2 1 4 2.5 5h5C12 11 13 9.2 13 7c0-3.3-2.2-6-5-6zM6 12v1c0 .6.9 1 2 1s2-.4 2-1v-1H6z" fill="#e74c3c"/></svg>',
    backlash: '<svg class="fpk-icon" viewBox="0 0 16 16"><path d="M9 1L4 8h3l-2 7 7-8H9l2-6z" fill="#f39c12"/></svg>',
    clarity:  '<svg class="fpk-icon" viewBox="0 0 16 16"><circle cx="8" cy="8" r="5" fill="none" stroke="#74b9ff" stroke-width="1.5"/><circle cx="8" cy="8" r="2" fill="#74b9ff"/></svg>',
    refraction:'<svg class="fpk-icon" viewBox="0 0 16 16"><path d="M3 13L8 3l5 10" fill="none" stroke="#a29bfe" stroke-width="1.5"/><line x1="5" y1="9" x2="11" y2="9" stroke="#a29bfe" stroke-width="1.2"/></svg>',
    reversal: '<svg class="fpk-icon" viewBox="0 0 16 16"><path d="M2 5h9l-3-3h2l4 4-4 4h-2l3-3H2V5zm12 6H5l3 3H6l-4-4 4-4h2L5 9h9v2z" fill="#1abc9c"/></svg>',
    null_field:'<svg class="fpk-icon" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6" fill="none" stroke="#95a5a6" stroke-width="1.5"/><line x1="4" y1="12" x2="12" y2="4" stroke="#95a5a6" stroke-width="1.5"/></svg>',
    void_shield:'<svg class="fpk-icon" viewBox="0 0 16 16"><path d="M8 1L2 4v4c0 3.3 2.6 6.4 6 7 3.4-.6 6-3.7 6-7V4L8 1z" fill="none" stroke="#7f8c8d" stroke-width="1.5"/></svg>',
    purge_all:'<svg class="fpk-icon" viewBox="0 0 16 16"><path d="M8 2L3 8l5 6 5-6-5-6z" fill="none" stroke="#bdc3c7" stroke-width="1.5"/></svg>',
    bolt:     '<svg class="fpk-icon fpk-icon-title" viewBox="0 0 16 16"><path d="M9 1L4 8h3l-2 7 7-8H9l2-6z" fill="currentColor"/></svg>',
    arrow:    '<svg class="fpk-icon fpk-icon-arrow" viewBox="0 0 16 16"><path d="M2 8h10l-3-3 1.4-1.4L15 8l-4.6 4.4L9 11l3-3H2V8z" fill="currentColor"/></svg>',
    debug:    '<svg class="fpk-icon fpk-icon-title" viewBox="0 0 16 16"><path d="M11 1l-1 2H6L5 1H3l1.3 2.6C3 4.5 2 6.1 2 8h2v2H2c.2 1.2.7 2.3 1.4 3.1L2 14.5 3.5 16l1.2-1.2c.8.5 1.7.7 2.6.8V9h1.4v6.6c.9-.1 1.8-.3 2.6-.8L12.5 16 14 14.5l-1.4-1.4C13.3 12.3 13.8 11.2 14 10h-2V8h2c0-1.9-1-3.5-2.3-4.4L13 1h-2z" fill="currentColor"/></svg>',
    eye:      '<svg class="fpk-icon" viewBox="0 0 16 16"><path d="M8 3C4.4 3 1.4 5.4 0 8c1.4 2.6 4.4 5 8 5s6.6-2.4 8-5c-1.4-2.6-4.4-5-8-5zm0 8.3c-1.8 0-3.3-1.5-3.3-3.3S6.2 4.7 8 4.7s3.3 1.5 3.3 3.3S9.8 11.3 8 11.3zM8 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z" fill="currentColor"/></svg>'
  };

  // ========== 命运裁决展示 ==========
  let _fpkTimer = null;

  function showForcePK(meta) {
    const overlay = document.getElementById('force-pk-overlay');
    if (!overlay || !meta) return;

    const forces = meta.activeForces || [];
    const candidates = meta.topCandidates || [];
    const timeline = meta.debugTimeline || [];
    const isDebug = moz.debugMode;
    const _s = _svgIcons;

    // 没有力量也没有候选牌时不弹出
    if (forces.length === 0 && candidates.length === 0) return;

    const TYPE_CN = {
      fortune: '幸运', curse: '凶', backlash: '反噬',
      clarity: '澄澈', refraction: '折射', reversal: '真理',
      null_field: '屏蔽', void_shield: '绝缘', purge_all: '现实'
    };

    // 力量三分类：favorable(对玩家有利) / hostile(对玩家不利) / neutral(中立)
    // 玩家 ID = 0
    var HERO_ID = 0;
    var BENEFICIAL_TYPES = { fortune: 1, clarity: 1, refraction: 1, reversal: 1, null_field: 1, void_shield: 1, purge_all: 1 };
    var HARMFUL_TYPES = { curse: 1, backlash: 1 };

    function _classifyForce(f) {
      // 对玩家有利：玩家自己的有益技能，或转化后归属玩家的幸运
      if (BENEFICIAL_TYPES[f.type] && f.ownerId === HERO_ID) return 'favorable';
      if (f.converted && f.ownerId === HERO_ID) return 'favorable';
      // 对玩家不利：诅咒/反噬 targeting 玩家
      if (HARMFUL_TYPES[f.type] && f.targetId === HERO_ID) return 'hostile';
      // 其余都是中立（别人的幸运、别人的psyche、诅咒别人的等）
      return 'neutral';
    }

    // ---- 构建 HTML ----
    let html = '';

    // === Header ===
    html += '<div class="fpk-header">';
    html += '<div class="fpk-title-group">';
    html += '<div class="fpk-title">DESTINY RECALIBRATION</div>';
    html += '<div class="fpk-subtitle">/// TERMINAL V.3.2 // MOZ_ENGINE</div>';
    html += '</div>';
    html += '<div class="fpk-sys-status">';
    html += '<svg class="fpk-spin" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v4m0 12v4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.48-8.48l2.83-2.83"/></svg>';
    html += '<span>ADJUSTING</span>';
    html += '</div>';
    html += '</div>';

    // === Conflict Matrix (Grid 三区布局：ambient 上方，favorable左 vs hostile右) ===
    if (forces.length > 0) {
      var favorableForces = [];
      var hostileForces = [];
      var neutralForces = [];
      for (var ci = 0; ci < forces.length; ci++) {
        var cat = _classifyForce(forces[ci]);
        if (cat === 'favorable') favorableForces.push(forces[ci]);
        else if (cat === 'hostile') hostileForces.push(forces[ci]);
        else neutralForces.push(forces[ci]);
      }

      // 中立区（全宽横排，在 matrix 上方）
      if (neutralForces.length > 0) {
        html += '<div class="fpk-ambient-row">';
        html += '<span class="fpk-zone-label fpk-z-env">AMBIENT FIELD</span>';
        for (var ni = 0; ni < neutralForces.length; ni++) {
          html += _buildChip(neutralForces[ni]);
        }
        html += '</div>';
      }

      // 有利(左) vs 不利(右) Grid
      if (favorableForces.length > 0 || hostileForces.length > 0) {
        html += '<div class="fpk-conflict-matrix">';

        // 左列：有利
        html += '<div class="fpk-matrix-col fpk-col-favorable">';
        html += '<div class="fpk-zone-label fpk-z-good">ACTIVE PROTOCOLS</div>';
        for (var fi = 0; fi < favorableForces.length; fi++) {
          html += _buildChip(favorableForces[fi]);
        }
        if (favorableForces.length === 0) {
          html += '<div class="fpk-none-hint">NONE</div>';
        }
        html += '</div>';

        // 中间分隔线
        html += '<div class="fpk-matrix-divider"></div>';

        // 右列：不利
        html += '<div class="fpk-matrix-col fpk-col-hostile">';
        html += '<div class="fpk-zone-label fpk-z-bad">HOSTILE INTENT</div>';
        for (var hi = 0; hi < hostileForces.length; hi++) {
          html += _buildChip(hostileForces[hi]);
        }
        if (hostileForces.length === 0) {
          html += '<div class="fpk-none-hint">NONE</div>';
        }
        html += '</div>';

        html += '</div>'; // fpk-conflict-matrix
      }
    }

    // === Console Log (Psyche events) ===
    const psycheEvents = meta.psycheEvents || [];
    if (psycheEvents.length > 0) {
      html += '<div class="fpk-console">';
      for (const ev of psycheEvents) {
        const arbiterCn = TYPE_CN[ev.arbiterType] || ev.arbiterType;
        if (ev.action === 'convert') {
          var beneficiary = ev.beneficiary || ev.arbiterOwner;
          html += '<div class="fpk-console-line">';
          html += '<span class="fpk-log-icon">&gt;</span>';
          html += '<span class="fpk-log-txt"><span class="fpk-log-skill">[' + arbiterCn + ']</span> INTERCEPTED</span>';
          html += '<span class="fpk-log-bad">' + (TYPE_CN[ev.targetType] || '凶') + '(P' + ev.originalPower + ')</span>';
          html += '</div>';
          html += '<div class="fpk-console-line" style="padding-left:12px;">';
          html += '<span class="fpk-log-txt">&xrarr; RECONSTRUCTED TO</span>';
          html += '<span class="fpk-log-res">' + beneficiary + '::LUCK(P' + ev.convertedPower + ')</span>';
          html += '</div>';
        } else if (ev.action === 'nullify') {
          html += '<div class="fpk-console-line">';
          html += '<span class="fpk-log-icon">&gt;</span>';
          html += '<span class="fpk-log-txt"><span class="fpk-log-skill">[' + arbiterCn + ']</span> NULLIFIED</span>';
          html += '<span class="fpk-log-bad">' + (TYPE_CN[ev.targetType] || '凶') + '(P' + ev.originalPower + ')</span>';
          html += '</div>';
        } else if (ev.action === 'whiff') {
          html += '<div class="fpk-console-line">';
          html += '<span class="fpk-log-icon">&gt;</span>';
          html += '<span class="fpk-log-whiff">[' + arbiterCn + '] WHIFF — NO HOSTILE FORCES</span>';
          html += '</div>';
        }
      }
      html += '</div>';
    }

    // === Candidate Grid ===
    if (candidates.length > 0) {
      // 显示前5个 + 如果选中的不在前5，显示为第6行（带实际排名）
      var top5 = candidates.slice(0, 5);
      var selectedInTop5 = top5.some(function(c) { return c.selected; });
      var extraSelected = null;
      if (!selectedInTop5) {
        for (var k = 5; k < candidates.length; k++) {
          if (candidates[k].selected) { extraSelected = candidates[k]; break; }
        }
      }

      var maxProb = Math.max.apply(null, candidates.map(function(c) { return c.prob; }).concat([1]));

      html += '<div class="fpk-list">';
      html += '<div class="fpk-table-header">';
      html += '<span>#</span><span>CARD</span><span style="text-align:right">SCR</span><span>PROBABILITY</span><span>%</span>';
      html += '</div>';

      // Top 5 rows
      for (var ri = 0; ri < top5.length; ri++) {
        html += _buildCandidateRow(top5[ri], ri + 1, maxProb);
      }

      // Extra selected row (if outside top 5)
      if (extraSelected) {
        html += _buildCandidateRow(extraSelected, extraSelected.rank || '?', maxProb);
      }

      html += '</div>';
    }

    // === Debug 面板（仅 debugMode） ===
    if (isDebug && timeline.length > 0) {
      html += '<div class="fpk-debug">';
      html += '<div class="fpk-debug-title">' + _s.debug + ' DEBUG</div>';
      html += '<div class="fpk-debug-step">rank=#' + (meta.selectedRank || '?') + '/' + (meta.totalUniverses || '?') + ' score=' + (meta.destinyScore || 0).toFixed(1) + '</div>';
      if (forces.length > 0) {
        html += '<div class="fpk-debug-step"><span class="fpk-debug-stage">FORCES</span> ';
        for (const f of forces) {
          html += f.owner + '.' + (TYPE_CN[f.type] || f.type) + ' P' + f.power + ' ';
        }
        html += '</div>';
      }
      for (const step of timeline) {
        html += '<div class="fpk-debug-step">';
        html += '<span class="fpk-debug-stage">' + step.stage + '</span> ';
        switch (step.stage) {
          case 'ROUND_START':
            html += 'deck=' + step.data.deckRemaining + ' forces=' + (step.data.inputForces || []).length;
            break;
          case 'TIER_SUPPRESSION':
            for (const s of (step.data.suppressed || [])) {
              html += s.owner + '.' + s.type + ' X ' + s.suppressedBy + ' ';
            }
            break;
          case 'REVERSAL_CONVERT':
            html += step.data.intercepted.owner + '.' + step.data.intercepted.type + '(P' + step.data.intercepted.originalPower + ')>fortune(P' + step.data.converted.power + ')';
            break;
          case 'PSYCHE_CONVERT':
            html += step.data.intercepted.owner + '.' + step.data.intercepted.type + '(P' + step.data.intercepted.originalPower + ')>' + step.data.converted.owner + '.fortune(P' + step.data.converted.power + ')';
            break;
          case 'PSYCHE_NULLIFY':
            html += step.data.nullified.owner + '.' + step.data.nullified.type + '(P' + step.data.nullified.originalPower + ') NULLIFIED';
            break;
          case 'PSYCHE_WHIFF':
            html += step.data.owner + '.' + step.data.arbiterType + ' WHIFF (no curse)';
            break;
          case 'ATTR_COUNTER':
            for (const c of (step.data.countered || [])) {
              html += c.owner + '.' + c.type + ' EP=' + c.effectivePower;
              if (c.counterBonus) html += ' [C>M+10%]';
              if (c.clarityReduced) html += ' [P>C-clarity]';
              html += ' ';
            }
            break;
          case 'OPPOSITION_RESULT':
            for (const r of (step.data.resolved || [])) {
              const status = r.suppressed ? '[X]' : r.converted ? '[R]' : r.voidReduced ? '[V]' : '';
              html += '<br>' + r.owner + ' ' + r.type + ' P' + r.power + '>' + r.effectivePower + status;
            }
            break;
          case 'CARD_SELECTED':
            if (step.data.top3) {
              html += 'top: ' + step.data.top3.map(function(u) { return u.card + '=' + u.score.toFixed(1); }).join(', ');
            }
            break;
          default: break;
        }
        html += '</div>';
      }
      html += '</div>';
    }

    // === Click hint ===
    html += '<div class="fpk-click-hint">Click Anywhere to Dismiss</div>';

    overlay.innerHTML = html;
    overlay.classList.remove('fpk-fade-out');
    overlay.style.display = 'block';

    // 仅点击关闭，不自动隐藏
    if (_fpkTimer) { clearTimeout(_fpkTimer); _fpkTimer = null; }
    overlay.style.pointerEvents = 'auto';
    overlay.onclick = function () {
      overlay.classList.add('fpk-fade-out');
      setTimeout(function() {
        overlay.style.display = 'none';
        overlay.style.pointerEvents = 'none';
      }, 400);
      overlay.onclick = null;
    };
  }

  // 构建力量 Chip HTML (线框风格)
  function _buildChip(f) {
    var TYPE_CN = {
      fortune: '幸运', curse: '凶', backlash: '反噬',
      clarity: '澄澈', refraction: '折射', reversal: '真理',
      null_field: '屏蔽', void_shield: '绝缘', purge_all: '现实'
    };
    // attr → CSS class 映射
    var ATTR_CLS = {
      fortune: 'fpk-attr-moirai', curse: 'fpk-attr-chaos', backlash: 'fpk-attr-chaos',
      clarity: 'fpk-attr-psyche', refraction: 'fpk-attr-psyche', reversal: 'fpk-attr-psyche',
      null_field: 'fpk-attr-void', void_shield: 'fpk-attr-void', purge_all: 'fpk-attr-void'
    };
    var typeCn = TYPE_CN[f.type] || f.type;
    var attrCls = ATTR_CLS[f.type] || 'fpk-attr-void';
    var suppCls = f.suppressed ? ' fpk-chip-suppressed' : '';
    var h = '<div class="fpk-chip ' + attrCls + suppCls + '">';
    h += '<span class="c-txt">' + f.owner + ' · ' + typeCn + '</span>';
    if (f.tier) h += ' <span class="fpk-tier-badge">' + _tierLabel(f.tier) + '</span>';
    h += '</div>';
    return h;
  }

  // 构建候选行 HTML
  function _buildCandidateRow(c, rank, maxProb) {
    var barWidth = Math.max(2, Math.round((c.prob / maxProb) * 100));
    var isWin = c.rinoWins;
    var selCls = '';
    if (c.selected) selCls = isWin ? ' is-selected' : ' is-selected-lose';
    var barCls = isWin ? 'fpk-bar-fill-win' : 'fpk-bar-fill-lose';

    var h = '<div class="fpk-row' + selCls + '">';
    h += '<span class="fpk-cell-rank">' + (typeof rank === 'number' ? ('0' + rank).slice(-2) : '#' + rank) + '</span>';
    h += '<span class="fpk-cell-card">' + _cardToDisplay(c.card) + '</span>';
    h += '<span class="fpk-cell-score">' + c.score.toFixed(1) + '</span>';
    h += '<div class="fpk-cell-bar-wrap"><div class="fpk-bar-bg"><div class="fpk-bar-fill ' + barCls + '" style="width:' + barWidth + '%"></div></div></div>';
    h += '<span class="fpk-cell-prob">' + c.prob.toFixed(1) + '%';
    if (c.selected) h += ' <span class="fpk-pick-arrow">◄</span>';
    h += '</span>';
    h += '</div>';
    return h;
  }

  // Tier 标签
  function _tierLabel(tier) {
    var labels = { 1: 'I', 2: 'II', 3: 'III' };
    return labels[tier] || '';
  }

  // 牌面字符串 → 可视化显示
  function _cardToDisplay(cardStr) {
    if (!cardStr || cardStr.length < 2) return cardStr || '?';
    var rank = cardStr[0];
    var suitChar = cardStr[1];
    var SUIT_SYMBOLS = { h: '♥', d: '♦', c: '♣', s: '♠' };
    var SUIT_CLASS = { h: 'fpk-suit-h', d: 'fpk-suit-d', c: 'fpk-suit-c', s: 'fpk-suit-s' };
    var suit = SUIT_SYMBOLS[suitChar] || suitChar;
    var cls = SUIT_CLASS[suitChar] || '';
    return '<span class="' + cls + '">' + rank + suit + '</span>';
  }

  // Psyche 拦截事件 → 游戏消息（让玩家看到技能生效）
  function _showPsycheMessages(events) {
    if (!events || events.length === 0) return;
    const TYPE_CN = { clarity: '澄澈', refraction: '折射', reversal: '真理', curse: '凶' };
    for (const ev of events) {
      const arbiterCn = TYPE_CN[ev.arbiterType] || ev.arbiterType;
      if (ev.action === 'convert') {
        updateMsg('[' + arbiterCn + '] 拦截了 ' + ev.targetOwner + ' 的诅咒并转化为幸运!');
        logEvent('PSYCHE_INTERCEPT', { arbiter: arbiterCn, target: ev.targetOwner, action: 'convert', power: ev.convertedPower });
      } else if (ev.action === 'nullify') {
        updateMsg('[' + arbiterCn + '] 消除了 ' + ev.targetOwner + ' 的诅咒!');
        logEvent('PSYCHE_INTERCEPT', { arbiter: arbiterCn, target: ev.targetOwner, action: 'nullify' });
      } else if (ev.action === 'whiff') {
        updateMsg('[' + arbiterCn + '] 未感知到敌方诅咒...');
        logEvent('PSYCHE_INTERCEPT', { arbiter: arbiterCn, action: 'whiff' });
      }
    }
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
      // dealerIndex = BTN 座位的玩家索引
      var btnIdx = gameState.players.findIndex(function(p) { return p.seat === 'BTN'; });
      gameState.dealerIndex = btnIdx >= 0 ? btnIdx : 0;
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

    // 快照 hero 开始筹码（用于 funds_delta 计算）
    var heroPlayer = gameState.players.find(function(p) { return p.type === 'human'; });
    _heroStartChips = heroPlayer ? heroPlayer.chips : 0;

    // 诊断日志：玩家排列
    console.log('[GAME] 玩家列表:', gameState.players.map(function(p, i) {
      return '#' + i + ' ' + p.name + ' (' + p.type + ') seat=' + p.seat + ' chips=' + p.chips;
    }).join(' | '));
    console.log('[GAME] heroIndex=' + getHeroIndex() + ', dealerIndex=' + gameState.dealerIndex);
    
    // 渲染座位
    renderSeats();
    updateDealerButton();
    assignPositions();
    updatePositionBadges();
    skillUI.updateDisplay();
    
    // 收取盲注
    postBlinds();
    
    // 发牌
    setTimeout(() => {
      dealHoleCards();
    }, 300);
    
    UI.btnDeal.disabled = true;
    setGameActive(true);
    dismissSplash();
    dismissEndhandModal();
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
    updateMsg(`Blinds: SB ${Currency.htmlAmount(getSmallBlind())} / BB ${Currency.htmlAmount(getBigBlind())}`);
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
      board: gameState.board,
      blinds: getBigBlind()
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
    
    _lastResultMsg = `${winner.name} wins ${Currency.compact(potWon)}`;
    updateMsg(`${winner.name} wins ${Currency.html(potWon)}!`);
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
    
    const handDescr = winnerPlayers[0].seatElement.querySelector('.seat-status').textContent;
    if (winnerPlayers.length === 1) {
      _lastResultMsg = `${winnerNames} wins ${Currency.compact(potWon)}\n${handDescr}`;
      updateMsg(`${winnerNames} wins ${Currency.html(potWon)}!`);
    } else {
      _lastResultMsg = `Split pot: ${winnerNames}\n${Currency.compact(sharePerWinner)} each — ${handDescr}`;
      updateMsg(`Split pot: ${winnerNames} (${Currency.html(sharePerWinner)} each)`);
    }
    
    updatePotDisplay();
    setTimeout(endGame, 3000);
  }

  function endGame() {
    gameState.phase = 'idle';
    setTurnIndicator(-1);
    setGameActive(false);
    
    // 移除winner类
    gameState.players.forEach(p => {
      if (p.seatElement) {
        p.seatElement.classList.remove('winner');
      }
    });
    
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
      const champMsg = champion ? `${champion.name} wins the game!` : 'Game Over';
      if (champion) updateMsg(champMsg);
      showEndhandModal('GAME OVER', champMsg);
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
    showEndhandModal('HAND COMPLETE', _lastResultMsg);
  }

  // ========== 日志系统（委托给 GameLogger） ==========
  const gameLogger = new GameLogger();
  gameLogger.bindUI({
    panel: UI.gameLogPanel,
    content: UI.gameLogContent,
    btnCopy: UI.btnCopyLog,
    btnToggle: null  // 手动绑定 toggle，以便刷新内容
  });
  // LOG 按钮：打开时刷新内容 + context
  if (UI.btnToggleLog) {
    UI.btnToggleLog.addEventListener('click', function () {
      if (UI.gameLogPanel.style.display === 'none' || !UI.gameLogPanel.style.display) {
        showGameLog();
      } else {
        UI.gameLogPanel.style.display = 'none';
      }
    });
  }
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

  function buildLogContext() {
    var maxPot = 0;
    gameLogger.entries.forEach(function (e) {
      if (e.pot > maxPot) maxPot = e.pot;
    });
    // 收集 mana 信息
    var heroMana = skillSystem.getMana(0);

    // 计算 hero 资金变化
    var heroP = gameState.players.find(function(p) { return p.type === 'human'; });
    var heroEndChips = heroP ? heroP.chips : 0;
    var fundsDelta = heroEndChips - _heroStartChips;

    return {
      playerCount: gameState.players.length,
      playerNames: gameState.players.map(function (p) { return p.name; }),
      players: gameState.players.map(function (p) {
        return {
          name: p.name,
          chips: p.chips,
          cardsStr: p.cards && p.cards.length > 0 ? cardsToString(p.cards) : '[unknown]'
        };
      }),
      boardStr: cardsToString(gameState.board),
      initialChips: getInitialChips(),
      smallBlind: getSmallBlind(),
      bigBlind: getBigBlind(),
      maxPot: maxPot,
      heroMana: heroMana,
      fundsDelta: fundsDelta,
      fundsUp: fundsDelta > 0 ? fundsDelta : 0,
      fundsDown: fundsDelta < 0 ? -fundsDelta : 0
    };
  }

  function showGameLog() {
    gameLogger.show(buildLogContext());
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
    UI.raiseAmountDisplay.innerHTML = Currency.htmlAmount(parseInt(this.value));
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

    // 在 iframe 中运行时，配置始终由主引擎通过 postMessage 提供
    // 不自己 fetch game-config.json，避免竞争
    if (window.parent && window.parent !== window) {
      console.log('[CONFIG] 在 iframe 中运行，等待主引擎 postMessage 配置');
      return;
    }

    // 独立运行时：加载本地 game-config.json
    const configPaths = ['../../game-config.json', 'game-config.json'];
    
    for (const path of configPaths) {
      if (_externalConfigApplied) return;
      try {
        const response = await fetch(path);
        if (_externalConfigApplied) return;
        if (response.ok) {
          gameConfig = await response.json();
          _configSource = 'static';
          console.log('[CONFIG] 从', path, '加载:', gameConfig);
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
  function applyExternalConfig(config, source) {
    if (!config) return;
    source = source || 'static';
    // 已有配置 → 拒绝重复应用（无论来源）
    if (_externalConfigApplied) {
      console.log('[CONFIG] 配置已应用，忽略重复 [' + source + ']');
      return;
    }
    gameConfig = config;
    _externalConfigApplied = true;
    _configSource = source;
    console.log('[CONFIG] 外部配置已应用 [' + source + ']:', config);
    // 注册技能 + 生成UI
    skillUI.registerFromConfig(config);
  }

  // ========== postMessage 监听 ==========
  // 接收来自主引擎 (index.html) 的配置数据
  window.addEventListener('message', function (event) {
    const msg = event?.data;
    if (!msg || msg.type !== 'acezero-game-data') return;
    const source = msg.source || 'static';
    console.log('[CONFIG] 收到主引擎 postMessage 配置 [' + source + ']');
    applyExternalConfig(msg.payload, source);
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
