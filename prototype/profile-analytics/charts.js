/*
 * Chart renderers for the profile prototype. No library: plain HTML + SVG.
 * Each renderer takes a view from metrics.js and fills a container. Marks are
 * real <button>s, so mouse, touch and keyboard all reach the same tooltip and
 * detail panel. Identity never relies on colour alone: every series also has
 * a shape or symbol and a text label.
 */
(function (root) {
  'use strict';

  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  // Fixed per quest (colour follows the entity, never its position in a filter).
  var QUEST_STYLE = {
    'missing-signal': { color: 'var(--c-teal)', shape: 'circle' },
    'the-ledger': { color: 'var(--c-violet)', shape: 'square' },
    'broken-tally': { color: 'var(--c-coral)', shape: 'diamond' },
    'market-ledger': { color: 'var(--c-amber)', shape: 'triangle' },
    'great-hall-dashboard': { color: 'var(--c-neutral)', shape: 'circle' },
    'star-chart': { color: 'var(--c-neutral)', shape: 'square' }
  };
  var RECOVERY_STYLE = {
    'solved-next': { cls: 'rc-solved', icon: '✓' },
    'hint-solved': { cls: 'rc-hint', icon: '💡' },
    'another-try': { cls: 'rc-again', icon: '↻' },
    'no-further': { cls: 'rc-none', icon: '…' }
  };

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }
  function fmtDay(day) { var p = day.slice(0, 10).split('-'); return Number(p[2]) + ' ' + MONTHS[Number(p[1]) - 1]; }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }
  function pad2(n) { return String(n).padStart(2, '0'); }
  function pct(n, d) { return d ? Math.round(100 * n / d) : 0; }

  // ---- Tooltip (shared) ------------------------------------------------------
  var tip = null;
  function tipEl() { return tip || (tip = document.getElementById('tooltip')); }
  var tipTarget = null;
  function showTip(target, html) {
    var t = tipEl();
    if (html !== undefined) t.innerHTML = html;
    t.hidden = false;
    tipTarget = target;
    var r = target.getBoundingClientRect();
    var w = t.offsetWidth, h = t.offsetHeight;
    var left = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), window.innerWidth - w - 8);
    var top = r.top - h - 10;
    if (top < 8) top = r.bottom + 10;
    t.style.left = left + 'px';
    t.style.top = top + 'px';
  }
  function hideTip() { if (tipEl()) tipEl().hidden = true; tipTarget = null; }
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') hideTip(); });
  // A focused mark keeps its tooltip while the page scrolls (focus itself can
  // scroll the page); a hover-only tooltip closes.
  window.addEventListener('scroll', function () {
    if (tipTarget && document.activeElement === tipTarget && document.body.contains(tipTarget)) showTip(tipTarget);
    else hideTip();
  }, { passive: true });

  function bindTips(container, selector, contentFor) {
    container.querySelectorAll(selector).forEach(function (el) {
      var show = function () { showTip(el, contentFor(el)); };
      el.addEventListener('pointerenter', show);
      el.addEventListener('focus', show);
      el.addEventListener('pointerleave', function () { if (document.activeElement !== el) hideTip(); });
      el.addEventListener('blur', hideTip);
    });
  }

  /** One tab stop per chart; arrow keys, Home and End move between marks. */
  function roving(container, selector) {
    var items = Array.prototype.slice.call(container.querySelectorAll(selector));
    if (!items.length) return;
    var active = items.find(function (i) { return i.getAttribute('aria-pressed') === 'true'; }) || items[0];
    items.forEach(function (i) { i.tabIndex = i === active ? 0 : -1; });
    container.addEventListener('keydown', function (e) {
      var idx = items.indexOf(document.activeElement);
      if (idx === -1) return;
      var next = null;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = items[Math.min(items.length - 1, idx + 1)];
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = items[Math.max(0, idx - 1)];
      else if (e.key === 'Home') next = items[0];
      else if (e.key === 'End') next = items[items.length - 1];
      if (!next) return;
      e.preventDefault();
      items.forEach(function (i) { i.tabIndex = -1; });
      next.tabIndex = 0;
      next.focus();
      next.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });
  }

  function empty(title, text) {
    return '<div class="empty-state"><span class="empty-icon" aria-hidden="true">🧭</span><p><strong>' + esc(title) + '</strong></p><p class="hint">' + esc(text) + '</p></div>';
  }

  // ---- Chart A: Attempts & Retries -------------------------------------------
  function statusText(r) {
    if (r.status === 'completed') return r.firstTry ? 'Completed on the first attempt' : 'Completed after ' + plural(r.retries, 'retry', 'retries');
    if (r.status === 'incomplete') return 'Not finished yet';
    return 'Started, no answer yet';
  }
  function attemptLabel(r) {
    return r.title + ', ' + pad2(r.questNumber) + ' ' + r.questTitle + '. Initial attempts: ' + r.initial + '. Retries: ' + r.retries +
      '. Total attempts: ' + r.attempts + '. Hints used: ' + r.hints + '. ' + statusText(r) + '.';
  }

  function renderAttempts(el, view, opts) {
    var rows = view.challenges;
    if (!rows.length) {
      el.innerHTML = empty('No challenge activity in this view', 'Try a longer period or another quest, or select Reset filters.');
      return;
    }
    var max = Math.max(4, Math.max.apply(null, rows.map(function (r) { return Math.max(r.attempts, r.hints); })));
    var step = max > 8 ? 2 : 1;
    if (max % step) max += step - (max % step);
    var ticks = [];
    for (var t = 0; t <= max; t += step) ticks.push(t);

    var groups = [];
    rows.forEach(function (r) {
      var g = groups[groups.length - 1];
      if (!g || g.quest !== r.quest) groups.push(g = { quest: r.quest, number: r.questNumber, title: r.questTitle, rows: [] });
      g.rows.push(r);
    });

    var grid = ticks.map(function (t) {
      return '<span class="bc-grid" style="bottom:' + (100 * t / max) + '%"></span>';
    }).join('');
    var yAxis = ticks.map(function (t) {
      return '<span class="bc-tick" style="bottom:' + (100 * t / max) + '%">' + t + '</span>';
    }).join('');

    var html = groups.map(function (g) {
      var cols = g.rows.map(function (r) {
        var selected = opts && opts.selectedKey === r.key;
        var stackH = 100 * r.attempts / max;
        var hintH = 100 * r.hints / max;
        var segs = '';
        if (r.retries) segs += '<span class="seg seg-retry" style="flex-grow:' + r.retries + '"></span>';
        if (r.initial) segs += '<span class="seg seg-initial" style="flex-grow:' + r.initial + '"></span>';
        var symbol = r.status === 'completed' ? '✓' : '<span class="ico-half" aria-hidden="true"></span>';
        return '<div class="bc-col">' +
          '<button type="button" class="bc-hit" data-key="' + esc(r.key) + '" aria-pressed="' + selected + '" aria-controls="detail" aria-label="' + esc(attemptLabel(r)) + ' Select to see the full breakdown.">' +
            '<span class="bc-bars" aria-hidden="true">' +
              '<span class="bc-stack' + (r.attempts ? '' : ' bc-stack--empty') + '" style="height:' + stackH + '%">' +
                '<span class="bc-total">' + r.attempts + '</span>' + segs + '</span>' +
              (r.hints ? '<span class="bc-hint" style="height:' + hintH + '%"></span>' : '<span class="bc-hint bc-hint--none"></span>') +
            '</span>' +
          '</button>' +
          '<span class="bc-label" aria-hidden="true"><span class="bc-status bc-status--' + r.status + '">' + symbol + '</span>' + esc(r.title) + '</span>' +
        '</div>';
      }).join('');
      return '<div class="bc-group" role="group" aria-label="Quest ' + pad2(g.number) + ': ' + esc(g.title) + '">' +
        '<div class="bc-cols">' + cols + '</div>' +
        '<p class="bc-group-name"><span class="q-num">' + pad2(g.number) + '</span> ' + esc(g.title) + '</p></div>';
    }).join('');

    el.innerHTML = '<div class="bc">' +
      '<div class="bc-y" aria-hidden="true"><span class="bc-y-title">Attempts</span>' + yAxis + '</div>' +
      '<div class="bc-scroll" role="region" aria-label="Attempts and retries by challenge" tabindex="-1">' +
        '<div class="bc-plot"><div class="bc-gridlayer" aria-hidden="true">' + grid + '</div>' + html + '</div>' +
      '</div></div>';

    var byKey = {};
    rows.forEach(function (r) { byKey[r.key] = r; });
    bindTips(el, '.bc-hit', function (b) {
      var r = byKey[b.dataset.key];
      return '<p class="tip-title">' + esc(r.title) + '</p><p class="tip-sub">' + pad2(r.questNumber) + ' ' + esc(r.questTitle) + '</p>' +
        '<dl class="tip-grid"><dt><span class="key key-initial"></span>Initial attempt</dt><dd>' + r.initial + '</dd>' +
        '<dt><span class="key key-retry"></span>Retries</dt><dd>' + r.retries + '</dd>' +
        '<dt>Total attempts</dt><dd>' + r.attempts + '</dd>' +
        '<dt><span class="key key-hint"></span>Hints used</dt><dd>' + r.hints + '</dd></dl>' +
        '<p class="tip-status">' + (r.status === 'completed' ? '✓ ' : '<span class="ico-half" aria-hidden="true"></span> ') + esc(statusText(r)) + '</p>';
    });
    roving(el.querySelector('.bc'), '.bc-hit');
    el.querySelectorAll('.bc-hit').forEach(function (b) {
      b.addEventListener('click', function () { if (opts && opts.onSelect) opts.onSelect(b.dataset.key); });
    });
  }

  function attemptsTable(view) {
    if (!view.challenges.length) return '<p class="hint">No rows in this view.</p>';
    var body = view.challenges.map(function (r) {
      return '<tr><th scope="row">' + esc(r.title) + '<span class="q-sub">' + pad2(r.questNumber) + ' ' + esc(r.questTitle) + '</span></th><td>' + r.initial + '</td><td>' + r.retries + '</td><td>' + r.attempts + '</td><td>' + r.hints + '</td><td>' + esc(statusText(r)) + '</td></tr>';
    }).join('');
    var k = view.kpis;
    return '<div class="table-scroll" tabindex="0" role="region" aria-label="Attempts and retries table"><table class="data-table"><thead><tr><th scope="col">Challenge</th><th scope="col">Initial</th><th scope="col">Retries</th><th scope="col">Total attempts</th><th scope="col">Hints</th><th scope="col">Status</th></tr></thead><tbody>' + body +
      '</tbody><tfoot><tr><th scope="row">Total</th><td>' + k.initialAttempts + '</td><td>' + k.totalRetries + '</td><td>' + k.totalAttempts + '</td><td>' + k.hintsUsed + '</td><td>' + k.challengesCompleted + ' completed</td></tr></tfoot></table></div>';
  }

  // ---- Chart B: Learning Over Time --------------------------------------------
  function dayMs(ts) { return Date.parse(ts.slice(0, 10) + 'T00:00:00Z'); }

  function renderMastery(el, legendEl, view, quests) {
    var series = view.mastery.series;
    legendEl.innerHTML = series.map(function (s) {
      var st = QUEST_STYLE[s.quest];
      var change = s.change === null ? plural(s.points.length, 'check') : (s.change > 0 ? '+' : s.change < 0 ? '−' : '±') + Math.abs(s.change) + ' pts';
      return '<li><span class="shape shape--' + st.shape + '" style="--c:' + st.color + '" aria-hidden="true"></span>' + pad2(s.number) + ' ' + esc(s.title) + ' <span class="hint">(' + change + ')</span></li>';
    }).join('');
    if (!series.length) {
      el.innerHTML = empty('No mastery checks in this view', 'Mastery checks appear here after a quest’s “Check your understanding” step. Try a longer period.');
      return;
    }
    var from = dayMs(view.range.from), to = dayMs(view.range.to);
    if (to <= from) to = from + 86400000;
    var x = function (ts) { return 3 + 94 * (dayMs(ts) - from) / (to - from); };
    var y = function (score) { return 100 - score; };

    var grid = [0, 25, 50, 75, 100].map(function (v) {
      return '<span class="lc-grid" style="top:' + y(v) + '%"></span><span class="lc-tick" style="top:' + y(v) + '%">' + v + '%</span>';
    }).join('');
    var span = (to - from) / 86400000;
    var nTicks = Math.min(5, Math.max(2, Math.floor(span / 3) + 1));
    var xTicks = '';
    for (var i = 0; i < nTicks; i++) {
      var ms = from + Math.round((to - from) * i / (nTicks - 1) / 86400000) * 86400000;
      var day = new Date(ms).toISOString().slice(0, 10);
      xTicks += '<span class="lc-xtick' + (i === 0 ? ' lc-xtick--start' : i === nTicks - 1 ? ' lc-xtick--end' : '') + '" style="left:' + x(day) + '%">' + fmtDay(day) + '</span>';
    }
    var lines = series.map(function (s) {
      if (s.points.length < 2) return '';
      return '<polyline vector-effect="non-scaling-stroke" class="lc-line" style="stroke:' + QUEST_STYLE[s.quest].color + '" points="' +
        s.points.map(function (p) { return x(p.ts) + ',' + y(p.score); }).join(' ') + '"/>';
    }).join('');
    var points = [];
    series.forEach(function (s) { s.points.forEach(function (p, i) { points.push({ s: s, p: p, prev: i ? s.points[i - 1] : null }); }); });
    points.sort(function (a, b) { return a.p.ts < b.p.ts ? -1 : 1; });
    var markers = points.map(function (m) {
      var st = QUEST_STYLE[m.s.quest];
      var label = 'Mastery check, ' + fmtDay(m.p.day) + ', ' + pad2(m.s.number) + ' ' + m.s.title + ': ' + m.p.score + '% (' + m.p.correctItems + ' of ' + m.p.items + ' items correct)' +
        (m.prev ? '. Previous check in this quest: ' + m.prev.score + '%.' : '. First check in this view for this quest.');
      return '<button type="button" class="lc-point" data-id="' + m.p.id + '" style="left:' + x(m.p.ts) + '%;top:' + y(m.p.score) + '%;--c:' + st.color + '" aria-label="' + esc(label) + '">' +
        '<span class="shape shape--' + st.shape + '" aria-hidden="true"></span></button>';
    }).join('');

    el.innerHTML = '<div class="lc"><span class="lc-y-title" aria-hidden="true">Mastery score</span>' +
      '<div class="lc-plot" role="group" aria-label="Mastery check scores over time">' +
        '<div aria-hidden="true">' + grid + '</div>' +
        '<svg class="lc-svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" focusable="false">' + lines + '</svg>' +
        markers + '</div><div class="lc-x" aria-hidden="true">' + xTicks + '</div></div>';

    var byId = {};
    points.forEach(function (m) { byId[m.p.id] = m; });
    bindTips(el, '.lc-point', function (b) {
      var m = byId[b.dataset.id];
      return '<p class="tip-title">' + m.p.score + '% mastery</p><p class="tip-sub">' + pad2(m.s.number) + ' ' + esc(m.s.title) + ' · ' + fmtDay(m.p.day) + '</p>' +
        '<p>' + m.p.correctItems + ' of ' + m.p.items + ' items correct' + (m.prev ? '<br>Previous check: ' + m.prev.score + '%' : '') + '</p>';
    });
    roving(el.querySelector('.lc'), '.lc-point');
  }

  function masteryTable(view) {
    var rows = [];
    view.mastery.series.forEach(function (s) {
      s.points.forEach(function (p) { rows.push('<tr><th scope="row">' + fmtDay(p.day) + '</th><td>' + pad2(s.number) + ' ' + esc(s.title) + '</td><td>' + p.correctItems + ' / ' + p.items + '</td><td>' + p.score + '%</td></tr>'); });
    });
    if (!rows.length) return '<p class="hint">No rows in this view.</p>';
    return '<div class="table-scroll" tabindex="0" role="region" aria-label="Mastery checks table"><table class="data-table"><thead><tr><th scope="col">Date</th><th scope="col">Quest</th><th scope="col">Items correct</th><th scope="col">Mastery score</th></tr></thead><tbody>' + rows.join('') + '</tbody></table></div>';
  }

  // ---- Chart C: After a wrong answer ------------------------------------------
  function renderRecovery(el, view, categories) {
    var r = view.recovery;
    if (!r.denominator) {
      el.innerHTML = empty('No incorrect answers in this view', view.challenges.length
        ? 'Every answer here was right first time, so there’s nothing to break down.'
        : 'There’s no challenge activity in this view yet.');
      return;
    }
    var bar = categories.map(function (c) {
      var n = r.counts[c.id];
      if (!n) return '';
      return '<span class="rc-seg ' + RECOVERY_STYLE[c.id].cls + '" data-cat="' + c.id + '" style="flex-grow:' + n + '"><span class="rc-seg-label">' + n + '</span></span>';
    }).join('');
    var whoByCat = {};
    view.challenges.forEach(function (row) {
      row.recovery.forEach(function (x) { (whoByCat[x.outcome] = whoByCat[x.outcome] || []).push(row.title); });
    });
    var list = categories.map(function (c) {
      var n = r.counts[c.id];
      var who = whoByCat[c.id] || [];
      var unique = who.filter(function (w, i) { return who.indexOf(w) === i; });
      return '<li class="rc-item">' +
        '<button type="button" class="rc-row" aria-expanded="false" aria-controls="rc-who-' + c.id + '"' + (n ? '' : ' disabled') + '>' +
          '<span class="rc-key ' + RECOVERY_STYLE[c.id].cls + '" aria-hidden="true"></span>' +
          '<span class="rc-icon" aria-hidden="true">' + RECOVERY_STYLE[c.id].icon + '</span>' +
          '<span class="rc-name">' + esc(c.label) + '</span>' +
          '<span class="rc-count"><strong>' + n + '</strong> <span class="hint">' + pct(n, r.denominator) + '%</span></span>' +
        '</button>' +
        '<p class="rc-who hint" id="rc-who-' + c.id + '" hidden>' + (unique.length ? esc(unique.join(', ')) : '') + '</p></li>';
    }).join('');
    el.innerHTML =
      '<div class="rc-headline"><p class="rc-rate">' + r.rate + '<span>%</span></p><p>recovery rate: <strong>' + r.recovered + ' of ' + r.denominator +
      '</strong> incorrect attempts were followed by a correct next answer within ' + r.windowDays + ' days.</p></div>' +
      '<div class="rc-bar" aria-hidden="true">' + bar + '</div>' +
      '<p class="hint rc-denominator">Each row is a share of the ' + r.denominator + ' incorrect attempts in this view. Select a row to see which challenges.</p>' +
      '<ul class="rc-list">' + list + '</ul>';

    bindTips(el, '.rc-seg', function (s) {
      var c = categories.find(function (x) { return x.id === s.dataset.cat; });
      var n = r.counts[c.id];
      return '<p class="tip-title">' + esc(c.label) + '</p><p>' + n + ' of ' + r.denominator + ' incorrect attempts (' + pct(n, r.denominator) + '%)</p>';
    });
    el.querySelectorAll('.rc-row').forEach(function (b) {
      b.addEventListener('click', function () {
        var open = b.getAttribute('aria-expanded') === 'true';
        b.setAttribute('aria-expanded', String(!open));
        document.getElementById(b.getAttribute('aria-controls')).hidden = open;
      });
    });
  }

  root.CURIO_CHARTS = { renderAttempts: renderAttempts, attemptsTable: attemptsTable, renderMastery: renderMastery,
    masteryTable: masteryTable, renderRecovery: renderRecovery, hideTip: hideTip, esc: esc, fmtDay: fmtDay,
    plural: plural, pad2: pad2, statusText: statusText, QUEST_STYLE: QUEST_STYLE, RECOVERY_STYLE: RECOVERY_STYLE };
})(typeof globalThis !== 'undefined' ? globalThis : this);
