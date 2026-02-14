/**
 * RPG Init — ES Module 入口
 * 将 RPG 系统层的 ES Module 类桥接到全局 window 对象，
 * 供现有 IIFE 模块（monte-of-zero.js, skill-ui.js, texas-holdem.js）使用。
 *
 * 加载顺序：
 *   1. 旧 IIFE 脚本先加载（skill-system, monte-of-zero 等）
 *   2. 本文件作为 <script type="module"> 加载
 *   3. 本文件 import ES Module → 实例化 → 挂载到 window
 *   4. texas-holdem.js 最后加载，可以访问 window.rpg.*
 *
 * 注意：<script type="module"> 天然 defer，会在所有普通 script 之后执行。
 * 但 texas-holdem.js 也是普通 script，所以它会在本模块之前执行。
 * 解决方案：texas-holdem.js 的初始化在 DOMContentLoaded 或 fetch config 之后，
 * 届时本模块已经执行完毕。
 */

import { AttributeSystem, ATTR, COUNTER_MAP, EFFECT_TO_ATTR, ADVANTAGE_MULT, DISADVANTAGE_MULT } from './attribute-system.js';
import { SwitchSystem, POSITION, MODE, SWITCH_COOLDOWN, SWITCH_SANITY_COST } from './switch-system.js';
import { CombatFormula } from './combat-formula.js';
import { SurvivalEconomy, SIPHON_BASE, EPIC_WIN_REWARDS, TRICKLE_AMOUNT, BACKLASH_POWER, BACKLASH_DURATION } from './survival-economy.js';
import { TraitSystem, TRAIT_CATALOG, TRAIT_SLOT } from './trait-system.js';

// ========== 桥接到全局 ==========

window.AttributeSystem = AttributeSystem;
window.SwitchSystem = SwitchSystem;
window.CombatFormula = CombatFormula;
window.SurvivalEconomy = SurvivalEconomy;
window.TraitSystem = TraitSystem;

// 常量也挂到类上，保持向后兼容
AttributeSystem.ATTR = ATTR;
AttributeSystem.COUNTER_MAP = COUNTER_MAP;
AttributeSystem.EFFECT_TO_ATTR = EFFECT_TO_ATTR;
AttributeSystem.ADVANTAGE_MULT = ADVANTAGE_MULT;
AttributeSystem.DISADVANTAGE_MULT = DISADVANTAGE_MULT;

SwitchSystem.POSITION = POSITION;
SwitchSystem.MODE = MODE;
SwitchSystem.SWITCH_COOLDOWN = SWITCH_COOLDOWN;
SwitchSystem.SWITCH_SANITY_COST = SWITCH_SANITY_COST;

SurvivalEconomy.SIPHON_BASE = SIPHON_BASE;
SurvivalEconomy.EPIC_WIN_REWARDS = EPIC_WIN_REWARDS;
SurvivalEconomy.TRICKLE_AMOUNT = TRICKLE_AMOUNT;
SurvivalEconomy.BACKLASH_POWER = BACKLASH_POWER;
SurvivalEconomy.BACKLASH_DURATION = BACKLASH_DURATION;

TraitSystem.TRAIT_CATALOG = TRAIT_CATALOG;
TraitSystem.TRAIT_SLOT = TRAIT_SLOT;

// ========== 属性面板自动构建 ==========
// 统一接口：所有角色的 attrs 都从 JSON config 读取

window.__rpgBuildAttrPlayers = function (config, playerIdMap) {
  if (!config) return [];

  const players = [];
  const ZERO = { moirai: 0, chaos: 0, psyche: 0, void: 0 };

  if (playerIdMap && playerIdMap.heroId != null) {
    // 使用真实游戏 ID
    if (config.hero) {
      players.push({ id: playerIdMap.heroId, attributes: { ...ZERO, ...(config.hero.attrs || {}) } });
    }
    if (config.seats && playerIdMap.seats) {
      for (const seat in playerIdMap.seats) {
        const s = config.seats[seat];
        if (!s) continue;
        players.push({ id: playerIdMap.seats[seat], attributes: { ...ZERO, ...(s.attrs || {}) } });
      }
    }
  } else {
    // 回退：顺序分配
    if (config.hero) {
      players.push({ id: 0, attributes: { ...ZERO, ...(config.hero.attrs || {}) } });
    }
    if (config.seats) {
      const order = ['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB'];
      let idx = 1;
      for (const seat of order) {
        const s = config.seats[seat];
        if (!s) continue;
        players.push({ id: idx, attributes: { ...ZERO, ...(s.attrs || {}) } });
        idx++;
      }
    }
  }

  return players;
};

// 标记 RPG 系统就绪
window.__rpgReady = true;
window.dispatchEvent(new CustomEvent('rpg:ready'));
console.log('[RPG] ES Module 系统已加载 — AttributeSystem, SwitchSystem, CombatFormula, SurvivalEconomy, TraitSystem');
