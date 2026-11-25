/* Финансовый калькулятор организации.
   Все расчёты выполняются в браузере, данные никуда не отправляются.
   Деньги внутри хранятся в копейках (целые числа), чтобы не было ошибок округления. */
(function () {
  'use strict';

  var MAX_RUBLES = 1000000000000; // 1 трлн ₽ — верхняя граница для одного поля
  var NBSP = ' ';
  var MINUS = '−';

  var FIELD_IDS = ['revenue', 'variable', 'fixed'];

  // Общие функции разбора и форматирования нужны и модулю ИИ-прогноза (forecast.js)
  window.FinCalc = {
    parseAmount: function (raw) { return parseAmount(raw); },
    formatMoney: function (kopecks) { return formatMoney(kopecks); },
    formatPercent: function (value) { return formatPercent(value); }
  };

  var form = document.getElementById('calc-form');
  var resetButton = document.getElementById('reset-button');
  var resultBox = document.getElementById('result');
  var placeholder = document.getElementById('result-placeholder');

  var out = {
    profit: document.getElementById('profit-value'),
    status: document.getElementById('profit-status'),
    margin: document.getElementById('margin-value'),
    marginNote: document.getElementById('margin-note'),
    revenueValue: document.getElementById('chart-revenue-value'),
    revenueBar: document.getElementById('chart-revenue-bar'),
    revenueTip: document.getElementById('tip-revenue'),
    costsValue: document.getElementById('chart-costs-value'),
    costsBar: document.getElementById('chart-costs-bar'),
    costsTip: document.getElementById('tip-costs')
  };

  /* ---------- Разбор и проверка ввода ---------- */

  // Возвращает { kopecks: целое число } или { error: 'текст подсказки' }.
  function parseAmount(raw) {
    var text = String(raw)
      .replace(/[\s  ]/g, '') // пробелы между разрядами допустимы
      .replace(/−/g, '-')          // типографский минус
      .replace(',', '.');               // запятая как десятичный разделитель

    if (text === '') {
      return { error: 'Заполните поле. Если значение равно нулю, введите 0.' };
    }
    if (/^-\d+(\.\d+)?$/.test(text)) {
      return { error: 'Значение не может быть отрицательным.' };
    }
    if (!/^\d+(\.\d+)?$/.test(text)) {
      return { error: 'Введите число, например 500000 или 1250,50.' };
    }
    if (!/^\d+(\.\d{1,2})?$/.test(text)) {
      return { error: 'Укажите не более двух знаков после запятой (копейки).' };
    }

    var rubles = Number(text);
    if (!isFinite(rubles) || rubles > MAX_RUBLES) {
      return { error: 'Слишком большое число. Максимум — 1 000 000 000 000 ₽.' };
    }
    return { kopecks: Math.round(rubles * 100) };
  }

  /* ---------- Расчёт ---------- */

  // Все значения — в копейках. margin — в процентах или null, если не определяется.
  function calculate(revenue, variable, fixed) {
    var costs = variable + fixed;
    var profit = revenue - costs;
    var margin = revenue > 0 ? (profit / revenue) * 100 : null;
    return { revenue: revenue, variable: variable, fixed: fixed, costs: costs, profit: profit, margin: margin };
  }

  /* ---------- Форматирование ---------- */

  // 8000000 коп. -> «80 000 ₽»; -5000050 коп. -> «−50 000,50 ₽»
  function formatMoney(kopecks) {
    var abs = Math.abs(kopecks);
    var rubles = Math.floor(abs / 100);
    var rest = abs % 100;
    var text = String(rubles).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
    if (rest > 0) {
      text += ',' + (rest < 10 ? '0' : '') + rest;
    }
    return (kopecks < 0 ? MINUS : '') + text + NBSP + '₽';
  }

  // 16 -> «16,0%»; -12.5 -> «−12,5%»; null -> «Не определяется»
  function formatPercent(value) {
    if (value === null || !isFinite(value)) {
      return 'Не определяется';
    }
    var fixed = Math.abs(value).toFixed(1);
    var sign = value < 0 && fixed !== '0.0' ? MINUS : '';
    var parts = fixed.split('.');
    var whole = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
    return sign + whole + ',' + parts[1] + '%';
  }

  /* ---------- Вывод ---------- */

  function setFieldError(id, message) {
    var input = document.getElementById(id);
    document.getElementById(id + '-error').textContent = message;
    if (message) {
      input.setAttribute('aria-invalid', 'true');
    } else {
      input.removeAttribute('aria-invalid');
    }
  }

  function showResult(r) {
    out.profit.textContent = formatMoney(r.profit);

    out.status.className = 'status';
    if (r.profit < 0) {
      out.status.textContent = '▼ Убыток';
      out.status.classList.add('status-loss');
    } else if (r.profit === 0) {
      out.status.textContent = '● Безубыточность';
      out.status.classList.add('status-zero');
    } else {
      out.status.textContent = '▲ Прибыль';
      out.status.classList.add('status-profit');
    }

    out.margin.textContent = formatPercent(r.margin);
    out.marginNote.textContent = r.margin === null
      ? 'При нулевой выручке рентабельность продаж не рассчитывается.'
      : '';

    // Диаграмма: оба столбца в одном масштабе, от общей базовой линии
    var max = Math.max(r.revenue, r.costs);
    out.revenueBar.style.width = max > 0 ? (r.revenue / max) * 100 + '%' : '0';
    out.costsBar.style.width = max > 0 ? (r.costs / max) * 100 + '%' : '0';
    out.revenueValue.textContent = formatMoney(r.revenue);
    out.costsValue.textContent = formatMoney(r.costs);
    out.revenueTip.textContent = 'Выручка: ' + formatMoney(r.revenue);
    out.costsTip.textContent =
      'Переменные затраты: ' + formatMoney(r.variable) + '\n' +
      'Постоянные затраты: ' + formatMoney(r.fixed) + '\n' +
      'Всего: ' + formatMoney(r.costs);

    placeholder.hidden = true;
    resultBox.hidden = false;
  }

  function hideResult() {
    resultBox.hidden = true;
    placeholder.hidden = false;
  }

  /* ---------- События ---------- */

  form.addEventListener('submit', function (event) {
    event.preventDefault();

    var values = {};
    var firstInvalid = null;

    FIELD_IDS.forEach(function (id) {
      var parsed = parseAmount(document.getElementById(id).value);
      if (parsed.error) {
        setFieldError(id, parsed.error);
        firstInvalid = firstInvalid || document.getElementById(id);
      } else {
        setFieldError(id, '');
        values[id] = parsed.kopecks;
      }
    });

    if (firstInvalid) {
      // При ошибке старый результат не показываем: он не соответствует вводу
      hideResult();
      firstInvalid.focus();
      return;
    }

    showResult(calculate(values.revenue, values.variable, values.fixed));

    // На узком экране результат находится ниже формы — прокручиваем к нему
    if (resultBox.scrollIntoView) {
      resultBox.scrollIntoView({ block: 'nearest' });
    }
  });

  // Ошибка у поля исчезает, как только пользователь начинает её исправлять
  FIELD_IDS.forEach(function (id) {
    document.getElementById(id).addEventListener('input', function () {
      setFieldError(id, '');
    });
  });

  resetButton.addEventListener('click', function () {
    form.reset();
    FIELD_IDS.forEach(function (id) {
      setFieldError(id, '');
    });
    hideResult();
    document.getElementById('revenue').focus();
  });
})();
