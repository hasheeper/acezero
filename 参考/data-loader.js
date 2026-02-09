/**
 * ===========================================
 * DATA-LOADER.JS - 数据加载系统
 * ===========================================
 * 
 * 职责:
 * - 默认战斗数据
 * - JSON 数据解析与加载
 * - 战斗初始化数据处理
 */

// ============================================
// 默认战斗数据
// ============================================

/**
 * 获取默认战斗数据 (当没有外部JSON注入时使用)
 * 
 * 新版格式支持：
 * - stats_meta: { ivs: {...}, ev_level: 0~252 }
 * - nature: 性格名称
 * - ability: 特性名称
 * - gender: 'M' | 'F' | null
 * - shiny: boolean
 * - mechanic: 'mega' | 'dynamax' | 'zmove' | 'tera' (互斥机制锁)
 * - dynamax_moves: string[] (极巨化时的招式列表)
 * - z_move_config: { base_move, target_move, is_unique }
 */
function getDefaultBattleData() {
    return {
  "difficulty": "expert", 
  "settings": {
    "enableAVS": true,
    "enableCommander": true,
    "enableEVO": true,
    "enableBGM": true,
    "enableSFX": true,
    "enableClash": true
  },
  "player": {
    "name": "Champion",
    "trainerProficiency": 255,
    "unlocks": {
      "enable_mega": true,
      "enable_z_move": true,
      "enable_styles": true,
      "enable_bond": true,
      "enable_tera": true,
      "enable_dynamax": true
    },
    "party": [
      {
        "slot": 1,
        "name": "Dragapult",
        "nickname": "幽影",
        "lv": 88,
        "isLead": true,
        "ability": "Infiltrator",
        "nature": "Timid",
        "item": "Choice Specs",
        "isAce": true,
        "moves": ["Shadow Ball", "Draco Meteor", "U-turn", "Flamethrower"],
        "stats_meta": { "ev_level": 252 },
        "friendship": { "avs": { "passion": 200, "insight": 220 } }
      },
      {
        "slot": 2,
        "name": "Beedrill",
        "nickname": "蜂皇",
        "lv": 88,
        "item": "Beedrillite",
        "mechanic": "mega",
        "mega_target": "beedrillmega",
        "nature": "Jolly",
        "isAce": true,
        "moves": ["Poison Jab", "U-turn", "Drill Run", "Fell Stinger"],
        "stats_meta": { "ev_level": 252 },
        "friendship": { "avs": { "passion": 255 } }
      },
      {
        "slot": 3,
        "name": "Coalossal",
        "nickname": "熔炉",
        "lv": 88,
        "mechanic": "dynamax",
        "ability": "Steam Engine",
        "nature": "Relaxed",
        "item": "Weakness Policy",
        "isAce": true,
        "moves": ["Heat Crash", "Stone Edge", "Scald", "Rapid Spin"],
        "stats_meta": { "ev_level": 252 },
        "friendship": { "avs": { "trust": 255, "insight": 180 } }
      },
      {
        "slot": 4,
        "name": "Kommo-o",
        "nickname": "战龙",
        "lv": 88,
        "mechanic": "zmove",
        "ability": "Bulletproof",
        "item": "Kommonium Z",
        "nature": "Naive",
        "isAce": true,
        "moves": ["Clanging Scales", "Close Combat", "Poison Jab", "Clangorous Soul"],
        "stats_meta": { "ev_level": 252 },
        "friendship": { "avs": { "devotion": 200 } }
      },
      {
        "slot": 5,
        "name": "Mimikyu",
        "nickname": "谜拟Q",
        "lv": 88,
        "isAce": true,
        "ability": "Disguise",
        "item": "Life Orb",
        "isAce": true,
        "moves": ["Play Rough", "Shadow Claw", "Shadow Sneak", "Swords Dance"],
        "stats_meta": { "ev_level": 252 },
        "friendship": { "avs": { "trust": 240, "passion": 240, "insight": 255 } }
      },
      {
        "slot": 6,
        "name": "Dragonite",
        "nickname": "快龙",
        "lv": 88,
        "ability": "Multiscale",
        "mechanic": "tera",
        "teraType": "Normal",
        "item": "Heavy-Duty Boots",
        "isAce": true,
        "moves": ["Extreme Speed", "Earthquake", "Dragon Claw", "Roost"],
        "stats_meta": { "ev_level": 252 },
        "friendship": { "avs": { "trust": 200 } }
      }
    ]
  },
  "enemy": {
    "name": "Leon (Ultimate)",
    "type": "CHAMPION",
    "trainerProficiency": 255,
    "unlocks": {
      "enable_mega": true,
      "enable_z_move": true,
      "enable_bond": true,
      "enable_styles": true,
      "enable_tera": true,
      "enable_dynamax": true
    },
    "party": [
      {
        "name": "Meowscarada",
        "lv": 88,
        "isLead": true,
        "gender": "F",
        "ability": "Protean",
        "nature": "Jolly",
        "item": "Focus Sash",
        "mechanic": "tera",
        "teraType": "Grass",
        "moves": ["Flower Trick", "Knock Off", "U-turn", "Play Rough"],
        "stats_meta": { "ev_level": 252 },
        "friendship": { "avs": { "insight": 200 } }
      },
      {
        "name": "Garganacl",
        "lv": 88,
        "ability": "Purifying Salt",
        "item": "Leftovers",
        "nature": "Careful",
        "moves": ["Salt Cure", "Recover", "Earthquake", "Body Press"],
        "stats_meta": { "ev_level": 252 },
        "friendship": { "avs": { "trust": 150, "devotion": 150 } }
      },
      {
        "name": "Lucario",
        "lv": 88,
        "gender": "M",
        "ability": "Justified",
        "nature": "Jolly",
        "mechanic": "mega",
        "mega_target": "lucariomega",
        "item": "Lucarionite",
        "moves": ["Close Combat", "Bullet Punch", "Meteor Mash", "Swords Dance"],
        "stats_meta": { "ev_level": 252 },
        "friendship": { "avs": { "passion": 220, "insight": 180 } }
      },
      {
        "name": "Charizard",
        "lv": 89,
        "mechanic": "dynamax",
        "mega_target": "charizardgmax",
        "ability": "Solar Power",
        "nature": "Timid",
        "item": "Heavy-Duty Boots",
        "moves": ["Heat Wave", "Air Slash", "Solar Beam", "Ancient Power"],
        "stats_meta": { "ev_level": 252 },
        "friendship": { "avs": { "passion": 180, "trust": 100 } }
      },
      {
        "name": "Necrozma",
        "lv": 90,
        "isAce": true,
        "ability": "Prism Armor",
        "nature": "Adamant",
        "mechanic": "zmove",
        "item": "Ultranecrozium Z",
        "moves": ["Photon Geyser", "Poltergeist", "Earthquake", "Swords Dance"],
        "stats_meta": { "ev_level": 252 },
        "friendship": { 
            "avs": { "trust": 255, "passion": 255, "insight": 255, "devotion": 255 } 
        }
      },
      {
        "name": "Solgaleo",
        "lv": 89,
        "ability": "Full Metal Body",
        "nature": "Adamant",
        "item": "Leftovers",
        "moves": ["Sunsteel Strike", "Psychic Fangs", "Earthquake", "Flare Blitz"],
        "stats_meta": { "ev_level": 252 },
        "friendship": { "avs": { "trust": 220, "devotion": 220 } }
      }
    ],
    "lines": {
      "start": "从伽勒尔到阿罗拉，我和我的队伍已经掌握了所有的可能性。现在让你见识一下……真正的最强！",
      "lose": "这就是……传说中的英雄吗……精彩绝伦！",
      "win": "看来你的冠军时刻还没有到来啊！"
    }
  }
}


}

