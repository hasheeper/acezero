# ACEZERO 沉浸式关键层总览

## 双端定位
ACEZERO 的沉浸体验靠“两端”闭环：
1. **入口端（AI→ST 插件→游戏）**：`ST/acezero-tavern-plugin.js` 接住 AI RP 输出的 `<ACE0_BATTLE>` 草稿，把本地 ERA 角色档案、资金与 AI 的 NPC 草案融合，产出可直接加载的 `game-config` 并注入 `<ACE0_FRONTEND>`，从而把文字剧情瞬间转成可交互德州战斗。@ST/acezero-tavern-plugin.js#1-908
2. **出口端（游戏→叙事 AI）**：`texasholdem/texas-holdem/utils/game-logger.js` 在战斗进行时采集全部结构化事件，清洗噪音、估算叙事篇幅，并一键生成带写作指令的提示词，方便 AI 把刚刚的战斗改写成沉浸式小说并反馈资金变量。@texasholdem/texas-holdem/utils/game-logger.js#1-576

两者合起来形成 “文字 → 游戏 → 再叙事” 的循环，每个环节都落在对应模块的职责内。@ST/acezero-tavern-plugin.js#704-953 @texasholdem/texas-holdem/utils/game-logger.js#488-576

---

## ST/acezero-tavern-plugin.js — 酒馆助手中间件

### 运行管线（从注入到前端）
1. **加载与常量注册**：自执行函数建立 `PLUGIN_NAME/BATTLE_TAG/FRONTEND_TAG` 等常量并初始化守护状态，确保多次事件不会重复处理。@ST/acezero-tavern-plugin.js#33-66
2. **数据目录装载**：同步 `UNIVERSAL_SKILLS`、特质解锁、`MANA_BY_LEVEL` 以及 `NAMED_CHARACTERS`、`NAMED_NPC_PRESETS` 等表，保证插件推导出来的东西与游戏引擎完全一致，包括专属技能、preferredSlot、属性成长、特质表。@ST/acezero-tavern-plugin.js#47-245
3. **英雄状态注入**：`handleGenerationBefore()` 在 `GENERATION_AFTER_COMMANDS` 事件中调用 `getEraVars()`，把资金与所有角色等级、魔运汇整成 `<ace0_hero_state>` XML 注入 SillyTavern 上下文，确保模型回复 `<ACE0_BATTLE>` 时知道真实面板。@ST/acezero-tavern-plugin.js#704-763
4. **AI 战局解析**：`handleWriteDone()` 捕获 `<ACE0_BATTLE>`，通过 `parseAiBattleOutput()` 清理 markdown、反引号，仅保留 JSON 有效主体。@ST/acezero-tavern-plugin.js#769-803
5. **NPC 统一化**：`resolveBattleData()` 遍历 `seats`，每个位置调用 `resolveNpcSeat()`，自动识别“专属角色速记 / runner / 三维组装 / 原始直写”四种写法，必要时用 `assembleNPC/assembleFromRunner/assembleNamedNPC` 填充缺省字段（难度、情绪、技能、属性）。@ST/acezero-tavern-plugin.js#331-552
6. **ERA 合并**：`buildCompleteGameConfig()` 将 ERA 的 hero roster 与 AI 战局合并，按角色名 + 等级查表得到属性、特质、技能，推导 mana、chips、heroSeat（自动寻找空位），并把 vanguard/rearguard 技能分栏写入 v5 版 `game-config`。@ST/acezero-tavern-plugin.js#592-688
7. **前端注入**：合并后的 JSON 被包装进 `<ACE0_FRONTEND>` 插入聊天记录底部，SillyTavern 的正则随后把占位符替换成 STver.html，并通过 postMessage 把 `game-config` 送进游戏 iframe。@ST/acezero-tavern-plugin.js#808-908
8. **资金同步**：相同的 `era:writeDone` 事件里调用 `reconcileFunds()`，把 `hero.funds_up/down` 变动写回 `hero.funds`，并清零差额，确保文字剧情给出的输赢能落到 ERA 存档。@ST/acezero-tavern-plugin.js#911-953

