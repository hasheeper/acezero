# 零之王牌 — NPC 模块化组装系统 v1

## 概述

ACE0 引擎 v2 采用**模块化 NPC 组装流水线**：不预设"第几关"，而是预设"这是个什么人"。

一个 NPC 由四个独立维度组装：

| 维度 | 名称 | 决定什么 |
|------|------|---------|
| **Kernel** | AI 核心 | 决策风格 + 打牌水平 |
| **Wealth** | 经济阶级 | 筹码量 + 盲注级别 |
| **Archetype** | 异能模版 | RPG 属性 + 技能 |
| **Mood** | 情绪覆写 | 运行时修正 AI 核心 |

四个维度完全解耦，只在最终生成 config 时缝合。

---

## 一、四维度配置表

### 维度 1: AI 核心 (AI_KERNELS)

性格 + 水平的固定组合，决定 NPC 怎么打牌。

| 键名 | 性格 | 水平 | 描述 |
|------|------|------|------|
| `mob` | passive | noob | 杂鱼 — 盲目跟注，容易弃牌 |
| `gambler` | maniac | noob | 赌徒 — 疯狂乱推 All-in，毫无章法 |
| `rock` | rock | regular | 老苟 — 不见兔子不撒鹰，只玩强牌 |
| `shark` | aggressive | pro | 鲨鱼 — 剥削型打法，会诈唬，懂胜率 |
| `boss` | balanced | pro | 魔王 — 滴水不漏，连运气都会算 |

### 维度 2: 经济阶级 (WEALTH_CLASSES)

数值锚点，AI 不需要去想"多少钱算富"。

| 键名 | 筹码 | 盲注 | 描述 |
|------|------|------|------|
| `poor` | 500 | 5/10 | 贫民窟 |
| `normal` | 2,000 | 20/40 | 市民 |
| `rich` | 10,000 | 100/200 | 富豪 |
| `whale` | 50,000 | 500/1,000 | 巨鲸/顶级局 |

`wealth` 可以写在根结构上（全桌统一），也可以省略后用 `blinds`/`chips` 手动指定。

### 维度 3: 异能模版 (RPG_TEMPLATES)

skill-system 的快速入口，属性由模版定义，技能由 `deriveSkillsFromAttrs` 自动推导。

| 键名 | 等级 | 属性 | 描述 |
|------|------|------|------|
| `muggle` | 0 | 全 0 | 麻瓜/常人 — 无异能 |
| `lucky` | 2 | M40 | 幸运儿 — 命运偏向（可用大吉） |
| `cursed` | 3 | C50 | 厄运散播者 — 混沌诅咒（大凶、灾变） |
| `esper` | 4 | P80 | 灵能者 — 绝对资讯优势（透视+真理） |
| `nullifier` | 5 | V100 | 抹杀者 — 屏蔽一切（制裁主角的 Boss） |

### 维度 4: 情绪修正 (MOOD_MODIFIERS)

唯一的动态层，根据上下文修正 AI 核心。与 `poker-ai.js` 的 `EMOTION_PROFILES` 同步。

| 键名 | 描述 | 核心效果 |
|------|------|---------|
| `calm` | 冷静（默认） | 无修正 |
| `confident` | 自信 | 更敢加注，不容易弃牌 |
| `tilt` | 上头 | 判断力暴跌，疯狂加注诈唬 |
| `fearful` | 恐惧 | 畏手畏脚，容易弃牌 |
| `desperate` | 绝望 | 孤注一掷，频繁 All-in |
| `euphoric` | 狂喜 | 飘飘然，容易轻敌 |

#### 情绪 Delta 详表

| 情绪 | 噪音Δ | 入场Δ | 加注Δ | 诈唬Δ | 尺度Δ | 弃牌Δ |
|------|-------|-------|-------|-------|-------|-------|
| calm | 0 | 0 | 0 | 0 | 0 | 0 |
| confident | -3 | -5 | -8 | +0.05 | +0.15 | -0.10 |
| tilt | +15 | -20 | -15 | +0.20 | +0.40 | -0.25 |
| fearful | +5 | +15 | +20 | -0.08 | -0.20 | +0.15 |
| desperate | +10 | -15 | -20 | +0.25 | +0.60 | -0.20 |
| euphoric | +8 | -10 | -5 | +0.10 | +0.20 | -0.15 |

#### 情绪使用指南

```
第一把 → calm / confident
输了大锅 → tilt 或 fearful
筹码快没了 → desperate
赢了大锅 → euphoric 或 confident
```

经典组合：
- **rock + tilt** = 保守的人突然失控，反差极大
- **shark + confident** = 最危险状态，精准施压
- **mob + desperate** = 鱼被逼到墙角，开始乱推
- **gambler + fearful** = 疯子被打怕了，变得犹豫

---

## 二、跑龙套预设 (RUNNER_PRESETS)

常见 NPC 的一键生成快捷方式，每个 = 四维度的固定组合。

### 杂兵类

| 键名 | 描述 | kernel | wealth | archetype | mood |
|------|------|--------|--------|-----------|------|
| `street_thug` | 街头小混混 | mob | poor | muggle | calm |
| `drunk` | 醉汉赌徒 | gambler | poor | muggle | euphoric |
| `rookie` | 紧张的新手 | mob | normal | muggle | fearful |

### 常规对手

