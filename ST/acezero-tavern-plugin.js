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
 *   "hero": { "gold": 500, "vanguard": "KAZU", "rearguard": "RINO" },
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
  //  等级解锁表（固定规则，对 AI 隐藏）
  // ==========================================================

  const REARGUARD_SKILL_UNLOCK = {
    1: { fortune: 1, sense: 1 },
    2: { fortune: 2, sense: 2, peek: 1 },
    3: { fortune: 3, foresight: 2, sense: 3, peek: 2, fortune_anchor: 1 },
    4: { fortune: 4, foresight: 3, sense: 3, peek: 3, reversal: 2, fortune_anchor: 2 },
    5: { fortune: 5, foresight: 3, sense: 3, peek: 3, reversal: 3, fortune_anchor: 3 }
  };

  const VANGUARD_SKILL_UNLOCK = {
    1: {},
    2: { null_field: 1 },
    3: { blank_factor: 1, null_field: 2 },
    4: { blank_factor: 2, null_field: 2 },
    5: { blank_factor: 3, null_field: 3 }
  };

  const VANGUARD_TRAIT_UNLOCK = {
    0: null, 1: null, 2: 'blank_body', 3: 'blank_body', 4: 'blank_body', 5: 'blank_body'
  };

  const REARGUARD_TRAIT_UNLOCK = {
    0: null, 1: null, 2: null, 3: 'fate_weaver', 4: 'fate_weaver', 5: 'fate_weaver'
  };

  const HERO_ATTRS_BY_LEVEL = {
    0: { moirai: 10, chaos: 10, psyche: 10, void: 10 },
    1: { moirai: 20, chaos: 15, psyche: 20, void: 20 },
    2: { moirai: 40, chaos: 15, psyche: 30, void: 40 },
    3: { moirai: 60, chaos: 20, psyche: 40, void: 60 },
    4: { moirai: 70, chaos: 20, psyche: 45, void: 80 },
    5: { moirai: 80, chaos: 20, psyche: 50, void: 100 }
  };

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
   * @param {object} eraVars - ERA 变量
   * @param {object} aiBattleData - AI 输出的战局 JSON（seats, blinds 等）
   * @returns {object} - 完整 game-config
   */
  function buildCompleteGameConfig(eraVars, aiBattleData) {
    const hero = (eraVars && eraVars.hero) || {};
    const vName = hero.vanguard || 'KAZU';
    const rName = hero.rearguard || 'RINO';
    const vData = (eraVars && eraVars[vName]) || {};
    const rData = (eraVars && eraVars[rName]) || {};

    const vLv = Math.min(5, Math.max(0, vData.level || 0));
    const rLv = Math.min(5, Math.max(0, rData.level || 0));
    const maxLv = Math.max(vLv, rLv);

    // 合并主手+副手技能
    const vSkills = VANGUARD_SKILL_UNLOCK[vLv] || {};
    const rSkills = REARGUARD_SKILL_UNLOCK[rLv] || {};
    const mergedSkills = { ...rSkills, ...vSkills };

    // 特质
    const vTrait = VANGUARD_TRAIT_UNLOCK[vLv] || null;
    const rTrait = REARGUARD_TRAIT_UNLOCK[rLv] || null;

    // 属性
    const attrs = HERO_ATTRS_BY_LEVEL[maxLv] || HERO_ATTRS_BY_LEVEL[0];

    // 构建 hero 配置（game-config v4 格式）
    const heroConfig = {
      vanguard: { name: vName, level: vLv },
      rearguard: { name: rName, level: rLv },
      attrs: { ...attrs },
      skills: mergedSkills
    };
    if (vTrait) heroConfig.vanguard.trait = vTrait;
    if (rTrait) heroConfig.rearguard.trait = rTrait;

    // 合并 AI 提供的战局数据
    const battle = aiBattleData || {};

    return {
      blinds: battle.blinds || [10, 20],
      chips: battle.chips || 1000,
      hero: heroConfig,
      seats: battle.seats || {}
    };
  }

  // ==========================================================
  //  A. AI 上下文注入（GENERATION_AFTER_COMMANDS）
  // ==========================================================

  /**
   * 构建注入给 AI 的 hero 状态 XML 摘要
   */
  function buildHeroSummary(eraVars) {
    if (!eraVars) return null;

    const hero = eraVars.hero || {};
    const vName = hero.vanguard || 'KAZU';
    const rName = hero.rearguard || 'RINO';
    const vData = eraVars[vName] || {};
    const rData = eraVars[rName] || {};
    const gold = hero.gold || 0;

    return `<ace0_hero_state>
[主角状态]
  金钱: ${gold}
  主手(前台): ${vName} Lv.${vData.level || 0}
  副手(后台): ${rName} Lv.${rData.level || 0}
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

    try {
      return JSON.parse(match[1].trim());
    } catch (e) {
      console.warn(`${PLUGIN_NAME} 解析 ${BATTLE_TAG} JSON 失败:`, e);
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
      const aiBattleData = parseAiBattleOutput(content);
      if (!aiBattleData) {
        console.warn(`${PLUGIN_NAME} 无法解析战局数据`);
        isProcessing = false;
        return;
      }

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

    // 手动触发战局（用于测试）
    async triggerBattle(aiBattleData) {
      const eraVars = await getEraVars();
      const completeConfig = buildCompleteGameConfig(eraVars, aiBattleData);

      const frontendPayload = `<${FRONTEND_TAG}>\n${JSON.stringify(completeConfig)}\n</${FRONTEND_TAG}>`;
      await createChatMessages([{
        role: 'assistant',
        message: frontendPayload
      }]);

      return completeConfig;
    },

    // 切换主手/副手
    async switchHands() {
      const vars = await getEraVars();
      if (!vars || !vars.hero) return;
      const oldV = vars.hero.vanguard;
      const oldR = vars.hero.rearguard;
      if (!oldV || !oldR) return;

      updateEraVars({ hero: { vanguard: oldR, rearguard: oldV } });
      if (vars[oldV]) updateEraVars({ [oldV]: { role: 'rearguard' } });
      if (vars[oldR]) updateEraVars({ [oldR]: { role: 'vanguard' } });

      console.log(`${PLUGIN_NAME} 主手/副手已切换: ${oldR}(前台) ↔ ${oldV}(后台)`);
    },

    UNLOCK_TABLES: {
      VANGUARD_SKILL: VANGUARD_SKILL_UNLOCK,
      REARGUARD_SKILL: REARGUARD_SKILL_UNLOCK,
      VANGUARD_TRAIT: VANGUARD_TRAIT_UNLOCK,
      REARGUARD_TRAIT: REARGUARD_TRAIT_UNLOCK,
      HERO_ATTRS: HERO_ATTRS_BY_LEVEL
    },

    version: '0.3.0'
  };

  // ==========================================================
  //  初始化完成
  // ==========================================================

  console.log(`${PLUGIN_NAME} 插件加载完成 (v0.3.0)`);
  console.log(`${PLUGIN_NAME} 接口: window.ACE0Plugin`);
  console.log(`${PLUGIN_NAME} 流程: AI 输出 <${BATTLE_TAG}> → 插件合并 ERA hero → 注入 <${FRONTEND_TAG}> → ST 正则 → STver.html`);

})();
