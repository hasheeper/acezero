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
    fortune:    '<path d="M8 1l2.2 4.5L15 6.3l-3.5 3.4.8 4.8L8 12.3 3.7 14.5l.8-4.8L1 6.3l4.8-.8z"/>',
    curse:      '<path d="M8 1C5.2 1 3 3.7 3 7c0 2.2 1 4 2.5 5h5C12 11 13 9.2 13 7c0-3.3-2.2-6-5-6zM6 12v1c0 .6.9 1 2 1s2-.4 2-1v-1H6z"/>',
    clarity:    '<path d="M8 1.5l1.5 3 3.5.5-2.5 2.5.5 3.5L8 9.5 4.5 11l.5-3.5L2.5 5l3.5-.5z"/><line x1="3" y1="13" x2="13" y2="13" stroke-width="1.5"/>',
    refraction: '<path d="M4 3c2 3 6-1 8 2s-4 5-2 8"/><path d="M12 3c-2 3-6-1-8 2s4 5 2 8"/>',
    reversal:   '<path d="M2 5h9l-3-3h2l4 4-4 4h-2l3-3H2V5zm12 6H5l3 3H6l-4-4 4-4h2L5 9h9v2z"/>',
    null_field:  '<circle cx="8" cy="8" r="6"/><line x1="4" y1="12" x2="12" y2="4"/>',
    void_shield: '<path d="M8 1L2 4v4c0 3.3 2.6 6.4 6 7 3.4-.6 6-3.7 6-7V4L8 1z"/>',
    purge_all:   '<path d="M8 2L3 8l5 6 5-6-5-6z"/>'
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
    clarity:    '<path d="M12 2l2 5 5.5 1-4 4 1 5.5L12 15l-4.5 2.5 1-5.5-4-4 5.5-1z"/><line x1="4" y1="21" x2="20" y2="21" stroke-width="2"/>',
    refraction: '<path d="M5 4c3 5 9-2 12 3s-6 8-3 13"/><path d="M19 4c-3 5-9-2-12 3s6 8 3 13"/>',
    reversal:   '<path d="M3 7h13l-4-4h3l5 5.5-5 5.5h-3l4-4H3V7zm18 10H8l4 4H9l-5-5.5L9 10h3l-4 4h13v3z"/>',
    purge_all:  '<path d="M12 2L2 12l10 10 10-10L12 2z"/>',
    null_field:  '<circle cx="12" cy="12" r="9"/><line x1="6" y1="18" x2="18" y2="6"/>',
    void_shield: '<path d="M12 1L3 5v6c0 5.5 3.8 10.7 9 12 5.2-1.3 9-6.5 9-12V5L12 1z"/>'
  };

  var EFFECT_VISUALS = {
    fortune:     { icon: _svg(SVG_PATHS.fortune, '#9B59B6'),   cssClass: 'moirai-skill', color: '#9B59B6', attr: 'moirai' },
    curse:       { icon: _svg(SVG_PATHS.curse, '#e74c3c'),     cssClass: 'chaos-skill',  color: '#e74c3c', attr: 'chaos' },
    clarity:     { icon: _svgS(SVG_PATHS.clarity, '#74b9ff'),  cssClass: 'psyche-skill', color: '#74b9ff', attr: 'psyche' },
    refraction:  { icon: _svgS(SVG_PATHS.refraction, '#a29bfe'), cssClass: 'psyche-skill', color: '#a29bfe', attr: 'psyche' },
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
    clarity:      '澄澈',
    refraction:   '折射',
    axiom:        '真理',
    static_field: '屏蔽',
    insulation:   '绝缘',
    reality:      '现实'
  };

  // 行为分类（决定按钮逻辑和 UI 交互方式）
  const BEHAVIOR = {
    FORCE:   'force',    // 影响发牌的力量型技能 (fortune, curse, purge_all)
    PSYCHE:  'psyche',   // Psyche 双重效果技能 (clarity, refraction, reversal — 信息+反制)
    TOGGLE:  'toggle',   // 开关型技能 (void_shield 绝缘 — 0 mana, 手动切换)
    PASSIVE: 'passive'   // 被动技能 (null_field — 不生成按钮)
  };

  // effect → behavior 映射
  function effectToBehavior(effect, activation) {
    if (activation === 'passive') return BEHAVIOR.PASSIVE;
    if (activation === 'toggle') return BEHAVIOR.TOGGLE;
    // Psyche 技能: 双重效果 (信息必定触发 + 反制vs Chaos)
    if (effect === 'clarity' || effect === 'refraction' || effect === 'reversal') return BEHAVIOR.PSYCHE;
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
        foresightPanel: null  // 先知预览面板
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

      // 注入 curse 目标选择回调（委托给 PokerAI.SkillAI）
      var self = this;
      if (typeof PokerAI !== 'undefined' && PokerAI.SkillAI) {
        skillSystem.curseTargetFn = function(casterId, players) {
          // players 可能来自 _skillToForce 的 gameContext，也可能为 null
          var pList = players || (self._gameCtx && self._gameCtx.players) || [];
          // 查找施法者的 difficulty
          var caster = pList.find(function(p) { return p.id === casterId; });
          var difficulty = (caster && caster.personality && caster.personality.difficulty) || 'noob';
          return PokerAI.SkillAI.pickCurseTarget(difficulty, casterId, pList);
        };

        // 注入技能使用决策回调（委托给 PokerAI.SkillAI）
        skillSystem.skillDecideFn = function(skill, owner, gameContext, pendingForces, mana) {
          var pList = gameContext.players || (self._gameCtx && self._gameCtx.players) || [];
          var caster = pList.find(function(p) { return p.id === skill.ownerId; });
          var difficulty = (caster && caster.personality && caster.personality.difficulty) || 'noob';
          return PokerAI.SkillAI.shouldUseSkill(difficulty, skill, owner, gameContext, pendingForces, mana);
        };
      }

      // 监听 skillSystem 事件
      this._wireHooks();
    }

    /**
     * 从配置注册技能（委托给 skillSystem）+ 生成UI
     * @param {object} playerConfigs - 游戏配置
     * @param {object} [playerIdMap] - { heroId, seats: { BTN: id, ... } }
     */
    registerFromConfig(playerConfigs, playerIdMap) {
      if (!this.skillSystem) return;
      // 同步 humanPlayerId
      if (playerIdMap && playerIdMap.heroId != null) {
        this.humanPlayerId = playerIdMap.heroId;
      }
      this.skillSystem.registerFromConfig(playerConfigs, playerIdMap);
      this._buildSkillButtons();
    }

    // ========== 通用接口：游戏生命周期 ==========

    /**
     * 新一手牌
     */
    onNewHand() {
      if (this.skillSystem) this.skillSystem.onNewHand();
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
      var _hpid = this.humanPlayerId;
      ss.pendingForces.forEach(function (f) {
        if (f.ownerId === _hpid) queuedEffects[f.type] = true;
      });

      for (var entry of this._buttons) {
        var btnInfo = entry[1];
        var btn = btnInfo.element;
        var skill = btnInfo.skill;
        var behavior = btnInfo.behavior;
        if (!btn) continue;

        var cost = skill.manaCost || 0;
        var disabled = true;

        // 整局使用次数限制
        var noUsesLeft = skill.usesPerGame > 0 && skill.gameUsesRemaining <= 0;

        switch (behavior) {
          case BEHAVIOR.FORCE:
            // 力量型：river 无意义，同 effect 不能重复激活，需要 mana
            disabled = !canUse || mana.current < cost || skill.currentCooldown > 0 || noUsesLeft;
            if (isRiver) disabled = true;
            if (queuedEffects[skill.effect]) disabled = true;
            btn.classList.toggle('skill-active', !!queuedEffects[skill.effect]);
            // 整局已用完：特殊样式
            btn.classList.toggle('skill-exhausted', noUsesLeft);
            break;
          case BEHAVIOR.PSYCHE:
            // Psyche 双重效果: river 无意义(反制部分影响发牌)，同 effect 不能重复
            disabled = !canUse || mana.current < cost || skill.currentCooldown > 0;
            if (isRiver) disabled = true;
            if (queuedEffects[skill.effect]) disabled = true;
            btn.classList.toggle('skill-active', !!queuedEffects[skill.effect]);
            break;
          case BEHAVIOR.TOGGLE:
            // Toggle 型（绝缘）：无 mana 消耗，在下注阶段可随时切换
            disabled = !isBettingPhase;
            btn.classList.toggle('skill-active', !!skill.active);
            btn.classList.toggle('toggle-on', !!skill.active);
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
        case BEHAVIOR.PSYCHE:
          this._activatePsyche(skill);
          break;
        case BEHAVIOR.TOGGLE:
          this._activateToggle(skill);
          break;
      }

      this.updateDisplay();
      this.updateButtons();
    }

    /**
     * Toggle 型技能切换（绝缘）
     * 零 Mana 消耗，手动切换开/关
     */
    _activateToggle(skill) {
      var result = this.skillSystem.activatePlayerSkill(skill.uniqueId);
      if (!result.success) {
        if (this.onMessage) this.onMessage('无法切换');
        return;
      }

      var name = SKILL_NAMES[skill.skillKey] || skill.skillKey;
      var state = skill.active ? '开启' : '关闭';
      if (this.onMessage) this.onMessage('[' + name + '] ' + state + ' — ' + (skill.description || ''));
      if (this.onLog) this.onLog('SKILL_TOGGLE', {
        skill: name, skillKey: skill.skillKey, active: skill.active
      });
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
          INSUFFICIENT_MANA: '魔运不足 (需要 ' + (result.cost || 0) + ')',
          NO_USES_REMAINING: '本局已使用完毕'
        };
        if (this.onMessage) this.onMessage(reasons[result.reason] || '技能不可用');
        return;
      }

      var name = SKILL_NAMES[skill.skillKey] || skill.skillKey;
      var caster = skill.casterName || '';
      var casterPrefix = caster ? caster + ': ' : '';
      if (this.onMessage) this.onMessage('[' + casterPrefix + name + '] ' + (skill.description || '已激活'));
      if (this.onLog) this.onLog('SKILL_USE', {
        skill: name,
        skillKey: skill.skillKey,
        caster: caster,
        tier: skill.tier,
        manaRemaining: this.skillSystem.getMana(this.humanPlayerId).current
      });
    }

    /**
     * Psyche 双重效果技能激活
     * 每个 Psyche 技能都有: 信息效果(必定触发) + 反制效果(注入 pendingForces 供 MoZ 处理)
     *
     * T3 Clarity 澄澈: 信息=胜率显示, 反制=消除敌方 T3/T2 Curse
     * T2 Refraction 折射: 信息=透视手牌(需选目标), 反制=消除+50%转化
     * T1 Axiom 真理: 信息=胜率+透视(继承), 反制=湮灭所有Curse+100%转化
     */
    _activatePsyche(skill) {
      var self = this;
      var effect = skill.effect;

      // 折射/真理 需要选目标（透视部分），澄澈 直接激活
      if (effect === 'clarity') {
        // T3 澄澈: 立即激活 — 胜率显示 + 注入反制力
        var result = this.skillSystem.activatePlayerSkill(skill.uniqueId);
        if (!result.success) {
          this._showSkillError(result);
          return;
        }
        // 信息效果: 计算并显示胜率
        this._showWinRate(skill);
        var name = SKILL_NAMES[skill.skillKey] || skill.skillKey;
        if (this.onMessage) this.onMessage('[' + name + '] 概率感知已启动');
      } else {
        // T2 折射 / T1 真理: 需要选目标（透视部分）
        this._activatePsychePeek(skill);
      }
    }

    /**
     * Psyche T2/T1 透视选目标流程
     * 选中目标后: 扣mana + 注入反制力 + 执行透视 + (T1额外显示胜率)
     */
    _activatePsychePeek(skill) {
      var self = this;

      // 再次点击取消瞄准
      if (self._peekHandlers) {
        self._peekCleanup();
        if (self.onMessage) self.onMessage('已取消');
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

      var tier = skill.tier || 3;
      self._peekCleanup();

      var name = SKILL_NAMES[skill.skillKey] || skill.skillKey;
      if (this.onMessage) this.onMessage('[' + name + '] 选择透视目标 -- 点击对手座位 (再次点击取消)');

      self._peekHandlers = [];
      for (var t = 0; t < targets.length; t++) {
        (function (target) {
          var seatEl = document.getElementById('seat-' + target.id);
          if (!seatEl) return;

          seatEl.classList.add('peek-targetable');

          var handler = function () {
            self._peekCleanup();
            // 通过 skillSystem 统一激活（扣 mana + 注入反制力到 pendingForces）
            var result = self.skillSystem.activatePlayerSkill(skill.uniqueId);
            if (!result.success) {
              self._showSkillError(result);
              return;
            }
            // 信息效果: 执行透视
            self._executePeek(skill, target, tier);
            // T1 真理额外继承: 胜率显示
            if (skill.effect === 'reversal') {
              self._showWinRate(skill);
            }
            if (self.onMessage) self.onMessage('[' + name + '] 透视 ' + target.name);
          };
          seatEl.addEventListener('click', handler);
          self._peekHandlers.push({ el: seatEl, handler: handler });
        })(targets[t]);
      }

      self._peekEscHandler = function (e) {
        if (e.key === 'Escape') self._peekCleanup();
      };
      document.addEventListener('keydown', self._peekEscHandler);

      var panel = document.getElementById('peek-panel');
      if (panel) panel.style.display = 'none';
    }

    /**
     * 显示技能激活失败原因
     */
    _showSkillError(result) {
      var reasons = {
        SKILL_NOT_FOUND: '技能不存在',
        NOT_ACTIVE_TYPE: '被动技能无法手动激活',
        BACKLASH_ACTIVE: '魔运反噬中',
        ON_COOLDOWN: '冷却中 (' + (result.cooldown || 0) + '轮)',
        INSUFFICIENT_MANA: '魔运不足 (需要 ' + (result.cost || 0) + ')'
      };
      if (this.onMessage) this.onMessage(reasons[result.reason] || '技能不可用');
    }

    /**
     * 计算并显示当前裸牌胜率 (Psyche 信息效果核心)
     * 使用 PokerSolver 蒙特卡洛模拟计算真实胜率
     */
    _showWinRate(skill) {
      var ctx = this._gameCtx;
      var hero = (ctx.players || []).find(function (p) { return p.type === 'human'; });
      if (!hero || !hero.cards || hero.cards.length < 2) return;

      var board = ctx.board || [];
      var activePlayers = (ctx.players || []).filter(function (p) { return !p.folded && p.cards && p.cards.length >= 2; });
      if (activePlayers.length < 2) return;

      // 使用蒙特卡洛模拟计算胜率
      var winPct = this._monteCarloEquity(hero.cards, board, activePlayers.length);

      // 在屏幕上方显示胜率
      this._displayWinRate(winPct, skill);
    }

    /**
     * 蒙特卡洛胜率计算
     * @param {Array} holeCards - 玩家手牌 [{rank, suit}, ...]
     * @param {Array} board - 当前公共牌
     * @param {number} numPlayers - 活跃玩家数
     * @returns {number} 胜率百分比 (0-100)
     */
    _monteCarloEquity(holeCards, board, numPlayers) {
      var SUIT_MAP = { 0: 's', 1: 'h', 2: 'c', 3: 'd' };
      var RANK_MAP = { 1: 'A', 2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: 'T', 11: 'J', 12: 'Q', 13: 'K' };

      function cardStr(c) { return (RANK_MAP[c.rank] || '?') + (SUIT_MAP[c.suit] || 's'); }

      var heroStrs = holeCards.map(cardStr);
      var boardStrs = board.map(cardStr);

      // 构建剩余牌堆
      var usedSet = {};
      heroStrs.forEach(function (s) { usedSet[s] = true; });
      boardStrs.forEach(function (s) { usedSet[s] = true; });

      var remaining = [];
      for (var r = 1; r <= 13; r++) {
        for (var s = 0; s <= 3; s++) {
          var cs = (RANK_MAP[r] || '?') + (SUIT_MAP[s] || 's');
          if (!usedSet[cs]) remaining.push(cs);
        }
      }

      var SIMS = 200;
      var wins = 0;
      var ties = 0;
      var boardNeeded = 5 - boardStrs.length;
      var opponentCount = numPlayers - 1;
      var cardsNeeded = boardNeeded + opponentCount * 2;

      for (var sim = 0; sim < SIMS; sim++) {
        // Fisher-Yates 部分洗牌
        var deck = remaining.slice();
        for (var i = deck.length - 1; i > deck.length - 1 - cardsNeeded && i > 0; i--) {
          var j = Math.floor(Math.random() * (i + 1));
          var tmp = deck[i]; deck[i] = deck[j]; deck[j] = tmp;
        }

        var drawn = deck.slice(deck.length - cardsNeeded);
        var simBoard = boardStrs.concat(drawn.slice(0, boardNeeded));
        var heroAll = heroStrs.concat(simBoard);

        try {
          var heroHand = Hand.solve(heroAll);
          var heroWins = true;
          var heroTie = false;

          for (var opp = 0; opp < opponentCount; opp++) {
            var oppCards = drawn.slice(boardNeeded + opp * 2, boardNeeded + opp * 2 + 2);
            var oppAll = oppCards.concat(simBoard);
            var oppHand = Hand.solve(oppAll);
            var winners = Hand.winners([heroHand, oppHand]);
            if (winners.length === 2) {
              heroTie = true;
            } else if (!winners.includes(heroHand)) {
              heroWins = false;
              break;
            }
          }

          if (heroWins && !heroTie) wins++;
          else if (heroWins && heroTie) ties++;
        } catch (e) {
          // PokerSolver 错误，跳过此模拟
        }
      }

      return Math.round((wins + ties * 0.5) / SIMS * 100);
    }

    /**
     * 在屏幕上方显示胜率浮层
     */
    _displayWinRate(winPct, skill) {
      // 移除旧的
      var existing = document.querySelector('.psyche-winrate-overlay');
      if (existing) existing.remove();

      var overlay = document.createElement('div');
      overlay.className = 'psyche-winrate-overlay';

      var colorClass = winPct >= 60 ? 'winrate-good' : winPct >= 40 ? 'winrate-neutral' : 'winrate-bad';
      var name = SKILL_NAMES[skill.skillKey] || skill.skillKey;

      overlay.innerHTML =
        '<div class="psyche-winrate-box ' + colorClass + '">' +
          '<div class="psyche-winrate-label">[' + name + '] 裸牌胜率</div>' +
          '<div class="psyche-winrate-value">' + winPct + '%</div>' +
        '</div>';

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
      }, 5000);
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

      // ---- Void T3 反侦察：null_field 阻断透视信息效果 ----
      if (this.skillSystem) {
        var targetSkills = this.skillSystem.getPlayerSkills(target.id);
        var hasNullField = targetSkills.some(function(s) {
          return s.effect === 'null_field' && s.active;
        });
        if (hasNullField) {
          if (this.onMessage) this.onMessage('[屏蔽] ' + target.name + ' 的虚无力场阻断了透视!');
          return; // 透视完全失效
        }
      }

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

      // 无技能时隐藏 Grimoire 入口，防止打开空抽屉
      this._updateGrimoireVisibility();
    }

    /**
     * 根据是否有可用技能按钮，显示/隐藏 Grimoire 入口
     */
    _updateGrimoireVisibility() {
      var magicKey = document.getElementById('magic-key');
      var grimoire = document.getElementById('grimoire-player');
      var hasSkills = this._buttons.size > 0;

      if (magicKey) magicKey.style.display = hasSkills ? '' : 'none';
      if (!hasSkills && grimoire) {
        grimoire.classList.remove('active');
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
      var costHtml;
      if (visual.cost) {
        costHtml = '<div class="cost-badge">' + visual.cost + ' MP</div>';
      } else if (skill.usesPerGame > 0) {
        costHtml = '<div class="cost-badge uses-badge">限' + skill.usesPerGame + '次</div>';
      } else if (skill.activation === 'toggle') {
        costHtml = '<div class="cost-badge toggle-badge">开关</div>';
      } else {
        costHtml = '<div class="cost-badge">--</div>';
      }

      var casterTag = skill.casterName ? '<span class="meta-caster">' + skill.casterName + '</span>' : '';

      btn.innerHTML =
        bgSvg +
        '<div class="card-top">' + costHtml + '</div>' +
        '<div class="card-bot">' +
          casterTag +
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

      // NPC 技能使用
      this.skillSystem.on('npc:skill_used', function (data) {
        if (self.onLog) {
          self.onLog('NPC_SKILL', {
            owner: data.ownerName, skill: data.skillKey,
            effect: data.effect, tier: data.tier,
            targetId: data.targetId, targetName: data.targetName
          });
        }
        // 如果是 curse，显示目标信息
        if (data.effect === 'curse' && data.targetName && self.onMessage) {
          self.onMessage('[' + data.ownerName + '] 对 ' + data.targetName + ' 施放了诅咒');
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