| 键名 | 描述 | kernel | wealth | archetype | mood |
|------|------|--------|--------|-----------|------|
| `tavern_regular` | 酒馆常客 | rock | normal | muggle | calm |
| `pro_gambler` | 职业赌徒 | shark | normal | muggle | confident |
| `lucky_bastard` | 运气极好的家伙 | gambler | normal | lucky | euphoric |

### 精英/小Boss

| 键名 | 描述 | kernel | wealth | archetype | mood |
|------|------|--------|--------|-----------|------|
| `casino_shark` | 赌场鲨鱼 | shark | rich | muggle | calm |
| `curse_dealer` | 厄运荷官 | shark | rich | cursed | confident |
| `mind_reader` | 读心者 | boss | rich | esper | calm |

### Boss

| 键名 | 描述 | kernel | wealth | archetype | mood |
|------|------|--------|--------|-----------|------|
| `void_king` | 虚空之王 | boss | whale | nullifier | confident |
| `chaos_lord` | 混沌领主 | shark | whale | cursed | tilt |

---

## 三、AI 输出格式

AI 在 `<ACE0_BATTLE>` 标签中描述每个 NPC 座位，支持三种格式混用。

### 格式 A: 跑龙套速记（最简）

```json
{ "runner": "street_thug", "name": "阿猫" }
```

### 格式 B: 四维组装（通用）

```json
{
  "name": "黑寡妇",
  "kernel": "shark",
  "wealth": "rich",
  "archetype": "cursed",
  "mood": "confident"
}
```

省略的维度使用默认值：kernel=mob, wealth=normal, archetype=muggle, mood=calm

### 格式 C: 原始直写（完全自定义）

```json
{
  "vanguard": { "name": "VOID_KING", "level": 5, "trait": "iron_nerve" },
  "rearguard": { "name": "VOID_QUEEN", "level": 4, "trait": "hex_pulse" },
  "attrs": { "moirai": 70, "chaos": 50, "psyche": 60, "void": 80 },
  "skills": ["grand_wish", "havoc", "vision"],
  "ai": "aggressive",
  "emotion": "tilt"
}
```

### 根结构

```json
{
  "wealth": "normal",
  "blinds": [20, 40],
  "chips": 2000,
  "seats": {
    "BTN": { ... },
    "SB": { ... }
  }
}
```

- `wealth` — 可选，推导全局 blinds/chips
- `blinds`/`chips` — 可选，覆盖 wealth 推导值
- 同一桌内三种 NPC 格式可以混用

---

## 四、组装流水线

```
AI 输出 seat data
       │
       ├─ runner 字段? → RUNNER_PRESETS 查表 → assembleNPC()
       ├─ kernel 字段? → 四维度直接 → assembleNPC()
       └─ vanguard 字段? → 透传（原始直写）
       │
       ▼
  resolveNpcSeat() → 统一的 seat config
       │
       ▼
  resolveBattleData() → 遍历所有座位 + 推导 wealth
       │
       ▼
  buildCompleteGameConfig() → 合并 ERA hero → 完整 game-config
       │
       ▼
  injectGameFrontend() → <ACE0_FRONTEND> 注入消息
```

`assembleNPC(name, {kernel, wealth, archetype, mood})` 内部逻辑：
1. 从 `AI_KERNELS` 取 `ai` 风格
2. 从 `RPG_TEMPLATES` 取 `level` + `attrs`
3. 如果有 attrs → `deriveSkillsFromAttrs()` 自动推导技能
4. 从 `MOOD_MODIFIERS` 取 `emotion`
5. 缝合为 `{ vanguard, ai, emotion, attrs?, skills? }`

---

## 五、运行时情绪切换

`PokerAI` 实例支持运行时切换情绪，无需重建：

```javascript
player.ai.setEmotion('tilt');   // 切换到上头
player.ai.setEmotion('calm');   // 恢复冷静
```

---

## 六、API 参考

### window.ACE0Plugin

| 方法/属性 | 说明 |
|-----------|------|
| `assembleNPC(name, dims)` | 四维度 → 完整 seat config |
| `assembleFromRunner(key, name)` | 跑龙套 → 完整 seat config |
| `resolveBattleData(data)` | 解析整个战局（遍历座位 + wealth 推导） |
| `triggerBattle(data)` | 触发战局（支持三种格式） |
| `NPC.AI_KERNELS` | AI 核心表 |
| `NPC.WEALTH_CLASSES` | 经济阶级表 |
| `NPC.RPG_TEMPLATES` | 异能模版表 |
| `NPC.MOOD_MODIFIERS` | 情绪修正表 |
| `NPC.RUNNER_PRESETS` | 跑龙套预设表 |

### PokerAI

| 方法/属性 | 说明 |
|-----------|------|
| `constructor({riskAppetite, difficulty, emotion})` | 三维个性构造 |
| `setEmotion(type)` | 运行时切换情绪 |
| `EMOTION_PROFILES` | 情绪配置表（静态） |

---

## 七、文件变更清单

| 文件 | 变更 |
|------|------|
| `core/poker-ai.js` | EMOTION_PROFILES, setEmotion(), _applyEmotion() |
| `texas-holdem.js` | getPlayerConfigs 传递 emotion 到 PokerAI |
| `ST/acezero-tavern-plugin.js` | 四维度表 + assembleNPC + resolveBattleData, v0.5 |
| `ST/ACE0战局规则.txt` | v2 重写，NPC 模块化组装文档 |
| `game-config.json` | NPC 可选 emotion 字段 |
| `docs/battle-presets.md` | 本文档 |