### 数据目录与推导函数
- **技能/特质/属性表**：`UNIVERSAL_SKILLS` 记录 attr/tier/threshold/独占角色；`VANGUARD_TRAIT_UNLOCK`、`REARGUARD_TRAIT_UNLOCK` 和位置属性表保证任意普通角色也能自动成长；`MANA_BY_LEVEL` 决定 mana/maxMana 默认值。@ST/acezero-tavern-plugin.js#47-145,247-258
- **角色档案**：`NAMED_CHARACTERS` 为 KAZU/RINO/SIA/LILIKA/POPPO 提供 per-level 属性、特质、exclusiveSkills；`NAMED_NPC_PRESETS` 列出 boss 式敌人默认难度、AI、情绪、技能、描述。@ST/acezero-tavern-plugin.js#99-245
- **推导工具**：`mergeAttrs` 以最大值合并主副手属性；`deriveSkillsFromAttrs` 基于属性和 exclusive 过滤出技能并按 tier + 属性值排序；`getCharAttrs` / `getCharTrait` 根据角色类型（专属/通用）选表；`getCharExclusiveSkills` 供未来扩展。@ST/acezero-tavern-plugin.js#251-333

### NPC 三维组装细节
| 维度 | 入口 | 作用 |
| --- | --- | --- |
| **AI_KERNELS** | `mob/gambler/rock/shark/boss` | 固定难度 + 行为风格描述，决定 `ai`、`difficulty`、对话文案。@ST/acezero-tavern-plugin.js#340-349 |
| **RPG_TEMPLATES** | `muggle/lucky/cursed/esper/nullifier` | 提供 level + 属性面板，之后由 `deriveSkillsFromAttrs` 自动产出技能列表。@ST/acezero-tavern-plugin.js#351-380 |
| **MOOD_MODIFIERS** | `calm/confident/tilt/fearful/desperate/euphoric` | 映射到 poker-ai 的 emotion profile，对接情绪驱动的决策逻辑。@ST/acezero-tavern-plugin.js#383-394 |

`RUNNER_PRESETS` 则把三维组合打包成常见 NPC（street_thug、mind_reader、void_king 等），AI 只写 `"runner": "mind_reader"` 即可，插件自动展开。@ST/acezero-tavern-plugin.js#395-416

### ERA → game-config 关键点
- 自动识别 hero roster：`_getHeroCharNames()` 排除 funds/attrs 等保留字段，只保留角色对象。@ST/acezero-tavern-plugin.js#693-702
- 主副手推导：`battle.hero` 可以指定组合，未写则默认 HERO 列表首位为主手、次位为副手；每个角色各自推导技能/特质并写入 `vanguardSkills`、`rearguardSkills`。@ST/acezero-tavern-plugin.js#592-666
- 魔运同步：副手优先作为 mana pool 来源；若缺副手则回退主手，再按 `MANA_BY_LEVEL` 推算上限与当前值。@ST/acezero-tavern-plugin.js#639-658
- 筹码与座位：`heroChips` 取 ERA `funds` 与 table `chips` 的最小值；若 AI 未指定 heroSeat，则根据预设顺序（BB→CO→UTG→HJ→SB→BTN）分配空位，避免 seat 冲突。@ST/acezero-tavern-plugin.js#645-685

### 事件、防抖与 API
- `handleWriteDone()` 通过 `isProcessing` 旗标避免并发；若消息已含 `<ACE0_FRONTEND>` 则直接跳过，防止重复注入。@ST/acezero-tavern-plugin.js#841-908
- `wait()`、`resetState()` 以及对 `CHAT_CHANGED/MESSAGE_SWIPED/MESSAGE_EDITED` 的监听，可在对话切换或撤回时清理状态。@ST/acezero-tavern-plugin.js#558-567,959-968
- `window.ACE0Plugin` 暴露 ERA 查询、手动触发战局、获取 hero roster、NPC 组装工具及所有静态表；`triggerBattle()` 还能直接把临时 `game-config` 作为 assistant 消息推入聊天，方便测试。@ST/acezero-tavern-plugin.js#984-1054
- 启动日志列出所有 kernel/archetype/mood/角色/runner，策划可一眼确认表是否对齐。@ST/acezero-tavern-plugin.js#1055-1063

---

## texasholdem/texas-holdem/utils/game-logger.js — 牌局日志 + 叙事提示词系统

### 设计目标与 D-E-L 流水线
GameLogger 负责把实时战斗转成“可写小说”的素材：
1. **Delete**：`classifyEntry()` + `DELETE_TYPES` 先剔除所有 `SKILL_REGISTER/MOZ_*` 等引擎噪音，保留玩家技能、摊牌、All-in 等剧情节点。@texasholdem/texas-holdem/utils/game-logger.js#24-121
2. **Encode**：`formatEntry()` 将结构化事件映射为自然语言行，并用 `Currency` 模块呈现筹码/盲注。@texasholdem/texasholdem/utils/game-logger.js#127-180
3. **Label**：`deduplicateActions()`、`collapseT3Runs()`、`filterLog()` 进一步折叠重复动作、统计 T0-T3 命中，为后续字数估算提供“叙事分”。@texasholdem/texasholdem/utils/game-logger.js#186-313

