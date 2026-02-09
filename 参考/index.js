/**
 * ===========================================
 * INDEX.JS - UI 控制器 & 入口
 * ===========================================
 * 
 * 依赖: pokedex-data.js, moves-data.js, battle-engine.js
 * 
 * 职责:
 * - UI 渲染 (血条、精灵图、按钮)
 * - 用户交互处理
 * - 战斗流程控制
 * - JSON 加载入口
 */

// 全局战斗状态
let battle = new BattleState();
window.battle = battle;  // 导出到全局，供模块访问

// ============================================
// 【古武系统 v3】动态冷却计算
// 基于训练家熟练度决定休憩回合数
// ============================================
/**
 * 根据熟练度计算古武风格冷却回合数
 * @param {number} proficiency - 训练家熟练度 (0-255)
 * @returns {number} 冷却回合数 (0-4)
 */
function getStyleCooldown(proficiency) {
    if (proficiency > 200) return 0;  // 宗师：气脉贯通，无冷却
    if (proficiency > 150) return 1;  // 精通：标准节奏
    if (proficiency > 100) return 2;  // 熟手：稍有流畅
    if (proficiency > 50)  return 3;  // 入门：节奏较慢
    return 4;                          // 初学者：只能作为绝杀
}
window.getStyleCooldown = getStyleCooldown;

// ============================================
// 【指挥官系统 v2】同步率计算与动态冷却
// 同步率 = (训练家熟练度 + AVS四维平均) / 2
// ============================================
/**
 * 计算训练家与宝可梦的同步率
 * @param {number} proficiency - 训练家熟练度 (0-255)
 * @param {Pokemon} pokemon - 当前宝可梦
 * @returns {number} 同步率 (0-255)
 */
function getCommanderSyncScore(proficiency, pokemon) {
    if (!pokemon || !pokemon.isAce) return 0;
    
    // 获取 AVS 四维平均值
    let avsAverage = 0;
    if (pokemon.avs) {
        const trust = pokemon.getEffectiveAVs?.('trust') || pokemon.avs.trust || 0;
        const passion = pokemon.getEffectiveAVs?.('passion') || pokemon.avs.passion || 0;
        const insight = pokemon.getEffectiveAVs?.('insight') || pokemon.avs.insight || 0;
        const devotion = pokemon.getEffectiveAVs?.('devotion') || pokemon.avs.devotion || 0;
        avsAverage = (trust + passion + insight + devotion) / 4;
    }
    
    // 同步率 = (熟练度 + AVS平均) / 2
    const syncScore = Math.floor((proficiency + avsAverage) / 2);
    return Math.min(255, Math.max(0, syncScore));
}
window.getCommanderSyncScore = getCommanderSyncScore;

/**
 * 根据同步率计算指挥官系统冷却回合数
 * @param {number} syncScore - 同步率 (0-255)
 * @returns {number} 冷却回合数 (1-4, 或 -1 表示不可用)
 */
function getCommanderCooldown(syncScore) {
    if (syncScore < 60)  return -1; // 不可用：默契不足
    if (syncScore >= 240) return 1; // 二字干涉(Zone)：高频干涉
    if (syncScore >= 180) return 2; // 相当敏锐
    if (syncScore >= 120) return 3; // 较为稳定
    return 4;                        // 偶尔灵光一现
}
window.getCommanderCooldown = getCommanderCooldown;

// ============================================
// 【已迁移】古武系统 -> mechanics/move-styles.js
// 【已迁移】Z-Move/Max Move 推导 -> mechanics/z-moves.js
// ============================================

// ============================================
// 【已迁移】训练家头像系统 -> ui/ui-trainer-hud.js
// 【已迁移】Cut-in 演出系统 -> ui/ui-trainer-hud.js
// 【已迁移】UI 缩放 -> ui/ui-renderer.js
// ============================================

// 预加载模拟
setTimeout(() => {
    document.getElementById('btn-start').innerText = "START GAME";
    document.getElementById('btn-start').disabled = false;
    document.getElementById('btn-start').style.fontWeight = "900";
}, 800);

window.addEventListener('resize', updateUIScale);
updateUIScale();

/**
 * 初始化游戏 - 加载示例对战
 */
async function initGame() {
    const startBtn = document.getElementById('btn-start');
    const sysMsg = document.querySelector('.sys-msg');
    
    // === 预加载阶段 ===
    startBtn.disabled = true;
    startBtn.innerText = "LOADING...";
    if (sysMsg) sysMsg.textContent = "PRELOADING RESOURCES...";
    
    // 获取战斗数据
    // 设置为 true 可强制使用 data-loader.js 中的默认数据（用于测试）
    const FORCE_USE_DEFAULT_DATA = false;
    
    let json;
    if (!FORCE_USE_DEFAULT_DATA && typeof globalBattleData !== 'undefined' && globalBattleData) {
        json = globalBattleData;
        console.log('[PKM] 使用外部注入数据 (globalBattleData)');
    } else {
        json = getDefaultBattleData();
        console.log('[PKM] 使用默认数据 (data-loader.js)');
    }
    
    // ============================================
    // 【全局系统开关】从 JSON settings 读取
    // ============================================
    const settings = json.settings || {};
    window.GAME_SETTINGS = {
        enableAVS: settings.enableAVS !== false,           // AVS 羁绊值系统
        enableCommander: settings.enableCommander !== false, // 战术指挥系统
        enableEVO: settings.enableEVO !== false,           // 进化/羁绊共鸣系统
        enableBGM: settings.enableBGM !== false,           // 背景音乐
        enableSFX: settings.enableSFX !== false,           // 音效
        enableClash: settings.enableClash !== false,       // 对冲系统
        enableEnvironment: settings.enableEnvironment !== false  // 环境天气系统
    };
    console.log('[SETTINGS] 全局系统开关:', window.GAME_SETTINGS);
    
    // 预加载本局资源
    const playerParty = (json.player && json.player.party) || [];
    const enemyParty = json.party || (json.enemy && json.enemy.party) || [];
    const trainerId = (json.enemy && json.enemy.id) || (json.trainer && json.trainer.id) || null;
    
    if (typeof preloadBattleResources === 'function' && (playerParty.length > 0 || enemyParty.length > 0)) {
        try {
            await preloadBattleResources(playerParty, enemyParty, trainerId, (loaded, total) => {
                if (sysMsg) sysMsg.textContent = `LOADING... ${Math.floor(loaded/total*100)}%`;
            });
        } catch (e) {
            console.warn('[PRELOAD] Error:', e);
        }
    }
    
    if (sysMsg) sysMsg.textContent = "READY!";
    
    // 隐藏加载页，显示游戏界面
    document.getElementById('start-view').style.opacity = 0;
    setTimeout(() => document.getElementById('start-view').style.display = 'none', 500);
    document.getElementById('game-view').classList.remove('hidden');

    resetSpriteState();
    
    // 初始化天气视觉系统
    if (typeof window.initWeatherSystem === 'function') {
        window.initWeatherSystem();
    }

    // 加载对战 JSON (已在预加载阶段获取)
    try {
        console.log('[PKM] 使用战斗数据:', json);
        
        // 从 JSON 加载玩家队伍
        if (json.player && json.player.party) {
            // === 解锁系统 (Unlock System) ===
            // 解析 unlocks 对象，决定玩家是否有资格使用各机制
            const unlocks = json.player.unlocks || {};
            battle.playerUnlocks = {
                enable_bond: unlocks.enable_bond !== false,        // 羁绊共鸣
                enable_styles: unlocks.enable_styles === true,     // 刚猛/迅疾 (必须显式启用)
                enable_insight: unlocks.enable_insight !== false,  // 心眼/AVs突破
                enable_mega: unlocks.enable_mega !== false,        // Mega进化
                enable_z_move: unlocks.enable_z_move !== false,    // Z招式
                enable_dynamax: unlocks.enable_dynamax !== false,  // 极巨化
                enable_tera: unlocks.enable_tera !== false,        // 太晶化
                enable_proficiency_cap: unlocks.enable_proficiency_cap === true  // 训练度突破155上限 (默认关闭)
            };
            console.log('[UNLOCK] 玩家解锁状态:', battle.playerUnlocks);
            
            // 【战术指挥系统】读取训练家熟练度
            // JSON 格式: player.trainerProficiency (0-255)
            // 根据 enable_proficiency_cap 解锁状态限制上限：false=155, true=255
            if (json.player.trainerProficiency !== undefined) {
                const proficiencyCap = battle.playerUnlocks.enable_proficiency_cap ? 255 : 155;
                battle.trainerProficiency = Math.min(proficiencyCap, Math.max(0, json.player.trainerProficiency));
                console.log(`[COMMANDER] 从 JSON 读取训练家熟练度: ${battle.trainerProficiency} (上限: ${proficiencyCap})`);
            }
            
            // 【战术指挥系统】初始化
            if (typeof initCommanderSystem === 'function') {
                initCommanderSystem();
            }
            
            // 检查玩家是否有 Mega 权限 (直接从 unlocks 读取)
            const playerCanMega = battle.playerUnlocks.enable_mega;
            battle.setPlayerParty(json.player.party, playerCanMega);
            battle.playerName = json.player.name || '主角';
            log(`<b>${battle.playerName}</b> 准备战斗！`);
            
            // === Necrozma 合体检测 ===
            // 检测队伍中是否有 Necrozma + Solgaleo/Lunala 组合
            if (typeof checkAndProcessNecrozmaFusion === 'function') {
                checkAndProcessNecrozmaFusion(battle.playerParty, log, () => {
                    console.log('[NECROZMA FUSION] 合体检测完成');
                });
            }
        } else {
            // Fallback: 默认玩家队伍
            battle.setPlayerParty([
                { name: 'Charmander', lv: 5, moves: ['Scratch', 'Ember'] },
                { name: 'Pikachu', lv: 5, moves: ['Thunder Shock', 'Quick Attack'] },
            ], false);
            battle.playerName = '主角';
        }
        
        // 加载敌方数据
        battle.loadFromJSON(json);
        updateTrainerHud();
        
        const t = battle.trainer;
        const btnCatch = document.getElementById('btn-catch');
        const rightCol = document.getElementById('menu-right-col');
        const catchLayer = document.getElementById('ball-layer');
        if (btnCatch && rightCol) {
            if (t && (t.id === 'wild' || !t.id)) {
                btnCatch.classList.remove('hidden');
                rightCol.classList.remove('two-btn');
            } else {
                btnCatch.classList.add('hidden');
                rightCol.classList.add('two-btn');
                if (catchLayer) catchLayer.classList.add('hidden');
            }
        }
        if (t) {
            const isWild = t.id === 'wild';
            if (isWild) {
                log(`野生宝可梦【${battle.getEnemy().cnName}】出现了！`);
            } else {
                log(`<b style="color:#e74c3c">【${t.name}】</b>发起挑战！`);
            }
            if (t.lines?.start) {
                log(`<i>${t.name}: "${t.lines.start}"</i>`);
            }
        }
        log(`敌方派出了 <b>${battle.getEnemy().cnName}</b> (Lv.${battle.getEnemy().level})!`);
        
        if (battle.scriptedResult === 'loss') {
            log(`<span style="color:#e67e22">[剧情战] 这是一场必败的战斗...</span>`);
        }
    } catch (e) {
        console.error('Failed to load battle JSON:', e);
        // Fallback: 简单对战
        battle.setPlayerParty([
            { name: 'Pikachu', lv: 5, moves: ['Thunder Shock', 'Quick Attack'] }
        ]);
        battle.loadFromJSON({
            trainer: { name: '野生宝可梦', id: 'wild', line: '' },
            party: [{ name: 'Rattata', lv: 3, moves: ['Tackle'] }]
        });
        log("野生的小拉达出现了！");
    }

    const openingPoke = battle.getPlayer();
    const openingEnemy = battle.getEnemy();
    if (openingPoke) {
        log(`去吧！${openingPoke.cnName}（Lv.${openingPoke.level}）！`);
    }
    
    // === 播放双方宝可梦叫声 ===
    setTimeout(() => {
        if (openingPoke && typeof window.playPokemonCry === 'function') {
            window.playPokemonCry(openingPoke.name);
        }
    }, 500);
    setTimeout(() => {
        if (openingEnemy && typeof window.playPokemonCry === 'function') {
            window.playPokemonCry(openingEnemy.name);
        }
    }, 1200);
    
    // === 检查并执行进场自动变形 (Primal/Crowned) ===
    const checkInitTransformFunc = typeof window.checkInitTransform === 'function' ? window.checkInitTransform : null;
    if (checkInitTransformFunc) {
        // 检查玩家宝可梦
        if (openingPoke && openingPoke.needsInitTransform) {
            console.log('[FORM] Checking player init transform:', openingPoke.name);
            const result = checkInitTransformFunc(openingPoke);
            if (result) {
                log(`<span style="color:#a855f7">✦ ${result.oldName} 变为 ${result.newName}！</span>`);
                // 预加载新形态的精灵图，避免闪烁
                const newSpriteUrl = openingPoke.getSprite(true); // 玩家是背面
                const preloader = new Image();
                preloader.src = newSpriteUrl;
            }
        }
        
        // 检查敌方宝可梦
        if (openingEnemy && openingEnemy.needsInitTransform) {
            console.log('[FORM] Checking enemy init transform:', openingEnemy.name);
            const result = checkInitTransformFunc(openingEnemy);
            if (result) {
                log(`<span style="color:#ef4444">✦ 敌方 ${result.oldName} 变为 ${result.newName}！</span>`);
                // 预加载新形态的精灵图，避免闪烁
                const newSpriteUrl = openingEnemy.getSprite(false); // 敌方是正面
                const preloader = new Image();
                preloader.src = newSpriteUrl;
            }
        }
    }
    
    // === 【敌方首发 Necrozma 合体 + Ultra Burst】===
    // 检测首发敌方是否是 Necrozma，且队伍中有 Solgaleo/Lunala 可以合体
    if (typeof window.autoProcessNecrozmaFusion === 'function' && openingEnemy) {
        const necrozmaName = (openingEnemy.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        if (necrozmaName === 'necrozma') {
            // 延迟执行，让玩家先看到普通 Necrozma 出场
            setTimeout(async () => {
                updateAllVisuals('enemy');
                await new Promise(r => setTimeout(r, 800));
                
                const fusionResult = window.autoProcessNecrozmaFusion(battle.enemyParty, (msg) => {
                    log(msg); // 显示合体/变身日志
                });
                
                if (fusionResult.success) {
                    // 更新精灵图
                    const newSpriteUrl = openingEnemy.getSprite ? openingEnemy.getSprite(false) : null;
                    if (newSpriteUrl && typeof window.smartLoadSprite === 'function') {
                        window.smartLoadSprite('enemy-sprite', newSpriteUrl, false);
                    }
                    updateAllVisuals('enemy');
                    
                    // 播放变身后的叫声
                    setTimeout(() => {
                        if (typeof window.playPokemonCry === 'function') {
                            window.playPokemonCry(openingEnemy.name);
                        }
                    }, 500);
                }
            }, 1500);
        }
    }
    
    // 延迟一帧再更新视觉，确保预加载完成
    setTimeout(() => {
        updateAllVisuals();
    }, 50);
    
    // === 播放战斗 BGM ===
    if (typeof playBattleBgm === 'function') {
        playBattleBgm();
    }
    
    // === 环境天气初始化 (地图模块接口) ===
    // 在入场特性之前触发，宝可梦特性可以覆盖环境天气
    // 【修复】天气是核心战斗机制，不受 enableEnvironment 开关控制
    // enableEnvironment 只控制环境图层(overlay)系统
    const enableEnv = window.GAME_SETTINGS && window.GAME_SETTINGS.enableEnvironment;
    if (json.environment && json.environment.weather && json.environment.weather !== 'none') {
        const envWeather = json.environment.weather;
        const envTurns = json.environment.weatherTurns || 0;
        const suppressionTier = json.environment.suppressionTier || 1;
        const revertMessage = json.environment.revertMessage || null;
        
        // 保存环境天气到 battle 对象，用于天气结束后回归
        battle.environmentWeather = envWeather;
        battle.weather = envWeather;
        battle.weatherTurns = envTurns; // 0 = 永久
        
        // 【压制系统】保存环境配置
        battle.environmentConfig = {
            weather: envWeather,
            weatherTurns: envTurns,
            suppressionTier: suppressionTier,
            revertMessage: revertMessage
        };
        
        // 天气名称映射
        const weatherNames = {
            'rain': '下起了雨',
            'sun': '阳光变得强烈',
            'sandstorm': '刮起了沙暴',
            'snow': '下起了雪',
            'hail': '下起了冰雹',
            'smog': '烟霾笼罩了战场',
            'fog': '浓雾弥漫',
            'ashfall': '火山灰飘落',
            'gale': '狂风呼啸'
        };
        const weatherName = weatherNames[envWeather] || envWeather;
        
        // 根据压制等级显示不同提示
        let tierHint = '';
        if (suppressionTier === 2) {
            tierHint = ' <span style="color:#f59e0b">[抑制区域]</span>';
        } else if (suppressionTier === 3) {
            tierHint = ' <span style="color:#dc2626">[绝对领域]</span>';
        }
        log(`<span style="color:#9b59b6">🌍 环境效果：${weatherName}！${tierHint}</span>`);
        
        // 触发天气视觉效果
        if (typeof window.setWeatherVisuals === 'function') {
            window.setWeatherVisuals(envWeather);
        }
        console.log(`[ENVIRONMENT] 初始化环境天气: ${envWeather}, 持续: ${envTurns || '永久'}, 压制等级: ${suppressionTier}`);
    }
    
    // === 【环境图层系统】初始化 ===
    // 从 JSON 的 environment.overlay 加载环境效果
    console.log(`[ENV OVERLAY] 检查: enableEnv=${enableEnv}, hasEnv=${!!json.environment}, hasOverlay=${!!(json.environment && json.environment.overlay)}`);
    if (enableEnv && json.environment && json.environment.overlay) {
        console.log(`[ENV OVERLAY] 开始加载环境图层...`);
        const overlay = json.environment.overlay;
        
        // 先清除旧环境
        if (typeof window.clearEnvironmentOverlay === 'function') {
            window.clearEnvironmentOverlay();
        }
        
        // 注入新环境
        if (typeof window.injectEnvironmentOverlay === 'function') {
            const env = window.injectEnvironmentOverlay(overlay);
            
            if (env) {
                // 显示环境效果说明
                log(`<span style="color:#a855f7">🌍 <b>${env.env_name}</b></span>`);
                if (env.narrative) {
                    log(`<span style="color:#a855f7; font-style:italic">${env.narrative}</span>`);
                }
                
                // 显示具体规则效果
                for (const rule of env.rules || []) {
                    const targetDesc = _getTargetDescription(rule.target);
                    const effectsDesc = _getEffectsDescription(rule.effects);
                    if (effectsDesc) {
                        log(`<span style="color:#c084fc">  → ${targetDesc}: ${effectsDesc}</span>`);
                    }
                }
                
                console.log(`[ENV OVERLAY] 初始化环境图层: ${env.env_name}, 规则数: ${env.rules?.length || 0}`);
            }
        }
    }
    
    // === 触发双方入场特性 (威吓、天气等) ===
    if (openingEnemy) {
        triggerEntryAbilities(openingEnemy, openingPoke);
    }
    if (openingPoke) {
        triggerEntryAbilities(openingPoke, openingEnemy);
    }

    const trainerHud = document.getElementById('trainer-hud');
    if (trainerHud) {
        trainerHud.classList.add('hidden');
        trainerHud.style.opacity = '0';
    }

    const trainer = battle.trainer;
    if (trainer && trainer.id !== 'wild') {
        const introLine = trainer.lines?.start || `${trainer.name || 'Opponent'} is challenging you!`;
        setTimeout(() => {
            playCutIn(introLine, 3500);
            setTimeout(() => {
                updateTrainerHud();
                if (trainerHud) {
                    trainerHud.classList.remove('hidden');
                    trainerHud.style.transition = 'opacity 1s';
                    trainerHud.style.opacity = '1';
                }
            }, 3800);
        }, 500);
    }
    
    // 【Commander System V2】初始化轮播悬浮窗（在所有队伍加载完成后）
    if (typeof window.initCommanderSystemV2 === 'function') {
        window.initCommanderSystemV2();
    }
}

// =========================================================
// 【已迁移】机制互斥系统 -> mechanics/mechanic-checker.js
// 【已迁移】极巨化状态管理 -> mechanics/dynamax.js
// =========================================================

// =========================================================
// 【已迁移】默认战斗数据 -> systems/data-loader.js
// 【已迁移】JSON 数据加载 -> systems/data-loader.js
// =========================================================

/* ================= TERA CROWN SYSTEM (太晶化悬浮图腾) ================= */

const TERA_GEM_PATH = 'm49.996 50.41-15.215 8.7812h30.43zm-16.652 6.3047 15.215-26.355v17.57zm-1.4336 5.3594 18.09 31.332 18.09-31.332zm15.602-35.641-18.09 31.328-18.09-31.328zm41.156 0-18.09 31.332-18.09-31.332zm-61.203 33.676-4.8984-8.4844-9.7969 16.969zm6.332 10.965h-19.59l14.691-8.4805zm37.305-8.4805 14.688 8.4805h-19.586zm6.332-10.973-4.8984 8.4805 14.691 8.4844zm-25.992-28.066h9.7891l-9.7891-16.961zm-12.672 0h9.7891v-16.961zm27.887 33.156-15.215-8.7852v-17.57z';
const SVG_NS = 'http://www.w3.org/2000/svg';
const XLINK_NS = 'http://www.w3.org/1999/xlink';

/**
 * 启动太晶化悬浮图腾 (SVG 渲染版)
 * @param {string} type - 太晶属性 (fire, water, grass...)
 * @param {string} targetSide - 'player' | 'enemy'
 */
function triggerTeraCrown(type, targetSide) {
    const wrapper = document.querySelector(`.${targetSide}-pos`);
    if (!wrapper) return;

    // 防止重复触发
    const existing = wrapper.querySelector('.tera-crown-container');
    if (existing) existing.remove();

    const typeLower = (type || 'normal').toLowerCase();
    const color = (window.TYPE_COLORS && window.TYPE_COLORS[typeLower]) || '#22d3ee';
    const CDN_ICON = `https://cdn.jsdelivr.net/gh/duiker101/pokemon-type-svg-icons/icons/${typeLower}.svg`;

    // 1. 外层容器
    const container = document.createElement('div');
    container.className = 'tera-crown-container';
    if (typeLower === 'stellar') container.classList.add('stellar');
    container.style.setProperty('--tera-color', color);
    container.style.animation = 'tera-crown-spawn 0.8s ease-out forwards, tera-crown-float 4s ease-in-out 0.8s infinite';

    // 2. SVG 层
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'tera-svg-layer');
    svg.setAttribute('viewBox', '-5 -10 110 135');
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    svg.style.filter = `drop-shadow(0 0 10px ${color})`;

    // 3. 宝石切面 path
    const gemPath = document.createElementNS(SVG_NS, 'path');
    gemPath.setAttribute('class', 'gem-shape');
    gemPath.setAttribute('d', TERA_GEM_PATH);
    gemPath.style.fill = color;
    gemPath.style.fillOpacity = '0.3';
    gemPath.style.stroke = 'white';
    svg.appendChild(gemPath);

    // 4. 居中属性图标 (宝石中心约 x:50 y:45，图标尺寸40，所以偏移 -20)
    const icon = document.createElementNS(SVG_NS, 'image');
    icon.setAttribute('class', 'type-icon-img');
    icon.setAttributeNS(XLINK_NS, 'href', CDN_ICON);
    icon.setAttribute('href', CDN_ICON);
    icon.setAttribute('x', '30');
    icon.setAttribute('y', '27');
    icon.setAttribute('width', '40');
    icon.setAttribute('height', '40');
    icon.style.filter = `brightness(0) invert(1) drop-shadow(0 0 2px ${color}) drop-shadow(0 0 5px ${color})`;
    icon.style.opacity = '0.95';
    svg.appendChild(icon);

    // 5. 能量连接线
    const connector = document.createElement('div');
    connector.className = 'tera-connector';
    connector.style.background = `linear-gradient(to top, transparent, ${color} 40%, rgba(255,255,255,0.8) 100%)`;

    // 组装
    container.appendChild(svg);
    container.appendChild(connector);
    wrapper.appendChild(container);

    // 播放音效
    if (typeof AudioSys !== 'undefined' && AudioSys.play) {
        AudioSys.play('Hit_Super');
    }

    console.log(`[TERA CROWN] ${targetSide} activated: ${typeLower} (${color})`);
}
window.triggerTeraCrown = triggerTeraCrown;

/**
 * 移除太晶化悬浮图腾
 * @param {string} targetSide - 'player' | 'enemy'
 */
function removeTeraCrown(targetSide) {
    const wrapper = document.querySelector(`.${targetSide}-pos`);
    const crown = wrapper?.querySelector('.tera-crown-container');
    if (crown) {
        crown.style.transition = 'opacity 0.5s, transform 0.5s';
        crown.style.opacity = '0';
        crown.style.transform = 'translate(-50%, -20px) scale(0.3)';
        setTimeout(() => crown.remove(), 500);
    }
    console.log(`[TERA CROWN] ${targetSide} removed`);
}
window.removeTeraCrown = removeTeraCrown;

/**
 * 更新战斗精灵图（用于 Imposter/Illusion 特性触发后刷新）
 * 导出到 window 供 ability-handlers.js 调用
 */
function updateBattleSprites() {
    updateAllVisuals(false);
}
window.updateBattleSprites = updateBattleSprites;

/**
 * 界面刷新：渲染文本、血量、图片
 * @param {string|boolean} forceSpriteAnim - false: 不强制动画, 'player': 只有玩家动画, 'enemy': 只有敌方动画, true: 两边都动画
 */
