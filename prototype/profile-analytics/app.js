/*
 * Wiring for the profile prototype. One state object, one render(): every
 * filter change recomputes the view from the event log and redraws the KPIs,
 * all three charts, the journey and the insights together.
 */
(function () {
  'use strict';

  var D = window.CURIO_PROTO, M = window.CURIO_METRICS, C = window.CURIO_CHARTS, K = window.CURIO_CONSENT;
  var esc = C.esc, fmtDay = C.fmtDay, plural = C.plural, pad2 = C.pad2;
  var $ = function (id) { return document.getElementById(id); };

  var state = {
    scenario: 'default',
    filters: Object.assign({}, M.DEFAULT_FILTERS, sanitise(K.loadPrefs())),
    selectedKey: null,
    journeyDays: 3,
    view: null
  };

  function sanitise(p) {
    if (!p) return {};
    var out = {};
    if (M.PERIODS[p.period]) out.period = p.period;
    if (p.quest === 'all' || D.quests.some(function (q) { return q.id === p.quest; })) out.quest = p.quest;
    return out;
  }
  function events() { return D.scenarios[state.scenario].events; }
  function isDefault() { return state.filters.period === M.DEFAULT_FILTERS.period && state.filters.quest === M.DEFAULT_FILTERS.quest; }

  // ---- One-time setup ----------------------------------------------------------
  $('clock-label').textContent = fmtDay(D.clock) + ' 2026';
  document.querySelectorAll('[data-window]').forEach(function (el) { el.textContent = M.RECOVERY_WINDOW_DAYS; });
  $('scenario').innerHTML = Object.keys(D.scenarios).map(function (k) {
    return '<option value="' + k + '">' + esc(D.scenarios[k].label) + '</option>';
  }).join('');
  $('period-options').innerHTML = Object.keys(M.PERIODS).map(function (k) {
    return '<label class="seg-option"><input type="radio" name="period" value="' + k + '"><span>' + esc(M.PERIODS[k].label) + '</span></label>';
  }).join('');
  $('quest-filter').innerHTML = '<option value="all">All quests</option>' + D.quests.map(function (q) {
    return '<option value="' + q.id + '">' + pad2(q.number) + ' ' + esc(q.title) + '</option>';
  }).join('');

  $('scenario').addEventListener('change', function (e) {
    state.scenario = e.target.value;
    state.selectedKey = null;
    state.journeyDays = 3;
    render('Showing: ' + D.scenarios[state.scenario].label + '. ');
  });
  $('filters').addEventListener('submit', function (e) { e.preventDefault(); });
  $('period-options').addEventListener('change', function (e) {
    state.filters.period = e.target.value; filtersChanged();
  });
  $('quest-filter').addEventListener('change', function (e) {
    state.filters.quest = e.target.value; filtersChanged();
  });
  $('reset-filters').addEventListener('click', function () {
    if (isDefault()) { $('filter-status').textContent = 'Already showing the default view: Last 28 days, all quests.'; return; }
    state.filters = Object.assign({}, M.DEFAULT_FILTERS);
    filtersChanged('Filters reset. ');
  });

  function filtersChanged(prefix) {
    K.savePrefs(state.filters);
    state.journeyDays = 3;
    render(prefix || '');
  }

  // ---- Render ------------------------------------------------------------------
  function render(announcement) {
    C.hideTip();
    var v = state.view = M.computeView(D, events(), state.filters);
    if (state.selectedKey && !v.challenges.some(function (r) { return r.key === state.selectedKey; })) state.selectedKey = null;

    renderProfile();
    renderFilters(v);
    renderKpis(v);
    C.renderAttempts($('chart-a'), v, { selectedKey: state.selectedKey, onSelect: select });
    $('chart-a-table').innerHTML = C.attemptsTable(v);
    $('chart-a-summary').textContent = v.challenges.length
      ? plural(v.kpis.totalAttempts, 'attempt') + ' on ' + plural(v.challenges.length, 'challenge') + ': ' + v.kpis.initialAttempts + ' initial, ' +
        plural(v.kpis.totalRetries, 'retry', 'retries') + ', plus ' + plural(v.kpis.hintsUsed, 'hint') + ' used. ' + v.kpis.challengesCompleted + ' completed.'
      : 'No activity in this view.';
    C.renderMastery($('chart-b'), $('chart-b-legend'), v, D.quests);
    $('chart-b-table').innerHTML = C.masteryTable(v);
    $('chart-b-summary').textContent = masterySummary(v);
    C.renderRecovery($('chart-c'), v, M.RECOVERY_CATEGORIES);
    $('chart-c-summary').textContent = v.recovery.denominator
      ? 'What happened after each of the ' + plural(v.recovery.denominator, 'incorrect attempt') + ' in this view.'
      : 'What happens after an incorrect attempt.';
    renderDetail();
    renderJourney(v);
    renderInsights(v);
    renderConsent();
    if (announcement !== undefined) {
      $('filter-status').textContent = announcement + v.periodLabel + ', ' + questName(state.filters.quest) + ': ' +
        plural(v.challenges.length, 'challenge') + ', ' + plural(v.kpis.totalAttempts, 'attempt') + '.';
    }
  }

  function questName(id) {
    if (id === 'all') return 'all quests';
    var q = D.quests.find(function (x) { return x.id === id; });
    return pad2(q.number) + ' ' + q.title;
  }

  function masterySummary(v) {
    var s = v.mastery.series;
    if (!s.length) return 'No mastery checks in this view.';
    var parts = s.map(function (x) {
      var pts = x.points;
      return x.title + ' ' + (pts.length > 1 ? pts[0].score + '% → ' + pts[pts.length - 1].score + '%' : pts[0].score + '% (one check)');
    });
    return plural(v.mastery.checks, 'check') + ': ' + parts.join('; ') + '.';
  }

  // ---- Profile header & overview (all time) -------------------------------------
  var STATUS = {
    completed: { icon: '✓', text: 'Completed' }, 'in-progress': { icon: '<span class="ico-half" aria-hidden="true"></span>', text: 'In progress' },
    available: { icon: '●', text: 'Available' }, locked: { icon: '🔒', text: 'Locked' }
  };
  function renderProfile() {
    var o = M.overview(D, events());
    var L = o.level;
    $('hud-emblem').textContent = D.learner.emblem;
    $('avatar-emblem').textContent = D.learner.emblem;
    $('hud-name').textContent = D.learner.displayName;
    $('profile-name').textContent = D.learner.displayName;
    $('hud-level').textContent = 'Level ' + L.level + ' · ' + L.name;
    $('hero-level').innerHTML = '<span class="level-chip">Level ' + L.level + '</span> ' + esc(L.name) + ' <span class="hint">· ' + esc(D.learner.emblemLabel) + ' emblem</span>';
    var bar = $('xp-bar');
    bar.max = L.next ? L.next.min - L.min : 1;
    bar.value = L.next ? o.xp - L.min : 1;
    bar.setAttribute('aria-label', L.next ? (L.next.min - o.xp) + ' XP until ' + L.next.name : 'Highest level reached');
    $('xp-text').textContent = o.xp + ' XP' + (L.next ? ' · ' + (L.next.min - o.xp) + ' to ' + L.next.name : '');
    var ring = $('ring-value');
    var circ = 2 * Math.PI * 54;
    ring.style.strokeDasharray = circ;
    ring.style.strokeDashoffset = circ * (1 - o.challengesCompleted / o.challengesTotal);
    $('hero-quests').innerHTML = '<strong>' + o.questsCompleted + '</strong> of ' + o.quests.length + ' quests completed<br><span class="hint">' +
      o.challengesCompleted + ' of ' + o.challengesTotal + ' challenges (the ring)</span>';

    $('trail').innerHTML = o.quests.map(function (q) {
      var s = STATUS[q.status];
      var pctDone = Math.round(100 * q.done / q.total);
      return '<li class="trail-stop trail-stop--' + q.status + '">' +
        '<span class="trail-marker" aria-hidden="true">' + q.destination.icon + '</span>' +
        '<span class="trail-num">' + pad2(q.number) + '</span>' +
        '<span class="trail-title">' + esc(q.title) + '</span>' +
        '<span class="trail-meta">' + esc(q.subject) + ' · ' + esc(q.destination.name) + '</span>' +
        '<span class="status status--' + q.status + '"><span aria-hidden="true" class="status-icon">' + s.icon + '</span> ' + s.text + '</span>' +
        (q.status === 'in-progress' ? '<span class="trail-progress"><progress max="' + q.total + '" value="' + q.done + '" aria-label="' + q.done + ' of ' + q.total + ' challenges"></progress><span class="hint">' + q.done + ' of ' + q.total + ' challenges</span></span>' : '') +
        (q.status === 'completed' ? '<span class="hint trail-count">' + q.total + ' of ' + q.total + ' challenges</span>' : '') +
        '<span class="sr-only">' + pctDone + '% of challenges done.</span></li>';
    }).join('');

    var latest = o.latestMastery;
    var mastery = latest
      ? latest.score + '%' + (o.previousMastery ? ' <span class="delta">' + (latest.score >= o.previousMastery.score ? '↑' : '↓') + ' from ' + o.previousMastery.score + '%</span>' : '')
      : '—';
    $('overview').innerHTML =
      '<div class="ov"><dt>Challenges completed</dt><dd>' + o.challengesCompleted + ' <span class="of">/ ' + o.challengesTotal + '</span></dd></div>' +
      '<div class="ov"><dt>Concepts revisited</dt><dd>' + o.conceptsRevisited + '</dd><p class="hint">skills you came back to on a later day</p></div>' +
      '<div class="ov"><dt>Latest mastery check</dt><dd>' + mastery + '</dd><p class="hint">' + (latest ? esc(latest.title) + ' · ' + fmtDay(latest.day) : 'No mastery checks yet') + '</p></div>';
  }

  // ---- Filters & KPIs -----------------------------------------------------------
  function renderFilters(v) {
    document.querySelectorAll('input[name="period"]').forEach(function (r) { r.checked = r.value === state.filters.period; });
    $('quest-filter').value = state.filters.quest;
    var reset = $('reset-filters');
    reset.setAttribute('aria-disabled', String(isDefault()));
    reset.title = isDefault() ? 'Already showing the default view (Last 28 days, all quests)' : 'Back to Last 28 days, all quests';
    $('filter-memory').textContent = K.get().preferences
      ? 'Preferences are on, so this filter choice is remembered on this device.'
      : 'Preferences are off, so filters reset when you leave. Turn on Preferences in Privacy settings to remember them.';
  }

  function renderKpis(v) {
    var k = v.kpis;
    var mc = k.masteryChange;
    var cards = [
      { label: 'Challenges completed', value: k.challengesCompleted, sub: k.challengesActive ? 'of ' + plural(k.challengesActive, 'challenge') + ' you worked on' : 'no challenges in this view' },
      { label: 'Total attempts', value: k.totalAttempts, sub: k.initialAttempts + ' initial + ' + plural(k.totalRetries, 'retry', 'retries') },
      { label: 'Retries', value: k.totalRetries, sub: 'answers after the first one on a challenge' },
      { label: 'Retry-to-success', value: k.retryToSuccess === null ? '—' : k.retryToSuccess + '%',
        sub: k.retryToSuccessDenominator ? k.retryToSuccessNumerator + ' of ' + plural(k.retryToSuccessDenominator, 'challenge') + ' with a retry were completed' : 'no retries in this view' },
      { label: 'Concepts revisited', value: k.conceptsRevisited, sub: k.conceptsRevisited ? 'skills returned to on a later day' : 'none in this view' },
      { label: 'Mastery change', value: mc === null ? '—' : (mc > 0 ? '+' : mc < 0 ? '−' : '±') + Math.abs(mc) + '<span class="unit"> pts</span>',
        sub: mc === null ? 'needs two checks in the same quest in this view' : 'average across ' + plural(k.masteryChangeQuests, 'quest') + ' with 2+ checks', tone: mc === null ? '' : mc > 0 ? 'up' : mc < 0 ? 'down' : '' }
    ];
    $('kpis').innerHTML = cards.map(function (c) {
      return '<div class="kpi' + (c.tone ? ' kpi--' + c.tone : '') + '"><p class="kpi-label">' + esc(c.label) + '</p><p class="kpi-value">' + c.value + '</p><p class="kpi-sub">' + esc(c.sub) + '</p></div>';
    }).join('');
  }

  // ---- Challenge detail ---------------------------------------------------------
  function select(key) {
    state.selectedKey = state.selectedKey === key ? null : key;
    document.querySelectorAll('.bc-hit').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.key === state.selectedKey)); });
    renderDetail();
    if (state.selectedKey) {
      var panel = $('detail');
      panel.scrollIntoView({ block: 'nearest' });
      panel.focus({ preventScroll: true });
    }
  }

  var STEP = {
    challenge_started: function () { return { cls: 'start', icon: '▸', text: 'Started' }; },
    hint_requested: function () { return { cls: 'hint', icon: '💡', text: 'Hint' }; },
    answer_submitted: function (e) {
      return e.correct ? { cls: 'ok', icon: '✓', text: (e.isRetry ? 'Retry ' : 'Attempt ') + e.ordinal + ': correct' }
        : { cls: 'no', icon: e.isRetry ? '↻' : '✎', text: (e.isRetry ? 'Retry ' : 'Attempt ') + e.ordinal + ': not yet' };
    }
  };

  function renderDetail() {
    var panel = $('detail');
    var r = state.selectedKey && state.view.challenges.find(function (x) { return x.key === state.selectedKey; });
    if (!r) { panel.hidden = true; panel.innerHTML = ''; return; }
    var steps = r.events.map(function (e) {
      var s = STEP[e.type](e);
      return '<li class="step step--' + s.cls + '"><span class="step-icon" aria-hidden="true">' + s.icon + '</span><span>' + esc(s.text) + '</span><span class="step-time">' + fmtDay(e.ts) + ', ' + e.ts.slice(11, 16) + '</span></li>';
    }).join('');
    var cats = {};
    M.RECOVERY_CATEGORIES.forEach(function (c) { cats[c.id] = c.label; });
    var rec = r.recovery.length
      ? '<ul class="plain-list">' + r.recovery.map(function (x, i) {
          return '<li>Incorrect answer ' + (i + 1) + ' (' + x.ts.slice(11, 16) + '): ' + esc(cats[x.outcome].toLowerCase()) + '</li>';
        }).join('') + '</ul>'
      : '<p class="hint">No incorrect answers on this challenge in this view.</p>';
    panel.hidden = false;
    panel.innerHTML =
      '<div class="detail-head"><div><p class="eyebrow">Challenge breakdown · ' + pad2(r.questNumber) + ' ' + esc(r.questTitle) + '</p>' +
      '<h3 id="detail-title">' + esc(r.title) + '</h3>' +
      '<p class="hint">Concept' + (r.skills.length === 1 ? '' : 's') + ': ' + (r.skills.length ? esc(r.skills.map(function (s) { return D.skills[s] || s; }).join(', ')) : '—') + '</p></div>' +
      '<button type="button" class="btn btn-sm btn-ghost" id="detail-close">Close<span class="sr-only"> breakdown</span></button></div>' +
      '<dl class="detail-stats"><div><dt>Initial attempt</dt><dd>' + r.initial + '</dd></div><div><dt>Retries</dt><dd>' + r.retries + '</dd></div>' +
      '<div><dt>Total attempts</dt><dd>' + r.attempts + '</dd></div><div><dt>Hints used</dt><dd>' + r.hints + '</dd></div>' +
      '<div><dt>Status</dt><dd class="detail-status">' + (r.status === 'completed' ? '✓ ' : '<span class="ico-half" aria-hidden="true"></span> ') + esc(C.statusText(r)) + '</dd></div></dl>' +
      '<div class="detail-cols"><div><h4>What happened, in order</h4><ol class="steps">' + steps + '</ol></div>' +
      '<div><h4>After each incorrect answer</h4>' + rec +
      '<p class="hint">Retries = total attempts − the initial attempt. Hints are listed but never counted as attempts.</p></div></div>';
    $('detail-close').addEventListener('click', function () {
      var key = state.selectedKey;
      select(key);
      var bar = document.querySelector('.bc-hit[data-key="' + key + '"]');
      if (bar) { document.querySelectorAll('.bc-hit').forEach(function (b) { b.tabIndex = b === bar ? 0 : -1; }); bar.focus(); }
    });
  }

  // ---- Journey --------------------------------------------------------------------
  function renderJourney(v) {
    var days = v.journey;
    $('journey-sub').textContent = v.periodLabel.toLowerCase() + ' · ' + questName(state.filters.quest);
    if (!days.length) {
      $('journey').innerHTML = '<li class="empty-state"><span class="empty-icon" aria-hidden="true">🧭</span><p><strong>Nothing on the trail in this view</strong></p><p class="hint">Activity will appear here as you play.</p></li>';
      $('journey-more').hidden = true;
      return;
    }
    var shown = days.slice(0, state.journeyDays);
    $('journey').innerHTML = shown.map(function (d) {
      return '<li class="journey-day"><h3 class="journey-date">' + fmtDay(d.day) + '</h3><ol class="journey-items">' + d.items.map(function (it) {
        var title = it.challengeTitle
          ? '<button type="button" class="link-button" data-select="' + esc(it.key) + '">' + esc(it.challengeTitle) + '</button>'
          : '<span class="journey-quest">' + esc(it.questTitle || '') + '</span>';
        return '<li class="ji ji--' + it.kind + '"><span class="ji-icon" aria-hidden="true">' + it.icon + '</span><span class="ji-body">' + title +
          '<span class="ji-text">' + esc(it.text) + '</span></span><span class="ji-time">' + it.time + '</span></li>';
      }).join('') + '</ol></li>';
    }).join('');
    var more = $('journey-more');
    var left = days.length - shown.length;
    more.hidden = left <= 0;
    more.textContent = 'Show ' + plural(left, 'earlier day');
    $('journey').querySelectorAll('[data-select]').forEach(function (b) {
      b.addEventListener('click', function () { state.selectedKey = null; select(b.dataset.select); });
    });
  }
  $('journey-more').addEventListener('click', function () {
    var first = state.journeyDays;
    state.journeyDays += 5;
    renderJourney(state.view);
    var next = $('journey').children[first];
    if (next) { var h = next.querySelector('.journey-date'); h.tabIndex = -1; h.focus(); }
  });

  // ---- Insights ---------------------------------------------------------------------
  function renderInsights(v) {
    $('insights-sub').textContent = v.periodLabel.toLowerCase() + ' · ' + questName(state.filters.quest);
    $('insights').innerHTML = v.insights.length ? v.insights.map(function (i) {
      return '<li class="insight"><span class="insight-icon" aria-hidden="true">' + i.icon + '</span><div><p class="insight-title">' + esc(i.title) + '</p><p class="hint"><span class="evidence-label">Based on:</span> ' + esc(i.evidence) + '</p></div></li>';
    }).join('') : '<li class="empty-state"><p><strong>No observations for this view yet</strong></p><p class="hint">Observations only appear when the data in this view supports them.</p></li>';
  }

  // ---- Consent ---------------------------------------------------------------------
  var dialog = $('privacy-dialog');
  var form = $('privacy-form');
  var lastOpener = null;

  function onOff(on) { return on ? '<span class="state state--on">✓ On</span>' : '<span class="state state--off">○ Off</span>'; }
  function renderConsent() {
    var s = K.get();
    $('cookie-banner').hidden = s.decided;
    document.body.classList.toggle('has-banner', !s.decided);
    $('consent-state-storage').innerHTML =
      '<li><span>Essential storage</span><span class="state state--always">● Always on</span></li>' +
      '<li><span>Preferences</span>' + onOff(s.preferences) + '</li>' +
      '<li><span>Analytics</span>' + onOff(s.analytics) + '</li>' +
      '<li><span>Marketing</span>' + onOff(s.marketing) + '</li>';
    $('consent-state-learning').innerHTML =
      '<li><span>Progress record (shows this profile)</span><span class="state state--always">● Part of the game</span></li>' +
      '<li><span>Help improve my learning experience</span>' + onOff(s.learningImprovement) + '</li>';
    $('consent-updated').textContent = s.decided
      ? 'Choices saved in this browser on ' + new Date(s.decidedAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) + '.' + (K.storageAvailable() ? '' : ' Storage is blocked, so they will be forgotten when you leave.')
      : 'You haven’t made a choice yet, so nothing optional is on.';
  }

  function openPrivacy(opener) {
    lastOpener = opener || document.activeElement;
    var s = K.get();
    ['preferences', 'analytics', 'marketing', 'learningImprovement'].forEach(function (k) { form.elements[k].checked = s[k]; });
    dialog.showModal();
    dialog.querySelector('h2').setAttribute('tabindex', '-1');
    dialog.querySelector('h2').focus();
  }
  function closePrivacy(message) {
    dialog.close();
    if (lastOpener && document.body.contains(lastOpener) && !lastOpener.closest('#cookie-banner')) lastOpener.focus();
    else $('privacy-title').setAttribute('tabindex', '-1'), $('privacy-title').focus();
    if (message) $('filter-status').textContent = message;
  }
  document.querySelectorAll('[data-open-privacy]').forEach(function (b) { b.addEventListener('click', function () { openPrivacy(b); }); });
  $('dialog-save').addEventListener('click', function () {
    var c = {};
    ['preferences', 'analytics', 'marketing', 'learningImprovement'].forEach(function (k) { c[k] = form.elements[k].checked; });
    K.save(c); closePrivacy('Privacy choices saved.');
  });
  $('dialog-accept').addEventListener('click', function () {
    form.elements.preferences.checked = form.elements.analytics.checked = form.elements.marketing.checked = true;
    K.save({ preferences: true, analytics: true, marketing: true, learningImprovement: form.elements.learningImprovement.checked });
    closePrivacy('All optional cookies accepted.');
  });
  $('dialog-reject').addEventListener('click', function () {
    form.elements.preferences.checked = form.elements.analytics.checked = form.elements.marketing.checked = false;
    K.save({ preferences: false, analytics: false, marketing: false, learningImprovement: form.elements.learningImprovement.checked });
    closePrivacy('All optional cookies rejected.');
  });
  $('cookie-accept').addEventListener('click', function () { K.acceptOptional(); $('privacy-title').setAttribute('tabindex', '-1'); $('filter-status').textContent = 'Optional cookies accepted. You can change this any time in Privacy settings.'; });
  $('cookie-reject').addEventListener('click', function () { K.rejectOptional(); $('filter-status').textContent = 'Optional cookies rejected. You can change this any time in Privacy settings.'; });
  $('reset-consent').addEventListener('click', function () { K.reset(); $('filter-status').textContent = 'Prototype choices cleared. The cookie banner is showing again.'; });
  $('dialog-notice-link').addEventListener('click', function () { dialog.close(); });
  K.onChange(function () { K.savePrefs(state.filters); renderConsent(); renderFilters(state.view); });

  // ---- Event log -------------------------------------------------------------------
  var logDialog = $('log-dialog');
  function openLog() {
    var ev = events();
    $('log-table').innerHTML = ev.length ? '<table class="data-table log-table"><thead><tr><th scope="col">Id</th><th scope="col">Time</th><th scope="col">Event</th><th scope="col">Quest</th><th scope="col">Challenge / skill</th><th scope="col">Detail</th></tr></thead><tbody>' +
      ev.map(function (e) {
        var detail = e.type === 'answer_submitted' ? (e.correct ? 'correct' : 'incorrect') : e.type === 'mastery_check' ? e.correctItems + ' / ' + e.items : e.type === 'concept_revisited' ? e.via : '';
        return '<tr><td>' + e.id + '</td><td>' + e.ts.replace('T', ' ').slice(0, 16) + '</td><td>' + e.type + '</td><td>' + e.quest + '</td><td>' + (e.challenge || e.skill || '') + '</td><td>' + detail + '</td></tr>';
      }).join('') + '</tbody></table>' : '<p class="hint">This scenario has no events.</p>';
    if (dialog.open) dialog.close();
    logDialog.showModal();
    $('log-close').focus();
  }
  $('open-log').addEventListener('click', openLog);
  $('dialog-open-log').addEventListener('click', openLog);
  $('log-close').addEventListener('click', function () { logDialog.close(); });

  // ---- Resize: charts are percentage-based; only tooltips need hiding. ----------
  window.addEventListener('resize', C.hideTip);

  render('');
})();
