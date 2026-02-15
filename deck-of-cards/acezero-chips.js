(function (global) {
  'use strict';

  function _buildChipStack(color) {
    var chip = document.createElement('div');
    chip.className = 'chip-stack ' + (color || 'white');
    chip.innerHTML = '<div class="chip-ring"></div><div class="chip-inlay"></div>';
    return chip;
  }

  function renderPotClusters(container, amount, currency) {
    if (!container) return;
    container.innerHTML = '';
    if (!currency || amount <= 0) return;

    var vis = currency.chipVisual(amount);
    for (var i = 0; i < vis.count; i++) {
      var chip = _buildChipStack(vis.color);
      chip.style.top = String(i * -6) + 'px';
      chip.style.zIndex = String(i + 1);
      container.appendChild(chip);
    }
  }

  function updateSeatBetChips(betChipsEl, amount, currency) {
    if (!betChipsEl || !currency) return;

    if (amount > 0) {
      betChipsEl.style.display = 'flex';

      var amountEl = betChipsEl.querySelector('.chip-amount');
      if (amountEl) amountEl.innerHTML = currency.htmlAmount(amount);

      var chipStack = betChipsEl.querySelector('.chip-stack');
      var chipType = currency.chipColor(amount);

      if (!chipStack) {
        chipStack = _buildChipStack(chipType);
        betChipsEl.insertBefore(chipStack, amountEl || null);
      } else {
        chipStack.className = 'chip-stack ' + chipType;
      }
    } else {
      betChipsEl.style.display = 'none';
    }
  }

  global.AceZeroChips = {
    buildChipStack: _buildChipStack,
    renderPotClusters: renderPotClusters,
    updateSeatBetChips: updateSeatBetChips
  };
})(typeof window !== 'undefined' ? window : global);
