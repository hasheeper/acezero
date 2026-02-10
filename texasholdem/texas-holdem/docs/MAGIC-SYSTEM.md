# 零之王牌 (Ace of Zero) — 魔运扑克 RPG 完整规则

## 概览

《零之王牌》不仅仅是打牌——它是一个结合了 **双位一体切换战术 (Switch System)**、**属性三角克制 (Triad of Fate)**、**生存资源管理 (Survival Economy)** 的深度博弈 RPG。

魔运技能影响**公共牌的发牌权重**，而非直接改变手牌。谁的魔运更强，公共牌就更倾向于对谁有利。

---

## 一、四属性系统 (Attributes)

> 文件：`attribute-system.js`

每个角色拥有四项属性（0~200），影响技能效果和对抗结果。

| 属性 | 名称 | 定位 | 说明 |
|---|---|---|---|
| **天命 (Moirai)** | 世界的顺流 | Rino 专精 | 主宰"强行发好牌"，fortune / fortune_anchor 技能加成 |
| **狂厄 (Chaos)** | 世界的乱流 | 反派专精 | 主宰"干扰与诅咒"，curse 技能加成 |
| **灵视 (Psyche)** | 观察者之眼 | Kazu 专精 | 主宰"识破与读心"，peek / sense / reversal / foresight 加成 |
| **虚无 (Void)** | 绝对防御 | Kazu 前台限定 | % 魔法伤害减免，不参与克制三角 |

### 属性面板（当前配置）

| 角色 | Moirai | Chaos | Psyche | Void |
|---|---|---|---|---|
| **RINO** | 80 | 20 | 50 | 0 |
| **KAZU** | 10 | 10 | 80 | 100 |
| **GAMMA** | 40 | 30 | 25 | 0 |
| **EPSILON** | 10 | 60 | 5 | 0 |

---

## 二、属性三角克制 (The Triad)

> **狂厄 (Chaos)** 克制 → **天命 (Moirai)** — *混乱打破注定的命运*
> **天命 (Moirai)** 克制 → **灵视 (Psyche)** — *绝对运气碾压面前，看穿也没用*
> **灵视 (Psyche)** 克制 → **狂厄 (Chaos)** — *理智剖析疯狂，识破诈唬*

| 关系 | 倍率 |
|---|---|
| 克制对方 | **×1.5** |
| 被对方克制 | **×0.75** |
| 同属性/无关 | ×1.0 |
| Void（任意方向） | ×1.0（不参与克制） |

### 技能→属性映射

| 技能效果 | 所属属性 |
|---|---|
| fortune, fortune_anchor | Moirai |
| curse | Chaos |
| foresight, peek, sense, reversal | Psyche |
| blank, null_field | Void |

---

## 三、前台/后台切换系统 (Switch System)

> 文件：`switch-system.js`

一场牌局由 Rino + Kazu 共同参与，可随时**切换位置**改变战术风格。

### 位置职责

| 位置 | 职责 | 决定属性 |
|---|---|---|
| **前台 (Vanguard)** | 坐在桌上，承担压力，物理牌运 | 基础防御、Void 减伤 |
| **后台 (Rearguard)** | 站在身后，提供魔力，释放魔法 | MP 上限、技能库、属性加成 |

### 两种模式

| 模式 | 前台 | 后台 | 战术定位 |
|---|---|---|---|
| **Mode A（默认）** | Kazu | Rino | 防御型：Kazu 高 Void 抗压 + Rino 后台高爆发施法 |
| **Mode B（特攻）** | Rino | Kazu | 攻击型：Rino 前台天胡起手 + Kazu 后台净化保姆 |

### 切换规则

- **冷却**：切换后 2 轮内不可再切换
- **消耗**：切换消耗 5 点 Sanity（心理压力）
- **Kazu 必须在场**：Kazu 始终占据其中一个位置

### 战术体现

遇到狂厄流 Boss 疯狂扔诅咒：
1. Rino 在前台被 Chaos 克制 Moirai → 被压制
2. 切换 Kazu 上前台 → 高 Void 减伤 + Psyche 克制 Chaos → 反压

---

## 四、战斗公式 (Combat Formula)

> 文件：`combat-formula.js`

### 核心公式

```
EffectivePower = SkillLevel × 10 × (1 + 主手属性/100) × 属性克制倍率
```

- **SkillLevel × 10**：基础 Power（主动技能）
- **(1 + 属性/100)**：属性加成系数（Moirai 80 → ×1.8）
- **克制倍率**：1.5 / 0.75 / 1.0

### Void 减伤（独立层）

```
Final Enemy Power = Enemy EffectivePower ÷ (1 + Void/100)
```

Kazu 前台 Void=100 → 敌方所有魔法效果 **÷2**

