/**
 * ===========================================
 * GAME-LOGGER.JS - 牌局日志清洗与 AI 提示词系统
 * ===========================================
 *
 * 职责:
 * - 记录结构化牌局事件 (通过 log() 接口)
 * - D-E-L 模型: 事件分级 (T0~T3)、过滤、压缩
 * - 连续相同行动去重 (如多人连续 CHECK)
 * - 字数推荐算法 (基于有效事件权值 + 参战人数 + 底池规模)
 * - 生成 AI 叙事提示词模板 + 复制到剪贴板
 *
 * 参考: 参考/log-filter.js (PKM 战斗日志清洗系统)
 */

(function (global) {
  'use strict';

  // ============================================
  // 【事件分级规则】T0 ~ T3
  // tier 越低越重要, score 用于字数推荐
  // ============================================

  const TIER_SCORES = {
    0: 15,   // T0: 史诗级 (All-in 对决、大逆转、技能爆发)
    1: 5,    // T1: 关键交互 (大额加注、关键弃牌、摊牌)
    2: 2,    // T2: 常规行动 (跟注、过牌、发牌)
    3: 0.2   // T3: 噪音 (引擎内部、技能系统细节)
  };

  /**
   * T_DELETE: 直接删除的事件类型
   * 这些事件对 AI 叙事毫无价值
   */
  const DELETE_TYPES = new Set([
    // MonteOfZero 引擎内部
    'MOZ_SELECT', 'MOZ_FORCE', 'MOZ_OPPOSITION', 'MOZ_RESOLVE',
    'MOZ_DESTINY_SELECT', 'MOZ_STYLE_BONUS', 'MOZ_FORCE_BALANCE',
    // SkillSystem 内部注册/状态
    'SKILL_REGISTER', 'SKILL_LOADED', 'SKILL_RESET',
    'SKILL_COOLDOWN', 'SKILL_MANA_CHECK'
  ]);

  /**
   * 分级一条事件
   * @param {object} entry - 日志条目 { type, phase, pot, ... }
   * @returns {{ tier: number, score: number, action: string }}
   */
  function classifyEntry(entry) {
    const type = entry.type || '';

    // DELETE: 引擎内部噪音
    if (DELETE_TYPES.has(type)) {
      return { tier: -1, score: 0, action: 'delete' };
    }
    // DELETE: 所有 MOZ_ 和 SKILL_ 前缀事件
    if (type.startsWith('MOZ_') || type.startsWith('SKILL_')) {
      return { tier: -1, score: 0, action: 'delete' };
    }

    // T0: 史诗级节点
    if (type === 'RESULT') {
      // 摊牌结算 = 史诗
      return { tier: 0, score: TIER_SCORES[0], action: 'keep' };
    }
    if (type === 'SHOWDOWN') {
      return { tier: 0, score: TIER_SCORES[0], action: 'keep' };
    }
    // All-in 行为
    if (entry.isAllIn) {
      return { tier: 0, score: TIER_SCORES[0], action: 'keep' };
    }
    // 技能使用 (玩家主动技能 = 命运干涉，叙事高光)
    if (type === 'SKILL_USE') {
      return { tier: 0, score: TIER_SCORES[0], action: 'keep' };
    }
    // NPC 技能
    if (type === 'NPC_SKILL') {
      return { tier: 1, score: TIER_SCORES[1], action: 'keep' };
    }
    // 感知提示
    if (type === 'SENSE') {
      return { tier: 1, score: TIER_SCORES[1], action: 'keep' };
    }

    // T1: 关键交互
    // 大额加注 (超过底池 50%)
    if ((type === 'PLAYER_RAISE' || type === 'AI_RAISE' ||
         type === 'PLAYER_BET' || type === 'AI_BET') && entry.amount > 0) {
      const pot = entry.pot || 1;
      if (entry.amount >= pot * 0.5) {
        return { tier: 1, score: TIER_SCORES[1], action: 'keep' };
      }
    }
    // 弃牌 (放弃底池 = 关键决策)
    if (type === 'PLAYER_FOLD' || type === 'AI_FOLD') {
      return { tier: 1, score: TIER_SCORES[1], action: 'keep' };
    }
    // 公共牌发出 (翻牌/转牌/河牌 = 剧情转折点)
    if (type === 'FLOP' || type === 'TURN' || type === 'RIVER') {
      return { tier: 1, score: TIER_SCORES[1], action: 'keep' };
    }

    // T2: 常规行动
    if (type === 'PLAYER_RAISE' || type === 'AI_RAISE' ||
        type === 'PLAYER_BET' || type === 'AI_BET') {
      return { tier: 2, score: TIER_SCORES[2], action: 'keep' };
    }
    if (type === 'PLAYER_CALL' || type === 'AI_CALL') {
      return { tier: 2, score: TIER_SCORES[2], action: 'keep' };
    }
    if (type === 'PLAYER_CHECK' || type === 'AI_CHECK') {
      return { tier: 2, score: TIER_SCORES[2], action: 'keep' };
    }
    if (type === 'DEAL' || type === 'BLINDS') {
      return { tier: 2, score: TIER_SCORES[2], action: 'keep' };
    }

    // T3: 未分类 → 噪音
    return { tier: 3, score: TIER_SCORES[3], action: 'keep' };
  }

  // ============================================
  // 【格式化】将结构化事件转为可读文本行
  // ============================================

  function formatEntry(entry) {
    switch (entry.type) {
      case 'DEAL':
        return '[发牌] ' + entry.playerCount + ' 名玩家入局';
      case 'BLINDS':
        return '[盲注] ' + entry.sb + ' 小盲 $' + (entry.sbAmount || 10) + ', ' + entry.bb + ' 大盲 $' + (entry.bbAmount || 20);
      case 'PLAYER_FOLD':
      case 'AI_FOLD':
        return '[' + entry.playerName + '] 弃牌';
      case 'PLAYER_CHECK':
      case 'AI_CHECK':
        return '[' + entry.playerName + '] 过牌';
      case 'PLAYER_CALL':
      case 'AI_CALL':
        return '[' + entry.playerName + '] 跟注 $' + entry.amount + (entry.isAllIn ? ' (ALL-IN)' : '');
      case 'PLAYER_BET':
      case 'AI_BET':
        return '[' + entry.playerName + '] 下注 $' + entry.amount + (entry.isAllIn ? ' (ALL-IN)' : '');
      case 'PLAYER_RAISE':
      case 'AI_RAISE':
        return '[' + entry.playerName + '] 加注 $' + entry.amount + ' (总注 $' + entry.totalBet + ')' + (entry.isAllIn ? ' (ALL-IN)' : '');
      case 'FLOP':
        return '[翻牌] ' + entry.cards;
      case 'TURN':
        return '[转牌] ' + entry.card + ' (公共牌: ' + entry.board + ')';
      case 'RIVER':
        return '[河牌] ' + entry.card + ' (公共牌: ' + entry.board + ')';
      case 'SHOWDOWN':
        return '[摊牌] ' + entry.playerName + ': ' + entry.cards + ' (' + entry.handDescr + ')';
      case 'RESULT': {
        const parts = ['[结算]'];
        if (entry.winners) parts.push('赢家: ' + entry.winners);
        else if (entry.winner) parts.push('赢家: ' + entry.winner);
        parts.push('赢得 $' + entry.potWon);
        if (entry.reason) parts.push('(' + entry.reason + ')');
        if (entry.handDescr) parts.push('牌型: ' + entry.handDescr);
        return parts.join(' ');
      }
      case 'SKILL_USE':
        return '[技能] ' + (entry.skill || '未知') + (entry.manaRemaining != null ? ' (剩余魔力: ' + entry.manaRemaining + ')' : '');
      case 'SENSE':
        return '[感知] ' + (entry.message || '');
      case 'NPC_SKILL':
        return '[NPC技能] ' + entry.owner + ' 使用 ' + entry.skill + ' (' + entry.effect + ' Lv.' + entry.level + ')';
      default:
        return '[' + entry.type + '] ' + (entry.playerName || '');
    }
  }

  // ============================================
  // 【连续行动去重】多人连续 CHECK/FOLD → 合并
  // ============================================

  function getActionSignature(entry) {
    // 同类行动签名：忽略玩家名和金额，只看行动类型
    const type = entry.type || '';
    if (type.endsWith('_CHECK')) return 'CHECK';
    if (type.endsWith('_FOLD')) return 'FOLD';
    return null; // 其他行动不去重
  }

  /**
   * 去重: 连续 ≥3 个相同行动 → 保留首条 + 计数
   */
  function deduplicateActions(lines) {
    if (lines.length <= 1) return lines;
    const result = [];
    var i = 0;

    while (i < lines.length) {
      var sig = getActionSignature(lines[i].entry);
      if (!sig) {
        result.push(lines[i]);
        i++;
        continue;
      }

      var runEnd = i;
      var names = [lines[i].entry.playerName];
      while (runEnd + 1 < lines.length && getActionSignature(lines[runEnd + 1].entry) === sig) {
        runEnd++;
        names.push(lines[runEnd].entry.playerName);
      }

      var runLength = runEnd - i + 1;
      if (runLength >= 3) {
        result.push({
          text: '[' + names.join(', ') + '] 全部' + (sig === 'CHECK' ? '过牌' : '弃牌'),
          classification: lines[i].classification,
          entry: lines[i].entry
        });
      } else {
        for (var j = i; j <= runEnd; j++) {
          result.push(lines[j]);
        }
      }
      i = runEnd + 1;
    }
    return result;
  }

  // ============================================
  // 【T3 折叠】连续 T3 行折叠为摘要
  // ============================================

  function collapseT3Runs(lines) {
    var result = [];
    var t3Buffer = [];

    for (var i = 0; i < lines.length; i++) {
      if (lines[i].classification.tier === 3) {
        t3Buffer.push(lines[i]);
      } else {
        if (t3Buffer.length > 2) {
          result.push({
            text: '  (' + t3Buffer.length + ' 条系统事件省略)',
            classification: { tier: 3, score: 0.2, action: 'keep' },
            entry: {}
          });
        } else {
          t3Buffer.forEach(function (l) { result.push(l); });
        }
        t3Buffer = [];
        result.push(lines[i]);
      }
    }
    // 末尾
    if (t3Buffer.length > 2) {
      result.push({
        text: '  (' + t3Buffer.length + ' 条系统事件省略)',
        classification: { tier: 3, score: 0.2, action: 'keep' },
        entry: {}
      });
    } else {
      t3Buffer.forEach(function (l) { result.push(l); });
    }
    return result;
  }

  // ============================================
  // 【清洗流水线】D-E-L 模型主入口
  // ============================================

  function filterLog(entries) {
    // Step 1: 分级 + 格式化
    var classified = [];
    for (var i = 0; i < entries.length; i++) {
      var cls = classifyEntry(entries[i]);
      if (cls.action === 'delete') continue;
      classified.push({
        text: formatEntry(entries[i]),
        classification: cls,
        entry: entries[i]
      });
    }

    // Step 2: 连续行动去重
    classified = deduplicateActions(classified);

    // Step 3: T3 折叠
    classified = collapseT3Runs(classified);

    // Step 4: 统计
    var stats = { total: entries.length, kept: classified.length, deleted: 0, t0: 0, t1: 0, t2: 0, t3: 0 };
    stats.deleted = entries.length - classified.length;
    for (var k = 0; k < classified.length; k++) {
      var t = classified[k].classification.tier;
      if (t === 0) stats.t0++;
      else if (t === 1) stats.t1++;
      else if (t === 2) stats.t2++;
      else if (t === 3) stats.t3++;
    }

    // Step 5: 叙事总分
    stats.narrativeScore = 0;
    for (var m = 0; m < classified.length; m++) {
      stats.narrativeScore += (classified[m].classification.score || 0);
    }

    return { filtered: classified, stats: stats };
  }

  // ============================================
  // 【字数推荐算法】
  // 参战人数 + 有效事件权值 + 底池规模
  // ============================================

  function calculateWordCount(stats, context) {
    context = context || {};
    var breakdown = {};

    // 1. 参战规模
    var playerCount = context.playerCount || 2;
    var participantScore = playerCount * 60;
    breakdown.participants = participantScore;

    // 2. 有效事件权值
    var eventScore = Math.round((stats.narrativeScore || 0) * 5);
    breakdown.events = eventScore;

    // 3. 底池规模系数 (大底池 = 更紧张 = 更多描写)
    var maxPot = context.maxPot || 100;
    var initialChips = context.initialChips || 1000;
    var potModifier = Math.min(1.5, Math.max(0.8, maxPot / initialChips + 0.5));
    breakdown.potModifier = potModifier;

    // 4. T3 衰减 (噪音越多，压制膨胀)
    var t3Ratio = stats.kept > 0 ? stats.t3 / stats.kept : 0;
    var decayFactor = Math.max(0.6, 1 - t3Ratio * 0.4);
    breakdown.decayFactor = decayFactor;

    // 最终计算
    var rawWords = (participantScore + eventScore) * potModifier * decayFactor;
    var recommended = Math.min(3000, Math.max(300, Math.round(rawWords)));
    var min = Math.max(300, recommended - 150);
    var max = Math.min(3000, recommended + 150);

    breakdown.rawWords = Math.round(rawWords);

    return { min: min, max: max, recommended: recommended, breakdown: breakdown };
  }

  // ============================================
  // 【GameLogger 类】
  // ============================================

  class GameLogger {
    constructor() {
      this.entries = [];
      this.ui = { panel: null, content: null, btnCopy: null, btnToggle: null };
      // 游戏状态快照回调
      this.getGameSnapshot = null;
    }

    // ========== 初始化 ==========

    bindUI(elements) {
      this.ui.panel = elements.panel || document.getElementById('game-log-panel');
      this.ui.content = elements.content || document.getElementById('game-log-content');
      this.ui.btnCopy = elements.btnCopy || document.getElementById('btn-copy-log');
      this.ui.btnToggle = elements.btnToggle || document.getElementById('btn-toggle-log');

      if (this.ui.btnCopy) {
        this.ui.btnCopy.addEventListener('click', () => this.copyToClipboard());
      }
      if (this.ui.btnToggle) {
        this.ui.btnToggle.addEventListener('click', () => this.togglePanel());
      }
    }

    // ========== 核心：记录事件 ==========

    log(type, data) {
      var snapshot = this.getGameSnapshot ? this.getGameSnapshot() : {};
      var players = snapshot.players || [];
      var activeBets = 0;
      var playerChips = {};
      for (var i = 0; i < players.length; i++) {
        activeBets += (players[i].currentBet || 0);
        playerChips[players[i].name] = players[i].chips;
      }

      var entry = {
        type: type,
        phase: snapshot.phase || 'unknown',
        pot: (snapshot.pot || 0) + activeBets,
        chips: playerChips
      };
      // 合并 data
      if (data) {
        for (var key in data) {
          if (data.hasOwnProperty(key)) entry[key] = data[key];
        }
      }

      this.entries.push(entry);
    }

    clear() {
      this.entries = [];
      if (this.ui.panel) this.ui.panel.style.display = 'none';
      if (this.ui.btnCopy) this.ui.btnCopy.style.display = 'none';
    }

    // ========== 清洗 + 格式化 ==========

    /**
     * 生成清洗后的可读日志文本 (用于面板显示)
     */
    generateText(context) {
      context = context || {};
      var result = filterLog(this.entries);
      var lines = [];

      lines.push('═══════════════════════════════════════════');
      lines.push('ACEZERO 牌局日志 - ' + (context.playerCount || '?') + ' 名玩家');
      lines.push('═══════════════════════════════════════════');
      lines.push('');

      // 游戏设置
      lines.push('【设置】');
      lines.push('  筹码: $' + (context.initialChips || 1000));
      lines.push('  盲注: SB $' + (context.smallBlind || 10) + ' / BB $' + (context.bigBlind || 20));
      if (context.playerNames) {
        lines.push('  玩家: ' + context.playerNames.join(', '));
      }
      lines.push('');

      // 最终手牌
      if (context.players) {
        lines.push('【最终手牌】');
        for (var p = 0; p < context.players.length; p++) {
          var pl = context.players[p];
          lines.push('  ' + pl.name + ': ' + (pl.cardsStr || '[未知]'));
        }
        if (context.boardStr) {
          lines.push('  公共牌: ' + context.boardStr);
        }
        lines.push('');
      }

      // 行动日志
      lines.push('【行动日志】');
      lines.push('───────────────────────────────────────────');

      var currentPhase = '';
      for (var i = 0; i < result.filtered.length; i++) {
        var item = result.filtered[i];
        var entry = item.entry || {};
        // 阶段分隔
        if (entry.phase && entry.phase !== currentPhase) {
          currentPhase = entry.phase;
          lines.push('');
          lines.push('▶ ' + currentPhase.toUpperCase());
        }
        lines.push('  ' + item.text);
      }

      lines.push('');
      lines.push('═══════════════════════════════════════════');
      lines.push('统计: ' + result.stats.total + ' 条原始 → ' + result.stats.kept + ' 条有效 (T0:' + result.stats.t0 + ' T1:' + result.stats.t1 + ' T2:' + result.stats.t2 + ' T3:' + result.stats.t3 + ')');

      return lines.join('\n');
    }

    /**
     * 生成 AI 叙事提示词 (清洗日志 + 提示词模板)
     */
    generateAIPrompt(context) {
      context = context || {};
      var result = filterLog(this.entries);
      var stats = result.stats;

      // 构建清洗后的日志文本
      var logLines = [];
      var currentPhase = '';
      for (var i = 0; i < result.filtered.length; i++) {
        var item = result.filtered[i];
        var entry = item.entry || {};
        if (entry.phase && entry.phase !== currentPhase) {
          currentPhase = entry.phase;
          logLines.push('');
          logLines.push('▶ ' + currentPhase.toUpperCase());
        }
        logLines.push('> ' + item.text);
      }
      var processLog = logLines.join('\n');

      // 计算推荐字数
      var wordCount = calculateWordCount(stats, context);

      // 构建结果摘要
      var resultSummary = '';
      if (context.players) {
        var summaryParts = [];
        summaryParts.push('玩家: ' + (context.playerNames || []).join(', '));
        summaryParts.push('筹码: $' + (context.initialChips || 1000));
        summaryParts.push('盲注: $' + (context.smallBlind || 10) + '/$' + (context.bigBlind || 20));
        if (context.boardStr) summaryParts.push('公共牌: ' + context.boardStr);
        for (var p = 0; p < context.players.length; p++) {
          var pl = context.players[p];
          summaryParts.push(pl.name + ': ' + (pl.cardsStr || '[未知]') + ' | 剩余 $' + (pl.chips || 0));
        }
        resultSummary = summaryParts.join('\n');
      }

      var wordRequirement = '本次牌局共 ' + stats.total + ' 条原始日志，清洗后 ' + stats.kept + ' 条有效事件 (T0:' + stats.t0 + ' T1:' + stats.t1 + ' T2:' + stats.t2 + ' T3:' + stats.t3 + ')，推荐正文字数: ' + wordCount.min + '~' + wordCount.max + ' 字 (不少于 ' + wordCount.min + ' 字)';

      console.log('[GameLogger] 日志清洗完成: ' + stats.total + ' → ' + stats.kept + ' (删除 ' + stats.deleted + '), 叙事分: ' + stats.narrativeScore.toFixed(1) + ', 推荐字数: ' + wordCount.min + '~' + wordCount.max);

      // 组装最终提示词
      var finalContent = [
        '<CORE_TASK>',
        '核心任务: 基于下方的「牌局日志」与「结算」，将枯燥的数据重构为充满画面感的小说级牌局实况。',
        '',
        '【字数要求】' + wordRequirement,
        '',
        '【核心原则】',
        '1. 去数据化: 严禁使用"底池$XX"、"跟注$XX"等原始数据。通过筹码推动声、表情变化、手指动作来体现下注。',
        '2. 心理博弈: 每次加注/弃牌背后都有心理活动。描写眼神交锋、微表情、犹豫与决断。',
        '3. 命运系统: 技能使用是超自然力量介入。大吉=命运偏转、先知=预见未来、空白=虚无侵蚀。用视觉特效描写。',
        '4. 节奏控制: 翻牌前=序幕铺垫，翻牌=剧情展开，转牌=高潮前奏，河牌=最终对决。',
        '5. 角色塑造: 每个NPC有独特的打牌风格和性格。通过小动作和台词体现。',
        '</CORE_TASK>',
        '',
        '<POKER_LOG>',
        processLog,
        '</POKER_LOG>',
        '',
        '<POKER_RESULT>',
        resultSummary,
        '</POKER_RESULT>',
        '',
        '<WRITING_INSTRUCTION>',
        '请立即生成 ' + wordCount.min + '~' + wordCount.max + ' 字的牌局实况文案 (最低不少于 ' + wordCount.min + ' 字)',
        '</WRITING_INSTRUCTION>'
      ].join('\n');

      return finalContent;
    }

    // ========== UI 控制 ==========

    show(context) {
      if (!this.ui.content || !this.ui.panel) return;
      this.ui.content.textContent = this.generateText(context);
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

    // ========== 复制系统 (iframe 兼容) ==========

    /**
     * 复制清洗后的日志 (面板显示用)
     */
    copyToClipboard(context) {
      var text = this.generateText(context);
      this._copyText(text);
    }

    /**
     * 复制 AI 提示词 (完整提示词模板)
     */
    copyAIPrompt(context) {
      var text = this.generateAIPrompt(context);
      this._copyText(text);
    }

    _copyText(text) {
      var self = this;
      var done = function () {
        if (self.ui.btnCopy) {
          self.ui.btnCopy.textContent = '✓ Copied!';
          setTimeout(function () { self.ui.btnCopy.textContent = '📋 Copy'; }, 2000);
        }
      };
      var fallback = function () {
        try {
          var ta = document.createElement('textarea');
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

  // 导出工具函数供调试/测试
  global.GameLogger.filterLog = filterLog;
  global.GameLogger.classifyEntry = classifyEntry;
  global.GameLogger.calculateWordCount = calculateWordCount;
  global.GameLogger.TIER_SCORES = TIER_SCORES;

})(typeof window !== 'undefined' ? window : global);