// ============================================
// JSON 数据加载
// ============================================

/**
 * 从外部 JSON 字符串加载对战 (供 AI RP 调用)
 * JSON 格式:
 * {
 *   "player": { "name": "主角名", "party": [...] },  // 可选
 *   "trainer": { "name": "训练家", "id": "xxx", "line": "台词" },
 *   "party": [...],  // 敌方队伍
 *   "script": "loss" | "win" | null
 * }
 */
function loadBattleFromJSON(jsonString) {
    const battle = typeof window !== 'undefined' ? window.battle : null;
    if (!battle) {
        console.error('[DATA-LOADER] battle object not found');
        return false;
    }
    
    try {
        const json = typeof jsonString === 'string' ? JSON.parse(jsonString) : jsonString;
        
        // 加载玩家队伍 (如果有)
        if (json.player && json.player.party) {
            const unlocks = json.player.unlocks || {};
            battle.playerUnlocks = {
                enable_bond: unlocks.enable_bond !== false,
                enable_styles: unlocks.enable_styles !== false,
                enable_insight: unlocks.enable_insight !== false,
                enable_mega: unlocks.enable_mega !== false,
                enable_z_move: unlocks.enable_z_move !== false,
                enable_dynamax: unlocks.enable_dynamax !== false,
                enable_tera: unlocks.enable_tera !== false
            };
            const playerCanMega = battle.playerUnlocks.enable_mega;
            battle.setPlayerParty(json.player.party, playerCanMega);
            battle.playerName = json.player.name || '主角';
        }
        
        // 加载敌方数据
        battle.loadFromJSON(json);
        
        // 更新视觉
        if (typeof updateAllVisuals === 'function') {
            updateAllVisuals();
        }
        
        return true;
    } catch (e) {
        console.error('Invalid battle JSON:', e);
        return false;
    }
}