### 对抗示例

**Rino 后台 (Moirai 80) 大吉 Lv.5 vs GAMMA (Moirai 40) 爆发 Lv.3：**

```
Rino:  50 × (1 + 0.8) × 1.0 = 90.0  (同属性无克制)
GAMMA: 30 × (1 + 0.4) × 1.0 = 42.0
净值: +48.0 → Rino 碾压
```

**Rino 后台 (Moirai 80) 大吉 vs EPSILON (Chaos 60) 诅咒：**

```
Rino:  50 × 1.8 × 0.75 (被 Chaos 克制) = 67.5
EPSILON: 10 × 1.6 × 1.5 (克制 Moirai) = 24.0
净值: +43.5 → Rino 仍胜，但诅咒独立生效
```

**切换 Kazu 前台 (Psyche 80, Void 100) vs EPSILON (Chaos 60)：**

```
Kazu 后台施法: Psyche 80 → 精神反制
反制力: 30 × 1.8 × 1.5 (Psyche 克制 Chaos) = 81.0
EPSILON 诅咒: 10 × 1.6 × 0.75 (被 Psyche 克制) = 12.0
Void 减伤: 12.0 ÷ 2.0 = 6.0
净值: +75.0 → 完全压制
```

---

## 五、技能总览

### RINO — Mana 100

| 技能 | 类型 | 属性 | Mana | CD | 说明 |
|---|---|---|---|---|---|
| **大吉** ✦ | 主动 fortune | Moirai | 20 | — | best 模式选牌 |
| **小吉** ✧ | 主动 fortune | Moirai | 15 | — | weighted 模式选牌 |
| **先知** 👁 | 主动 foresight | Psyche | 10 | — | 预览3条命运路径 |
| **透视** 🃏 | 主动 peek | Psyche | 10/20/35 | — | 三级透视系统 |
| **逆转** ↺ | 主动 reversal | Psyche | 25 | 2轮 | 厄运→命运（60%效率） |
| **命运之锚** ⚓ | 被动 fortune_anchor | Moirai | — | — | 削弱敌方被动（-15%/级） |
| **感知** 🔮 | 被动 sense | Psyche | — | — | 探测敌方魔力波动 |

### KAZU — 不参与牌局

| 技能 | 类型 | 属性 | Mana | CD | 说明 |
|---|---|---|---|---|---|
| **空白因子** ◇ | 主动 blank | Void | 0 | 3轮 | 打碎一切命运 |
| **概率死角** ∅ | 被动 null_field | Void | — | — | 削弱所有被动力（-20%/级） |

### TARGET_GAMMA — Mana 80

| 技能 | 类型 | 属性 | Power |
|---|---|---|---|
| 幸运（被动） | passive fortune | Moirai | Lv2×3 = **6** |
| 厄运（被动） | passive curse | Chaos | Lv1×3 = **3** |
| 魔运·爆发 | active fortune | Moirai | Lv3×10 = **30** |

### TARGET_EPSILON — Mana 40

| 技能 | 类型 | 属性 | Power |
|---|---|---|---|
| 微弱魔运 | passive fortune | Moirai | Lv1×3 = **3** |
| 野性诅咒 | active curse | Chaos | Lv1×10 = **10** |

---

## 六、透视系统（三级）

| 等级 | 名称 | Mana | 效果 |
|---|---|---|---|
| **Lv.1** | 模糊透视 | 10 | 牌的范围（高/中/低）+ 花色是否相同 |
| **Lv.2** | 深层透视 | 20 | 概率分析：高/中/低概率标记 + 干扰项 |
| **Lv.3** | 完全透视 | 35 | 直接翻开底牌（橙色高亮） |

---

## 七、生存资源管理 (Survival Economy)

> 文件：`survival-economy.js`

**核心设计：Mana 是稀缺资源，不会每轮自动大量回复。**

### 回复手段

| 方式 | 触发条件 | 回复量 | 说明 |
|---|---|---|---|
| **涓流** | 每轮自动 | 2 | 极微量，防止完全卡死 |
| **掠夺 (Siphon)** | Turn/River 阶段敌人弃牌 | 8/人 | 迫使敌人弃牌 = 吸收气势 |
| **大胜 (Epic Win)** | 以时髦牌型获胜 | 10~40 | 同花顺 40 / 同花 18 / 顺子 15 |
| **时髦连胜** | 连续不同牌型获胜 | +5/次 | 最多叠加 3 次 = +15 |
| **场下休息** | 牌局外 RP 剧情 | 大量 | 未来实现 |

### 大胜回蓝表

