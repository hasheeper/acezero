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

  // 力的效果类型
  const EFFECT = {
    FORTUNE: 'fortune',             // 幸运：让自己赢
    CURSE: 'curse',                 // 诅咒：让目标输
    FORESIGHT: 'foresight',         // 先知：预览命运（不影响发牌）
    SENSE: 'sense',                 // 感知：探测敌方魔力使用
    PEEK: 'peek',                   // 透视：窥视对手手牌（三级）
    REVERSAL: 'reversal',           // 逆转：将厄运转化为命运
    FORTUNE_ANCHOR: 'fortune_anchor', // 命运之锚：削弱敌方被动fortune
    NULL_FIELD: 'null_field',       // 概率死角：Kazu的被动，削弱所有被动力
    BLANK: 'blank'                  // 空白因子：打碎一切命运
  };

  // 预定义技能 ID（快捷引用）
  const SKILL_ID = {
    RINO_FORTUNE_MAJOR: 'rino_fortune_major',
    RINO_FORTUNE_MINOR: 'rino_fortune_minor',
    RINO_FORESIGHT: 'rino_foresight',
    KAZU_BLANK_FACTOR: 'kazu_blank_factor',
    BACKLASH: 'backlash'
  };

  // ========== 静态技能目录（所有技能的完整定义） ==========

  const SKILL_CATALOG = {
    fortune:        { effect: 'fortune',        activation: 'active',  manaCost: 20, cooldown: 0, target: null,     description: '魔运·大吉 — 概率操控，命运倾斜' },
    foresight:      { effect: 'foresight',      activation: 'active',  manaCost: 10, cooldown: 0, target: null,     description: '魔运·先知 — 窥视命运的多条路径' },
    sense:          { effect: 'sense',          activation: 'passive', manaCost: 0,  cooldown: 0, target: null,     description: '魔运·感知 — 感知敌方魔力波动' },
    peek:           { effect: 'peek',           activation: 'active',  manaCost: 10, cooldown: 0, target: null,     description: '魔运·透视 — 窥视对手底牌' },
    reversal:       { effect: 'reversal',       activation: 'active',  manaCost: 25, cooldown: 2, target: null,     description: '魔运·逆转 — 将厄运转化为命运之力' },
    fortune_anchor: { effect: 'fortune_anchor', activation: 'passive', manaCost: 0,  cooldown: 0, target: null,     description: '命运之锚 — 削弱敌方被动魔运' },
    blank_factor:   { effect: 'blank',          activation: 'active',  manaCost: 0,  cooldown: 3, target: null,     description: '空白因子 — 打碎一切命运' },
    null_field:     { effect: 'null_field',     activation: 'passive', manaCost: 0,  cooldown: 0, target: null,     description: '概率死角 — 削弱所有被动魔运力量' },
    curse:          { effect: 'curse',          activation: 'passive', manaCost: 0,  cooldown: 0, target: 'player', description: '魔运·厄运 — 被动诅咒' },
    curse_active:   { effect: 'curse',          activation: 'active',  manaCost: 15, cooldown: 3, target: 'player', description: '魔运·诅咒 — 主动释放厄运' },
    fortune_burst:  { effect: 'fortune',        activation: 'active',  manaCost: 25, cooldown: 2, target: null,     description: '魔运·爆发 — 主动强化幸运' },
    fortune_passive:{ effect: 'fortune',        activation: 'passive', manaCost: 0,  cooldown: 0, target: null,     description: '魔运·幸运 — 微弱被动运势偏移' }
  };

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

      // 本回合的感知事件缓存
      this.senseEvents = [];

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
     * 从 game-config.json 注册所有技能
     * 统一接口：每个角色都有 vanguard/rearguard/skills/attrs
     * mana 由 max(vanguard.level, rearguard.level) 推导
     *
     * 兼容旧格式: [{ id, name, type, magicSkills }]
     */
    registerFromConfig(config) {
      if (Array.isArray(config)) {
        return this._registerLegacy(config);
      }

      this.skills.clear();
      this.manaPools.clear();

      // --- Hero ---
      if (config.hero) {
        const h = config.hero;
        const level = this._getCharLevel(h);
        const name = this._getCharName(h);
        const mana = MANA_BY_LEVEL[Math.min(5, level)] || MANA_BY_LEVEL[0];
        this._registerEntity(0, name, 'human', h.skills || {}, mana);
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
     * 注册单个实体的所有技能
     * @private
     */
    _registerEntity(ownerId, ownerName, ownerType, skillMap, manaConfig) {
      // Mana 池
      if (manaConfig) {
        this.manaPools.set(ownerId, {
          current: manaConfig.max,
          max: manaConfig.max,
          regen: manaConfig.regen || 5
        });
      }

      // 展开技能
      for (const [skillKey, skillLevel] of Object.entries(skillMap)) {
        const catalog = SKILL_CATALOG[skillKey];
        if (!catalog) continue;

        const activation = catalog.activation || ACTIVATION.PASSIVE;
        const initialActive = (activation === ACTIVATION.PASSIVE);

        const skill = {
          uniqueId: ownerId + '_' + skillKey,
          ownerId: ownerId,
          ownerName: ownerName,
          ownerType: ownerType,
          skillKey: skillKey,
          effect: catalog.effect,
          level: skillLevel,
          activation: activation,
          manaCost: catalog.manaCost || 0,
          active: initialActive,
          description: catalog.description || '',
          target: catalog.target || null,
          trigger: null,
          cooldown: catalog.cooldown || 0,
          currentCooldown: 0
        };

        this.skills.set(skill.uniqueId, skill);
        this._log('SKILL_REGISTERED', {
          owner: ownerName, key: skillKey, effect: skill.effect,
          level: skillLevel, activation: activation
        });
      }
    }

    /**
     * 旧格式兼容：从 players 数组注册
     * @private
     */
    _registerLegacy(playerConfigs) {
      this.skills.clear();
      this.manaPools.clear();

      for (const pc of playerConfigs) {
        if (!pc.magicSkills) continue;

        const manaConfig = pc.magicSkills._mana || {};
        this.manaPools.set(pc.id, {
          current: manaConfig.max || 100,
          max: manaConfig.max || 100,
          regen: manaConfig.regen || 5
        });

        for (const [skillKey, skillDef] of Object.entries(pc.magicSkills)) {
          if (skillKey === '_mana') continue;
          if (!skillDef || typeof skillDef !== 'object') continue;

          const activation = skillDef.activation || ACTIVATION.PASSIVE;
          const initialActive = (activation === ACTIVATION.PASSIVE);

          const skill = {
            uniqueId: pc.id + '_' + skillKey,
            ownerId: pc.id,
            ownerName: pc.name,
            ownerType: pc.type || 'ai',
            skillKey: skillKey,
            effect: skillDef.effect || this._inferEffect(skillKey),
            level: skillDef.level || 1,
            activation: activation,
            manaCost: skillDef.manaCost || 0,
            active: initialActive,
            description: skillDef.description || '',
            target: skillDef.target || null,
            trigger: skillDef.trigger || null,
            cooldown: skillDef.cooldown || 0,
            currentCooldown: 0
          };

          this.skills.set(skill.uniqueId, skill);
        }
      }

      this.emit('skills:loaded', { total: this.skills.size });
    }

    /**
     * 从 skillKey 推断 effect 类型
     */
    _inferEffect(skillKey) {
      if (skillKey.includes('fortune') || skillKey.includes('luck')) return EFFECT.FORTUNE;
      if (skillKey.includes('curse') || skillKey.includes('hex')) return EFFECT.CURSE;
      if (skillKey.includes('foresight') || skillKey.includes('vision')) return EFFECT.FORESIGHT;
      if (skillKey.includes('sense') || skillKey.includes('detect')) return EFFECT.SENSE;
      if (skillKey.includes('peek') || skillKey.includes('spy')) return EFFECT.PEEK;
      if (skillKey.includes('reversal') || skillKey.includes('reverse')) return EFFECT.REVERSAL;
      if (skillKey.includes('anchor')) return EFFECT.FORTUNE_ANCHOR;
      if (skillKey.includes('null_field')) return EFFECT.NULL_FIELD;
      if (skillKey.includes('blank')) return EFFECT.BLANK;
      return EFFECT.FORTUNE; // 默认
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
      if (skill.effect === EFFECT.SENSE) {
        // 感知是被动的，不加入 pendingForces
        // 但主动激活可以增强感知
        this.emit('skill:activated', { skill, type: 'sense_boost' });
      } else if (skill.effect === EFFECT.FORESIGHT) {
        // 先知不影响发牌，只触发预览事件
        this.emit('skill:activated', { skill, type: 'foresight' });
      } else if (skill.effect === EFFECT.BLANK) {
        // 空白因子：清除所有 pendingForces
        this.pendingForces = [];
        this.pendingForces.push(this._skillToForce(skill));
        this.emit('skill:activated', { skill, type: 'blank' });
      } else {
        // fortune / curse → 加入 pendingForces
        this.pendingForces.push(this._skillToForce(skill));
        this.emit('skill:activated', { skill, type: 'force' });
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
      for (const [, skill] of this.skills) {
        if (skill.ownerType === 'human') continue;
        if (skill.activation !== ACTIVATION.ACTIVE) continue;
        if (skill.currentCooldown > 0) continue;

        // river 阶段无牌可发，fortune/curse 无意义
        if (gameContext.phase === 'river' &&
            (skill.effect === EFFECT.FORTUNE || skill.effect === EFFECT.CURSE)) continue;

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

        // 加入 pendingForces
        const force = this._skillToForce(skill);
        this.pendingForces.push(force);

        this._log('NPC_SKILL_USED', {
          owner: skill.ownerName, key: skill.skillKey,
          effect: skill.effect, level: skill.level
        });

        // 触发感知事件（让玩家被动技能检测到）
        this.senseEvents.push({
          ownerId: skill.ownerId,
          ownerName: skill.ownerName,
          skillKey: skill.skillKey,
          effect: skill.effect,
          level: skill.level,
          timestamp: Date.now()
        });

        this.emit('npc:skill_used', {
          ownerId: skill.ownerId,
          ownerName: skill.ownerName,
          skillKey: skill.skillKey,
          effect: skill.effect,
          level: skill.level
        });
      }

      // NPC 技能使用完毕后，检查玩家的感知技能
      this._processSenseSkills(gameContext);
    }

    /**
     * NPC AI 决定是否使用某个主动技能
     */
    _npcShouldUseSkill(skill, owner, gameContext) {
      const phase = gameContext.phase;
      const pot = gameContext.pot || 0;

      switch (skill.effect) {
        case EFFECT.FORTUNE: {
          // 幸运：pot 越大越倾向使用，preflop 概率低，后面越来越高
          const phaseWeight = { preflop: 0.15, flop: 0.4, turn: 0.6, river: 0.8 };
          const weight = phaseWeight[phase] || 0.2;
          // 高等级 NPC 更聪明地使用
          const levelBonus = skill.level * 0.05;
          return Math.random() < (weight + levelBonus);
        }
        case EFFECT.CURSE: {
          // 诅咒：pot 大时更倾向使用
          const potThreshold = 100;
          const potFactor = Math.min(1, pot / (potThreshold * 3));
          const phaseWeight2 = { preflop: 0.1, flop: 0.3, turn: 0.5, river: 0.7 };
          const weight2 = phaseWeight2[phase] || 0.1;
          return Math.random() < (weight2 * 0.5 + potFactor * 0.5);
        }
        default:
          return Math.random() < 0.3;
      }
    }

    // ========== 被动感知系统 ==========

    /**
     * 处理玩家的感知技能 — 检测敌方魔力使用
     */
    _processSenseSkills(gameContext) {
      if (this.senseEvents.length === 0) return;

      // 找到所有拥有 sense 技能的玩家
      for (const [, skill] of this.skills) {
        if (skill.effect !== EFFECT.SENSE) continue;
        if (!skill.active && skill.activation === ACTIVATION.PASSIVE) continue;
        // passive sense 始终生效
        if (skill.activation !== ACTIVATION.PASSIVE && !skill.active) continue;

        const senseLevel = skill.level;

        // 对每个感知事件进行检测
        for (const event of this.senseEvents) {
          // 不感知自己的技能
          if (event.ownerId === skill.ownerId) continue;

          // 感知成功率 = senseLevel / (senseLevel + enemyLevel) × 100%
          // level 3 sense vs level 3 enemy = 50% 感知率
          // level 3 sense vs level 1 enemy = 75% 感知率
          const detectChance = senseLevel / (senseLevel + event.level);
          const detected = Math.random() < detectChance;

          if (detected) {
            // 感知精度：高等级感知能看到更多细节
            const detail = this._getSenseDetail(senseLevel, event);

            this.emit('sense:detected', {
              sensorId: skill.ownerId,
              sensorName: skill.ownerName,
              senseLevel: senseLevel,
              event: event,
              detail: detail
            });

            this._log('SENSE_DETECTED', {
              sensor: skill.ownerName, target: event.ownerName,
              effect: detail.effectHint, level: detail.levelHint,
              accuracy: Math.round(detectChance * 100) + '%'
            });
          } else {
            // 感知失败，但可能有模糊提示
            if (Math.random() < 0.3) {
              this.emit('sense:vague', {
                sensorId: skill.ownerId,
                message: '命运场出现了微弱的波动...'
              });
            }
          }
        }
      }
    }

    /**
     * 根据感知等级返回不同精度的信息
     */
    _getSenseDetail(senseLevel, event) {
      if (senseLevel >= 5) {
        // 完美感知：知道谁用了什么技能、等级
        return {
          accuracy: 'perfect',
          effectHint: event.effect,
          levelHint: event.level,
          ownerHint: event.ownerName,
          message: `${event.ownerName} 使用了 ${this._effectName(event.effect)} Lv.${event.level}！`
        };
      } else if (senseLevel >= 3) {
        // 中等感知：知道技能类型和大致方向
        return {
          accuracy: 'medium',
          effectHint: event.effect,
          levelHint: event.level > 3 ? '强' : event.level > 1 ? '中' : '弱',
          ownerHint: null,
          message: `感知到 ${this._effectName(event.effect)} 的气息...强度: ${event.level > 3 ? '强' : event.level > 1 ? '中' : '弱'}`
        };
      } else {
        // 低等级感知：只知道有人用了魔力
        return {
          accuracy: 'low',
          effectHint: null,
          levelHint: null,
          ownerHint: null,
          message: '命运场发生了变化...'
        };
      }
    }

    _effectName(effect) {
      const names = {
        [EFFECT.FORTUNE]: '魔运·幸运',
        [EFFECT.CURSE]: '魔运·诅咒',
        [EFFECT.FORESIGHT]: '魔运·先知',
        [EFFECT.BLANK]: '空白因子',
        [EFFECT.SENSE]: '魔运·感知'
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

          // 也产生感知事件
          this.senseEvents.push({
            ownerId: skill.ownerId,
            ownerName: skill.ownerName,
            skillKey: skill.skillKey,
            effect: skill.effect,
            level: skill.level,
            timestamp: Date.now()
          });
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
      // 跳过纯信息/动作类技能（不产生命运力量）
      for (const [, skill] of this.skills) {
        if (!skill.active) continue;
        if (skill.activation !== ACTIVATION.PASSIVE && skill.activation !== ACTIVATION.TOGGLE) continue;
        if (skill.effect === EFFECT.FORESIGHT || skill.effect === EFFECT.SENSE || skill.effect === EFFECT.PEEK || skill.effect === EFFECT.REVERSAL) continue;
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
     */
    _skillToForce(skill) {
      // 被动技能基础力量远低于主动技能
      // passive: level × 3 (微弱底色)    active: level × 10 (决定性力量)
      // toggle:  level × 8                triggered: level × 8
      let basePower = 0;
      if (skill.effect !== EFFECT.BLANK) {
        switch (skill.activation) {
          case ACTIVATION.PASSIVE:   basePower = skill.level * 3;  break;
          case ACTIVATION.ACTIVE:    basePower = skill.level * 10; break;
          case ACTIVATION.TOGGLE:    basePower = skill.level * 8;  break;
          case ACTIVATION.TRIGGERED: basePower = skill.level * 8;  break;
          default:                   basePower = skill.level * 5;  break;
        }
      }

      const force = {
        ownerId: skill.ownerId,
        ownerName: skill.ownerName,
        type: skill.effect,
        level: skill.level,
        power: basePower,
        activation: skill.activation,  // 传给 MoZ 用于力量对抗计算
        source: skill.activation
      };

      if (skill.effect === EFFECT.CURSE && skill.target) {
        force.targetId = skill.target === 'player' ? 0 : skill.target;
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
      this.senseEvents = [];

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
      this.senseEvents = [];

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
      this.senseEvents = [];
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
          owner: f.ownerName, type: f.type, level: f.level
        })),
        skills: Array.from(this.skills.values()).map(s => ({
          uniqueId: s.uniqueId,
          owner: s.ownerName,
          ownerId: s.ownerId,
          key: s.skillKey,
          effect: s.effect,
          level: s.level,
          activation: s.activation,
          active: s.active,
          manaCost: s.manaCost,
          cooldown: s.currentCooldown
        })),
        senseEvents: [...this.senseEvents]
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
        if (skill.effect === EFFECT.FORESIGHT || skill.effect === EFFECT.SENSE) continue;
        if (skill.activation !== ACTIVATION.PASSIVE) continue;

        const entry = { name: skill.ownerName, type: skill.effect, level: skill.level, power: skill.level * 3 };
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
        if (f.type === EFFECT.BLANK) continue;
        const entry = { name: f.ownerName, type: f.type, level: f.level, power: f.power };
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
     * 检查是否有空白因子在 pending
     */
    hasBlankFactor() {
      return this.pendingForces.some(f => f.type === EFFECT.BLANK);
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
  global.SkillSystem.SKILL_ID = SKILL_ID;
  global.SkillSystem.SKILL_CATALOG = SKILL_CATALOG;
  global.SkillSystem.MANA_BY_LEVEL = MANA_BY_LEVEL;

})(typeof window !== 'undefined' ? window : global);
