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
  // 按 effect 类型（与 UNIVERSAL_SKILLS 的 effect 字段对应）
  // SVG 图标工厂（16x16 viewBox，用 CSS 控制大小）
  var _svg = function (path, color) {
    return '<svg class="skill-svg-icon" viewBox="0 0 16 16" fill="' + color + '">' + path + '</svg>';
  };
  var _svgS = function (path, color) {
    return '<svg class="skill-svg-icon" viewBox="0 0 16 16" fill="none" stroke="' + color + '" stroke-width="1.5">' + path + '</svg>';
  };

  var SVG_PATHS = {
    fortune:  '<path d="M8 1l2.2 4.5L15 6.3l-3.5 3.4.8 4.8L8 12.3 3.7 14.5l.8-4.8L1 6.3l4.8-.8z"/>',
    curse:    '<path d="M8 1C5.2 1 3 3.7 3 7c0 2.2 1 4 2.5 5h5C12 11 13 9.2 13 7c0-3.3-2.2-6-5-6zM6 12v1c0 .6.9 1 2 1s2-.4 2-1v-1H6z"/>',
    sense:    '<circle cx="8" cy="8" r="3"/><circle cx="8" cy="8" r="6" fill="none" stroke-width="1.2"/>',
    peek:     '<path d="M8 3C4.4 3 1.4 5.4 0 8c1.4 2.6 4.4 5 8 5s6.6-2.4 8-5c-1.4-2.6-4.4-5-8-5zm0 8.3c-1.8 0-3.3-1.5-3.3-3.3S6.2 4.7 8 4.7s3.3 1.5 3.3 3.3S9.8 11.3 8 11.3zM8 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/>',
    reversal: '<path d="M2 5h9l-3-3h2l4 4-4 4h-2l3-3H2V5zm12 6H5l3 3H6l-4-4 4-4h2L5 9h9v2z"/>',
    null_field:'<circle cx="8" cy="8" r="6"/><line x1="4" y1="12" x2="12" y2="4"/>',
    void_shield:'<path d="M8 1L2 4v4c0 3.3 2.6 6.4 6 7 3.4-.6 6-3.7 6-7V4L8 1z"/>',
    purge_all:'<path d="M8 2L3 8l5 6 5-6-5-6z"/>'
  };

  // attr → hero-card skin class
  var ATTR_TO_SKIN = {
    moirai: 'skin-moirai',
    chaos:  'skin-chaos',
    psyche: 'skin-psyche',
    void:   'skin-void'
  };

  // Large SVG paths for hero-card background icon (24x24 viewBox)
  var BG_SVG_PATHS = {
    fortune:    '<path d="M12 2l2.4 7.2h7.6l-6 4.8 2.4 7.2-6-4.8-6 4.8 2.4-7.2-6-4.8h7.6z"/>',
    curse:      '<path d="M12 2C8.1 2 5 6 5 10.5c0 3 1.5 5.5 3.5 7h7c2-1.5 3.5-4 3.5-7C19 6 15.9 2 12 2zM9 19v1.5c0 .8 1.3 1.5 3 1.5s3-.7 3-1.5V19H9z"/>',
    peek:       '<path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/>',
    reversal:   '<path d="M3 7h13l-4-4h3l5 5.5-5 5.5h-3l4-4H3V7zm18 10H8l4 4H9l-5-5.5L9 10h3l-4 4h13v3z"/>',
    purge_all:  '<path d="M12 2L2 12l10 10 10-10L12 2z"/>',
    null_field:  '<circle cx="12" cy="12" r="9"/><line x1="6" y1="18" x2="18" y2="6"/>',
    void_shield: '<path d="M12 1L3 5v6c0 5.5 3.8 10.7 9 12 5.2-1.3 9-6.5 9-12V5L12 1z"/>'
  };

  var EFFECT_VISUALS = {
    fortune:     { icon: _svg(SVG_PATHS.fortune, '#9B59B6'),   cssClass: 'moirai-skill', color: '#9B59B6', attr: 'moirai' },
    curse:       { icon: _svg(SVG_PATHS.curse, '#e74c3c'),     cssClass: 'chaos-skill',  color: '#e74c3c', attr: 'chaos' },
    sense:       { icon: _svg(SVG_PATHS.sense, '#a29bfe'),     cssClass: 'psyche-skill', color: '#a29bfe', attr: 'psyche' },
    peek:        { icon: _svg(SVG_PATHS.peek, '#3498db'),      cssClass: 'psyche-skill', color: '#3498db', attr: 'psyche' },
    reversal:    { icon: _svg(SVG_PATHS.reversal, '#1abc9c'),  cssClass: 'psyche-skill', color: '#1abc9c', attr: 'psyche' },
    null_field:  { icon: _svgS(SVG_PATHS.null_field, '#95a5a6'), cssClass: 'void-skill', color: '#95a5a6', attr: 'void' },
    void_shield: { icon: _svgS(SVG_PATHS.void_shield, '#7f8c8d'), cssClass: 'void-skill', color: '#7f8c8d', attr: 'void' },
    purge_all:   { icon: _svgS(SVG_PATHS.purge_all, '#bdc3c7'), cssClass: 'void-skill', color: '#bdc3c7', attr: 'void' }
  };

  // 技能显示名（skillKey → 中文名）
  const SKILL_NAMES = {
    minor_wish:   '小吉',
    grand_wish:   '大吉',
    divine_order: '天命',
    hex:          '小凶',
    havoc:        '大凶',
    catastrophe:  '灾变',
    insight:      '洞察',
    vision:       '透视',
    axiom:        '真理',
    static_field: '屏蔽',
    insulation:   '绝缘',
    reality:      '现实'
  };

  // 行为分类（决定按钮逻辑和 UI 交互方式）
  const BEHAVIOR = {
    FORCE:   'force',    // 影响发牌的力量型技能 (fortune, curse, reversal, purge_all)
    INFO:    'info',     // 信息型技能 (peek — 需要选目标)
    PASSIVE: 'passive'   // 被动技能 (sense, null_field, void_shield — 不生成按钮)
  };

  // effect → behavior 映射
  function effectToBehavior(effect, activation) {
    if (activation === 'passive') return BEHAVIOR.PASSIVE;
    if (effect === 'peek') return BEHAVIOR.INFO;
    return BEHAVIOR.FORCE;
  }

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

      console.log('[SkillUI.selectCard]', {
        pendingCount: this.skillSystem.pendingForces.length,
        totalForces: forces.length,
        forces: forces.map(f => f.ownerName + ' ' + f.type + ' P=' + f.power)
      });

      const result = this.moz.selectCard(
        deckCards, board, players, forces,
        { rinoPlayerId: this.humanPlayerId }
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
        if (!this._manaBarBase) {
          this._manaBarBase = this.containers.manaBar.classList.contains('mp-fluid') ? 'mp-fluid mana-fill' : 'mana-fill';
        }
        var baseClass = this._manaBarBase;
        if (pct > 50) {
          this.containers.manaBar.className = baseClass + ' high';
        } else if (pct > 20) {
          this.containers.manaBar.className = baseClass + ' medium';
        } else {
          this.containers.manaBar.className = baseClass + ' low';
        }
      }

      if (this.containers.manaText) {
        this.containers.manaText.textContent = 'MP ' + mana.current + '/' + mana.max;
      }

      // 反噬指示器
      if (this.containers.backlashIndicator) {
        if (ss.backlash.active) {
          this.containers.backlashIndicator.style.display = 'block';
          this.containers.backlashIndicator.textContent = 'BACKLASH (' + ss.backlash.counter + ')';
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
     * 更新所有技能按钮的可用状态（通用）
     */
    updateButtons() {
      if (!this.skillSystem) return;
      var ss = this.skillSystem.getState();
      var ctx = this._gameCtx;
      var isBettingPhase = ['preflop', 'flop', 'turn', 'river'].indexOf(ctx.phase) >= 0;
      var isPlayerTurn = isBettingPhase && ctx.isPlayerTurn;
      var mana = this.skillSystem.getMana(this.humanPlayerId);
      var canUse = isPlayerTurn && !ss.backlash.active;
      var isRiver = ctx.phase === 'river';

      // 检查是否已有同 effect 的 force pending（玩家方）
      var queuedEffects = {};
      ss.pendingForces.forEach(function (f) {
        if (f.ownerId === 0) queuedEffects[f.type] = true;
      });

      for (var entry of this._buttons) {
        var btnInfo = entry[1];
        var btn = btnInfo.element;
        var skill = btnInfo.skill;
        var behavior = btnInfo.behavior;
        if (!btn) continue;

        var cost = skill.manaCost || 0;
        var disabled = true;

        switch (behavior) {
          case BEHAVIOR.FORCE:
            // 力量型：river 无意义，同 effect 不能重复激活，需要 mana
            var isForceEffect = (skill.effect === 'fortune' || skill.effect === 'curse' || skill.effect === 'purge_all');
            disabled = !canUse || mana.current < cost || skill.currentCooldown > 0;
            if (isRiver && isForceEffect) disabled = true;
            if (queuedEffects[skill.effect]) disabled = true;
            btn.classList.toggle('skill-active', !!queuedEffects[skill.effect]);
            break;
          case BEHAVIOR.INFO:
            // 信息型（透视）：需要 mana，不受 river 限制
            disabled = !canUse || mana.current < cost || skill.currentCooldown > 0;
            break;
        }

        btn.disabled = disabled;
      }
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
        case BEHAVIOR.FORCE:
          this._activateForce(skill);
          break;
        case BEHAVIOR.INFO:
          this._activateInfo(skill);
          break;
      }

      this.updateDisplay();
      this.updateButtons();
    }

    /**
     * 力量型技能激活（fortune, curse, reversal, purge_all）
     * 统一走 skillSystem.activatePlayerSkill()
     */
    _activateForce(skill) {
      var result = this.skillSystem.activatePlayerSkill(skill.uniqueId);
      if (!result.success) {
        var reasons = {
          SKILL_NOT_FOUND: '技能不存在',
          NOT_ACTIVE_TYPE: '被动技能无法手动激活',
          BACKLASH_ACTIVE: '魔运反噬中',
          ON_COOLDOWN: '冷却中 (' + (result.cooldown || 0) + '轮)',
          INSUFFICIENT_MANA: '魔运不足 (需要 ' + (result.cost || 0) + ')'
        };
        if (this.onMessage) this.onMessage(reasons[result.reason] || '技能不可用');
        return;
      }

      var name = SKILL_NAMES[skill.skillKey] || skill.skillKey;
      if (this.onMessage) this.onMessage('[' + name + '] ' + (skill.description || '已激活'));
      if (this.onLog) this.onLog('SKILL_USE', {
        skill: name,
        skillKey: skill.skillKey,
        tier: skill.tier,
        manaRemaining: this.skillSystem.getMana(this.humanPlayerId).current
      });
    }

    /**
     * 信息型技能激活（peek/vision — 透视）
     * 需要选择目标，然后根据技能等级决定透视精度
     */
    _activateInfo(skill) {
      if (skill.effect === 'peek') {
        this._activatePeek(skill);
      }
    }

    _activatePeek(skill) {
      var self = this;

      // 再次点击取消透视瞄准
      if (self._peekHandlers) {
        self._peekCleanup();
        if (self.onMessage) self.onMessage('透视已取消');
        return;
      }

      var ctx = this._gameCtx;
      var targets = (ctx.players || []).filter(function (p) {
        return p.type === 'ai' && !p.folded && p.cards && p.cards.length >= 2;
      });
      if (targets.length === 0) {
        if (this.onMessage) this.onMessage('没有可透视的对手');
        return;
      }

      var cost = skill.manaCost || 15;
      var tier = skill.tier || 3;

      // 高亮所有可透视的座位，点击座位选择目标
      self._peekCleanup(); // 清除之前的状态

      if (this.onMessage) this.onMessage('选择透视目标 -- 点击对手座位 (再次点击技能取消)');

      // 给每个可透视目标的座位加高亮 + 点击事件
      self._peekHandlers = [];
      for (var t = 0; t < targets.length; t++) {
        (function (target) {
          var seatEl = document.getElementById('seat-' + target.id);
          if (!seatEl) return;

          seatEl.classList.add('peek-targetable');

          var handler = function () {
            // 扣 mana
            if (!self.skillSystem.spendMana(self.humanPlayerId, cost)) {
              if (self.onMessage) self.onMessage('魔运不足');
              self._peekCleanup();
              return;
            }
            self._peekCleanup();
            // 注入 peek 标记到 pendingForces（用于 Psyche > Chaos 克制）
            if (self.skillSystem && self.skillSystem.pendingForces) {
              self.skillSystem.pendingForces.push({
                ownerId: self.humanPlayerId,
                ownerName: 'RINO',
                type: 'peek',
                attr: 'psyche',
                tier: skill.tier,
                power: 0,
                activation: 'active',
                skillKey: skill.skillKey,
                _infoMarker: true
              });
            }
            self._executePeek(skill, target, tier);
          };
          seatEl.addEventListener('click', handler);
          self._peekHandlers.push({ el: seatEl, handler: handler });
        })(targets[t]);
      }

      // ESC 或点击空白取消
      self._peekEscHandler = function (e) {
        if (e.key === 'Escape') self._peekCleanup();
      };
      document.addEventListener('keydown', self._peekEscHandler);

      // 隐藏旧面板
      var panel = document.getElementById('peek-panel');
      if (panel) panel.style.display = 'none';
    }

    _peekCleanup() {
      // 移除所有座位高亮和点击事件
      if (this._peekHandlers) {
        for (var i = 0; i < this._peekHandlers.length; i++) {
          var h = this._peekHandlers[i];
          h.el.classList.remove('peek-targetable');
          h.el.removeEventListener('click', h.handler);
        }
        this._peekHandlers = null;
      }
      if (this._peekEscHandler) {
        document.removeEventListener('keydown', this._peekEscHandler);
        this._peekEscHandler = null;
      }
    }

    _executePeek(skill, target, tier) {
      var RANK_NAMES = { 1: 'A', 2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: 'T', 11: 'J', 12: 'Q', 13: 'K' };
      var SUIT_SYMBOLS = { 0: '♠', 1: '♥', 2: '♣', 3: '♦' };
      var SUIT_COLORS = { 0: '#ecf0f1', 1: '#e74c3c', 2: '#2ecc71', 3: '#3498db' };

      // ---- Moirai > Psyche 克制：幸运迷雾降低透视精度 ----
      // 目标拥有活跃 fortune forces 时，tier 被降级
      var effectiveTier = tier;
      if (this.skillSystem) {
        var targetFortunePower = (this.skillSystem.pendingForces || [])
          .filter(function (f) { return f.ownerId === target.id && f.type === 'fortune'; })
          .reduce(function (sum, f) { return sum + (f.power || 0); }, 0);
        if (targetFortunePower >= 30) {
          // 大吉级别(P30+)：降两级
          effectiveTier = Math.min(3, tier + 2);
          if (this.onMessage) this.onMessage('[幸运迷雾] ' + target.name + ' 的强运严重干扰了透视!');
        } else if (targetFortunePower >= 15) {
          // 小吉级别(P15+)：降一级
          effectiveTier = Math.min(3, tier + 1);
          if (this.onMessage) this.onMessage('[幸运迷雾] ' + target.name + ' 的运气干扰了透视精度');
        }
      }
      tier = effectiveTier;

      if (tier <= 1) {
        // T1: 直接翻开手牌（在座位上显示）
        target.cards.forEach(function (c) {
          if (c.$el && !c.$el.classList.contains('peek-revealed')) {
            c.setSide('front');
            c.$el.classList.add('peek-revealed');
          }
        });
        this.skillSystem.emit('peek:reveal', { targetId: target.id, targetName: target.name });
        this._showPeekCards(target, target.cards, 'perfect');
        if (this.onMessage) this.onMessage('[透视] ' + target.name + ' 的底牌完全暴露!');
      } else if (tier <= 2) {
        // T2: 概率分析 — 显示真实牌 + 干扰牌
        var realCards = [];
        var cards = target.cards;
        for (var i = 0; i < cards.length; i++) {
          realCards.push({
            rank: RANK_NAMES[cards[i].rank] || '?',
            suit: cards[i].suit,
            confidence: Math.random() < 0.7 ? 'high' : 'mid',
            real: true
          });
        }
        // 加 1~2 张干扰牌
        var fakeCount = 1 + Math.floor(Math.random() * 2);
        for (var f = 0; f < fakeCount; f++) {
          realCards.push({
            rank: RANK_NAMES[1 + Math.floor(Math.random() * 13)] || '?',
            suit: Math.floor(Math.random() * 4),
            confidence: 'low',
            real: false
          });
        }
        // 打乱顺序
        realCards.sort(function () { return Math.random() - 0.5; });
        this._showPeekCards(target, realCards, 'analysis');
        if (this.onMessage) this.onMessage('[透视] 感知到 ' + target.name + ' 的手牌波动...');
      } else {
        // T3: 模糊范围
        var cards = target.cards;
        var vague = [];
        for (var i = 0; i < cards.length; i++) {
          var r = cards[i].rank;
          var rangeText;
          if (r >= 10 || r === 1) rangeText = '高牌';
          else if (r >= 6) rangeText = '中牌';
          else rangeText = '低牌';
          vague.push({ rangeText: rangeText, suit: cards[i].suit, confidence: 'vague' });
        }
        this._showPeekCards(target, vague, 'vague');
        if (this.onMessage) this.onMessage('[透视] 隐约感知到 ' + target.name + ' 的牌力...');
      }

      if (this.onLog) this.onLog('SKILL_USE', {
        skill: SKILL_NAMES[skill.skillKey] || '透视',
        target: target.name,
        tier: tier,
        manaRemaining: this.skillSystem.getMana(this.humanPlayerId).current
      });
    }

    _showPeekCards(target, cardData, mode) {
      // suit index → deck-of-cards CSS class name
      var SUIT_CLASSES = { 0: 'spades', 1: 'hearts', 2: 'clubs', 3: 'diamonds' };
      var CONF_LABELS = { high: '确信', mid: '模糊', low: '干扰', vague: '感知' };
      var CONF_CLASSES = { high: 'peek-conf-high', mid: 'peek-conf-mid', low: 'peek-conf-low', vague: 'peek-conf-vague' };
      // rank number → deck-of-cards rank class number (1=A, 11=J, 12=Q, 13=K)
      var RANK_NAMES = { 1: 'A', 2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: 'T', 11: 'J', 12: 'Q', 13: 'K' };

      // 移除旧的
      var existing = document.querySelector('.peek-result-overlay');
      if (existing) existing.remove();

      var overlay = document.createElement('div');
      overlay.className = 'peek-result-overlay';

      var html = '<div class="peek-result-header">';
      html += '<div class="peek-result-title">[透视] ' + target.name + '</div>';
      if (mode === 'perfect') html += '<div class="peek-result-mode">完美透视</div>';
      else if (mode === 'analysis') html += '<div class="peek-result-mode">概率分析</div>';
      else html += '<div class="peek-result-mode">模糊感知</div>';
      html += '</div>';

      html += '<div class="peek-cards-row">';
      for (var i = 0; i < cardData.length; i++) {
        var cd = cardData[i];
        var conf = cd.confidence || 'high';
        var confLabel = CONF_LABELS[conf] || '';
        var confClass = CONF_CLASSES[conf] || '';

        html += '<div class="peek-card-wrapper">';
        if (mode === 'vague') {
          // 模糊模式：显示牌背 + 范围文字
          var vaguesuit = SUIT_CLASSES[cd.suit] || 'spades';
          html += '<div class="card peek-deck-card ' + vaguesuit + '">';
          html += '<div class="back"></div>';
          html += '</div>';
          html += '<div class="peek-card-range-label">' + cd.rangeText + '</div>';
        } else {
          // 正常/分析模式：用 deck-of-cards 的 .card 样式
          var suitCls = SUIT_CLASSES[cd.suit] || 'spades';
          var rankNum = cd.rank;
          // cd.rank 可能是数字(来自 target.cards) 或字符串(来自 RANK_NAMES 转换)
          if (typeof rankNum === 'string') {
            // 从字符串反查数字: A=1, T=10, J=11, Q=12, K=13
            var rkMap = { A:1, '2':2, '3':3, '4':4, '5':5, '6':6, '7':7, '8':8, '9':9, T:10, J:11, Q:12, K:13 };
            rankNum = rkMap[rankNum] || 1;
          }
          html += '<div class="card peek-deck-card ' + suitCls + ' rank' + rankNum + '">';
          html += '<div class="face"></div>';
          html += '</div>';
        }
        if (mode === 'analysis') {
          html += '<div class="peek-card-conf ' + confClass + '">' + confLabel + '</div>';
        }
        html += '</div>';
      }
      html += '</div>';

      overlay.innerHTML = html;
      overlay.addEventListener('click', function () {
        overlay.style.opacity = '0';
        overlay.style.transition = 'opacity 0.3s';
        setTimeout(function () { overlay.remove(); }, 300);
      });
      document.body.appendChild(overlay);

      // 自动消失
      setTimeout(function () {
        if (overlay.parentNode) {
          overlay.style.opacity = '0';
          overlay.style.transition = 'opacity 0.5s';
          setTimeout(function () { if (overlay.parentNode) overlay.remove(); }, 500);
        }
      }, 6000);
    }

    // ========== UI 生成（数据驱动） ==========

    /**
     * 从 skillSystem 注册表自动生成技能按钮
     */
    _buildSkillButtons() {
      if (!this.containers.skillPanel || !this.skillSystem) return;

      this.containers.skillPanel.innerHTML = '';
      this._buttons.clear();

      var humanSkills = this.skillSystem.getPlayerSkills(this.humanPlayerId);

      // 按属性分组排序：moirai → chaos → psyche → void，同属性内按 tier 升序 (T1 优先)
      var attrOrder = { moirai: 0, chaos: 1, psyche: 2, void: 3 };
      humanSkills.sort(function (a, b) {
        var ao = attrOrder[a.attr] != null ? attrOrder[a.attr] : 99;
        var bo = attrOrder[b.attr] != null ? attrOrder[b.attr] : 99;
        if (ao !== bo) return ao - bo;
        return a.tier - b.tier;
      });

      var lastAttr = null;

      for (var i = 0; i < humanSkills.length; i++) {
        var skill = humanSkills[i];
        var behavior = effectToBehavior(skill.effect, skill.activation);

        // 被动技能不生成按钮
        if (behavior === BEHAVIOR.PASSIVE) continue;

        // 属性分组分隔线
        if (lastAttr && skill.attr !== lastAttr) {
          var divider = document.createElement('div');
          divider.className = 'skill-divider';
          this.containers.skillPanel.appendChild(divider);
        }
        lastAttr = skill.attr;

        var visual = EFFECT_VISUALS[skill.effect] || EFFECT_VISUALS.fortune;
        var name = SKILL_NAMES[skill.skillKey] || skill.skillKey;

        this._createButton(skill, behavior, {
          icon: visual.icon, name: name, cost: skill.manaCost || null
        });
      }
    }

    /**
     * 创建单个技能按钮 — hero-card Tilt Icon 风格
     */
    _createButton(skill, behavior, visual) {
      var btn = document.createElement('button');
      var ev = EFFECT_VISUALS[skill.effect] || EFFECT_VISUALS.fortune;
      var skinClass = ATTR_TO_SKIN[ev.attr] || 'skin-moirai';
      btn.className = 'hero-card ' + skinClass;
      btn.disabled = true;

      var title = (visual.name || skill.skillKey);
      if (visual.cost) title += ' (' + visual.cost + ' Mana)';
      if (skill.description) title += '\n' + skill.description;
      btn.title = title;

      // Tier label
      var tierText = skill.tier ? 'Tier ' + skill.tier : '';
      if (skill.tier === 1) tierText = 'ULTIMATE';

      // Background tilted SVG icon (24x24 viewBox)
      var bgPath = BG_SVG_PATHS[skill.effect] || BG_SVG_PATHS.fortune || '';
      var bgFillOrStroke = (skill.effect === 'null_field' || skill.effect === 'void_shield' || skill.effect === 'purge_all')
        ? 'fill="none" stroke="currentColor" stroke-width="1.5"'
        : 'fill="currentColor"';
      var bgSvg = '<svg class="bg-icon-layer" viewBox="0 0 24 24" ' + bgFillOrStroke + '>' + bgPath + '</svg>';

      // Cost badge
      var costHtml = visual.cost
        ? '<div class="cost-badge">' + visual.cost + ' MP</div>'
        : '<div class="cost-badge">--</div>';

      btn.innerHTML =
        bgSvg +
        '<div class="card-top">' + costHtml + '</div>' +
        '<div class="card-bot">' +
          '<span class="meta-tier">' + tierText + '</span>' +
          '<span class="meta-name">' + (visual.name || skill.skillKey) + '</span>' +
        '</div>';

      var self = this;
      btn.addEventListener('click', function () {
        self._activateSkill(behavior, skill);
      });

      this.containers.skillPanel.appendChild(btn);

      var buttonId = skill.uniqueId;
      this._buttons.set(buttonId, {
        element: btn,
        skill: skill,
        behavior: behavior
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
            effect: data.effect, tier: data.tier
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
      if (this.onMessage) this.onMessage('[感知] ' + message);
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
  global.SkillUI.SKILL_NAMES = SKILL_NAMES;

})(typeof window !== 'undefined' ? window : global);
