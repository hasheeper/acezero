/**
 * Game Logger — 游戏日志系统
 * 《零之王牌》独立日志模块
 *
 * 负责：事件记录、日志格式化、UI面板控制、日志导出
 * 与游戏逻辑完全解耦，通过 log() 接口接收事件。
 */

(function (global) {
  'use strict';

  class GameLogger {
    constructor() {
      this.entries = [];

      // UI 元素引用（延迟绑定）
      this.ui = {
        panel: null,
        content: null,
        btnCopy: null,
        btnToggle: null
      };

      // 游戏状态快照回调（由外部提供）
      // 返回 { phase, pot, players: [{ name, chips, currentBet, cards, isActive }], board }
      this.getGameSnapshot = null;
    }

    // ========== 初始化 ==========

    /**
     * 绑定 UI 元素
     */
    bindUI(elements) {
      this.ui.panel = elements.panel || document.getElementById('game-log-panel');
      this.ui.content = elements.content || document.getElementById('game-log-content');
      this.ui.btnCopy = elements.btnCopy || document.getElementById('btn-copy-log');
      this.ui.btnToggle = elements.btnToggle || document.getElementById('btn-toggle-log');

      // 绑定按钮事件
      if (this.ui.btnCopy) {
        this.ui.btnCopy.addEventListener('click', () => this.copyToClipboard());
      }
      if (this.ui.btnToggle) {
        this.ui.btnToggle.addEventListener('click', () => this.togglePanel());
      }
    }

    // ========== 核心：记录事件 ==========

    /**
     * 记录一条游戏事件
     * @param {string} type - 事件类型 (DEAL, BLINDS, PLAYER_FOLD, AI_CALL, FLOP, RESULT, etc.)
     * @param {object} data - 事件数据
     */
    log(type, data) {
      const snapshot = this.getGameSnapshot ? this.getGameSnapshot() : {};
      const timestamp = new Date().toISOString().substr(11, 8);

      // 计算有效底池
      const players = snapshot.players || [];
      const activeBets = players.reduce((sum, p) => sum + (p.currentBet || 0), 0);
      const effectivePot = (snapshot.pot || 0) + activeBets;

      // 收集筹码信息
      const playerChips = {};
      players.forEach(p => { playerChips[p.name] = p.chips; });

      const entry = {
        time: timestamp,
        type: type,
        phase: snapshot.phase || 'unknown',
        pot: effectivePot,
        chips: playerChips,
        ...data
      };

      this.entries.push(entry);
    }

    /**
     * 清空日志
     */
    clear() {
      this.entries = [];
      if (this.ui.panel) this.ui.panel.style.display = 'none';
      if (this.ui.btnCopy) this.ui.btnCopy.style.display = 'none';
    }

    // ========== 格式化输出 ==========

    /**
     * 生成可读的日志文本
     * @param {object} context - { playerCount, players, board, initialChips, smallBlind, bigBlind }
     * @returns {string}
     */
    generateText(context) {
      context = context || {};
      const lines = [];

      lines.push('═══════════════════════════════════════════════════════════');
      lines.push("TEXAS HOLD'EM GAME LOG - " + (context.playerCount || '?') + ' Players');
      lines.push('Generated: ' + new Date().toLocaleString());
      lines.push('═══════════════════════════════════════════════════════════');
      lines.push('');

      // 游戏设置
      lines.push('【GAME SETTINGS】');
      lines.push('  Initial Chips: $' + (context.initialChips || 1000));
      lines.push('  Blinds: SB $' + (context.smallBlind || 10) + ' / BB $' + (context.bigBlind || 20));
      if (context.playerNames) {
        lines.push('  Players: ' + context.playerNames.join(', '));
      }
      lines.push('');

      // 最终手牌
      if (context.players) {
        lines.push('【FINAL HANDS】');
        context.players.forEach(p => {
          const cardsStr = p.cardsStr || '[unknown]';
          lines.push('  ' + p.name + ': ' + cardsStr);
        });
        if (context.boardStr) {
          lines.push('  Community Board: ' + context.boardStr);
        }
        lines.push('');
      }

      // 详细行动日志
      lines.push('【ACTION LOG】');
      lines.push('───────────────────────────────────────────────────────────');

      let currentPhase = '';
      for (const entry of this.entries) {
        // 阶段分隔
        if (entry.phase !== currentPhase) {
          currentPhase = entry.phase;
          lines.push('');
          lines.push('▶ ' + currentPhase.toUpperCase() + ' PHASE');
          const chipsInfo = Object.entries(entry.chips || {}).map(function (kv) {
            return kv[0] + ': $' + kv[1];
          }).join(' | ');
          lines.push('  Pot: $' + entry.pot + ' | ' + chipsInfo);
        }

        // 行动详情
        lines.push(this._formatEntry(entry));
      }

      lines.push('');
      lines.push('═══════════════════════════════════════════════════════════');
      lines.push('END OF LOG');
      lines.push('═══════════════════════════════════════════════════════════');

      return lines.join('\n');
    }

    /**
     * 格式化单条日志
     */
    _formatEntry(entry) {
      switch (entry.type) {
        case 'DEAL':
          return '  [DEAL] Cards dealt to ' + entry.playerCount + ' players';
        case 'BLINDS':
          return '  [BLINDS] ' + entry.sb + ' posts SB $' + (entry.sbAmount || 10) + ', ' + entry.bb + ' posts BB $' + (entry.bbAmount || 20);
        case 'PLAYER_FOLD':
          return '  [' + entry.playerName + '] FOLD - Surrenders pot';
        case 'PLAYER_CHECK':
          return '  [' + entry.playerName + '] CHECK';
        case 'PLAYER_CALL':
          return '  [' + entry.playerName + '] CALL $' + entry.amount;
        case 'PLAYER_BET':
          return '  [' + entry.playerName + '] BET $' + entry.amount;
        case 'PLAYER_RAISE':
          return '  [' + entry.playerName + '] RAISE $' + entry.amount + ' (Total bet: $' + entry.totalBet + ')';
        case 'AI_BET':
          return '  [' + entry.playerName + '] BET $' + entry.amount;
        case 'AI_FOLD':
          return '  [' + entry.playerName + '] FOLD - Surrenders pot';
        case 'AI_CHECK':
          return '  [' + entry.playerName + '] CHECK';
        case 'AI_CALL':
          return '  [' + entry.playerName + '] CALL $' + entry.amount;
        case 'AI_RAISE':
          return '  [' + entry.playerName + '] RAISE $' + entry.amount + ' (Total bet: $' + entry.totalBet + ')';
        case 'FLOP':
          return '  [BOARD] Flop dealt: ' + entry.cards;
        case 'TURN':
          return '  [BOARD] Turn dealt: ' + entry.card + ' (Board: ' + entry.board + ')';
        case 'RIVER':
          return '  [BOARD] River dealt: ' + entry.card + ' (Board: ' + entry.board + ')';
        case 'SHOWDOWN':
          return '  [SHOWDOWN] ' + entry.playerName + ': ' + entry.cards + ' (' + entry.handDescr + ')';
        case 'RESULT': {
          const r = [];
          r.push('');
          r.push('【RESULT】');
          if (entry.winners) {
            r.push('  Winner(s): ' + entry.winners);
          } else if (entry.winner) {
            r.push('  Winner: ' + entry.winner);
          }
          r.push('  Pot won: $' + entry.potWon);
          if (entry.reason) r.push('  Reason: ' + entry.reason);
          if (entry.handDescr) r.push('  Winning hand: ' + entry.handDescr);
          return r.join('\n');
        }
        case 'SKILL_USE':
          return '  [SKILL] ' + (entry.skill || '') + (entry.manaRemaining != null ? ' (Mana: ' + entry.manaRemaining + ')' : '');
        case 'SENSE':
          return '  [SENSE] ' + (entry.message || '');
        case 'NPC_SKILL':
          return '  [NPC_SKILL] ' + entry.owner + ' used ' + entry.skill + ' (' + entry.effect + ' Lv.' + entry.level + ')';
        default:
          // 引擎内部事件（MOZ_*, SKILL_*）不输出到可读日志
          if (entry.type && (entry.type.startsWith('MOZ_') || entry.type.startsWith('SKILL_'))) {
            return null; // 跳过
          }
          return '  [' + entry.type + '] ' + JSON.stringify(entry);
      }
    }

    // ========== UI 控制 ==========

    /**
     * 显示日志面板
     * @param {object} context - 传给 generateText 的上下文
     */
    show(context) {
      if (!this.ui.content || !this.ui.panel) return;
      const text = this.generateText(context);
      this.ui.content.textContent = text;
      this.ui.panel.style.display = 'block';
      if (this.ui.btnCopy) this.ui.btnCopy.style.display = 'inline-block';
    }

    togglePanel() {
      if (!this.ui.panel) return;
      if (this.ui.panel.style.display === 'none') {
        this.ui.panel.style.display = 'block';
        if (this.ui.btnToggle) this.ui.btnToggle.textContent = 'Hide';
      } else {
        this.ui.panel.style.display = 'none';
        if (this.ui.btnToggle) this.ui.btnToggle.textContent = 'Show';
      }
    }

    copyToClipboard(context) {
      const text = this.generateText(context);
      const done = () => {
        if (this.ui.btnCopy) {
          this.ui.btnCopy.textContent = '✓ Copied!';
          setTimeout(() => { this.ui.btnCopy.textContent = '📋 Copy Log'; }, 2000);
        }
      };
      const fallback = () => {
        try {
          const ta = document.createElement('textarea');
          ta.value = text;
          ta.style.cssText = 'position:fixed;left:-9999px;top:-9999px;opacity:0';
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          document.body.removeChild(ta);
          done();
        } catch (e) {
          console.warn('[GameLogger] 复制失败:', e);
        }
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done).catch(fallback);
      } else {
        fallback();
      }
    }
  }

  // ========== 导出 ==========
  global.GameLogger = GameLogger;

})(typeof window !== 'undefined' ? window : global);
