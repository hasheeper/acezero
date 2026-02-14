# ACE0 测试配置速查

> 所有配置可直接复制粘贴到 `game-config.json`。
> NPC 席位保持 4 人不变（波普/莉莉卡/夜伽希亚/天宫理乃），hero 席位 CO。
> 当某角色作为 hero 主手/副手时，该角色从 NPC 席位移除，替换为通用 NPC。

---

## 一、默认配置（KAZU 主手 + RINO 副手）

当前 `game-config.json` 的默认配置。

```json
{
  "blinds": [10, 20],
  "chips": 1000,
  "heroChips": 1000,

  "hero": {
    "vanguard": { "name": "KAZU", "level": 5, "trait": "null_armor" },
    "rearguard": { "name": "RINO", "level": 5, "trait": "obsessive_love" },
    "attrs": { "moirai": 80, "chaos": 20, "psyche": 40, "void": 100 },
    "vanguardSkills": ["reality", "insulation", "refraction", "static_field"],
    "rearguardSkills": ["royal_decree", "divine_order", "grand_wish", "heart_read"],
    "mana": 100,
    "maxMana": 100
  },

  "heroSeat": "CO",

  "seats": {
    "BTN": {
      "vanguard": { "name": "波普", "level": 5, "trait": "four_leaf_clover" },
      "ai": "passive", "difficulty": "noob", "emotion": "scared",
      "attrs": { "moirai": 25, "chaos": 0, "psyche": 10, "void": 20 },
      "skills": ["miracle", "lucky_find"]
    },
    "SB": {
      "vanguard": { "name": "莉莉卡", "level": 5, "trait": "laser_eye" },
      "rearguard": { "name": "LILIKA_REAR", "level": 4, "trait": "service_fee" },
      "ai": "balanced", "difficulty": "pro", "emotion": "playful",
      "attrs": { "moirai": 10, "chaos": 30, "psyche": 80, "void": 0 },
      "skills": ["clairvoyance", "refraction", "clarity", "card_swap"]
    },
    "BB": {
      "vanguard": { "name": "夜伽希亚", "level": 5, "trait": "death_ledger" },
      "rearguard": { "name": "SIA_REAR", "level": 4, "trait": "binding_protocol" },
      "ai": "aggressive", "difficulty": "boss", "emotion": "confident",
      "attrs": { "moirai": 30, "chaos": 80, "psyche": 10, "void": 0 },
      "skills": ["cooler", "havoc", "hex", "skill_seal"]
    },
    "HJ": {
      "vanguard": { "name": "天宫理乃", "level": 5, "trait": "crimson_crown" },
      "rearguard": { "name": "RINO_REAR", "level": 4, "trait": "obsessive_love" },
      "ai": "aggressive", "difficulty": "boss", "emotion": "confident",
      "attrs": { "moirai": 80, "chaos": 20, "psyche": 30, "void": 0 },
      "skills": ["royal_decree", "grand_wish", "minor_wish", "heart_read"]
    }
  }
}
```

---

## 二、KAZU 副手配置（其他角色主手 + KAZU 副手）

### 2A. RINO 主手 + KAZU 副手

RINO 前台输出 Moirai fortune，KAZU 后台提供 Psyche 支援 + steady_hand 减 curse。
NPC 席位：天宫理乃 替换为通用 boss。