### 事件分级细则
- **T0**：玩家技能(`SKILL_USE`)、最终结算(`RESULT/SHOWDOWN`)、All-in；保证强剧情节点不会被压缩。@texasholdem/texasholdem/utils/game-logger.js#52-85
- **T1**：NPC 技能、Psyche 拦截、关键加注(>50% pot)、弃牌、公共牌发出等“转折点”。@texasholdem/texasholdem/utils/game-logger.js#58-103
- **T2**：一般下注、跟注、过牌、盲注、发底牌；用于填充节奏。@texasholdem/texasholdem/utils/game-logger.js#104-118
- **T3**：其余未分类事件；若连续出现会折叠成“系统事件省略”提示，避免拉长篇幅。@texasholdem/texasholdem/utils/game-logger.js#119-270

### 字数推荐模型
`calculateWordCount()` 根据参战人数（乘 100）、叙事分×8、最大底池与初始筹码的比值、T3 噪音衰减以及资金波动加成，生成 500~4000 字区间，外加 breakdown（participants/events/potModifier/decay/fundsBonus/rawWords）供 UI 展示或提示词引用。@texasholdem/texasholdem/utils/game-logger.js#320-358

### GameLogger 类 API
| 功能 | 关键方法 | 说明 |
| --- | --- | --- |
| **UI 绑定** | `bindUI({panel,content,btnCopy,btnToggle})` | 连接仪表盘元素，hook 复制/展示按钮。@texasholdem/texasholdem/utils/game-logger.js#364-388 |
| **事件记录** | `log(type,data)` | 抓取当前阶段、底池、玩家筹码（含 currentBet）、附加自定义 payload，压入 `entries`。@texasholdem/texasholdem/utils/game-logger.js#390-416 |
| **重置** | `clear()` | 清空 entries，隐藏面板与复制按钮，用于新局开始。@texasholdem/texasholdem/utils/game-logger.js#418-423 |
| **文本生成** | `generateText(context)` | 输出“三段式”：设置→最终手牌→行动日志，阶段自动分隔并附统计行。@texasholdem/texasholdem/utils/game-logger.js#424-482 |
| **提示词生成** | `generateAIPrompt(context)` | 组合清洗日志（`▶ PHASE` 标头 + `> 行动`）、结果摘要（玩家、筹码、盲注、公共牌、mana、资金变动）、字数要求、写作原则与 VariableEdit 提醒，封装在 `[CORE_TASK|POKER_LOG|POKER_RESULT|FUNDS_UPDATE|WRITING_INSTRUCTION]` 标签内，便于喂回大模型。@texasholdem/texasholdem/utils/game-logger.js#488-576 |
| **展示与复制** | `show(context)` 在 UI 面板展示 generateText 结果；`togglePanel()` 控制可见性；`copyToClipboard` / `copyAIPrompt` 兼容 iframe（优先 `navigator.clipboard`，失败则 textarea fallback）。@texasholdem/texasholdem/utils/game-logger.js#581-648 |

### 资金同步指令
提示词中的 `<FUNDS_UPDATE>` 段会自动根据 `context.fundsUp / fundsDown` 输出对应的 VariableEdit JSON，写成可直接贴回 ERA 的命令：赢了写 `hero.funds_up`，输了写 `hero.funds_down`，不变则说明无需操作。@texasholdem/texasholdem/utils/game-logger.js#529-571

### 导出 / 调试
- `global.GameLogger = GameLogger` 允许浏览器控制台或其他模块直接 new；静态导出 `filterLog/classifyEntry/calculateWordCount/TIER_SCORES` 方便单元测试或命令行复现清洗流程。@texasholdem/texasholdem/utils/game-logger.js#650-658

---

## 双端闭环价值
1. **AI→游戏**：Tavern 插件在 AI 层提供角色表、NPC 组装、hero 状态注入、资金回写，保证每次 `<ACE0_BATTLE>` 都能落成完整、合法、可玩的 `game-config`。@ST/acezero-tavern-plugin.js#47-954
2. **游戏→AI**：GameLogger 把实时对局压缩成带写作规则的提示词＋ VariableEdit 指令，直接指导下一轮 AI 叙事与 ERA 状态更新。@texasholdem/texasholdem/utils/game-logger.js#488-576
3. **循环沉浸**：AI 叙事 → (Tavern) → 可视化战斗 → (GameLogger) → AI 复写 → ERA 资金变动 → 新战局，如此往复，使 RP 与玩法完全同轨。@ST/acezero-tavern-plugin.js#704-954 @texasholdem/texasholdem/utils/game-logger.js#488-576

