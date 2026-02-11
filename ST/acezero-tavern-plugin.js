/**
 * =============================================================
 * ACEZERO TAVERN PLUGIN — 酒馆助手中间件
 * =============================================================
 *
 * 流程（与 pkm-tavern-plugin.js 同构）:
 *
 *   1. GENERATION_AFTER_COMMANDS
 *      读取 ERA 变量 → 构建 hero 状态 XML 摘要 → injectPrompts 注入 AI 上下文
 *
 *   2. AI 回复
 *      AI 在正文中输出 <ACE0_BATTLE> { ...战局JSON... } </ACE0_BATTLE>
 *      同时 AI 可能输出 <VariableEdit> 等标准 ERA 指令（ERA 框架自动处理）
 *
 *   3. era:writeDone
 *      检测消息中的 <ACE0_BATTLE> 标签 → 解析 AI 的战局 JSON
 *      → 读取 ERA hero 数据 → 按等级展开技能/特质/属性
 *      → 合并为完整 game-config
 *      → 追加 <ACE0_FRONTEND>\n{完整JSON}\n</ACE0_FRONTEND> 到消息
 *      → SillyTavern 正则匹配 ACE0_FRONTEND → 替换为 STver.html（$1 = JSON）
 *      → STver.html 解析 JSON → postMessage 到游戏 iframe
 *
 * ERA 变量结构（扁平，无外层包装）:
 * {
 *   "hero": { "funds": 500, "vanguard": "KAZU", "rearguard": "RINO" },
 *   "KAZU": { "role": "vanguard", "level": 3 },
 *   "RINO": { "role": "rearguard", "level": 5 }
 * }
 *
 * 依赖: ERA 变量框架 + JS-Slash-Runner (酒馆助手) API
 */

