/**
 * Skill UI — 技能UI控制器
 * 《零之王牌》通用技能界面模块
 *
 * 三层架构：
 *   1. 静态数据层 (SKILL_DEFS) — 技能视觉定义（图标、名称、CSS类）
 *      从 SkillSystem 注册表自动读取，不硬编码。
 *   2. 动态函数层 — 通用技能激活、按钮状态管理、UI渲染
 *      根据技能 effect/activation 自动决定行为，无需逐个写 handler。
 *   3. 引擎层 — 桥接 SkillSystem + MonteOfZero + 游戏状态
 *      暴露通用接口给 texas-holdem.js，不暴露内部细节。
 *
 * 通用接口：
 *   skillUI.init(skillSystem, moz, containers)
 *   skillUI.update(gameContext)
 *   skillUI.selectCard(deckCards, board, players) → { card, meta }
 *   skillUI.onNewHand()
 *   skillUI.onRoundEnd(gameContext)
 *   skillUI.registerFromConfig(players)
 */

(function (global) {
  'use strict';

  // ========== 静态数据层：技能视觉映射 ==========
  // 根据 effect 类型提供默认视觉，可被 config 覆盖
  const EFFECT_VISUALS = {
    fortune: { icon: '✦', cssClass: 'rino-skill', color: '#9B59B6' },
    curse:   { icon: '☠', cssClass: 'curse-skill', color: '#e74c3c' },
    foresight: { icon: '👁', cssClass: 'rino-skill', color: '#3498db' },
    peek:    { icon: '🃏', cssClass: 'rino-skill', color: '#e67e22' },
    reversal: { icon: '↺', cssClass: 'rino-skill', color: '#1abc9c' },
    fortune_anchor: { icon: '⚓', cssClass: 'rino-skill', color: '#9B59B6' },
    null_field: { icon: '∅', cssClass: 'kazu-skill', color: '#95a5a6' },
    blank:   { icon: '◇', cssClass: 'kazu-skill', color: '#95a5a6' },
    sense:   { icon: '🔮', cssClass: 'sense-skill', color: '#a29bfe' }
  };

  // 透视三级定义
  const PEEK_TIERS = [
    { tier: 1, name: '模糊透视', cost: 10, description: '感知对手可能的牌型范围' },
    { tier: 2, name: '深层透视', cost: 20, description: '按概率分析对手的手牌' },
    { tier: 3, name: '完全透视', cost: 35, description: '直接看穿对手的底牌' }
  ];

  // 特殊技能行为标记
  const BEHAVIOR = {
    // fortune 类技能有 major/minor 变体
    FORTUNE_MAJOR: 'fortune_major',
    FORTUNE_MINOR: 'fortune_minor',
    FORESIGHT: 'foresight',
    PEEK: 'peek',
    REVERSAL: 'reversal',
    BLANK: 'blank',
    // 通用主动
    GENERIC_ACTIVE: 'generic_active'
  };

  // ========== SkillUI 类 ==========

  class SkillUI {
    constructor() {
      // 引擎引用
      this.skillSystem = null;
      this.moz = null;

      // UI 容器
      this.containers = {
        skillPanel: null,     // 技能按钮容器
        manaBar: null,        // mana 条填充元素
        manaText: null,       // mana 文字
        backlashIndicator: null,
        mozStatus: null,      // 状态文字
        forceBalance: null,   // 力量对比条
        foresightPanel: null, // 先知预览面板
        senseAlert: null      // 感知提示
      };

      // 生成的按钮映射 { uniqueId → buttonElement }
      this._buttons = new Map();

      // 玩家ID（人类玩家）
      this.humanPlayerId = 0;

      // 回调
      this.onLog = null;         // (type, data) → void
      this.onMessage = null;     // (msg) → void  — 显示消息到游戏UI

      // 游戏上下文快照（由 update() 刷新）
      this._gameCtx = {
        phase: 'idle',
        isPlayerTurn: false,
        deckCards: [],
        board: [],
        players: []
      };
    }

    // ========== 初始化 ==========

    /**
     * 初始化技能UI
     * @param {SkillSystem} skillSystem
     * @param {MonteOfZero} moz
     * @param {object} containers — DOM 元素引用
     */
    init(skillSystem, moz, containers) {
      this.skillSystem = skillSystem;
      this.moz = moz;

      // 绑定容器
      Object.keys(containers).forEach(key => {
        if (containers[key]) this.containers[key] = containers[key];
      });

      // 监听 skillSystem 事件
      this._wireHooks();
    }

    /**
     * 从配置注册技能（委托给 skillSystem）+ 生成UI
     */
    registerFromConfig(playerConfigs) {
      if (!this.skillSystem) return;
      this.skillSystem.registerFromConfig(playerConfigs);
      this._buildSkillButtons();
    }

    // ========== 通用接口：游戏生命周期 ==========

    /**
     * 新一手牌
     */
    onNewHand() {
      if (this.skillSystem) this.skillSystem.onNewHand();
      this._hideForesight();
      this._hideSenseAlert();
    }

    /**
     * 每轮下注结束后调用
     * @param {object} gameContext — { players, pot, phase, board }
     */
    onRoundEnd(gameContext) {
      if (!this.skillSystem) return;
      this.skillSystem.onRoundEnd();
      this.skillSystem.checkTriggers(gameContext);
      this.skillSystem.npcDecideSkills(gameContext);
      this.updateDisplay();
      this.updateButtons();
    }

    /**
     * 用命运引擎选一张牌（核心桥接）
     * @param {Array} deckCards
     * @param {Array} board
     * @param {Array} players
     * @returns {{ card, meta }}
     */
    selectCard(deckCards, board, players) {
      if (!this.moz || !this.moz.enabled || !deckCards || !deckCards.length) {
        return null; // 让调用方 fallback
      }

      const forces = this.skillSystem.collectActiveForces({ players: players });

      // 判断选牌模式（小吉 = weighted 随机）
      const hasMinor = this.skillSystem.pendingForces.some(
        f => f.source === 'active' && f.ownerId === this.humanPlayerId && f.power < f.level * 10
      );
      const mode = hasMinor ? 'weighted' : 'best';

      console.log('[SkillUI.selectCard]', {
        mode: mode,
        pendingCount: this.skillSystem.pendingForces.length,
        totalForces: forces.length,
        forces: forces.map(f => f.ownerName + ' ' + f.type + ' P=' + f.power)
      });

      const result = this.moz.selectCard(
        deckCards, board, players, forces,
        { mode: mode, rinoPlayerId: this.humanPlayerId }
      );

      // 发牌后清除单次 pending forces
      this.skillSystem.pendingForces = [];

      return result;
    }

    /**
     * 先知预览（不消耗，纯计算）
     */
    foresight(deckCards, board, players) {
      if (!this.moz) return [];
      const forces = this.skillSystem.collectActiveForces({ players: players });
      return this.moz.foresight(deckCards, board, players, forces, this.humanPlayerId);
    }

    // ========== 通用接口：UI 更新 ==========

    /**
     * 刷新游戏上下文（每次 nextTurn / phase change 时调用）
     */
    update(gameContext) {
      this._gameCtx = { ...this._gameCtx, ...gameContext };
      this.updateDisplay();
      this.updateButtons();
    }

    /**
     * 更新 mana 条 + 状态文字 + 力量对比
     */
    updateDisplay() {
      if (!this.skillSystem) return;
      const ss = this.skillSystem.getState();
      const mana = this.skillSystem.getMana(this.humanPlayerId);

      // Mana 条
      if (this.containers.manaBar) {
        const pct = mana.max > 0 ? (mana.current / mana.max) * 100 : 0;
        this.containers.manaBar.style.width = pct + '%';
        if (pct > 50) {
          this.containers.manaBar.className = 'mana-fill high';
        } else if (pct > 20) {
          this.containers.manaBar.className = 'mana-fill medium';
        } else {
          this.containers.manaBar.className = 'mana-fill low';
        }
      }

      if (this.containers.manaText) {
        this.containers.manaText.textContent = mana.current + ' / ' + mana.max;
      }

      // 反噬指示器
      if (this.containers.backlashIndicator) {
        if (ss.backlash.active) {
          this.containers.backlashIndicator.style.display = 'block';
          this.containers.backlashIndicator.textContent = '⚡ BACKLASH (' + ss.backlash.counter + ')';
        } else {
          this.containers.backlashIndicator.style.display = 'none';
        }
      }

      // 状态文字 + 力量对比
      if (this.containers.mozStatus) {
        const summary = this.skillSystem.getForcesSummary();
        const hasEnemyForces = summary.enemies.length > 0;

        if (ss.backlash.active) {
          this.containers.mozStatus.textContent = '魔运反噬中...';
          this.containers.mozStatus.className = 'moz-status backlash';
        } else if (mana.current < 20) {
          this.containers.mozStatus.textContent = '魔运虚弱';
          this.containers.mozStatus.className = 'moz-status weak';
        } else if (hasEnemyForces) {
          var enemyNames = summary.enemies.map(function (e) { return e.name.split(' ')[0]; }).join(', ');
          this.containers.mozStatus.textContent = '命运场: 友' + summary.total.ally + ' vs 敌' + summary.total.enemy + ' (' + enemyNames + ')';
          this.containers.mozStatus.className = summary.total.ally >= summary.total.enemy ? 'moz-status ready' : 'moz-status contested';
        } else {
          this.containers.mozStatus.textContent = '魔运就绪';
          this.containers.mozStatus.className = 'moz-status ready';
        }
      }

      // 力量对比条
      if (this.containers.forceBalance) {
        var summary2 = this.skillSystem.getForcesSummary();
        if (summary2.enemies.length > 0) {
          var total = summary2.total.ally + summary2.total.enemy;
          var allyPct = total > 0 ? (summary2.total.ally / total) * 100 : 50;
          this.containers.forceBalance.style.display = 'flex';
          var allyBar = this.containers.forceBalance.querySelector('.force-ally');
          var enemyBar = this.containers.forceBalance.querySelector('.force-enemy');
          if (allyBar) allyBar.style.width = allyPct + '%';
          if (enemyBar) enemyBar.style.width = (100 - allyPct) + '%';
        } else {
          this.containers.forceBalance.style.display = 'none';
        }
      }
    }

    /**
     * 更新所有技能按钮的可用状态（通用，不硬编码）
     */
    updateButtons() {
      if (!this.skillSystem) return;
      var ss = this.skillSystem.getState();
      var ctx = this._gameCtx;
      var isBettingPhase = ['preflop', 'flop', 'turn', 'river'].indexOf(ctx.phase) >= 0;
      var isPlayerTurn = isBettingPhase && ctx.isPlayerTurn;
      var mana = this.skillSystem.getMana(this.humanPlayerId);
      var canUse = isPlayerTurn && !ss.backlash.active && mana.current > 0;
      // river 阶段无牌可发，fortune/curse/blank 无意义
      var isRiver = ctx.phase === 'river';

      // 检查是否已有 fortune pending（玩家方）
      var hasFortuneQueued = ss.pendingForces.some(function (f) {
        return f.type === 'fortune' && f.ownerId === 0;
      });

      // 遍历所有按钮
      for (var entry of this._buttons) {
        var btnInfo = entry[1];
        var btn = btnInfo.element;
        var skill = btnInfo.skill;
        var behavior = btnInfo.behavior;

        if (!btn) continue;

        var disabled = true;

        var cost = btnInfo.actualCost || skill.manaCost || 0;

        switch (behavior) {
          case BEHAVIOR.FORTUNE_MAJOR:
          case BEHAVIOR.FORTUNE_MINOR:
            disabled = isRiver || hasFortuneQueued || !canUse || mana.current < cost;
            btn.classList.toggle('skill-active', hasFortuneQueued);
            break;
          case BEHAVIOR.FORESIGHT:
            disabled = !canUse || mana.current < cost;
            break;
          case BEHAVIOR.PEEK:
            // 只要够最低 tier 的 cost 就可以点开面板
            disabled = !canUse || mana.current < PEEK_TIERS[0].cost;
            break;
          case BEHAVIOR.REVERSAL:
            disabled = isRiver || !canUse || mana.current < cost;
            break;
          case BEHAVIOR.BLANK:
            var hasBlank = this.skillSystem.hasBlankFactor();
            disabled = isRiver || hasBlank || !isPlayerTurn;
            btn.classList.toggle('skill-active', hasBlank);
            break;
          case BEHAVIOR.GENERIC_ACTIVE:
            disabled = !canUse || mana.current < (skill.manaCost || 0);
            if (skill.currentCooldown > 0) disabled = true;
            break;
        }

        btn.disabled = disabled;
      }

      // 面板始终可见（新Dashboard布局），按钮通过 disabled 控制
    }

    // ========== 动态函数层：通用技能激活 ==========

    /**
     * 通用技能激活入口
     * @param {string} behavior — BEHAVIOR 常量
     * @param {object} skill — 技能对象
     */
    _activateSkill(behavior, skill) {
      if (!this.skillSystem) return;

      switch (behavior) {
        case BEHAVIOR.FORTUNE_MAJOR:
          this._activateFortune(skill, 'major');
          break;
        case BEHAVIOR.FORTUNE_MINOR:
          this._activateFortune(skill, 'minor');
          break;
        case BEHAVIOR.FORESIGHT:
          this._activateForesight(skill);
          break;
        case BEHAVIOR.PEEK:
          this._activatePeek(skill);
          break;
        case BEHAVIOR.REVERSAL:
          this._activateReversal(skill);
          break;
        case BEHAVIOR.BLANK:
          this._activateBlank(skill);
          break;
        case BEHAVIOR.GENERIC_ACTIVE:
          this._activateGeneric(skill);
          break;
      }

      this.updateDisplay();
      this.updateButtons();
    }

    _activateFortune(skill, variant) {
      // 防止同一轮重复激活（大吉+小吉互斥）
      var alreadyQueued = this.skillSystem.pendingForces.some(function (f) {
        return f.type === 'fortune' && f.ownerId === 0;
      });
      if (alreadyQueued) {
        if (this.onMessage) this.onMessage('本轮已激活命运技能');
        return;
      }

      var baseCost = skill.manaCost || 20;
      var cost = variant === 'major' ? baseCost : Math.round(baseCost * 0.75);
      if (!this.skillSystem.spendMana(this.humanPlayerId, cost)) {
        if (this.onMessage) this.onMessage('魔运不足');
        return;
      }
      var level = skill.level || 5;
      var power = variant === 'major' ? level * 10 : level * 5;
      var label = variant === 'major' ? '大吉' : '小吉';

      this.skillSystem.pendingForces.push({
        ownerId: this.humanPlayerId,
        ownerName: skill.ownerName || 'PLAYER',
        type: 'fortune',
        level: level,
        power: power,
        activation: 'active',
        source: 'active'
      });

      var icon = variant === 'major' ? '✦' : '✧';
      if (this.onMessage) this.onMessage(icon + ' 魔运·' + label + ' — 命运向你倾斜...');
      if (this.onLog) this.onLog('SKILL_USE', {
        skill: '魔运·' + label,
        manaRemaining: this.skillSystem.getMana(this.humanPlayerId).current
      });
    }

    _activateForesight(skill) {
      var cost = skill.manaCost || 10;
      if (!this.skillSystem.spendMana(this.humanPlayerId, cost)) {
        if (this.onMessage) this.onMessage('魔运不足');
        return;
      }
      var ctx = this._gameCtx;
      var previews = this.foresight(ctx.deckCards, ctx.board, ctx.players);
      this._showForesight(previews);
      if (this.onMessage) this.onMessage('👁 魔运·先知 — 窥视命运的三条路径...');
      if (this.onLog) this.onLog('SKILL_USE', {
        skill: '魔运·先知',
        manaRemaining: this.skillSystem.getMana(this.humanPlayerId).current,
        previews: previews
      });
    }

    _activatePeek(skill) {
      var ctx = this._gameCtx;
      var targets = (ctx.players || []).filter(function (p) {
        return p.type === 'ai' && !p.folded && p.cards && p.cards.length >= 2;
      });
      if (targets.length === 0) {
        if (this.onMessage) this.onMessage('没有可透视的对手');
        return;
      }
      // 打开透视面板
      this._showPeekPanel(skill, targets);
    }

    _showPeekPanel(skill, targets) {
      var panel = document.getElementById('peek-panel');
      if (!panel) return;
      var self = this;
      var selectedTier = null;
      var mana = this.skillSystem.getMana(this.humanPlayerId);

      // 构建 tier 按钮
      var tiersEl = document.getElementById('peek-tiers');
      tiersEl.innerHTML = '';
      for (var i = 0; i < PEEK_TIERS.length; i++) {
        (function (tierDef) {
          var btn = document.createElement('button');
          btn.className = 'peek-tier-btn';
          btn.disabled = mana.current < tierDef.cost;
          btn.innerHTML = tierDef.name + '<span class="peek-tier-cost">' + tierDef.cost + ' MP</span>';
          btn.title = tierDef.description;
          btn.addEventListener('click', function () {
            selectedTier = tierDef;
            // 高亮选中
            var allBtns = tiersEl.querySelectorAll('.peek-tier-btn');
            for (var j = 0; j < allBtns.length; j++) allBtns[j].classList.remove('active');
            btn.classList.add('active');
            // 启用目标按钮
            var targetBtns = document.getElementById('peek-targets').querySelectorAll('.peek-target-btn');
            for (var j = 0; j < targetBtns.length; j++) targetBtns[j].disabled = false;
          });
          tiersEl.appendChild(btn);
        })(PEEK_TIERS[i]);
      }

      // 构建目标按钮
      var targetsEl = document.getElementById('peek-targets');
      targetsEl.innerHTML = '';
      for (var t = 0; t < targets.length; t++) {
        (function (target) {
          var btn = document.createElement('button');
          btn.className = 'peek-target-btn';
          btn.textContent = target.name;
          btn.disabled = true; // 先选 tier
          btn.addEventListener('click', function () {
            if (!selectedTier) return;
            self._executePeek(skill, selectedTier, target);
            panel.style.display = 'none';
          });
          targetsEl.appendChild(btn);
        })(targets[t]);
      }

      // 取消按钮
      var cancelBtn = document.getElementById('peek-cancel-btn');
      cancelBtn.onclick = function () { panel.style.display = 'none'; };

      panel.style.display = 'block';
    }

    _executePeek(skill, tierDef, target) {
      // 扣 mana
      if (!this.skillSystem.spendMana(this.humanPlayerId, tierDef.cost)) {
        if (this.onMessage) this.onMessage('魔运不足');
        return;
      }

      var RANK_NAMES = { 1: 'A', 2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: '10', 11: 'J', 12: 'Q', 13: 'K' };
      var SUIT_NAMES = { 0: '♠', 1: '♥', 2: '♣', 3: '♦' };

      if (tierDef.tier === 3) {
        // 完全透视：直接翻开手牌
        target.cards.forEach(function (c) {
          if (c.$el && !c.$el.classList.contains('peek-revealed')) {
            c.setSide('front');
            c.$el.classList.add('peek-revealed');
          }
        });
        this.skillSystem.emit('peek:reveal', { targetId: target.id, targetName: target.name, tier: 3 });
        if (this.onMessage) this.onMessage('🃏 完全透视 — ' + target.name + ' 的底牌完全暴露！');
      } else if (tierDef.tier === 2) {
        // 深层透视：按概率分析（高/中/低概率）
        var cards = target.cards;
        var lines = [];
        for (var i = 0; i < cards.length; i++) {
          var c = cards[i];
          var rName = RANK_NAMES[c.rank] || '?';
          var sName = SUIT_NAMES[c.suit] || '?';
          // 真实牌作为高概率，生成干扰项
          var roll = Math.random();
          if (roll < 0.7) {
            // 70% 概率正确显示为高概率
            lines.push('<span class="peek-confidence-high">高概率</span> ' + sName + rName);
          } else {
            // 30% 概率降级为中概率
            lines.push('<span class="peek-confidence-mid">中概率</span> ' + sName + rName);
          }
        }
        // 加入1-2个干扰项（低概率）
        var fakeCount = 1 + Math.floor(Math.random() * 2);
        for (var f = 0; f < fakeCount; f++) {
          var fakeRank = RANK_NAMES[1 + Math.floor(Math.random() * 13)];
          var fakeSuit = SUIT_NAMES[Math.floor(Math.random() * 4)];
          lines.push('<span class="peek-confidence-low">低概率</span> ' + fakeSuit + fakeRank);
        }
        // 打乱顺序
        lines.sort(function () { return Math.random() - 0.5; });
        this._showPeekResult(target.name, '深层透视', lines.join('<br>'));
        if (this.onMessage) this.onMessage('🃏 深层透视 — 感知到 ' + target.name + ' 的手牌波动...');
      } else {
        // 模糊透视：告诉可能的牌型范围
        var cards = target.cards;
        var hints = [];
        for (var i = 0; i < cards.length; i++) {
          var c = cards[i];
          var r = c.rank;
          // 模糊化：只给范围
          if (r >= 10) hints.push('高牌 (10~A)');
          else if (r >= 6) hints.push('中牌 (6~9)');
          else hints.push('低牌 (2~5)');
        }
        // 花色只给一个模糊提示
        var suits = {};
        cards.forEach(function (c) { suits[c.suit] = true; });
        var suitCount = Object.keys(suits).length;
        if (suitCount === 1) hints.push('同花色');
        else hints.push('混合花色');

        this._showPeekResult(target.name, '模糊透视', hints.map(function (h) { return '• ' + h; }).join('<br>'));
        if (this.onMessage) this.onMessage('🃏 模糊透视 — 隐约感知到 ' + target.name + ' 的牌力...');
      }

      if (this.onLog) this.onLog('SKILL_USE', {
        skill: '透视·' + tierDef.name,
        tier: tierDef.tier,
        target: target.name,
        cost: tierDef.cost,
        manaRemaining: this.skillSystem.getMana(this.humanPlayerId).current
      });
    }

    _showPeekResult(targetName, tierName, contentHtml) {
      // 创建浮层显示结果
      var existing = document.querySelector('.peek-result-overlay');
      if (existing) existing.remove();

      var overlay = document.createElement('div');
      overlay.className = 'peek-result-overlay';
      overlay.innerHTML =
        '<div class="peek-result-title">🃏 ' + tierName + ' — ' + targetName + '</div>' +
        '<div class="peek-result-content">' + contentHtml + '</div>';
      document.body.appendChild(overlay);

      // 3秒后自动消失
      setTimeout(function () {
        overlay.style.opacity = '0';
        overlay.style.transition = 'opacity 0.5s';
        setTimeout(function () { overlay.remove(); }, 500);
      }, 3500);
    }

    _activateReversal(skill) {
      var cost = skill.manaCost || 25;
      if (!this.skillSystem.spendMana(this.humanPlayerId, cost)) {
        if (this.onMessage) this.onMessage('魔运不足');
        return;
      }
      // 找到 pendingForces 中针对玩家的诅咒，转化为自己的 fortune
      var converted = 0;
      var pending = this.skillSystem.pendingForces;
      for (var i = 0; i < pending.length; i++) {
        var f = pending[i];
        if (f.type === 'curse' && f.targetId === this.humanPlayerId) {
          // 转化：诅咒变祝福，归属变为玩家
          f.type = 'fortune';
          f.ownerId = this.humanPlayerId;
          f.ownerName = skill.ownerName || 'RINO';
          f.power = Math.round(f.power * 0.6); // 转化效率60%
          delete f.targetId;
          converted++;
        }
      }
      if (converted > 0) {
        if (this.onMessage) this.onMessage('↺ 逆转 — ' + converted + '道厄运被转化为命运之力！');
      } else {
        if (this.onMessage) this.onMessage('↺ 逆转 — 未检测到厄运…力量消散了');
      }
      if (this.onLog) this.onLog('SKILL_USE', {
        skill: '逆转',
        converted: converted,
        manaRemaining: this.skillSystem.getMana(this.humanPlayerId).current
      });
    }

    _activateBlank(skill) {
      this.skillSystem.pendingForces = [];
      this.skillSystem.pendingForces.push({
        ownerId: -1, ownerName: 'KAZU', type: 'blank',
        level: 0, power: 0, activation: 'active', source: 'active'
      });
      if (this.onMessage) this.onMessage('◇ 空白因子 — 命运回归混沌...');
      if (this.onLog) this.onLog('SKILL_USE', { skill: '空白因子' });
    }

    _activateGeneric(skill) {
      var result = this.skillSystem.activatePlayerSkill(skill.uniqueId);
      if (!result.success) {
        if (this.onMessage) this.onMessage('技能不可用: ' + (result.reason || ''));
        return;
      }
      if (this.onMessage) this.onMessage('⚡ ' + (skill.description || skill.skillKey) + ' 已激活');
      if (this.onLog) this.onLog('SKILL_USE', {
        skill: skill.skillKey,
        manaRemaining: this.skillSystem.getMana(this.humanPlayerId).current
      });
    }

    // ========== UI 生成（数据驱动，不硬编码） ==========

    /**
     * 从 skillSystem 注册表自动生成技能按钮
     */
    _buildSkillButtons() {
      if (!this.containers.skillPanel || !this.skillSystem) return;

      // 清空现有按钮
      this.containers.skillPanel.innerHTML = '';
      this._buttons.clear();

      // 获取人类玩家的技能
      var humanSkills = this.skillSystem.getPlayerSkills(this.humanPlayerId);

      // 按 effect 排序: fortune → foresight → sense → blank
      var order = { fortune: 0, curse: 1, foresight: 2, peek: 3, reversal: 4, sense: 5, blank: 6 };
      humanSkills.sort(function (a, b) {
        return (order[a.effect] || 99) - (order[b.effect] || 99);
      });

      var addedFortune = false;

      for (var i = 0; i < humanSkills.length; i++) {
        var skill = humanSkills[i];

        // 被动技能（sense等）不生成按钮
        if (skill.activation === 'passive') continue;

        // fortune 类特殊处理：生成大吉+小吉两个按钮
        if (skill.effect === 'fortune' && !addedFortune) {
          addedFortune = true;
          this._createButton(skill, BEHAVIOR.FORTUNE_MAJOR, {
            icon: '✦', name: '大吉', cost: skill.manaCost
          });
          this._createButton(skill, BEHAVIOR.FORTUNE_MINOR, {
            icon: '✧', name: '小吉', cost: Math.round((skill.manaCost || 20) * 0.75)
          });
          continue;
        } else if (skill.effect === 'fortune' && addedFortune) {
          continue; // 跳过重复的 fortune
        }

        // foresight
        if (skill.effect === 'foresight') {
          this._createButton(skill, BEHAVIOR.FORESIGHT, {
            icon: '👁', name: '先知', cost: skill.manaCost
          });
          continue;
        }

        // peek
        if (skill.effect === 'peek') {
          this._createButton(skill, BEHAVIOR.PEEK, {
            icon: '🃏', name: '透视', cost: PEEK_TIERS[0].cost + '~' + PEEK_TIERS[2].cost
          });
          continue;
        }

        // reversal
        if (skill.effect === 'reversal') {
          this._createButton(skill, BEHAVIOR.REVERSAL, {
            icon: '↺', name: '逆转', cost: skill.manaCost
          });
          continue;
        }

        // blank
        if (skill.effect === 'blank') {
          // 在 blank 前加分隔线
          var divider = document.createElement('div');
          divider.className = 'skill-divider';
          this.containers.skillPanel.appendChild(divider);

          this._createButton(skill, BEHAVIOR.BLANK, {
            icon: '◇', name: '空白', cost: null
          });
          continue;
        }

        // 通用主动技能
        var visual = EFFECT_VISUALS[skill.effect] || EFFECT_VISUALS.fortune;
        this._createButton(skill, BEHAVIOR.GENERIC_ACTIVE, {
          icon: visual.icon, name: skill.skillKey, cost: skill.manaCost
        });
      }

      // 如果有 blank factor（非人类玩家拥有但可用），也加上
      // 检查是否有 Kazu 的空白因子
      var allSkills = Array.from(this.skillSystem.skills.values());
      var blankSkill = allSkills.find(function (s) {
        return s.effect === 'blank' && s.ownerId !== 0;
      });
      if (blankSkill && !this._buttons.has('blank_factor')) {
        var divider2 = document.createElement('div');
        divider2.className = 'skill-divider';
        this.containers.skillPanel.appendChild(divider2);

        this._createButton(blankSkill, BEHAVIOR.BLANK, {
          icon: '◇', name: '空白', cost: null
        });
      }
    }

    /**
     * 创建单个技能按钮
     */
    _createButton(skill, behavior, visual) {
      var btn = document.createElement('button');
      var cssClass = (EFFECT_VISUALS[skill.effect] || EFFECT_VISUALS.fortune).cssClass;
      btn.className = 'skill-btn ' + cssClass;
      btn.disabled = true;

      var title = (visual.name || skill.skillKey);
      if (visual.cost) title += ' (' + visual.cost + ' Mana)';
      if (skill.description) title += '\n' + skill.description;
      btn.title = title;

      btn.innerHTML =
        '<span class="skill-icon">' + visual.icon + '</span>' +
        '<span class="skill-name">' + (visual.name || skill.skillKey) + '</span>' +
        (visual.cost ? '<span class="skill-cost">' + visual.cost + '</span>' : '');

      var self = this;
      btn.addEventListener('click', function () {
        self._activateSkill(behavior, skill);
      });

      this.containers.skillPanel.appendChild(btn);

      var buttonId = skill.uniqueId + '_' + behavior;
      this._buttons.set(buttonId, {
        element: btn,
        skill: skill,
        behavior: behavior,
        actualCost: visual.cost || skill.manaCost || 0
      });
    }

    // ========== Hook 监听 ==========

    _wireHooks() {
      if (!this.skillSystem) return;
      var self = this;

      // 感知事件
      this.skillSystem.on('sense:detected', function (data) {
        self._showSenseAlert(data.detail.message);
      });
      this.skillSystem.on('sense:vague', function (data) {
        self._showSenseAlert(data.message);
      });

      // NPC 技能使用
      this.skillSystem.on('npc:skill_used', function (data) {
        if (self.onLog) {
          self.onLog('NPC_SKILL', {
            owner: data.ownerName, skill: data.skillKey,
            effect: data.effect, level: data.level
          });
        }
      });

      // mana 变化
      this.skillSystem.on('mana:changed', function () {
        self.updateDisplay();
      });

      // 反噬
      this.skillSystem.on('backlash:start', function () {
        self.updateDisplay();
        self.updateButtons();
      });
    }

    // ========== 子面板 ==========

    _showForesight(previews) {
      if (!this.containers.foresightPanel || !previews || previews.length === 0) return;

      this.containers.foresightPanel.innerHTML = previews.map(function (p) {
        var labelClass = p.label === 'BEST' ? 'foresight-best' :
                         p.label === 'WORST' ? 'foresight-worst' : 'foresight-neutral';
        return '<div class="foresight-card ' + labelClass + '">' +
          '<div class="foresight-label">' + p.label + '</div>' +
          '<div class="foresight-value">' + p.card + '</div>' +
          '<div class="foresight-score">' + Math.round(p.rinoScore) + '%</div>' +
          '</div>';
      }).join('');

      this.containers.foresightPanel.style.display = 'flex';
      var panel = this.containers.foresightPanel;
      setTimeout(function () {
        if (panel) panel.style.display = 'none';
      }, 5000);
    }

    _hideForesight() {
      if (this.containers.foresightPanel) {
        this.containers.foresightPanel.style.display = 'none';
      }
    }

    _showSenseAlert(message) {
      if (!message) return;
      var el = this.containers.senseAlert;
      if (el) {
        el.textContent = message;
        el.style.display = 'block';
        el.classList.add('sense-flash');
        setTimeout(function () {
          el.style.display = 'none';
          el.classList.remove('sense-flash');
        }, 4000);
      }
      if (this.onMessage) this.onMessage('🔮 ' + message);
      if (this.onLog) this.onLog('SENSE', { message: message });
    }

    _hideSenseAlert() {
      if (this.containers.senseAlert) {
        this.containers.senseAlert.style.display = 'none';
        this.containers.senseAlert.classList.remove('sense-flash');
      }
    }

    // ========== 状态查询 ==========

    getState() {
      if (!this.skillSystem) return {};
      return this.skillSystem.getState();
    }

    getForcesSummary() {
      if (!this.skillSystem) return { allies: [], enemies: [], total: { ally: 0, enemy: 0 } };
      return this.skillSystem.getForcesSummary();
    }
  }

  // ========== 导出 ==========
  global.SkillUI = SkillUI;
  global.SkillUI.BEHAVIOR = BEHAVIOR;
  global.SkillUI.EFFECT_VISUALS = EFFECT_VISUALS;

})(typeof window !== 'undefined' ? window : global);
