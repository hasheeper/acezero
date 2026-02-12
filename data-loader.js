/**
 * ===========================================
 * DATA-LOADER.JS - 外部数据加载系统
 * ===========================================
 * 
 * 职责:
 * - 接收酒馆插件(acezero-tavern-plugin.js)通过 postMessage 注入的 game-config
 * - 解析并应用游戏配置（hero、seats、blinds 等）
 * - 提供默认配置（当没有外部注入时）
 * - 主动向父窗口请求数据
 * 
 * JSON 格式 (game-config v4):
 * {
 *   "blinds": [10, 20],
 *   "chips": 1000,
 *   "hero": {
 *     "vanguard": { "name": "KAZU", "level": 3, "trait": "blank_body" },
 *     "rearguard": { "name": "RINO", "level": 5, "trait": "fate_weaver" },
 *     "attrs": { ... },
 *     "skills": { ... }
 *   },
 *   "seats": { "BTN": { ... }, "SB": { ... }, ... }
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
    // 已有配置 → 忽略重复投递
    if (_injectedConfig) {
      console.log('[DATA-LOADER] 配置已加载，忽略重复投递');
      return;
    }

    _injectedConfig = data;
    const heroName = (data.hero && data.hero.vanguard && data.hero.vanguard.name) || '(none)';
    console.log('[DATA-LOADER] 外部配置已加载, hero:', heroName);

    // 如果 texas-holdem.js 已加载，直接应用配置
    if (typeof window.applyExternalConfig === 'function') {
      try {
        window.applyExternalConfig(data);
        console.log('[DATA-LOADER] ✓ 已调用 applyExternalConfig');
      } catch (e) {
        console.error('[DATA-LOADER] applyExternalConfig 失败:', e);
      }
    }

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

    // 新格式验证：hero + seats
    if (json.hero) {
      if (!json.hero.vanguard || !json.hero.vanguard.name) {
        errors.push('hero.vanguard.name is required');
      }
    }

    if (json.seats && typeof json.seats === 'object') {
      for (const [seat, cfg] of Object.entries(json.seats)) {
        if (!cfg.vanguard || !cfg.vanguard.name) {
          errors.push(`seats.${seat}: vanguard.name is required`);
        }
      }
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