function updateAllVisuals(forceSpriteAnim = false) {
    const p = battle.getPlayer();
    const e = battle.getEnemy();
    
    if (!p || !e) return;

    // 1. 名字 LV (敌方高等级用红色强调)
    // 【Illusion/Imposter】支持显示伪装名称
    document.getElementById('player-name').innerText = p.displayCnName || p.cnName;
    document.getElementById('player-lvl').innerText = p.level;
    const enemyNameEl = document.getElementById('enemy-name');
    // 野生战斗时显示当前敌方宝可梦的名字，训练家战斗时显示宝可梦名字
    enemyNameEl.innerText = e.displayCnName || e.cnName;
    const enemyLvEl = document.getElementById('enemy-lvl');
    enemyLvEl.innerText = e.level;
    enemyLvEl.style.color = (e.level > p.level + 20) ? '#e74c3c' : '';
    enemyLvEl.style.fontWeight = (e.level > p.level + 20) ? '900' : '';

    // 2. 血条渲染
    renderHp('player', p.currHp, p.maxHp);
    renderHp('enemy', e.currHp, e.maxHp);

    // 3. 图片智能加载 (防闪烁: 加载完再显示)
    // forceSpriteAnim 可以是 'player' 或 'enemy' 来指定只有一方播放动画
    const playerAnim = (forceSpriteAnim === true || forceSpriteAnim === 'player');
    const enemyAnim = (forceSpriteAnim === true || forceSpriteAnim === 'enemy');
    
    // 极巨化状态下不重新加载精灵图（保持 G-Max 图片）
    if (!p.isDynamaxed) {
        // 【Illusion/Imposter】支持显示伪装精灵图
        const playerSpriteUrl = p.displaySpriteId 
            ? `https://play.pokemonshowdown.com/sprites/ani-back/${p.displaySpriteId}.gif`
            : p.getSprite(true);
        smartLoadSprite('player-sprite', playerSpriteUrl, playerAnim);
    }
    if (!e.isDynamaxed) {
        // 【Illusion/Imposter】支持显示伪装精灵图
        const enemySpriteUrl = e.displaySpriteId 
            ? `https://play.pokemonshowdown.com/sprites/ani/${e.displaySpriteId}.gif`
            : e.getSprite(false);
        smartLoadSprite('enemy-sprite', enemySpriteUrl, enemyAnim);
    }
    const playerSpriteEl = document.getElementById('player-sprite');
    if (playerSpriteEl) {
        playerSpriteEl.classList.toggle('mega-player', !!p.isMega);
        playerSpriteEl.classList.toggle('mega-enemy', false);
        // 极巨化状态
        playerSpriteEl.classList.toggle('state-dynamax', !!p.isDynamaxed);
        
        // 【修复】太晶化状态和属性颜色类管理
        playerSpriteEl.classList.toggle('state-terastal', !!p.isTerastallized);
        // 清除所有太晶属性颜色类
        const allTeraTypes = ['normal', 'fire', 'water', 'electric', 'grass', 'ice', 'fighting', 'poison', 'ground', 'flying', 'psychic', 'bug', 'rock', 'ghost', 'dragon', 'dark', 'steel', 'fairy', 'stellar'];
        allTeraTypes.forEach(type => playerSpriteEl.classList.remove(`tera-type-${type}`));
        // 如果太晶化，添加对应属性颜色类 + 悬浮图腾
        if (p.isTerastallized && p.teraType) {
            playerSpriteEl.classList.add(`tera-type-${p.teraType.toLowerCase()}`);
            // 【TERA CROWN】确保悬浮图腾存在
            const playerWrapper = playerSpriteEl.closest('.sprite-wrapper');
            if (playerWrapper && !playerWrapper.querySelector('.tera-crown-container')) {
                triggerTeraCrown(p.teraType, 'player');
            }
        } else {
            // 【TERA CROWN】移除悬浮图腾
            const playerWrapper = playerSpriteEl.closest('.sprite-wrapper');
            if (playerWrapper && playerWrapper.querySelector('.tera-crown-container')) {
                removeTeraCrown('player');
            }
        }
        
        // 清除非官方 Mega 效果（如果当前宝可梦不是非官方 Mega）
        if (!p.isUnofficialMega) {
            playerSpriteEl.classList.remove('unofficial-mega');
        }
        // 羁绊共鸣状态：只有当前宝可梦有 hasBondResonance 标记时才保留样式
        if (p.hasBondResonance) {
            playerSpriteEl.classList.add('bond-resonance');
            playerSpriteEl.style.filter = 'drop-shadow(0 0 12px gold) brightness(1.1) saturate(1.15)';
        } else {
            playerSpriteEl.classList.remove('bond-resonance');
            // 清除可能残留的 filter 样式
            if (playerSpriteEl.style.filter && playerSpriteEl.style.filter.includes('gold')) {
                playerSpriteEl.style.filter = '';
            }
        }
    }
    const enemySpriteEl = document.getElementById('enemy-sprite');
    if (enemySpriteEl) {
        enemySpriteEl.classList.toggle('mega-enemy', !!e.isMega);
        enemySpriteEl.classList.toggle('mega-player', false);
        // 极巨化状态
        enemySpriteEl.classList.toggle('state-dynamax', !!e.isDynamaxed);
        
        // 【修复】太晶化状态和属性颜色类管理
        enemySpriteEl.classList.toggle('state-terastal', !!e.isTerastallized);
        // 清除所有太晶属性颜色类
        const allTeraTypes = ['normal', 'fire', 'water', 'electric', 'grass', 'ice', 'fighting', 'poison', 'ground', 'flying', 'psychic', 'bug', 'rock', 'ghost', 'dragon', 'dark', 'steel', 'fairy', 'stellar'];
        allTeraTypes.forEach(type => enemySpriteEl.classList.remove(`tera-type-${type}`));
        // 如果太晶化，添加对应属性颜色类 + 悬浮图腾
        if (e.isTerastallized && e.teraType) {
            enemySpriteEl.classList.add(`tera-type-${e.teraType.toLowerCase()}`);
            // 【TERA CROWN】确保悬浮图腾存在
            const enemyWrapper = enemySpriteEl.closest('.sprite-wrapper');
            if (enemyWrapper && !enemyWrapper.querySelector('.tera-crown-container')) {
                triggerTeraCrown(e.teraType, 'enemy');
            }
        } else {
            // 【TERA CROWN】移除悬浮图腾
            const enemyWrapper = enemySpriteEl.closest('.sprite-wrapper');
            if (enemyWrapper && enemyWrapper.querySelector('.tera-crown-container')) {
                removeTeraCrown('enemy');
            }
        }
        
        // 清除非官方 Mega 效果（如果当前宝可梦不是非官方 Mega）
        if (!e.isUnofficialMega) {
            enemySpriteEl.classList.remove('unofficial-mega');
        }
        
        // 【修复】羁绊共鸣状态：只有当前宝可梦有 hasBondResonance 标记时才保留样式
        if (e.hasBondResonance) {
            enemySpriteEl.classList.add('bond-resonance');
            enemySpriteEl.style.filter = 'drop-shadow(0 0 12px gold) brightness(1.1) saturate(1.15)';
        } else {
            enemySpriteEl.classList.remove('bond-resonance');
            // 清除可能残留的 filter 样式
            if (enemySpriteEl.style.filter && enemySpriteEl.style.filter.includes('gold')) {
                enemySpriteEl.style.filter = '';
            }
        }
    }

    // 4. 队伍状态球
    renderDots('ui-player-dots', battle.playerParty, battle.playerActive);
    renderDots('ui-enemy-dots', battle.enemyParty, battle.enemyActive);

    updateTrainerHud();

    // 5. 按钮区
    document.getElementById('switch-menu-layer').classList.add('hidden');

    if (p.currHp <= 0) {
        // 死亡状态，等待强制换人
    } else {
        // 渲染技能按钮（支持 4 技）
        const btnIds = ['btn-m0', 'btn-m1', 'btn-m2', 'btn-m3'];
        btnIds.forEach((id, i) => {
            const btn = document.getElementById(id);
            if (!btn) return;
            
            // 重置所有特殊样式
            btn.className = 'action-btn';
            btn.style.opacity = '1';
            
            if (i < p.moves.length) {
                const m = p.moves[i];
                
                // =========================================================
                // Z-Move / Max Move 自动推导系统
                // 基于 mechanic 字段和数据库自动判断招式变换
                // =========================================================
                const mId = (m.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
                const mData = (typeof MOVES !== 'undefined' && MOVES[mId]) ? MOVES[mId] : {};
                
                // 使用新的自动推导函数
                const zTarget = getZMoveTarget(m, p);  // 返回 { name, type, power } 或 null
                const maxTarget = p.isDynamaxed ? getMaxMoveTarget(m, p) : null; // 只有极巨化状态才推导
                
                // 判断当前招式应该显示什么样式
                const showZStyle = zTarget && !battle.playerZUsed;
                const showMaxStyle = maxTarget !== null;
                
                // 禁用逻辑
                let isDisabled = false;
                if (showZStyle && battle.playerZUsed) isDisabled = true;
                
                // 【关键修复】检查定身法/诅咒之躯封印
                if (p.volatile && p.volatile.disable > 0 && p.volatile.disabledMove) {
                    if (m.name === p.volatile.disabledMove) {
                        isDisabled = true;
                        console.log(`[DISABLE UI] ${m.name} 被封印，按钮禁用`);
                    }
                }
                
                // 【关键修复】检查怨恨封印 (Grudge)
                if (p.volatile && p.volatile.grudgeSealed && p.volatile.grudgeSealed.includes(m.name)) {
                    isDisabled = true;
                    console.log(`[GRUDGE UI] ${m.name} 被怨恨封印，按钮禁用`);
                }
                
                // 【PP系统】PP 耗尽时禁用
                if (m.pp !== undefined && m.pp <= 0) {
                    isDisabled = true;
                    console.log(`[PP UI] ${m.name} PP耗尽，按钮禁用`);
                }
                
                // 【环境图层系统】检查技能是否被环境禁用
                let envBanned = false;
                if (typeof window.envOverlay !== 'undefined' && window.envOverlay.isMoveBanned) {
                    if (window.envOverlay.isMoveBanned(p, m)) {
                        isDisabled = true;
                        envBanned = true;
                        console.log(`[ENV BAN UI] ${m.name} 被环境禁用，按钮变灰`);
                    }
                }
                
                // 获取显示名称和类型
                let displayName = m.cn || m.name;
                let displayType = m.type || 'Normal';
                
                if (showZStyle) {
                    // Z 招式样式
                    displayName = (window.Locale) ? window.Locale.get(zTarget.name) : zTarget.name;
                    displayType = zTarget.type;
                } else if (showMaxStyle) {
                    // Max 招式样式
                    displayName = (window.Locale) ? window.Locale.get(maxTarget.name) : maxTarget.name;
                    displayType = maxTarget.type;
                }
                
                // =========================================================
                // 【心眼系统】属性克制提示 (enable_insight)
                // 显示 ▲(效果绝佳) / ▼(效果不好) / ×(无效)
                // =========================================================
                let insightHint = '';
                const insightUnlocked = battle.playerUnlocks && battle.playerUnlocks.enable_insight !== false;
                if (insightUnlocked && e && e.types) {
                    const moveType = displayType || m.type || 'Normal';
                    const eff = window.getTypeEffectiveness ? 
                        window.getTypeEffectiveness(moveType, e.types) : 1;
                    if (eff === 0) {
                        insightHint = '<span class="insight-hint insight-immune" title="无效">×</span>';
                    } else if (eff >= 2) {
                        insightHint = '<span class="insight-hint insight-super" title="效果绝佳">▲</span>';
                    } else if (eff <= 0.5) {
                        insightHint = '<span class="insight-hint insight-resist" title="效果不好">▼</span>';
                    }
                }
                
                // 获取属性对应的SVG图标路径和类型名称
                const typeKey = (displayType || 'normal').toLowerCase();
                const typeSvgPath = `./data/svg/${typeKey}.svg`;
                const typeNameEN = displayType; // 直接使用英文属性名
                
                // 设置 data-type 属性用于CSS变量
                btn.setAttribute('data-type', typeKey);
                
                if (showZStyle || showMaxStyle) {
                    // 应用特殊样式
                    if (showZStyle) {
                        btn.classList.add('z-move-btn');
                    } else {
                        btn.classList.add('max-move-btn');
                    }
                    
                    if (isDisabled) {
                        btn.classList.add('z-move-used');
                    }
                    
                    const labelText = showZStyle ? 'Z' : '';
                    btn.innerHTML = `
                        <div class="deco-bar"></div>
                        <div class="content-unskew">
                            <div class="z-badge-icon">${labelText}</div>
                            <div class="icon-circle">
                                <img src="${typeSvgPath}" alt="${typeKey}">
                            </div>
                            <div class="text-group">
                                <span class="move-name">${displayName}${insightHint}</span>
                                <span class="move-type-name">${typeNameEN.toUpperCase()}</span>
                            </div>
                            <div class="bg-watermark">
                                <img src="${typeSvgPath}">
                            </div>
                        </div>
                    `;
                } else {
                    // 普通技能
                    const ppCur = m.pp !== undefined ? m.pp : '?';
                    const ppMax = m.maxPp !== undefined ? m.maxPp : '?';
                    const ppRatio = (typeof ppCur === 'number' && typeof ppMax === 'number' && ppMax > 0) ? ppCur / ppMax : 1;
                    const ppColorClass = ppCur === 0 ? 'pp-zero' : ppRatio <= 0.25 ? 'pp-critical' : ppRatio <= 0.5 ? 'pp-low' : '';
                    btn.innerHTML = `
                        <div class="deco-bar"></div>
                        <div class="content-unskew">
                            <div class="icon-circle">
                                <img src="${typeSvgPath}" alt="${typeKey}">
                            </div>
                            <div class="text-group">
                                <span class="move-name">${displayName}${insightHint}</span>
                                <span class="move-type-name">${typeNameEN.toUpperCase()}</span>
                            </div>
                            <div class="bg-watermark">
                                <img src="${typeSvgPath}">
                            </div>
                        </div>
                        <span class="pp-badge ${ppColorClass}">${ppCur}/${ppMax}</span>
                    `;
                }
                
                // 交互事件
                if (isDisabled) {
                    btn.disabled = true;
                    btn.onclick = null;
                } else {
                    btn.disabled = false;
                    // 如果是 Z 招式模式，传递 useZ 标记和推导结果
                    if (showZStyle) {
                        btn.onclick = () => handleAttack(i, { useZ: true, zTarget: zTarget });
                    } else {
                        btn.onclick = () => handleAttack(i);
                    }
                }
                btn.style.visibility = 'visible';
                
            } else {
                btn.disabled = true;
                btn.style.visibility = 'hidden';
                btn.innerHTML = '<span class="move-name">---</span><span class="move-type">---</span>';
            }
        });
        
        // 【环境图层系统 + PP系统】检查是否所有技能都被禁用，如果是则启用"挣扎"
        const allBtns = btnIds.map(id => document.getElementById(id)).filter(b => b);
        const allDisabled = allBtns.every(btn => btn.disabled || btn.style.visibility === 'hidden');
        if (allDisabled && p.moves.length > 0) {
            // 启用第一个按钮作为"挣扎"
            const struggleBtn = allBtns[0];
            if (struggleBtn) {
                struggleBtn.disabled = false;
                struggleBtn.style.visibility = 'visible';
                struggleBtn.style.opacity = '0.7';
                struggleBtn.setAttribute('data-type', 'normal');
                struggleBtn.innerHTML = `
                    <div class="deco-bar"></div>
                    <div class="content-unskew">
                        <div class="icon-circle">
                            <img src="./data/svg/normal.svg" alt="normal">
                        </div>
                        <div class="text-group">
                            <span class="move-name" style="color:#ef4444">挣扎</span>
                            <span class="move-type-name">NORMAL</span>
                        </div>
                        <div class="bg-watermark">
                            <img src="./data/svg/normal.svg">
                        </div>
                    </div>
                `;
                struggleBtn.onclick = () => handleStruggle();
                console.log('[ENV BAN] 所有技能被禁用，启用挣扎');
            }
        }
    }
    
    // 6. 更新进化按钮可见性
    if (typeof updateEvolutionButtonVisuals === 'function') {
        updateEvolutionButtonVisuals();
    }
    
    // 7. 【对冲系统】更新 Insight Bar
    if (typeof window.updateInsightBar === 'function' && window.GAME_SETTINGS?.enableClash !== false) {
        window.updateInsightBar(p);
        
        // 如果玩家有 Insight AVs，显示 Insight Bar
        const insightBar = document.getElementById('insight-bar');
        if (insightBar) {
            const hasInsight = p.isAce && p.avs && (p.avs.insight > 0 || (typeof p.getEffectiveAVs === 'function' && p.getEffectiveAVs('insight') > 0));
            insightBar.classList.toggle('active', hasInsight);
        }
    }
}

// ============================================
// 【已迁移】精灵图加载 -> ui/ui-sprites.js
// 【已迁移】血条/精灵球槽渲染 -> ui/ui-renderer.js
// ============================================

/**
 * 处理"挣扎"技能（当所有技能被禁用时）
 */
async function handleStruggle() {
    if (typeof window.playSFX === 'function') window.playSFX('CONFIRM');
    if (battle.locked) return;
    battle.locked = true;
    
    showMainMenu();
    
    const p = battle.getPlayer();
    const e = battle.getEnemy();
    
    // 挣扎技能数据
    const struggleMove = { 
        name: 'Struggle', 
        cn: '挣扎', 
        power: 50, 
        type: 'Normal', 
        cat: 'phys',
        accuracy: 100,
        flags: { contact: 1 }
    };
    
    log(`<span style="color:#ef4444">🌍 ${p.cnName} 被环境压制，无技可用，只能挣扎!</span>`);
    
    // 执行挣扎攻击
    if (typeof window.executePlayerTurn === 'function') {
        await window.executePlayerTurn(p, e, struggleMove);
    }
    
    // 挣扎反伤：扣除自身 1/4 最大 HP
    const recoil = Math.floor(p.maxHp / 4);
    p.takeDamage(recoil);
    log(`<span style="color:#e74c3c">${p.cnName} 因挣扎受到了 ${recoil} 点反作用力伤害!</span>`);
    
    updateAllVisuals();
    
    // 检查战斗结束
    if (battle.checkBattleEnd()) {
        battle.locked = false;
        return;
    }
    
    // AI 回合
    if (typeof window.handleAITurn === 'function') {
        await window.handleAITurn();
    }
    
    // 回合结束阶段
    if (typeof window.executeEndPhase === 'function') {
        await window.executeEndPhase();
    }
    
    battle.locked = false;
    showMovesMenu();
}

/**
 * 核心逻辑：发起攻击处理 (支持先制技优先级)
 * @param {number} moveIndex 招式索引
 * @param {object} options 可选参数 { useZ: boolean, zConfig: object }
 */
async function handleAttack(moveIndex, options = {}) {
    if (typeof window.playSFX === 'function') window.playSFX('CONFIRM');
    if (battle.locked) return;
    battle.locked = true;
    
    // 【统一回合开始处理】调用 battle-turns.js 中的 onTurnStart
    if (typeof window.onTurnStart === 'function') {
        window.onTurnStart();
    }
    
    // 【Commander System】触发已装填的指令
    if (typeof window.triggerArmedCommand === 'function') {
        window.triggerArmedCommand();
    }
    
    // 【Evolution System】触发已装填的进化
    const evoArmedThisTurn = battle.evoArmed;
    if (evoArmedThisTurn) {
        battle.evoArmed = null; // 清除装填状态
    }
    
    // 保存 Mega 预备状态（在 showMainMenu 重置之前）
    const megaArmedThisTurn = battle.playerMegaArmed;
    
    // 攻击后返回主菜单
    showMainMenu();

    let p = battle.getPlayer();  // 使用 let，因为 pivot 换人时需要更新引用
    let e = battle.getEnemy();   // 使用 let，因为 AI 换人时需要更新引用
    let playerMove = p.moves[moveIndex];
    
    // === 【修复】检查 Taunt 等 Volatile 状态是否阻止使用该技能 ===
    if (typeof MoveEffects !== 'undefined' && MoveEffects.canUseMove) {
        const canUseResult = MoveEffects.canUseMove(p, playerMove);
        if (!canUseResult.canUse) {
            log(`<span style="color:#e74c3c">${canUseResult.reason}</span>`);
            battle.locked = false;
            return;
        }
    }
    
    // === 【环境图层系统】检查技能是否被环境禁用 ===
    if (typeof window.envOverlay !== 'undefined' && window.envOverlay.isMoveBanned) {
        if (window.envOverlay.isMoveBanned(p, playerMove)) {
            log(`<span style="color:#a855f7">🌍 ${playerMove.cn || playerMove.name} 在当前环境下无法使用！</span>`);
            battle.locked = false;
            return;
        }
    }
    
    // =========================================================
    // 【BUG修复】Choice 道具锁招强制检查
    // 如果玩家持有 Choice 道具且已锁定技能，必须使用锁定的技能
    // 如果尚未锁定，则在此处锁定（在对冲逻辑之前）
    // 【重要修复】Choice 道具只应锁定攻击技，不应锁定变化技
    // =========================================================
    const pItem = p.item || '';
    const pIsChoiceItem = pItem.includes('Choice') || pItem.includes('讲究');
    if (pIsChoiceItem) {
        // 辅助函数：检查技能是否为变化技（Status move）
        const _isStatusMove = (moveName) => {
            if (!moveName) return false;
            const mid = moveName.toLowerCase().replace(/[^a-z0-9]/g, '');
            const mdata = (typeof MOVES !== 'undefined' && MOVES[mid]) ? MOVES[mid] : null;
            return mdata && (mdata.category === 'Status' || mdata.basePower === 0);
        };
        
        if (p.choiceLockedMove) {
            // 【BUG修复】如果被锁定的是变化技（不应发生），清除锁定
            if (_isStatusMove(p.choiceLockedMove)) {
                console.log(`[CHOICE FIX] ${p.name} 被错误锁定在变化技 ${p.choiceLockedMove}，清除锁定`);
                delete p.choiceLockedMove;
            } else {
                // 已锁定攻击技：强制使用锁定的技能
                const lockedMoveObj = p.moves.find(m => m.name === p.choiceLockedMove);
                if (lockedMoveObj && playerMove.name !== p.choiceLockedMove) {
                    console.log(`[CHOICE ENFORCE] 玩家试图使用 ${playerMove.name}，但被 ${pItem} 锁定在 ${p.choiceLockedMove}`);
                    log(`<span style="color:#e74c3c">${p.cnName} 被 ${pItem} 锁定，只能使用 ${lockedMoveObj.cn || p.choiceLockedMove}！</span>`);
                    playerMove = lockedMoveObj;
                }
            }
        }
        // 尚未锁定：只锁定攻击技，变化技不触发锁定
        if (!p.choiceLockedMove) {
            if (!_isStatusMove(playerMove.name)) {
                p.choiceLockedMove = playerMove.name;
                console.log(`[CHOICE LOCK] ${p.name} 被 ${pItem} 锁定在 ${playerMove.name}`);
            } else {
                console.log(`[CHOICE SKIP] ${p.name} 使用变化技 ${playerMove.name}，Choice 道具不锁定`);
            }
        }
    }
    
    // =========================================================
    // 【BUG修复】Choice 强制替换后，再次检查 canUseMove
    // 修复 Torment + Choice 逻辑死锁：被锁定的技能可能被无理取闹/定身法等阻止
    // 此时应该 fallback 到挣扎（Struggle）
    // =========================================================
    if (typeof MoveEffects !== 'undefined' && MoveEffects.canUseMove) {
        const postChoiceCheck = MoveEffects.canUseMove(p, playerMove);
        if (!postChoiceCheck.canUse) {
            console.log(`[CHOICE+TORMENT] ${p.name} 被锁定在 ${playerMove.name} 但无法使用: ${postChoiceCheck.reason}`);
            log(`<span style="color:#e74c3c">${postChoiceCheck.reason}</span>`);
            // Fallback 到挣扎
            playerMove = { name: 'Struggle', cn: '挣扎', power: 50, type: 'Normal', cat: 'phys', accuracy: true, flags: { contact: 1 } };
            log(`<span style="color:#ef4444">${p.cnName} 无技可用，只能挣扎!</span>`);
        }
    }
    
    // =========================================================
    // Z-Move 转换逻辑：使用自动推导系统
    // 【互斥检查】Mega/极巨化状态下禁止使用 Z 招式
    // 【Ultra Burst】日/月骡子使用 Z 招式时先触发 Ultra Burst
    // =========================================================
    if (options.useZ && options.zTarget && !battle.playerZUsed) {
        // 【安全检查】如果已经 Mega 或极巨化，禁止使用 Z 招式
        if (p.isMega || p.isDynamaxed || p.hasBondResonance) {
            console.warn(`[CHEAT BLOCK] 试图在 Mega/极巨化 状态下使用 Z 招式！已强制拦截。`);
            log(`<b style="color:#aaa">...但在目前的形态下无法引出 Z 力量！</b>`);
            // 不转换，使用原始招式
        } else {
            // =========================================================
            // 【Ultra Burst】日/月骡子 → 究极奈克洛兹玛
            // 使用专属 Z 招式 "Light That Burns the Sky" 时触发
            // =========================================================
            if (typeof canUltraBurst === 'function' && canUltraBurst(p)) {
                const burstResult = executeUltraBurst(p);
                if (burstResult.success) {
                    burstResult.logs.forEach(msg => log(msg));
                    updateAllVisuals('player');
                    await wait(800);
                    // 更新引用（变身后属性可能改变）
                    p = battle.getPlayer();
                }
            }
            
            const zTarget = options.zTarget;
            const zMoveId = zTarget.name.toLowerCase().replace(/[^a-z0-9]/g, '');
            const zMoveData = (typeof MOVES !== 'undefined' && MOVES[zMoveId]) ? MOVES[zMoveId] : {};
            
            // 使用自动推导的 Z 招式数据
            playerMove = {
                name: zTarget.name,
                cn: zMoveData.cn || zTarget.name,
                type: zTarget.type || playerMove.type || 'Normal',
                power: zTarget.power || 180,
                basePower: zTarget.power || 180,
                accuracy: 100,
                pp: 1,
                isZ: true,
                priority: zMoveData.priority || 0,
                cat: zMoveData.category === 'Physical' ? 'phys' : 'spec',
                category: zMoveData.category || 'Special'
            };
            
            // === 【Ambrosia 时空醉】标记下回合混乱 ===
            if (typeof window.WeatherEffects !== 'undefined' && window.WeatherEffects.checkNeuroBacklash) {
                const currentWeather = battle?.weather || '';
                const neuroResult = window.WeatherEffects.checkNeuroBacklash(currentWeather, 'zmove', p, null);
                if (neuroResult.shouldTrigger) {
                    p.volatile = p.volatile || {};
                    p.volatile.neuroBacklash = true;
                    console.log(`[AMBROSIA] ⚡ 时空醉：${p.name} 使用Z招式后被标记，下回合将混乱`);
                    log(neuroResult.message);
                }
            }
            
            console.log(`[Z-MOVE] 自动推导 Z 招式: ${playerMove.name} (威力: ${playerMove.power})`);
        }
    }
    
    // =========================================================
    // 【古武系统 v2.1】刚猛/迅疾 风格修正 (enable_styles)
    // 动态调整：根据速度优势决定惩罚程度
    // 迅疾 (Agile): 速度快时0.75x(保先手)，速度慢时0.5x(抢节奏)
    // 刚猛 (Strong): 速度快时必中(卖先手)，速度慢时命中0.8x(白嫖)
    // 【平衡性改动】使用后进入 1 回合冷却
    // =========================================================
    // 从全局变量读取当前风格
    let currentMoveStyle = window.currentMoveStyle || 'normal';
    console.log(`[STYLES] 当前风格: ${currentMoveStyle}`);
    
    if (currentMoveStyle !== 'normal' && battle.playerUnlocks?.enable_styles) {
        // 【Chronal Rift 洗翠无法】检查是否在时空裂隙中
        let isUnboundArts = false;
        let unboundModifier = null;
        if (typeof window.WeatherEffects !== 'undefined' && window.WeatherEffects.getUnboundArtsModifier) {
            const weather = battle?.weather || battle?.environmentWeather || '';
            unboundModifier = window.WeatherEffects.getUnboundArtsModifier(weather, currentMoveStyle, p, e);
            isUnboundArts = unboundModifier.active;
        }
        
        // 【冷却检查】如果在冷却中且不是洗翠无法，强制使用普通风格
        if (battle.playerStyleCooldown > 0 && !isUnboundArts) {
            log(`<span style="color:#aaa">风格系统冷却中，本回合只能使用普通风格</span>`);
            currentMoveStyle = 'normal';
        } else {
            const originalPower = playerMove.basePower || playerMove.power || 0;
            const originalPriority = playerMove.priority || 0;
            const originalAccuracy = playerMove.accuracy;
            const isStatus = (playerMove.category === 'Status' || playerMove.cat === 'status' || originalPower === 0);
            
            // 【v2.1】计算有效速度，判断速度优势
            let mySpe = (typeof p.getStat === 'function') ? p.getStat('spe') : (p.spe || 100);
            let enemySpe = (typeof e.getStat === 'function') ? e.getStat('spe') : (e.spe || 100);
            // 麻痹减速
            if (p.status === 'par') mySpe = Math.floor(mySpe * 0.5);
            if (e.status === 'par') enemySpe = Math.floor(enemySpe * 0.5);
            
            // 戏法空间判定
            const isTrickRoom = battle.field && battle.field.trickRoom > 0;
            let haveSpeedAdvantage = false;
            if (isTrickRoom) {
                haveSpeedAdvantage = mySpe < enemySpe; // 空间下：慢就是快
            } else {
                haveSpeedAdvantage = mySpe > enemySpe; // 正常：快就是快
            }
            
            // ============================================
            // 【Chronal Rift 洗翠无法】时空裂隙中的古武规则
            // ============================================
            if (isUnboundArts && unboundModifier) {
                playerMove = { ...playerMove };
                playerMove.styleUsed = currentMoveStyle;
                
                if (currentMoveStyle === 'agile') {
                    // 迅疾・瞬身模式：优先度+1，速度快无损/速度慢威力x0.9
                    playerMove.priority = originalPriority + unboundModifier.priorityMod;
                    playerMove.basePower = Math.floor(originalPower * unboundModifier.damageMultiplier);
                    playerMove.power = playerMove.basePower;
                    log(unboundModifier.message);
                    console.log(`[CHRONAL RIFT] 洗翠无法・迅疾: priority +${unboundModifier.priorityMod}, power x${unboundModifier.damageMultiplier}`);
                } else if (currentMoveStyle === 'strong') {
                    // 刚猛・破坏神模式：伤害x1.5，命中x0.85，优先度-1
                    playerMove.priority = originalPriority + unboundModifier.priorityMod;
                    playerMove.basePower = Math.floor(originalPower * unboundModifier.damageMultiplier);
                    playerMove.power = playerMove.basePower;
                    playerMove.breaksProtect = true;
                    const oldAcc = (typeof originalAccuracy === 'number') ? originalAccuracy : 100;
                    // 必中技无视命中惩罚
                    if (originalAccuracy !== true && oldAcc < 101) {
                        playerMove.accuracy = Math.floor(oldAcc * unboundModifier.accuracyMultiplier);
                    }
                    log(unboundModifier.message);
                    console.log(`[CHRONAL RIFT] 洗翠无法・刚猛: power x${unboundModifier.damageMultiplier}, acc x${unboundModifier.accuracyMultiplier}`);
                }
                // 洗翠无法无冷却
            }
            // ============================================
            // ⚡ 迅疾风格 (Agile Style) - 普通模式
            // ============================================
            else if (currentMoveStyle === 'agile') {
                // 【平衡性改动】变化技禁止使用迅疾
                if (isStatus) {
                    log(`<span style="color:#aaa">变化类招式无法使用迅疾风格！(自动切换回普通)</span>`);
                    currentMoveStyle = 'normal';
                } else {
                    playerMove = { ...playerMove };
                    playerMove.priority = originalPriority + 1;
                    playerMove.styleUsed = 'agile';
                    
                    const oldAcc = (typeof originalAccuracy === 'number') ? originalAccuracy : 100;
                    
                    if (haveSpeedAdvantage) {
                        // 场景 A: 拥有速度优势 - 买保险求稳，防先制
                        playerMove.basePower = Math.floor(originalPower * 0.75);
                        playerMove.accuracy = Math.floor(oldAcc * 0.9); // 命中率 0.9x
                        log(`<span style="color:#3b82f6">⚡ 迅疾·制变：速度压制下确保先手 - 威力×0.75，命中×0.9</span>`);
                        console.log(`[STYLES] 迅疾(快): power 0.75x, acc 0.9x (${mySpe} vs ${enemySpe})`);
                    } else {
                        // 场景 B: 没有速度优势 - 绝地反击，偷回合
                        playerMove.basePower = Math.floor(originalPower * 0.50);
                        playerMove.accuracy = Math.floor(oldAcc * 0.85); // 命中率 0.85x
                        log(`<span style="color:#60a5fa">⚡ 迅疾·神速：逆转行动顺位 - 威力×0.50，命中×0.85</span>`);
                        console.log(`[STYLES] 迅疾(慢): power 0.5x, acc 0.85x (${mySpe} vs ${enemySpe})`);
                    }
                    playerMove.power = playerMove.basePower;
                    
                    // 【冷却 v3】基于熟练度的动态冷却
                    const proficiency = battle.trainerProficiency ?? 0;
                    const styleCooldown = getStyleCooldown(proficiency);
                    battle.playerStyleCooldown = styleCooldown;
                    if (styleCooldown > 0) {
                        console.log(`[STYLES v3] 进入休憩: ${styleCooldown}回合 (熟练度: ${proficiency})`);
                    } else {
                        console.log(`[STYLES v3] 气脉贯通，无需休憩 (熟练度: ${proficiency})`);
                    }
                }
            } 
            // ============================================
            // 💪 刚猛风格 (Strong Style) - 普通模式
            // ============================================
            else if (currentMoveStyle === 'strong') {
                playerMove = { ...playerMove };
                playerMove.priority = originalPriority - 1;
                playerMove.basePower = Math.floor(originalPower * 1.30);
                playerMove.power = playerMove.basePower;
                playerMove.breaksProtect = true; // 可穿透守住
                playerMove.styleUsed = 'strong';
                
                if (!haveSpeedAdvantage) {
                    // 场景 A: 速度劣势 (本来就慢) - 没付出代价，降命中
                    const oldAcc = (typeof originalAccuracy === 'number') ? originalAccuracy : 100;
                    playerMove.accuracy = Math.floor(oldAcc * 0.8);
                    log(`<span style="color:#ef4444">💪 刚猛·舍身：速度劣势下的强攻 - 威力×1.3，命中×0.8</span>`);
                    console.log(`[STYLES] 刚猛(慢): power 1.3x, acc 0.8x (${mySpe} vs ${enemySpe})`);
                } else {
                    // 场景 B: 速度优势 (本来该我先) - 卖先手换伤害，不修正命中
                    // 【v2.3】不再必中，保持原命中率
                    log(`<span style="color:#b91c1c">💪 刚猛·蓄力：放弃先手，全力一击！(威力×1.3，贯穿守住)</span>`);
                    console.log(`[STYLES] 刚猛(快): power 1.3x, acc unchanged (${mySpe} vs ${enemySpe})`);
                }
                
                // 【冷却 v3】基于熟练度的动态冷却
                const proficiency = battle.trainerProficiency ?? 0;
                const styleCooldown = getStyleCooldown(proficiency);
                battle.playerStyleCooldown = styleCooldown;
                if (styleCooldown > 0) {
                    console.log(`[STYLES v3] 进入休憩: ${styleCooldown}回合 (熟练度: ${proficiency})`);
                } else {
                    console.log(`[STYLES v3] 气脉贯通，无需休憩 (熟练度: ${proficiency})`);
                }
            }
            // ============================================
            // 🎯 凝神风格 (Focus Style) - 必中模式
            // 绝对专注的心流状态，摒弃杂念的必然一击
            // 修正：招式获得【必中】效果，威力保持 x1.0
            // ============================================
            else if (currentMoveStyle === 'focus') {
                // 【平衡性改动】变化技禁止使用凝神
                if (isStatus) {
                    log(`<span style="color:#aaa">变化类招式无法使用凝神风格！(自动切换回普通)</span>`);
                    currentMoveStyle = 'normal';
                } else {
                    playerMove = { ...playerMove };
                    playerMove.styleUsed = 'focus';
                    
                    // 必中效果：设置 accuracy 为 true（必中标记）
                    playerMove.accuracy = true;
                    playerMove.bypassAccuracyCheck = true; // 额外标记，确保绕过命中检定
                    
                    log(`<span style="color:#a855f7">🎯 凝神·心眼：绝对专注，必然命中！</span>`);
                    console.log(`[STYLES] 凝神: 必中效果 (原命中: ${originalAccuracy})`);
                    
                    // 【冷却 v3】基于熟练度的动态冷却
                    const proficiency = battle.trainerProficiency ?? 0;
                    const styleCooldown = getStyleCooldown(proficiency);
                    battle.playerStyleCooldown = styleCooldown;
                    if (styleCooldown > 0) {
                        console.log(`[STYLES v3] 进入休憩: ${styleCooldown}回合 (熟练度: ${proficiency})`);
                    } else {
                        console.log(`[STYLES v3] 气脉贯通，无需休憩 (熟练度: ${proficiency})`);
                    }
                }
            }
        }
        
        // 使用后重置为普通风格
        window.currentMoveStyle = 'normal';
        if (typeof setMoveStyle === 'function') {
            setMoveStyle('normal');
        }
        // 刷新悬浮窗状态
        if (typeof window.refreshCommanderBubble === 'function') {
            window.refreshCommanderBubble();
        }
    }

    // === 【PP系统】扣减玩家招式 PP (target=e 用于 Pressure 判定) ===
    if (window.PPSystem && playerMove) {
        const ppResult = window.PPSystem.deductPP(p, playerMove, e);
        if (ppResult && ppResult.logs) ppResult.logs.forEach(msg => log(msg));
    }

    // === 回合开始：清除双方的 Protect 状态（新回合开始，守住失效）===
    if (p.volatile) p.volatile.protect = false;
    if (e.volatile) e.volatile.protect = false;

    // === Mega/Dynamax 进化处理 (回合开始时，出招前) ===
    // 玩家 Mega/Dynamax 进化 - 使用保存的状态（因为 showMainMenu 会重置 battle.playerMegaArmed）
    const canMegaEvolveFunc = window.canMegaEvolve;
    const performMegaEvolutionFunc = window.performMegaEvolution;
    
    // 检查是否是极巨化模式
    // 【修复】mechanic 字段是最高权威，如果 mechanic === 'mega'，则不应触发极巨化
    const isDynamaxMode = p && p.mechanic !== 'mega' && (p.canDynamax || (p.megaTargetId && p.megaTargetId.toLowerCase().includes('gmax')));
    
    if (megaArmedThisTurn && isDynamaxMode && !battle.playerMaxUsed && !p.isDynamaxed) {
        // === 极巨化处理 ===
        battle.playerMegaArmed = false;
        battle.playerMaxUsed = true;
        
        const oldName = p.cnName;
        const oldMaxHp = p.maxHp;
        const oldCurrHp = p.currHp;
        
        log(`<div style="border-bottom: 2px solid #e11d48; margin-bottom: 5px;"></div>`);
        log(`<b style="font-size:1.2em; color:#e11d48">▂▃▅▆▇ DYNAMAX !!! ▇▆▅▃▂</b>`);
        log(`${oldName} 的身体开始急剧膨胀！仿佛要冲破天际！`);
        
        await wait(600);
        
        // 播放极巨化爆发动画
        await playDynamaxAnimation(p, true);
        
        // 【修复】检查是否有 G-Max 形态，切换精灵图
        // 【关键】通用极巨化 (isGenericDynamax) 不切换图片，只用 CSS 放大
        const gmaxFormId = p.megaTargetId;
        if (gmaxFormId && gmaxFormId.includes('gmax') && !p.isGenericDynamax) {
            // 保存原始名称，用于回退
            p.originalName = p.name;
            
            // [BUG FIX] 格式转换：charizardgmax -> Charizard-Gmax
            const baseName = gmaxFormId.replace(/gmax$/i, '');
            const formattedName = baseName.charAt(0).toUpperCase() + baseName.slice(1) + '-Gmax';
            p.name = formattedName;
            
            // 【强制修正】G-Max 形态中文名：优先翻译，回退时强制加"超极巨"前缀
            if (window.Locale) {
                const translatedName = window.Locale.get(formattedName);
                // 检查是否成功翻译（翻译后不等于原名，且不等于基础形态名）
                const baseTranslated = window.Locale.get(baseName.charAt(0).toUpperCase() + baseName.slice(1));
                if (translatedName !== formattedName && translatedName !== baseTranslated) {
                    // 成功翻译到 G-Max 形态（如 "超极巨喷火龙"）
                    p.cnName = translatedName;
                } else {
                    // 翻译失败，强制添加"超极巨"前缀
                    p.cnName = '超极巨' + baseTranslated;
                }
            } else {
                p.cnName = formattedName;
            }
            
            // G-Max 精灵图格式: laprasgmax -> lapras-gmax (带横杠)
            const gmaxSpriteId = gmaxFormId.replace(/gmax$/i, '-gmax');
            const gmaxSpriteUrl = `https://play.pokemonshowdown.com/sprites/ani-back/${gmaxSpriteId}.gif`;
            smartLoadSprite('player-sprite', gmaxSpriteUrl, true);
            console.log(`[DYNAMAX] 切换玩家精灵图: ${gmaxSpriteUrl}`);
        } else if (p.isGenericDynamax) {
            console.log(`[DYNAMAX] 通用极巨化，保持原始精灵图: ${p.name}`);
        }
        
        // HP 倍率 x1.5
        const hpMultiplier = 1.5;
        p.maxHp = Math.floor(oldMaxHp * hpMultiplier);
        p.currHp = Math.floor(oldCurrHp * hpMultiplier);
        
        // 设置极巨化状态
        p.isDynamaxed = true;
        p.dynamaxTurns = 3; // 3 回合后变回
        p.preDynamaxMaxHp = oldMaxHp;
        p.preDynamaxCurrHp = oldCurrHp;
        // 玩家极巨化是在自己回合激活的，不需要 justActivated 标记
        // 因为激活后会立即行动，然后回合结束时正常 tick
        
        // 【关键】招式转换为极巨招式
        applyDynamaxState(p, true);
        
        // 【修复】重新获取当前回合的招式（因为招式列表已经被替换）
        playerMove = p.moves[moveIndex];
        
        log(`<b style="color:#e11d48">${oldName} 极巨化了！(HP x${hpMultiplier})</b>`);
        log(`<span style="color:#ff6b8a">[极巨化剩余回合: ${p.dynamaxTurns}]</span>`);
        
        updateAllVisuals('player');
        await wait(800);
        
        // 【Commander System V2】进化触发后刷新悬浮窗回到轮播
        if (typeof window.refreshCommanderBubble === 'function') {
            window.refreshCommanderBubble();
        }
        
    } else if (megaArmedThisTurn && canMegaEvolveFunc && canMegaEvolveFunc(p) && !battle.playerMegaUsed && p.mechanic !== 'tera') {
        // === 普通 Mega 进化处理 ===
        // 【修复】必须排除 mechanic='tera' 的宝可梦，避免与太晶化冲突
        battle.playerMegaArmed = false;
        battle.playerMegaUsed = true;
        
        const oldName = p.cnName;
        log(`<div style="border-bottom: 2px solid #c084fc; margin-bottom: 5px;"></div>`);
        log(`${oldName} 的进化石对 ${battle.playerName || '训练家'} 的钥石产生了反应！`);
        
        await wait(600);
        
        const megaResult = performMegaEvolutionFunc(p);
        
        if (megaResult) {
            await playMegaEvolutionAnimation(p, true);
            
            log(`<b style="color:#d8b4fe">${oldName} Mega 进化成了 ${megaResult.newName}！</b>`);
            
            if (megaResult.typeChanged) {
                log(`<span style="font-size:0.9em; color:#9ca3af;">${megaResult.newName} 变成了 ${megaResult.newTypes.join('/')} 属性！</span>`);
            }
            if (megaResult.abilityChanged && megaResult.newAbility) {
                log(`<span style="font-size:0.9em; color:#9ca3af;">获得了特性 <b>${megaResult.newAbility}</b>！</span>`);
                triggerEntryAbilities(p, e);
            }
        }
        updateAllVisuals('player');
        await wait(800);
        
        // 【Commander System V2】Mega进化触发后刷新悬浮窗回到轮播
        if (typeof window.refreshCommanderBubble === 'function') {
            window.refreshCommanderBubble();
        }
        
    } else if (megaArmedThisTurn && p.mechanic === 'tera' && p.canTera && !battle.playerTeraUsed && !p.isTerastallized) {
        // === 太晶化处理 ===
        battle.playerMegaArmed = false;
        battle.playerTeraUsed = true;
        
        const oldName = p.cnName;
        const oldTypes = [...p.types];
        const teraType = p.teraType;
        
        log(`<div style="border-bottom: 2px solid #22d3ee; margin-bottom: 5px;"></div>`);
        log(`<b style="font-size:1.2em; color:#22d3ee">💎 TERASTALLIZE !!! 💎</b>`);
        log(`${oldName} 的身体开始结晶化！闪耀着 ${teraType} 属性的光芒！`);
        
        await wait(600);
        
        // 播放太晶化动画
        const playerSprite = document.getElementById('player-sprite');
        if (playerSprite) {
            // 添加属性颜色类
            playerSprite.classList.add('tera-burst', `tera-type-${teraType.toLowerCase()}`);
            await wait(800);
            playerSprite.classList.remove('tera-burst');
            playerSprite.classList.add('state-terastal');
        }
        
        // 执行太晶化：属性变更
        p.isTerastallized = true;
        p.originalTypes = oldTypes; // 保存原始属性（用于 STAB 回溯）
        p.types = [teraType]; // 属性变为单一太晶属性
        
        // === 【Ambrosia 时空醉】标记下回合混乱 ===
        if (typeof window.WeatherEffects !== 'undefined' && window.WeatherEffects.checkNeuroBacklash) {
            const currentWeather = battle?.weather || '';
            const neuroResult = window.WeatherEffects.checkNeuroBacklash(currentWeather, 'terastal', p, null);
            if (neuroResult.shouldTrigger) {
                p.volatile = p.volatile || {};
                p.volatile.neuroBacklash = true;
                console.log(`[AMBROSIA] ⚡ 时空醉：${p.name} 太晶化后被标记，下回合将混乱`);
                log(neuroResult.message);
            }
        }
        
        log(`<b style="color:#22d3ee">${oldName} 太晶化了！</b>`);
        log(`<span style="color:#67e8f9">属性变化: ${oldTypes.join('/')} → <b>${teraType}</b></span>`);
        
        updateAllVisuals('player');
        await wait(800);
        
        // 【Commander System V2】太晶化触发后刷新悬浮窗回到轮播
        if (typeof window.refreshCommanderBubble === 'function') {
            window.refreshCommanderBubble();
        }
    }
    
    // =====================================================
    // === 玩家进化触发逻辑（装填模式）===
    // =====================================================
    if (evoArmedThisTurn && typeof window.triggerBattleEvolution === 'function') {
        await window.triggerBattleEvolution();
        // 进化后刷新悬浮窗
        if (typeof window.refreshCommanderBubble === 'function') {
            window.refreshCommanderBubble();
        }
    }
    
    // =====================================================
    // === 敌方 AI Mega/Dynamax/Tera 触发逻辑 ===
    // =====================================================
    // 【修复】三种机制独立计数，不再共用 enemyMegaUsed
    // 【解锁检查】必须检查 enemyUnlocks 配置
    const enemyUnlocks = battle.enemyUnlocks || {};
    
    const isEnemyDynamax = (e.mechanic === 'dynamax') ||
                           (e.evolutionType === 'dynamax') || 
                           (e.canDynamax && e.mechanic !== 'mega' && e.mechanic !== 'tera') || 
                           (e.megaTargetId && e.megaTargetId.includes('gmax') && e.mechanic !== 'mega');
    
    // 【解锁检查】Mega 需要 enable_mega，Dynamax 需要 enable_dynamax
    const canEnemyMega = enemyUnlocks.enable_mega && e.mechanic === 'mega' && (canMegaEvolveFunc && canMegaEvolveFunc(e));
    const canEnemyDynamax = enemyUnlocks.enable_dynamax && isEnemyDynamax && !e.isDynamaxed;
    
    // Mega 进化：检查 enemyMegaUsed
    // Dynamax：检查 enemyMaxUsed
    // Tera：检查 enemyTeraUsed（已在下方单独处理）
    
    const shouldTriggerMega = canEnemyMega && !battle.enemyMegaUsed;
    const shouldTriggerDynamax = canEnemyDynamax && !battle.enemyMaxUsed;
    
    // === 敌方极巨化处理 ===
    if (shouldTriggerDynamax) {
        battle.enemyMaxUsed = true;
        
        const oldEnemyName = e.cnName;
        const oldMaxHp = e.maxHp;
        const oldCurrHp = e.currHp;
        const trainerName = battle.trainer?.name || '对手';
        
        // 读取训练家特殊台词
        if (battle.trainer && battle.trainer.lines && battle.trainer.lines.gmax_trigger) {
            log(`<i>${trainerName}: "${battle.trainer.lines.gmax_trigger}"</i>`);
        }
        
        log(`<div style="border-bottom: 2px solid #e11d48; margin-bottom: 5px;"></div>`);
        log(`<b style="font-size:1.2em; color:#e11d48">▂▃▅▆▇ DYNAMAX !!! ▇▆▅▃▂</b>`);
        log(`${trainerName} 的 ${oldEnemyName} 开始急剧膨胀！空气在震动！`);
        
        await wait(600);
        
        // 保存原始名称，用于回退
        e.originalName = e.name;
        
        // 播放极巨化爆发动画 + 切换图片
        const spriteEl = document.getElementById('enemy-sprite');
        if (spriteEl) {
            spriteEl.classList.add('dynamax-burst');
            await wait(400);
            
            // 检查是否有 G-Max 形态（megaTargetId 包含 gmax）
            // 【关键】通用极巨化 (isGenericDynamax) 不切换图片，只用 CSS 放大
            const gmaxFormId = e.megaTargetId;
            if (gmaxFormId && gmaxFormId.includes('gmax') && !e.isGenericDynamax) {
                // [BUG FIX] 格式转换：charizardgmax -> Charizard-Gmax
                const baseName = gmaxFormId.replace(/gmax$/i, '');
                const formattedName = baseName.charAt(0).toUpperCase() + baseName.slice(1) + '-Gmax';
                e.name = formattedName;
                
                // 【强制修正】G-Max 形态中文名：优先翻译，回退时强制加"超极巨"前缀
                if (window.Locale) {
                    const translatedName = window.Locale.get(formattedName);
                    // 检查是否成功翻译（翻译后不等于原名，且不等于基础形态名）
                    const baseTranslated = window.Locale.get(baseName.charAt(0).toUpperCase() + baseName.slice(1));
                    if (translatedName !== formattedName && translatedName !== baseTranslated) {
                        // 成功翻译到 G-Max 形态（如 "超极巨喷火龙"）
                        e.cnName = translatedName;
                    } else {
                        // 翻译失败，强制添加"超极巨"前缀
                        e.cnName = '超极巨' + baseTranslated;
                    }
                } else {
                    e.cnName = formattedName;
                }
                
                const gmaxSpriteId = gmaxFormId.replace(/gmax$/i, '-gmax');
                const gmaxSpriteUrl = `https://play.pokemonshowdown.com/sprites/ani/${gmaxSpriteId}.gif`;
                smartLoadSprite('enemy-sprite', gmaxSpriteUrl, false);
            } else if (e.isGenericDynamax) {
                console.log(`[DYNAMAX] 敌方通用极巨化，保持原始精灵图: ${e.name}`);
            }
            // 否则保持原精灵图，只应用放大效果
            
            await wait(400);
            spriteEl.classList.remove('dynamax-burst');
            spriteEl.classList.add('state-dynamax');
        }
        
        // HP 倍率 x1.5
        const hpMultiplier = 1.5;
        e.maxHp = Math.floor(oldMaxHp * hpMultiplier);
        e.currHp = Math.floor(oldCurrHp * hpMultiplier);
        
        // 设置极巨化状态
        e.isDynamaxed = true;
        e.dynamaxTurns = 3;
        e.preDynamaxMaxHp = oldMaxHp;
        e.preDynamaxCurrHp = oldCurrHp;
        
        // 【关键】招式转换为极巨招式
        applyDynamaxState(e, true);
        
        log(`<b style="color:#e11d48">${oldEnemyName} 极巨化了！(HP x${hpMultiplier})</b>`);
        log(`<span style="color:#ff6b8a">[敌方极巨化剩余回合: ${e.dynamaxTurns}]</span>`);
        
        updateAllVisuals('enemy');
        await wait(800);
    }
    
    // === 敌方 Mega 进化处理 ===
    if (shouldTriggerMega) {
        battle.enemyMegaUsed = true;
        
        const oldEnemyName = e.cnName;
        const trainerName = battle.trainer?.name || '对手';
        
        log(`<div style="border-bottom: 2px solid #ef4444; margin-bottom: 5px;"></div>`);
        log(`对手的 ${oldEnemyName} 的进化石对 ${trainerName} 的钥石产生了反应！`);
        
        await wait(600);
        
        // 尝试执行 Mega 进化
        const megaResult = performMegaEvolutionFunc ? performMegaEvolutionFunc(e) : null;
        
        if (megaResult) {
            await playMegaEvolutionAnimation(e, false);
            
            log(`<b style="color:#fca5a5">对手的 ${oldEnemyName} Mega 进化成了 ${megaResult.newName}！</b>`);
            
            if (megaResult.typeChanged) {
                log(`<span style="font-size:0.9em; color:#9ca3af;">对手的 ${megaResult.newName} 变成了 ${megaResult.newTypes.join('/')} 属性！</span>`);
            }
            if (megaResult.abilityChanged && megaResult.newAbility) {
                log(`<span style="font-size:0.9em; color:#9ca3af;">获得了特性 <b>${megaResult.newAbility}</b>！</span>`);
                triggerEntryAbilities(e, p);
            }
        } else {
            // mechanic 设置为 mega 但没有实际 Mega 数据，跳过演出
            console.warn(`[MEGA] ${e.name} 设置了 mechanic: 'mega' 但没有 Mega 形态数据，跳过`);
            battle.enemyMegaUsed = false; // 回滚使用标记
        }
        updateAllVisuals('enemy');
        await wait(800);
    }
    
    // === 敌方 AI 太晶化处理 ===
    // 【解锁检查】Tera 需要 enable_tera
    if (enemyUnlocks.enable_tera && e.mechanic === 'tera' && e.canTera && !battle.enemyTeraUsed && !e.isTerastallized) {
        // AI 决策：第一回合立即太晶化
        battle.enemyTeraUsed = true;
        
        const oldEnemyName = e.cnName;
        const oldTypes = [...e.types];
        const teraType = e.teraType;
        const trainerName = battle.trainer?.name || '对手';
        
        log(`<div style="border-bottom: 2px solid #22d3ee; margin-bottom: 5px;"></div>`);
        log(`<b style="font-size:1.2em; color:#22d3ee">💎 TERASTALLIZE !!! 💎</b>`);
        log(`${trainerName} 的 ${oldEnemyName} 开始结晶化！闪耀着 ${teraType} 属性的光芒！`);
        
        await wait(600);
        
        // 播放太晶化动画
        const enemySprite = document.getElementById('enemy-sprite');
        if (enemySprite) {
            enemySprite.classList.add('tera-burst', `tera-type-${teraType.toLowerCase()}`);
            await wait(800);
            enemySprite.classList.remove('tera-burst');
            enemySprite.classList.add('state-terastal');
        }
        
        // 执行太晶化：属性变更
        e.isTerastallized = true;
        e.originalTypes = oldTypes;
        e.types = [teraType];
        
        // === 【Ambrosia 时空醉】标记下回合混乱 ===
        if (typeof window.WeatherEffects !== 'undefined' && window.WeatherEffects.checkNeuroBacklash) {
            const currentWeather = battle?.weather || '';
            const trainer = battle?.enemyTrainer || battle?.trainer;
            const neuroResult = window.WeatherEffects.checkNeuroBacklash(currentWeather, 'terastal', e, trainer);
            if (neuroResult.shouldTrigger) {
                e.volatile = e.volatile || {};
                e.volatile.neuroBacklash = true;
                console.log(`[AMBROSIA] ⚡ 时空醉：${e.name} 太晶化后被标记，下回合将混乱`);
                log(neuroResult.message);
            }
        }
        
        log(`<b style="color:#22d3ee">${trainerName} 的 ${oldEnemyName} 太晶化了！</b>`);
        log(`<span style="color:#67e8f9">属性变化: ${oldTypes.join('/')} → <b>${teraType}</b></span>`);
        
        updateAllVisuals('enemy');
        await wait(800);
    }

    // =====================================================
    // === 敌方 AI 羁绊共鸣 (Bond Resonance) 触发逻辑 ===
    // =====================================================
    // 【全局开关】EVO 系统关闭时不触发
    // 【解锁检查】Bond 需要 enable_bond
    // 【全局限制】每场战斗只能使用一次 Bond Resonance
    if (window.GAME_SETTINGS?.enableEVO !== false && enemyUnlocks.enable_bond && e.isAce && !battle.enemyBondUsed && !e.hasBondResonance && !e.hasEvolvedThisBattle) {
        // 检查是否满足触发条件
        const eHpRatio = e.currHp / e.maxHp;
        const eAvs = e.avs || { trust: 0, passion: 0, insight: 0, devotion: 0 };
        const eTotalAVs = (e.getEffectiveAVs?.('trust') || eAvs.trust || 0) + 
                         (e.getEffectiveAVs?.('passion') || eAvs.passion || 0) + 
                         (e.getEffectiveAVs?.('insight') || eAvs.insight || 0) + 
                         (e.getEffectiveAVs?.('devotion') || eAvs.devotion || 0);
        
        // 条件：Ace 宝可梦 + AVs >= 300
        const meetsAVsReq = eTotalAVs >= 300;
        
        // 【严格劣势判断】
        // 计算双方总血量
        let enemyTotalHp = 0, enemyTotalMaxHp = 0;
        let playerTotalHp = 0, playerTotalMaxHp = 0;
        battle.enemyParty.forEach(ep => {
            if (ep && typeof ep.isAlive === 'function') {
                enemyTotalMaxHp += ep.maxHp || 0;
                enemyTotalHp += Math.max(0, ep.currHp || 0);
            }
        });
        battle.playerParty.forEach(pp => {
            if (pp && typeof pp.isAlive === 'function') {
                playerTotalMaxHp += pp.maxHp || 0;
                playerTotalHp += Math.max(0, pp.currHp || 0);
            }
        });
        
        const aliveEnemies = battle.enemyParty.filter(ep => ep && typeof ep.isAlive === 'function' && ep.isAlive()).length;
        const alivePlayers = battle.playerParty.filter(pp => pp && typeof pp.isAlive === 'function' && pp.isAlive()).length;
        const isLastStand = aliveEnemies === 1;
        
        // 【严格劣势条件】
        // 核心条件：必须是最后一只宝可梦 且 HP <= 50%
        // 小规模战斗（双方各 <= 2 只）时，允许血量劣势触发
        const currentPokemonCritical = eHpRatio <= 0.50;
        const isSmallBattle = (battle.enemyParty.length <= 2 && battle.playerParty.length <= 2);
        const isHpDisadvantage = enemyTotalHp < playerTotalHp * 0.5;
        
        // 触发条件：
        // 1. 最后一只宝可梦 + HP <= 50%
        // 2. 或者 小规模战斗 + 血量劣势 + HP <= 50%
        const canTriggerBond = meetsAVsReq && currentPokemonCritical && (isLastStand || (isSmallBattle && isHpDisadvantage));
        
        if (canTriggerBond) {
            e.hasBondResonance = true;
            battle.enemyBondUsed = true; // 【全局限制】标记已使用
            const trainerName = battle.trainer?.name || '对手';
            
            log(`<div style="border-top: 2px solid #ef4444; border-bottom: 2px solid #ef4444; padding: 8px; text-align: center; margin: 10px 0; background: linear-gradient(90deg, rgba(239,68,68,0.1), rgba(239,68,68,0.3), rgba(239,68,68,0.1));">`);
            log(`<b style="font-size:1.4em; color:#ef4444; text-shadow: 0 0 10px #dc2626;">∞ BOND RESONANCE ∞</b>`);
            log(`</div>`);
            await wait(500);
            
            log(`${trainerName} 与 ${e.cnName} 的心跳完全重合了……`);
            await wait(400);
            log(`为了回应彻底的信赖 <span style="color:#facc15">(Total AVs: ${eTotalAVs})</span>，沉睡在体内的界限被打破了！`);
            
            // 动画：红色光晕爆发
            const enemySprite = document.getElementById('enemy-sprite');
            if (enemySprite) {
                enemySprite.classList.add('evo-burst');
                enemySprite.style.filter = 'brightness(3) drop-shadow(0 0 20px #ef4444)';
            }
            await wait(400);
            
            if (enemySprite) {
                enemySprite.classList.remove('evo-burst');
                enemySprite.classList.add('evo-finish');
                enemySprite.style.filter = 'drop-shadow(0 0 15px #ef4444) brightness(1.15) saturate(1.2)';
            }
            await wait(600);
            
            if (enemySprite) {
                enemySprite.classList.remove('evo-finish');
                enemySprite.classList.add('bond-resonance');
            }
            
            // 数据变更
            // 1. HP 回复 +60%
            const healAmount = Math.floor(e.maxHp * 0.6);
            e.currHp = Math.min(e.currHp + healAmount, e.maxHp);
            
            // 2. 清除异常
            e.status = null;
            
            // 3. 全能力+1
            if (typeof e.applyBoost === 'function') {
                e.applyBoost('atk', 1);
                e.applyBoost('def', 1);
                e.applyBoost('spa', 1);
                e.applyBoost('spd', 1);
                e.applyBoost('spe', 1);
            }
            
            log(`<b style="color:#ef4444">✦ ${trainerName} 的 ${e.cnName} 潜能被唤醒! 全属性极大幅提升!</b>`);
            log(`<span style="color:#60a5fa">✦ 气势(HP)大幅回复！(+${healAmount})</span>`);
            
            if (isLastStand) {
                log(`<span style="color:#f87171; font-style:italic;">「${trainerName}: 这是我们最后的反击！」</span>`);
            }
            
            updateAllVisuals('enemy');
            await wait(800);
        }
    }

    // === 获取敌方 AI 决策 (支持换人) ===
    let enemyMove = null;
    let enemyAction = null;
    let enemyWillSwitch = false;
    let switchTargetIndex = -1;
    
    // 优先使用新的 AI 引擎
    if (typeof window.getAiAction === 'function') {
        enemyAction = window.getAiAction(e, p, battle.aiDifficulty || 'normal', battle.enemyParty, {
            turnCount: battle.turnCount || 1
        });
    }
    
    // 检查 AI 是否决定换人
    if (enemyAction && enemyAction.type === 'switch' && typeof enemyAction.index === 'number') {
        const switchTarget = battle.enemyParty[enemyAction.index];
        // 严格检查：目标必须存在、存活、不是当前宝可梦、HP > 0
        const targetIsValid = switchTarget && 
            typeof switchTarget.isAlive === 'function' && 
            switchTarget.isAlive() && 
            switchTarget.currHp > 0 &&
            switchTarget !== e;
        
        // 【抓人机制】检查敌方是否被困住
        let enemyCanSwitch = true;
        if (typeof window.canEnemySwitch === 'function') {
            const switchCheck = window.canEnemySwitch();
            if (!switchCheck.canSwitch) {
                enemyCanSwitch = false;
                console.log(`[AI] Enemy cannot switch: ${switchCheck.reason}`);
            }
        }
        
        if (targetIsValid && enemyCanSwitch) {
            enemyWillSwitch = true;
            switchTargetIndex = enemyAction.index;
            if (enemyAction.reasoning) {
                console.log(`[AI] Switch reasoning: ${enemyAction.reasoning}`);
            }
        }
    }
    
    // 获取敌方攻击招式（如果不换人）
    if (!enemyWillSwitch) {
        if (enemyAction && enemyAction.move) {
            enemyMove = enemyAction.move;
            if (enemyAction.reasoning) {
                console.log(`[AI] Move reasoning: ${enemyAction.reasoning}`);
            }
        }
        
        // 回退到旧 AI
        if (!enemyMove && typeof window.getAiMove === 'function') {
            enemyMove = window.getAiMove(e, p, battle.aiDifficulty || 'normal');
        }
        if (!enemyMove) {
            enemyMove = e.moves[Math.floor(Math.random() * e.moves.length)];
        }
        
        // === 【PP系统】检查敌方选中招式是否有PP ===
        if (window.PPSystem && enemyMove && enemyMove.pp !== undefined && enemyMove.pp <= 0) {
            console.log(`[AI PP] ${e.cnName} 的 ${enemyMove.cn || enemyMove.name} PP耗尽，重新选招`);
            const ppAvailable = e.moves.filter(m => m.pp === undefined || m.pp > 0);
            if (ppAvailable.length > 0) {
                enemyMove = ppAvailable[Math.floor(Math.random() * ppAvailable.length)];
                console.log(`[AI PP] 改用: ${enemyMove.cn || enemyMove.name}`);
            } else {
                enemyMove = { name: 'Struggle', cn: '挣扎', power: 50, type: 'Normal', cat: 'phys' };
                log(`<span style="color:#aaa">${e.cnName} 所有招式PP耗尽，只能挣扎!</span>`);
            }
        }
        
        // === 【修复】检查 Taunt 等 Volatile 状态是否阻止 AI 使用该技能 ===
        if (typeof MoveEffects !== 'undefined' && MoveEffects.canUseMove && enemyMove) {
            const canUseResult = MoveEffects.canUseMove(e, enemyMove);
            if (!canUseResult.canUse) {
                log(`<span style="color:#e74c3c">${canUseResult.reason}</span>`);
                // 尝试选择其他可用技能（同时过滤PP耗尽的招式）
                const availableMoves = e.moves.filter(m => {
                    const check = MoveEffects.canUseMove(e, m);
                    const hasPP = m.pp === undefined || m.pp > 0;
                    return check.canUse && hasPP;
                });
                if (availableMoves.length > 0) {
                    enemyMove = availableMoves[Math.floor(Math.random() * availableMoves.length)];
                    console.log(`[AI] Taunt 阻止了原技能，改用: ${enemyMove.name}`);
                } else {
                    // 没有可用技能，使用挣扎
                    enemyMove = { name: 'Struggle', cn: '挣扎', power: 50, type: 'Normal', cat: 'phys' };
                    log(`<span style="color:#aaa">${e.cnName} 无技可用，只能挣扎!</span>`);
                }
            }
        }
        
        // =====================================================
        // === 【AI Z 招式推导】 ===
        // =====================================================
        // 如果敌方配置了 mechanic='zmove' 且还没用过 Z 招式
        // 【解锁检查】Z 招式需要 enable_z_move
        // 优先寻找能触发专属 Z 的招式，否则尝试转换当前招式
        // 【Ultra Burst】日/月骡子使用 Z 招式时先触发 Ultra Burst
        const enemyUnlocksForZ = battle.enemyUnlocks || {};
        if (enemyUnlocksForZ.enable_z_move && e.mechanic === 'zmove' && !battle.enemyZUsed && enemyMove) {
            let zTarget = null;
            let zBaseMove = null;
            
            // 1. 优先检查是否有能触发专属 Z 的招式
            for (const move of e.moves) {
                const potentialZ = typeof getZMoveTarget === 'function' 
                    ? getZMoveTarget(move, e) 
                    : null;
                if (potentialZ && potentialZ.isExclusive) {
                    // 找到专属 Z 招式！
                    zTarget = potentialZ;
                    zBaseMove = move;
                    console.log(`[AI Z-MOVE] 找到专属 Z 招式: ${move.name} -> ${potentialZ.name}`);
                    break;
                }
            }
            
            // 2. 如果没有专属 Z，尝试用当前选中的招式转换
            if (!zTarget) {
                zTarget = typeof getZMoveTarget === 'function' 
                    ? getZMoveTarget(enemyMove, e) 
                    : null;
                zBaseMove = enemyMove;
            }
            
            if (zTarget) {
                // =========================================================
                // 【敌方 Ultra Burst】日/月骡子 → 究极奈克洛兹玛
                // =========================================================
                if (typeof canUltraBurst === 'function' && canUltraBurst(e)) {
                    const burstResult = executeUltraBurst(e);
                    if (burstResult.success) {
                        burstResult.logs.forEach(msg => log(msg));
                        updateAllVisuals('enemy');
                        await wait(800);
                        // 更新引用
                        e = battle.getEnemy();
                    }
                }
                
                console.log(`[AI Z-MOVE] 敌方 AI 推导 Z 招式: ${zBaseMove.name} -> ${zTarget.name} (威力: ${zTarget.power})`);
                // 创建 Z 招式对象
                enemyMove = {
                    name: zTarget.name,
                    type: zTarget.type || zBaseMove.type,
                    power: zTarget.power,
                    cat: zBaseMove.cat || 'phys',
                    accuracy: true, // Z 招式必中
                    isZ: true,
                    baseMove: zBaseMove.name // 保留原始招式名
                };
                
                // === 【Ambrosia 时空醉】标记下回合混乱 ===
                if (typeof window.WeatherEffects !== 'undefined' && window.WeatherEffects.checkNeuroBacklash) {
                    const currentWeather = battle?.weather || '';
                    const trainer = battle?.enemyTrainer || battle?.trainer;
                    const neuroResult = window.WeatherEffects.checkNeuroBacklash(currentWeather, 'zmove', e, trainer);
                    if (neuroResult.shouldTrigger) {
                        e.volatile = e.volatile || {};
                        e.volatile.neuroBacklash = true;
                        console.log(`[AMBROSIA] ⚡ 时空醉：${e.name} 使用Z招式后被标记，下回合将混乱`);
                        log(neuroResult.message);
                    }
                }
            }
        }
        
        // =====================================================
        // === 【AI 刚猛/迅疾风格 v2.1】 (enable_styles) ===
        // =====================================================
        // 动态调整：根据速度优势决定惩罚程度
        // 迅疾 (Agile): 速度快时0.75x(保先手)，速度慢时0.5x(抢节奏)
        // 刚猛 (Strong): 速度快时必中(卖先手)，速度慢时命中0.8x(白嫖)
        // 【平衡性改动】使用后进入 1 回合冷却
        const enemyUnlocksForStyles = battle.enemyUnlocks || {};
        if (enemyUnlocksForStyles.enable_styles && enemyMove && !enemyMove.isZ) {
            // 【Chronal Rift 洗翠无法】检查是否在时空裂隙中
            let isEnemyUnboundArts = false;
            let enemyUnboundModifier = null;
            if (typeof window.WeatherEffects !== 'undefined' && window.WeatherEffects.getUnboundArtsModifier) {
                const weather = battle?.weather || battle?.environmentWeather || '';
                // 预检查是否会使用风格
                const potentialStyle = (enemyAction && enemyAction.style) ? enemyAction.style : 'normal';
                if (potentialStyle !== 'normal') {
                    enemyUnboundModifier = window.WeatherEffects.getUnboundArtsModifier(weather, potentialStyle, e, p);
                    isEnemyUnboundArts = enemyUnboundModifier.active;
                }
            }
            
            // 【冷却检查】如果在冷却中且不是洗翠无法，AI 不使用风格
            if (battle.enemyStyleCooldown > 0 && !isEnemyUnboundArts) {
                console.log(`[AI STYLES] 敌方风格系统冷却中，本回合使用普通风格`);
            } else {
                const originalPower = enemyMove.basePower || enemyMove.power || 0;
                const originalPriority = enemyMove.priority || 0;
                const originalAccuracy = enemyMove.accuracy;
                const isStatus = (enemyMove.category === 'Status' || enemyMove.cat === 'status' || originalPower === 0);
                
                // 【v2.1】计算有效速度，判断速度优势
                let aiSpe = (typeof e.getStat === 'function') ? e.getStat('spe') : (e.spe || 100);
                let playerSpe = (typeof p.getStat === 'function') ? p.getStat('spe') : (p.spe || 100);
                // 麻痹减速
                if (e.status === 'par') aiSpe = Math.floor(aiSpe * 0.5);
                if (p.status === 'par') playerSpe = Math.floor(playerSpe * 0.5);
                
                // 戏法空间判定
                const isTrickRoom = battle.field && battle.field.trickRoom > 0;
                let aiHasSpeedAdvantage = false;
                if (isTrickRoom) {
                    aiHasSpeedAdvantage = aiSpe < playerSpe; // 空间下：慢就是快
                } else {
                    aiHasSpeedAdvantage = aiSpe > playerSpe; // 正常：快就是快
                }
                
                // 【v2.1】优先使用 AI 引擎返回的风格选择
                let aiStyle = 'normal';
                if (enemyAction && enemyAction.style) {
                    aiStyle = enemyAction.style;
                    console.log(`[AI STYLES] 使用 AI 引擎推荐的风格: ${aiStyle}`);
                }
                
                // ============================================
                // 【Chronal Rift 洗翠无法】时空裂隙中的古武规则
                // ============================================
                if (isEnemyUnboundArts && enemyUnboundModifier) {
                    enemyMove = { ...enemyMove };
                    enemyMove.styleUsed = aiStyle;
                    
                    if (aiStyle === 'agile') {
                        // 迅疾・瞬身模式：优先度+1，速度快无损/速度慢威力x0.9
                        enemyMove.priority = originalPriority + enemyUnboundModifier.priorityMod;
                        enemyMove.basePower = Math.floor(originalPower * enemyUnboundModifier.damageMultiplier);
                        enemyMove.power = enemyMove.basePower;
                        log(enemyUnboundModifier.message.replace('洗翠无法', '敌方洗翠无法'));
                        console.log(`[CHRONAL RIFT] 敌方洗翠无法・迅疾: priority +${enemyUnboundModifier.priorityMod}, power x${enemyUnboundModifier.damageMultiplier}`);
                    } else if (aiStyle === 'strong') {
                        // 刚猛・破坏神模式：伤害x1.5，命中x0.85，优先度-1
                        enemyMove.priority = originalPriority + enemyUnboundModifier.priorityMod;
                        enemyMove.basePower = Math.floor(originalPower * enemyUnboundModifier.damageMultiplier);
                        enemyMove.power = enemyMove.basePower;
                        enemyMove.breaksProtect = true;
                        const oldAcc = (typeof originalAccuracy === 'number') ? originalAccuracy : 100;
                        if (originalAccuracy !== true && oldAcc < 101) {
                            enemyMove.accuracy = Math.floor(oldAcc * enemyUnboundModifier.accuracyMultiplier);
                        }
                        log(enemyUnboundModifier.message.replace('洗翠无法', '敌方洗翠无法'));
                        console.log(`[CHRONAL RIFT] 敌方洗翠无法・刚猛: power x${enemyUnboundModifier.damageMultiplier}, acc x${enemyUnboundModifier.accuracyMultiplier}`);
                    }
                    // 洗翠无法无冷却
                }
                // ============================================
                // ⚡ AI 迅疾风格 (Agile Style) - 普通模式
                // ============================================
                else if (aiStyle === 'agile') {
                    // 【平衡性改动】变化技禁止使用迅疾
                    if (isStatus) {
                        console.log(`[AI STYLES] 变化技无法使用迅疾，改用普通风格`);
                    } else {
                        enemyMove = { ...enemyMove };
                        enemyMove.priority = originalPriority + 1;
                        enemyMove.styleUsed = 'agile';
                        
                        const oldAcc = (typeof originalAccuracy === 'number') ? originalAccuracy : 100;
                        
                        if (aiHasSpeedAdvantage) {
                            // 场景 A: 拥有速度优势 - 买保险求稳，防先制
                            enemyMove.basePower = Math.floor(originalPower * 0.75);
                            enemyMove.accuracy = Math.floor(oldAcc * 0.9); // 命中率 0.9x
                            log(`<span style="color:#3b82f6">⚡ 敌方迅疾·制变：速度压制下确保先手 - 威力×0.75，命中×0.9</span>`);
                            console.log(`[AI STYLES] 迅疾(快): power 0.75x, acc 0.9x (${aiSpe} vs ${playerSpe})`);
                        } else {
                            // 场景 B: 没有速度优势 - 绝地反击，偷回合
                            enemyMove.basePower = Math.floor(originalPower * 0.50);
                            enemyMove.accuracy = Math.floor(oldAcc * 0.85); // 命中率 0.85x
                            log(`<span style="color:#60a5fa">⚡ 敌方迅疾·神速：逆转行动顺位 - 威力×0.50，命中×0.85</span>`);
                            console.log(`[AI STYLES] 迅疾(慢): power 0.5x, acc 0.85x (${aiSpe} vs ${playerSpe})`);
                        }
                        enemyMove.power = enemyMove.basePower;
                        
                        // 【冷却 v3】基于敌方熟练度的动态冷却
                        const enemyProf = battle.enemyTrainerProficiency ?? 0;
                        battle.enemyStyleCooldown = getStyleCooldown(enemyProf);
                        console.log(`[AI STYLES v3] 进入休憩: ${battle.enemyStyleCooldown}回合 (敌方熟练度: ${enemyProf})`);
                    }
                } 
                // ============================================
                // 💪 AI 刚猛风格 (Strong Style) - 普通模式
                // ============================================
                else if (aiStyle === 'strong') {
                    enemyMove = { ...enemyMove };
                    enemyMove.priority = originalPriority - 1;
                    enemyMove.basePower = Math.floor(originalPower * 1.30);
                    enemyMove.power = enemyMove.basePower;
                    enemyMove.breaksProtect = true; // 可穿透守住
                    enemyMove.styleUsed = 'strong';
                    
                    if (!aiHasSpeedAdvantage) {
                        // 场景 A: 速度劣势 (本来就慢) - 没付出代价，降命中
                        const oldAcc = (typeof originalAccuracy === 'number') ? originalAccuracy : 100;
                        enemyMove.accuracy = Math.floor(oldAcc * 0.8);
                        log(`<span style="color:#ef4444">💪 敌方刚猛·舍身：速度劣势下的强攻 - 威力×1.3，命中×0.8</span>`);
                        console.log(`[AI STYLES] 刚猛(慢): power 1.3x, acc 0.8x (${aiSpe} vs ${playerSpe})`);
                    } else {
                        // 场景 B: 速度优势 (本来该AI先) - 卖先手换伤害，不修正命中
                        // 【v2.3】不再必中，保持原命中率
                        log(`<span style="color:#b91c1c">💪 敌方刚猛·蓄力：放弃先手，全力一击！(威力×1.3，贯穿守住)</span>`);
                        console.log(`[AI STYLES] 刚猛(快): power 1.3x, acc unchanged (${aiSpe} vs ${playerSpe})`);
                    }
                    
                    // 【冷却 v3】基于敌方熟练度的动态冷却
                    const enemyProf = battle.enemyTrainerProficiency ?? 0;
                    battle.enemyStyleCooldown = getStyleCooldown(enemyProf);
                    console.log(`[AI STYLES v3] 进入休憩: ${battle.enemyStyleCooldown}回合 (敌方熟练度: ${enemyProf})`);
                }
                // ============================================
                // 🎯 AI 凝神风格 (Focus Style) - 必中模式
                // ============================================
                else if (aiStyle === 'focus') {
                    // 【平衡性改动】变化技禁止使用凝神
                    if (isStatus) {
                        console.log(`[AI STYLES] 变化技无法使用凝神，改用普通风格`);
                    } else {
                        enemyMove = { ...enemyMove };
                        enemyMove.styleUsed = 'focus';
                        
                        // 必中效果：设置 accuracy 为 true（必中标记）
                        enemyMove.accuracy = true;
                        enemyMove.bypassAccuracyCheck = true;
                        
                        log(`<span style="color:#a855f7">🎯 敌方凝神·心眼：绝对专注，必然命中！</span>`);
                        console.log(`[AI STYLES] 凝神: 必中效果 (${enemyMove.name})`);
                        
                        // 【冷却 v3】基于敌方熟练度的动态冷却
                        const enemyProf = battle.enemyTrainerProficiency ?? 0;
                        battle.enemyStyleCooldown = getStyleCooldown(enemyProf);
                        console.log(`[AI STYLES v3] 进入休憩: ${battle.enemyStyleCooldown}回合 (敌方熟练度: ${enemyProf})`);
                    }
                }
            }
        }
    }

    // ========================================
    // 回合执行顺序（正确的宝可梦战斗流程）：
    // 1. 换人先执行（换人优先级最高，在攻击之前）
    // 2. 然后按速度/优先级执行攻击
    // ========================================
    
    // === 阶段 1：敌方换人（在玩家攻击之前） ===
    if (enemyWillSwitch) {
        log(`<span style="color:#ef4444">敌方收回了 ${e.cnName}！</span>`);
        
        // 【修复】清除 Choice 锁招状态（换人解除锁招）
        if (e.choiceLockedMove) {
            console.log(`[CHOICE] ${e.name} 换下，解除 ${e.choiceLockedMove} 锁定`);
            delete e.choiceLockedMove;
        }
        
        // 【剧毒计数器重置】换人时重置剧毒递增伤害（Gen5+ 官方机制）
        if (e.status === 'tox') {
            e.statusTurns = 0;
            console.log(`[TOX RESET] ${e.cnName} 换下，剧毒计数器重置`);
        }
        
        // 重置当前宝可梦能力等级
        if (typeof e.resetBoosts === 'function') {
            e.resetBoosts();
        }
        
        battle.enemyActive = switchTargetIndex;
        const newE = battle.getEnemy();
        log(`<span style="color:#ef4444">敌方派出了 ${newE.cnName}！</span>`);
        
        // 【标记换人】用于重复精灵图修复
        if (typeof window.markEnemySwitch === 'function') {
            window.markEnemySwitch();
        }
        
        // 检查进场变形
        const checkInitTransformFunc = typeof window.checkInitTransform === 'function' ? window.checkInitTransform : null;
        if (checkInitTransformFunc && newE.needsInitTransform) {
            const result = checkInitTransformFunc(newE);
            if (result) {
                log(`<span style="color:#ef4444">✦ 敌方 ${result.oldName} 变为 ${result.newName}！</span>`);
            }
        }
        
        updateAllVisuals('enemy');
        await wait(500);
        triggerEntryAbilities(newE, p);
        
        // === 结算敌方场地钉子伤害 ===
        if (typeof MoveEffects !== 'undefined' && MoveEffects.applyEntryHazards) {
            const hazardLogs = MoveEffects.applyEntryHazards(newE, false, battle);
            hazardLogs.forEach(msg => log(msg));
            if (hazardLogs.length > 0) updateAllVisuals();
        }
        
        // 更新敌方引用为新宝可梦
        e = newE;
    }
    
    // === 【PP系统】扣减敌方招式 PP (target=p 用于 Pressure 判定) ===
    if (window.PPSystem && enemyMove && !enemyWillSwitch) {
        const ppResult = window.PPSystem.deductPP(e, enemyMove, p);
        if (ppResult && ppResult.logs) ppResult.logs.forEach(msg => log(msg));
    }

    // === 阶段 2：执行攻击（按速度/优先级顺序） ===
    // 如果敌方换人了，它这回合不攻击，只有玩家攻击
    if (enemyWillSwitch) {
        console.log('[handleAttack] Enemy switched, player attacks only');
        // 玩家攻击换入的宝可梦
        const playerResult = await executePlayerTurn(p, e, playerMove);
        
        // 【BUG修复】检查玩家是否因反伤倒下（闪焰冲锋/勇鸟/疯狂伏特等）
        if (!p.isAlive()) {
            console.log('[handleAttack] Player fainted from recoil in enemySwitch branch');
            // 先检查是否双方同时倒下
            if (!e.isAlive()) {
                await handleEnemyFainted(e);
            }
            await handlePlayerFainted(p);
            return;
        }
        
        if (!e.isAlive()) {
            await handleEnemyFainted(e);
            return;
        }
        
        // 玩家使用了 pivot 技能，触发换人
        if (playerResult?.pivot && hasAliveSwitch(battle.playerParty, battle.playerActive)) {
            console.log('[handleAttack] Player pivot in enemySwitch branch, calling handlePlayerPivot...');
            // 【修复】存储 Shed Tail/Baton Pass 传递标记
            battle.pendingPassSub = playerResult.passSub || false;
            battle.pendingPassBoosts = playerResult.passBoosts || false;
            try {
                await handlePlayerPivot();
                console.log('[handleAttack] handlePlayerPivot Promise resolved successfully');
            } catch (err) {
                console.error('[handleAttack] handlePlayerPivot error:', err);
            }
            battle.pendingPassSub = false;
            battle.pendingPassBoosts = false;
        }
        
        // 回合末结算
        console.log('[handleAttack] Calling executeEndPhase...');
        const currentP = battle.getPlayer();
        const currentE = battle.getEnemy();
        await executeEndPhase(currentP, currentE);
        console.log('[handleAttack] executeEndPhase returned');
        return;
    }

    // === 阶段 2b：双方都攻击，按速度/优先级顺序 ===
    
    // =====================================================
    // === 【对冲系统】Phase 1: 杀意感知 (Insight Check) ===
    
    // =====================================================
    // === 【对冲系统】Phase 2: 对冲检测 (Clash Detection) ===
    // =====================================================
    // 检查是否满足对冲触发条件（后手对冲：只有速度慢的一方才能发起）
    let clashTriggered = false;
    let clashResult = null;
    
    if (typeof window.canTriggerClash === 'function' && window.GAME_SETTINGS?.enableClash !== false) {
        // 计算速度，判断谁是"低速方"
        let playerSpeed = (typeof p.getStat === 'function') ? p.getStat('spe') : (p.spe || 100);
        let enemySpeed = (typeof e.getStat === 'function') ? e.getStat('spe') : (e.spe || 100);
        
        // 麻痹减速
        if (p.status === 'par') playerSpeed = Math.floor(playerSpeed * 0.5);
        if (e.status === 'par') enemySpeed = Math.floor(enemySpeed * 0.5);
        
        // 戏法空间判定
        const isTrickRoom = battle.field && battle.field.trickRoom > 0;
        
        // 判断玩家是否是低速方（只有后手才能发起对冲）
        const playerIsSlower = isTrickRoom ? (playerSpeed > enemySpeed) : (playerSpeed < enemySpeed);
        
        // 速度比例检查：只要玩家后手就可以对冲
        const speedRatio = playerSpeed / enemySpeed;
        const meetsSpeedThreshold = speedRatio < 1.0; // 只要后手就可以对冲
        
        console.log(`[CLASH] 速度检测: 玩家${playerSpeed} vs 敌方${enemySpeed}, 比例=${Math.round(speedRatio * 100)}%, 后手=${playerIsSlower}, 满足阈值=${meetsSpeedThreshold}`);
        
        if (playerIsSlower && meetsSpeedThreshold) {
            const clashCheck = window.canTriggerClash(p, e, playerMove, enemyMove);
            console.log(`[CLASH] 对冲检测: ${clashCheck.canTrigger ? '可触发' : clashCheck.reason}`);
            
            if (clashCheck.canTrigger && typeof window.showClashOption === 'function') {
                // 【改进】如果 Insight 预警已触发，对冲必定可用；否则走熟练度概率
                let clashAvailable = false;
                if (battle.insightTriggeredThisTurn) {
                    console.log(`[CLASH] Insight 已触发，对冲必定可用`);
                    clashAvailable = true;
                } else {
                    // 没有 Insight 时，基于训练家熟练度概率判定
                    const proficiency = battle.trainerProficiency ?? 0;
                    const triggerRoll = window.rollClashTrigger ? window.rollClashTrigger(proficiency) : { success: true };
                    clashAvailable = triggerRoll.success;
                    if (!clashAvailable) {
                        console.log(`[CLASH] 触发失败，跳过对冲选项`);
                    }
                }
                // 重置标记
                battle.insightTriggeredThisTurn = false;
                
                if (!clashAvailable) {
                    // 触发失败，不显示对冲选项，继续正常回合
                } else {
                    // 显示对冲选项 UI
                    const clashChoice = await window.showClashOption(playerMove, enemyMove);
                    
                    if (clashChoice === 'clash' && typeof window.resolveClash === 'function') {
                        // === 【对冲系统】Phase 3: 对冲结算 ===
                        clashTriggered = true;
                        clashResult = window.resolveClash(playerMove, enemyMove, p, e, { applySpeedModifier: true });
                        
                        if (clashResult) {
                            console.log(`[CLASH] 对冲结果: ${clashResult.resultType}`);
                            
                            // 【修复】播放对冲音效
                            if (typeof window.playSFX === 'function') window.playSFX('CLASH');
                            
                            // 显示对冲动画和日志
                            log(`<div style="border: 2px solid #f59e0b; padding: 10px; margin: 10px 0; background: linear-gradient(90deg, rgba(245,158,11,0.1), rgba(245,158,11,0.2), rgba(245,158,11,0.1));">`);
                            clashResult.logs.forEach(msg => log(msg));
                            log(`</div>`);
                            
                            // 播放碰撞特效：双方精灵震动 + 中央爆炸圈
                            const battleStage = document.querySelector('.battle-stage');
                            if (battleStage) {
                                // 1. 双方精灵震动
                                const playerSprite = document.getElementById('player-sprite');
                                const enemySprite = document.getElementById('enemy-sprite');
                                if (playerSprite) {
                                    playerSprite.classList.add('clash-shake');
                                    setTimeout(() => playerSprite.classList.remove('clash-shake'), 500);
                                }
                                if (enemySprite) {
                                    enemySprite.classList.add('clash-shake');
                                    setTimeout(() => enemySprite.classList.remove('clash-shake'), 500);
                                }
                                
                                // 2. 中央爆炸圈
                                const impact = document.createElement('div');
                                impact.className = 'clash-impact';
                                battleStage.appendChild(impact);
                                setTimeout(() => impact.remove(), 800);
                            }
                            
                            await wait(1000);
                            
                            // 根据对冲结果应用伤害
                            // 【修正】玩家是后手发起对冲，敌方是先手被对冲
                            // 对冲后应保持原速度顺序：敌方（先手B）先攻击，玩家（后手A）后攻击
                            if (clashResult.damageMultiplierB > 0) {
                                // 敌方招式命中（先手，可能是削减后的）
                                const modifiedEnemyMove = { ...enemyMove };
                                modifiedEnemyMove.clashDamageMultiplier = clashResult.damageMultiplierB;
                                const enemyResult = await executeEnemyTurn(e, p, modifiedEnemyMove);
                                
                                if (!p.isAlive()) {
                                    if (!e.isAlive()) {
                                        await handleEnemyFainted(e);
                                    }
                                    await handlePlayerFainted(p);
                                    return;
                                }
                                
                                if (!e.isAlive()) {
                                    await handleEnemyFainted(e);
                                    return;
                                }
                            }
                            
                            if (clashResult.damageMultiplierA > 0) {
                                // 玩家招式命中（后手，可能是削减后的）
                                const modifiedPlayerMove = { ...playerMove };
                                modifiedPlayerMove.clashDamageMultiplier = clashResult.damageMultiplierA;
                                const playerResult = await executePlayerTurn(p, e, modifiedPlayerMove);
                                
                                // 【修复】检查玩家是否因反伤倒下（粗糙皮肤/铁刺等）
                                if (!p.isAlive()) {
                                    console.log('[CLASH] Player fainted from recoil damage after clash attack');
                                    if (!e.isAlive()) {
                                        await handleEnemyFainted(e);
                                    }
                                    await handlePlayerFainted(p);
                                    return;
                                }
                                
                                if (!e.isAlive()) {
                                    await handleEnemyFainted(e);
                                    return;
                                }
                            }
                            
                            // 对冲完成，跳过正常回合执行
                            const currentP = battle.getPlayer();
                            const currentE = battle.getEnemy();
                            await executeEndPhase(currentP, currentE);
                            return;
                        }
                    }
                }
            }
        }
    }
    
    // === 计算行动顺序 (Priority + Speed) ===
    // 注意：Gen7+ 规则，Mega 进化后速度立即生效
    const playerPriority = typeof window.getMovePriority === 'function' 
        ? window.getMovePriority(playerMove, p, e) : 0;
    const enemyPriority = typeof window.getMovePriority === 'function' 
        ? window.getMovePriority(enemyMove, e, p) : 0;
    
    let playerFirst = true;
    if (playerPriority !== enemyPriority) {
        // 优先级不同，高优先级先动
        playerFirst = playerPriority > enemyPriority;
        console.log(`[Speed Check] Priority differs: P(${playerMove?.name || playerMove?.cn}) prio=${playerPriority} vs E(${enemyMove?.name || enemyMove?.cn}) prio=${enemyPriority} => PlayerFirst? ${playerFirst}`);
    } else {
        // 优先级相同，比较速度
        let playerSpeed = p.getStat('spe');
        let enemySpeed = e.getStat('spe');
        
        // =========================================================
        // 场地状态对速度的影响
        // =========================================================
        
        // Tailwind (顺风): 速度翻倍
        if (battle.playerSide && battle.playerSide.tailwind > 0) {
            playerSpeed *= 2;
            console.log(`[Speed Check] Player has Tailwind! Speed doubled.`);
        }
        if (battle.enemySide && battle.enemySide.tailwind > 0) {
            enemySpeed *= 2;
            console.log(`[Speed Check] Enemy has Tailwind! Speed doubled.`);
        }
        
        console.log(`[Speed Check] ${p.cnName}(base spe=${p.spe}, effective=${playerSpeed}) vs ${e.cnName}(base spe=${e.spe}, effective=${enemySpeed})`);
        
        // Trick Room (戏法空间): 速度慢的先动
        const isTrickRoom = battle.field && battle.field.trickRoom > 0;
        
        // 【Stall 特性】同优先度内，有 stallFlag 的一方必定后手
        const playerStall = playerMove && playerMove.stallFlag;
        const enemyStall = enemyMove && enemyMove.stallFlag;
        if (playerStall && !enemyStall) {
            playerFirst = false;
            console.log(`[Speed Check] Player has Stall ability, moves last in same bracket`);
        } else if (enemyStall && !playerStall) {
            playerFirst = true;
            console.log(`[Speed Check] Enemy has Stall ability, moves last in same bracket`);
        } else if (playerSpeed !== enemySpeed) {
            if (isTrickRoom) {
                // 空间下：慢的先动
                playerFirst = playerSpeed < enemySpeed;
                console.log(`[Speed Check] TRICK ROOM active! Slower moves first. PlayerFirst? ${playerFirst}`);
            } else {
                // 正常：快的先动
                playerFirst = playerSpeed > enemySpeed;
            }
        } else {
            // 速度相同，随机决定
            playerFirst = Math.random() < 0.5;
            console.log(`[Speed Check] Same speed, random result: PlayerFirst? ${playerFirst}`);
        }
        console.log(`[Speed Check] Result: PlayerFirst? ${playerFirst}${isTrickRoom ? ' (Trick Room)' : ''}`);
    }

    // === 执行回合 ===
    // 正确的 Pivot 时序：先手攻击 -> 先手 Pivot 换人 -> 后手攻击打新怪 -> 后手 Pivot 换人
    
    if (playerFirst) {
        // ========== 玩家先动 ==========
        console.log('[handleAttack] Player moves first');
        
        // =====================================================
        // === 【对冲系统】敌方后手对冲检测 (在玩家攻击之前) ===
        // =====================================================
        let enemyClashTriggered = false;
        if (typeof window.aiDecideClash === 'function' && window.GAME_SETTINGS?.enableClash !== false) {
            let pSpeed = (typeof p.getStat === 'function') ? p.getStat('spe') : (p.spe || 100);
            let eSpeed = (typeof e.getStat === 'function') ? e.getStat('spe') : (e.spe || 100);
            if (p.status === 'par') pSpeed = Math.floor(pSpeed * 0.5);
            if (e.status === 'par') eSpeed = Math.floor(eSpeed * 0.5);
            
            const speedRatio = eSpeed / pSpeed;
            // 【修复】放宽敌方 AI 对冲阈值：只要敌方后手（速度比 < 1.0）就可以考虑对冲
            // 之前是 0.70 太严格，导致敌方几乎不会触发对冲
            const meetsSpeedThreshold = speedRatio < 1.0;
            
            console.log(`[AI CLASH PRE] 敌方速度检测: ${eSpeed} vs ${pSpeed}, 比例=${Math.round(speedRatio * 100)}%, 满足阈值=${meetsSpeedThreshold}`);
            
            if (meetsSpeedThreshold) {
                // =====================================================
                // 【Expert AI 见招拆招】AI 后手时重新决策最优招式
                // 只对 expert 难度生效，其他难度不改变招式
                // =====================================================
                let finalEnemyMove = enemyMove;
                // 【修复】Z招式/Max招式不应被见招拆招覆盖
                if (battle.aiDifficulty === 'expert' && typeof window.getHardAiMove === 'function' && !enemyMove.isZ && !enemyMove.isMax) {
                    // AI 知道玩家选了什么招式，重新计算最优对冲招式
                    const recalcMove = window.getHardAiMove(e, p, battle.enemyParty);
                    if (recalcMove && recalcMove.name !== enemyMove.name) {
                        // 【修复】检查敌方新招式是否能对冲玩家招式
                        // 参数顺序：(敌方, 玩家, 敌方招式, 玩家招式)
                        const newClashCheck = window.canTriggerClash(e, p, recalcMove, playerMove);
                        if (newClashCheck && newClashCheck.canTrigger) {
                            console.log(`[AI COUNTER] Expert AI 见招拆招: ${enemyMove.cn || enemyMove.name} → ${recalcMove.cn || recalcMove.name}`);
                            // 【修复】继承原招式的 Style 修正到新招式
                            if (enemyMove.styleUsed) {
                                const styleMod = enemyMove.styleUsed === 'strong' ? 1.30 : (enemyMove.styleUsed === 'agile' ? 0.50 : 1.0);
                                recalcMove.basePower = Math.floor((recalcMove.basePower || recalcMove.power || 0) * styleMod);
                                recalcMove.power = recalcMove.basePower;
                                recalcMove.styleUsed = enemyMove.styleUsed;
                                recalcMove.priority = enemyMove.priority;
                                console.log(`[AI COUNTER] 继承 Style 修正: ${enemyMove.styleUsed}, 威力 → ${recalcMove.basePower}`);
                            }
                            finalEnemyMove = recalcMove;
                            enemyMove = recalcMove; // 更新全局敌方招式
                        } else {
                            console.log(`[AI COUNTER] Expert AI 重算招式 ${recalcMove.cn || recalcMove.name} 无法对冲 (${newClashCheck?.reason})，保持原招式`);
                        }
                    }
                }
                
                const aiDecision = window.aiDecideClash(e, p, finalEnemyMove, playerMove);
                console.log(`[AI CLASH PRE] ${aiDecision.reason}`);
                
                if (aiDecision.shouldClash && typeof window.resolveClash === 'function') {
                    // 【修复】从 JSON 读取敌方训练家熟练度，如果未设置则默认 0
                    const enemyProficiency = battle.enemyTrainerProficiency ?? 0;
                    const enemyTriggerRoll = window.rollClashTrigger ? window.rollClashTrigger(enemyProficiency) : { success: true };
                    
                    if (!enemyTriggerRoll.success) {
                        console.log(`[AI CLASH PRE] 敌方触发失败，放弃对冲`);
                        // 触发失败，不进行对冲
                    } else {
                        enemyClashTriggered = true;
                    
                    // 敌方发起对冲，参数顺序：敌方招式 vs 玩家招式（使用可能被篡改的招式）
                    const clashResult = window.resolveClash(finalEnemyMove, playerMove, e, p);
                    
                    if (clashResult) {
                        console.log(`[AI CLASH PRE] 对冲结果: ${clashResult.resultType}`);
                        
                        // 【修复】播放对冲音效
                        if (typeof window.playSFX === 'function') window.playSFX('CLASH');
                        
                        // 【修复】统一使用 clashResult.logs 格式化日志
                        log(`<div style="border: 2px solid #f59e0b; padding: 10px; margin: 10px 0; background: linear-gradient(90deg, rgba(245,158,11,0.1), rgba(245,158,11,0.2), rgba(245,158,11,0.1));">`);
                        clashResult.logs.forEach(msg => log(msg));
                        log(`</div>`);
                        
                        // 播放碰撞特效：双方精灵震动 + 中央爆炸圈
                        const battleStage = document.querySelector('.battle-stage');
                        if (battleStage) {
                            const playerSprite = document.getElementById('player-sprite');
                            const enemySprite = document.getElementById('enemy-sprite');
                            if (playerSprite) {
                                playerSprite.classList.add('clash-shake');
                                setTimeout(() => playerSprite.classList.remove('clash-shake'), 500);
                            }
                            if (enemySprite) {
                                enemySprite.classList.add('clash-shake');
                                setTimeout(() => enemySprite.classList.remove('clash-shake'), 500);
                            }
                            const impact = document.createElement('div');
                            impact.className = 'clash-impact';
                            battleStage.appendChild(impact);
                            setTimeout(() => impact.remove(), 800);
                        }
                        
                        await wait(1000);
                        
                        // 根据对冲结果执行攻击（只有 damageMultiplier > 0 才执行）
                        // 玩家先动，所以玩家先攻击（如果有伤害）
                        if (clashResult.damageMultiplierB > 0) {
                            const modifiedPlayerMove = { ...playerMove };
                            modifiedPlayerMove.clashDamageMultiplier = clashResult.damageMultiplierB;
                            await executePlayerTurn(p, e, modifiedPlayerMove);
                            
                            // 【修复】检查玩家是否因反伤倒下（粗糙皮肤/铁刺等）
                            if (!p.isAlive()) {
                                console.log('[CLASH] Player fainted from recoil damage after clash attack');
                                // 先检查是否双方同时倒下
                                if (!e.isAlive()) {
                                    await handleEnemyFainted(e);
                                }
                                await handlePlayerFainted(p);
                                return;
                            }
                            
                            if (!e.isAlive()) {
                                await handleEnemyFainted(e);
                                return;
                            }
                        }
                        
                        // 敌方攻击（如果有伤害）
                        if (clashResult.damageMultiplierA > 0) {
                            const modifiedEnemyMove = { ...enemyMove };
                            modifiedEnemyMove.clashDamageMultiplier = clashResult.damageMultiplierA;
                            await executeEnemyTurn(e, p, modifiedEnemyMove);
                            
                            if (!p.isAlive()) {
                                await handlePlayerFainted(p);
                                return;
                            }
                        }
                        
                        // 对冲完成，执行回合末结算
                        const currentP = battle.getPlayer();
                        const currentE = battle.getEnemy();
                        await executeEndPhase(currentP, currentE);
                        return;
                    }
                    }
                }
            }
        }
        
        // === 正常执行玩家攻击（没有对冲时）===
        const playerResult = await executePlayerTurn(p, e, playerMove);
        
        // 【修复】Post-Move Check: 玩家使用自杀招式后立即处理倒下
        if (!p.isAlive()) {
            console.log('[handleAttack] Player fainted after self-KO move in player-first branch');
            await handlePlayerFainted(p);
            // 【修复】玩家自杀招式后倒下，仍需执行回合末结算（敌方极巨化 tick 等）
            const newP = battle.getPlayer();
            const currentE = battle.getEnemy();
            if (newP && newP.isAlive() && currentE && currentE.isAlive()) {
                await executeEndPhase(newP, currentE);
            }
            return;
        }
        
        // 【修复】U-turn/Volt Switch 时序：先处理 Pivot 换人，再处理敌方倒下
        // 正作逻辑：即使击杀对手，使用者也必须先换人
        if (playerResult?.pivot && hasAliveSwitch(battle.playerParty, battle.playerActive)) {
            const oldP = battle.getPlayer();
            const moveName = playerMove?.name || '';
            if (moveName === 'Volt Switch') {
                log(`${oldP.cnName} 伏特替换，迅速撤退了!`);
            } else if (moveName === 'Flip Turn') {
                log(`${oldP.cnName} 快速翻转，撤退了!`);
            } else {
                log(`${oldP.cnName} 打完后急速折返回来了!`);
            }
            // 【修复】存储 Shed Tail/Baton Pass 传递标记
            battle.pendingPassSub = playerResult.passSub || false;
            battle.pendingPassBoosts = playerResult.passBoosts || false;
            console.log('[handleAttack] Player pivot triggered, waiting for switch...');
            await handlePlayerPivot();
            p = battle.getPlayer();
            console.log('[handleAttack] Player pivot complete, new pokemon:', p?.cnName);
            battle.pendingPassSub = false;
            battle.pendingPassBoosts = false;
        } else if (playerResult?.pivot) {
            log(`<span style="color:#999">但是没有可以换入的宝可梦了!</span>`);
        }
        
        // 敌方倒下判定（在 pivot 换人之后）
        // 【关键修复】同时检查玩家是否也倒下（粗糙皮肤/铁刺等接触伤害导致双方同时倒下）
        if (!e.isAlive()) {
            // 先检查玩家是否也倒下
            if (!p.isAlive()) {
                console.log('[handleAttack] DOUBLE KO after player attack (Rough Skin/Iron Barbs)!');
                await handleEnemyFainted(e);
                await handlePlayerFainted(p);
                return;
            }
            
            await handleEnemyFainted(e);
            // 【修复】敌方倒下换人后，仍需执行回合末结算（G-Max DOT 等）
            const newE = battle.getEnemy();
            if (newE && newE.isAlive()) {
                await executeEndPhase(p, newE);
            }
            return;
        }
        
        // ========== 敌方后动（攻击新换入的宝可梦） ==========
        // 【修复】Pre-Move Check: 检查敌方自己是否还活着（临别礼物/大爆炸等自杀招式）
        if (!e.isAlive()) {
            console.log('[handleAttack] Enemy already fainted (self-KO move like Memento), skipping enemy turn');
            log(`<span style="color:#999">但是 ${e.cnName} 已经倒下了...</span>`);
            await handleEnemyFainted(e);
            return;
        }
        
        // 【关键修复】检查玩家是否被魔法镜反弹的强制换人效果影响
        // 当玩家使用吹飞/吼叫被魔法镜反弹时，玩家自己会被强制换人
        if (battle.playerForcedSwitch && p.isAlive() && hasAliveSwitch(battle.playerParty, battle.playerActive)) {
            console.log('[handleAttack] Player forced to switch by Magic Bounce reflection');
            battle.phase = 'force_switch';
            renderSwitchMenu(false);
            await new Promise((resolve) => {
                battle.forceSwitchResolve = resolve;
            });
            battle.playerForcedSwitch = false; // 重置标记
            p = battle.getPlayer();
            console.log('[handleAttack] Player Magic Bounce switch complete, new pokemon:', p?.cnName);
        }
        
        // 【关键修复】检查敌方是否已被玩家的强制换人技能（龙尾/巴投）换下
        // 如果敌方已被换人，原敌方不应再执行攻击（僵尸反击BUG修复）
        if (playerResult?.phaze) {
            console.log('[handleAttack] Enemy was phazed out by player, skipping enemy turn');
            // 敌方已被换人，更新引用并跳过敌方攻击，直接进入回合末结算
            e = battle.getEnemy();
            await executeEndPhase(p, e);
            return;
        }
        
        // 【节奏控制】先手动画结束后，等一会再开始后手
        await wait(600);
        
        // 【注意】对冲检测已移到玩家攻击之前，这里直接执行敌方攻击
        console.log('[handleAttack] Enemy turn starting, move:', enemyMove?.name || enemyMove?.cn);
        const enemyResult = await executeEnemyTurn(e, p, enemyMove);
        console.log('[handleAttack] Enemy turn complete');
        
        // 【修复】Post-Move Check: 敌方使用自杀招式后立即处理倒下
        // 【关键修复】同时检查玩家是否也倒下（反伤/粗糙皮肤等导致双方同时倒下）
        if (!e.isAlive()) {
            console.log('[handleAttack] Enemy fainted after self-KO move (Memento/Explosion/Recoil)');
            
            // 先检查玩家是否也倒下
            if (!p.isAlive()) {
                console.log('[handleAttack] DOUBLE KO: Both player and enemy fainted!');
                // 双方同时倒下：先处理敌方，再处理玩家换人
                await handleEnemyFainted(e);
                await handlePlayerFainted(p);
                return;
            }
            
            await handleEnemyFainted(e);
            return;
        }
        
        // 【修复】敌方 Pivot 也要先处理，再判定玩家倒下
        if (enemyResult?.pivot && hasAliveSwitch(battle.enemyParty, battle.enemyActive)) {
            const oldE = battle.getEnemy();
            const moveName = enemyMove?.name || '';
            if (moveName === 'Volt Switch') {
                log(`${oldE.cnName} 伏特替换，迅速撤退了!`);
            } else if (moveName === 'Flip Turn') {
                log(`${oldE.cnName} 快速翻转，撤退了!`);
            } else if (moveName === 'Baton Pass') {
                log(`${oldE.cnName} 使用接力棒撤退了!`);
            } else {
                log(`${oldE.cnName} 打完后急速折返回来了!`);
            }
            await handleEnemyPivot(enemyResult?.passBoosts || false);
            e = battle.getEnemy();
        }
        
        // 【新增】敌方使用强制换人技能 (Roar/Dragon Tail/Circle Throw) 后，玩家被迫换人
        if (enemyResult?.phaze && p.isAlive() && hasAliveSwitch(battle.playerParty, battle.playerActive)) {
            console.log('[handleAttack] Player forced to switch by phaze move');
            battle.phase = 'force_switch';
            renderSwitchMenu(false);
            // 等待玩家选择换人
            await new Promise((resolve) => {
                battle.forceSwitchResolve = resolve;
            });
            p = battle.getPlayer();
            console.log('[handleAttack] Player phaze switch complete, new pokemon:', p?.cnName);
        }
        
        if (!p.isAlive()) {
            await handlePlayerFainted(p);
            // 【修复】玩家先动分支中，敌方攻击后玩家倒下，仍需执行回合末结算（敌方极巨化 tick 等）
            const newP = battle.getPlayer();
            const currentE = battle.getEnemy();
            if (newP && newP.isAlive() && currentE && currentE.isAlive()) {
                await executeEndPhase(newP, currentE);
            }
            return;
        }
    } else {
        // ========== 敌方先动 ==========
        const enemyResult = await executeEnemyTurn(e, p, enemyMove);
        
        // 【修复】Post-Move Check: 敌方使用自杀招式后立即处理倒下
        // 【关键修复】同时检查玩家是否也倒下（反伤/粗糙皮肤等导致双方同时倒下）
        if (!e.isAlive()) {
            console.log('[handleAttack] Enemy fainted after self-KO move in enemy-first branch');
            
            // 先检查玩家是否也倒下
            if (!p.isAlive()) {
                console.log('[handleAttack] DOUBLE KO in enemy-first branch!');
                await handleEnemyFainted(e);
                await handlePlayerFainted(p);
                return;
            }
            
            await handleEnemyFainted(e);
            return;
        }
        
        // 【修复】敌方 Pivot 先处理，再判定玩家倒下
        if (enemyResult?.pivot && hasAliveSwitch(battle.enemyParty, battle.enemyActive)) {
            const oldE = battle.getEnemy();
            const moveName = enemyMove?.name || '';
            if (moveName === 'Volt Switch') {
                log(`${oldE.cnName} 伏特替换，迅速撤退了!`);
            } else if (moveName === 'Flip Turn') {
                log(`${oldE.cnName} 快速翻转，撤退了!`);
            } else if (moveName === 'Baton Pass') {
                log(`${oldE.cnName} 使用接力棒撤退了!`);
            } else {
                log(`${oldE.cnName} 打完后急速折返回来了!`);
            }
            await handleEnemyPivot(enemyResult?.passBoosts || false);
            e = battle.getEnemy();
        }
        
        // 【新增】敌方先动使用强制换人技能 (Roar/Dragon Tail/Circle Throw) 后，玩家被迫换人
        if (enemyResult?.phaze && p.isAlive() && hasAliveSwitch(battle.playerParty, battle.playerActive)) {
            console.log('[handleAttack] Player forced to switch by phaze move (enemy-first branch)');
            battle.phase = 'force_switch';
            renderSwitchMenu(false);
            // 等待玩家选择换人
            await new Promise((resolve) => {
                battle.forceSwitchResolve = resolve;
            });
            p = battle.getPlayer();
            console.log('[handleAttack] Player phaze switch complete, new pokemon:', p?.cnName);
        }
        
        if (!p.isAlive()) {
            await handlePlayerFainted(p);
            // 【修复】玩家倒下换人后，仍需执行回合末结算（敌方极巨化 tick 等）
            const newP = battle.getPlayer();
            const currentE = battle.getEnemy();
            if (newP && newP.isAlive() && currentE && currentE.isAlive()) {
                await executeEndPhase(newP, currentE);
            }
            return;
        }
        
        // 【节奏控制】先手动画结束后，等一会再开始后手
        await wait(600);
        
        // ========== 玩家后动（攻击新换入的宝可梦） ==========
        // 【修复】Pre-Move Check: 检查玩家自己是否还活着（临别礼物/大爆炸等自杀招式）
        if (!p.isAlive()) {
            console.log('[handleAttack] Player already fainted (self-KO move), skipping player turn');
            log(`<span style="color:#999">但是 ${p.cnName} 已经倒下了...</span>`);
            await handlePlayerFainted(p);
            // 【修复】玩家倒下换人后，仍需执行回合末结算
            const newP2 = battle.getPlayer();
            const currentE2 = battle.getEnemy();
            if (newP2 && newP2.isAlive() && currentE2 && currentE2.isAlive()) {
                await executeEndPhase(newP2, currentE2);
            }
            return;
        }
        
        // 【修复】Pre-Move Check: 检查目标是否还活着（敌方可能用了自杀招式）
        if (!e.isAlive()) {
            console.log('[handleAttack] Enemy already fainted before player turn, skipping to faint handling');
            log(`<span style="color:#999">但是没有目标了...</span>`);
            await handleEnemyFainted(e);
            return;
        }
        
        // 【修复】敌方先动后，玩家后动前再次检查 Taunt 等 Volatile 状态
        // 因为敌方可能在这回合使用了挑衅，阻止玩家使用变化技
        if (typeof MoveEffects !== 'undefined' && MoveEffects.canUseMove) {
            const canUseResult = MoveEffects.canUseMove(p, playerMove);
            if (!canUseResult.canUse) {
                log(`<span style="color:#e74c3c">${canUseResult.reason}</span>`);
                await wait(500);
                // 【BUG修复】不应直接跳过玩家行动，应尝试选择其他可用技能或使用挣扎
                const availableMoves = p.moves.filter(m => {
                    const check = MoveEffects.canUseMove(p, m);
                    return check.canUse;
                });
                if (availableMoves.length > 0) {
                    playerMove = availableMoves[0];
                    console.log(`[TAUNT REDIRECT] 玩家改用: ${playerMove.name}`);
                    log(`<span style="color:#f59e0b">${p.cnName} 改为使用 ${playerMove.cn || playerMove.name}!</span>`);
                } else {
                    // 没有可用技能，使用挣扎
                    playerMove = { name: 'Struggle', cn: '挣扎', power: 50, type: 'Normal', cat: 'phys', accuracy: true, flags: { contact: 1 } };
                    log(`<span style="color:#ef4444">${p.cnName} 无技可用，只能挣扎!</span>`);
                }
            }
        }
        
        const playerResult = await executePlayerTurn(p, e, playerMove);
        
        // 【修复】Post-Move Check: 玩家使用自杀招式后立即处理倒下
        if (!p.isAlive()) {
            console.log('[handleAttack] Player fainted after self-KO move in enemy-first branch');
            await handlePlayerFainted(p);
            // 【修复】玩家自杀招式后倒下，仍需执行回合末结算（敌方极巨化 tick 等）
            const newP = battle.getPlayer();
            const currentE = battle.getEnemy();
            if (newP && newP.isAlive() && currentE && currentE.isAlive()) {
                await executeEndPhase(newP, currentE);
            }
            return;
        }
        
        // 【修复】玩家 Pivot 先处理，再判定敌方倒下
        if (playerResult?.pivot && hasAliveSwitch(battle.playerParty, battle.playerActive)) {
            const oldP = battle.getPlayer();
            const moveName = playerMove?.name || '';
            if (moveName === 'Volt Switch') {
                log(`${oldP.cnName} 伏特替换，迅速撤退了!`);
            } else if (moveName === 'Flip Turn') {
                log(`${oldP.cnName} 快速翻转，撤退了!`);
            } else {
                log(`${oldP.cnName} 打完后急速折返回来了!`);
            }
            // 【修复】存储 Shed Tail/Baton Pass 传递标记
            battle.pendingPassSub = playerResult.passSub || false;
            battle.pendingPassBoosts = playerResult.passBoosts || false;
            await handlePlayerPivot();
            p = battle.getPlayer();
            battle.pendingPassSub = false;
            battle.pendingPassBoosts = false;
        } else if (playerResult?.pivot) {
            log(`<span style="color:#999">但是没有可以换入的宝可梦了!</span>`);
        }
        
        // 【关键修复】检查玩家是否被魔法镜反弹的强制换人效果影响（敌方先动分支）
        if (battle.playerForcedSwitch && p.isAlive() && hasAliveSwitch(battle.playerParty, battle.playerActive)) {
            console.log('[handleAttack] Player forced to switch by Magic Bounce reflection (enemy-first branch)');
            battle.phase = 'force_switch';
            renderSwitchMenu(false);
            await new Promise((resolve) => {
                battle.forceSwitchResolve = resolve;
            });
            battle.playerForcedSwitch = false; // 重置标记
            p = battle.getPlayer();
            console.log('[handleAttack] Player Magic Bounce switch complete, new pokemon:', p?.cnName);
        }
        
        // 【关键修复】同时检查玩家是否也倒下（粗糙皮肤/铁刺等接触伤害导致双方同时倒下）
        if (!e.isAlive()) {
            // 先检查玩家是否也倒下
            if (!p.isAlive()) {
                console.log('[handleAttack] DOUBLE KO after player attack in enemy-first branch!');
                await handleEnemyFainted(e);
                await handlePlayerFainted(p);
                return;
            }
            
            await handleEnemyFainted(e);
            // 【修复】敌方倒下换人后，仍需执行回合末结算（G-Max DOT 等）
            const newE = battle.getEnemy();
            if (newE && newE.isAlive()) {
                await executeEndPhase(p, newE);
            }
            return;
        }
    }

    // === 回合末结算 ===
    // 重新获取最新引用（pivot 换人后可能已变化）
    const currentP = battle.getPlayer();
    const currentE = battle.getEnemy();
    await executeEndPhase(currentP, currentE);
}

// ============================================
// 【已迁移】回合执行 -> battle/battle-turns.js
// ============================================

// ============================================
// 【已迁移】换人系统 -> battle/battle-switch.js
// ============================================

// 【已迁移】handleEnemyFainted -> battle/battle-switch.js
// 【已迁移】handlePlayerFainted -> battle/battle-switch.js
// 【已迁移】enemyTurn -> battle/battle-turns.js
// 【已迁移】triggerEntryAbilities -> battle/battle-switch.js

/**
 * 回合末结算
 */
async function executeEndPhase(p, e) {
    console.log('[executeEndPhase] Starting with:', p?.cnName, 'vs', e?.cnName);
    
    try {
        await wait(300);
        
        // 安全检查
        if (!p || !e) {
            console.warn('[executeEndPhase] Invalid pokemon reference:', { p, e });
            battle.locked = false;
            return;
        }
        
        if (typeof window.getEndTurnStatusLogs === 'function') {
        // 结算玩家的状态伤害（isPlayerPoke = true，AVs 效果生效）
        if (p.isAlive()) {
            const pLogs = window.getEndTurnStatusLogs(p, e, true);
            if (pLogs.length > 0) {
                pLogs.forEach(txt => {
                    // Devotion 治愈日志已经有样式，直接输出
                    if (txt.includes('Devotion')) {
                        log(txt);
                    } else {
                        log(`<span style="color:#d35400">${txt}</span>`);
                    }
                });
                updateAllVisuals();
                await wait(400);
                if (!p.isAlive()) {
                    await handlePlayerFainted(p);
                    return;
                }
            }
        }
        
        // 结算敌方的状态伤害（isPlayerPoke = false，AVs 效果不生效）
        if (e.isAlive()) {
            const eLogs = window.getEndTurnStatusLogs(e, p, false);
            if (eLogs.length > 0) {
                eLogs.forEach(txt => {
                    // Devotion 治愈日志已经有样式，直接输出
                    if (txt.includes('Devotion')) {
                        log(txt);
                    } else {
                        log(`<span style="color:#d35400">${txt}</span>`);
                    }
                });
                updateAllVisuals();
                await wait(400);
                if (!e.isAlive()) {
                    await handleEnemyFainted(e);
                    return;
                }
            }
        }
    }
    
    // =========================================================
    // G-Max 持续伤害效果 (Wildfire/Vine Lash/Cannonade/Volcalith)
    // =========================================================
    const applyGMaxDOT = async (pokemon, side, isPlayer) => {
        if (!pokemon || !pokemon.isAlive() || !side) return;
        const types = pokemon.types || [];
        const dotDamage = Math.max(1, Math.floor(pokemon.maxHp / 6));
        
        // G-Max Wildfire (火) - 非火属性受伤
        if (side.gmaxWildfire && side.gmaxWildfire.turns > 0) {
            if (!types.includes('Fire')) {
                pokemon.currHp = Math.max(0, pokemon.currHp - dotDamage);
                log(`<span style="color:#ef4444">🔥 ${pokemon.cnName} 被地狱灭焰灼烧！(-${dotDamage})</span>`);
                updateAllVisuals();
                await wait(300);
            }
            side.gmaxWildfire.turns--;
            if (side.gmaxWildfire.turns <= 0) {
                log(`<span style="color:#94a3b8">🔥 地狱灭焰消散了。</span>`);
                delete side.gmaxWildfire;
            }
        }
        
        // G-Max Vine Lash (草) - 非草属性受伤
        if (side.gmaxVineLash && side.gmaxVineLash.turns > 0) {
            if (!types.includes('Grass')) {
                pokemon.currHp = Math.max(0, pokemon.currHp - dotDamage);
                log(`<span style="color:#22c55e">🌿 ${pokemon.cnName} 被藤蔓缠绕！(-${dotDamage})</span>`);
                updateAllVisuals();
                await wait(300);
            }
            side.gmaxVineLash.turns--;
            if (side.gmaxVineLash.turns <= 0) {
                log(`<span style="color:#94a3b8">🌿 灰飞鞭灭消散了。</span>`);
                delete side.gmaxVineLash;
            }
        }
        
        // G-Max Cannonade (水) - 非水属性受伤
        if (side.gmaxCannonade && side.gmaxCannonade.turns > 0) {
            if (!types.includes('Water')) {
                pokemon.currHp = Math.max(0, pokemon.currHp - dotDamage);
                log(`<span style="color:#3b82f6">💧 ${pokemon.cnName} 被激流冲击！(-${dotDamage})</span>`);
                updateAllVisuals();
                await wait(300);
            }
            side.gmaxCannonade.turns--;
            if (side.gmaxCannonade.turns <= 0) {
                log(`<span style="color:#94a3b8">💧 水炮轰灭消散了。</span>`);
                delete side.gmaxCannonade;
            }
        }
        
        // G-Max Volcalith (岩) - 非岩属性受伤
        if (side.gmaxVolcalith && side.gmaxVolcalith.turns > 0) {
            if (!types.includes('Rock')) {
                pokemon.currHp = Math.max(0, pokemon.currHp - dotDamage);
                log(`<span style="color:#f97316">�ite ${pokemon.cnName} 被炽热岩石灼伤！(-${dotDamage})</span>`);
                updateAllVisuals();
                await wait(300);
            }
            side.gmaxVolcalith.turns--;
            if (side.gmaxVolcalith.turns <= 0) {
                log(`<span style="color:#94a3b8">🪨 炎石喷发消散了。</span>`);
                delete side.gmaxVolcalith;
            }
        }
        
        // 检查是否因 DOT 倒下
        if (!pokemon.isAlive()) {
            if (isPlayer) {
                await handlePlayerFainted(pokemon);
            } else {
                await handleEnemyFainted(pokemon);
            }
            return true; // 表示有宝可梦倒下
        }
        return false;
    };
    
    // 玩家场地的 G-Max DOT (敌方施加的效果作用于玩家)
    if (p && p.isAlive() && battle.playerSide) {
        const fainted = await applyGMaxDOT(p, battle.playerSide, true);
        if (fainted) return;
    }
    
    // 敌方场地的 G-Max DOT (玩家施加的效果作用于敌方)
    if (e && e.isAlive() && battle.enemySide) {
        const fainted = await applyGMaxDOT(e, battle.enemySide, false);
        if (fainted) return;
    }
    
    // 增加双方上场回合数（用于 Fake Out 等首回合限制技能）
    // 辅助函数：检查是否为守住类技能（数据驱动）
    const isProtectMove = (moveName) => {
        if (!moveName) return false;
        const moveId = moveName.toLowerCase().replace(/[^a-z0-9]/g, '');
        const moveData = (typeof MOVES !== 'undefined' && MOVES[moveId]) ? MOVES[moveId] : null;
        return moveData?.stallingMove || false;
    };
    
    if (p && p.isAlive()) {
        // 【修复】刚换上场的宝可梦（turnsOnField=0 且未使用招式）不递增回合数
        // 防止强制换人后 executeEndPhase 提前递增导致 Fake Out 失效
        if ((p.turnsOnField || 0) > 0 || p.lastMoveUsed) {
            p.turnsOnField = (p.turnsOnField || 0) + 1;
        }
        // 重置守住计数器（如果上回合没用守住类技能）
        if (!isProtectMove(p.lastMoveUsed)) {
            p.protectCounter = 0;
        }
        // === 【修复】递减 Volatile 状态计数器 (Taunt, Disable 等) ===
        if (typeof MoveEffects !== 'undefined' && MoveEffects.tickVolatileStatus) {
            const volatileLogs = MoveEffects.tickVolatileStatus(p);
            volatileLogs.forEach(txt => log(txt));
            // 【关键修复】检查灭亡之歌等效果是否导致玩家倒下
            if (!p.isAlive()) {
                updateAllVisuals();
                await handlePlayerFainted(p);
                return; // 玩家倒下，终止回合末结算
            }
        }
        // === 【新增】道具回合末效果 (剧毒宝珠、火焰宝珠、剩饭等) ===
        if (typeof MoveEffects !== 'undefined' && MoveEffects.processEndTurnItemEffects) {
            const itemLogs = MoveEffects.processEndTurnItemEffects(p);
            itemLogs.forEach(txt => log(txt));
            if (itemLogs.length > 0) updateAllVisuals();
        }
    }
    if (e && e.isAlive()) {
        // 【修复】刚换上场的宝可梦（turnsOnField=0 且未使用招式）不递增回合数
        if ((e.turnsOnField || 0) > 0 || e.lastMoveUsed) {
            e.turnsOnField = (e.turnsOnField || 0) + 1;
        }
        // 重置守住计数器（如果上回合没用守住类技能）
        if (!isProtectMove(e.lastMoveUsed)) {
            e.protectCounter = 0;
        }
        // === 【修复】递减 Volatile 状态计数器 (Taunt, Disable 等) ===
        if (typeof MoveEffects !== 'undefined' && MoveEffects.tickVolatileStatus) {
            const volatileLogs = MoveEffects.tickVolatileStatus(e);
            volatileLogs.forEach(txt => log(txt));
            // 【关键修复】检查灭亡之歌等效果是否导致敌方倒下
            if (!e.isAlive()) {
                updateAllVisuals();
                await handleEnemyFainted(e);
                return; // 敌方倒下，终止回合末结算
            }
        }
        // === 【新增】道具回合末效果 (剧毒宝珠、火焰宝珠、剩饭等) ===
        if (typeof MoveEffects !== 'undefined' && MoveEffects.processEndTurnItemEffects) {
            const itemLogs = MoveEffects.processEndTurnItemEffects(e);
            itemLogs.forEach(txt => log(txt));
            if (itemLogs.length > 0) updateAllVisuals();
        }
    }
    
    // =========================================================
    // 特性回合末效果 (Speed Boost, Slow Start 等)
    // =========================================================
    if (typeof AbilityHandlers !== 'undefined') {
        // 玩家特性回合末效果
        if (p && p.isAlive() && p.ability) {
            const pAbilityHandler = AbilityHandlers[p.ability];
            if (pAbilityHandler && pAbilityHandler.onEndTurn) {
                const abilityLogs = [];
                pAbilityHandler.onEndTurn(p, abilityLogs);
                abilityLogs.forEach(txt => log(txt));
                if (abilityLogs.length > 0) updateAllVisuals();
            }
        }
        // 敌方特性回合末效果
        if (e && e.isAlive() && e.ability) {
            const eAbilityHandler = AbilityHandlers[e.ability];
            if (eAbilityHandler && eAbilityHandler.onEndTurn) {
                const abilityLogs = [];
                eAbilityHandler.onEndTurn(e, abilityLogs);
                abilityLogs.forEach(txt => log(txt));
                if (abilityLogs.length > 0) updateAllVisuals();
            }
        }
    }
    
    // =========================================================
    // HP 阈值形态变化 (Zen Mode, Schooling, Power Construct 等)
    // =========================================================
    if (typeof window.checkHPThresholdTransform === 'function') {
        // 玩家 HP 阈值变身
        if (p && p.isAlive()) {
            const pFormResult = window.checkHPThresholdTransform(p);
            if (pFormResult && pFormResult.success) {
                const formName = pFormResult.newName || p.cnName;
                log(`<span style="color:#f59e0b">🔄 ${formName} 的形态发生了变化！</span>`);
                updateAllVisuals();
                await wait(500);
            }
        }
        // 敌方 HP 阈值变身
        if (e && e.isAlive()) {
            const eFormResult = window.checkHPThresholdTransform(e);
            if (eFormResult && eFormResult.success) {
                const formName = eFormResult.newName || e.cnName;
                log(`<span style="color:#f59e0b">🔄 ${formName} 的形态发生了变化！</span>`);
                updateAllVisuals();
                await wait(500);
            }
        }
    }
    
    // 【古武系统】风格冷却已移至 handleAttack 开始时递减，此处不再处理
    
    // =========================================================
    // 极巨化回合倒计时 (Dynamax Turn Tick) - 统一调用 dynamax.js
    // =========================================================
    // 玩家极巨化
    if (p && p.isAlive() && p.isDynamaxed && p.dynamaxTurns > 0) {
        const result = await processDynamaxEndTurn(p, true, log);
        result.logs.forEach(msg => log(msg));
        if (result.ended) {
            await endDynamaxAnimation(p, true);
            const originalSpriteUrl = p.getSprite(true);
            smartLoadSprite('player-sprite', originalSpriteUrl, true);
            updateAllVisuals();
            await wait(500);
        }
    }
    
    // 敌方极巨化
    if (e && e.isAlive() && e.isDynamaxed && e.dynamaxTurns > 0) {
        const result = await processDynamaxEndTurn(e, false, log);
        result.logs.forEach(msg => log(msg));
        if (result.ended) {
            await endDynamaxAnimation(e, false);
            const originalSpriteUrl = e.getSprite(false);
            smartLoadSprite('enemy-sprite', originalSpriteUrl, false);
            updateAllVisuals();
            await wait(500);
        }
    }
    
    // =========================================================
    // 场地状态倒计时 (Field Condition Tick)
    // =========================================================
    if (battle.tickFieldConditions) {
        const fieldLogs = battle.tickFieldConditions();
        if (fieldLogs && fieldLogs.length > 0) {
            for (const txt of fieldLogs) {
                log(`<span style="color:#a78bfa">${txt}</span>`);
            }
            await wait(300);
        }
    }
    
    // =========================================================
    // 【S区特效】Defog 清除迷雾效果倒计时 - 3回合后恢复
    // =========================================================
    if (battle.defogCleanse && battle.defogCleanse.turnsRemaining > 0) {
        battle.defogCleanse.turnsRemaining--;
        if (battle.defogCleanse.turnsRemaining <= 0) {
            // 恢复迷雾天气
            battle.weather = battle.defogCleanse.originalWeather || 'fog';
            battle.weatherTurns = 0; // 环境天气无限持续
            delete battle.defogCleanse;
            log(`<span style="color:#6b7280">🌫️ 暗影再次凝聚...迷雾重新笼罩了战场！</span>`);
            
            // 更新天气视觉效果
            if (typeof setWeatherVisuals === 'function') {
                setWeatherVisuals('fog');
            }
            await wait(500);
        } else {
            log(`<span style="color:#94a3b8">（迷雾将在 ${battle.defogCleanse.turnsRemaining} 回合后恢复...）</span>`);
        }
    }
    
    // 【战术指挥系统】回合结束时清理指令状态
    if (typeof clearCommandEffects === 'function') {
        clearCommandEffects();
    }
    
    battle.locked = false;
    console.log('[executeEndPhase] Complete, battle.locked = false');
    } catch (err) {
        console.error('[executeEndPhase] Error:', err);
        battle.locked = false;
    }
}

// 导出 executeEndPhase 供 battle-switch.js 调用
window.executeEndPhase = executeEndPhase;

// ============================================
// 【已迁移】伤害系统 -> battle/battle-damage.js
// ============================================

/**
 * ===========================================
 * Part C: Switch System (Manual & Forced)
 * ===========================================
 */
function checkPlayerDefeatOrForceSwitch() {
    // 【防止重复判定】如果已经判定过胜负，直接返回
    if (battle.battleEndDetermined) {
        console.log('[checkPlayerDefeatOrForceSwitch] 胜负已判定，跳过');
        return Promise.resolve('already_determined');
    }
    
    const battleEnd = battle.checkBattleEnd();
    
    if (battleEnd === 'loss') {
        battle.battleEndDetermined = true;
        log(" <b style='color:#e74c3c'>... 你输了.</b>");

        if (battle.trainer && battle.trainer.id !== 'wild' && battle.trainer.lines?.win) {
            log(`<i>${battle.trainer.name}: "${battle.trainer.lines.win}"</i>`);
        } else if (battle.scriptedResult === 'loss' && battle.trainer) {
            log(`<i>"正如我所预料的..." ${battle.trainer.name}轻声说道。</i>`);
        }

        setTimeout(() => battleEndSequence('loss'), 2000);
        return Promise.resolve('loss');
    } else if (battleEnd === 'win') {
        // 【同命双杀】可能在这里触发（玩家倒下但敌方也全灭，且同命者是敌方）
        battle.battleEndDetermined = true;
        log("🏆 <b style='color:#27ae60'>敌方全部战败！你赢了！</b>");
        const t = battle.trainer;
        if (t && t.id !== 'wild' && t.lines?.lose) {
            log(`<i>${t.name}: "${t.lines.lose}"</i>`);
        }
        setTimeout(() => battleEndSequence('win'), 2000);
        return Promise.resolve('win');
    }
    
    // 强制换人 - 返回 Promise 等待玩家选择
    battle.phase = 'force_switch';
    renderSwitchMenu(false);
    
    // 【关键修复】返回 Promise，等待玩家完成换人
    return new Promise((resolve) => {
        battle.forceSwitchResolve = resolve;
    });
}

// 渲染切换列表
function renderSwitchMenu(allowCancel = true) {
    if (battle.locked && battle.phase !== 'force_switch' && battle.phase !== 'pivot_switch') return;

    // 【抓人机制】检查是否被困住（强制换人和 Pivot 换人除外）
    if (allowCancel && battle.phase !== 'force_switch' && battle.phase !== 'pivot_switch') {
        if (typeof window.canPlayerSwitch === 'function') {
            const switchCheck = window.canPlayerSwitch();
            if (!switchCheck.canSwitch) {
                log(`<span style="color:#ef4444">${switchCheck.reason}</span>`);
                return;
            }
        }
    }

    const layer = document.getElementById('switch-menu-layer');

    layer.className = 'overlay-modal modern-layer';
    layer.classList.remove('hidden');
    layer.style.display = 'flex';
    layer.innerHTML = '';

    const container = document.createElement('div');
    container.className = 'switch-container-modern';

    const header = document.createElement('div');
    header.className = 'switch-header-modern';
    const actionColor = !allowCancel ? 'var(--primary-pink)' : 'var(--accent-blue)';
    header.innerHTML = `
        <div style="width:6px; height:40px; background:${actionColor}; border-radius:10px;"></div>
        <div>
            <h2>pokémon</h2>
            <div class="switch-header-subtitle">
                ${!allowCancel ? 'Choose a replacement (Must Switch)' : 'Select a partner to switch in'}
            </div>
        </div>
    `;

    const grid = document.createElement('div');
    grid.className = 'party-grid-modern';

    battle.playerParty.forEach((pm, idx) => {
        const card = document.createElement('div');
        const isCurrent = (idx === battle.playerActive);
        const isDead = (pm.currHp <= 0);
        const hpRatio = pm.maxHp ? (pm.currHp / pm.maxHp) : 0;

        card.className = 'party-card-modern';
        card.style.animationDelay = `${idx * 0.05}s`;

        if (isCurrent) card.classList.add('current');
        if (isDead) card.classList.add('dead');
        if (!allowCancel && isDead) card.classList.add('disabled');

        let hpColor = '#4fd1c5';
        if (hpRatio < 0.5) hpColor = '#fbc63e';
        if (hpRatio <= 0.2) hpColor = '#ff6b6b';

        // =========================================================
        // 数据驱动的 Sprite URL 生成
        // 使用 pokedex-data.js 中的 forme 字段判断形态类型
        // =========================================================
        const seedIdWithHyphen = pm.name.toLowerCase().replace(/[^a-z0-9-]/g, '');
        const seedIdCompact = pm.name.toLowerCase().replace(/[^a-z0-9]/g, '');
        
        // 从 pokedex-data.js 获取宝可梦数据
        const pokeData = (typeof POKEDEX !== 'undefined' && POKEDEX[seedIdCompact]) 
            ? POKEDEX[seedIdCompact] : null;
        const forme = pokeData?.forme || '';
        const baseSpecies = pokeData?.baseSpecies || '';
        
        // 基础形态 ID（用于 fallback）
        const baseId = baseSpecies ? baseSpecies.toLowerCase().replace(/[^a-z0-9]/g, '') : seedIdCompact;
        const fallbackId = typeof getFallbackSpriteId === 'function' 
            ? getFallbackSpriteId(pm.name) 
            : baseId;
        
        // =========================================================
        // 形态类型检测（数据驱动 + 名称检测双保险）
        // =========================================================
        const formeLower = forme.toLowerCase();
        
        // 地区形态：Alola, Galar, Hisui, Paldea
        const regionalForms = ['alola', 'galar', 'hisui', 'paldea'];
        const isRegionalForm = regionalForms.some(r => formeLower.includes(r)) ||
            regionalForms.some(r => seedIdWithHyphen.includes(`-${r}`));
        
        // Mega 形态
        const isMegaForm = formeLower.includes('mega') || seedIdWithHyphen.includes('-mega');
        
        // 原始回归形态
        const isPrimalForm = formeLower === 'primal' || seedIdWithHyphen.includes('-primal');
        
        // 王冠形态（Zacian/Zamazenta）
        const isCrownedForm = formeLower === 'crowned' || seedIdWithHyphen.includes('-crowned');
        
        // 究极形态（Necrozma）
        const isUltraForm = formeLower === 'ultra' || seedIdWithHyphen.includes('-ultra');
        
        // 特殊形态：Rotom, Necrozma 合体, Calyrex 骑乘, Darmanitan Zen 等
        const specialForms = ['wash', 'heat', 'mow', 'frost', 'fan', // Rotom
            'dusk-mane', 'dawn-wings', // Necrozma
            'ice', 'shadow', // Calyrex
            'zen', 'therian', 'origin', 'sky', 'attack', 'defense', 'speed', // 各种形态
            'combat', 'blaze', 'aqua']; // Tauros-Paldea
        const isOtherSpecialForm = specialForms.some(f => formeLower.includes(f)) ||
            specialForms.some(f => seedIdWithHyphen.includes(`-${f}`));
        
        // 帽子皮卡丘特殊处理（pokesprite icons 目录）
        const pikachuCapForms = ['original', 'hoenn', 'sinnoh', 'unova', 'kalos', 'alola', 'partner', 'world'];
        const isPikachuCap = baseSpecies === 'Pikachu' && pikachuCapForms.includes(formeLower);
        
        // Cosplay 皮卡丘
        const pikachuCosplayForms = ['cosplay', 'rock-star', 'belle', 'pop-star', 'phd', 'libre'];
        const isPikachuCosplay = baseSpecies === 'Pikachu' && pikachuCosplayForms.some(f => formeLower.includes(f));
        
        // 是否需要使用 pokesprite 图库
        const needsPokesprite = isRegionalForm || isMegaForm || isPrimalForm || isUltraForm || isOtherSpecialForm;
        
        // =========================================================
        // 生成 Sprite URL
        // =========================================================
        let imgSrc;
        
        if (isPikachuCap) {
            // 帽子皮卡丘使用 pokesprite icons 目录
            const capName = `pikachu-${formeLower}-cap`;
            imgSrc = `https://raw.githubusercontent.com/msikma/pokesprite/master/icons/pokemon/regular/${capName}.png`;
        } else if (isPikachuCosplay) {
            // Cosplay 皮卡丘
            imgSrc = `https://raw.githubusercontent.com/msikma/pokesprite/master/icons/pokemon/regular/${seedIdWithHyphen}.png`;
        } else if (isCrownedForm) {
            // Crowned 形态使用 pokesprite（zacian-crowned, zamazenta-crowned）
            imgSrc = `https://raw.githubusercontent.com/msikma/pokesprite/master/pokemon-gen8/regular/${seedIdWithHyphen}.png`;
        } else if (needsPokesprite) {
            // 其他特殊形态使用 pokesprite
            let pokespriteId = seedIdWithHyphen;
            
            // Mega X/Y 格式修正
            if (isMegaForm && !pokespriteId.includes('-mega')) {
                pokespriteId = pokespriteId.replace(/mega([xy])$/i, '-mega-$1');
                if (!pokespriteId.includes('-mega')) {
                    pokespriteId = pokespriteId.replace(/mega$/i, '-mega');
                }
            }
            
            // Primal 格式修正
            if (isPrimalForm && !pokespriteId.includes('-primal')) {
                pokespriteId = pokespriteId.replace(/primal$/i, '-primal');
            }
            
            // Necrozma 特殊形态格式修正 (pokesprite 使用简化格式)
            // necrozma-dusk-mane -> necrozma-dusk
            // necrozma-dawn-wings -> necrozma-dawn
            pokespriteId = pokespriteId.replace(/-dusk-mane$/, '-dusk');
            pokespriteId = pokespriteId.replace(/-dawn-wings$/, '-dawn');
            
            imgSrc = `https://raw.githubusercontent.com/msikma/pokesprite/master/pokemon-gen8/regular/${pokespriteId}.png`;
        } else {
            // 普通形态使用 Showdown sprites（不带横杠）
            imgSrc = `https://play.pokemonshowdown.com/sprites/gen5/${seedIdCompact}.png`;
        }
        
        const fallbackSrc = `https://play.pokemonshowdown.com/sprites/gen5/${fallbackId}.png`;

        card.innerHTML = `
            ${isCurrent ? '<div class="current-tag">ACTIVE</div>' : ''}
            <div class="card-icon-modern">
                <img class="${isMegaForm ? 'mega-icon' : ''}" src="${imgSrc}" onerror="if(this.src!=='${fallbackSrc}'){this.src='${fallbackSrc}'}else{this.style.display='none'}">
            </div>
            <div class="card-info-modern">
                <div class="card-top-row">
                    <span class="card-name">${pm.cnName}</span>
                    <span class="card-lv">Lv.<span style="color:#2d3436;margin-left:2px">${pm.level}</span></span>
                </div>
                <div class="card-hp-nums">
                    ${pm.currHp} <span style="color:#b2bec3;font-weight:400">/ ${pm.maxHp}</span>
                </div>
                <div class="modern-hp-track">
                    <div class="modern-hp-fill" style="width:${hpRatio * 100}%; background:${hpColor}"></div>
                </div>
            </div>
            ${isDead ? '<div class="status-tag">FANT</div>' : ''}
        `;

        if (!isDead && !isCurrent) {
            card.onclick = () => {
                console.log('[renderSwitchMenu] Card clicked, calling performSwitch with index:', idx);
                layer.classList.add('hidden');
                layer.style.display = '';
                layer.className = 'overlay-modal hidden';
                performSwitch(idx);
            };
        }

        grid.appendChild(card);
    });

    container.appendChild(header);
    container.appendChild(grid);

    if (allowCancel) {
        const footer = document.createElement('div');
        footer.className = 'switch-footer';
        footer.innerHTML = `
            <button class="btn-close-modern">
                <span class="key-hint">×</span> CANCEL
            </button>
        `;
        footer.querySelector('button').onclick = () => {
            layer.classList.add('hidden');
            layer.style.display = '';
            layer.className = 'overlay-modal hidden';
        };
        container.appendChild(footer);
    }

    layer.appendChild(container);

    if (allowCancel) {
        layer.onclick = (e) => {
            if (e.target === layer) {
                layer.classList.add('hidden');
                layer.style.display = '';
                layer.className = 'overlay-modal hidden';
            }
        };
    } else {
        layer.onclick = null;
    }
}

async function performSwitch(newIndex) {
    console.log('[performSwitch] Called with index:', newIndex);
    console.log('[performSwitch] battle.phase:', battle.phase);
    console.log('[performSwitch] battle.pivotResolve:', !!battle.pivotResolve);
    console.log('[performSwitch] battle.locked:', battle.locked);
    
    document.getElementById('switch-menu-layer').classList.add('hidden');

    const oldP = battle.getPlayer();
    // 【修复】强制换人包括：宝可梦倒下 或 被吹飞/吼叫等技能强制换人
    const isForced = !oldP.isAlive() || battle.phase === 'force_switch';
    const isPivot = battle.phase === 'pivot_switch';
    const newPoke = battle.playerParty[newIndex];
    console.log('[performSwitch] isPivot:', isPivot, 'isForced:', isForced, 'hasPivotResolve:', !!battle.pivotResolve);

    // 【修复】Baton Pass: 在 resetBoosts 之前保存能力变化和替身
    if (isPivot && battle.pendingPassBoosts) {
        battle._savedBoosts = oldP.boosts ? { ...oldP.boosts } : null;
        battle._savedSubstitute = (oldP.volatile && oldP.volatile.substitute) ? oldP.volatile.substitute : 0;
        console.log(`[BATON PASS] 保存 ${oldP.cnName} 的能力变化:`, battle._savedBoosts, '替身HP:', battle._savedSubstitute);
    }
    
    // 换下场的宝可梦重置能力等级
    if (oldP.isAlive()) {
        // 【修复】如果换下的宝可梦处于极巨化状态，恢复招式
        if (oldP.isDynamaxed) {
            console.log(`[SWITCH] Player ${oldP.name} was Dynamaxed, restoring moves`);
            applyDynamaxState(oldP, false);
        }
        oldP.resetBoosts();
        
        // 【特性钩子】触发退场特性 (Regenerator, Natural Cure, Zero to Hero 等)
        if (typeof AbilityHandlers !== 'undefined' && oldP.ability) {
            const handler = AbilityHandlers[oldP.ability];
            if (handler && handler.onSwitchOut) {
                handler.onSwitchOut(oldP);
                console.log(`[ABILITY] ${oldP.cnName} 触发退场特性: ${oldP.ability}`);
            }
        }
    }
    
    // 【哈欠修复】换人时清除哈欠状态（官方机制：换人可以躲避哈欠）
    if (oldP.volatile && oldP.volatile.yawn) {
        console.log(`[YAWN] ${oldP.cnName} 换下，清除哈欠状态`);
        delete oldP.volatile.yawn;
    }
    
    // 【吵闹修复】换人时清除吵闹状态（官方机制：使用者离场则吵闹结束）
    if (oldP.volatile && oldP.volatile.uproar) {
        console.log(`[UPROAR] ${oldP.cnName} 换下，吵闹状态结束`);
        delete oldP.volatile.uproar;
    }
    
    // 【Choice 锁招修复】换人时清除锁招状态（官方机制：换人解除锁招）
    if (oldP.choiceLockedMove) {
        console.log(`[CHOICE] ${oldP.cnName} 换下，解除 ${oldP.choiceLockedMove} 锁定`);
        delete oldP.choiceLockedMove;
    }
    
    // 【剧毒计数器重置】换人时重置剧毒递增伤害（Gen5+ 官方机制）
    if (oldP.status === 'tox') {
        oldP.statusTurns = 0;
        console.log(`[TOX RESET] ${oldP.cnName} 换下，剧毒计数器重置`);
    }

    // Pivot 换人使用不同的日志
    if (isPivot) {
        log(`${oldP.cnName} 撤回！${newPoke.cnName} 登场！`);
    } else {
        log(isForced 
            ? `去吧! ${newPoke.cnName}!` 
            : `回来吧 ${oldP.cnName}! ${newPoke.cnName}, 上!`);
    }
    
    // === 播放新上场宝可梦叫声 ===
    if (typeof window.playPokemonCry === 'function') {
        window.playPokemonCry(newPoke.name);
    }

    // === 触发入场特性 (威吓、天气等) ===
    // 注意：在设置 playerActive 之前先触发特性，避免撒菱击倒时索引错误
    triggerEntryAbilities(newPoke, battle.getEnemy());
    
    // === 结算场地钉子伤害 ===
    if (typeof MoveEffects !== 'undefined' && MoveEffects.applyEntryHazards) {
        const hazardLogs = MoveEffects.applyEntryHazards(newPoke, true, battle);
        hazardLogs.forEach(msg => log(msg));
        
        // 如果钉子伤害导致宝可梦倒下，需要强制换人
        if (newPoke.currHp <= 0) {
            log(`糟糕! ${newPoke.cnName} 被场地伤害击倒了!`);
            updateAllVisuals();
            // 【关键修复】等待强制换人完成
            await checkPlayerDefeatOrForceSwitch();
            return;
        }
    }
    
    // 只有在宝可梦存活的情况下才设置为当前活跃宝可梦
    battle.playerActive = newIndex;
    
    // 【Commander System V2】切换宝可梦后刷新悬浮窗（读取新宝可梦的配置）
    window.currentMoveStyle = 'normal'; // 重置风格
    if (typeof window.refreshCommanderBubble === 'function') {
        window.refreshCommanderBubble();
    }
    
    // === 羁绊共鸣状态恢复 ===
    // 如果换上场的宝可梦有羁绊共鸣标记，重新应用能力提升
    if (newPoke.hasBondResonance && typeof newPoke.applyBoost === 'function') {
        // 【平衡调整】共鸣态全能力 +1（原 +2）
        newPoke.applyBoost('atk', 1);
        newPoke.applyBoost('def', 1);
        newPoke.applyBoost('spa', 1);
        newPoke.applyBoost('spd', 1);
        newPoke.applyBoost('spe', 1);
        log(`<span style="color:#4ade80"><b>${newPoke.cnName} 的羁绊共鸣仍在延续，全属性维持提升!</b></span>`);
    }

    // Pivot 换人：resolve Promise 并返回，不触发敌方攻击
    if (isPivot) {
        console.log('[performSwitch] Pivot switch detected');
        
        // 【修复】Shed Tail: 将旧宝可梦的 shedTailSub 转移为新宝可梦的 substitute
        if (battle.pendingPassSub && oldP.volatile && oldP.volatile.shedTailSub) {
            const subHp = oldP.volatile.shedTailSub;
            delete oldP.volatile.shedTailSub;
            if (!newPoke.volatile) newPoke.volatile = {};
            newPoke.volatile.substitute = subHp;
            console.log(`[SHED TAIL] ${newPoke.cnName} 继承了替身! (HP: ${subHp})`);
            log(`<span style="color:#3498db">🛡️ ${newPoke.cnName} 继承了替身保护! (替身HP: ${subHp})</span>`);
        }
        
        // 【修复】Baton Pass: 传递能力变化和替身给新宝可梦
        if (battle.pendingPassBoosts) {
            // 传递能力变化（oldP 的 boosts 已在上面被 resetBoosts 重置，需要在 reset 前保存）
            // 注意：boosts 已经在 performSwitch 开头被 resetBoosts() 清零了
            // 所以需要在 resetBoosts 之前保存 —— 这里改为从 battle 暂存读取
            if (battle._savedBoosts) {
                // 【修复】只有存在非零能力变化时才传递和显示日志
                const hasNonZeroBoost = Object.values(battle._savedBoosts).some(v => v !== 0);
                if (hasNonZeroBoost) {
                    Object.keys(battle._savedBoosts).forEach(stat => {
                        if (newPoke.boosts) {
                            newPoke.boosts[stat] = Math.max(-6, Math.min(6, 
                                (newPoke.boosts[stat] || 0) + battle._savedBoosts[stat]));
                        }
                    });
                    console.log(`[BATON PASS] ${newPoke.cnName} 继承了能力变化:`, newPoke.boosts);
                    log(`<span style="color:#9b59b6">${newPoke.cnName} 继承了能力变化!</span>`);
                }
                delete battle._savedBoosts;
            }
            // 传递替身
            if (battle._savedSubstitute && battle._savedSubstitute > 0) {
                if (!newPoke.volatile) newPoke.volatile = {};
                newPoke.volatile.substitute = battle._savedSubstitute;
                console.log(`[BATON PASS] ${newPoke.cnName} 继承了替身! (HP: ${battle._savedSubstitute})`);
                log(`<span style="color:#3498db">🛡️ ${newPoke.cnName} 继承了替身! (替身HP: ${battle._savedSubstitute})</span>`);
                delete battle._savedSubstitute;
            }
        }
        
        battle.phase = 'battle';
        updateAllVisuals();
        battle.locked = false;
        if (battle.pivotResolve) {
            console.log('[performSwitch] Resolving pivot Promise');
            const resolve = battle.pivotResolve;
            battle.pivotResolve = null;
            battle.pivotSide = null;
            console.log('[performSwitch] Calling resolve()');
            resolve();
            console.log('[performSwitch] resolve() called');
        }
        console.log('[performSwitch] Pivot handling complete, returning');
        return;
    }

    battle.phase = 'battle';
    
    if (!isForced) {
        // 主动换人要挨打
        log("由于交换宝可梦，敌方发起了攻击！");
        battle.locked = true;
        await enemyTurn();
        
        // 【修复】敌方攻击结束后（包括被精神场地阻止的情况），显示招式菜单
        const currentP = battle.getPlayer();
        const currentE = battle.getEnemy();
        if (currentP && currentP.isAlive() && currentE && currentE.isAlive()) {
            updateAllVisuals();
            showMovesMenu();
        }
    } else {
        // 强制换人完成后，刷新界面并解锁
        updateAllVisuals();
        
        // 【双杀场景修复】如果敌方也刚换人（双杀场景），触发敌方入场特性
        if (battle.enemyJustSwitchedInDoubleKO) {
            const newP = battle.getPlayer();
            const currentE = battle.getEnemy();
            if (newP && newP.isAlive() && currentE && currentE.isAlive()) {
                // 触发敌方入场特性（如威吓等）
                if (typeof triggerEntryAbilities === 'function') {
                    triggerEntryAbilities(currentE, newP);
                }
            }
            // 清除标记
            battle.enemyJustSwitchedInDoubleKO = false;
        }
        
        battle.locked = false;
        
        // 【关键修复】resolve 强制换人 Promise，通知 handlePlayerFainted 换人已完成
        if (battle.forceSwitchResolve) {
            console.log('[performSwitch] Resolving forceSwitchResolve');
            const resolve = battle.forceSwitchResolve;
            battle.forceSwitchResolve = null;
            resolve('switched');
        }
    }
}

// 辅助 LOG
function log(msg) {
    const box = document.getElementById('log-box');

    let formatMsg = msg;
    formatMsg = formatMsg.replace(/(\d+)\s*(伤害)/g, '<span class="hl-dmg">$1</span> <span style="font-size:0.9em;color:#888">$2</span>');
    formatMsg = formatMsg.replace(/(效果拔群|效果绝佳!|Super Effective!)/gi, '<span class="hl-sup">效果绝佳</span>');
    formatMsg = formatMsg.replace(/(效果不好|收效甚微|Not Very Effective\.\.\.)/gi, '<span class="hl-res">效果不好</span>');
    formatMsg = formatMsg.replace(/(会心一击!|Critical Hit!)/gi, '<span class="hl-crit">CRITICAL HIT!!</span>');
    formatMsg = formatMsg.replace(/(倒下了|失去战斗能力)/gi, '<b style="color:#e11d48; text-decoration:underline; text-decoration-color:rgba(225,29,72,0.4)">$1</b>');

    const div = document.createElement('div');
    div.className = 'log-entry';
    div.innerHTML = formatMsg;
    box.appendChild(div);

    requestAnimationFrame(() => {
        box.scrollTop = box.scrollHeight;
    });
}

function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

// =========================================
// 【已迁移】菜单切换 -> ui/ui-menus.js
// 【已迁移】Mega/Dynamax 按钮控制 -> ui/ui-menus.js
// 【已迁移】进化动画 -> ui/ui-menus.js
// =========================================

// 逃跑功能
function tryRun() {
    if (battle.locked && battle.phase !== 'battle') return;

    const playerLabel = battle.playerName || '玩家';
    if (battle.trainer && battle.trainer.id !== 'wild') {
        log(`面对强敌，${playerLabel} 选择了战略性撤退！ (投降)`);
        const escapeLine = battle.trainer.lines?.escape || battle.trainer.lines?.win;
        if (escapeLine) {
            log(`<i>${battle.trainer.name}: "${escapeLine}"</i>`);
        }
    } else {
        log(`${playerLabel} 带着同伴成功逃离了战场！`);
    }

    battle.phase = 'ended';
    battle.locked = true;

    setTimeout(() => battleEndSequence('escape'), 600);
}

// =========================================================
// 【已迁移】捕获系统 -> systems/catch-system.js
// =========================================================

// 供 HTML inline handler 调用
// 注：部分函数已迁移到独立模块，通过模块自身导出到 window
window.initGame = initGame;
window.handleAttack = handleAttack;
window.renderSwitchMenu = renderSwitchMenu;
window.tryRun = tryRun;
window.log = log;
window.updateAllVisuals = updateAllVisuals;
window.executeEndPhase = executeEndPhase;
window.checkPlayerDefeatOrForceSwitch = checkPlayerDefeatOrForceSwitch;
window.performSwitch = performSwitch;
window.battleEndSequence = battleEndSequence;
window.showCommanderMenu = showCommanderMenu;
window.closeCommanderMenu = closeCommanderMenu;
window.updateCommanderButtons = updateCommanderButtons;
window.applyCommandEffect = applyCommandEffect;
window.clearCommandEffects = clearCommandEffects;

/* ===========================================
   新增功能：战斗结算与总结生成
=========================================== */
function battleEndSequence(result) {
    battle.phase = 'ended';
    battle.locked = true;
    
    // === BGM 处理 ===
    const isTrainer = battle.trainer && battle.trainer.id !== 'wild';
    
    // 胜利时播放胜利音乐 (win/caught)
    if (result === 'win' || result === 'caught') {
        if (typeof playVictoryBgm === 'function') {
            playVictoryBgm(isTrainer);
        }
    } else {
        // 失败/逃跑时停止BGM
        if (typeof stopBgm === 'function') {
            stopBgm(500);
        }
    }

    const analysis = generateBattleReport(result);

    const overlay = document.getElementById('result-overlay');
    const card = document.getElementById('res-card-bg');
    const titleEl = document.getElementById('res-title');
    const rankLetterEl = document.getElementById('res-grade-letter');
    const rankSubEl = document.getElementById('res-grade-sub');
    const statusEl = document.getElementById('col-status');
    const descEl = document.getElementById('col-desc');
    const reasonEl = document.getElementById('col-reason');
    const dotsEl = document.getElementById('res-party-viz');
    const clipEl = document.getElementById('res-clipboard-text');

    if (!overlay || !card) return;

    overlay.classList.remove('active');
    card.classList.remove('theme-win', 'theme-loss', 'theme-escape');

    const enemyName = analysis.enemyName || 'Opponent';
    let titleCopy = 'VICTORY';
    let statusCopy = `Victory vs. ${enemyName}`;
    let themeClass = 'theme-win';

    if (result === 'loss') {
        titleCopy = 'DEFEATED';
        statusCopy = `Overwhelmed by ${enemyName}`;
        themeClass = 'theme-loss';
    } else if (result === 'escape') {
        titleCopy = 'ESCAPED';
        statusCopy = `Retreated from ${enemyName}`;
        themeClass = 'theme-escape';
    } else if (result === 'caught') {
        titleCopy = 'CAPTURED';
        statusCopy = `Captured ${enemyName}`;
        themeClass = 'theme-win';
    }

    card.classList.add(themeClass);
    if (titleEl) titleEl.textContent = titleCopy;
    if (statusEl) statusEl.textContent = statusCopy;

    const rankMatch = typeof analysis.rank === 'string'
        ? analysis.rank.match(/^([A-Z][A-Z\+\-]*)\s*(?:\((.+)\))?/i)
        : null;

    const rankLetter = rankMatch ? rankMatch[1] : analysis.rank || '?';
    const rankDescriptor = rankMatch && rankMatch[2] ? rankMatch[2] : 'RANK';

    if (rankLetterEl) rankLetterEl.textContent = rankLetter.toUpperCase();
    if (rankSubEl) rankSubEl.textContent = rankDescriptor;
    if (reasonEl) reasonEl.textContent = rankDescriptor;
    if (descEl) descEl.textContent = analysis.description || '暂无战况描述。';

    if (dotsEl) {
        dotsEl.innerHTML = '';
        battle.playerParty.forEach(p => {
            const dot = document.createElement('div');
            const ratio = p.maxHp > 0 ? p.currHp / p.maxHp : 0;
            let state = 'hp-low';
            if (p.currHp <= 0) state = 'hp-dead';
            else if (ratio > 0.6) state = 'hp-100';
            else if (ratio > 0.25) state = 'hp-mid';
            dot.className = `mini-dot ${state}`;
            dotsEl.appendChild(dot);
        });
    }

    if (clipEl) {
        clipEl.value = analysis.fullReport;
    }

    let endLine = '';
    const lines = battle.trainer?.lines || {};
    if (result === 'win') {
        endLine = lines.lose;
    } else if (result === 'escape') {
        endLine = lines.escape || lines.win || lines.lose || '';
    } else {
        // result === 'loss'
        endLine = lines.win;
    }

    if (battle.trainer && battle.trainer.id !== 'wild' && endLine) {
        setTimeout(() => playCutIn(endLine, 4500), 100);
    }

    overlay.classList.remove('hidden');
    void overlay.offsetWidth;
    overlay.classList.add('active');
}

function generateBattleReport(result) {
    const pParty = battle.playerParty;
    const eParty = battle.enemyParty;

    const pName = battle.playerName || "Player";
    const activeEnemy = typeof battle.getEnemy === 'function'
        ? battle.getEnemy()
        : (eParty[battle.enemyActive ?? 0] || eParty[0] || null);
    const fallbackEnemyName = activeEnemy?.cnName || activeEnemy?.name || "Wild Pokemon";

    let eName = fallbackEnemyName || "Enemy";
    if (battle.trainer) {
        if (battle.trainer.id !== 'wild') {
            eName = battle.trainer.name || battle.trainer.title || battle.trainer.id || fallbackEnemyName || "Enemy";
        } else {
            eName = battle.trainer.name?.trim()
                || fallbackEnemyName
                || (battle.trainer.title && battle.trainer.title.toLowerCase() !== 'wild' ? battle.trainer.title : '')
                || "Wild Pokemon";
        }
    }

    const survivors = pParty.filter(p => p.currHp > 0);
    const fallen = pParty.filter(p => p.currHp <= 0);
    const survivorTxt = survivors.length > 0
        ? survivors.map(p => `${p.cnName}(${Math.round((p.currHp / Math.max(1, p.maxHp)) * 100)}%)`).join(', ')
        : "濒死中撤走";

    const avgLevel = party => party.length
        ? party.reduce((sum, poke) => sum + (poke.level || poke.lv || 1), 0) / party.length
        : 0;

    let pTotalHpPct = 0;
    pParty.forEach(p => pTotalHpPct += (p.maxHp > 0 ? p.currHp / p.maxHp : 0));
    const pHpHealth = pParty.length > 0 ? Math.floor((pTotalHpPct / pParty.length) * 100) : 0;

    const eFallen = eParty.filter(p => p.currHp <= 0);
    let eTotalHpPct = 0;
    eParty.forEach(p => eTotalHpPct += (p.maxHp > 0 ? p.currHp / p.maxHp : 0));
    const eHpHealth = eParty.length > 0 ? Math.floor((eTotalHpPct / eParty.length) * 100) : 0;

    const avgPLv = avgLevel(pParty);
    const avgELv = avgLevel(eParty);
    const levelDiff = avgELv - avgPLv;

    const isTrainer = battle.trainer && battle.trainer.id !== 'wild';

    let rank = 'C';
    let desc = '';
    let resultTextDisplay = result === 'win' ? '【玩家胜利】' : '【玩家失败】';

    if (result === 'escape') {
        if (levelDiff > 30) {
            rank = 'B (战术撤退)';
            desc = '面对不可能战胜的量级差距，理智地选择保全队伍。活下去比什么都重要。';
        } else if (levelDiff > 10) {
            rank = 'C (谨慎回避)';
            desc = '意识到对手的难缠，在没有把握的情况下选择不硬碰硬。';
        } else if (survivors.length === 0) {
            rank = 'D (溃逃)';
            desc = '全线崩溃的边缘强行脱离战场。';
        } else {
            rank = 'D (脱离战场)';
            desc = isTrainer
                ? '面对训练家的挑战选择了回避（投降）。'
                : '成功从野生宝可梦面前脱身。';
        }
        resultTextDisplay = '【撤退 / 中断】';
} else if (result === 'caught') {
    rank = 'CAPTURE (捕获成功)';  // 把 GET 改为 CAPTURE 更具系统感，或者保留 GET 也行
    desc = '伴随着球体指示灯停止摇晃，中央发出了清脆的锁定音。目标捕捉完毕。'; 
    resultTextDisplay = '【收服确认】';
    
    if (eHpHealth > 70) {
        // 满血捕获：不再说是“奇迹”，强调“强运”或“一发入魂”
        desc += ' 竟然在未削减体力的状态下只有一球？绝佳的【Critical Capture】。';
    } else if (eHpHealth < 10) {
        // 红血捕获：不再说是“掌控”，强调“压制”和“精准”
        desc += ' 将体力压制到了极限的红色区域，教科书般精准的收服作业!';
    }

    } else if (result === 'win') {
        const deadCount = fallen.length;
        if (deadCount === 0) {
            if (pHpHealth >= 95) { rank = 'S+ (无伤)'; desc = '未受到实质性伤害的完美胜利。'; }
            else if (pHpHealth >= 80) { rank = 'S (完胜)'; desc = '掌控了节奏，毫无悬念的压倒性胜利。'; }
            else if (pHpHealth >= 60) { rank = 'A+ (轻取)'; desc = '虽有交锋，但始终占据着主导权。'; }
            else { rank = 'A (优胜)'; desc = '对手也有备而来，但还是技高一筹。'; }
        } else {
            const deadRatio = pParty.length > 0 ? deadCount / pParty.length : 1;
            if (deadRatio < 0.5) { rank = 'B (苦战)'; desc = '付出了同伴倒下的代价，才拿下的艰难胜利。'; }
            else if (deadRatio < 0.9) { rank = 'C (死斗)'; desc = '除了站到最后的英雄，其他同伴都已倒下……'; }
            else { rank = 'C- (绝境反杀)'; desc = '仅剩最后的一丝红血……奇迹般的极限翻盘。'; }
        }
    } else {
        if (eFallen.length === 0) {
            if (eHpHealth >= 90) { rank = 'F (碾压)'; desc = '毫无还手之力……那是次元级的战力差距。'; }
            else if (eHpHealth >= 70) { rank = 'E (完败)'; desc = '没能对敌人造成有效威胁，遗憾落败。'; }
            else if (eHpHealth >= 40) { rank = 'D (下风)'; desc = '虽然尽力反击，但仍被对方压制。'; }
            else if (eHpHealth >= 15) { rank = 'C (抗衡)'; desc = '有来有回的激战，只差一口气就能扭转局势。'; }
            else { rank = 'C+ (惜败)'; desc = '把对手逼入绝境！明明只差最后一下……'; }
        } else {
            const killRatio = eParty.length > 0 ? (eFallen.length / eParty.length) : 0;
            if (killRatio > 0.6) {
                rank = 'B- (毁天灭地)';
                desc = '双方都已拼尽全力，虽然输了，但这绝对是一场值得赢得尊重的战斗。';
            } else {
                rank = 'D+ (混战)';
                desc = '虽然重创了对手，但最终还是没能坚持到最后。';
            }
        }
    }

    const rows = [];
    let summaryLine;
    if (result === 'escape') {
        summaryLine = `- 综述：${pName} 在面对 ${eName} 时选择了【认输/投降】。`;
    } else if (result === 'caught') {
        summaryLine = `- 综述：${pName} 成功在野外收服了 ${eName}。`;
    } else {
        summaryLine = `- 综述：${pName} 对阵 ${eName}，${result === 'win' ? '获得胜利' : '遗憾落败'}。`;
    }
    rows.push(`- 交互结果：${resultTextDisplay}`);
    rows.push(`- 评级：${rank}`);
    rows.push(summaryLine);
    rows.push(`- 局势说明：${desc}`);

    if (result === 'win' && battle.trainer?.lines?.lose) {
        rows.push(`- 敌方败退台词："${battle.trainer.lines.lose}"`);
    } else if (result === 'escape' && battle.trainer?.lines?.escape) {
        rows.push(`- 敌方离场赠言："${battle.trainer.lines.escape}"`);
    } else if (result === 'loss' && battle.trainer?.lines?.win) {
        rows.push(`- 敌方胜利/嘲讽台词："${battle.trainer.lines.win}"`);
    }

    const formatEnemyName = poke => (poke?.cnName || poke?.name || '???');
    const enemyStatusLine = eParty.length > 0
        ? eParty.map((poke, idx) => {
            const pct = poke.maxHp > 0 ? Math.round((Math.max(0, poke.currHp) / poke.maxHp) * 100) : 0;
            const state = poke.currHp <= 0 ? '倒下' : `${pct}%`;
            const marker = idx === (battle.enemyActive ?? 0) ? '*' : '';
            return `${marker}${formatEnemyName(poke)}(${state})`;
        }).join(' / ')
        : '未知';

    rows.push(`- 我方带出战场：${survivorTxt}`);
    rows.push(`- 敌方状态：${enemyStatusLine}`);
    if (result !== 'escape' && fallen.length > 0) {
        rows.push(`- 濒死名单：${fallen.map(p => p.cnName).join(', ')}`);
    } else if (result === 'escape' && fallen.length > 0) {
        rows.push(`- 倒下需治疗：${fallen.map(p => p.cnName).join(', ')}`);
    }

    // =========================================================
    // 【成长建议系统】动漫风格等级建议
    // =========================================================
    let growthData = null;
    if (typeof window.calculateAnimeGrowth === 'function') {
        growthData = window.calculateAnimeGrowth({
            rank: rank,
            hpHealth: pHpHealth,
            levelDiff: levelDiff,
            resultLabel: resultTextDisplay
        }, result);
        
        if (typeof window.formatGrowthReport === 'function') {
            const growthRows = window.formatGrowthReport(growthData);
            growthRows.forEach(row => rows.push(row));
        }
    }

    return {
        rank,
        description: desc,
        playerName: pName,
        enemyName: eName,
        resultLabel: resultTextDisplay,
        summaryLine,
        fullReport: rows.join('\n'),
        fallenCount: fallen.length,
        survivorCount: survivors.length,
        hpHealth: pHpHealth,
        growth: growthData
    };
}

window.restartBattle = function() {
    document.getElementById('result-overlay').classList.add('hidden');
    const logBox = document.getElementById('log-box');
    if (logBox) {
        logBox.innerHTML = '';
    }
    battle = new BattleState();
    window.battle = battle;  // 【修复】同步更新全局引用
    
    // 停止当前 BGM (立即停止，不淡出)
    if (typeof stopBgm === 'function') {
        stopBgm(0);
    }
    
    log("=== 重置战斗 ===");
    initGame();
};

// =========================================================
// 【已迁移】日志清洗与复制系统 -> systems/log-filter.js
// copyResultOnly, copyFullProcess, extractBattleLog,
// copyToAndClose, endGameCleanup
// =========================================================

/**
 * =========================================================
 * BATTLE EVOLUTION SYSTEM V2 (临场进化系统)
 * =========================================================
 * 双轨设计：
 * 1. 生命进化 (Bio): 一二阶段危机时进化突破
 * 2. 灵魂共鸣 (Bond): 最终形态绝境爆发
 * =========================================================
 * 依赖: POKEDEX (data layer), calcStats (battle-engine.js)
 */

window.EvolutionSystem = {
    /**
     * 计算己方与敌方的总血量比，判断是否处于明显劣势
     * @returns {boolean}
     */
    checkDisadvantage: function() {
        if (!battle || !battle.playerParty || !battle.enemyParty) return false;
        
        // 计算己方总血量比
        let pTotalNow = 0, pTotalMax = 0;
        battle.playerParty.forEach(p => { 
            if (p && typeof p.currHp === 'number') {
                pTotalNow += Math.max(0, p.currHp); 
                pTotalMax += p.maxHp || 1;
            }
        });
        const playerRatio = pTotalNow / Math.max(1, pTotalMax);
        
        // 计算敌方总血量比
        let eTotalNow = 0, eTotalMax = 0;
        battle.enemyParty.forEach(e => { 
            if (e && typeof e.currHp === 'number') {
                eTotalNow += Math.max(0, e.currHp); 
                eTotalMax += e.maxHp || 1;
            }
        });
        const enemyRatio = eTotalNow / Math.max(1, eTotalMax);
        
        // 存活数量
        const alivePlayer = battle.playerParty.filter(p => p && typeof p.isAlive === 'function' && p.isAlive()).length;
        const aliveEnemy = battle.enemyParty.filter(e => e && typeof e.isAlive === 'function' && e.isAlive()).length;
        
        // 【极致收紧】真·绝境判定：
        // 1. 绝对最后一人 + 血量危机（Last Man Standing + HP Crisis）
        //    【修复】1v1 满血不应触发，必须同时满足"最后一只"且"血量 ≤ 40%"
        const isAbsoluteLastOne = (alivePlayer === 1) && (playerRatio <= 0.40);
        
        // 2. 全队濒死（全队总HP ≤ 10%，即使有多只存活也都是残血）
        const isNearWipeout = playerRatio <= 0.10;
        
        // 3. 己方只剩1只，敌方还有2只以上（真正的1vN劣势）
        //    这种情况不需要血量检查，因为数量劣势本身就是绝境
        const isOneVsMany = (alivePlayer === 1) && (aliveEnemy >= 2);
        
        return isAbsoluteLastOne || isNearWipeout || isOneVsMany;
    },

    /**
     * 检查当前活跃玩家精灵是否满足进化/共鸣条件
     * @param {Pokemon} pokemon - 要检查的宝可梦
     * @returns {Object|null} 进化信息或 null
     */
    checkEligibility: function(pokemon) {
        // 【全局开关】EVO 系统关闭时不触发
        if (window.GAME_SETTINGS && !window.GAME_SETTINGS.enableEVO) return null;
        
        // 基础检查
        if (!pokemon || pokemon.currHp <= 0) return null;
        if (pokemon.hasEvolvedThisBattle || pokemon.hasBondResonance) return null;

        // 计算 AVs 总和（使用有效值，考虑 enable_insight 解锁限制）
        const avs = pokemon.avs || { trust: 0, passion: 0, insight: 0, devotion: 0 };
        const totalAVs = (pokemon.getEffectiveAVs('trust') || 0) + 
                         (pokemon.getEffectiveAVs('passion') || 0) + 
                         (pokemon.getEffectiveAVs('insight') || 0) + 
                         (pokemon.getEffectiveAVs('devotion') || 0);

        const baseId = pokemon.name.toLowerCase().replace(/[^a-z0-9]/g, '');
        const data = typeof POKEDEX !== 'undefined' ? POKEDEX[baseId] : null;
        if (!data) return null;

        const hpRatio = pokemon.currHp / pokemon.maxHp;

        // ============================================
        // 路径 A: 生命进化 (Biological Evolution)
        // 适用：未完全进化的宝可梦，危机时突破
        // ============================================
        if (data.evos && data.evos.length > 0) {
            // 已 Mega 或已变身的不能再进化
            if (pokemon.isMega || pokemon.isTransformed) return null;
            
            const nextFormName = data.evos[0];
            const nextId = nextFormName.toLowerCase().replace(/[^a-z0-9]/g, '');
            const nextData = typeof POKEDEX !== 'undefined' ? POKEDEX[nextId] : null;
            if (!nextData) return null;

            // 【特殊进化检查】只有等级进化或亲密度进化才能触发战斗EVO
            // 道具进化(useItem)、交换进化(trade)、特殊条件进化等不触发
            // 例如：伊布需要道具进化，不应触发战斗EVO
            const allowedEvoTypes = [undefined, 'levelFriendship'];
            if (!allowedEvoTypes.includes(nextData.evoType)) return null;

            // 1. 等级锁 (允许越级3级)
            const reqLevel = Math.max(1, (nextData.evoLevel || 1) - 3);
            if (pokemon.level < reqLevel) return null;

            // 2. AVs 阈值：
            // 一阶(无prevo): 80
            // 二阶(有prevo): 160
            // 只有一次进化(有prevo但进化型无evos): 140
            const isFirstStage = !data.prevo;
            const nextHasEvos = nextData.evos && nextData.evos.length > 0;
            
            let reqAVs;
            if (isFirstStage) {
                reqAVs = 80;  // 一阶段
            } else if (!nextHasEvos) {
                reqAVs = 140; // 只有一次升级（二阶进化到最终形态）
            } else {
                reqAVs = 160; // 二阶段（还能继续进化）
            }
            if (totalAVs < reqAVs) return null;

            // 3. 危机锁 (HP 35% 以下) 或 Ace 宝可梦 60% 以下
            const isCrisis = hpRatio <= 0.45;
            const isAceMoment = pokemon.isAce && hpRatio <= 0.6;
            
            if (isCrisis || isAceMoment) {
                return {
                    type: 'bio',
                    currentName: pokemon.cnName,
                    targetName: nextFormName,
                    targetId: nextId,
                    nextData: nextData,
                    totalAVs: totalAVs,
                    reqAVs: reqAVs
                };
            }
        }
        // ============================================
        // 路径 B: 灵魂共鸣 (Bond Resonance)
        // 适用：最终形态，绝境时的最后反扑
        // ============================================
        else {
            // 【解锁检查】绿色羁绊共鸣需要 enable_bond 解锁
            const unlocks = battle.playerUnlocks || {};
            if (unlocks.enable_bond === false) return null;
            
            // 【全局限制】每场战斗只能使用一次 Bond Resonance
            if (battle.playerBondUsed) return null;
            
            // 最终形态 (无进化型)
            // 1. AVs 绝对阈值（放宽至 220）
            if (totalAVs < 220) return null;
            
            // 2. 必须是 Ace 宝可梦
            if (!pokemon.isAce) return null;

            // 3. 【严格劣势判断】与 AI 一致
            //    计算双方总血量
            let playerTotalHp = 0, enemyTotalHp = 0;
            battle.playerParty.forEach(pp => {
                if (pp && typeof pp.isAlive === 'function') {
                    playerTotalHp += Math.max(0, pp.currHp || 0);
                }
            });
            battle.enemyParty.forEach(ep => {
                if (ep && typeof ep.isAlive === 'function') {
                    enemyTotalHp += Math.max(0, ep.currHp || 0);
                }
            });
            
            const aliveCount = battle.playerParty.filter(p => p && typeof p.isAlive === 'function' && p.isAlive()).length;
            const isLastStand = aliveCount === 1;
            
            // 【严格劣势条件】
            // 核心条件：必须是最后一只宝可梦 且 HP <= 50%
            // 小规模战斗（双方各 <= 2 只）时，允许血量劣势触发
            const currentPokemonCritical = hpRatio <= 0.50;
            const isSmallBattle = (battle.playerParty.length <= 2 && battle.enemyParty.length <= 2);
            const isHpDisadvantage = playerTotalHp < enemyTotalHp * 0.5;
            
            // 触发条件：
            // 1. 最后一只宝可梦 + HP <= 50%
            // 2. 或者 小规模战斗 + 血量劣势 + HP <= 50%
            const canTriggerBond = currentPokemonCritical && (isLastStand || (isSmallBattle && isHpDisadvantage));

            if (canTriggerBond) {
                return {
                    type: 'bond',
                    currentName: pokemon.cnName,
                    targetName: `羁绊·${pokemon.cnName}`,
                    totalAVs: totalAVs,
                    isLastStand: isLastStand,
                    isHpDisadvantage: isHpDisadvantage
                };
            }
        }

        return null;
    }
};

/**
 * 更新进化按钮可见性
 * 在 updateAllVisuals 中调用
 */
function updateEvolutionButtonVisuals() {
    // 【迁移】旧 EVO 按钮始终隐藏，功能已迁移到 Commander System V2
    const btn = document.getElementById('btn-evolved');
    if (btn) btn.classList.add('hidden');
  
    const p = battle.getPlayer();
    if (!p) return;
    
    const evoInfo = window.EvolutionSystem.checkEligibility(p);
    if (!evoInfo) return;

    // 显示提示日志（每种类型只提示一次）+ 刷新 Commander 悬浮窗
    if (evoInfo.type === 'bio' && !p._evoHintLogged) {
        log(`<span style="color:#d4ac0d; text-shadow:0 0 5px gold;">✨ ${p.cnName} 的周身涌动着进化的光芒...它在回应你的意志！</span>`);
        p._evoHintLogged = true;
        if (typeof window.refreshCommanderBubble === 'function') {
            window.refreshCommanderBubble();
        }
    } else if (evoInfo.type === 'bond' && !p._bondHintLogged) {
        log(`<span style="color:#4ade80; text-shadow:0 0 8px #22c55e;">∞ ${p.cnName} 与训练家的心跳开始同步...羁绊正在觉醒！</span>`);
        p._bondHintLogged = true;
        if (typeof window.refreshCommanderBubble === 'function') {
            window.refreshCommanderBubble();
        }
    }
}

/**
 * 触发战斗中进化/羁绊共鸣
 * 点击 EVO 按钮时调用
 */
window.triggerBattleEvolution = async function() {
    const btn = document.getElementById('btn-evolved');
    const p = battle.getPlayer();
  
    if (!p) return;
    const evoInfo = window.EvolutionSystem.checkEligibility(p);
    if (!evoInfo) return;

    battle.locked = true;
    if (btn) btn.classList.add('hidden');
    
    const spriteRef = document.getElementById('player-sprite');

    // ============================================
    // 路径 A: 生命进化 (Biological Evolution)
    // ============================================
    if (evoInfo.type === 'bio') {
        p.hasEvolvedThisBattle = true;
        const oldName = p.cnName;
        
        log(`<div class="log-evo-intro">✨ 宝可梦进化 ✨</div>`);
        log(`${oldName} 的样子……！`);
        await wait(300);
        
        // 动画：普通进化白光（与 Mega 区分）
        if (spriteRef) {
            spriteRef.classList.add('bio-evo-glow');
        }
        await wait(800);
        
        // 数据变更
        const newData = evoInfo.nextData;
        p.name = newData.name;
        p.cnName = newData.name;
        p.types = newData.types || p.types;
        p.baseStats = newData.baseStats;
        
        const stats = calcStats(p.baseStats, p.level, {
            ivs: p.statsMeta?.ivs || { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
            ev_level: p.statsMeta?.ev_level || 0,
            nature: p.nature
        });
        
        p.maxHp = stats.hp;
        p.atk = stats.atk;
        p.def = stats.def;
        p.spa = stats.spa;
        p.spd = stats.spd;
        p.spe = stats.spe;

        // 全回复 + 清状态
        p.currHp = p.maxHp;
        p.status = null;
      
        // 全能力+1
        if (typeof p.applyBoost === 'function') {
            p.applyBoost('atk', 1);
            p.applyBoost('def', 1);
            p.applyBoost('spa', 1);
            p.applyBoost('spd', 1);
            p.applyBoost('spe', 1);
        }
        
        // 白光爆发 + 换图
        if (spriteRef) {
            spriteRef.classList.remove('bio-evo-glow');
            spriteRef.classList.add('bio-evo-burst');
            
            const newSrc = p.getSprite(true);
            if (typeof smartLoadSprite === 'function') {
                delete spriteRequestedUrls['player-sprite'];
                smartLoadSprite('player-sprite', newSrc, false);
                spriteRequestedUrls['player-sprite'] = newSrc;
            }
        }
        await wait(400);
        
        // 冷却动画
        if (spriteRef) {
            spriteRef.classList.remove('bio-evo-burst');
            spriteRef.classList.add('bio-evo-finish');
        }
        await wait(600);
        
        // 清理动画类（保留 player-scale 类）
        if (spriteRef) {
            spriteRef.classList.remove('bio-evo-silhouette', 'bio-evo-burst', 'bio-evo-finish');
            if (!spriteRef.classList.contains('loaded')) {
                spriteRef.classList.add('loaded');
            }
        }
        
        log(`……${oldName} 全身包围了耀眼的光芒！`);
        log(`<b style="color:#a855f7">恭喜！${oldName} 进化成了 ${p.cnName}！</b>`);
        log(`<span style="color:#4ade80">体能完全恢复！全能力提升了！</span>`);
        
        // AVs 效果翻倍
        if (p.avs) {
            p.avsEvolutionBoost = true;
            log(`<span style="color:#ff6b9d">💖 进化激发了潜在的情感力量！AVs 效果翻倍！</span>`);
        }
    }
    // ============================================
    // 路径 B: 灵魂共鸣 (Bond Resonance)
    // ============================================
    else if (evoInfo.type === 'bond') {
        p.hasBondResonance = true;
        battle.playerBondUsed = true; // 【全局限制】标记已使用
        const oldName = p.cnName;
        const avs = p.avs || {};
        const totalAVs = (avs.trust || 0) + (avs.passion || 0) + (avs.insight || 0) + (avs.devotion || 0);
        
        // 标题
        log(`<div style="border-top: 2px solid #4ade80; border-bottom: 2px solid #4ade80; padding: 8px; text-align: center; margin: 10px 0; background: linear-gradient(90deg, rgba(74,222,128,0.1), rgba(74,222,128,0.3), rgba(74,222,128,0.1));">`);
        log(`<b style="font-size:1.4em; color:#4ade80; text-shadow: 0 0 10px #22c55e;">∞ BOND RESONANCE ∞</b>`);
        log(`</div>`);
        await wait(500);
        
        log(`两人的心跳完全重合了……`);
        await wait(400);
        log(`为了回应彻底的信赖 <span style="color:#facc15">(Total AVs: ${totalAVs})</span>，沉睡在体内的界限被打破了！`);
        
        // 动画：金色光晕爆发（不换图）
        if (spriteRef) {
            spriteRef.classList.add('evo-burst');
            spriteRef.style.filter = 'brightness(3) drop-shadow(0 0 20px gold)';
        }
        await wait(400);
        
        if (spriteRef) {
            spriteRef.classList.remove('evo-burst');
            spriteRef.classList.add('evo-finish');
            // 保持金色光晕
            spriteRef.style.filter = 'drop-shadow(0 0 15px gold) brightness(1.15) saturate(1.2)';
        }
        await wait(600);
        
        if (spriteRef) {
            spriteRef.classList.remove('evo-finish');
            // 添加羁绊状态标记
            spriteRef.classList.add('bond-resonance');
        }
        
        // 数据变更：不改变形态，但大幅 buff
        // 1. HP 回复 +60%（不溢出上限）
        const healAmount = Math.floor(p.maxHp * 0.6);
        p.currHp = Math.min(p.currHp + healAmount, p.maxHp);
        
        // 2. 清除所有异常
        p.status = null;
        
        // 3. 全能力+1（平衡调整，原 +2）
        if (typeof p.applyBoost === 'function') {
            p.applyBoost('atk', 1);
            p.applyBoost('def', 1);
            p.applyBoost('spa', 1);
            p.applyBoost('spd', 1);
            p.applyBoost('spe', 1);
            
            // 若有特殊的羁绊指标，可以附加额外加成
            log(`<b style="color:#4ade80">✦ ${p.cnName} 的潜能被唤醒! 攻防特攻特防速度全面提升!</b>`);
        }
        
        await wait(300);
        log(`这并非进化……而是超越进化的 <b style="color:#facc15">共鸣形态</b>！`);
        log(`<span style="color:#4ade80">✦ 全属性极大幅提升！</span>`);
        log(`<span style="color:#60a5fa">✦ 气势(HP)大幅回复！(+${healAmount})</span>`);
        log(`<span style="color:#ff6b9d">✦ AVs 效果翻倍！</span>`);
        
        if (evoInfo.isLastStand) {
            log(`<span style="color:#f87171; font-style:italic;">「哪怕只剩最后一口气……也绝不会放弃！」</span>`);
        }
    }
  
    updateAllVisuals();
    battle.locked = false;
    
    // 【Commander System V2】进化完成后强制刷新悬浮窗
    if (typeof window.refreshCommanderBubble === 'function') {
        window.refreshCommanderBubble();
    }
};

// =========================================================
// COMMANDER SYSTEM (战术指挥系统)
// =========================================================
// 训练家熟练度决定指挥菜单弹出频率
// 指令映射到 AVS 四维，提供强力的即时增益

/**
 * 初始化战术指挥系统
 * 在战斗开始时调用
 */
function initCommanderSystem() {
    // 训练家熟练度 (0-255)，影响触发概率
    // 从 JSON 读取，默认 0（新手训练家）
    // JSON 格式: player.trainerProficiency
    // 注意：使用 ?? 而不是 ||，避免 0 被当作 falsy 值
    battle.trainerProficiency = battle.trainerProficiency ?? 0;
    
    // 当前回合的活跃指令
    battle.activeCommand = null;
    
    // 本场战斗指令使用次数（全局计数）
    // 新规则：dodge/crit 每只宝可梦一次，全局不限（最多6次）
    //        cure/endure 每只宝可梦一次，全局限制2次
    battle.commandUsage = {
        dodge: 0,    // DODGE! (Insight) - 每只宝可梦一次，全局不限
        crit: 0,     // FOCUS! (Passion) - 每只宝可梦一次，全局不限
        cure: 0,     // LISTEN! (Devotion) - 每只宝可梦一次，全局2次
        endure: 0    // ENDURE! (Trust) - 每只宝可梦一次，全局2次
    };
    
    // 每种指令的最大使用次数（全局）
    battle.commandLimits = {
        dodge: 99,   // 每只宝可梦一次，全局不限（由宝可梦标记控制）
        crit: 99,    // 每只宝可梦一次，全局不限（由宝可梦标记控制）
        cure: 2,     // 全局 2 次
        endure: 2    // 全局 2 次
    };
    
    // 指令冷却（回合数）
    // 【初始冷却】Commander Score < 120 时，战斗开始就有冷却
    const p = battle.getPlayer?.();
    const initSyncScore = p ? getCommanderSyncScore(battle.trainerProficiency ?? 0, p) : 0;
    
    if (initSyncScore < 120) {
        // 低同步率：战斗开始时有初始冷却
        battle.commandCooldown = getCommanderCooldown(initSyncScore);
        if (battle.commandCooldown < 0) battle.commandCooldown = 0; // 不可用时设为0
        console.log(`[COMMANDER v2] 初始冷却: ${battle.commandCooldown}回合 (同步率: ${initSyncScore} < 120)`);
    } else {
        // 高同步率(120+)：无初始冷却，第一回合即可使用
        battle.commandCooldown = 0;
        console.log(`[COMMANDER v2] 无初始冷却 (同步率: ${initSyncScore} >= 120)`);
    }
    
    // 【Styles 初始冷却】熟练度 < 101 时，战斗开始就有冷却
    const proficiency = battle.trainerProficiency ?? 0;
    if (proficiency < 101) {
        // 低熟练度：战斗开始时有初始冷却
        battle.playerStyleCooldown = getStyleCooldown(proficiency);
        console.log(`[STYLES v3] 初始冷却: ${battle.playerStyleCooldown}回合 (熟练度: ${proficiency} < 101)`);
    } else {
        // 高熟练度(101+)：无初始冷却，第一回合即可使用
        battle.playerStyleCooldown = 0;
        console.log(`[STYLES v3] 无初始冷却 (熟练度: ${proficiency} >= 101)`);
    }
    
    console.log(`[COMMANDER v2] System initialized. Proficiency: ${proficiency}, SyncScore: ${initSyncScore}`);
}

/**
 * 检查是否应该显示指挥菜单
 * 【v2】改为固定触发 + 基于同步率的动态冷却
 * 在 showMovesMenu 时调用
 * @returns {boolean}
 */
function shouldShowCommanderMenu() {
    // 【全局开关】Commander 系统关闭时不显示
    if (window.GAME_SETTINGS && !window.GAME_SETTINGS.enableCommander) return false;
    
    if (!battle || battle.locked) return false;
    
    const p = battle.getPlayer();
    if (!p || !p.isAce || p.currHp <= 0) return false;
    
    // 【v2】计算同步率
    const proficiency = battle.trainerProficiency ?? 0;
    const syncScore = getCommanderSyncScore(proficiency, p);
    const requiredCooldown = getCommanderCooldown(syncScore);
    
    // 同步率不足，无法使用指挥系统
    if (requiredCooldown < 0) {
        console.log(`[COMMANDER v2] 同步率不足 (${syncScore}), 无法使用指挥系统`);
        return false;
    }
    
    // 冷却中
    if (battle.commandCooldown > 0) {
        console.log(`[COMMANDER v2] 冷却中: ${battle.commandCooldown}回合 (同步率: ${syncScore})`);
        return false;
    }
    
    // 检查是否还有可用指令
    // dodge/crit: 每只宝可梦一次，全局不限
    // cure/endure: 每只宝可梦一次，全局限制2次
    const dodgeAvailable = !p.commandDodgeUsed;
    const critAvailable = !p.commandCritUsed;
    const cureAvailable = !p.commandCureUsed && battle.commandUsage.cure < battle.commandLimits.cure;
    const endureAvailable = !p.commandEndureUsed && battle.commandUsage.endure < battle.commandLimits.endure;
    
    const hasAvailableCommand = dodgeAvailable || critAvailable || cureAvailable || endureAvailable;
    if (!hasAvailableCommand) {
        console.log(`[COMMANDER v2] ${p.cnName} 无可用指令`);
        return false;
    }
    
    // 【v2】固定触发，不再随机
    console.log(`[COMMANDER v2] 指挥可用! 同步率: ${syncScore}, 冷却周期: ${requiredCooldown}回合`);
    return true;
}

/**
 * 显示指挥菜单
 */
function showCommanderMenu() {
    const overlay = document.getElementById('commander-overlay');
    if (!overlay) return;
    
    // 更新按钮状态（禁用已用完的指令）
    updateCommanderButtons();
    
    overlay.classList.remove('hidden');
    
    // 播放音效
    if (typeof window.playSFX === 'function') {
        window.playSFX('CONFIRM');
    }
    
    // 日志提示
    log(`<span style="color:#fbbf24; font-weight:bold;">⚡ 灵光一闪！你感受到了与伙伴的心灵共鸣！</span>`);
    
    console.log(`[COMMANDER] Menu shown`);
}

/**
 * 关闭指挥菜单
 */
function closeCommanderMenu() {
    const overlay = document.getElementById('commander-overlay');
    if (overlay) {
        overlay.classList.add('hidden');
    }
    
    if (typeof window.playSFX === 'function') {
        window.playSFX('CANCEL');
    }
    
    console.log(`[COMMANDER] Menu closed (cancelled)`);
}

/**
 * 更新指挥按钮状态
 */
function updateCommanderButtons() {
    const p = battle.getPlayer();
    const btnMap = {
        dodge: '.pos-top',
        cure: '.pos-left',
        crit: '.pos-right',
        endure: '.pos-bottom'
    };
    
    // dodge 和 crit: 每只宝可梦一次，全局不限
    const dodgeBtn = document.querySelector(btnMap.dodge);
    if (dodgeBtn && p) {
        if (p.commandDodgeUsed) {
            dodgeBtn.disabled = true;
            dodgeBtn.style.opacity = '0.4';
            dodgeBtn.style.pointerEvents = 'none';
        } else {
            dodgeBtn.disabled = false;
            dodgeBtn.style.opacity = '1';
            dodgeBtn.style.pointerEvents = 'auto';
        }
    }
    
    const critBtn = document.querySelector(btnMap.crit);
    if (critBtn && p) {
        if (p.commandCritUsed) {
            critBtn.disabled = true;
            critBtn.style.opacity = '0.4';
            critBtn.style.pointerEvents = 'none';
        } else {
            critBtn.disabled = false;
            critBtn.style.opacity = '1';
            critBtn.style.pointerEvents = 'auto';
        }
    }
    
    // cure 和 endure: 每只宝可梦一次 + 全局限制2次
    const cureBtn = document.querySelector(btnMap.cure);
    if (cureBtn && p) {
        const cureDisabled = p.commandCureUsed || battle.commandUsage.cure >= battle.commandLimits.cure;
        if (cureDisabled) {
            cureBtn.disabled = true;
            cureBtn.style.opacity = '0.4';
            cureBtn.style.pointerEvents = 'none';
        } else {
            cureBtn.disabled = false;
            cureBtn.style.opacity = '1';
            cureBtn.style.pointerEvents = 'auto';
        }
    }
    
    const endureBtn = document.querySelector(btnMap.endure);
    if (endureBtn && p) {
        const endureDisabled = p.commandEndureUsed || battle.commandUsage.endure >= battle.commandLimits.endure;
        if (endureDisabled) {
            endureBtn.disabled = true;
            endureBtn.style.opacity = '0.4';
            endureBtn.style.pointerEvents = 'none';
        } else {
            endureBtn.disabled = false;
            endureBtn.style.opacity = '1';
            endureBtn.style.pointerEvents = 'auto';
        }
    }
}

/**
 * 装填指令（类似 MEGA 的 armed 模式）
 * 指令在选择技能后的回合结算时才会触发
 * @param {string} command - 指令类型: 'dodge', 'crit', 'cure', 'endure'
 */
window.armCommand = function(command) {
    const p = battle.getPlayer();
    if (!p) return;
    
    const commandInfo = {
        dodge: { emoji: '👁️', label: 'DODGE!', cn: '快避开', avs: 'Insight', color: '#00cec9' },
        crit: { emoji: '🔥', label: 'FOCUS!', cn: '击中要害', avs: 'Passion', color: '#ff6b6b' },
        cure: { emoji: '🤝', label: 'LISTEN!', cn: '快清醒', avs: 'Trust', color: '#f1c40f' },
        endure: { emoji: '🛡️', label: 'HOLD ON!', cn: '撑下去', avs: 'Devotion', color: '#a55eea' }
    };
    
    // 如果已经装填了同一个指令，则取消
    if (battle.commandArmed === command) {
        battle.commandArmed = null;
        log(`<span style="color:#94a3b8">取消 ${commandInfo[command].label} 指令预备。</span>`);
        console.log(`[COMMANDER] Command disarmed: ${command}`);
        return false; // 返回 false 表示取消
    }
    
    // 【互斥】选择指令时，自动取消风格预备
    if (window.currentMoveStyle && window.currentMoveStyle !== 'normal') {
        log(`<span style="color:#94a3b8">取消风格预备，切换为指令模式。</span>`);
        window.currentMoveStyle = 'normal';
        if (typeof window.setMoveStyle === 'function') {
            window.setMoveStyle('normal');
        }
    }
    
    // 【互斥】选择指令时，自动取消进化预备
    if (battle.evoArmed) {
        log(`<span style="color:#94a3b8">取消进化预备，切换为指令模式。</span>`);
        battle.evoArmed = null;
    }
    
    // 检查每只宝可梦一次的限制
    const usedKey = `command${command.charAt(0).toUpperCase() + command.slice(1)}Used`;
    if (p[usedKey]) {
        log(`<span style="color:#ef4444;">${p.cnName} 本场战斗已经使用过 ${commandInfo[command].label} 指令了！</span>`);
        return false;
    }
    
    // 检查全局使用次数（cure/endure 全局限制2次）
    if ((command === 'cure' || command === 'endure') && 
        battle.commandUsage[command] >= battle.commandLimits[command]) {
        log(`<span style="color:#ef4444;">${commandInfo[command].label} 指令全局次数已用尽！</span>`);
        return false;
    }
    
    // 切换指令：取消之前的，设置新的
    if (battle.commandArmed && battle.commandArmed !== command) {
        const oldInfo = commandInfo[battle.commandArmed];
        log(`<span style="color:#94a3b8">取消 ${oldInfo.label} 指令，切换为 ${commandInfo[command].label}</span>`);
    }
    
    // 装填指令
    battle.commandArmed = command;
    const info = commandInfo[command];
    
    log(`<span style="color:${info.color}">🎯 ${info.label} 指令就绪！选择招式后将触发！</span>`);
    console.log(`[COMMANDER] Command armed: ${command}`);
    
    return true; // 返回 true 表示装填成功
};

/**
 * 触发已装填的指令（在回合结算时调用）
 * @returns {boolean} 是否触发了指令
 */
window.triggerArmedCommand = function() {
    const command = battle.commandArmed;
    if (!command) return false;
    
    const p = battle.getPlayer();
    if (!p) return false;
    
    const commandInfo = {
        dodge: { emoji: '👁️', label: 'DODGE!', cn: '快避开', avs: 'Insight', color: '#00cec9' },
        crit: { emoji: '🔥', label: 'FOCUS!', cn: '击中要害', avs: 'Passion', color: '#ff6b6b' },
        cure: { emoji: '🤝', label: 'LISTEN!', cn: '快清醒', avs: 'Trust', color: '#f1c40f' },
        endure: { emoji: '🛡️', label: 'HOLD ON!', cn: '撑下去', avs: 'Devotion', color: '#a55eea' }
    };
    
    const info = commandInfo[command];
    
    // 标记使用
    battle.activeCommand = command;
    battle.commandUsage[command]++;
    
    // 标记每只宝可梦一次的指令
    const usedKey = `command${command.charAt(0).toUpperCase() + command.slice(1)}Used`;
    p[usedKey] = true;
    
    // 【v2】基于同步率的动态冷却
    const proficiency = battle.trainerProficiency ?? 0;
    const syncScore = getCommanderSyncScore(proficiency, p);
    const commandCooldown = getCommanderCooldown(syncScore);
    battle.commandCooldown = Math.max(1, commandCooldown);
    console.log(`[COMMANDER v2] 设置冷却: ${battle.commandCooldown}回合 (同步率: ${syncScore})`);
    
    // 播放音效
    if (typeof window.playSFX === 'function') {
        window.playSFX('MEGA_EVOLVE');
    }
    
    // 日志输出
    log(`<div style="border-left: 4px solid ${info.color}; padding-left: 10px; margin: 5px 0;">`);
    log(`<b style="color:${info.color}; font-size: 1.1em;">🗣️ [指挥] "${info.cn}！"</b>`);
    log(`<span style="color:#9ca3af; font-size: 0.9em;">${p.cnName} 感受到了训练家的意志！(${info.avs})</span>`);
    log(`</div>`);
    
    console.log(`[COMMANDER] Command triggered: ${command} (${info.cn})`);
    
    // 应用指令效果
    applyCommandEffect(command, p);
    
    // 清除装填状态
    battle.commandArmed = null;
    
    // 刷新悬浮窗
    if (typeof window.refreshCommanderBubble === 'function') {
        window.refreshCommanderBubble();
    }
    
    return true;
};

// 保留旧的 triggerCommand 作为兼容，但改为调用 armCommand
window.triggerCommand = function(command) {
    window.armCommand(command);
};

/**
 * 应用指令效果
 * @param {string} command - 指令类型
 * @param {Pokemon} pokemon - 目标宝可梦
 */
function applyCommandEffect(command, pokemon) {
    switch (command) {
        case 'dodge':
            // 闪避：本回合闪避率翻倍（在 battle-calc.js 中检查）
            pokemon.commandDodgeActive = true;
            break;
            
        case 'crit':
            // 暴击：下次攻击必定暴击（在 battle-calc.js 中检查）
            pokemon.commandCritActive = true;
            break;
            
        case 'cure':
            // LISTEN! 解控：概率清除畏缩/混乱/着迷
            // 基础 40% + Devotion AVS 50%（满值时 90%）
            let listenChance = 0.40; // 基础 40%
            
            // Devotion AVS 加成：满值 255 时 +50%
            // 【全局开关】使用 getEffectiveAVs 检查有效值
            if (pokemon.isAce && pokemon.avs) {
                const baseDevotion = pokemon.getEffectiveAVs('devotion');
                if (baseDevotion > 0) {
                    const effectiveDevotion = pokemon.avsEvolutionBoost ? baseDevotion * 2 : baseDevotion;
                    const devotionBonus = (Math.min(effectiveDevotion, 255) / 255) * 0.50;
                    listenChance += devotionBonus;
                    console.log(`[COMMANDER] LISTEN! Devotion 加成: +${(devotionBonus * 100).toFixed(1)}% (Devotion: ${baseDevotion})`);
                }
            }
            
            listenChance = Math.min(listenChance, 1.0); // 上限 100%
            const listenRoll = Math.random();
            console.log(`[COMMANDER] LISTEN! Roll: ${(listenRoll * 100).toFixed(1)}% vs Chance: ${(listenChance * 100).toFixed(1)}%`);
            
            if (listenRoll < listenChance) {
                // 成功：清除负面状态
                let cured = false;
                if (pokemon.volatile) {
                    if (pokemon.volatile.flinch) {
                        delete pokemon.volatile.flinch;
                        cured = true;
                    }
                    if (pokemon.volatile.confusion) {
                        delete pokemon.volatile.confusion;
                        delete pokemon.volatile.confusionTurns;
                        cured = true;
                    }
                    if (pokemon.volatile.attract) {
                        delete pokemon.volatile.attract;
                        cured = true;
                    }
                }
                if (cured) {
                    log(`<b style="color:#f1c40f">💫 ${pokemon.cnName} 恢复了清醒！</b>`);
                }
                // 本回合攻击不受负面状态影响
                pokemon.commandCureActive = true;
                log(`<b style="color:#ff9f43; text-shadow:0 0 8px #ff9f43;">🤝 LISTEN! 指令成功！${pokemon.cnName} 听从了训练家的指挥！</b>`);
            } else {
                log(`<span style="color:#ef4444;">LISTEN! 指令失败...${pokemon.cnName} 没能听到训练家的声音...</span>`);
            }
            break;
            
        case 'endure':
            // 挺住：本回合收到致命伤必定保留 1 HP（在 takeDamage 中检查）
            pokemon.commandEndureActive = true;
            break;
    }
}

/**
 * 回合结束时清理指令状态
 */
function clearCommandEffects() {
    const p = battle.getPlayer();
    if (p) {
        p.commandDodgeActive = false;
        p.commandCritActive = false;
        p.commandCureActive = false;
        p.commandEndureActive = false;
    }
    
    // 清除活跃指令
    battle.activeCommand = null;
    
    // 减少冷却
    if (battle.commandCooldown > 0) {
        battle.commandCooldown--;
    }
}

// ============================================
// 【环境图层系统】辅助函数 - 生成描述文字
// ============================================

/**
 * 获取目标选择器的中文描述
 * @private
 */
function _getTargetDescription(target) {
    if (!target) return '全体';
    
    switch (target.type) {
        case 'all': return '全体';
        case 'pokemonType': return `${target.value}系宝可梦`;
        case 'moveType': return `${target.value}系技能`;
        case 'moveFlag': return `${target.value}类技能`;
        case 'side': return target.value === 'player' ? '玩家方' : '敌方';
        case 'not': return `非(${_getTargetDescription(target.inner)})`;
        case 'hasAbility': return `拥有${target.value}特性`;
        case 'hasItem': return `持有${target.value}`;
        case 'grounded': return '接地宝可梦';
        case 'and': 
            return target.conditions?.map(c => _getTargetDescription(c)).join('且') || '全体';
        case 'or':
            return target.conditions?.map(c => _getTargetDescription(c)).join('/') || '全体';
        default: return '全体';
    }
}

/**
 * 获取效果的中文描述
 * @private
 */
function _getEffectsDescription(effects) {
    if (!effects) return '';
    
    const parts = [];
    
    // 状态名映射
    const statusNames = {
        'brn': '灼伤', 'burn': '灼伤',
        'psn': '中毒', 'poison': '中毒',
        'tox': '剧毒', 'toxic': '剧毒',
        'par': '麻痹', 'paralysis': '麻痹',
        'frz': '冰冻', 'freeze': '冰冻',
        'slp': '睡眠', 'sleep': '睡眠',
        'confusion': '混乱'
    };
    
    // 数值修正
    const statNames = { atk: '攻击', def: '防御', spa: '特攻', spd: '特防', spe: '速度' };
    for (const [stat, mult] of Object.entries(effects.statMods || {})) {
        const name = statNames[stat] || stat;
        if (mult > 1) parts.push(`${name}+${Math.round((mult - 1) * 100)}%`);
        else if (mult < 1) parts.push(`${name}-${Math.round((1 - mult) * 100)}%`);
    }
    
    // HP 跳动
    if (effects.hpChange > 0) parts.push(`每回合回复${Math.round(effects.hpChange * 100)}%HP`);
    if (effects.hpChange < 0) parts.push(`每回合损失${Math.round(Math.abs(effects.hpChange) * 100)}%HP`);
    
    // 伤害修正
    if (effects.dmgMod && effects.dmgMod !== 1) {
        if (effects.dmgMod > 1) parts.push(`伤害+${Math.round((effects.dmgMod - 1) * 100)}%`);
        else parts.push(`伤害-${Math.round((1 - effects.dmgMod) * 100)}%`);
    }
    
    // 暴击等级修正
    if (effects.critStage && effects.critStage !== 0) {
        if (effects.critStage > 0) parts.push(`暴击率+${effects.critStage}级`);
        else parts.push(`暴击率${effects.critStage}级`);
    }
    
    // 闪避等级修正
    if (effects.evasionStage && effects.evasionStage !== 0) {
        if (effects.evasionStage > 0) parts.push(`闪避+${effects.evasionStage}级`);
        else parts.push(`闪避${effects.evasionStage}级`);
    }
    
    // 命中修正
    if (effects.accMod && effects.accMod !== 1) {
        if (effects.accMod > 1) parts.push(`命中+${Math.round((effects.accMod - 1) * 100)}%`);
        else parts.push(`命中-${Math.round((1 - effects.accMod) * 100)}%`);
    }
    
    // 回复修正
    if (effects.healMod && effects.healMod !== 1) {
        if (effects.healMod > 1) parts.push(`回复+${Math.round((effects.healMod - 1) * 100)}%`);
        else parts.push(`回复-${Math.round((1 - effects.healMod) * 100)}%`);
    }
    
    // 吸血效率修正
    if (effects.drainMod && effects.drainMod !== 1) {
        if (effects.drainMod > 1) parts.push(`吸血+${Math.round((effects.drainMod - 1) * 100)}%`);
        else parts.push(`吸血-${Math.round((1 - effects.drainMod) * 100)}%`);
    }
    
    // 环境反伤
    if (effects.envRecoil) {
        const chance = Math.round(effects.envRecoil.chance * 100);
        const damage = Math.round(effects.envRecoil.damage * 100);
        parts.push(`${chance}%概率${damage}%反伤`);
    }
    
    // 禁用道具
    if (effects.banItems?.length) {
        parts.push(`禁用${effects.banItems.join('/')}`);
    }
    
    // 类型效果
    if (effects.immuneTypes?.length) parts.push(`免疫${effects.immuneTypes.join('/')}`);
    if (effects.weakTypes?.length) parts.push(`弱点${effects.weakTypes.join('/')}`);
    if (effects.banTypes?.length) parts.push(`禁用${effects.banTypes.join('/')}系技能`);
    
    // 状态治愈
    if (effects.cureStatus?.length) {
        const cureDescs = effects.cureStatus.map(c => {
            const statusName = statusNames[c.status] || c.status;
            const chance = Math.round(c.chance * 100);
            return chance === 100 ? statusName : `${statusName}(${chance}%)`;
        });
        parts.push(`治愈${cureDescs.join('/')}`);
    }
    
    // 状态阻止
    if (effects.preventStatus?.length) {
        const preventNames = effects.preventStatus.map(s => statusNames[s] || s).join('/');
        parts.push(`阻止${preventNames}`);
    }
    
    // 状态免疫
    if (effects.immuneStatus?.length) {
        const immuneNames = effects.immuneStatus.map(s => statusNames[s] || s).join('/');
        parts.push(`免疫${immuneNames}`);
    }
    
    // 状态施加
    if (effects.inflictStatus && effects.inflictChance > 0) {
        const statusName = statusNames[effects.inflictStatus] || effects.inflictStatus;
        const chance = Math.round(effects.inflictChance * 100);
        parts.push(`${chance}%几率施加${statusName}`);
    }
    
    return parts.join(', ');
}

// 导出到全局
window.initCommanderSystem = initCommanderSystem;
window.shouldShowCommanderMenu = shouldShowCommanderMenu;
window.showCommanderMenu = showCommanderMenu;
window.closeCommanderMenu = closeCommanderMenu;
window.clearCommandEffects = clearCommandEffects;
window._getTargetDescription = _getTargetDescription;
window._getEffectsDescription = _getEffectsDescription;