/**
 * 解析玩家解锁配置
 * @param {Object} unlocks 解锁配置对象
 * @returns {Object} 标准化的解锁配置
 */
function parseUnlocks(unlocks = {}) {
    return {
        enable_bond: unlocks.enable_bond !== false,
        enable_styles: unlocks.enable_styles !== false,
        enable_insight: unlocks.enable_insight !== false,
        enable_mega: unlocks.enable_mega !== false,
        enable_z_move: unlocks.enable_z_move !== false,
        enable_dynamax: unlocks.enable_dynamax !== false,
        enable_tera: unlocks.enable_tera !== false
    };
}

/**
 * 解析环境天气配置
 * 
 * 新版 JSON 格式:
 * {
 *   "environment": {
 *     "weather": "chronalrift",      // 环境天气 ID
 *     "weatherTurns": 0,             // 持续回合 (0 = 无限)
 *     "revertMessage": "...",        // 天气回归时的消息
 *     "suppression": {
 *       // 方式一: 全局设置
 *       "all": "blocked" | "suppressed" | "normal",
 *       // 方式二: 按天气设置 (优先级高于 all)
 *       "blocked": ["rain", "sun"],      // 完全阻止的天气
 *       "suppressed": ["sandstorm"]      // 回合减半的天气
 *     },
 *     "effects": { ... }             // 环境特效开关
 *   }
 * }
 * 
 * 旧版兼容:
 * {
 *   "environment": {
 *     "suppressionTier": 3           // 1=normal, 2=suppressed, 3=blocked
 *   }
 * }
 * 
 * @param {Object} envConfig 环境配置对象
 * @returns {Object} 标准化的环境配置
 */
function parseEnvironmentConfig(envConfig = {}) {
    const result = {
        weather: envConfig.weather || null,
        weatherTurns: envConfig.weatherTurns ?? 0,
        revertMessage: envConfig.revertMessage || null,
        suppression: {},
        effects: envConfig.effects || {}
    };
    
    // 解析 suppression 配置
    if (envConfig.suppression) {
        const supp = envConfig.suppression;
        
        // all 字段: 全局设置
        if (supp.all) {
            result.suppression.all = supp.all;
        }
        
        // blocked 数组: 完全阻止的天气
        if (Array.isArray(supp.blocked)) {
            result.suppression.blocked = supp.blocked.map(w => w.toLowerCase());
        }
        
        // suppressed 数组: 回合减半的天气
        if (Array.isArray(supp.suppressed)) {
            result.suppression.suppressed = supp.suppressed.map(w => w.toLowerCase());
        }
    }
    // 旧版兼容: suppressionTier
    else if (envConfig.suppressionTier !== undefined) {
        const tier = envConfig.suppressionTier;
        if (tier === 3) {
            result.suppression.all = 'blocked';
        } else if (tier === 2) {
            result.suppression.all = 'suppressed';
        }
        // tier 1 = normal, 不需要设置
    }
    
    console.log('[DATA-LOADER] 环境配置解析:', result);
    return result;
}

