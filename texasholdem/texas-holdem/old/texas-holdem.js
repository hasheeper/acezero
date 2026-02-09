/* global Deck, Hand, PokerAI */

(function () {
  'use strict';

  const SUIT_TRANSLATE = {0: 's', 1: 'h', 2: 'c', 3: 'd'};
  const RANK_TRANSLATE = {1: 'A', 2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: 'T', 11: 'J', 12: 'Q', 13: 'K'};

  // ========== UI元素 ==========
  const UI = {
    deckMount: document.getElementById('deck-mount'),
    playerZone: document.getElementById('player-cards'),
    oppZone: document.getElementById('opponent-cards'),
    boardZone: document.getElementById('community-cards'),
    txtOpponent: document.getElementById('opponent-status'),
    txtBoard: document.getElementById('game-message'),
    txtPlayer: document.getElementById('player-hand-info'),
    zoneOpponent: document.getElementById('zone-opponent'),
    zonePlayer: document.getElementById('zone-player'),
    // 筹码显示
    playerChips: document.getElementById('player-chips'),
    opponentChips: document.getElementById('opponent-chips'),
    potAmount: document.getElementById('pot-amount'),
    potContainer: document.querySelector('.pot-container'),
    toCallAmount: document.getElementById('to-call-amount'),
    // Dealer Button
    dealerPlayer: document.getElementById('dealer-player'),
    dealerOpponent: document.getElementById('dealer-opponent'),
    // Bet Chips Visualization
    playerBetChips: document.getElementById('player-bet-chips'),
    opponentBetChips: document.getElementById('opponent-bet-chips'),
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
    gameLogContent: document.getElementById('game-log-content')
  };

  // ========== 游戏状态 ==========
  let deckLib = null;
  let ai = null;
  let gameLog = [];  // 游戏日志数组

  const INITIAL_CHIPS = 1000;
  const BIG_BLIND = 20;
  const SMALL_BLIND = 10;

  let gameState = {
    player: [],
    opponent: [],
    board: [],
    phase: 'idle',           // idle, preflop, flop, turn, river, showdown
    bettingState: 'waiting', // waiting, player_turn, opponent_turn, resolved
    // 筹码系统
    playerChips: INITIAL_CHIPS,
    opponentChips: INITIAL_CHIPS,
    pot: 0,
    playerBet: 0,    // 本轮玩家已下注
    opponentBet: 0,  // 本轮对手已下注
    toCall: 0,       // 玩家需要跟注的金额
    minRaise: BIG_BLIND,
    lastAggressor: null,  // 最后加注者
    dealerPosition: 'player'  // 庄家位置: 'player' or 'opponent'
  };

  // ========== 工具函数 ==========
  function cardToSolverString(card) {
    if (!card) return '';
    return RANK_TRANSLATE[card.rank] + SUIT_TRANSLATE[card.suit];
  }

  function cardsToString(cards) {
    return cards.map(cardToSolverString).join(' ');
  }

  function updateChipsDisplay() {
    // 新UI结构：readout元素内有<span>$</span>前缀，需要用innerHTML
    UI.playerChips.innerHTML = '<span>$</span>' + gameState.playerChips.toLocaleString();
    UI.opponentChips.innerHTML = '<span>$</span>' + gameState.opponentChips.toLocaleString();
    UI.potAmount.textContent = (gameState.pot + gameState.playerBet + gameState.opponentBet);
    UI.toCallAmount.textContent = '$' + gameState.toCall;
    
    // 更新下注筹码可视化
    updateBetChipsDisplay();
  }

  function updateBetChipsDisplay() {
    // 玩家下注筹码
    if (gameState.playerBet > 0) {
      UI.playerBetChips.style.display = 'flex';
      UI.playerBetChips.querySelector('.chip-amount').textContent = '$' + gameState.playerBet;
    } else {
      UI.playerBetChips.style.display = 'none';
    }
    
    // 对手下注筹码
    if (gameState.opponentBet > 0) {
      UI.opponentBetChips.style.display = 'flex';
      UI.opponentBetChips.querySelector('.chip-amount').textContent = '$' + gameState.opponentBet;
    } else {
      UI.opponentBetChips.style.display = 'none';
    }
  }

  function updateDealerButton() {
    // 显示庄家按钮
    if (gameState.dealerPosition === 'player') {
      UI.dealerPlayer.style.display = 'flex';
      UI.dealerOpponent.style.display = 'none';
    } else {
      UI.dealerPlayer.style.display = 'none';
      UI.dealerOpponent.style.display = 'flex';
    }
  }

  function setTurnIndicator(who) {
    // 移除所有turn-active类
    UI.zonePlayer.classList.remove('turn-active', 'opponent-turn');
    UI.zoneOpponent.classList.remove('turn-active', 'opponent-turn');
    
    // 添加呼吸灯效果
    if (who === 'player') {
      UI.zonePlayer.classList.add('turn-active');
    } else if (who === 'opponent') {
      UI.zoneOpponent.classList.add('turn-active', 'opponent-turn');
    }
  }

  function animateChipsToCenter() {
    // 筹码飞向中心动画
    if (gameState.playerBet > 0) {
      UI.playerBetChips.classList.add('flying');
    }
    if (gameState.opponentBet > 0) {
      UI.opponentBetChips.classList.add('flying');
    }
    
    // 底池收集动画
    UI.potContainer.classList.add('collecting');
    
    setTimeout(() => {
      UI.playerBetChips.classList.remove('flying');
      UI.opponentBetChips.classList.remove('flying');
      UI.potContainer.classList.remove('collecting');
    }, 800);
  }

  function updateMsg(who, text) {
    if (who === 'player') UI.txtPlayer.textContent = text;
    else if (who === 'board') UI.txtBoard.textContent = text;
    else if (who === 'opp') UI.txtOpponent.textContent = text;
  }

  // ========== 日志系统 ==========
  function logEvent(type, data) {
    const timestamp = new Date().toISOString().substr(11, 8);
    // 计算有效底池 = 已收集的pot + 当前轮未收集的bet
    const effectivePot = gameState.pot + gameState.playerBet + gameState.opponentBet;
    const entry = {
      time: timestamp,
      type: type,
      phase: gameState.phase,
      pot: effectivePot,  // 显示有效底池
      playerChips: gameState.playerChips,
      opponentChips: gameState.opponentChips,
      ...data
    };
    gameLog.push(entry);
  }

  function generateLogText() {
    const lines = [];
    lines.push('═══════════════════════════════════════════════════════════');
    lines.push('TEXAS HOLD\'EM GAME LOG');
    lines.push('Generated: ' + new Date().toLocaleString());
    lines.push('═══════════════════════════════════════════════════════════');
    lines.push('');
    
    // 游戏设置
    lines.push('【GAME SETTINGS】');
    lines.push('  Initial Chips: $' + INITIAL_CHIPS);
    lines.push('  Blinds: SB $' + SMALL_BLIND + ' / BB $' + BIG_BLIND);
    lines.push('');
    
    // 最终手牌信息
    lines.push('【FINAL HANDS】');
    lines.push('  Player Hole Cards: ' + cardsToString(gameState.player));
    lines.push('  Opponent Hole Cards: ' + cardsToString(gameState.opponent));
    lines.push('  Community Board: ' + cardsToString(gameState.board));
    lines.push('');
    
    // 详细行动日志
    lines.push('【ACTION LOG】');
    lines.push('───────────────────────────────────────────────────────────');
    
    let currentPhase = '';
    for (const entry of gameLog) {
      // 阶段分隔
      if (entry.phase !== currentPhase) {
        currentPhase = entry.phase;
        lines.push('');
        lines.push('▶ ' + currentPhase.toUpperCase() + ' PHASE');
        lines.push('  Pot: $' + entry.pot + ' | Player: $' + entry.playerChips + ' | Opponent: $' + entry.opponentChips);
      }
      
      // 行动详情
      switch (entry.type) {
        case 'DEAL':
          lines.push('  [DEAL] Player receives: ' + entry.playerCards);
          lines.push('         Opponent receives: [hidden]');
          break;
        case 'BLINDS':
          lines.push('  [BLINDS] Player posts SB $' + SMALL_BLIND + ', Opponent posts BB $' + BIG_BLIND);
          break;
        case 'PLAYER_FOLD':
          lines.push('  [PLAYER] FOLD - Surrenders pot');
          break;
        case 'PLAYER_CHECK':
          lines.push('  [PLAYER] CHECK');
          break;
        case 'PLAYER_CALL':
          lines.push('  [PLAYER] CALL $' + entry.amount);
          break;
        case 'PLAYER_RAISE':
          lines.push('  [PLAYER] RAISE $' + entry.amount + ' (Total bet: $' + entry.totalBet + ')');
          break;
        case 'OPPONENT_FOLD':
          lines.push('  [OPPONENT] FOLD - Surrenders pot');
          break;
        case 'OPPONENT_CHECK':
          lines.push('  [OPPONENT] CHECK');
          break;
        case 'OPPONENT_CALL':
          lines.push('  [OPPONENT] CALL $' + entry.amount);
          break;
        case 'OPPONENT_RAISE':
          lines.push('  [OPPONENT] RAISE $' + entry.amount + ' (Total bet: $' + entry.totalBet + ')');
          break;
        case 'FLOP':
          lines.push('  [BOARD] Flop dealt: ' + entry.cards);
          break;
        case 'TURN':
          lines.push('  [BOARD] Turn dealt: ' + entry.card + ' (Board: ' + entry.board + ')');
          break;
        case 'RIVER':
          lines.push('  [BOARD] River dealt: ' + entry.card + ' (Board: ' + entry.board + ')');
          break;
        case 'SHOWDOWN':
          lines.push('');
          lines.push('▶ SHOWDOWN');
          lines.push('  Player hand: ' + entry.playerHand + ' (' + entry.playerDescr + ')');
          lines.push('  Opponent hand: ' + entry.opponentHand + ' (' + entry.opponentDescr + ')');
          break;
        case 'RESULT':
          lines.push('');
          lines.push('【RESULT】');
          lines.push('  Winner: ' + entry.winner);
          lines.push('  Pot won: $' + entry.potWon);
          lines.push('  Final chips - Player: $' + entry.finalPlayerChips + ' | Opponent: $' + entry.finalOpponentChips);
          break;
      }
    }
    
    lines.push('');
    lines.push('═══════════════════════════════════════════════════════════');
    lines.push('END OF LOG');
    lines.push('═══════════════════════════════════════════════════════════');
    
    return lines.join('\n');
  }

  function showGameLog() {
    const logText = generateLogText();
    UI.gameLogContent.textContent = logText;
    UI.gameLogPanel.style.display = 'block';
    UI.btnCopyLog.style.display = 'inline-block';
  }

  function copyGameLog() {
    const logText = generateLogText();
    navigator.clipboard.writeText(logText).then(() => {
      UI.btnCopyLog.textContent = '✓ Copied!';
      setTimeout(() => {
        UI.btnCopyLog.textContent = '📋 Copy Game Log';
      }, 2000);
    }).catch(err => {
      console.error('Failed to copy:', err);
      // Fallback: select text
      UI.gameLogContent.select && UI.gameLogContent.select();
    });
  }

  function toggleLogPanel() {
    if (UI.gameLogPanel.style.display === 'none') {
      UI.gameLogPanel.style.display = 'block';
      UI.btnToggleLog.textContent = 'Hide';
    } else {
      UI.gameLogPanel.style.display = 'none';
      UI.btnToggleLog.textContent = 'Show';
    }
  }

  function setBettingButtonsEnabled(enabled) {
    UI.btnFold.disabled = !enabled;
    UI.btnCheckCall.disabled = !enabled;
    UI.btnRaise.disabled = !enabled;
  }

  function updateBettingUI() {
    const canAct = gameState.bettingState === 'player_turn';
    setBettingButtonsEnabled(canAct);
    
    if (gameState.toCall === 0) {
      UI.btnCheckCall.textContent = 'CHECK';
    } else {
      UI.btnCheckCall.textContent = 'CALL $' + gameState.toCall;
    }
    
    // 更新加注滑块范围
    const maxRaise = gameState.playerChips;
    const minRaise = Math.min(gameState.minRaise, maxRaise);
    UI.raiseSlider.min = minRaise;
    UI.raiseSlider.max = maxRaise;
    UI.raiseSlider.value = minRaise;
    UI.raiseAmountDisplay.textContent = '$' + minRaise;
    
    updateChipsDisplay();
  }

  // ========== 发牌动画 ==========
  function distributeCard(targetArray, targetDom, faceUp, delay, cardIndex) {
    return new Promise((resolve) => {
      if (!deckLib || !deckLib.cards.length) {
        resolve();
        return;
      }
      const card = deckLib.cards.pop();
      targetArray.push(card);

      const wrapperRect = document.getElementById('deck-wrapper').getBoundingClientRect();
      const targetRect = targetDom.getBoundingClientRect();
      
      const cardWidth = 90;  // 放大50%: 60 -> 90
      const gap = 12;        // 间距也相应放大: 8 -> 12
      
      const totalCards = cardIndex + 1;
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
          targetDom.appendChild(card.$el);
          card.$el.classList.add('aligned-card');
          card.$el.style.transform = 'none';
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

    UI.playerZone.innerHTML = '';
    UI.oppZone.innerHTML = '';
    
    // 重新添加幽灵卡槽
    UI.boardZone.innerHTML = `
      <div class="ghost-card"></div>
      <div class="ghost-card"></div>
      <div class="ghost-card"></div>
      <div class="ghost-card"></div>
      <div class="ghost-card"></div>
    `;

    UI.zoneOpponent.classList.remove('player-game-win', 'turn-active', 'opponent-turn');
    UI.zonePlayer.classList.remove('player-game-win', 'turn-active', 'opponent-turn');
    UI.raiseControls.style.display = 'none';
    UI.playerBetChips.style.display = 'none';
    UI.opponentBetChips.style.display = 'none';

    updateMsg('player', 'Waiting...');
    updateMsg('board', '');
    updateMsg('opp', '');
  }

  function startNewGame() {
    initTable();
    
    // 清空日志并隐藏日志面板
    gameLog = [];
    UI.gameLogPanel.style.display = 'none';
    UI.btnCopyLog.style.display = 'none';
    
    // 初始化AI
    ai = new PokerAI(PokerAI.LEVELS.MEDIUM);
    
    // 切换庄家位置
    const previousDealer = gameState.dealerPosition;
    const newDealer = previousDealer === 'player' ? 'opponent' : 'player';
    
    // 重置游戏状态
    gameState = {
      player: [],
      opponent: [],
      board: [],
      phase: 'preflop',
      bettingState: 'waiting',
      playerChips: gameState.playerChips,  // 保留上局筹码
      opponentChips: gameState.opponentChips,
      pot: 0,
      playerBet: 0,
      opponentBet: 0,
      toCall: 0,
      minRaise: BIG_BLIND,
      lastAggressor: null,
      dealerPosition: newDealer
    };
    
    // 更新庄家按钮显示
    updateDealerButton();
    
    // 收取盲注
    postBlinds();
    
    // 发牌
    setTimeout(() => {
      const promises = [];
      promises.push(distributeCard(gameState.player, UI.playerZone, true, 0, 0));
      promises.push(distributeCard(gameState.player, UI.playerZone, true, 200, 1));
      promises.push(distributeCard(gameState.opponent, UI.oppZone, false, 400, 0));
      promises.push(distributeCard(gameState.opponent, UI.oppZone, false, 600, 1));
      
      Promise.all(promises).then(() => {
        // 记录发牌日志
        logEvent('DEAL', { playerCards: cardsToString(gameState.player) });
        calculateHandStrength();
        startBettingRound();
      });
    }, 300);
    
    UI.btnDeal.disabled = true;
    updateChipsDisplay();
  }

  function postBlinds() {
    // 玩家付小盲
    gameState.playerChips -= SMALL_BLIND;
    gameState.playerBet = SMALL_BLIND;
    
    // 对手付大盲
    gameState.opponentChips -= BIG_BLIND;
    gameState.opponentBet = BIG_BLIND;
    
    // 注意：pot初始为0，盲注在playerBet/opponentBet中
    // 只有在collectBetsIntoPot时才会加入pot
    gameState.pot = 0;
    gameState.toCall = BIG_BLIND - SMALL_BLIND;
    gameState.minRaise = BIG_BLIND;
    
    logEvent('BLINDS', {});
    updateMsg('board', 'Blinds posted: SB $' + SMALL_BLIND + ' / BB $' + BIG_BLIND);
  }

  function startBettingRound() {
    // Heads-Up规则：
    // Preflop: SB(玩家)先行动
    // Post-flop: BB(对手)先行动
    if (gameState.phase === 'preflop') {
      // Preflop: 玩家(SB)先行动
      gameState.bettingState = 'player_turn';
      setTurnIndicator('player');
      updateMsg('board', 'Your turn - ' + gameState.phase.toUpperCase());
      updateBettingUI();
    } else {
      // Post-flop: 对手(BB)先行动
      gameState.bettingState = 'opponent_turn';
      setTurnIndicator('opponent');
      updateMsg('board', 'Opponent\'s turn - ' + gameState.phase.toUpperCase());
      setBettingButtonsEnabled(false);
      setTimeout(opponentAct, 800);
    }
  }

  function collectBetsIntoPot() {
    // 播放筹码飞向中心动画
    if (gameState.playerBet > 0 || gameState.opponentBet > 0) {
      animateChipsToCenter();
    }
    
    // 延迟收集筹码，让动画播放完成
    setTimeout(() => {
      gameState.pot += gameState.playerBet + gameState.opponentBet;
      gameState.playerBet = 0;
      gameState.opponentBet = 0;
      gameState.toCall = 0;
      updateChipsDisplay();
    }, 600);
  }

  // ========== 玩家操作 ==========
  function playerFold() {
    logEvent('PLAYER_FOLD', {});
    gameState.bettingState = 'resolved';
    setBettingButtonsEnabled(false);
    
    // 对手赢得底池
    const potWon = gameState.pot;
    gameState.opponentChips += gameState.pot;
    gameState.pot = 0;
    
    logEvent('RESULT', {
      winner: 'Opponent (Player folded)',
      potWon: potWon,
      finalPlayerChips: gameState.playerChips,
      finalOpponentChips: gameState.opponentChips
    });
    
    updateMsg('board', 'You folded. Opponent wins!');
    UI.zoneOpponent.classList.add('player-game-win');
    
    endGame();
  }

  function playerCheckCall() {
    UI.raiseControls.style.display = 'none';
    setTurnIndicator(null);
    
    if (gameState.toCall > 0) {
      // Call
      const callAmount = Math.min(gameState.toCall, gameState.playerChips);
      gameState.playerChips -= callAmount;
      gameState.playerBet += callAmount;
      logEvent('PLAYER_CALL', { amount: callAmount });
      updateMsg('board', 'You call $' + callAmount);
    } else {
      // Check
      logEvent('PLAYER_CHECK', {});
      updateMsg('board', 'You check');
    }
    
    gameState.toCall = 0;
    updateChipsDisplay();
    
    // 检查是否结束本轮下注
    // Preflop特殊处理：玩家call后，BB(对手)还有option权
    if (gameState.phase === 'preflop') {
      if (gameState.lastAggressor === null) {
        // Preflop且没人加注过，BB有option权
        gameState.bettingState = 'opponent_turn';
        setTurnIndicator('opponent');
        setBettingButtonsEnabled(false);
        setTimeout(opponentAct, 800);
      } else if (gameState.lastAggressor === 'opponent') {
        // 对手加注过，玩家call后结束本轮
        endBettingRound();
      } else {
        // 玩家加注过，对手需要响应（不应该到这里）
        endBettingRound();
      }
    } else {
      // Post-flop: 对手先行动，所以玩家是后手
      if (gameState.lastAggressor === 'opponent') {
        // 对手加注过，玩家call后结束本轮
        endBettingRound();
      } else {
        // 对手check过，玩家也check，结束本轮
        endBettingRound();
      }
    }
  }

  function playerRaise() {
    // 显示加注控制
    UI.raiseControls.style.display = 'flex';
  }

  function confirmRaise() {
    const raiseAmount = parseInt(UI.raiseSlider.value);
    
    // 先跟注
    if (gameState.toCall > 0) {
      gameState.playerChips -= gameState.toCall;
      gameState.playerBet += gameState.toCall;
    }
    
    // 再加注
    gameState.playerChips -= raiseAmount;
    gameState.playerBet += raiseAmount;
    gameState.toCall = raiseAmount;
    gameState.minRaise = raiseAmount;
    gameState.lastAggressor = 'player';
    
    logEvent('PLAYER_RAISE', { amount: raiseAmount, totalBet: gameState.playerBet });
    
    UI.raiseControls.style.display = 'none';
    setTurnIndicator(null);
    updateMsg('board', 'You raise $' + raiseAmount);
    updateChipsDisplay();
    
    // 轮到对手
    gameState.bettingState = 'opponent_turn';
    setTurnIndicator('opponent');
    setBettingButtonsEnabled(false);
    setTimeout(opponentAct, 800);
  }

  // ========== AI操作 ==========
  function opponentAct() {
    const context = {
      holeCards: gameState.opponent,
      boardCards: gameState.board,
      pot: gameState.pot + gameState.playerBet + gameState.opponentBet,
      toCall: gameState.toCall,
      aiStack: gameState.opponentChips,
      playerStack: gameState.playerChips,
      phase: gameState.phase,
      minRaise: gameState.minRaise
    };
    
    const decision = ai.decide(context);
    
    switch (decision.action) {
      case PokerAI.ACTIONS.FOLD:
        opponentFold();
        break;
      case PokerAI.ACTIONS.CHECK:
        opponentCheck();
        break;
      case PokerAI.ACTIONS.CALL:
        opponentCall(decision.amount);
        break;
      case PokerAI.ACTIONS.RAISE:
      case PokerAI.ACTIONS.ALL_IN:
        opponentRaise(decision.amount);
        break;
    }
  }

  function opponentFold() {
    logEvent('OPPONENT_FOLD', {});
    gameState.bettingState = 'resolved';
    
    // 玩家赢得底池
    const potWon = gameState.pot + gameState.playerBet + gameState.opponentBet;
    gameState.playerChips += potWon;
    gameState.pot = 0;
    gameState.playerBet = 0;
    gameState.opponentBet = 0;
    
    logEvent('RESULT', {
      winner: 'Player (Opponent folded)',
      potWon: potWon,
      finalPlayerChips: gameState.playerChips,
      finalOpponentChips: gameState.opponentChips
    });
    
    updateMsg('opp', 'Fold');
    updateMsg('board', 'Opponent folds. You win!');
    UI.zonePlayer.classList.add('player-game-win');
    
    endGame();
  }

  function opponentCheck() {
    logEvent('OPPONENT_CHECK', {});
    updateMsg('opp', 'Check');
    setTurnIndicator(null);
    
    // Preflop时BB check = 使用option权不加注，结束本轮
    // Post-flop时：
    //   - 如果玩家是最后加注者，结束本轮
    //   - 如果没人加注过，轮到玩家
    if (gameState.phase === 'preflop') {
      // BB使用option权check，结束preflop
      endBettingRound();
    } else if (gameState.lastAggressor === 'player') {
      endBettingRound();
    } else {
      // Post-flop: 对手先check，轮到玩家
      gameState.bettingState = 'player_turn';
      setTurnIndicator('player');
      updateBettingUI();
    }
  }

  function opponentCall(amount) {
    const callAmount = Math.min(amount, gameState.opponentChips);
    gameState.opponentChips -= callAmount;
    gameState.opponentBet += callAmount;
    gameState.toCall = 0;
    
    logEvent('OPPONENT_CALL', { amount: callAmount });
    updateMsg('opp', 'Call $' + callAmount);
    updateChipsDisplay();
    
    // 对手call玩家的加注，结束本轮
    endBettingRound();
  }

  function opponentRaise(amount) {
    // 先跟注
    if (gameState.toCall > 0) {
      const callAmount = Math.min(gameState.toCall, gameState.opponentChips);
      gameState.opponentChips -= callAmount;
      gameState.opponentBet += callAmount;
    }
    
    // 再加注
    const raiseAmount = Math.min(amount, gameState.opponentChips);
    gameState.opponentChips -= raiseAmount;
    gameState.opponentBet += raiseAmount;
    gameState.toCall = raiseAmount;
    gameState.minRaise = raiseAmount;
    gameState.lastAggressor = 'opponent';
    
    logEvent('OPPONENT_RAISE', { amount: raiseAmount, totalBet: gameState.opponentBet });
    updateMsg('opp', 'Raise $' + raiseAmount);
    setTurnIndicator(null);
    updateChipsDisplay();
    
    // 轮到玩家
    gameState.bettingState = 'player_turn';
    setTurnIndicator('player');
    updateBettingUI();
  }

  // ========== 回合控制 ==========
  function endBettingRound() {
    collectBetsIntoPot();
    gameState.lastAggressor = null;
    
    // 进入下一阶段
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
  }

  function dealFlop() {
    gameState.phase = 'flop';
    const promises = [];
    promises.push(distributeCard(gameState.board, UI.boardZone, true, 0, 0));
    promises.push(distributeCard(gameState.board, UI.boardZone, true, 200, 1));
    promises.push(distributeCard(gameState.board, UI.boardZone, true, 400, 2));
    
    Promise.all(promises).then(() => {
      logEvent('FLOP', { cards: cardsToString(gameState.board) });
      calculateHandStrength();
      startBettingRound();
    });
  }

  function dealTurn() {
    gameState.phase = 'turn';
    distributeCard(gameState.board, UI.boardZone, true, 0, 3).then(() => {
      const turnCard = gameState.board[3];
      logEvent('TURN', { card: cardToSolverString(turnCard), board: cardsToString(gameState.board) });
      calculateHandStrength();
      startBettingRound();
    });
  }

  function dealRiver() {
    gameState.phase = 'river';
    distributeCard(gameState.board, UI.boardZone, true, 0, 4).then(() => {
      const riverCard = gameState.board[4];
      logEvent('RIVER', { card: cardToSolverString(riverCard), board: cardsToString(gameState.board) });
      calculateHandStrength();
      startBettingRound();
    });
  }

  function showdown() {
    gameState.phase = 'showdown';
    gameState.bettingState = 'resolved';
    setBettingButtonsEnabled(false);
    
    // 翻开对手的牌
    gameState.opponent.forEach(card => card.setSide('front'));
    
    decideWinner();
  }

  function calculateHandStrength() {
    if (!gameState.player.length) return;
    
    const playerStrings = gameState.player.map(cardToSolverString);
    const boardStrings = gameState.board.map(cardToSolverString);
    let descriptor = playerStrings.join(' ');

    if (playerStrings.length + boardStrings.length >= 5) {
      try {
        const hand = Hand.solve([...playerStrings, ...boardStrings]);
        descriptor = hand.descr;
      } catch (error) {
        descriptor = '...';
      }
    }

    updateMsg('player', descriptor);
  }

  function decideWinner() {
    const playerStrings = gameState.player.map(cardToSolverString);
    const opponentStrings = gameState.opponent.map(cardToSolverString);
    const boardStrings = gameState.board.map(cardToSolverString);

    try {
      const playerHand = Hand.solve([...playerStrings, ...boardStrings]);
      const opponentHand = Hand.solve([...opponentStrings, ...boardStrings]);
      const winners = Hand.winners([playerHand, opponentHand]);

      // 记录showdown日志
      logEvent('SHOWDOWN', {
        playerHand: cardsToString(gameState.player),
        playerDescr: playerHand.descr,
        opponentHand: cardsToString(gameState.opponent),
        opponentDescr: opponentHand.descr
      });

      updateMsg('player', playerHand.descr);
      updateMsg('opp', opponentHand.descr);

      let winner = '';
      const potWon = gameState.pot;

      if (winners.length === 2) {
        // 平局，分底池
        const half = Math.floor(gameState.pot / 2);
        gameState.playerChips += half;
        gameState.opponentChips += gameState.pot - half;
        winner = 'DRAW (Pot split)';
        updateMsg('board', 'DRAW! Pot split.');
      } else if (winners[0] === playerHand) {
        gameState.playerChips += gameState.pot;
        winner = 'Player (' + playerHand.descr + ')';
        updateMsg('board', 'YOU WIN $' + gameState.pot + '!');
        UI.zonePlayer.classList.add('player-game-win');
      } else {
        gameState.opponentChips += gameState.pot;
        winner = 'Opponent (' + opponentHand.descr + ')';
        updateMsg('board', 'OPPONENT WINS $' + gameState.pot + '!');
        UI.zoneOpponent.classList.add('player-game-win');
      }
      
      // 记录结果日志
      logEvent('RESULT', {
        winner: winner,
        potWon: potWon,
        finalPlayerChips: gameState.playerChips,
        finalOpponentChips: gameState.opponentChips
      });
      
      gameState.pot = 0;
      endGame();
    } catch (error) {
      updateMsg('board', 'Evaluation error');
    }
  }

  function endGame() {
    gameState.phase = 'idle';
    setTurnIndicator(null);
    updateChipsDisplay();
    UI.btnDeal.disabled = false;
    
    // 显示游戏日志
    showGameLog();
    
    // 检查是否有人破产
    if (gameState.playerChips <= 0) {
      updateMsg('board', 'GAME OVER - You are broke!');
      gameState.playerChips = INITIAL_CHIPS;
      gameState.opponentChips = INITIAL_CHIPS;
    } else if (gameState.opponentChips <= 0) {
      updateMsg('board', 'VICTORY - Opponent is broke!');
      gameState.playerChips = INITIAL_CHIPS;
      gameState.opponentChips = INITIAL_CHIPS;
    }
  }

  // ========== 调试功能 ==========
  function forceNextPhase() {
    collectBetsIntoPot();
    endBettingRound();
  }

  // ========== 事件绑定 ==========
  UI.btnDeal.addEventListener('click', startNewGame);
  UI.btnFold.addEventListener('click', playerFold);
  UI.btnCheckCall.addEventListener('click', playerCheckCall);
  UI.btnRaise.addEventListener('click', playerRaise);
  UI.btnConfirmRaise.addEventListener('click', confirmRaise);
  UI.btnForceNext.addEventListener('click', forceNextPhase);
  UI.btnCopyLog.addEventListener('click', copyGameLog);
  UI.btnToggleLog.addEventListener('click', toggleLogPanel);
  
  UI.raiseSlider.addEventListener('input', function() {
    UI.raiseAmountDisplay.textContent = '$' + this.value;
  });

  // ========== 初始化 ==========
  initTable();
  updateChipsDisplay();
  setBettingButtonsEnabled(false);
})();
