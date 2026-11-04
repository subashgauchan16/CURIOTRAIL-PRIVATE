/*
 * Learning-behaviour metrics for the profile prototype.
 *
 * Pure functions, no DOM: computeView(data, events, filters) returns every
 * figure the page shows (KPIs, all three charts, the journey and insights)
 * from ONE event log, so the numbers cannot disagree with each other.
 * The definitions below are repeated in README.md.
 *
 *  Attempt            One "answer_submitted" event.
 *  Initial attempt    The first answer a learner ever submits for a challenge.
 *  Retry              Any later answer to the same challenge. The initial attempt
 *                     is never a retry, so retries = attempts − initial attempts.
 *                     An answer's ordinal is counted over the whole history, so
 *                     a period filter never turns a retry into an "initial".
 *  Hint used          One "hint_requested" event. Not an attempt.
 *  Completed          The challenge has a correct answer inside the view.
 *  Incomplete         Activity in the view but no correct answer yet.
 *  Recovery outcome   For each incorrect attempt in the view, what happens next on
 *                     the same challenge within RECOVERY_WINDOW_DAYS:
 *                       solved-next   next answer correct, no hint in between
 *                       hint-solved   a hint, then the next answer is correct
 *                       another-try   next answer also incorrect
 *                       no-further    no further answer (yet) in the window
 *  Recovery rate      (solved-next + hint-solved) ÷ incorrect attempts in view.
 *  Retry-to-success   Challenges with ≥ 1 retry in view that were completed
 *                     ÷ challenges with ≥ 1 retry in view.
 *  Concept revisit    A "concept_revisited" event (practice round or lesson re-read)
 *                     for a skill the learner first met on an EARLIER calendar day.
 *                     KPI = distinct skills revisited in view.
 *  Mastery score      Items correct ÷ items in a mastery check, as a percentage.
 *  Mastery change     For each quest with ≥ 2 checks in view: latest − earliest
 *                     score, in percentage points. KPI = mean across those quests.
 *                     Not shown when no quest has 2 checks in the view.
 */