```json
{
  "blinds": [10, 20],
  "chips": 1000,
  "heroChips": 1000,

  "hero": {
    "vanguard": { "name": "RINO", "level": 5, "trait": "crimson_crown" },
    "rearguard": { "name": "KAZU", "level": 5, "trait": "steady_hand" },
    "attrs": { "moirai": 80, "chaos": 20, "psyche": 40, "void": 100 },
    "vanguardSkills": ["royal_decree", "divine_order", "grand_wish", "heart_read"],
    "rearguardSkills": ["reality", "insulation", "refraction", "static_field"],
    "mana": 100,
    "maxMana": 100
  },

  "heroSeat": "CO",

  "seats": {
    "BTN": {
      "vanguard": { "name": "波普", "level": 5, "trait": "four_leaf_clover" },
      "ai": "passive", "difficulty": "noob", "emotion": "scared",
      "attrs": { "moirai": 25, "chaos": 0, "psyche": 10, "void": 20 },
      "skills": ["miracle", "lucky_find"]
    },
    "SB": {
      "vanguard": { "name": "莉莉卡", "level": 5, "trait": "laser_eye" },
      "rearguard": { "name": "LILIKA_REAR", "level": 4, "trait": "service_fee" },
      "ai": "balanced", "difficulty": "pro", "emotion": "playful",
      "attrs": { "moirai": 10, "chaos": 30, "psyche": 80, "void": 0 },
      "skills": ["clairvoyance", "refraction", "clarity", "card_swap"]
    },
    "BB": {
      "vanguard": { "name": "夜伽希亚", "level": 5, "trait": "death_ledger" },
      "rearguard": { "name": "SIA_REAR", "level": 4, "trait": "binding_protocol" },
      "ai": "aggressive", "difficulty": "boss", "emotion": "confident",
      "attrs": { "moirai": 30, "chaos": 80, "psyche": 10, "void": 0 },
      "skills": ["cooler", "havoc", "hex", "skill_seal"]
    },
    "HJ": {
      "vanguard": { "name": "通用BOSS", "level": 5, "trait": "blank_body" },
      "ai": "aggressive", "difficulty": "boss", "emotion": "confident",
      "attrs": { "moirai": 50, "chaos": 50, "psyche": 20, "void": 0 },
      "skills": ["grand_wish", "havoc", "hex", "minor_wish"]
    }
  }
}
```

### 2B. SIA 主手 + KAZU 副手

SIA 前台输出 Chaos curse，KAZU 后台 Void 减伤 + steady_hand。
NPC 席位：夜伽希亚 替换为通用 boss。

```json
{
  "blinds": [10, 20],
  "chips": 1000,
  "heroChips": 1000,

  "hero": {
    "vanguard": { "name": "SIA", "level": 5, "trait": "death_ledger" },
    "rearguard": { "name": "KAZU", "level": 5, "trait": "steady_hand" },
    "attrs": { "moirai": 30, "chaos": 80, "psyche": 40, "void": 100 },
    "vanguardSkills": ["cooler", "catastrophe", "skill_seal", "havoc"],
    "rearguardSkills": ["reality", "insulation", "refraction", "static_field"],
    "mana": 100,
    "maxMana": 100
  },

  "heroSeat": "CO",

  "seats": {
    "BTN": {
      "vanguard": { "name": "波普", "level": 5, "trait": "four_leaf_clover" },
      "ai": "passive", "difficulty": "noob", "emotion": "scared",
      "attrs": { "moirai": 25, "chaos": 0, "psyche": 10, "void": 20 },
      "skills": ["miracle", "lucky_find"]
    },
    "SB": {
      "vanguard": { "name": "莉莉卡", "level": 5, "trait": "laser_eye" },
      "rearguard": { "name": "LILIKA_REAR", "level": 4, "trait": "service_fee" },
      "ai": "balanced", "difficulty": "pro", "emotion": "playful",
      "attrs": { "moirai": 10, "chaos": 30, "psyche": 80, "void": 0 },
      "skills": ["clairvoyance", "refraction", "clarity", "card_swap"]
    },
    "BB": {
      "vanguard": { "name": "通用BOSS", "level": 5, "trait": "blank_body" },
      "ai": "aggressive", "difficulty": "boss", "emotion": "confident",
      "attrs": { "moirai": 50, "chaos": 50, "psyche": 20, "void": 0 },
      "skills": ["grand_wish", "havoc", "hex", "minor_wish"]
    },
    "HJ": {
      "vanguard": { "name": "天宫理乃", "level": 5, "trait": "crimson_crown" },
      "rearguard": { "name": "RINO_REAR", "level": 4, "trait": "obsessive_love" },
      "ai": "aggressive", "difficulty": "boss", "emotion": "confident",
      "attrs": { "moirai": 80, "chaos": 20, "psyche": 30, "void": 0 },
      "skills": ["royal_decree", "grand_wish", "minor_wish", "heart_read"]
    }
  }
}
```

