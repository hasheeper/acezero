/**
 * ===========================================
 * CURRENCY.JS - 筹码与货币显示系统
 * ===========================================
 *
 * 世界观货币体系:
 *   1 金弗 (金芙洛林) = 100 银弗 (银芙洛林)
 *   1 银弗 = 100 铜弗 (铜芙洛林)
 *
 * 内部基准单位: 1 = 1 银弗 (所有 chips/pot/bet 均为银弗整数)
 *
 * 赌场筹码面额 (以银弗为单位):
 *   白色 =      1 银弗  (1银)
 *   绿色 =     10 银弗  (10银)
 *   蓝色 =    100 银弗  (1金)
 *   红色 =   1000 银弗  (10金)
 *   紫色 =  10000 银弗  (100金)
 *   黑色 = 100000 银弗  (1000金)
 */

(function (global) {
  'use strict';

  // ============================================
  // 筹码面额表 (降序排列，贪心分解用)
  // ============================================
  const CHIP_TABLE = [
    { value: 100000, color: 'black',  label: '黑晶', lore: '1000金' },
    { value: 10000,  color: 'purple', label: '紫晶', lore: '100金'  },
    { value: 1000,   color: 'red',    label: '绯红', lore: '10金'   },
    { value: 100,    color: 'blue',   label: '深蓝', lore: '1金'    },
    { value: 10,     color: 'green',  label: '翠绿', lore: '10银'   },
    { value: 1,      color: 'white',  label: '纯白', lore: '1银'    }
  ];

  // 汇率常量
  const SILVER_PER_GOLD = 100;

  // ============================================
  // 核心格式化: 银弗整数 → 人类可读货币字符串
  // ============================================

  /**
   * 将银弗数值格式化为可读货币字符串
   * @param {number} silver - 银弗数量 (整数)
   * @param {object} [opts] - 选项
   * @param {string} [opts.mode='short'] - 'short'|'full'|'chip'
   *   short: "10金50银" / "30银"  (默认，UI 用)
   *   full:  "10金弗50银弗"       (叙事/日志用)
   *   chip:  "1×绯红 + 2×深蓝"   (筹码分解)
   * @param {boolean} [opts.alwaysGold=false] - 强制显示金单位 (即使为0)
   * @returns {string}
   */
  function formatCurrency(silver, opts) {
    opts = opts || {};
    var mode = opts.mode || 'short';
    var val = Math.round(silver) || 0;
    var negative = val < 0;
    if (negative) val = -val;

    if (mode === 'chip') {
      return (negative ? '-' : '') + _formatChipDecompose(val);
    }

    var gold = Math.floor(val / SILVER_PER_GOLD);
    var rem  = val % SILVER_PER_GOLD;

    var suffix = mode === 'full' ? '弗' : '';
    var parts = [];

    if (gold > 0 || opts.alwaysGold) {
      parts.push(gold.toLocaleString() + '金' + suffix);
    }
    if (rem > 0 || parts.length === 0) {
      parts.push(rem + '银' + suffix);
    }

    return (negative ? '-' : '') + parts.join('');
  }

  /**
   * 紧凑格式: 用于 UI 中空间有限的位置
   * 优先显示最大单位，省略零头
   * 例: 1500 → "15金", 1050 → "10金50银", 30 → "30银"
   * @param {number} silver
   * @returns {string}
   */
  function formatCompact(silver) {
    var val = Math.round(silver) || 0;
    var negative = val < 0;
    if (negative) val = -val;

    var gold = Math.floor(val / SILVER_PER_GOLD);
    var rem  = val % SILVER_PER_GOLD;

    var str;
    if (gold > 0 && rem > 0) {
      str = gold.toLocaleString() + '金' + rem + '银';
    } else if (gold > 0) {
      str = gold.toLocaleString() + '金';
    } else {
      str = rem + '银';
    }
    return (negative ? '-' : '') + str;
  }

  /**
   * 纯数字格式: 用于需要简洁数字的地方 (如 CALL 按钮)
   * 大额用金，小额用银
   * 例: 1500 → "15金", 50 → "50银", 1050 → "10.5金"
   * @param {number} silver
   * @returns {string}
   */
  function formatAmount(silver) {
    var val = Math.round(silver) || 0;
    var negative = val < 0;
    if (negative) val = -val;

    var str;
    if (val >= SILVER_PER_GOLD) {
      var gold = val / SILVER_PER_GOLD;
      // 如果整除，不显示小数
      if (val % SILVER_PER_GOLD === 0) {
        str = gold + '金';
      } else {
        // 保留最多1位小数
        str = (Math.round(gold * 10) / 10) + '金';
      }
    } else {
      str = val + '银';
    }
    return (negative ? '-' : '') + str;
  }

  // ============================================
  // 筹码分解: 贪心算法，从大到小
  // ============================================

  /**
   * 将银弗数值分解为筹码堆
   * @param {number} silver - 银弗数量
   * @returns {Array<{color: string, label: string, count: number, value: number}>}
   */
  function decomposeChips(silver) {
    var remaining = Math.round(silver) || 0;
    var result = [];

    for (var i = 0; i < CHIP_TABLE.length; i++) {
      var chip = CHIP_TABLE[i];
      if (remaining >= chip.value) {
        var count = Math.floor(remaining / chip.value);
        remaining = remaining % chip.value;
        result.push({
          color: chip.color,
          label: chip.label,
          count: count,
          value: chip.value
        });
      }
    }

    return result;
  }

  /**
   * 筹码分解的文字表示
   * @param {number} silver
   * @returns {string} 例: "1×绯红 + 2×深蓝 + 3×纯白"
   */
  function _formatChipDecompose(silver) {
    var stacks = decomposeChips(silver);
    if (stacks.length === 0) return '0';
    return stacks.map(function (s) {
      return s.count + '×' + s.label;
    }).join(' + ');
  }

  // ============================================
  // 筹码颜色: 根据数值返回最接近的筹码颜色
  // 用于 UI 中筹码视觉显示
  // ============================================

  /**
   * 根据银弗数值返回对应的筹码颜色 CSS class
   * 取面额最接近的筹码颜色
   * @param {number} silver
   * @returns {string} 'white'|'green'|'blue'|'red'|'purple'|'black'
   */
  function getChipColor(silver) {
    var val = Math.abs(Math.round(silver)) || 0;
    // 从大到小匹配
    if (val >= 100000) return 'black';
    if (val >= 10000)  return 'purple';
    if (val >= 1000)   return 'red';
    if (val >= 100)    return 'blue';
    if (val >= 10)     return 'green';
    return 'white';
  }

  /**
   * 根据底池/下注数值决定视觉筹码堆的数量和颜色
   * @param {number} silver
   * @returns {{count: number, color: string}}
   */
  function getChipVisual(silver) {
    var val = Math.abs(Math.round(silver)) || 0;
    var count = 2;
    if (val > 100)   count = 3;
    if (val > 500)   count = 4;
    if (val > 2000)  count = 5;
    if (val > 5000)  count = 6;

    return { count: count, color: getChipColor(val) };
  }

  // ============================================
  // HTML 彩色输出 (金=金色, 银=银色)
  // ============================================

  var GOLD_CSS  = 'color:#CFB53B;font-weight:700';
  var SILVER_CSS = 'color:#C0C0C0;font-weight:700';

  /**
   * 彩色 HTML: 金色数字 + 银色数字，分开显示
   * 例: 980 → '<span style="color:#CFB53B;font-weight:700">9金</span><span style="color:#C0C0C0;font-weight:700">80银</span>'
   * 例: 1000 → '<span style="color:#CFB53B;font-weight:700">10金</span>'
   * 例: 50 → '<span style="color:#C0C0C0;font-weight:700">50银</span>'
   * @param {number} silver
   * @returns {string} HTML string
   */
  function formatHtml(silver) {
    var val = Math.round(silver) || 0;
    var negative = val < 0;
    if (negative) val = -val;

    var gold = Math.floor(val / SILVER_PER_GOLD);
    var rem  = val % SILVER_PER_GOLD;
    var parts = [];

    if (negative) parts.push('-');

    if (gold > 0) {
      parts.push('<span style="' + GOLD_CSS + '">' + gold.toLocaleString() + '金</span>');
    }
    if (rem > 0 || gold === 0) {
      parts.push('<span style="' + SILVER_CSS + '">' + rem + '银</span>');
    }

    return parts.join('');
  }

  /**
   * 彩色 HTML (单一单位): 大额用金色，小额用银色
   * 用于按钮等空间有限的地方
   * 例: 1500 → '<span style="...">15金</span>'
   * 例: 50 → '<span style="...">50银</span>'
   * 例: 1050 → '<span style="...">10.5金</span>'
   * @param {number} silver
   * @returns {string} HTML string
   */
  function formatHtmlAmount(silver) {
    var val = Math.round(silver) || 0;
    var negative = val < 0;
    if (negative) val = -val;

    var prefix = negative ? '-' : '';

    if (val >= SILVER_PER_GOLD) {
      var gold = val / SILVER_PER_GOLD;
      var str;
      if (val % SILVER_PER_GOLD === 0) {
        str = gold + '金';
      } else {
        str = (Math.round(gold * 10) / 10) + '金';
      }
      return prefix + '<span style="' + GOLD_CSS + '">' + str + '</span>';
    } else {
      return prefix + '<span style="' + SILVER_CSS + '">' + val + '银</span>';
    }
  }

  // ============================================
  // 导出
  // ============================================
  var Currency = {
    CHIP_TABLE: CHIP_TABLE,
    SILVER_PER_GOLD: SILVER_PER_GOLD,
    format: formatCurrency,
    compact: formatCompact,
    amount: formatAmount,
    html: formatHtml,
    htmlAmount: formatHtmlAmount,
    decompose: decomposeChips,
    chipColor: getChipColor,
    chipVisual: getChipVisual
  };

  global.Currency = Currency;

})(typeof window !== 'undefined' ? window : global);