(function (root) {
  'use strict';

  var DAY_MS = 86400000;
  var RECOVERY_WINDOW_DAYS = 7;
  var PERIODS = {
    '7d': { days: 7, label: 'Last 7 days' },
    '14d': { days: 14, label: 'Last 14 days' },
    '28d': { days: 28, label: 'Last 28 days' },
    all: { days: null, label: 'All time' }
  };
  var DEFAULT_FILTERS = { period: '28d', quest: 'all' };

  function dayOf(ts) { return ts.slice(0, 10); }
  function toMs(ts) { return Date.parse(ts.length === 10 ? ts + 'T00:00:00Z' : ts + 'Z'); }
  function shiftDay(day, n) { return new Date(toMs(day) + n * DAY_MS).toISOString().slice(0, 10); }

  /** Inclusive calendar-day range for a period, ending on the prototype clock. */
  function periodRange(period, clock, events) {
    var p = PERIODS[period] || PERIODS[DEFAULT_FILTERS.period];
    if (p.days === null) {
      var first = events.length ? dayOf(events[0].ts) : clock;
      return { from: first < clock ? first : clock, to: clock };
    }
    return { from: shiftDay(clock, -(p.days - 1)), to: clock };
  }

  function challengeIndex(data) {
    var map = {};
    data.quests.forEach(function (q) {
      q.challenges.forEach(function (c, i) {
        map[q.id + '/' + c[0]] = { key: q.id + '/' + c[0], quest: q.id, questTitle: q.title, questNumber: q.number,
          id: c[0], title: c[1], skills: c[2], order: q.number * 100 + i };
      });
    });
    return map;
  }

  /** Annotate the full history once: answer ordinals and first-met day per skill. */
  function annotate(data, events) {
    var index = challengeIndex(data);
    var ordinals = {};
    var firstSkillDay = {};
    var out = events.map(function (e) {
      var a = Object.assign({}, e);
      if (e.challenge) {
        var key = e.quest + '/' + e.challenge;
        a.key = key;
        if (e.type === 'answer_submitted') {
          ordinals[key] = (ordinals[key] || 0) + 1;
          a.ordinal = ordinals[key];
          a.isRetry = a.ordinal > 1;
        }
        (index[key] ? index[key].skills : []).forEach(function (s) {
          if (!firstSkillDay[s]) firstSkillDay[s] = dayOf(e.ts);
        });
      }
      if (e.type === 'concept_revisited') {
        a.validRevisit = Boolean(firstSkillDay[e.skill]) && firstSkillDay[e.skill] < dayOf(e.ts);
        if (!firstSkillDay[e.skill]) firstSkillDay[e.skill] = dayOf(e.ts);
      }
      return a;
    });
    return { events: out, index: index };
  }

  function recoveryOutcome(all, i, clock) {
    var e = all[i];
    var limit = toMs(e.ts) + RECOVERY_WINDOW_DAYS * DAY_MS;
    var hint = false;
    for (var j = i + 1; j < all.length; j++) {
      var n = all[j];
      if (n.key !== e.key) continue;
      if (toMs(n.ts) > limit) break;
      if (n.type === 'hint_requested') hint = true;
      if (n.type === 'answer_submitted') return n.correct ? (hint ? 'hint-solved' : 'solved-next') : 'another-try';
    }
    return 'no-further';
  }

  var RECOVERY_CATEGORIES = [
    { id: 'solved-next', label: 'Solved on the next try' },
    { id: 'hint-solved', label: 'Used a hint, then solved it' },
    { id: 'another-try', label: 'Needed another try' },
    { id: 'no-further', label: 'No further attempt yet' }
  ];

  function questProgress(data, all) {
    var done = {};
    var active = {};
    all.forEach(function (e) {
      if (e.quest) active[e.quest] = true;
      if (e.type === 'answer_submitted' && e.correct) done[e.key] = true;
    });
    var completed = {};
    data.quests.forEach(function (q) {
      completed[q.id] = q.challenges.every(function (c) { return done[q.id + '/' + c[0]]; });
    });
    // Mirrors src/engine/progression.ts (with "mastered" treated as "completed").
    return data.quests.map(function (q) {
      var dest = data.destinations.find(function (d) { return d.quests.indexOf(q.id) !== -1; });
      var count = q.challenges.filter(function (c) { return done[q.id + '/' + c[0]]; }).length;
      var unlocked = dest.unlockedBy.every(function (id) { return completed[id]; });
      var pos = dest.quests.indexOf(q.id);
      if (pos > 0 && !completed[dest.quests[pos - 1]]) unlocked = false;
      if ((q.requires || []).some(function (id) { return !completed[id]; })) unlocked = false;
      var status = !unlocked ? 'locked' : completed[q.id] ? 'completed' : active[q.id] ? 'in-progress' : 'available';
      return { id: q.id, number: q.number, title: q.title, subject: q.subject, destination: dest, status: status,
        done: count, total: q.challenges.length };
    });
  }

  function levelFor(levels, xp) {
    var index = 0;
    levels.forEach(function (l, i) { if (xp >= l.min) index = i; });
    return { level: index + 1, name: levels[index].name, min: levels[index].min, next: levels[index + 1] || null };
  }

  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function niceDay(day) { var p = day.split('-'); return Number(p[2]) + ' ' + MONTHS[Number(p[1]) - 1]; }

  function round1(n) { return Math.round(n * 10) / 10; }

  function computeView(data, rawEvents, filters) {
    filters = Object.assign({}, DEFAULT_FILTERS, filters || {});
    var annotated = annotate(data, rawEvents);
    var all = annotated.events;
    var index = annotated.index;
    var range = periodRange(filters.period, data.clock, all);
    var inView = function (e) {
      var d = dayOf(e.ts);
      return d >= range.from && d <= range.to && (filters.quest === 'all' || e.quest === filters.quest);
    };
    var view = all.filter(inView);

    // ---- Per-challenge rows (Chart A and the detail panel) ----
    var rows = {};
    view.forEach(function (e) {
      if (!e.key) return;
      var r = rows[e.key];
      if (!r) {
        r = rows[e.key] = Object.assign({}, index[e.key], { initial: 0, retries: 0, attempts: 0, hints: 0,
          incorrect: 0, completed: false, firstTry: false, events: [] });
      }
      r.events.push(e);
      if (e.type === 'hint_requested') r.hints++;
      if (e.type === 'answer_submitted') {
        r.attempts++;
        if (e.isRetry) r.retries++; else r.initial++;
        if (e.correct) { r.completed = true; if (!e.isRetry) r.firstTry = true; } else r.incorrect++;
      }
    });
    var challenges = Object.keys(rows).map(function (k) { return rows[k]; })
      .sort(function (a, b) { return a.order - b.order; });
    challenges.forEach(function (r) {
      r.status = r.completed ? 'completed' : r.attempts ? 'incomplete' : 'started';
      r.recovery = [];
    });

    // ---- Recovery (Chart C) ----
    var recoveryCounts = { 'solved-next': 0, 'hint-solved': 0, 'another-try': 0, 'no-further': 0 };
    all.forEach(function (e, i) {
      if (e.type !== 'answer_submitted' || e.correct || !inView(e)) return;
      var outcome = recoveryOutcome(all, i, data.clock);
      recoveryCounts[outcome]++;
      if (rows[e.key]) rows[e.key].recovery.push({ ts: e.ts, outcome: outcome });
    });
    var incorrectTotal = challenges.reduce(function (s, r) { return s + r.incorrect; }, 0);
    var recovered = recoveryCounts['solved-next'] + recoveryCounts['hint-solved'];

    // ---- Mastery (Chart B) ----
    var masteryEvents = view.filter(function (e) { return e.type === 'mastery_check'; });
    var series = {};
    masteryEvents.forEach(function (e) {
      (series[e.quest] = series[e.quest] || []).push({ ts: e.ts, day: dayOf(e.ts), score: Math.round(100 * e.correctItems / e.items),
        correctItems: e.correctItems, items: e.items, id: e.id });
    });
    var masterySeries = data.quests.filter(function (q) { return series[q.id]; }).map(function (q) {
      var pts = series[q.id];
      return { quest: q.id, title: q.title, number: q.number, points: pts,
        change: pts.length >= 2 ? pts[pts.length - 1].score - pts[0].score : null };
    });
    var changes = masterySeries.filter(function (s) { return s.change !== null; });
    var masteryChange = changes.length
      ? round1(changes.reduce(function (s, c) { return s + c.change; }, 0) / changes.length) : null;

    // ---- Revisits ----
    var revisits = view.filter(function (e) { return e.type === 'concept_revisited' && e.validRevisit; });
    var revisitedSkills = [];
    revisits.forEach(function (e) { if (revisitedSkills.indexOf(e.skill) === -1) revisitedSkills.push(e.skill); });

    // ---- KPIs ----
    var withRetry = challenges.filter(function (r) { return r.retries > 0; });
    var withRetryDone = withRetry.filter(function (r) { return r.completed; });
    var kpis = {
      challengesCompleted: challenges.filter(function (r) { return r.completed; }).length,
      challengesActive: challenges.length,
      totalAttempts: challenges.reduce(function (s, r) { return s + r.attempts; }, 0),
      initialAttempts: challenges.reduce(function (s, r) { return s + r.initial; }, 0),
      totalRetries: challenges.reduce(function (s, r) { return s + r.retries; }, 0),
      hintsUsed: challenges.reduce(function (s, r) { return s + r.hints; }, 0),
      retryToSuccess: withRetry.length ? Math.round(100 * withRetryDone.length / withRetry.length) : null,
      retryToSuccessNumerator: withRetryDone.length,
      retryToSuccessDenominator: withRetry.length,
      conceptsRevisited: revisitedSkills.length,
      masteryChange: masteryChange,
      masteryChangeQuests: changes.length
    };

    // ---- Journey (newest day first) ----
    var days = [];
    view.slice().reverse().forEach(function (e) {
      var d = dayOf(e.ts);
      var group = days.length && days[days.length - 1].day === d ? days[days.length - 1] : null;
      if (!group) { group = { day: d, items: [] }; days.push(group); }
      group.items.push(journeyItem(e, index, data));
    });

    var view_ = {
      filters: filters, range: range, periodLabel: (PERIODS[filters.period] || PERIODS['28d']).label,
      challenges: challenges, kpis: kpis,
      recovery: { counts: recoveryCounts, denominator: incorrectTotal, recovered: recovered,
        rate: incorrectTotal ? Math.round(100 * recovered / incorrectTotal) : null, windowDays: RECOVERY_WINDOW_DAYS },
      mastery: { series: masterySeries, change: masteryChange, checks: masteryEvents.length },
      revisits: revisits.map(function (e) { return { ts: e.ts, skill: e.skill, label: data.skills[e.skill] || e.skill, via: e.via, quest: e.quest }; }),
      journey: days,
      eventCount: view.length
    };
    view_.insights = insights(view_, data);
    return view_;
  }

  function journeyItem(e, index, data) {
    var c = e.key ? index[e.key] : null;
    var base = { id: e.id, ts: e.ts, time: e.ts.slice(11, 16), key: e.key || null, challengeTitle: c ? c.title : null,
      questTitle: (data.quests.find(function (q) { return q.id === e.quest; }) || {}).title };
    switch (e.type) {
      case 'challenge_started': return Object.assign(base, { kind: 'start', icon: '▸', text: 'Started' });
      case 'hint_requested': return Object.assign(base, { kind: 'hint', icon: '💡', text: 'Asked for a hint' });
      case 'answer_submitted':
        if (e.correct) return Object.assign(base, { kind: 'complete', icon: '✓', text: e.isRetry ? 'Completed on a retry (attempt ' + e.ordinal + ')' : 'Completed on the first attempt' });
        return Object.assign(base, { kind: e.isRetry ? 'retry' : 'attempt', icon: e.isRetry ? '↻' : '✎',
          text: e.isRetry ? 'Retried (attempt ' + e.ordinal + '), not right yet' : 'First attempt, not right yet' });
      case 'mastery_check': return Object.assign(base, { kind: 'mastery', icon: '◎',
        text: 'Mastery check: ' + e.correctItems + ' of ' + e.items + ' (' + Math.round(100 * e.correctItems / e.items) + '%)' });
      case 'concept_revisited': return Object.assign(base, { kind: 'revisit', icon: '↺',
        text: 'Revisited “' + (data.skills[e.skill] || e.skill) + '”' + (e.via === 'practice' ? ' in a practice round' : ' by re-reading the lesson') + (e.validRevisit ? '' : ' (same day it was first met, so not counted as a revisit)') });
      default: return Object.assign(base, { kind: 'other', icon: '•', text: e.type });
    }
  }

  /** Supportive observations, each shown only when the view's data supports it. */
  function insights(v, data) {
    var out = [];
    var afterRetry = v.challenges.filter(function (r) { return r.completed && r.retries > 0; });
    if (afterRetry.length) {
      out.push({ id: 'after-retry', icon: '↻', title: afterRetry.length === 1 ? 'You solved a challenge after a retry' : 'You solved ' + afterRetry.length + ' challenges after a retry',
        evidence: afterRetry.map(function (r) { return r.title; }).join(', ') });
    }
    var hintHelped = v.challenges.filter(function (r) { return r.recovery.some(function (x) { return x.outcome === 'hint-solved'; }); });
    if (hintHelped.length) {
      out.push({ id: 'hints', icon: '💡', title: 'Hints helped you keep going through ' + (hintHelped.length === 1 ? 'a tricky challenge' : hintHelped.length + ' tricky challenges'),
        evidence: hintHelped.map(function (r) { return r.title; }).join(', ') + ' — a hint, then a correct answer' });
    }
    if (v.revisits.length) {
      var names = [];
      v.revisits.forEach(function (r) { if (names.indexOf(r.label) === -1) names.push(r.label); });
      out.push({ id: 'revisit', icon: '↺', title: names.length === 1 ? 'You revisited an earlier concept' : 'You revisited ' + names.length + ' earlier concepts',
        evidence: names.join(', ') });
    }
    v.mastery.series.forEach(function (s) {
      var n = s.points.length;
      if (n >= 2 && s.points[n - 1].score > s.points[n - 2].score) {
        out.push({ id: 'mastery-' + s.quest, icon: '◎', title: 'Your latest mastery check in ' + s.title + ' was higher than the one before',
          evidence: s.points[n - 2].score + '% → ' + s.points[n - 1].score + '% (' + niceDay(s.points[n - 2].day) + ' and ' + niceDay(s.points[n - 1].day) + ')' });
      }
    });
    var waiting = v.challenges.filter(function (r) { return !r.completed; });
    if (waiting.length) {
      out.push({ id: 'waiting', icon: '🧭', title: waiting.length === 1 ? 'One challenge is waiting for you' : waiting.length + ' challenges are waiting for you',
        evidence: waiting.map(function (r) { return r.title; }).join(', ') + ' — you can pick up where you left off' });
    }
    return out;
  }

  /** The all-time snapshot shown in the profile header and overview. */
  function overview(data, rawEvents) {
    var all = computeView(data, rawEvents, { period: 'all', quest: 'all' });
    var latest = null, previous = null;
    all.mastery.series.forEach(function (s) {
      var last = s.points[s.points.length - 1];
      if (!latest || last.ts > latest.ts) { latest = Object.assign({ title: s.title }, last); previous = s.points.length > 1 ? s.points[s.points.length - 2] : null; }
    });
    var quests = questProgress(data, annotate(data, rawEvents).events);
    return {
      challengesCompleted: all.kpis.challengesCompleted,
      challengesTotal: data.quests.reduce(function (s, q) { return s + q.challenges.length; }, 0),
      conceptsRevisited: all.kpis.conceptsRevisited,
      latestMastery: latest, previousMastery: previous,
      quests: quests,
      questsCompleted: quests.filter(function (q) { return q.status === 'completed'; }).length,
      level: levelFor(data.levels, rawEvents.length ? data.placeholderXp : 0),
      xp: rawEvents.length ? data.placeholderXp : 0
    };
  }

  var api = { computeView: computeView, overview: overview, periodRange: periodRange, levelFor: levelFor,
    PERIODS: PERIODS, DEFAULT_FILTERS: DEFAULT_FILTERS, RECOVERY_CATEGORIES: RECOVERY_CATEGORIES,
    RECOVERY_WINDOW_DAYS: RECOVERY_WINDOW_DAYS };
  root.CURIO_METRICS = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
