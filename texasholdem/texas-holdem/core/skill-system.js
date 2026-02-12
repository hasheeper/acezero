/**
 * Skill System — 技能系统 v1
 * 《零之王牌》独立技能管理模块
 *
 * 设计哲学：
 *   技能系统与命运引擎(MonteOfZero)解耦。
 *   技能系统负责：技能注册、mana管理、激活判定、NPC AI决策、被动感知。
 *   命运引擎只负责：接收 forces 列表 → 选牌。
 *
 * Hook 架构：
 *   外部通过 on(event, callback) 监听事件，
 *   技能系统通过 emit(event, data) 通知外部。
 *   这样 texas-holdem.js 不需要知道技能内部逻辑，只需要响应事件。
 *
 * 激活方式 (activation):
 *   passive    — 被动，始终生效
 *   active     — 主动，手动/AI决策激活，消耗 mana，单次生效
 *   toggle     — 开关型，激活后持续到回合结束
 *   triggered  — 条件触发型，满足条件自动激活
 */

(function (global) {
  'use strict';

  // ========== 常量 ==========

  const ACTIVATION = {
    PASSIVE: 'passive',
    ACTIVE: 'active',
    TOGGLE: 'toggle',
    TRIGGERED: 'triggered'
  };

  // 效果类型常量（从通用技能目录中提取的所有 effect 值）
  const EFFECT = {
    FORTUNE:     'fortune',       // Moirai: 概率偏斜，让自己赢
    CURSE:       'curse',         // Chaos:  概率污蚀，让目标输
    CLARITY:     'clarity',       // Psyche T3: 胜率感知 + 消除敌方 T3/T2 Curse
    REFRACTION:  'refraction',    // Psyche T2: 透视手牌 + 消除敌方 T3/T2 Curse + 50%转化
    REVERSAL:    'reversal',      // Psyche T1: 胜率+透视 + 湮灭所有 Curse(含T1) + 100%转化
    NULL_FIELD:  'null_field',    // Void T3:   阻断侦查
    VOID_SHIELD: 'void_shield',   // Void T2:   Moirai/Chaos 效果减半
    PURGE_ALL:   'purge_all'      // Void T1:   清除所有非 Void 技能
  };

  // ========== 通用技能目录 ==========
  // 4属性 × 3等级 (T3=基础 T2=进阶 T1=终极)
  // threshold = 需要的单项属性值才能习得
  // power = 固定力量值（MoZ 引擎消费）
  // suppressTiers / suppressAttr / suppressAll = 阶级压制规则

  const UNIVERSAL_SKILLS = {
    // ===== Moirai (天命) =====
    minor_wish:   { attr: 'moirai', tier: 3, threshold: 20, effect: 'fortune',     activation: 'active',  manaCost: 10, cooldown: 0, power: 15, description: '小吉 — 概率偏斜' },
    grand_wish:   { attr: 'moirai', tier: 2, threshold: 40, effect: 'fortune',     activation: 'active',  manaCost: 20, cooldown: 0, power: 30, description: '大吉 — 疯狂强运' },
    divine_order: { attr: 'moirai', tier: 1, threshold: 60, effect: 'fortune',     activation: 'active',  manaCost: 40, cooldown: 3, power: 50, suppressTiers: [2, 3], description: '天命 — 绝对既定' },

    // ===== Chaos (狂厄) =====
    hex:          { attr: 'chaos',  tier: 3, threshold: 20, effect: 'curse',       activation: 'active',  manaCost: 10, cooldown: 0, power: 15, description: '小凶 — 概率污蚀' },
    havoc:        { attr: 'chaos',  tier: 2, threshold: 40, effect: 'curse',       activation: 'active',  manaCost: 20, cooldown: 0, power: 30, description: '大凶 — 恶意筛除' },
    catastrophe:  { attr: 'chaos',  tier: 1, threshold: 60, effect: 'curse',       activation: 'active',  manaCost: 40, cooldown: 3, power: 50, suppressTiers: [2, 3], description: '灾变 — 痛苦锁死' },

    // ===== Psyche (灵视) — 裁定者 The Arbiter =====
    // 每阶都有双重效果: 信息效果(必定触发) + 反制效果(仅对敌方Chaos生效)
    clarity:      { attr: 'psyche', tier: 3, threshold: 20, effect: 'clarity',     activation: 'active',  manaCost: 10, cooldown: 0, power: 0,  description: '澄澈 — 胜率感知 + 消除敌方T3/T2 Curse' },
    refraction:   { attr: 'psyche', tier: 2, threshold: 40, effect: 'refraction',  activation: 'active',  manaCost: 25, cooldown: 0, power: 0,  description: '折射 — 透视手牌 + 消除敌方T3/T2 Curse并50%转化' },
    axiom:        { attr: 'psyche', tier: 1, threshold: 60, effect: 'reversal',    activation: 'active',  manaCost: 50, cooldown: 3, power: 0,  suppressAttr: 'chaos', description: '真理 — 胜率+透视 + 湮灭所有Curse并100%转化' },

    // ===== Void (虚无) =====
    static_field: { attr: 'void',   tier: 3, threshold: 20, effect: 'null_field',  activation: 'passive', manaCost: 0,  cooldown: 0, power: 8,  description: '屏蔽 — 信息干涉' },
    insulation:   { attr: 'void',   tier: 2, threshold: 40, effect: 'void_shield', activation: 'passive', manaCost: 0,  cooldown: 0, power: 15, description: '绝缘 — 数值衰减' },
    reality:      { attr: 'void',   tier: 1, threshold: 60, effect: 'purge_all',   activation: 'active',  manaCost: 50, cooldown: 5, power: 0,  suppressAll: true, description: '现实 — 物理回滚' }
  };

  /**
   * 查找技能定义
   * @param {string} skillKey - UNIVERSAL_SKILLS 中的 key
   * @returns {object|null}
   */
  function lookupSkill(skillKey) {
    return UNIVERSAL_SKILLS[skillKey] || null;
  }

  // ========== 技能槽位计算 ==========

  /**
   * 广度：四维总和决定技能槽数量
   * @param {object} attrs - { moirai, chaos, psyche, void }
   * @returns {number} 槽位数 (1-4)
   */
  function calculateSlots(attrs) {
    const total = (attrs.moirai || 0) + (attrs.chaos || 0) +
                  (attrs.psyche || 0) + (attrs.void || 0);
    if (total >= 120) return 4;
    if (total >= 80)  return 3;
    if (total >= 40)  return 2;
    return 1;
  }

  /**
   * 深度：单项属性值决定能否学会某技能
   * @param {object} skillDef - 技能定义（需要 attr + threshold）
   * @param {object} attrs - 角色属性面板
   * @returns {boolean}
   */
  function canLearnSkill(skillDef, attrs) {
    if (!skillDef.attr || !skillDef.threshold) return true; // 无门槛限制
    return (attrs[skillDef.attr] || 0) >= skillDef.threshold;
  }

  /**
   * 从属性面板自动推导可用技能列表
   * @param {object} attrs - { moirai, chaos, psyche, void }
   * @param {number} maxSlots - 最大槽位数
   * @returns {Array<{key, ...skillDef}>} 按优先级排序的技能列表
   */
  function deriveSkillsFromAttrs(attrs, maxSlots) {
    const available = [];
    for (const key in UNIVERSAL_SKILLS) {
      const def = UNIVERSAL_SKILLS[key];
      if (!def.attr) continue;
      if (canLearnSkill(def, attrs)) {
        available.push({ key: key, ...def });
      }
    }
    // 同属性内高阶优先（T1 > T2 > T3），跨属性按属性值高的优先
    available.sort(function (a, b) {
      if (a.tier !== b.tier) return a.tier - b.tier; // T1=1 最高优先
      const aVal = attrs[a.attr] || 0;
      const bVal = attrs[b.attr] || 0;
      return bVal - aVal; // 属性值高的优先
    });
    return available.slice(0, maxSlots);
  }

  // ========== Mana 池按等级推导（通用规则） ==========
  // 等级取 max(vanguard.level, rearguard.level)

  const MANA_BY_LEVEL = {
    0: { max: 0,   regen: 0 },
    1: { max: 40,  regen: 3 },
    2: { max: 60,  regen: 4 },
    3: { max: 80,  regen: 4 },
    4: { max: 90,  regen: 5 },
    5: { max: 100, regen: 5 }
  };

  // ========== SkillSystem 类 ==========

  class SkillSystem {
    constructor() {
      // 所有注册的技能实例
      // key: uniqueId (ownerId + '_' + skillKey)
      // value: { ownerId, ownerName, skillKey, effect, level, activation, manaCost,
      //          active, description, target?, trigger?, cooldown?, currentCooldown? }
      this.skills = new Map();

      // 每个实体的 mana 池
      // key: ownerId, value: { current, max, regen }
      this.manaPools = new Map();

      // 反噬状态 (Rino 专属)
      this.backlash = { active: false, counter: 0 };

      // 当前回合已激活的技能队列（单次生效型，发牌后清除）
      this.pendingForces = [];

      // Curse 目标选择回调（由外部注入，解耦 AI 逻辑）
      // 签名: (casterId, players) => targetId
      this.curseTargetFn = null;

      // NPC 技能使用决策回调（由外部注入，解耦 AI 逻辑）
      // 签名: (skill, owner, gameContext, pendingForces, mana) => boolean
      this.skillDecideFn = null;

      // Hook 事件系统
      this._hooks = {};

      // 日志回调
      this.onLog = null;
    }

    // ========== Hook 事件系统 ==========

    /**
     * 注册事件监听
     * @param {string} event - 事件名
     * @param {Function} callback - 回调
     * @returns {Function} 取消注册的函数
     */
    on(event, callback) {
      if (!this._hooks[event]) this._hooks[event] = [];
      this._hooks[event].push(callback);
      return () => {
        this._hooks[event] = this._hooks[event].filter(cb => cb !== callback);
      };
    }

    /**
     * 触发事件
     * @param {string} event - 事件名
     * @param {*} data - 事件数据
     */
    emit(event, data) {
      const handlers = this._hooks[event];
      if (handlers) {
        for (const h of handlers) {
          try { h(data); } catch (e) { console.error('[SkillSystem] Hook error:', event, e); }
        }
      }
    }

    // ========== 技能注册（从 config 加载） ==========

    /**
     * 从 game-config 注册所有技能
     * 统一接口：每个角色都有 vanguard/rearguard/skills/attrs
     * skills key 必须是 UNIVERSAL_SKILLS 中的 key
     * mana 由 max(vanguard.level, rearguard.level) 推导
     */
    registerFromConfig(config) {
      this.skills.clear();
      this.manaPools.clear();

      // --- Hero ---
      if (config.hero) {
        const h = config.hero;
        const level = this._getCharLevel(h);
        const name = this._getCharName(h);
        const manaTemplate = MANA_BY_LEVEL[Math.min(5, level)] || MANA_BY_LEVEL[0];
        // 如果 config 提供了 mana/maxMana（来自 ERA 变量），使用它们
        const manaConfig = {
          max: (h.maxMana != null) ? h.maxMana : manaTemplate.max,
          regen: manaTemplate.regen
        };
        // current: 优先用 ERA 的 mana，否则满值
        manaConfig.current = (h.mana != null) ? Math.min(h.mana, manaConfig.max) : manaConfig.max;

        // v5 格式：区分主手/副手技能
        const vName = (h.vanguard && h.vanguard.name) || 'KAZU';
        const rName = (h.rearguard && h.rearguard.name) || null;

        if (h.vanguardSkills || h.rearguardSkills) {
          // 注册 mana 池（共享一个池）
          this._registerManaPool(0, manaConfig);
          // 主手技能
          if (h.vanguardSkills) {
            this._registerSkillList(0, name, 'human', h.vanguardSkills, vName);
          }
          // 副手技能
          if (h.rearguardSkills && rName) {
            this._registerSkillList(0, name, 'human', h.rearguardSkills, rName);
          }
        } else {
          // 兼容旧格式：单一 skills 数组
          this._registerEntity(0, name, 'human', h.skills || {}, manaConfig);
        }
      }

      // --- Seats (NPC) ---
      if (config.seats) {
        const seatOrder = ['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB'];
        let npcIndex = 1;
        for (const seat of seatOrder) {
          const s = config.seats[seat];
          if (!s) continue;
          const level = this._getCharLevel(s);
          const name = this._getCharName(s) || seat;
          const mana = MANA_BY_LEVEL[Math.min(5, level)] || MANA_BY_LEVEL[0];
          this._registerEntity(npcIndex, name, 'ai', s.skills || {}, mana);
          npcIndex++;
        }
      }

      this.emit('skills:loaded', { total: this.skills.size });
      this._log('SKILLS_LOADED', { total: this.skills.size });
    }

    /**
     * 角色等级 = max(vanguard.level, rearguard.level)
     * @private
     */
    _getCharLevel(char) {
      const vLv = (char.vanguard && char.vanguard.level) || 0;
      const rLv = (char.rearguard && char.rearguard.level) || 0;
      return Math.max(vLv, rLv);
    }

    /**
     * 角色显示名 = vanguard.name（主手名）
     * @private
     */
    _getCharName(char) {
      if (char.vanguard && char.vanguard.name) return char.vanguard.name;
      if (char.name) return char.name;
      return null;
    }

    /**
     * 注册 Mana 池（不注册技能）
     * @private
     */
    _registerManaPool(ownerId, manaConfig) {
      if (manaConfig) {
        this.manaPools.set(ownerId, {
          current: (manaConfig.current != null) ? manaConfig.current : manaConfig.max,
          max: manaConfig.max,
          regen: manaConfig.regen || 5
        });
      }
    }

    /**
     * 注册一组技能（带 casterName）
     * @private
     */
    _registerSkillList(ownerId, ownerName, ownerType, skillList, casterName) {
      const keys = Array.isArray(skillList)
        ? skillList
        : Object.keys(skillList || {});

      for (const skillKey of keys) {
        this._registerSingleSkill(ownerId, ownerName, ownerType, skillKey, casterName);
      }
    }

    /**
     * 注册单个实体的所有技能（兼容旧格式）
     * @private
     */
    _registerEntity(ownerId, ownerName, ownerType, skillList, manaConfig) {
      // Mana 池
      this._registerManaPool(ownerId, manaConfig);

      // 展开技能（skillList 是 key 数组，如 ["grand_wish", "refraction"]）
      // 兼容旧格式 { key: level } → 忽略 level 值，只取 key
      const keys = Array.isArray(skillList)
        ? skillList
        : Object.keys(skillList || {});

      for (const skillKey of keys) {
        this._registerSingleSkill(ownerId, ownerName, ownerType, skillKey, ownerName);
      }
    }

    /**
     * 注册单个技能
     * @private
     */
    _registerSingleSkill(ownerId, ownerName, ownerType, skillKey, casterName) {
      const catalog = lookupSkill(skillKey);
      if (!catalog) {
        console.warn('[SkillSystem] 未知技能 key:', skillKey, '(owner:', ownerName, ')');
        return;
      }

      const activation = catalog.activation || ACTIVATION.PASSIVE;
      const initialActive = (activation === ACTIVATION.PASSIVE);

      const skill = {
        uniqueId: ownerId + '_' + skillKey,
        ownerId: ownerId,
        ownerName: ownerName,
        ownerType: ownerType,
        casterName: casterName || ownerName,
        skillKey: skillKey,
        effect: catalog.effect,
        activation: activation,
        manaCost: catalog.manaCost || 0,
        power: catalog.power || 0,
        active: initialActive,
        description: catalog.description || '',
        target: catalog.target || null,
        trigger: null,
        cooldown: catalog.cooldown || 0,
        currentCooldown: 0,
        // 阶级压制元数据
        tier: catalog.tier || 3,
        attr: catalog.attr || null,
        suppressTiers: catalog.suppressTiers || null,
        suppressAttr: catalog.suppressAttr || null,
        suppressAll: catalog.suppressAll || false,
        cannotAffect: catalog.cannotAffect || null
      };

      this.skills.set(skill.uniqueId, skill);
      this._log('SKILL_REGISTERED', {
        owner: ownerName, caster: casterName, key: skillKey, effect: skill.effect,
        activation: activation, tier: skill.tier, power: skill.power
      });
    }

    // ========== Mana 管理 ==========

    getMana(ownerId) {
      return this.manaPools.get(ownerId) || { current: 0, max: 0, regen: 0 };
    }

    spendMana(ownerId, amount) {
      const pool = this.manaPools.get(ownerId);
      if (!pool || pool.current < amount) return false;
      pool.current -= amount;
      this._log('MANA_SPENT', { ownerId, amount, remaining: pool.current });

      // Rino 反噬检查
      if (ownerId === 0 && pool.current <= 0) {
        this.backlash = { active: true, counter: 3 };
        this._log('BACKLASH_TRIGGERED', { duration: 3 });
        this.emit('backlash:start', { counter: 3 });
      }

      this.emit('mana:changed', { ownerId, current: pool.current, max: pool.max });
      return true;
    }

    regenMana(ownerId, amount) {
      const pool = this.manaPools.get(ownerId);
      if (!pool) return;
      const add = (amount != null) ? amount : pool.regen;
      pool.current = Math.min(pool.max, pool.current + add);
      this.emit('mana:changed', { ownerId, current: pool.current, max: pool.max });
    }

    regenAllMana() {
      for (const [id] of this.manaPools) {
        this.regenMana(id);
      }
    }

    // ========== 玩家主动技能激活 ==========

    /**
     * 玩家手动激活技能
     * @param {string} uniqueId - 技能唯一ID (ownerId_skillKey)
     * @returns {{ success, reason?, skill? }}
     */
    activatePlayerSkill(uniqueId) {
      const skill = this.skills.get(uniqueId);
      if (!skill) return { success: false, reason: 'SKILL_NOT_FOUND' };
      if (skill.activation !== ACTIVATION.ACTIVE) return { success: false, reason: 'NOT_ACTIVE_TYPE' };

      // 反噬检查（仅 Rino）
      if (skill.ownerId === 0 && this.backlash.active) {
        return { success: false, reason: 'BACKLASH_ACTIVE', counter: this.backlash.counter };
      }

      // 冷却检查
      if (skill.currentCooldown > 0) {
        return { success: false, reason: 'ON_COOLDOWN', cooldown: skill.currentCooldown };
      }

      // Mana 检查
      if (skill.manaCost > 0 && !this.spendMana(skill.ownerId, skill.manaCost)) {
        return { success: false, reason: 'INSUFFICIENT_MANA', cost: skill.manaCost };
      }

      // 激活
      skill.currentCooldown = skill.cooldown;

      // 根据 effect 类型处理
      // Psyche 技能都是双重效果: 信息(必定) + 反制(vs Chaos)
      switch (skill.effect) {
        case EFFECT.CLARITY:
          // 澄澈: 信息=胜率显示, 反制=消除敌方 T3/T2 Curse
          this.pendingForces.push(this._skillToForce(skill));
          this.emit('skill:activated', { skill, type: 'clarity' });
          break;
        case EFFECT.REFRACTION:
          // 折射: 信息=透视手牌, 反制=消除敌方 T3/T2 Curse + 50%转化
          this.pendingForces.push(this._skillToForce(skill));
          this.emit('skill:activated', { skill, type: 'refraction' });
          break;
        case EFFECT.REVERSAL:
          // 真理: 信息=胜率+透视(继承), 反制=湮灭所有 Curse + 100%转化
          this.pendingForces.push(this._skillToForce(skill));
          this.emit('skill:activated', { skill, type: 'reversal' });
          break;
        case EFFECT.PURGE_ALL:
          // 现实：清除所有非 Void pendingForces，自身加入
          this.pendingForces = this.pendingForces.filter(f => f.attr === 'void');
          this.pendingForces.push(this._skillToForce(skill));
          this.emit('skill:activated', { skill, type: 'purge_all' });
          break;
        default:
          // fortune / curse / null_field / void_shield → 加入 pendingForces
          this.pendingForces.push(this._skillToForce(skill));
          this.emit('skill:activated', { skill, type: 'force' });
          break;
      }

      this._log('SKILL_ACTIVATED', {
        owner: skill.ownerName, key: skill.skillKey,
        effect: skill.effect, manaCost: skill.manaCost
      });

      return { success: true, skill };
    }

    // ========== NPC AI 技能决策 ==========

    /**
     * 在每个下注轮开始前，让所有 NPC 决定是否使用主动技能
     * @param {object} gameContext - { players, pot, phase, board }
     */
    npcDecideSkills(gameContext) {
      // 两轮决策：先进攻(fortune/curse)，再防御(psyche/void)
      // 这样 Psyche NPC 能看到本轮刚释放的 Chaos forces 并做出反应
      const OFFENSE_EFFECTS = [EFFECT.FORTUNE, EFFECT.CURSE];
      const DEFENSE_EFFECTS = [EFFECT.CLARITY, EFFECT.REFRACTION, EFFECT.REVERSAL, EFFECT.PURGE_ALL];

      for (var pass = 0; pass < 2; pass++) {
        var allowedEffects = pass === 0 ? OFFENSE_EFFECTS : DEFENSE_EFFECTS;

        for (const [, skill] of this.skills) {
          if (skill.ownerType === 'human') continue;
          if (skill.activation !== ACTIVATION.ACTIVE) continue;
          if (skill.currentCooldown > 0) continue;
          if (allowedEffects.indexOf(skill.effect) < 0) continue;

          // river 阶段无牌可发，发牌类技能无意义
          if (gameContext.phase === 'river') continue;

          // 检查 NPC 是否还在游戏中（未弃牌、有筹码）
          const owner = gameContext.players.find(p => p.id === skill.ownerId);
          if (!owner || owner.folded) continue;

          // AI 决策：根据技能类型和游戏状态决定是否使用
          const shouldUse = this._npcShouldUseSkill(skill, owner, gameContext);
          if (!shouldUse) continue;

          // Mana 检查
          if (skill.manaCost > 0) {
            const pool = this.manaPools.get(skill.ownerId);
            if (!pool || pool.current < skill.manaCost) continue;
            this.spendMana(skill.ownerId, skill.manaCost);
          }

          skill.currentCooldown = skill.cooldown;

          // 加入 pendingForces（传入 gameContext 供 curse 选目标）
          const force = this._skillToForce(skill, gameContext);
          this.pendingForces.push(force);

          // 找到目标名称（如果是 curse）
          const targetName = force.targetId != null
            ? ((gameContext.players.find(p => p.id === force.targetId) || {}).name || 'ID:' + force.targetId)
            : null;

          this._log('NPC_SKILL_USED', {
            owner: skill.ownerName, key: skill.skillKey,
            effect: skill.effect, tier: skill.tier,
            targetId: force.targetId, targetName: targetName
          });

          this.emit('npc:skill_used', {
            ownerName: skill.ownerName,
            skillKey: skill.skillKey,
            effect: skill.effect,
            tier: skill.tier,
            targetId: force.targetId,
            targetName: targetName
          });
        }
      }

    }

    /**
     * NPC AI 决定是否使用某个主动技能
     */
    _npcShouldUseSkill(skill, owner, gameContext) {
      // 委托给外部 AI 决策（SkillAI）
      if (this.skillDecideFn) {
        const mana = this.getMana(skill.ownerId);
        return this.skillDecideFn(skill, owner, gameContext, this.pendingForces, mana);
      }
      // 无回调时的简单 fallback
      const phaseProgression = { preflop: 0.15, flop: 0.35, turn: 0.55, river: 0.75 };
      return Math.random() < (phaseProgression[gameContext.phase] || 0.2);
    }

    _effectName(effect) {
      const names = {
        fortune:     '天命·幸运',
        curse:       '狂厄·凶',
        clarity:     '灵视·澄澈',
        refraction:  '灵视·折射',
        reversal:    '灵视·真理',
        null_field:  '虚无·屏蔽',
        void_shield: '虚无·绝缘',
        purge_all:   '虚无·现实'
      };
      return names[effect] || '未知魔力';
    }

    // ========== Triggered 技能检查 ==========

    /**
     * 检查所有 triggered 类型技能的触发条件
     */
    checkTriggers(gameContext) {
      for (const [, skill] of this.skills) {
        if (skill.activation !== ACTIVATION.TRIGGERED) continue;
        if (!skill.trigger) continue;

        let shouldActivate = false;

        switch (skill.trigger.condition) {
          case 'chips_below': {
            const owner = gameContext.players.find(p => p.id === skill.ownerId);
            if (owner && owner.chips < (skill.trigger.value || 200)) shouldActivate = true;
            break;
          }
          case 'chips_above': {
            const owner2 = gameContext.players.find(p => p.id === skill.ownerId);
            if (owner2 && owner2.chips > (skill.trigger.value || 2000)) shouldActivate = true;
            break;
          }
          case 'pot_above': {
            if (gameContext.pot > (skill.trigger.value || 500)) shouldActivate = true;
            break;
          }
          case 'phase': {
            if (gameContext.phase === skill.trigger.value) shouldActivate = true;
            break;
          }
        }

        if (shouldActivate && !skill.active) {
          skill.active = true;
          this.pendingForces.push(this._skillToForce(skill));
          this._log('SKILL_TRIGGERED', {
            owner: skill.ownerName, key: skill.skillKey,
            condition: skill.trigger.condition
          });
          this.emit('skill:triggered', { skill });
        } else if (!shouldActivate && skill.active) {
          skill.active = false;
        }
      }
    }

    // ========== 收集当前生效的 Forces ==========

    /**
     * 收集所有当前生效的力（供 MonteOfZero 使用）
     * @param {object} [gameContext] - { players } 用于检查弃牌状态
     * @returns {Array} forces 列表
     */
    collectActiveForces(gameContext) {
      const forces = [];
      // 构建弃牌玩家 id 集合
      const foldedIds = new Set();
      if (gameContext && gameContext.players) {
        for (const p of gameContext.players) {
          if (p.folded) foldedIds.add(p.id);
        }
      }

      // 1. 反噬
      if (this.backlash.active && this.backlash.counter > 0) {
        forces.push({
          ownerId: -1,
          ownerName: 'SYSTEM',
          type: 'backlash',
          level: 5,
          power: 50,
          targetId: 0, // 反噬 Rino
          source: 'backlash'
        });
        this.backlash.counter--;
        if (this.backlash.counter <= 0) {
          this.backlash.active = false;
          this.emit('backlash:end', {});
        }
        this._log('BACKLASH_TICK', { remaining: this.backlash.counter });
      }

      // 2. 被动技能（passive, active=true）— 弃牌者不生效
      for (const [, skill] of this.skills) {
        if (!skill.active) continue;
        if (skill.activation !== ACTIVATION.PASSIVE && skill.activation !== ACTIVATION.TOGGLE) continue;
        if (foldedIds.has(skill.ownerId)) continue;

        forces.push(this._skillToForce(skill));
      }

      // 3. 本回合 pending forces（主动技能 + NPC 技能 + triggered）
      // 弃牌者的 pending forces 也应失效
      for (const f of this.pendingForces) {
        if (foldedIds.has(f.ownerId)) continue;
        forces.push(f);
      }

      return forces;
    }

    /**
     * 将技能转为 force 对象（供 MonteOfZero 消费）
     * @param {object} skill
     * @param {object} [gameContext] - 用于 curse 智能选目标
     */
    _skillToForce(skill, gameContext) {
      const force = {
        ownerId: skill.ownerId,
        ownerName: skill.ownerName,
        type: skill.effect,
        power: skill.power || 0,
        activation: skill.activation,
        source: skill.activation,
        // 阶级压制元数据（供 MoZ 使用）
        tier: skill.tier || 3,
        attr: skill.attr || null,
        skillKey: skill.skillKey,
        suppressTiers: skill.suppressTiers || null,
        suppressAttr: skill.suppressAttr || null,
        suppressAll: skill.suppressAll || false,
        cannotAffect: skill.cannotAffect || null
      };

      // Curse 单体指向：委托外部 AI 选目标
      if (skill.effect === 'curse' && this.curseTargetFn) {
        const players = gameContext ? gameContext.players : null;
        force.targetId = this.curseTargetFn(skill.ownerId, players);
      }

      return force;
    }

    // ========== 回合生命周期 ==========

    /**
     * 每轮下注结束后调用
     */
    onRoundEnd() {
      // 注意：pendingForces 不在这里清除！
      // 它们会在 mozSelectAndPick() 发牌后清除，
      // 确保玩家在下注阶段激活的技能能在下一次发牌时生效。
      // 恢复所有 mana
      this.regenAllMana();

      // 重置 toggle 技能
      for (const [, skill] of this.skills) {
        if (skill.activation === ACTIVATION.TOGGLE && skill.active) {
          skill.active = false;
          this.emit('skill:toggle_reset', { skill });
        }
      }

      // 冷却递减
      for (const [, skill] of this.skills) {
        if (skill.currentCooldown > 0) {
          skill.currentCooldown--;
        }
      }

      this.emit('round:end', {});
    }

    /**
     * 新一手牌开始
     */
    onNewHand() {
      this.pendingForces = [];

      // 重置所有非 passive 技能状态
      for (const [, skill] of this.skills) {
        if (skill.activation !== ACTIVATION.PASSIVE) {
          skill.active = false;
        }
        skill.currentCooldown = 0;
      }

      this.emit('hand:start', {});
    }

    /**
     * 完全重置
     */
    reset() {
      this.pendingForces = [];
      this.backlash = { active: false, counter: 0 };

      for (const [, pool] of this.manaPools) {
        pool.current = pool.max;
      }

      for (const [, skill] of this.skills) {
        skill.active = (skill.activation === ACTIVATION.PASSIVE);
        skill.currentCooldown = 0;
      }

      this.emit('system:reset', {});
    }

    // ========== 状态查询 ==========

    getState() {
      const rinoMana = this.getMana(0);
      return {
        backlash: { ...this.backlash },
        rinoMana: rinoMana.current,
        rinoManaMax: rinoMana.max,
        pendingForces: this.pendingForces.map(f => ({
          owner: f.ownerName, type: f.type, tier: f.tier, power: f.power
        })),
        skills: Array.from(this.skills.values()).map(s => ({
          uniqueId: s.uniqueId,
          owner: s.ownerName,
          ownerId: s.ownerId,
          key: s.skillKey,
          effect: s.effect,
          tier: s.tier,
          activation: s.activation,
          active: s.active,
          manaCost: s.manaCost,
          cooldown: s.currentCooldown
        })),
      };
    }

    /**
     * 获取力量对比摘要
     */
    getForcesSummary() {
      const summary = { allies: [], enemies: [], total: { ally: 0, enemy: 0 } };

      // 被动力
      for (const [, skill] of this.skills) {
        if (!skill.active) continue;
        if (skill.activation !== ACTIVATION.PASSIVE) continue;

        const entry = { name: skill.ownerName, type: skill.effect, tier: skill.tier, power: skill.power };
        if (skill.ownerId === 0) {
          summary.allies.push(entry);
          summary.total.ally += entry.power;
        } else {
          summary.enemies.push(entry);
          summary.total.enemy += entry.power;
        }
      }

      // pending forces
      for (const f of this.pendingForces) {
        if (f.type === 'purge_all') continue;
        const entry = { name: f.ownerName, type: f.type, tier: f.tier, power: f.power };
        if (f.ownerId === 0) {
          summary.allies.push(entry);
          summary.total.ally += entry.power;
        } else {
          summary.enemies.push(entry);
          summary.total.enemy += entry.power;
        }
      }

      return summary;
    }

    /**
     * 获取某个玩家的所有技能
     */
    getPlayerSkills(ownerId) {
      return Array.from(this.skills.values()).filter(s => s.ownerId === ownerId);
    }

    /**
     * 检查是否有清场技能 (purge_all / reversal) 在 pending
     */
    hasPurgeActive() {
      return this.pendingForces.some(f =>
        f.type === 'purge_all' || f.type === 'reversal' ||
        f.type === 'clarity' || f.type === 'refraction'
      );
    }

    // ========== 日志 ==========

    _log(type, data) {
      if (this.onLog) this.onLog(type, data);
      console.log(`[SkillSystem] ${type}`, data);
    }
  }

  // ========== 导出 ==========
  global.SkillSystem = SkillSystem;
  global.SkillSystem.ACTIVATION = ACTIVATION;
  global.SkillSystem.EFFECT = EFFECT;
  global.SkillSystem.UNIVERSAL_SKILLS = UNIVERSAL_SKILLS;
  global.SkillSystem.MANA_BY_LEVEL = MANA_BY_LEVEL;
  global.SkillSystem.lookupSkill = lookupSkill;
  global.SkillSystem.calculateSlots = calculateSlots;
  global.SkillSystem.canLearnSkill = canLearnSkill;
  global.SkillSystem.deriveSkillsFromAttrs = deriveSkillsFromAttrs;

})(typeof window !== 'undefined' ? window : global);
