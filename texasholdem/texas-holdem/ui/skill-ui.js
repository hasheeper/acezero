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
    void_shield: '<path d="M12 1L3 5v6c0 5.5 3.8 10.7 9 12 5.2-1.3 9-6.5 9-12V5L12 1z"/>',
    royal_decree: '<path d="M12 2l3 6 6 1-4.5 4.5 1 6.5L12 17l-5.5 3 1-6.5L3 9l6-1z"/><circle cx="12" cy="10" r="2"/>',
    heart_read:  '<path d="M12 21s-7-5-9-9c-1.5-3 .5-6 3.5-6 2 0 3.5 1 5.5 3 2-2 3.5-3 5.5-3 3 0 5 3 3.5 6-2 4-9 9-9 9z"/>',
    cooler:      '<path d="M12 2v20M2 12h20"/><path d="M6 6l12 12M18 6L6 18"/>',
    seal:        '<path d="M12 1L3 5v6c0 5.5 3.8 10.7 9 12 5.2-1.3 9-6.5 9-12V5L12 1z"/><line x1="8" y1="12" x2="16" y2="12" stroke-width="2"/>',
    clairvoyance:'<circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="9" fill="none" stroke-width="1.5"/><line x1="12" y1="2" x2="12" y2="5"/><line x1="12" y1="19" x2="12" y2="22"/><line x1="2" y1="12" x2="5" y2="12"/><line x1="19" y1="12" x2="22" y2="12"/>',
    card_swap:   '<path d="M7 4l-4 4 4 4"/><path d="M3 8h14"/><path d="M17 20l4-4-4-4"/><path d="M21 16H7"/>',
    miracle:     '<path d="M12 2l1.5 4.5H18l-3.5 3 1.5 4.5L12 11l-4 3 1.5-4.5L6 6.5h4.5z"/><circle cx="12" cy="12" r="10" fill="none" stroke-width="1"/>',
    lucky_find:  '<path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2z"/><path d="M9 12l2 2 4-4" fill="none" stroke="#fff" stroke-width="2"/>'
  };

  var EFFECT_VISUALS = {
    fortune:     { icon: _svg(SVG_PATHS.fortune, '#9B59B6'),   cssClass: 'moirai-skill', color: '#9B59B6', attr: 'moirai' },
    curse:       { icon: _svg(SVG_PATHS.curse, '#e74c3c'),     cssClass: 'chaos-skill',  color: '#e74c3c', attr: 'chaos' },
    clarity:     { icon: _svgS(SVG_PATHS.clarity, '#74b9ff'),  cssClass: 'psyche-skill', color: '#74b9ff', attr: 'psyche' },
    refraction:  { icon: _svgS(SVG_PATHS.refraction, '#a29bfe'), cssClass: 'psyche-skill', color: '#a29bfe', attr: 'psyche' },
    reversal:    { icon: _svg(SVG_PATHS.reversal, '#1abc9c'),  cssClass: 'psyche-skill', color: '#1abc9c', attr: 'psyche' },
    null_field:  { icon: _svgS(SVG_PATHS.null_field, '#95a5a6'), cssClass: 'void-skill', color: '#95a5a6', attr: 'void' },
    void_shield: { icon: _svgS(SVG_PATHS.void_shield, '#7f8c8d'), cssClass: 'void-skill', color: '#7f8c8d', attr: 'void' },
    purge_all:     { icon: _svgS(SVG_PATHS.purge_all, '#bdc3c7'), cssClass: 'void-skill',   color: '#bdc3c7', attr: 'void' },
    royal_decree:  { icon: _svg(SVG_PATHS.fortune, '#D4AF37'),    cssClass: 'moirai-skill', color: '#D4AF37', attr: 'moirai' },
    heart_read:    { icon: _svg(SVG_PATHS.clarity, '#FF69B4'),    cssClass: 'psyche-skill', color: '#FF69B4', attr: 'psyche' },
    cooler:        { icon: _svg(SVG_PATHS.curse, '#4A0E0E'),      cssClass: 'chaos-skill',  color: '#4A0E0E', attr: 'chaos' },
    seal:          { icon: _svgS(SVG_PATHS.void_shield, '#8B0000'), cssClass: 'chaos-skill', color: '#8B0000', attr: 'chaos' },
    clairvoyance:  { icon: _svgS(SVG_PATHS.clairvoyance, '#E0B0FF'), cssClass: 'psyche-skill', color: '#E0B0FF', attr: 'psyche' },
    card_swap:     { icon: _svg(SVG_PATHS.card_swap, '#FF8C00'),     cssClass: 'chaos-skill',  color: '#FF8C00', attr: 'chaos' },
    miracle:       { icon: _svg(SVG_PATHS.miracle, '#50C878'),       cssClass: 'moirai-skill', color: '#50C878', attr: 'moirai' },
    lucky_find:    { icon: _svg(SVG_PATHS.lucky_find, '#90EE90'),    cssClass: 'moirai-skill', color: '#90EE90', attr: 'moirai' }
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
    reality:      '现实',
    royal_decree: '敕令',
    heart_read:   '读心',
    cooler:       '冤家牌',
    skill_seal:   '封印',
    clairvoyance: '千里眼',
    card_swap:    '偷天换日',
    miracle:      '奇迹',
    lucky_find:   '捡到了！'
  };

  // 行为分类（决定按钮逻辑和 UI 交互方式）
  const BEHAVIOR = {
    FORCE:   'force',    // 影响发牌的力量型技能 (fortune, purge_all)
    CURSE:   'curse',    // 需要选目标的诅咒/封印技能 (curse, seal, cooler, card_swap)
    PSYCHE:  'psyche',   // Psyche 双重效果技能 (clarity, refraction, reversal — 信息+反制)
    TOGGLE:  'toggle',   // 开关型技能 (void_shield 绝缘 — 0 mana, 手动切换)
    PASSIVE: 'passive'   // 被动技能 (null_field — 不生成按钮)
  };

  // effect → behavior 映射
  function effectToBehavior(effect, activation) {
    if (activation === 'passive') return BEHAVIOR.PASSIVE;
    if (activation === 'toggle') return BEHAVIOR.TOGGLE;
    // Psyche 技能: 双重效果 (信息必定触发 + 反制vs Chaos)
    if (effect === 'clarity' || effect === 'refraction' || effect === 'reversal' || effect === 'heart_read' || effect === 'clairvoyance') return BEHAVIOR.PSYCHE;
    // 需要选目标的诅咒/封印/冤家牌/偷天换日
    if (effect === 'curse' || effect === 'seal' || effect === 'cooler' || effect === 'card_swap') return BEHAVIOR.CURSE;
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

      // --- RPG 系统初始化（TraitSystem → CombatFormula → MonteOfZero） ---
      if (typeof TraitSystem !== 'undefined' && this.moz) {
        var heroId = this.humanPlayerId;

        // TraitSystem：注册所有角色特质（使用真实游戏 ID）
        var traitSys = new TraitSystem();
        traitSys.registerFromConfig(playerConfigs, playerIdMap);

        // AttributeSystem + SwitchSystem（如果可用）
        var attrSys = null;
        var switchSys = null;
        if (typeof AttributeSystem !== 'undefined') {
          attrSys = new AttributeSystem();
          var attrPlayers = window.__rpgBuildAttrPlayers ? window.__rpgBuildAttrPlayers(playerConfigs, playerIdMap) : [];
          attrSys.registerFromConfig(attrPlayers);
        }
        if (typeof SwitchSystem !== 'undefined' && playerConfigs.hero) {
          switchSys = new SwitchSystem({ rinoId: heroId });
        }

        // CombatFormula：注入 traitSystem
        if (typeof CombatFormula !== 'undefined') {
          var cf = new CombatFormula({
            attributeSystem: attrSys,
            switchSystem: switchSys,
            traitSystem: traitSys,
            heroId: heroId
          });
          this.moz.combatFormula = cf;
        }

        // 注入特质消耗修正回调到 skillSystem
        var _ts = traitSys;
        this.skillSystem.traitCostFn = function(ownerId, baseCost) {
          var eff = _ts.hasEffect(ownerId, 'mana_efficiency');
          if (eff.has && eff.value.costMult) {
            return Math.round(baseCost * eff.value.costMult);
          }
          return baseCost;
        };

        // 存储引用供外部使用
        this._traitSystem = traitSys;
        console.log('[SkillUI] RPG 系统已初始化 — TraitSystem:', traitSys.getSummary());
      }

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
     * 每轮下注结束后调用 — 基础处理（mana恢复 + CD递减 + 触发检查）
     * 不包含 NPC 出招，NPC 出招在技能博弈阶段统一执行
     * @param {object} gameContext — { players, pot, phase, board }
     */
    onRoundEndBase(gameContext) {
      if (!this.skillSystem) return;
      this._gameCtx = gameContext;
      this.skillSystem.onRoundEnd();
      this.skillSystem.checkTriggers(gameContext);
      this.updateDisplay();
      this.updateButtons();
    }

    /**
     * 技能博弈阶段：NPC 出招（在玩家确认后调用）
     * @param {object} [gameContext] — 可选，不传则用上次缓存的
     */
    fireNpcSkills(gameContext) {
      if (!this.skillSystem) return [];
      var ctx = gameContext || this._gameCtx;
      var records = ctx ? this.skillSystem.npcDecideSkills(ctx) : [];
      this.updateDisplay();
      this.updateButtons();
      return records || [];
    }

    /**
     * 兼容旧接口 — 直接完成基础处理 + NPC出招
     * @param {object} gameContext
     */
    onRoundEnd(gameContext) {
      this.onRoundEndBase(gameContext);
      this.fireNpcSkills(gameContext);
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

      // 注入 gameContext 到 CombatFormula（供特质判断筹码等动态条件）
      if (this.moz.combatFormula) {
        this.moz.combatFormula.gameContext = { players: players };
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
          case BEHAVIOR.CURSE:
            // 诅咒/封印型：需要选目标，river 无意义（不影响选牌），需要 mana
            disabled = !canUse || mana.current < cost || skill.currentCooldown > 0 || noUsesLeft;
            if (isRiver && skill.effect !== 'seal') disabled = true; // seal 在 river 仍可用
            if (queuedEffects['curse'] && skill.effect === 'curse') disabled = true;
            btn.classList.toggle('skill-active', !!queuedEffects[skill.effect]);
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

        // 封印状态视觉提示
        var isSealed = skill._sealed > 0;
        btn.classList.toggle('skill-sealed', isSealed);
        if (isSealed) {
          disabled = true;
          // 在 cost badge 显示封印剩余回合
          var costBadge = btn.querySelector('.cost-badge');
          if (costBadge) costBadge.textContent = '🔒' + skill._sealed;
        } else {
          var costBadge2 = btn.querySelector('.cost-badge');
          if (costBadge2 && costBadge2.textContent.indexOf('🔒') === 0) {
            costBadge2.textContent = (skill.manaCost || 0) + ' MP';
          }
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
        case BEHAVIOR.CURSE:
          this._activateCurse(skill);
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
     * 诅咒/封印型技能激活 — 需要选择目标
     * curse, seal, cooler, card_swap 都走这个通道
     * 点击技能 → 高亮对手座位 → 点击座位选目标 → 激活技能(带 targetId)
     */
    _activateCurse(skill) {
      var self = this;

      // 再次点击取消瞄准
      if (self._curseHandlers) {
        self._curseCleanup();
        if (self.onMessage) self.onMessage('已取消');
        return;
      }

      var ctx = this._gameCtx;
      var targets = (ctx.players || []).filter(function (p) {
        return p.type === 'ai' && !p.folded;
      });
      if (targets.length === 0) {
        if (this.onMessage) this.onMessage('没有可诅咒的对手');
        return;
      }

      // 只有1个对手时直接激活，不需要选择
      if (targets.length === 1) {
        self._doCurseActivate(skill, targets[0]);
        return;
      }

      self._curseCleanup();

      var name = SKILL_NAMES[skill.skillKey] || skill.skillKey;
      if (this.onMessage) this.onMessage('[' + name + '] 选择目标 -- 点击对手座位 (再次点击取消)');

      self._curseHandlers = [];
      for (var t = 0; t < targets.length; t++) {
        (function (target) {
          var seatEl = document.getElementById('seat-' + target.id);
          if (!seatEl) return;

          seatEl.classList.add('peek-targetable');

          var handler = function () {
            self._curseCleanup();
            self._doCurseActivate(skill, target);
          };
          seatEl.addEventListener('click', handler);
          self._curseHandlers.push({ el: seatEl, handler: handler });
        })(targets[t]);
      }

      self._curseEscHandler = function (e) {
        if (e.key === 'Escape') {
          self._curseCleanup();
          if (self.onMessage) self.onMessage('已取消');
        }
      };
      document.addEventListener('keydown', self._curseEscHandler);
    }

    /**
     * 诅咒技能实际激活（选目标后调用）
     */
    _doCurseActivate(skill, target) {
      var result = this.skillSystem.activatePlayerSkill(skill.uniqueId, { targetId: target.id });
      if (!result.success) {
        this._showSkillError(result);
        return;
      }

      var name = SKILL_NAMES[skill.skillKey] || skill.skillKey;
      var caster = skill.casterName || '';
      var casterPrefix = caster ? caster + ': ' : '';
      if (this.onMessage) this.onMessage('[' + casterPrefix + name + '] → ' + target.name);
      if (this.onLog) this.onLog('SKILL_USE', {
        skill: name,
        skillKey: skill.skillKey,
        caster: caster,
        tier: skill.tier,
        target: target.name,
        targetId: target.id,
        manaRemaining: this.skillSystem.getMana(this.humanPlayerId).current
      });

      this.updateDisplay();
      this.updateButtons();
    }

    _curseCleanup() {
      if (this._curseHandlers) {
        for (var i = 0; i < this._curseHandlers.length; i++) {
          var h = this._curseHandlers[i];
          h.el.classList.remove('peek-targetable');
          h.el.removeEventListener('click', h.handler);
        }
        this._curseHandlers = null;
      }
      if (this._curseEscHandler) {
        document.removeEventListener('keydown', this._curseEscHandler);
        this._curseEscHandler = null;
      }
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

      // 再次点击取消瞄准
      if (self._protectHandlers) {
        self._protectCleanup();
        if (self.onMessage) self.onMessage('已取消');
        return;
      }

      // 所有 Psyche 技能先选保护目标（自己 + 所有未弃牌玩家）
      var ctx = this._gameCtx;
      var allPlayers = (ctx.players || []).filter(function (p) {
        return !p.folded;
      });
      if (allPlayers.length === 0) {
        if (this.onMessage) this.onMessage('没有可保护的目标');
        return;
      }

      // 只有自己一人时直接保护自己
      if (allPlayers.length === 1) {
        self._doPsycheActivate(skill, allPlayers[0]);
        return;
      }

      self._protectCleanup();

      var name = SKILL_NAMES[skill.skillKey] || skill.skillKey;
      if (this.onMessage) this.onMessage('[' + name + '] 选择保护目标 -- 点击座位 (再次点击取消)');

      self._protectHandlers = [];
      for (var t = 0; t < allPlayers.length; t++) {
        (function (target) {
          var seatEl = document.getElementById('seat-' + target.id);
          if (!seatEl) return;

          seatEl.classList.add('peek-targetable');

          var handler = function () {
            self._protectCleanup();
            self._doPsycheActivate(skill, target);
          };
          seatEl.addEventListener('click', handler);
          self._protectHandlers.push({ el: seatEl, handler: handler });
        })(allPlayers[t]);
      }

      self._protectEscHandler = function (e) {
        if (e.key === 'Escape') {
          self._protectCleanup();
          if (self.onMessage) self.onMessage('已取消');
        }
      };
      document.addEventListener('keydown', self._protectEscHandler);
    }

    /**
     * 保护目标选定后执行 Psyche 技能
     */
    _doPsycheActivate(skill, protectTarget) {
      var self = this;
      var effect = skill.effect;
      var protectId = protectTarget.id;
      var protectName = protectTarget.name || ('ID:' + protectId);

      if (effect === 'clarity') {
        var result = this.skillSystem.activatePlayerSkill(skill.uniqueId, { protectId: protectId });
        if (!result.success) { this._showSkillError(result); return; }
        this._showWinRate(skill);
        var sn = SKILL_NAMES[skill.skillKey] || skill.skillKey;
        if (this.onMessage) this.onMessage('[' + sn + '] 概率感知已启动 — 守护: ' + protectName);
      } else if (effect === 'heart_read') {
        var result2 = this.skillSystem.activatePlayerSkill(skill.uniqueId, { protectId: protectId });
        if (!result2.success) { this._showSkillError(result2); return; }
        this._showHeartRead();
        if (this.onMessage) this.onMessage('[读心] 感知到对手的意图 — 守护: ' + protectName);
      } else if (effect === 'clairvoyance') {
        var result3 = this.skillSystem.activatePlayerSkill(skill.uniqueId, { protectId: protectId });
        if (!result3.success) { this._showSkillError(result3); return; }
        this._showWinRate(skill);
        var ctx3 = this._gameCtx;
        var targets3 = (ctx3.players || []).filter(function (p) {
          return p.type === 'ai' && !p.folded && p.cards && p.cards.length >= 2;
        });
        var allPeekResults = [];
        for (var t3 = 0; t3 < targets3.length; t3++) {
          var peekData = this._buildPeekData(skill, targets3[t3], 0);
          if (peekData) allPeekResults.push(peekData);
        }
        if (allPeekResults.length > 0) {
          this._showPeekCardsMulti(allPeekResults);
        }
        if (this.onMessage) this.onMessage('[千里眼] 全场透视启动 — 守护: ' + protectName);
        if (this.onLog) this.onLog('SKILL_USE', {
          skill: SKILL_NAMES[skill.skillKey] || '千里眼',
          target: targets3.map(function(t) { return t.name; }).join(', '),
          protect: protectName,
          tier: 0,
          manaRemaining: this.skillSystem.getMana(this.humanPlayerId).current
        });
      } else {
        // T2 折射 / T1 真理: 需要选透视目标 + 保护目标已选定
        this._activatePsychePeek(skill, protectId);
      }
    }

    /**
     * 清理保护目标选择 UI
     */
    _protectCleanup() {
      if (this._protectHandlers) {
        for (var i = 0; i < this._protectHandlers.length; i++) {
          var h = this._protectHandlers[i];
          h.el.classList.remove('peek-targetable');
          h.el.removeEventListener('click', h.handler);
        }
        this._protectHandlers = null;
      }
      if (this._protectEscHandler) {
        document.removeEventListener('keydown', this._protectEscHandler);
        this._protectEscHandler = null;
      }
    }

    /**
     * Psyche T2/T1 透视选目标流程
     * 选中目标后: 扣mana + 注入反制力 + 执行透视 + (T1额外显示胜率)
     */
    _activatePsychePeek(skill, protectId) {
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
            // protectId 从保护目标选择步骤传入
            var opts = {};
            if (protectId != null) opts.protectId = protectId;
            var result = self.skillSystem.activatePlayerSkill(skill.uniqueId, opts);
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
     * 读心 — 显示对手下注倾向（OpponentModel 数据或基础推断）
     */
    _showHeartRead() {
      var ctx = this._gameCtx;
      var opponents = (ctx.players || []).filter(function (p) {
        return p.type === 'ai' && !p.folded;
      });
      if (opponents.length === 0) return;

      // 同时显示己方胜率（继承 clarity 的信息效果）
      var heroWinRate = null;
      var heroPlayer = (ctx.players || []).find(function (p) { return p.type !== 'ai'; });
      if (heroPlayer && heroPlayer.cards && heroPlayer.cards.length >= 2) {
        heroWinRate = this._monteCarloEquity(heroPlayer.cards, ctx.board || [], opponents.length + 1);
      }

      // 构建读心信息
      var lines = [];
      for (var i = 0; i < opponents.length; i++) {
        var opp = opponents[i];
        var diff = (opp.personality && opp.personality.difficulty) || '?';
        var risk = (opp.personality && opp.personality.risk) || '?';
        var bb = ctx.bigBlind || 20;
        var betBB = bb > 0 ? Math.round((opp.currentBet || 0) / bb * 10) / 10 : 0;
        var invested = Math.max(opp.totalBet || 0, opp.currentBet || 0);
        var startStack = invested + (opp.chips || 0);
        var commitPct = startStack > 0 ? Math.round(invested / startStack * 100) : 0;

        // 根据难度+风险+下注尺度推断手牌强度范围
        var strengthGuess = '';
        var bluffChance = '';
        if (diff === 'noob') {
          if (betBB > 5) { strengthGuess = '随机牌力'; bluffChance = '虚张声势概率: 高 (50%+)'; }
          else if (betBB > 2) { strengthGuess = '中等偏弱'; bluffChance = '虚张声势概率: 中 (30%)'; }
          else { strengthGuess = '无法判断'; bluffChance = '行为不可预测'; }
        } else if (diff === 'regular') {
          if (betBB > 8) { strengthGuess = '中等或诈唬'; bluffChance = '虚张声势概率: 中 (25%)'; }
          else if (betBB > 3) { strengthGuess = '中等偏强'; bluffChance = '虚张声势概率: 低 (15%)'; }
          else { strengthGuess = '边缘牌'; bluffChance = '虚张声势概率: 低'; }
        } else {
          if (betBB > 10) { strengthGuess = '强牌或精准诈唬'; bluffChance = '虚张声势概率: 不可读'; }
          else { strengthGuess = '范围宽广'; bluffChance = '难以判断'; }
        }

        // 风险偏好标签
        var riskLabel = { maniac: '🔥狂暴', aggressive: '⚔️攻击', balanced: '⚖️均衡', passive: '🛡️被动', rock: '🪨磐石' };
        var riskText = riskLabel[risk] || risk;

        var line = '<b>' + opp.name + '</b> ' + riskText;
        line += '<br><span style="color:#aaa;font-size:12px;">下注 ' + betBB + 'BB | 投入 ' + commitPct + '%</span>';
        line += '<br><span style="color:#FFD700;">牌力: ' + strengthGuess + '</span>';
        line += '<br><span style="color:#FF69B4;">' + bluffChance + '</span>';
        lines.push(line);
      }

      // 显示为浮层
      var existing = document.querySelector('.heart-read-overlay');
      if (existing) existing.remove();

      var overlay = document.createElement('div');
      overlay.className = 'heart-read-overlay';
      overlay.style.cssText = 'position:fixed;top:12%;left:50%;transform:translateX(-50%);' +
        'background:rgba(20,0,30,0.94);border:1px solid #FF69B4;border-radius:12px;' +
        'padding:16px 24px;z-index:9999;color:#fff;font-size:14px;min-width:320px;max-width:420px;' +
        'box-shadow:0 0 20px rgba(255,105,180,0.3);';
      var html = '<div style="color:#FF69B4;font-weight:bold;margin-bottom:8px;font-size:16px;">♥ 读心 — 对手意图解析</div>';
      if (heroWinRate != null) {
        html += '<div style="color:#74b9ff;margin-bottom:8px;padding:4px 8px;background:rgba(116,185,255,0.1);border-radius:6px;">己方胜率: <b>' + heroWinRate + '%</b></div>';
      }
      for (var j = 0; j < lines.length; j++) {
        html += '<div style="margin:6px 0;padding:6px 0;border-bottom:1px solid rgba(255,105,180,0.15);">' + lines[j] + '</div>';
      }
      html += '<div style="color:#666;font-size:11px;margin-top:6px;">点击关闭 | 已消除敌方T3诅咒</div>';
      overlay.innerHTML = html;
      overlay.addEventListener('click', function () {
        overlay.style.opacity = '0';
        overlay.style.transition = 'opacity 0.3s';
        setTimeout(function () { overlay.remove(); }, 300);
      });
      document.body.appendChild(overlay);
      setTimeout(function () {
        if (overlay.parentNode) {
          overlay.style.opacity = '0';
          overlay.style.transition = 'opacity 0.5s';
          setTimeout(function () { if (overlay.parentNode) overlay.remove(); }, 500);
        }
      }, 8000);
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

    /**
     * 构建透视数据（不显示 overlay）
     * @returns {{ target, cardData, mode, tier }} 或 null（被屏蔽时）
     */
    _buildPeekData(skill, target, tier) {
      var RANK_NAMES = { 1: 'A', 2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: 'T', 11: 'J', 12: 'Q', 13: 'K' };

      // ---- Void T3 反侦察：null_field 阻断透视信息效果 ----
      if (this.skillSystem) {
        var targetSkills = this.skillSystem.getPlayerSkills(target.id);
        var hasNullField = targetSkills.some(function(s) {
          return s.effect === 'null_field' && s.active;
        });
        if (hasNullField) {
          if (this.onMessage) this.onMessage('[屏蔽] ' + target.name + ' 的虚无力场阻断了透视!');
          return null;
        }
      }

      // ---- Moirai > Psyche 克制：幸运迷雾降低透视精度 ----
      var effectiveTier = tier;
      if (this.skillSystem) {
        var targetFortunePower = (this.skillSystem.pendingForces || [])
          .filter(function (f) { return f.ownerId === target.id && f.type === 'fortune'; })
          .reduce(function (sum, f) { return sum + (f.power || 0); }, 0);
        if (targetFortunePower >= 30) {
          effectiveTier = Math.min(3, tier + 2);
          if (this.onMessage) this.onMessage('[幸运迷雾] ' + target.name + ' 的强运严重干扰了透视!');
        } else if (targetFortunePower >= 15) {
          effectiveTier = Math.min(3, tier + 1);
          if (this.onMessage) this.onMessage('[幸运迷雾] ' + target.name + ' 的运气干扰了透视精度');
        }
      }
      tier = effectiveTier;

      var cardData, mode;
      if (tier <= 1) {
        // T1/T0: 完美透视 — 翻开座位上的牌
        target.cards.forEach(function (c) {
          if (c.$el && !c.$el.classList.contains('peek-revealed')) {
            c.setSide('front');
            c.$el.classList.add('peek-revealed');
          }
        });
        if (this.skillSystem) this.skillSystem.emit('peek:reveal', { targetId: target.id, targetName: target.name });
        cardData = target.cards;
        mode = 'perfect';
      } else if (tier <= 2) {
        // T2: 概率分析
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
        var fakeCount = 1 + Math.floor(Math.random() * 2);
        for (var f = 0; f < fakeCount; f++) {
          realCards.push({
            rank: RANK_NAMES[1 + Math.floor(Math.random() * 13)] || '?',
            suit: Math.floor(Math.random() * 4),
            confidence: 'low',
            real: false
          });
        }
        realCards.sort(function () { return Math.random() - 0.5; });
        cardData = realCards;
        mode = 'analysis';
      } else {
        // T3: 模糊范围
        var cards2 = target.cards;
        var vague = [];
        for (var i2 = 0; i2 < cards2.length; i2++) {
          var r = cards2[i2].rank;
          var rangeText;
          if (r >= 10 || r === 1) rangeText = '高牌';
          else if (r >= 6) rangeText = '中牌';
          else rangeText = '低牌';
          vague.push({ rangeText: rangeText, suit: cards2[i2].suit, confidence: 'vague' });
        }
        cardData = vague;
        mode = 'vague';
      }

      return { target: target, cardData: cardData, mode: mode, tier: tier };
    }

    /**
     * 执行单目标透视（refraction / axiom 用）
     * 构建数据 + 显示单人 overlay + 消息
     */
    _executePeek(skill, target, tier) {
      var result = this._buildPeekData(skill, target, tier);
      if (!result) return;

      this._showPeekCards(result.target, result.cardData, result.mode);

      if (result.mode === 'perfect') {
        if (this.onMessage) this.onMessage('[透视] ' + target.name + ' 的底牌完全暴露!');
      } else if (result.mode === 'analysis') {
        if (this.onMessage) this.onMessage('[透视] 感知到 ' + target.name + ' 的手牌波动...');
      } else {
        if (this.onMessage) this.onMessage('[透视] 隐约感知到 ' + target.name + ' 的牌力...');
      }

      if (this.onLog) this.onLog('SKILL_USE', {
        skill: SKILL_NAMES[skill.skillKey] || '透视',
        target: target.name,
        tier: result.tier,
        manaRemaining: this.skillSystem.getMana(this.humanPlayerId).current
      });
    }

    /**
     * 千里眼专用：多目标合并 overlay
     * @param {Array} results — _buildPeekData 返回值数组
     */
    _showPeekCardsMulti(results) {
      var SUIT_CLASSES = { 0: 'spades', 1: 'hearts', 2: 'clubs', 3: 'diamonds' };
      var CONF_LABELS = { high: '确信', mid: '模糊', low: '干扰', vague: '感知' };
      var CONF_CLASSES = { high: 'peek-conf-high', mid: 'peek-conf-mid', low: 'peek-conf-low', vague: 'peek-conf-vague' };

      var existing = document.querySelector('.peek-result-overlay');
      if (existing) existing.remove();

      var overlay = document.createElement('div');
      overlay.className = 'peek-result-overlay';

      var html = '<div class="peek-result-header">';
      html += '<div class="peek-result-title">[千里眼] 全场透视</div>';
      html += '<div class="peek-result-mode">完美透视</div>';
      html += '</div>';

      for (var r = 0; r < results.length; r++) {
        var res = results[r];
        html += '<div class="peek-target-section">';
        html += '<div class="peek-target-name">' + res.target.name + '</div>';
        html += '<div class="peek-cards-row">';
        for (var i = 0; i < res.cardData.length; i++) {
          var cd = res.cardData[i];
          var conf = cd.confidence || 'high';
          var confLabel = CONF_LABELS[conf] || '';
          var confClass = CONF_CLASSES[conf] || '';
          html += '<div class="peek-card-wrapper">';
          if (res.mode === 'vague') {
            var vaguesuit = SUIT_CLASSES[cd.suit] || 'spades';
            html += '<div class="card peek-deck-card ' + vaguesuit + '"><div class="back"></div></div>';
            html += '<div class="peek-card-range-label">' + cd.rangeText + '</div>';
          } else {
            var suitCls = SUIT_CLASSES[cd.suit] || 'spades';
            var rankNum = cd.rank;
            if (typeof rankNum === 'string') {
              var rkMap = { A:1, '2':2, '3':3, '4':4, '5':5, '6':6, '7':7, '8':8, '9':9, T:10, J:11, Q:12, K:13 };
              rankNum = rkMap[rankNum] || 1;
            }
            html += '<div class="card peek-deck-card ' + suitCls + ' rank' + rankNum + '"><div class="face"></div></div>';
          }
          if (res.mode === 'analysis') {
            html += '<div class="peek-card-conf ' + confClass + '">' + confLabel + '</div>';
          }
          html += '</div>';
        }
        html += '</div></div>';
      }

      overlay.innerHTML = html;
      overlay.addEventListener('click', function () {
        overlay.style.opacity = '0';
        overlay.style.transition = 'opacity 0.3s';
        setTimeout(function () { overlay.remove(); }, 300);
      });
      document.body.appendChild(overlay);

      setTimeout(function () {
        if (overlay.parentNode) {
          overlay.style.opacity = '0';
          overlay.style.transition = 'opacity 0.5s';
          setTimeout(function () { if (overlay.parentNode) overlay.remove(); }, 500);
        }
      }, 8000); // 多目标给更长时间
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