### 2C. LILIKA 主手 + KAZU 副手

LILIKA 前台 Psyche 信息战 + 幻术，KAZU 后台 Void 减伤。
NPC 席位：莉莉卡 替换为通用 pro。

```json
{
  "blinds": [10, 20],
  "chips": 1000,
  "heroChips": 1000,

  "hero": {
    "vanguard": { "name": "LILIKA", "level": 5, "trait": "laser_eye" },
    "rearguard": { "name": "KAZU", "level": 5, "trait": "steady_hand" },
    "attrs": { "moirai": 10, "chaos": 30, "psyche": 80, "void": 100 },
    "vanguardSkills": ["clairvoyance", "axiom", "card_swap", "refraction"],
    "rearguardSkills": ["reality", "insulation", "refraction", "static_field"],
    "mana": 100,
    "maxMana": 100
  },

  "heroSeat": "CO",

  "seats": {
    "BTN": {
      "vanguard": { "name": "波普", "level": 5, "trait": "four_leaf_clover" },
      "ai": "passive", "difficulty": "noob", "emotion": "scared",
      "attrs": { "moirai": 25, "chaos": 0, "psyche": 10, "void": 20 },
      "skills": ["miracle", "lucky_find"]
    },
    "SB": {
      "vanguard": { "name": "通用PRO", "level": 5, "trait": "blank_body" },
      "ai": "balanced", "difficulty": "pro", "emotion": "calm",
      "attrs": { "moirai": 40, "chaos": 30, "psyche": 30, "void": 0 },
      "skills": ["grand_wish", "havoc", "clarity", "minor_wish"]
    },
    "BB": {
      "vanguard": { "name": "夜伽希亚", "level": 5, "trait": "death_ledger" },
      "rearguard": { "name": "SIA_REAR", "level": 4, "trait": "binding_protocol" },
      "ai": "aggressive", "difficulty": "boss", "emotion": "confident",
      "attrs": { "moirai": 30, "chaos": 80, "psyche": 10, "void": 0 },
      "skills": ["cooler", "havoc", "hex", "skill_seal"]
    },
    "HJ": {
      "vanguard": { "name": "天宫理乃", "level": 5, "trait": "crimson_crown" },
      "rearguard": { "name": "RINO_REAR", "level": 4, "trait": "obsessive_love" },
      "ai": "aggressive", "difficulty": "boss", "emotion": "confident",
      "attrs": { "moirai": 80, "chaos": 20, "psyche": 30, "void": 0 },
      "skills": ["royal_decree", "grand_wish", "minor_wish", "heart_read"]
    }
  }
}
```

### 2D. POPPO 主手 + KAZU 副手

POPPO 前台被动触发 + 四叶草，KAZU 后台 Void 减伤。低属性组合，适合测试弱势局。
NPC 席位：波普 替换为通用 noob。