(async function () {
  'use strict';

  const PLUGIN_NAME = '[ACE0]';
  const BATTLE_TAG = 'ACE0_BATTLE';
  const FRONTEND_TAG = 'ACE0_FRONTEND';
  const INJECT_ID = 'ace0_hero_state';

  let lastHandledMk = null;
  let isProcessing = false;

  console.log(`${PLUGIN_NAME} 插件加载中...`);

  // ==========================================================
  //  通用技能目录（与 skill-system.js UNIVERSAL_SKILLS 同步）
  // ==========================================================

  const UNIVERSAL_SKILLS = {
    minor_wish:   { attr: 'moirai', tier: 3, threshold: 20 },
    grand_wish:   { attr: 'moirai', tier: 2, threshold: 40 },
    divine_order: { attr: 'moirai', tier: 1, threshold: 60 },
    hex:          { attr: 'chaos',  tier: 3, threshold: 20 },
    havoc:        { attr: 'chaos',  tier: 2, threshold: 40 },
    catastrophe:  { attr: 'chaos',  tier: 1, threshold: 60 },
    insight:      { attr: 'psyche', tier: 3, threshold: 20 },
    vision:       { attr: 'psyche', tier: 2, threshold: 40 },
    axiom:        { attr: 'psyche', tier: 1, threshold: 60 },
    static_field: { attr: 'void',   tier: 3, threshold: 20 },
    insulation:   { attr: 'void',   tier: 2, threshold: 40 },
    reality:      { attr: 'void',   tier: 1, threshold: 60 }
  };

  // 特质解锁（按等级）
  const VANGUARD_TRAIT_UNLOCK = {
    0: null, 1: null, 2: 'blank_body', 3: 'blank_body', 4: 'blank_body', 5: 'blank_body'
  };

  const REARGUARD_TRAIT_UNLOCK = {
    0: null, 1: null, 2: null, 3: 'fate_weaver', 4: 'fate_weaver', 5: 'fate_weaver'
  };

  const MANA_BY_LEVEL = {
    0: { max: 0,   regen: 0 },
    1: { max: 40,  regen: 3 },
    2: { max: 60,  regen: 4 },
    3: { max: 80,  regen: 4 },
    4: { max: 90,  regen: 5 },
    5: { max: 100, regen: 5 }
  };

  // 默认属性面板（按 max(vLv, rLv) 推导）
  const HERO_ATTRS_BY_LEVEL = {
    0: { moirai: 10, chaos: 10, psyche: 10, void: 10 },
    1: { moirai: 20, chaos: 15, psyche: 20, void: 20 },
    2: { moirai: 40, chaos: 15, psyche: 30, void: 40 },
    3: { moirai: 60, chaos: 20, psyche: 40, void: 60 },
    4: { moirai: 70, chaos: 20, psyche: 45, void: 80 },
    5: { moirai: 80, chaos: 20, psyche: 50, void: 100 }
  };

  /**
   * 从属性面板推导可用技能（与 skill-system.js deriveSkillsFromAttrs 同构）
   * @param {object} attrs - { moirai, chaos, psyche, void }
   * @returns {object} - { skillKey: level, ... }  level 基于属性值推算
   */
  function deriveSkillsFromAttrs(attrs) {
    const total = (attrs.moirai || 0) + (attrs.chaos || 0) +
                  (attrs.psyche || 0) + (attrs.void || 0);
    const maxSlots = total >= 120 ? 4 : total >= 80 ? 3 : total >= 40 ? 2 : 1;

    const available = [];
    for (const key in UNIVERSAL_SKILLS) {
      const def = UNIVERSAL_SKILLS[key];
      if ((attrs[def.attr] || 0) >= def.threshold) {
        available.push({ key, ...def });
      }
    }
    // T1 优先，同 tier 按属性值高的优先
    available.sort((a, b) => {
      if (a.tier !== b.tier) return a.tier - b.tier;
      return (attrs[b.attr] || 0) - (attrs[a.attr] || 0);
    });

    return available.slice(0, maxSlots).map(s => s.key);
  }

  // ==========================================================
  //  NPC 组装流水线 — 四维度模块化系统
  //
  //  一个 NPC = kernel + wealth + archetype + mood
  //  四个维度完全解耦，只在 assembleNPC() 时缝合为 seat config
  // ==========================================================

  // ----------------------------------------------------------
  //  维度 1: AI 核心 (AI_KERNELS) — 性格 + 水平 固定组合
  // ----------------------------------------------------------
  const AI_KERNELS = {
    mob:      { ai: 'passive',    difficulty: 'noob',    desc: '杂鱼 — 盲目跟注，容易弃牌' },
    gambler:  { ai: 'maniac',     difficulty: 'noob',    desc: '赌徒 — 疯狂乱推，毫无章法' },
    rock:     { ai: 'rock',       difficulty: 'regular', desc: '老苟 — 不见兔子不撒鹰' },
    shark:    { ai: 'aggressive', difficulty: 'pro',     desc: '鲨鱼 — 剥削型打法，极其难缠' },
    boss:     { ai: 'balanced',   difficulty: 'pro',     desc: '魔王 — 滴水不漏，连运气都会算' }
  };

  // ----------------------------------------------------------
  //  维度 2: 经济阶级 (WEALTH_CLASSES) — 筹码 + 盲注锚点
  //  单位: 银弗 (1金弗 = 100银弗, 最小筹码 = 1银弗)
  // ----------------------------------------------------------
  const WEALTH_CLASSES = {
    poor:   { chips: 500,   blinds: [5, 10],      desc: '贫民窟 (5金)' },
    normal: { chips: 2000,  blinds: [20, 40],     desc: '市民 (20金)' },
    rich:   { chips: 10000, blinds: [100, 200],   desc: '富豪 (100金)' },
    whale:  { chips: 50000, blinds: [500, 1000],  desc: '巨鲸 (500金)' }
  };

  // ----------------------------------------------------------
  //  维度 3: 异能模版 (RPG_TEMPLATES) — 属性 + 技能快速入口
  //  attrs 由模版定义，skills 由 deriveSkillsFromAttrs 自动推导
  // ----------------------------------------------------------
  const RPG_TEMPLATES = {
    muggle: {
      desc: '麻瓜/常人 — 无异能',
      level: 0,
      attrs: { moirai: 0, chaos: 0, psyche: 0, void: 0 }
    },
    lucky: {
      desc: '幸运儿/龙套精英 — 命运偏向',
      level: 2,
      attrs: { moirai: 40, chaos: 0, psyche: 0, void: 0 }
    },
    cursed: {
      desc: '厄运散播者/小Boss — 混沌诅咒',
      level: 3,
      attrs: { moirai: 0, chaos: 50, psyche: 0, void: 0 }
    },
    esper: {
      desc: '灵能者 — 绝对资讯优势',
      level: 4,
      attrs: { moirai: 0, chaos: 0, psyche: 80, void: 0 }
    },
    nullifier: {
      desc: '抹杀者/终极Boss — 屏蔽一切',
      level: 5,
      attrs: { moirai: 0, chaos: 0, psyche: 0, void: 100 }
    }
  };

  // ----------------------------------------------------------
  //  维度 4: 情绪修正 (MOOD_MODIFIERS) — 运行时覆写层
  //  与 poker-ai.js EMOTION_PROFILES 同步，此处仅做枚举 + 描述
  // ----------------------------------------------------------
  const MOOD_MODIFIERS = {
    calm:       { emotion: 'calm',       desc: '冷静 — 无修正（默认）' },
    confident:  { emotion: 'confident',  desc: '自信 — 敢打敢冲' },
    tilt:       { emotion: 'tilt',       desc: '上头 — 情绪失控，判断力暴跌' },
    fearful:    { emotion: 'fearful',    desc: '恐惧 — 畏手畏脚，容易弃牌' },
    desperate:  { emotion: 'desperate',  desc: '绝望 — 孤注一掷' },
    euphoric:   { emotion: 'euphoric',   desc: '狂喜 — 飘飘然，容易轻敌' }
  };

  // ----------------------------------------------------------
  //  跑龙套预设 (RUNNER_PRESETS) — 常见 NPC 一键生成
  //  每个 = kernel + wealth + archetype + mood 的固定组合
  // ----------------------------------------------------------
  const RUNNER_PRESETS = {
    // 杂兵类
    street_thug:    { kernel: 'mob',     wealth: 'poor',   archetype: 'muggle',  mood: 'calm',      desc: '街头小混混' },
    drunk:          { kernel: 'gambler', wealth: 'poor',   archetype: 'muggle',  mood: 'euphoric',  desc: '醉汉赌徒' },
    rookie:         { kernel: 'mob',     wealth: 'normal', archetype: 'muggle',  mood: 'fearful',   desc: '紧张的新手' },
    // 常规对手
    tavern_regular: { kernel: 'rock',    wealth: 'normal', archetype: 'muggle',  mood: 'calm',      desc: '酒馆常客' },
    pro_gambler:    { kernel: 'shark',   wealth: 'normal', archetype: 'muggle',  mood: 'confident', desc: '职业赌徒' },
    lucky_bastard:  { kernel: 'gambler', wealth: 'normal', archetype: 'lucky',   mood: 'euphoric',  desc: '运气极好的家伙' },
    // 精英/小Boss
    casino_shark:   { kernel: 'shark',   wealth: 'rich',   archetype: 'muggle',  mood: 'calm',      desc: '赌场鲨鱼' },
    curse_dealer:   { kernel: 'shark',   wealth: 'rich',   archetype: 'cursed',  mood: 'confident', desc: '厄运荷官' },
    mind_reader:    { kernel: 'boss',    wealth: 'rich',   archetype: 'esper',   mood: 'calm',      desc: '读心者' },
    // Boss
    void_king:      { kernel: 'boss',    wealth: 'whale',  archetype: 'nullifier', mood: 'confident', desc: '虚空之王' },
    chaos_lord:     { kernel: 'shark',   wealth: 'whale',  archetype: 'cursed',    mood: 'tilt',      desc: '混沌领主' }
  };

  // ----------------------------------------------------------
  //  组装函数：四维度 → 完整 NPC seat config
  // ----------------------------------------------------------

  /**
   * 从四个维度组装一个完整的 NPC 座位配置
   *
   * @param {string} name - NPC 显示名称（必填）
   * @param {object} dims - 四维度参数
   * @param {string} dims.kernel    - AI_KERNELS 键名（默认 'mob'）
   * @param {string} dims.wealth    - WEALTH_CLASSES 键名（默认 'normal'）
   * @param {string} dims.archetype - RPG_TEMPLATES 键名（默认 'muggle'）
   * @param {string} dims.mood      - MOOD_MODIFIERS 键名（默认 'calm'）
   * @returns {object} - 完整的 NPC seat config（可直接放入 seats.XX）
   */
  function assembleNPC(name, dims) {
    const d = dims || {};
    const kernel    = AI_KERNELS[d.kernel]       || AI_KERNELS.mob;
    const wealth    = WEALTH_CLASSES[d.wealth]    || WEALTH_CLASSES.normal;
    const archetype = RPG_TEMPLATES[d.archetype]  || RPG_TEMPLATES.muggle;
    const mood      = MOOD_MODIFIERS[d.mood]      || MOOD_MODIFIERS.calm;

    const result = {
      vanguard: { name: name || '???', level: archetype.level || 0 },
      ai: kernel.ai,
      emotion: mood.emotion
    };

    // 异能模版：有属性才写入
    const hasAttrs = archetype.attrs &&
      (archetype.attrs.moirai || archetype.attrs.chaos ||
       archetype.attrs.psyche || archetype.attrs.void);
    if (hasAttrs) {
      result.attrs = { ...archetype.attrs };
      result.skills = deriveSkillsFromAttrs(archetype.attrs);
    }

    return result;
  }

  /**
   * 从跑龙套预设名 + 自定义名称 → 完整 NPC seat config
   */
  function assembleFromRunner(runnerKey, name) {
    const preset = RUNNER_PRESETS[runnerKey];
    if (!preset) {
      console.warn(`${PLUGIN_NAME} 未知跑龙套预设: ${runnerKey}`);
      return assembleNPC(name || '???', {});
    }
    return assembleNPC(name || preset.desc, {
      kernel: preset.kernel,
      wealth: preset.wealth,
      archetype: preset.archetype,
      mood: preset.mood
    });
  }

  /**
   * 从跑龙套预设推导经济参数（blinds, chips）
   * 用于整桌都是同一经济阶级时的快捷推导
   */
  function getWealthParams(wealthKey) {
    return WEALTH_CLASSES[wealthKey] || WEALTH_CLASSES.normal;
  }

  /**
   * 解析 AI 输出的座位配置：支持三种格式
   *   1. 跑龙套速记: { "runner": "street_thug", "name": "阿猫" }
   *   2. 四维组装:    { "name": "X", "kernel": "shark", "wealth": "rich", "archetype": "cursed", "mood": "tilt" }
   *   3. 原始直写:    { "vanguard": {...}, "ai": "balanced", ... }（透传，不处理）
   */
  function resolveNpcSeat(seatData) {
    if (!seatData) return null;

    // 模式 1: 跑龙套速记
    if (seatData.runner) {
      return assembleFromRunner(seatData.runner, seatData.name);
    }

    // 模式 2: 四维组装（有 kernel 字段）
    if (seatData.kernel) {
      return assembleNPC(seatData.name || '???', {
        kernel:    seatData.kernel,
        wealth:    seatData.wealth,
        archetype: seatData.archetype,
        mood:      seatData.mood
      });
    }

    // 模式 3: 原始直写（透传）
    return seatData;
  }

  /**
   * 解析整个战局数据：遍历 seats，对每个座位调用 resolveNpcSeat
   * 同时处理 wealth 字段推导全局 blinds/chips
   */
  function resolveBattleData(battleData) {
    if (!battleData || !battleData.seats) return battleData;

    const resolved = { ...battleData };

    // 全局经济阶级：如果 battleData 有 wealth 字段，用它推导 blinds/chips
    if (battleData.wealth && !battleData.blinds) {
      const wp = getWealthParams(battleData.wealth);
      resolved.blinds = wp.blinds;
      resolved.chips = wp.chips;
    }

    // 解析每个座位
    const resolvedSeats = {};
    for (const seatId in battleData.seats) {
      resolvedSeats[seatId] = resolveNpcSeat(battleData.seats[seatId]);
    }
    resolved.seats = resolvedSeats;

    return resolved;
  }

  // ==========================================================
  //  工具函数
  // ==========================================================

  function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ==========================================================
  //  ERA 变量读写（通过 ERA 框架事件）
  // ==========================================================

  async function getEraVars() {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        console.warn(`${PLUGIN_NAME} ERA 查询超时`);
        resolve(null);
      }, 5000);

      eventOn('era:queryResult', (detail) => {
        if (detail.queryType === 'getCurrentVars') {
          clearTimeout(timeout);
          resolve(detail.result?.statWithoutMeta || null);
        }
      }, { once: true });

      eventEmit('era:getCurrentVars');
    });
  }

  function updateEraVars(data) {
    eventEmit('era:updateByObject', data);
  }

  // ==========================================================
  //  ERA → 完整 game-config 构建
  // ==========================================================

  /**
   * 从 ERA 变量中提取 hero 数据，按等级展开技能/特质/属性，
   * 与 AI 提供的战局 JSON 合并，输出完整 game-config
   *
   * ERA 结构: { hero: { funds, KAZU: {level,mana,maxMana}, RINO: {...} } }
   * funds 单位 = 银弗 (1金弗 = 100银弗)
   * 战局 JSON 中 hero 字段指定本局的 vanguard/rearguard:
   *   { "hero": { "vanguard": "KAZU", "rearguard": "RINO" }, "seats": {...} }
   *   rearguard 可省略（无副手模式）
   *
   * @param {object} eraVars - ERA 变量
   * @param {object} aiBattleData - AI 输出的战局 JSON
   * @returns {object} - 完整 game-config
   */
  function buildCompleteGameConfig(eraVars, aiBattleData) {
    const hero = (eraVars && eraVars.hero) || {};
    const battle = aiBattleData || {};
    const battleHero = battle.hero || {};

    // 从战局数据获取本局的主手/副手名称，回退到 ERA 中第一个角色
    const charNames = _getHeroCharNames(hero);
    const vName = battleHero.vanguard || charNames[0] || 'KAZU';
    const rName = battleHero.rearguard || null; // 副手可选

    const vData = hero[vName] || {};
    const rData = rName ? (hero[rName] || {}) : {};

    const vLv = Math.min(5, Math.max(0, vData.level || 0));
    const rLv = rName ? Math.min(5, Math.max(0, rData.level || 0)) : 0;
    const maxLv = Math.max(vLv, rLv);

    // 属性：优先从 ERA 读取，否则按等级推导
    const eraAttrs = hero.attrs || null;
    const attrs = eraAttrs || HERO_ATTRS_BY_LEVEL[maxLv] || HERO_ATTRS_BY_LEVEL[0];

    // 技能：从属性面板推导（通用系统）
    const mergedSkills = deriveSkillsFromAttrs(attrs);

    // 特质
    const vTrait = VANGUARD_TRAIT_UNLOCK[vLv] || null;
    const rTrait = rName ? (REARGUARD_TRAIT_UNLOCK[rLv] || null) : null;

    // 魔运值：从副手数据读取（副手管理魔运池），无副手则从主手
    const manaSource = rName ? rData : vData;
    const manaLevel = rName ? rLv : vLv;
    const maxMana = (manaSource.maxMana != null) ? manaSource.maxMana : (MANA_BY_LEVEL[manaLevel] || { max: 0 }).max;
    const mana = (manaSource.mana != null) ? manaSource.mana : maxMana;

    // 构建 hero 配置（game-config v4 格式）
    const heroConfig = {
      vanguard: { name: vName, level: vLv },
      attrs: { ...attrs },
      skills: mergedSkills,
      mana: mana,
      maxMana: maxMana
    };
    if (vTrait) heroConfig.vanguard.trait = vTrait;

    // 副手：仅当指定时才写入
    if (rName) {
      heroConfig.rearguard = { name: rName, level: rLv };
      if (rTrait) heroConfig.rearguard.trait = rTrait;
    }

    return {
      blinds: battle.blinds || [10, 20],
      chips: battle.chips || 1000,
      hero: heroConfig,
      seats: battle.seats || {}
    };
  }

  /**
   * 从 hero 对象中提取角色名列表（排除 gold, attrs 等非角色键）
   */
  function _getHeroCharNames(hero) {
    const reserved = new Set(['funds', 'gold', 'attrs', '$meta', '$template']);
    const names = [];
    for (const key in hero) {
      if (hero.hasOwnProperty(key) && !reserved.has(key) && typeof hero[key] === 'object' && hero[key] !== null) {
        names.push(key);
      }
    }
    return names;
  }

  // ==========================================================
  //  A. AI 上下文注入（GENERATION_AFTER_COMMANDS）
  // ==========================================================

  /**
   * 构建注入给 AI 的 hero 状态 XML 摘要
   * 动态列出 hero 下所有角色（不硬编码 vanguard/rearguard）
   */
  function buildHeroSummary(eraVars) {
    if (!eraVars) return null;

    const hero = eraVars.hero || {};
    const funds = hero.funds || 0;
    const charNames = _getHeroCharNames(hero);

    if (charNames.length === 0) return null;

    const charLines = charNames.map(name => {
      const d = hero[name] || {};
      const manaStr = d.mana != null ? ` | 魔运: ${d.mana}/${d.maxMana || '?'}` : '';
      return `  ${name} Lv.${d.level || 0}${manaStr}`;
    }).join('\n');

    return `<ace0_hero_state>
[主角状态]
  资金: ${funds} 银弗
[角色]
${charLines}
</ace0_hero_state>`;
  }

  /**
   * 生成前：读取 ERA → 注入 hero 状态摘要到 AI 上下文
   */
  async function handleGenerationBefore() {
    try {
      try { uninjectPrompts([INJECT_ID]); } catch (_) { /* ignore */ }

      const eraVars = await getEraVars();
      const summary = buildHeroSummary(eraVars);

      if (!summary) {
        console.warn(`${PLUGIN_NAME} ERA 变量为空，跳过注入`);
        return;
      }

      injectPrompts([{
        id: INJECT_ID,
        position: 'in_chat',
        depth: 1,
        role: 'system',
        content: summary,
        should_scan: false
      }]);

      console.log(`${PLUGIN_NAME} hero 状态已注入 AI 上下文`);
    } catch (e) {
      console.error(`${PLUGIN_NAME} 注入失败:`, e);
    }
  }

  // ==========================================================
  //  B. 解析 AI 输出中的 <ACE0_BATTLE> 标签
  // ==========================================================

  /**
   * 从消息文本中提取 <ACE0_BATTLE> JSON
   * @param {string} content - 消息正文
   * @returns {object|null} - 解析后的战局 JSON
   */
  function parseAiBattleOutput(content) {
    const regex = new RegExp(`<${BATTLE_TAG}>([\\s\\S]*?)<\\/${BATTLE_TAG}>`, 'i');
    const match = content.match(regex);
    if (!match) return null;

    let raw = match[1].trim();

    // AI 经常用 markdown 代码块包裹 JSON，需要剥离
    // 处理: ```json ... ``` 或 ``` ... ```
    raw = raw.replace(/^```[\w]*\s*/i, '').replace(/\s*```$/i, '');

    // 剥离散落的反引号
    raw = raw.replace(/^`+|`+$/g, '');

    // 提取第一个 { 到最后一个 } 之间的内容（兜底）
    const braceStart = raw.indexOf('{');
    const braceEnd = raw.lastIndexOf('}');
    if (braceStart >= 0 && braceEnd > braceStart) {
      raw = raw.substring(braceStart, braceEnd + 1);
    }

    try {
      return JSON.parse(raw);
    } catch (e) {
      console.warn(`${PLUGIN_NAME} 解析 ${BATTLE_TAG} JSON 失败:`, e);
      console.warn(`${PLUGIN_NAME} 原始内容:`, raw.substring(0, 200));
      return null;
    }
  }

  // ==========================================================
  //  C. 注入 <ACE0_FRONTEND> 到消息（供 ST 正则替换）
  // ==========================================================

  /**
   * 将完整 game-config 注入到消息尾部
   * @param {number} messageId - 消息 ID
   * @param {object} gameConfig - 完整 game-config
   */
  async function injectGameFrontend(messageId, gameConfig) {
    try {
      const messages = getChatMessages(messageId);
      if (!messages || messages.length === 0) return false;

      const msg = messages[0];
      let content = msg.message;

      const frontendPayload = `<${FRONTEND_TAG}>\n${JSON.stringify(gameConfig)}\n</${FRONTEND_TAG}>`;
      content = content.trim() + '\n\n' + frontendPayload;

      await setChatMessages([{
        message_id: messageId,
        message: content
      }], { refresh: 'affected' });

      console.log(`${PLUGIN_NAME} 游戏前端已注入到消息 #${messageId}`);
      return true;
    } catch (e) {
      console.error(`${PLUGIN_NAME} 注入前端失败:`, e);
      return false;
    }
  }

  // ==========================================================
  //  D. era:writeDone 主处理流程
  // ==========================================================

  /**
   * ERA 写入完成后：
   *   1. 检测消息中是否有 <ACE0_BATTLE>
   *   2. 如果有且尚未处理 → 解析 AI 战局 JSON
   *   3. 读取 ERA hero 数据 → 展开等级 → 合并
   *   4. 注入 <ACE0_FRONTEND> 到消息
   */
  async function handleWriteDone(detail) {
    if (isProcessing) {
      console.log(`${PLUGIN_NAME} 正在处理中，跳过`);
      return;
    }

    const messageId = detail?.message_id ?? getLastMessageId();

    try {
      isProcessing = true;

      // 获取消息内容
      const messages = getChatMessages(messageId);
      if (!messages || messages.length === 0) {
        isProcessing = false;
        return;
      }

      const msg = messages[0];
      const content = msg.message || '';

      // 检查是否包含战局标签
      if (!content.includes(`<${BATTLE_TAG}>`)) {
        isProcessing = false;
        return;
      }

      // 检查是否已经处理过（已有 FRONTEND 标签）
      if (content.includes(`<${FRONTEND_TAG}>`)) {
        console.log(`${PLUGIN_NAME} 已处理过，跳过`);
        isProcessing = false;
        return;
      }

      console.log(`${PLUGIN_NAME} 检测到 ${BATTLE_TAG} 标签，开始处理...`);

      // 解析 AI 输出的战局 JSON
      const rawBattleData = parseAiBattleOutput(content);
      if (!rawBattleData) {
        console.warn(`${PLUGIN_NAME} 无法解析战局数据`);
        isProcessing = false;
        return;
      }

      // NPC 组装流水线：runner/kernel/直写 → 统一 seat config
      const aiBattleData = resolveBattleData(rawBattleData);

      // 读取 ERA 变量
      const eraVars = await getEraVars();

      // 构建完整 game-config（ERA hero 数据 + AI 战局数据）
      const completeConfig = buildCompleteGameConfig(eraVars, aiBattleData);

      // 注入 <ACE0_FRONTEND> 到消息
      await injectGameFrontend(messageId, completeConfig);

      isProcessing = false;
    } catch (e) {
      console.error(`${PLUGIN_NAME} 处理消息失败:`, e);
      isProcessing = false;
    }
  }

  // ==========================================================
  //  事件绑定
  // ==========================================================

  function resetState(reason) {
    console.log(`${PLUGIN_NAME} ${reason} -> 重置状态`);
    lastHandledMk = null;
    isProcessing = false;
  }

  eventOn('CHAT_CHANGED', () => resetState('切换对话'));
  eventOn('tavern_events.MESSAGE_SWIPED', () => resetState('消息重骰'));
  eventOn('tavern_events.MESSAGE_EDITED', () => resetState('消息编辑'));

  // 生成前：注入 hero 状态摘要
  eventOn('GENERATION_AFTER_COMMANDS', async () => {
    await handleGenerationBefore();
  });

  // ERA 写入完成：检测 ACE0_BATTLE → 合并 → 注入 ACE0_FRONTEND
  eventOn('era:writeDone', async (detail) => {
    await handleWriteDone(detail);
  });

  // ==========================================================
  //  全局 API
  // ==========================================================

  window.ACE0Plugin = {
    getEraVars,

    async getGameConfig() {
      const vars = await getEraVars();
      return buildCompleteGameConfig(vars, {});
    },

    // 手动触发战局（支持 runner/kernel/直写三种格式）
    async triggerBattle(rawBattleData) {
      const eraVars = await getEraVars();
      const resolved = resolveBattleData(rawBattleData);
      const completeConfig = buildCompleteGameConfig(eraVars, resolved);

      const frontendPayload = `<${FRONTEND_TAG}>\n${JSON.stringify(completeConfig)}\n</${FRONTEND_TAG}>`;
      await createChatMessages([{
        role: 'assistant',
        message: frontendPayload
      }]);

      return completeConfig;
    },

    // 获取主角角色列表（从 ERA）
    async getHeroCharacters() {
      const vars = await getEraVars();
      if (!vars || !vars.hero) return [];
      return _getHeroCharNames(vars.hero).map(name => ({
        name,
        ...(vars.hero[name] || {})
      }));
    },

    // NPC 组装
    assembleNPC,
    assembleFromRunner,
    resolveBattleData,

    // 四维度配置表
    NPC: {
      AI_KERNELS,
      WEALTH_CLASSES,
      RPG_TEMPLATES,
      MOOD_MODIFIERS,
      RUNNER_PRESETS
    },

    // 原有表
    TABLES: {
      UNIVERSAL_SKILLS,
      VANGUARD_TRAIT: VANGUARD_TRAIT_UNLOCK,
      REARGUARD_TRAIT: REARGUARD_TRAIT_UNLOCK,
      HERO_ATTRS: HERO_ATTRS_BY_LEVEL,
      MANA: MANA_BY_LEVEL
    },

    deriveSkillsFromAttrs,

    version: '0.5.0'
  };

  // ==========================================================
  //  初始化完成
  // ==========================================================

  console.log(`${PLUGIN_NAME} 插件加载完成 (v0.5.0)`);
  console.log(`${PLUGIN_NAME} NPC 组装: kernel=${Object.keys(AI_KERNELS).join('/')} | wealth=${Object.keys(WEALTH_CLASSES).join('/')} | archetype=${Object.keys(RPG_TEMPLATES).join('/')} | mood=${Object.keys(MOOD_MODIFIERS).join('/')}`);
  console.log(`${PLUGIN_NAME} 跑龙套: ${Object.keys(RUNNER_PRESETS).join(', ')}`);
  console.log(`${PLUGIN_NAME} 流程: AI 输出 <${BATTLE_TAG}> → NPC组装 → 合并 ERA hero → 注入 <${FRONTEND_TAG}> → ST 正则 → STver.html`);

})();
