/**
 * ===========================================
 * DATA-LOADER.JS - 外部数据加载系统
 * ===========================================
 * 
 * 职责:
 * - 接收 STver.html 通过 postMessage 注入的 JSON 数据
 * - 解析并应用游戏配置（玩家、设置等）
 * - 提供默认配置（当没有外部注入时）
 * - 主动向父窗口请求数据
 * 
 * JSON 格式:
 * {
 *   "gameId": "texas-holdem",
 *   "gameSettings": {
 *     "initialChips": 1000,
 *     "smallBlind": 10,
 *     "bigBlind": 20
 *   },
 *   "players": [
 *     { "id": 0, "name": "...", "type": "human", "chips": 1000 },
 *     { "id": 1, "name": "...", "type": "ai", "chips": 1000, "personality": {...} }
 *   ]
 * }
 */

(function () {
  'use strict';

  // ============================================
  // 外部注入数据存储
  // ============================================
  let _injectedConfig = null;
  let _configCallbacks = [];

  /**
   * 获取已注入的外部配置
   * @returns {Object|null}
   */
  function getInjectedConfig() {
    return _injectedConfig;
  }

  /**
   * 注册配置加载回调
   * 如果配置已加载，立即执行；否则等待注入
   * @param {Function} callback - 回调函数，参数为配置对象
   */
  function onConfigLoaded(callback) {
    if (_injectedConfig) {
      callback(_injectedConfig);
    } else {
      _configCallbacks.push(callback);
    }
  }

  /**
   * 应用注入的配置数据
   * @param {Object} data - 注入的 JSON 数据
   */
  function applyInjectedConfig(data) {
    if (!data) return;

    // 验证 gameId
    if (data.gameId && data.gameId !== 'texas-holdem') {
      console.warn('[DATA-LOADER] gameId 不匹配，期望 texas-holdem，收到:', data.gameId);
      return;
    }

    _injectedConfig = data;
    console.log('[DATA-LOADER] 外部配置已加载:', data);

    // 触发所有等待中的回调
    _configCallbacks.forEach(cb => {
      try { cb(data); } catch (e) {
        console.error('[DATA-LOADER] 回调执行失败:', e);
      }
    });
    _configCallbacks = [];
  }

  // ============================================
  // postMessage 监听 - 接收 STver.html 的数据
  // ============================================
  window.addEventListener('message', function (event) {
    const msg = event?.data;
    if (!msg || msg.type !== 'acezero-game-data') return;

    console.log('[DATA-LOADER] 收到 postMessage 数据:', msg.payload);
    applyInjectedConfig(msg.payload);
  });

  // ============================================
  // 主动请求数据（如果在 iframe 中）
  // ============================================
  function requestDataFromParent() {
    if (window.parent && window.parent !== window) {
      console.log('[DATA-LOADER] 向父窗口请求数据...');
      window.parent.postMessage({ type: 'acezero-data-request' }, '*');
    }
  }

  // 页面加载后主动请求一次
  if (document.readyState === 'complete') {
    requestDataFromParent();
  } else {
    window.addEventListener('load', requestDataFromParent);
  }

  // ============================================
  // 验证配置 JSON 格式
  // ============================================
  /**
   * 验证游戏配置 JSON 格式
   * @param {Object} json - 配置数据
   * @returns {Object} { valid: boolean, errors: string[] }
   */
  function validateGameConfig(json) {
    const errors = [];

    if (!json) {
      errors.push('JSON data is null or undefined');
      return { valid: false, errors };
    }

    if (!json.gameId) {
      errors.push('Missing gameId field');
    }

    if (json.players && Array.isArray(json.players)) {
      json.players.forEach((p, i) => {
        if (!p.name) errors.push(`Player #${i}: missing name`);
        if (!p.type) errors.push(`Player #${i}: missing type (human/ai)`);
      });
    }

    return { valid: errors.length === 0, errors };
  }

  // ============================================
  // 导出到全局
  // ============================================
  window.AceZeroDataLoader = {
    getInjectedConfig: getInjectedConfig,
    onConfigLoaded: onConfigLoaded,
    validateGameConfig: validateGameConfig,
    requestDataFromParent: requestDataFromParent
  };

})();