```json
{
  "blinds": [10, 20],
  "chips": 1000,
  "heroChips": 1000,

  "hero": {
    "vanguard": { "name": "POPPO", "level": 5, "trait": "four_leaf_clover" },
    "rearguard": { "name": "KAZU", "level": 5, "trait": "steady_hand" },
    "attrs": { "moirai": 25, "chaos": 0, "psyche": 40, "void": 100 },
    "vanguardSkills": ["miracle", "lucky_find"],
    "rearguardSkills": ["reality", "insulation", "refraction", "static_field"],
    "mana": 100,
    "maxMana": 100
  },

  "heroSeat": "CO",

  "seats": {
    "BTN": {
      "vanguard": { "name": "通用NOOB", "level": 3, "trait": null },
      "ai": "passive", "difficulty": "noob", "emotion": "scared",
      "attrs": { "moirai": 15, "chaos": 10, "psyche": 5, "void": 0 },
      "skills": ["minor_wish"]
    },
    "SB": {
      "vanguard": { "name": "莉莉卡", "level": 5, "trait": "laser_eye" },
      "rearguard": { "name": "LILIKA_REAR", "level": 4, "trait": "service_fee" },
      "ai": "balanced", "difficulty": "pro", "emotion": "playful",
      "attrs": { "moirai": 10, "chaos": 30, "psyche": 80, "void": 0 },
      "skills": ["clairvoyance", "refraction", "clarity", "card_swap"]
    },
    "BB": {
      "vanguard": { "name": "夜伽希亚", "level": 5, "trait": "death_ledger" },
      "rearguard": { "name": "SIA_REAR", "level": 4, "trait": "binding_protocol" },
      "ai": "aggressive", "difficulty": "boss", "emotion": "confident",
      "attrs": { "moirai": 30, "chaos": 80, "psyche": 10, "void": 0 },
      "skills": ["cooler", "havoc", "hex", "skill_seal"]
    },
    "HJ": {
      "vanguard": { "name": "天宫理乃", "level": 5, "trait": "crimson_crown" },
      "rearguard": { "name": "RINO_REAR", "level": 4, "trait": "obsessive_love" },
      "ai": "aggressive", "difficulty": "boss", "emotion": "confident",
      "attrs": { "moirai": 80, "chaos": 20, "psyche": 30, "void": 0 },
      "skills": ["royal_decree", "grand_wish", "minor_wish", "heart_read"]
    }
  }
}
```

---

## 三、四角色主手配置（角色主手 + RINO/其他副手）

### 3A. RINO 主手 + RINO 副手（纯 Moirai 极限）

双 RINO 不合理（同一角色），但可用于测试 Moirai 极限输出。

```json
  "hero": {
    "vanguard": { "name": "RINO", "level": 5, "trait": "crimson_crown" },
    "rearguard": { "name": "RINO", "level": 5, "trait": "obsessive_love" },
    "attrs": { "moirai": 80, "chaos": 20, "psyche": 30, "void": 0 },
    "vanguardSkills": ["royal_decree", "divine_order", "grand_wish", "heart_read"],
    "rearguardSkills": ["royal_decree", "divine_order", "grand_wish", "heart_read"],
    "mana": 100,
    "maxMana": 100
  }
```

### 3B. SIA 主手 + RINO 副手（Chaos 攻击 + Moirai 保险）

SIA 前台 curse 输出，RINO 后台 fortune 保底。crimson_crown 加成 RINO 的 fortune。

```json
  "hero": {
    "vanguard": { "name": "SIA", "level": 5, "trait": "death_ledger" },
    "rearguard": { "name": "RINO", "level": 5, "trait": "obsessive_love" },
    "attrs": { "moirai": 80, "chaos": 80, "psyche": 30, "void": 0 },
    "vanguardSkills": ["cooler", "catastrophe", "skill_seal", "havoc"],
    "rearguardSkills": ["royal_decree", "divine_order", "grand_wish", "heart_read"],
    "mana": 100,
    "maxMana": 100
  }
```

### 3C. LILIKA 主手 + RINO 副手（Psyche 信息 + Moirai 输出）

LILIKA 前台 Psyche 反制 + 幻术，RINO 后台 fortune 输出。

```json
  "hero": {
    "vanguard": { "name": "LILIKA", "level": 5, "trait": "laser_eye" },
    "rearguard": { "name": "RINO", "level": 5, "trait": "obsessive_love" },
    "attrs": { "moirai": 80, "chaos": 30, "psyche": 80, "void": 0 },
    "vanguardSkills": ["clairvoyance", "axiom", "card_swap", "refraction"],
    "rearguardSkills": ["royal_decree", "divine_order", "grand_wish", "heart_read"],
    "mana": 100,
    "maxMana": 100
  }
```

### 3D. POPPO 主手 + RINO 副手（绝境触发 + Moirai 保底）

POPPO 前台被动触发，RINO 后台主动 fortune。适合测试绝境翻盘。

