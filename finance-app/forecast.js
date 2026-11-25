/* ИИ-модуль калькулятора: прогноз финансового результата по истории месяцев.
   Модель машинного обучения (линейная регрессия по времени) обучается прямо в браузере
   на данных пользователя. Данные никуда не отправляются.
   Что делает модуль:
   1) находит аномальные месяцы (устойчивая оценка отклонений от тренда) и исключает их из обучения;
   2) обучает модель тренда выручки, затрат и прибыли;
   3) прогнозирует 3 месяца вперёд с диапазоном 95%;
   4) проверяет качество модели на последних месяцах (обратное тестирование, MAPE);
   5) оценивает риск убытка. */
(function () {
  'use strict';

  var MIN_MONTHS = 6;
  var MAX_MONTHS = 24;
  var HORIZON = 3;
  var BACKTEST = 3;
  var NBSP = ' ';
  var MINUS = '−';

  // Квантили t-распределения Стьюдента (0,975) для df = 1..30
  var T975 = [12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228,
    2.201, 2.179, 2.160, 2.145, 2.131, 2.120, 2.110, 2.101, 2.093, 2.086,
    2.080, 2.074, 2.069, 2.064, 2.060, 2.056, 2.052, 2.048, 2.045, 2.042];

  // Демонстрационные данные: учебная компания, тыс. ₽. В 7-м месяце — разовый всплеск затрат.
  var DEMO = {
    start: '2025-11',
    revenue: [520, 515, 522, 508, 505, 500, 498, 490, 488, 480, 476, 470],
    costs: [430, 432, 431, 436, 438, 440, 560, 444, 447, 450, 452, 455]
  };

  /* ================= Модель (чистые функции, без работы со страницей) ================= */

  function mean(arr) {
    var s = 0;
    for (var i = 0; i < arr.length; i++) { s += arr[i]; }
    return s / arr.length;
  }

  function median(arr) {
    var a = arr.slice().sort(function (x, y) { return x - y; });
    var m = Math.floor(a.length / 2);
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  }

  // Обучение линейной регрессии y = a + b·t методом наименьших квадратов
  function fitTrend(t, y) {
    var n = t.length;
    var tm = mean(t);
    var ym = mean(y);
    var sxx = 0;
    var sxy = 0;
    for (var i = 0; i < n; i++) {
      sxx += (t[i] - tm) * (t[i] - tm);
      sxy += (t[i] - tm) * (y[i] - ym);
    }
    var b = sxx > 0 ? sxy / sxx : 0;
    var a = ym - b * tm;
    var sse = 0;
    for (var j = 0; j < n; j++) {
      var r = y[j] - (a + b * t[j]);
      sse += r * r;
    }
    var df = n - 2;
    return { a: a, b: b, n: n, tm: tm, sxx: sxx, s: df > 0 ? Math.sqrt(sse / df) : 0, df: df };
  }

  function predict(model, t) {
    return model.a + model.b * t;
  }

  // Диапазон прогноза 95% для нового наблюдения
  function predictInterval(model, t) {
    var q = T975[Math.min(Math.max(model.df, 1), 30) - 1];
    var se = model.s * Math.sqrt(1 + 1 / model.n + (model.sxx > 0 ? (t - model.tm) * (t - model.tm) / model.sxx : 0));
    var y = predict(model, t);
    return { y: y, low: y - q * se, high: y + q * se };
  }

  /* Аномалии: модифицированный z-показатель по остаткам от тренда (|z| > 3,5)
     и одновременно существенное отклонение — больше 10% от ожидаемого значения,
     чтобы мелкие колебания почти идеальных данных не считались аномалиями. */
  var MATERIALITY = 0.10;

  function findAnomalies(t, y) {
    var model = fitTrend(t, y);
    var res = t.map(function (ti, i) { return y[i] - predict(model, ti); });
    var med = median(res);
    var dev = res.map(function (r) { return Math.abs(r - med); });
    var scale = median(dev) / 0.6745;
    if (scale === 0) {
      // Больше половины точек точно на тренде: берём среднее абсолютное отклонение
      scale = 1.2533 * mean(dev);
    }
    var out = [];
    if (scale === 0) { return out; }
    res.forEach(function (r, i) {
      var z = (r - med) / scale;
      var expected = predict(model, t[i]);
      var material = Math.abs(r) > MATERIALITY * Math.max(Math.abs(expected), 1);
      if (Math.abs(z) > 3.5 && material) {
        out.push({ index: i, expected: expected, actual: y[i], z: z });
      }
    });
    return out;
  }

  // Средняя абсолютная ошибка в процентах (MAPE), месяцы с нулевым фактом пропускаются
  function mape(actual, forecast) {
    var sum = 0;
    var cnt = 0;
    for (var i = 0; i < actual.length; i++) {
      if (actual[i] !== 0) {
        sum += Math.abs((actual[i] - forecast[i]) / actual[i]);
        cnt++;
      }
    }
    return cnt ? (sum / cnt) * 100 : null;
  }

  /* Полный цикл: аномалии → обучение без аномалий → прогноз → проверка качества → риск.
     revenue, costs — массивы в рублях одинаковой длины. */
  function runForecast(revenue, costs) {
    var n = revenue.length;
    var t = [];
    var profit = [];
    for (var i = 0; i < n; i++) {
      t.push(i + 1);
      profit.push(revenue[i] - costs[i]);
    }

    // 1. Аномальные месяцы по выручке и по затратам
    var anomalies = [];
    findAnomalies(t, revenue).forEach(function (a) { a.kind = 'revenue'; anomalies.push(a); });
    findAnomalies(t, costs).forEach(function (a) { a.kind = 'costs'; anomalies.push(a); });
    var excluded = {};
    anomalies.forEach(function (a) { excluded[a.index] = true; });
    // Если после исключения останется слишком мало точек, обучаемся на всех
    if (n - Object.keys(excluded).length < MIN_MONTHS) { excluded = {}; }

    function pick(arr) { return arr.filter(function (_, k) { return !excluded[k]; }); }
    var tTrain = pick(t);

    // 2. Обучение моделей
    var mRevenue = fitTrend(tTrain, pick(revenue));
    var mCosts = fitTrend(tTrain, pick(costs));
    var mProfit = fitTrend(tTrain, pick(profit));

    // Ожидаемое значение аномального месяца — по модели, обученной без аномалий
    anomalies.forEach(function (a) {
      if (excluded[a.index]) {
        a.expected = predict(a.kind === 'costs' ? mCosts : mRevenue, t[a.index]);
      }
    });

    // 3. Прогноз на HORIZON месяцев
    var forecast = [];
    for (var h = 1; h <= HORIZON; h++) {
      var th = n + h;
      var p = predictInterval(mProfit, th);
      forecast.push({
        t: th,
        revenue: Math.max(0, predict(mRevenue, th)),
        costs: Math.max(0, predict(mCosts, th)),
        profit: p.y,
        low: p.low,
        high: p.high
      });
    }

    // 4. Обратное тестирование: обучаемся без последних BACKTEST месяцев и сравниваем с фактом
    var backtest = null;
    if (n >= MIN_MONTHS + BACKTEST - 1) {
      var cut = n - BACKTEST;
      var tb = [];
      var rb = [];
      for (var k = 0; k < cut; k++) {
        if (!excluded[k]) { tb.push(t[k]); rb.push(revenue[k]); }
      }
      if (tb.length >= 3) {
        var mb = fitTrend(tb, rb);
        var act = [];
        var fc = [];
        for (var m = cut; m < n; m++) {
          if (!excluded[m]) { act.push(revenue[m]); fc.push(predict(mb, t[m])); }
        }
        var err = mape(act, fc);
        if (err !== null) {
          backtest = { mape: err, months: act.length };
        }
      }
    }

    // 5. Риск убытка
    var risk = 'none';
    if (forecast.some(function (f) { return f.profit < 0; })) {
      risk = 'high';
    } else if (forecast.some(function (f) { return f.low < 0; })) {
      risk = 'possible';
    }

    return {
      n: n,
      profit: profit,
      anomalies: anomalies,
      excluded: excluded,
      trained: tTrain.length,
      profitSlope: mProfit.b,
      forecast: forecast,
      backtest: backtest,
      risk: risk
    };
  }

  // Модель доступна для проверки из консоли и автотестов
  window.FinForecast = { runForecast: runForecast, fitTrend: fitTrend, findAnomalies: findAnomalies, mape: mape };

  /* ================= Интерфейс ================= */

  var root = document.getElementById('forecast');
  if (!root || !window.FinCalc) { return; }

  var rowsBox = document.getElementById('history-rows');
  var startInput = document.getElementById('history-start');
  var formError = document.getElementById('history-error');
  var resultBox = document.getElementById('forecast-result');
  var countLabel = document.getElementById('history-count');

  var monthFmt;
  try {
    monthFmt = new Intl.DateTimeFormat('ru-RU', { month: 'short', year: 'numeric' });
  } catch (e) {
    monthFmt = null;
  }

  // Подпись месяца по номеру (1 — первый месяц данных)
  function monthLabel(index) {
    var v = startInput.value;
    var m = /^(\d{4})-(\d{2})$/.exec(v);
    if (!m || !monthFmt) { return 'Месяц ' + index; }
    var d = new Date(Number(m[1]), Number(m[2]) - 1 + index - 1, 1);
    return monthFmt.format(d).replace(/\s*г\.$/, '').replace('.', '');
  }

  function rub(value) {
    return window.FinCalc.formatMoney(Math.round(value) * 100);
  }

  // Короткая подпись для оси: «120 тыс.»
  function short(value) {
    var abs = Math.abs(value);
    var sign = value < 0 ? MINUS : '';
    if (abs >= 1e6) { return sign + (abs / 1e6).toFixed(abs % 1e6 === 0 ? 0 : 1).replace('.', ',') + NBSP + 'млн'; }
    if (abs >= 1e3) { return sign + Math.round(abs / 1e3) + NBSP + 'тыс.'; }
    return sign + Math.round(abs);
  }

  function updateCount() {
    var n = rowsBox.children.length;
    countLabel.textContent = 'Месяцев: ' + n + ' (нужно от ' + MIN_MONTHS + ' до ' + MAX_MONTHS + ')';
    document.getElementById('add-month').disabled = n >= MAX_MONTHS;
  }

  function relabel() {
    Array.prototype.forEach.call(rowsBox.children, function (row, i) {
      var label = monthLabel(i + 1);
      row.querySelector('.h-month').textContent = label;
      row.querySelector('.h-rev').setAttribute('aria-label', 'Выручка, ' + label);
      row.querySelector('.h-cost').setAttribute('aria-label', 'Все затраты, ' + label);
      row.querySelector('.h-del').setAttribute('aria-label', 'Удалить месяц ' + label);
    });
    updateCount();
  }

  function addRow(revenue, costs) {
    if (rowsBox.children.length >= MAX_MONTHS) { return; }
    var row = document.createElement('div');
    row.className = 'h-row';
    row.innerHTML =
      '<span class="h-month"></span>' +
      '<input class="h-rev" type="text" inputmode="decimal" autocomplete="off">' +
      '<input class="h-cost" type="text" inputmode="decimal" autocomplete="off">' +
      '<button class="h-del" type="button" title="Удалить месяц">×</button>';
    row.querySelector('.h-rev').value = revenue || '';
    row.querySelector('.h-cost').value = costs || '';
    row.querySelector('.h-del').addEventListener('click', function () {
      row.remove();
      relabel();
    });
    rowsBox.appendChild(row);
  }

  function groupDigits(n) {
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  }

  function fillDemo() {
    rowsBox.innerHTML = '';
    startInput.value = DEMO.start;
    DEMO.revenue.forEach(function (r, i) {
      addRow(groupDigits(r * 1000), groupDigits(DEMO.costs[i] * 1000));
    });
    relabel();
    clearState();
  }

  function clearState() {
    formError.textContent = '';
    formError.hidden = true;
    resultBox.hidden = true;
    Array.prototype.forEach.call(rowsBox.querySelectorAll('input'), function (inp) {
      inp.removeAttribute('aria-invalid');
    });
  }

  // Считываем таблицу; при ошибке возвращаем null и показываем сообщение
  function readHistory() {
    var rows = Array.prototype.slice.call(rowsBox.children);
    var revenue = [];
    var costs = [];
    var problems = [];
    var firstBad = null;

    if (rows.length < MIN_MONTHS) {
      problems.push('Для прогноза нужно не меньше ' + MIN_MONTHS + ' месяцев данных, сейчас ' + rows.length + '.');
    }

    rows.forEach(function (row, i) {
      [['.h-rev', 'выручка', revenue], ['.h-cost', 'затраты', costs]].forEach(function (spec) {
        var input = row.querySelector(spec[0]);
        var parsed = window.FinCalc.parseAmount(input.value);
        if (parsed.error) {
          input.setAttribute('aria-invalid', 'true');
          problems.push(monthLabel(i + 1) + ', ' + spec[1] + ': ' + parsed.error);
          firstBad = firstBad || input;
        } else {
          input.removeAttribute('aria-invalid');
          spec[2].push(parsed.kopecks / 100);
        }
      });
    });

    if (problems.length) {
      formError.textContent = problems.slice(0, 4).join(' ') + (problems.length > 4 ? ' Ещё ошибок: ' + (problems.length - 4) + '.' : '');
      formError.hidden = false;
      resultBox.hidden = true;
      if (firstBad) { firstBad.focus(); }
      return null;
    }
    formError.hidden = true;
    return { revenue: revenue, costs: costs };
  }

  /* ---------- Вывод результата ---------- */

  function renderRisk(res) {
    var box = document.getElementById('risk');
    var first = null;
    res.forecast.forEach(function (f, i) {
      if (first === null && (res.risk === 'high' ? f.profit < 0 : f.low < 0)) { first = i; }
    });
    box.className = 'risk risk-' + res.risk;
    if (res.risk === 'high') {
      box.innerHTML = '<strong>▼ Высокий риск убытка.</strong> При сохранении текущей динамики модель прогнозирует убыток в ' +
        monthLabel(res.n + first + 1) + ': ' + rub(res.forecast[first].profit) + '.';
    } else if (res.risk === 'possible') {
      box.innerHTML = '<strong>● Возможен убыток.</strong> Средний прогноз прибыли положительный, но нижняя граница диапазона в ' +
        monthLabel(res.n + first + 1) + ' уходит в минус.';
    } else {
      box.innerHTML = '<strong>▲ Риск убытка не выявлен.</strong> Весь диапазон прогноза прибыли на ' + HORIZON + ' месяца выше нуля.';
    }
    var trend = document.getElementById('trend');
    var slope = res.profitSlope;
    trend.textContent = 'Тренд прибыли: ' + (slope >= 0 ? '+' : MINUS) + rub(Math.abs(slope)).replace(MINUS, '') + ' в месяц.';
  }

  function renderTable(res) {
    var body = document.getElementById('forecast-rows');
    body.innerHTML = '';
    res.forecast.forEach(function (f, i) {
      var tr = document.createElement('tr');
      if (f.profit < 0) { tr.className = 'is-loss'; }
      tr.innerHTML =
        '<th scope="row">' + monthLabel(res.n + i + 1) + '</th>' +
        '<td>' + rub(f.revenue) + '</td>' +
        '<td>' + rub(f.costs) + '</td>' +
        '<td class="num-strong">' + rub(f.profit) + '</td>' +
        '<td>' + rub(f.low) + ' … ' + rub(f.high) + '</td>';
      body.appendChild(tr);
    });
  }

  function renderAnomalies(res) {
    var list = document.getElementById('anomalies');
    var note = document.getElementById('anomalies-note');
    list.innerHTML = '';
    if (!res.anomalies.length) {
      note.textContent = 'Аномальных месяцев не найдено: все значения близки к общему тренду.';
      list.hidden = true;
      return;
    }
    list.hidden = false;
    var excludedCount = Object.keys(res.excluded).length;
    note.textContent = excludedCount
      ? 'Эти месяцы выбиваются из тренда, поэтому модель обучена без них (' + res.trained + ' из ' + res.n + ' месяцев). Проверьте, разовое ли это событие.'
      : 'Эти месяцы выбиваются из тренда. Данных мало, поэтому модель обучена на всех месяцах.';
    res.anomalies.forEach(function (a) {
      var li = document.createElement('li');
      var diff = a.expected !== 0 ? Math.round((a.actual - a.expected) / Math.abs(a.expected) * 100) : null;
      li.innerHTML = '<strong>' + monthLabel(a.index + 1) + '</strong>: ' +
        (a.kind === 'costs' ? 'затраты ' : 'выручка ') + rub(a.actual) +
        ', ожидалось около ' + rub(a.expected) +
        (diff !== null ? ' (' + (diff > 0 ? '+' : MINUS) + Math.abs(diff) + '%)' : '') + '.';
      list.appendChild(li);
    });
  }

  function renderQuality(res) {
    var box = document.getElementById('quality');
    if (!res.backtest) {
      box.textContent = 'Качество модели не проверено: для проверки нужно не меньше ' + (MIN_MONTHS + BACKTEST - 1) + ' месяцев.';
      return;
    }
    var m = res.backtest.mape;
    var grade = m <= 10 ? 'хорошая точность' : m <= 20 ? 'удовлетворительная точность' : 'низкая точность — прогнозу стоит доверять с осторожностью';
    box.textContent = 'Проверка качества: модель обучили без последних ' + res.backtest.months +
      ' месяцев и сравнили прогноз выручки с фактом. Средняя ошибка (MAPE) — ' +
      m.toFixed(1).replace('.', ',') + '%, ' + grade + '.';
  }

  // График прибыли: факт, прогноз и диапазон 95%
  function renderChart(res) {
    var svg = document.getElementById('forecast-chart');
    // Ширина рисунка равна ширине контейнера, чтобы подписи оставались читаемыми на телефоне
    var W = Math.max(300, Math.min(760, Math.round(svg.parentNode.clientWidth - 2) || 640));
    var H = W < 480 ? 260 : 300;
    var pad = { l: W < 480 ? 54 : 64, r: 16, t: 20, b: 36 };
    var total = res.n + HORIZON;

    var values = res.profit.slice();
    res.forecast.forEach(function (f) { values.push(f.low, f.high); });
    values.push(0);
    var min = Math.min.apply(null, values);
    var max = Math.max.apply(null, values);
    var span = max - min || 1;
    var step = Math.pow(10, Math.floor(Math.log(span / 4) / Math.LN10));
    [1, 2, 2.5, 5, 10].some(function (k) {
      if (span / (step * k) <= 5) { step = step * k; return true; }
      return false;
    });
    var y0 = Math.floor(min / step) * step;
    var y1 = Math.ceil(max / step) * step;

    function x(t) { return pad.l + (t - 1) / (total - 1) * (W - pad.l - pad.r); }
    function y(v) { return pad.t + (y1 - v) / (y1 - y0) * (H - pad.t - pad.b); }

    var parts = [];
    // Сетка и подписи оси Y
    for (var v = y0; v <= y1 + step / 2; v += step) {
      var isZero = Math.abs(v) < step / 1000;
      parts.push('<line x1="' + pad.l + '" x2="' + (W - pad.r) + '" y1="' + y(v) + '" y2="' + y(v) + '" class="' + (isZero ? 'c-zero' : 'c-grid') + '"/>');
      parts.push('<text x="' + (pad.l - 8) + '" y="' + (y(v) + 4) + '" class="c-tick" text-anchor="end">' + (isZero ? '0' : short(v)) + '</text>');
    }
    // Подписи оси X: каждый третий месяц и последний прогнозный, без наложений
    var ticks = [];
    var MIN_GAP = 74;
    for (var t = 1; t <= total; t++) {
      if (t === 1 || (t - 1) % 3 === 0 || t === total) {
        if (t === total) {
          while (ticks.length && x(t) - x(ticks[ticks.length - 1]) < MIN_GAP) { ticks.pop(); }
          ticks.push(t);
        } else if (!ticks.length || x(t) - x(ticks[ticks.length - 1]) >= MIN_GAP) {
          ticks.push(t);
        }
      }
    }
    ticks.forEach(function (tt) {
      var anchor = tt === 1 ? 'start' : tt === total ? 'end' : 'middle';
      parts.push('<text x="' + x(tt) + '" y="' + (H - 12) + '" class="c-tick" text-anchor="' + anchor + '">' + monthLabel(tt) + '</text>');
    });
    // Граница факт / прогноз
    var xb = x(res.n);
    parts.push('<line x1="' + xb + '" x2="' + xb + '" y1="' + pad.t + '" y2="' + (H - pad.b) + '" class="c-split"/>');
    parts.push('<text x="' + (xb + 6) + '" y="' + (pad.t + 12) + '" class="c-label">прогноз →</text>');

    // Диапазон 95% (от последнего факта)
    var last = res.profit[res.n - 1];
    var upper = [[x(res.n), y(last)]];
    var lower = [[x(res.n), y(last)]];
    res.forecast.forEach(function (f) {
      upper.push([x(f.t), y(f.high)]);
      lower.push([x(f.t), y(f.low)]);
    });
    var band = upper.concat(lower.reverse()).map(function (p) { return p[0] + ',' + p[1]; }).join(' ');
    parts.push('<polygon points="' + band + '" class="c-band"/>');

    // Линии факта и прогноза
    var factPts = res.profit.map(function (p, i) { return x(i + 1) + ',' + y(p); }).join(' ');
    parts.push('<polyline points="' + factPts + '" class="c-line"/>');
    var fcPts = [x(res.n) + ',' + y(last)].concat(res.forecast.map(function (f) { return x(f.t) + ',' + y(f.profit); })).join(' ');
    parts.push('<polyline points="' + fcPts + '" class="c-line c-dashed"/>');

    // Точки с подсказками
    res.profit.forEach(function (p, i) {
      var anomalous = res.anomalies.some(function (a) { return a.index === i; });
      parts.push('<g class="c-pt' + (anomalous ? ' c-anom' : '') + '"><title>' + monthLabel(i + 1) + ': прибыль ' + rub(p) +
        (anomalous ? ' (аномальный месяц)' : '') + '</title>' +
        '<circle cx="' + x(i + 1) + '" cy="' + y(p) + '" r="12" class="c-hit"/>' +
        '<circle cx="' + x(i + 1) + '" cy="' + y(p) + '" r="' + (anomalous ? 6 : 4) + '" class="c-dot"/></g>');
    });
    res.forecast.forEach(function (f, i) {
      parts.push('<g class="c-pt"><title>' + monthLabel(res.n + i + 1) + ': прогноз прибыли ' + rub(f.profit) +
        ', диапазон ' + rub(f.low) + ' … ' + rub(f.high) + '</title>' +
        '<circle cx="' + x(f.t) + '" cy="' + y(f.profit) + '" r="12" class="c-hit"/>' +
        '<circle cx="' + x(f.t) + '" cy="' + y(f.profit) + '" r="4" class="c-dot c-dot-fc"/></g>');
    });
    // Подпись последней точки прогноза
    var lastF = res.forecast[res.forecast.length - 1];
    // Подпись ставим под диапазоном (или над ним), чтобы она не пересекала линии
    var labelY = y(lastF.low) + 18 <= H - pad.b - 4 ? y(lastF.low) + 18 : y(lastF.high) - 8;
    parts.push('<text x="' + x(lastF.t) + '" y="' + labelY + '" class="c-value" text-anchor="end">' + short(lastF.profit) + '</text>');

    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg.setAttribute('aria-label', 'График прибыли: ' + res.n + ' месяцев факта и прогноз на ' + HORIZON +
      ' месяца. Последний прогноз ' + rub(lastF.profit) + '.');
    svg.innerHTML = parts.join('');
  }

  var lastResult = null;
  var resizeTimer = null;

  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      if (lastResult && !resultBox.hidden) { renderChart(lastResult); }
    }, 150);
  });

  function run() {
    clearState();
    var data = readHistory();
    if (!data) { return; }
    var res = runForecast(data.revenue, data.costs);
    lastResult = res;
    // Сначала показываем блок: графику нужна реальная ширина контейнера
    resultBox.hidden = false;
    renderRisk(res);
    renderTable(res);
    renderAnomalies(res);
    renderQuality(res);
    renderChart(res);
    if (resultBox.scrollIntoView) { resultBox.scrollIntoView({ block: 'nearest' }); }
  }

  /* ---------- События ---------- */

  document.getElementById('add-month').addEventListener('click', function () {
    addRow('', '');
    relabel();
    rowsBox.lastElementChild.querySelector('.h-rev').focus();
  });
  document.getElementById('fill-demo').addEventListener('click', fillDemo);
  document.getElementById('clear-history').addEventListener('click', function () {
    rowsBox.innerHTML = '';
    for (var i = 0; i < MIN_MONTHS; i++) { addRow('', ''); }
    relabel();
    clearState();
  });
  document.getElementById('run-forecast').addEventListener('click', run);
  startInput.addEventListener('change', function () {
    relabel();
    if (!resultBox.hidden) { run(); }
  });
  rowsBox.addEventListener('input', function (e) {
    if (e.target.matches('input')) { e.target.removeAttribute('aria-invalid'); }
  });

  // Старт: пустая таблица на минимальное число месяцев
  for (var r = 0; r < MIN_MONTHS; r++) { addRow('', ''); }
  relabel();
})();