/**
 * 应用环境配置到战斗实例
 * @param {Object} battle 战斗实例
 * @param {Object} envConfig 环境配置 (已解析)
 */
function applyEnvironmentConfig(battle, envConfig) {
    if (!battle || !envConfig) return;
    
    // 设置环境天气
    if (envConfig.weather) {
        battle.environmentWeather = envConfig.weather;
        battle.environmentConfig = envConfig;
        
        // 如果没有普通天气，环境天气也作为当前天气
        if (!battle.weather) {
            battle.weather = envConfig.weather;
            battle.weatherTurns = envConfig.weatherTurns;
        }
        
        // 更新视觉效果
        if (typeof window !== 'undefined' && window.setWeatherVisuals) {
            window.setWeatherVisuals(envConfig.weather);
        }
        
        console.log(`[DATA-LOADER] 环境天气已设置: ${envConfig.weather}`);
    }
}

// ============================================
// 环境图层 API
// ============================================

/**
 * 注入环境图层效果
 * @param {Object|string} envJSON - 环境 JSON 对象或字符串
 * @returns {Object|null} 解析后的环境对象
 */
function injectEnvironmentOverlay(envJSON) {
    if (typeof window === 'undefined' || !window.envOverlay) {
        console.error('[ENV OVERLAY] envOverlay 未初始化');
        return null;
    }
    
    const env = window.envOverlay.inject(envJSON);
    if (env) {
        console.log(`[ENV OVERLAY] 注入环境: ${env.env_name}`);
    }
    return env;
}

/**
 * 清除所有环境图层
 */
function clearEnvironmentOverlay() {
    if (typeof window !== 'undefined' && window.envOverlay) {
        window.envOverlay.clear();
        console.log('[ENV OVERLAY] 已清除所有环境');
    }
}

/**
 * 验证战斗 JSON 格式
 * @param {Object} json 战斗数据
 * @returns {Object} { valid: boolean, errors: string[] }
 */
function validateBattleJSON(json) {
    const errors = [];
    
    if (!json) {
        errors.push('JSON data is null or undefined');
        return { valid: false, errors };
    }
    
    // 检查敌方队伍
    if (!json.party || !Array.isArray(json.party) || json.party.length === 0) {
        errors.push('Missing or empty enemy party');
    }
    
    // 检查每个宝可梦的必要字段
    const checkPokemon = (pokemon, index, side) => {
        if (!pokemon.name) {
            errors.push(`${side} Pokemon #${index + 1}: missing name`);
        }
        if (typeof pokemon.lv !== 'number' || pokemon.lv < 1 || pokemon.lv > 100) {
            errors.push(`${side} Pokemon #${index + 1}: invalid level`);
        }
        if (!pokemon.moves || !Array.isArray(pokemon.moves) || pokemon.moves.length === 0) {
            errors.push(`${side} Pokemon #${index + 1}: missing moves`);
        }
    };
    
    if (json.party) {
        json.party.forEach((p, i) => checkPokemon(p, i, 'Enemy'));
    }
    
    if (json.player && json.player.party) {
        json.player.party.forEach((p, i) => checkPokemon(p, i, 'Player'));
    }
    
    return { valid: errors.length === 0, errors };
}

// ============================================
// 导出
// ============================================

// 浏览器环境
if (typeof window !== 'undefined') {
    window.getDefaultBattleData = getDefaultBattleData;
    window.loadBattleFromJSON = loadBattleFromJSON;
    window.parseUnlocks = parseUnlocks;
    window.parseEnvironmentConfig = parseEnvironmentConfig;
    window.applyEnvironmentConfig = applyEnvironmentConfig;
    window.validateBattleJSON = validateBattleJSON;
    // 环境图层 API
    window.injectEnvironmentOverlay = injectEnvironmentOverlay;
    window.clearEnvironmentOverlay = clearEnvironmentOverlay;
}

// Node.js 环境
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        getDefaultBattleData,
        loadBattleFromJSON,
        parseUnlocks,
        parseEnvironmentConfig,
        applyEnvironmentConfig,
        validateBattleJSON,
        injectEnvironmentOverlay,
        clearEnvironmentOverlay
    };
}