```json
  "hero": {
    "vanguard": { "name": "POPPO", "level": 5, "trait": "four_leaf_clover" },
    "rearguard": { "name": "RINO", "level": 5, "trait": "obsessive_love" },
    "attrs": { "moirai": 80, "chaos": 20, "psyche": 30, "void": 20 },
    "vanguardSkills": ["miracle", "lucky_find"],
    "rearguardSkills": ["royal_decree", "divine_order", "grand_wish", "heart_read"],
    "mana": 100,
    "maxMana": 100
  }
```

---

## 四、角色属性 & 技能速查表

| 角色 | 位置 | Lv5 属性 (M/C/P/V) | 主手特质 | 副手特质 | 专属技能 |
|------|------|---------------------|----------|----------|----------|
| KAZU | 主手 | 0/0/40/100 | null_armor | steady_hand | — |
| RINO | 副手 | 80/20/30/0 | crimson_crown | obsessive_love | royal_decree, heart_read |
| SIA | 主手 | 30/80/10/0 | death_ledger | binding_protocol | cooler, skill_seal |
| LILIKA | 主手 | 10/30/80/0 | laser_eye | service_fee | clairvoyance, card_swap |
| POPPO | 副手 | 25/0/10/20 | four_leaf_clover | cockroach | miracle, lucky_find |

### 技能推导结果（Lv5）

| 角色 | 推导技能（按 Tier 排序） |
|------|--------------------------|
| KAZU | reality(V-T1), insulation(V-T2), refraction(P-T2), static_field(V-T3) |
| RINO | royal_decree(M-T0), divine_order(M-T1), grand_wish(M-T2), heart_read(P-T2) |
| SIA | cooler(C-T0), catastrophe(C-T1), skill_seal(C-T1), havoc(C-T2) |
| LILIKA | clairvoyance(P-T0), axiom(P-T1), card_swap(C-T1), refraction(P-T2) |
| POPPO | miracle(M-T0), lucky_find(M-T0) |

### 特质效果速查

| 特质 | 效果 |
|------|------|
| null_armor | Void 减伤 +30%，己方 fortune -15% |
| steady_hand | 受到的 curse -10% |
| crimson_crown | 己方 fortune +25%，受到的 curse +15% |
| obsessive_love | 落后时 fortune +20%（被动P10），领先时 fortune -10%（被动curse P5） |
| death_ledger | curse 穿透 25% Void 减伤 |
| binding_protocol | 所有技能 power -10% |
| laser_eye | Psyche 反制力量增强（_psycheAmp 标记） |
| service_fee | 己方 fortune -20%（TODO: mana 窃取） |
| four_leaf_clover | 被动 fortune 随筹码减少增强（越惨越强） |
| cockroach | 每手牌首次 curse 减半 |

---

## 五、NPC 替换模板

当某角色从 NPC 移到 hero 时，用以下模板替换空出的席位：

### 通用 BOSS（替换天宫理乃/夜伽希亚）
```json
{
  "vanguard": { "name": "通用BOSS", "level": 5, "trait": "blank_body" },
  "ai": "aggressive", "difficulty": "boss", "emotion": "confident",
  "attrs": { "moirai": 50, "chaos": 50, "psyche": 20, "void": 0 },
  "skills": ["grand_wish", "havoc", "hex", "minor_wish"]
}
```

### 通用 PRO（替换莉莉卡）
```json
{
  "vanguard": { "name": "通用PRO", "level": 5, "trait": "blank_body" },
  "ai": "balanced", "difficulty": "pro", "emotion": "calm",
  "attrs": { "moirai": 40, "chaos": 30, "psyche": 30, "void": 0 },
  "skills": ["grand_wish", "havoc", "clarity", "minor_wish"]
}
```

### 通用 NOOB（替换波普）
```json
{
  "vanguard": { "name": "通用NOOB", "level": 3, "trait": null },
  "ai": "passive", "difficulty": "noob", "emotion": "scared",
  "attrs": { "moirai": 15, "chaos": 10, "psyche": 5, "void": 0 },
  "skills": ["minor_wish"]
}
```
