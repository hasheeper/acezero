(function () {
  'use strict';

  var config = null;
  var externalConfigApplied = false;
  var deckLib = null;

  var DEFAULT_CONFIG = {
    blackjack: {
      startingChips: 1000,
      baseBet: 50,
      dealerStandOnSoft17: true
    },
    hero: {
      vanguard: { name: 'PLAYER' }
    }
  };

  var UI = {
    chips: document.getElementById('chips'),
    baseBet: document.getElementById('base-bet'),
    roundCount: document.getElementById('round-count'),
    potAmount: document.getElementById('pot-amount'),
    potClusters: document.getElementById('pot-clusters'),
    dealerScore: document.getElementById('dealer-score'),
    playerScore: document.getElementById('player-score'),
    dealerCards: document.getElementById('dealer-cards'),
    playerCards: document.getElementById('player-cards'),
    playerBetChips: document.getElementById('player-bet-chips'),
    deckMount: document.getElementById('deck-mount'),
    deckWrapper: document.getElementById('deck-wrapper'),
    message: document.getElementById('message'),
    btnNewRound: document.getElementById('btn-new-round'),
    btnHit: document.getElementById('btn-hit'),
    btnStand: document.getElementById('btn-stand'),
    metaPlayer: document.getElementById('meta-player')
  };

  var state = {
    dealer: [],
    player: [],
    dealerVisual: [],
    playerVisual: [],
    chips: 0,
    baseBet: 0,
    currentBet: 0,
    roundCount: 0,
    busy: false,
    phase: 'idle' // idle | player_turn | dealer_turn | round_end
  };

  function cfg() {
    return config || DEFAULT_CONFIG;
  }

  function getBlackjackCfg() {
    return (cfg() && cfg().blackjack) || DEFAULT_CONFIG.blackjack;
  }

  function heroName() {
    var h = cfg().hero;
    if (h && h.vanguard && h.vanguard.name) return h.vanguard.name;
    return 'PLAYER';
  }

  function updateMessage(text, cls) {
    UI.message.textContent = text || '';
    UI.message.classList.remove('win', 'lose');
    if (cls) UI.message.classList.add(cls);
  }

  function cardValue(rank) {
    if (rank === 'A') return 11;
    if (rank === 'K' || rank === 'Q' || rank === 'J') return 10;
    return parseInt(rank, 10);
  }

  function scoreHand(cards) {
    var total = 0;
    var aces = 0;
    for (var i = 0; i < cards.length; i++) {
      var v = cardValue(cards[i].rank);
      total += v;
      if (cards[i].rank === 'A') aces += 1;
    }
    while (total > 21 && aces > 0) {
      total -= 10;
      aces -= 1;
    }
    return total;
  }

  function isSoft17(cards) {
    var total = 0;
    var aces = 0;
    for (var i = 0; i < cards.length; i++) {
      if (cards[i].rank === 'A') {
        total += 11;
        aces += 1;
      } else {
        total += cardValue(cards[i].rank);
      }
    }
    return total === 17 && aces > 0;
  }

  function rankFromDeckCard(card) {
    if (card.rank === 1) return 'A';
    if (card.rank === 11) return 'J';
    if (card.rank === 12) return 'Q';
    if (card.rank === 13) return 'K';
    return String(card.rank);
  }

  function resetVisualCards() {
    [state.dealerVisual, state.playerVisual].forEach(function (arr) {
      arr.forEach(function (card) {
        if (card && card.$el && card.$el.parentNode) {
          card.$el.parentNode.removeChild(card.$el);
        }
      });
      arr.length = 0;
    });
  }

  function initDeckTable() {
    if (deckLib) {
      deckLib.unmount();
      deckLib = null;
    }
    deckLib = Deck();
    deckLib.mount(UI.deckMount);
    deckLib.shuffle();
  }

  function ensureDeckReady() {
    if (!deckLib || !deckLib.cards || deckLib.cards.length === 0) {
      initDeckTable();
    }
  }

  function animateDealTo(targetMount, orderIndex, faceUp, visualStore) {
    return new Promise(function (resolve) {
      ensureDeckReady();
      if (!deckLib || !deckLib.cards.length) {
        resolve(null);
        return;
      }

      var card = deckLib.cards.pop();

      var wrapperRect = UI.deckWrapper.getBoundingClientRect();
      var targetRect = targetMount.getBoundingClientRect();

      var cardWidth = 84;
      var gap = 10;
      var cardIndex = orderIndex;
      var totalCards = orderIndex + 1;
      var totalWidth = totalCards * cardWidth + (totalCards - 1) * gap;
      var startX = targetRect.left + (targetRect.width - totalWidth) / 2;
      var cardFinalX = startX + cardIndex * (cardWidth + gap) + cardWidth / 2;
      var cardFinalY = targetRect.top + targetRect.height / 2;

      var deckCenterX = wrapperRect.left + wrapperRect.width / 2;
      var deckCenterY = wrapperRect.top + wrapperRect.height / 2;

      var deltaX = cardFinalX - deckCenterX;
      var deltaY = cardFinalY - deckCenterY;

      card.animateTo({
        delay: 0,
        duration: 250,
        x: deltaX,
        y: deltaY,
        rot: 0,
        onStart: function () {
          card.$el.style.zIndex = String(9999);
        },
        onComplete: function () {
          card.setSide(faceUp ? 'front' : 'back');
          targetMount.appendChild(card.$el);
          card.$el.classList.add('bj-aligned-card');
          card.$el.style.transform = 'none';
          card.$el.style.position = 'relative';
          card.x = 0;
          card.y = 0;
          visualStore.push(card);
          resolve(card);
        }
      });
    });
  }

  function revealDealerHoleCard() {
    if (state.dealerVisual[1]) {
      state.dealerVisual[1].setSide('front');
    }
  }

  function updateChipVisuals() {
    var pot = state.currentBet || 0;
    if (UI.potAmount) {
      UI.potAmount.innerHTML = window.Currency ? Currency.html(pot) : String(pot);
    }

    if (window.AceZeroChips && UI.potClusters && window.Currency) {
      window.AceZeroChips.renderPotClusters(UI.potClusters, pot, Currency);
    }
  }

  function updateHUD(hideDealerHole) {
    UI.chips.innerHTML = window.Currency ? Currency.html(state.chips) : String(state.chips);
    UI.baseBet.innerHTML = window.Currency ? Currency.htmlAmount(state.baseBet) : String(state.baseBet);
    UI.roundCount.textContent = String(state.roundCount);

    var pScore = scoreHand(state.player);
    UI.playerScore.textContent = String(pScore);

    var dScore = hideDealerHole && state.dealer.length > 0
      ? cardValue(state.dealer[0].rank)
      : scoreHand(state.dealer);
    UI.dealerScore.textContent = String(dScore);

    updateChipVisuals();
  }

  function setActionEnabled(playerTurn) {
    UI.btnHit.disabled = !playerTurn;
    UI.btnStand.disabled = !playerTurn;
  }

  function settleRound() {
    var p = scoreHand(state.player);
    var d = scoreHand(state.dealer);
    var result = '';

    if (p > 21) {
      result = '你爆牌，输掉本局。';
      updateMessage(result, 'lose');
    } else if (d > 21 || p > d) {
      state.chips += state.currentBet * 2;
      result = '你赢了！获得 ' + state.currentBet + ' 筹码。';
      updateMessage(result, 'win');
    } else if (p === d) {
      state.chips += state.currentBet;
      result = '平局，返还下注。';
      updateMessage(result);
    } else {
      result = '庄家胜。';
      updateMessage(result, 'lose');
    }

    if (state.chips <= 0) {
      updateMessage('筹码归零。你可以刷新或调整配置后继续。', 'lose');
      UI.btnNewRound.disabled = true;
    }

    state.currentBet = 0;
    state.phase = 'round_end';
    setActionEnabled(false);
    updateHUD(false);
  }

  async function dealerPlayAndSettle() {
    state.phase = 'dealer_turn';
    state.busy = true;
    revealDealerHoleCard();
    updateHUD(false);

    var bcfg = getBlackjackCfg();
    var standOnSoft17 = bcfg.dealerStandOnSoft17 !== false;

    while (true) {
      var ds = scoreHand(state.dealer);
      if (ds > 21) break;
      if (ds > 17) break;
      if (ds === 17 && standOnSoft17) {
        if (isSoft17(state.dealer)) break;
        break;
      }
      if (ds === 17 && !standOnSoft17 && !isSoft17(state.dealer)) break;

      var dealt = await animateDealTo(UI.dealerCards, state.dealerVisual.length, true, state.dealerVisual);
      if (!dealt) break;
      state.dealer.push({ rank: rankFromDeckCard(dealt) });
      updateHUD(false);
    }

    state.busy = false;
    settleRound();
  }

  async function startRound() {
    if (state.busy || state.phase === 'player_turn') return;
    if (state.chips < state.baseBet) {
      updateMessage('筹码不足，无法开始新局。', 'lose');
      return;
    }

    state.busy = true;
    setActionEnabled(false);
    initDeckTable();
    resetVisualCards();
    state.dealer = [];
    state.player = [];
    state.roundCount += 1;
    state.phase = 'player_turn';

    state.currentBet = state.baseBet;
    state.chips -= state.currentBet;

    var p1 = await animateDealTo(UI.playerCards, state.playerVisual.length, true, state.playerVisual);
    if (p1) state.player.push({ rank: rankFromDeckCard(p1) });
    updateHUD(true);

    var d1 = await animateDealTo(UI.dealerCards, state.dealerVisual.length, true, state.dealerVisual);
    if (d1) state.dealer.push({ rank: rankFromDeckCard(d1) });
    updateHUD(true);

    var p2 = await animateDealTo(UI.playerCards, state.playerVisual.length, true, state.playerVisual);
    if (p2) state.player.push({ rank: rankFromDeckCard(p2) });
    updateHUD(true);

    var d2 = await animateDealTo(UI.dealerCards, state.dealerVisual.length, false, state.dealerVisual);
    if (d2) state.dealer.push({ rank: rankFromDeckCard(d2) });

    updateHUD(true);

    var p = scoreHand(state.player);
    if (p === 21) {
      updateMessage('Blackjack！立即结算。', 'win');
      await dealerPlayAndSettle();
      state.busy = false;
      return;
    }

    state.busy = false;
    setActionEnabled(true);
    updateMessage('你的回合：HIT 要牌，STAND 停牌。');
  }

  async function hit() {
    if (state.phase !== 'player_turn' || state.busy) return;
    state.busy = true;
    setActionEnabled(false);

    var dealt = await animateDealTo(UI.playerCards, state.playerVisual.length, true, state.playerVisual);
    if (dealt) state.player.push({ rank: rankFromDeckCard(dealt) });
    updateHUD(true);

    var p = scoreHand(state.player);
    if (p > 21) {
      state.busy = false;
      settleRound();
      return;
    }

    state.busy = false;
    setActionEnabled(true);
    updateMessage('继续选择：HIT 或 STAND。');
  }

  async function stand() {
    if (state.phase !== 'player_turn' || state.busy) return;
    setActionEnabled(false);
    updateMessage('庄家行动中...');
    await dealerPlayAndSettle();
  }

  function applyExternalConfig(nextConfig) {
    if (!nextConfig || externalConfigApplied) return;
    config = nextConfig;
    externalConfigApplied = true;
    initStateFromConfig();
  }

  async function loadConfig() {
    if (externalConfigApplied) return;
    if (window.parent && window.parent !== window) return;

    var paths = ['../../game-config.json', 'game-config.json'];
    for (var i = 0; i < paths.length; i++) {
      try {
        var resp = await fetch(paths[i]);
        if (resp.ok) {
          config = await resp.json();
          initStateFromConfig();
          return;
        }
      } catch (e) {
        // try next path
      }
    }

    config = DEFAULT_CONFIG;
    initStateFromConfig();
  }

  function requestConfigFromEngine() {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ type: 'acezero-data-request' }, '*');
    }
  }

  function initStateFromConfig() {
    var bcfg = getBlackjackCfg();
    state.baseBet = Math.max(1, Number(bcfg.baseBet) || DEFAULT_CONFIG.blackjack.baseBet);
    state.chips = Math.max(0, Number(bcfg.startingChips) || Number(cfg().chips) || DEFAULT_CONFIG.blackjack.startingChips);
    state.currentBet = 0;
    UI.metaPlayer.textContent = 'PLAYER: ' + heroName();
    UI.btnNewRound.disabled = false;
    setActionEnabled(false);
    initDeckTable();
    resetVisualCards();
    updateHUD(false);
    updateMessage('点击 NEW ROUND 开始 21 点。');
  }

  window.addEventListener('message', function (event) {
    var msg = event && event.data;
    if (!msg || msg.type !== 'acezero-game-data') return;
    applyExternalConfig(msg.payload);
  });

  UI.btnNewRound.addEventListener('click', startRound);
  UI.btnHit.addEventListener('click', hit);
  UI.btnStand.addEventListener('click', stand);

  (async function init() {
    await loadConfig();
    requestConfigFromEngine();
    if (!config) {
      config = DEFAULT_CONFIG;
      initStateFromConfig();
    }
  })();
})();