| 牌型 | 回复量 |
|---|---|
| 皇家同花顺 | 40 |
| 同花顺 | 35 |
| 四条 | 25 |
| 葫芦 | 20 |
| 同花 | 18 |
| 顺子 | 15 |
| 三条 | 10 |
| 两对 | 5 |
| 一对/高牌 | 0 |

### 反噬 (Backlash)

Mana 降至 **0** 时触发：
- 系统级恶运力量 Power=50，持续 3 轮
- 直接针对 RINO，相当于被诅咒

### 体验目标

> 玩家经常处于"这一把我想作弊，但为了两轮后的 Boss 战，我必须忍气吞声靠技术打物理牌"的纠结状态。

---

## 八、力量对抗流水线 (Force Pipeline)

每次发牌前的完整处理流程：

```
1. 收集所有 forces（被动 + pendingForces）
   ↓
2. CombatFormula.enhanceForces()  ← 注入属性加成 + 克制倍率
   ↓
3. 空白因子检查（有则直接纯随机，跳过后续）
   ↓
4. 同类型力量互相抵消（fortune vs fortune, curse vs curse）
   ↓
5. 主动压制被动（等级差额外削弱）
   ↓
6. 命运之锚削弱敌方被动
   ↓
7. 概率死角削弱所有被动
   ↓
8. Void 减伤（CombatFormula.applyVoidReduction）
   ↓
9. 计算命运分 → 选牌
```

### Power 基础公式

```
被动 (passive):   Level × 3
主动 (active):    Level × 10
开关 (toggle):    Level × 8
触发 (triggered): Level × 8
```

### 属性增强后

```
Enhanced Power = Base Power × (1 + 属性值/100) × 克制倍率
```

---

## 九、发牌选择机制

### 命运分

```
DestinyScore = Σ(effectivePower × Outcome) + StyleBonus

fortune:  effectivePower × 持有者胜率
curse:    effectivePower × 目标败率
backlash: effectivePower × Rino败率
```

### 选牌模式

| 模式 | 触发 | 行为 |
|---|---|---|
| **best** | 大吉 | 选命运分最高的牌 |
| **weighted** | 小吉 | 按命运分加权随机 |
| **random** | 无技能/空白因子 | 纯随机 |

### 筛选阶段

| 阶段 | 筛选 |
|---|---|
| Flop | 前2张随机，第3张筛选 |
| Turn | 筛选 |
| River | 筛选 |

### 时髦命运 (Style Bias)

| 牌型 | 权重 |
|---|---|
| 皇家同花顺 | +25 |
| 同花 | +15 |
| 顺子 | +12 |
| 葫芦 | +8 |
| 四条 | +6 |
| 三条 | +3 |
| 一对 | **-3** |

听牌加分：4张同花 +8 / 两头顺 +6 / 卡张顺 +4

---

## 十、技能使用时机

```
PREFLOP → 使用技能 → pendingForces → 可切换前后台
  ↓
FLOP → 收集 forces → 属性增强 → 对抗 → 选牌 → 清空
  ↓
FLOP → 使用技能 → 可切换
  ↓
TURN → 对抗 → 选牌 → 清空（掠夺回蓝窗口）
  ↓
TURN → 使用技能
  ↓
RIVER → 对抗 → 选牌 → 清空（掠夺回蓝窗口）
  ↓
RIVER → fortune/curse/blank 禁用 | 透视/先知仍可用
  ↓
SHOWDOWN → 大胜回蓝结算
```

---

## 十一、重要规则

- **弃牌者魔运失效**：被动 + 已排队的主动全部失效
- **River 禁用**：fortune/curse/blank 按钮禁用
- **空白因子优先级最高**：激活后一切命运归零
- **切换冷却 2 轮**：防止无限切换
- **Mana 不自动大量回复**：只有涓流 2/轮，需要掠夺/大胜回蓝

---

## 十二、系统架构

```
texas-holdem.html
  ├── deck.js / pokersolver.js     (基础库)
  ├── poker-ai.js                  (NPC AI)
  ├── game-logger.js               (日志)
  ├── skill-system.js              (技能注册/mana/forces)
  ├── attribute-system.js    [NEW] (四属性/克制关系)
  ├── switch-system.js       [NEW] (前台/后台切换)
  ├── combat-formula.js      [NEW] (属性增强+Void减伤)
  ├── survival-economy.js    [NEW] (生存资源管理)
  ├── monte-of-zero.js             (命运引擎)
  ├── skill-ui.js                  (技能UI)
  └── texas-holdem.js              (游戏主逻辑)
```

### 数据流

```
game-config.json
  → AttributeSystem.registerFromConfig()  (属性面板)
  → SkillSystem.registerFromConfig()      (技能注册)
  → SwitchSystem (初始化前后台)
  → CombatFormula (注入到 MonteOfZero)
  → SurvivalEconomy (绑定 SkillSystem)
```
