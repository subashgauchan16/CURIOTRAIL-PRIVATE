/*
 * ILLUSTRATIVE PROTOTYPE DATA — NOT A REAL LEARNER, NOT REAL USAGE STATISTICS.
 *
 * Quest, challenge and skill ids, titles and unlock rules are copied from the
 * repository (public/data/world.json and public/data/quests/*.json) so the
 * prototype speaks CurioTrail's language. Everything about the learner —
 * dates, attempts, hints, mastery-check scores, revisits — is invented to
 * exercise every case the dashboard has to handle.
 *
 * The learner's activity is written as compact "attempt scripts" and expanded
 * into one flat event log (CURIO_PROTO.scenarios[name].events). Every chart,
 * KPI, insight and timeline entry is computed from that log by metrics.js.
 *
 * Script letters, in order:  x = incorrect answer submitted
 *                            h = hint requested
 *                            o = correct answer submitted (challenge completed)
 * Every script starts with a "challenge started" event. An empty script means
 * the learner opened the challenge but has not answered yet.
 */
(function (root) {
  'use strict';

  // ---- Repository metadata (real) -------------------------------------------
  var QUESTS = [
    { id: 'missing-signal', number: 1, title: 'The Missing Signal', subject: 'AI literacy', destination: 'signal-woods',
      challenges: [
        ['investigate', 'Gather the evidence', []],
        ['find-source', 'Find the source', ['distinguish-source']],
        ['spot-conflict', 'Spot the conflict', ['identify-contradiction']],
        ['verify-time', 'Decide what to do', ['verify-claims']],
        ['rumour', 'A second opinion?', ['verify-claims', 'distinguish-source']],
        ['better-prompt', 'Improve the instructions', ['prompt-context']],
        ['assemble', 'Build the final announcement', ['verify-claims']]
      ] },
    { id: 'the-ledger', number: 2, title: 'The Ledger in the Woods', subject: 'SQL', destination: 'signal-woods',
      challenges: [
        ['read-select', 'Reading a query', ['read-query']],
        ['filter-north', 'Only the North', ['filter-rows']],
        ['group-products', 'Add it up', ['group-aggregate']],
        ['top-product', 'The top earner', ['rank-results']],
        ['interpret', 'What can we tell the council?', ['interpret']]
      ] },
    { id: 'broken-tally', number: 3, title: 'The Broken Tally', subject: 'Python', destination: 'viking-workshop',
      challenges: [
        ['read-error', 'Read the error', ['read-errors']],
        ['fix-print', 'Repair the print', ['fix-types']],
        ['average', 'The weekly average', ['write-expressions']],
        ['revenue', 'What the week earned', ['write-expressions']],
        ['predict', 'Predict the output', ['predict-output']]
      ] },
    { id: 'market-ledger', number: 4, title: "The Merchant's Ledger", subject: 'Excel', destination: 'trading-market',
      challenges: [
        ['find-cell', 'Where is the honey?', ['read-cells']],
        ['row-revenue', 'Balance the scales', ['write-formulas']],
        ['total', 'Fill the coin chest', ['use-ranges']],
        ['average-price', 'The typical price', ['use-ranges']],
        ['rune-max', 'The rune of the greatest', ['use-ranges']],
        ['highest-price', 'The prize of the stall', ['use-ranges']],
        ['absolute', 'The vanishing tax', []], ['profit-fix', 'The impossible losses', []],
        ['error-runes', 'The cursed runes', []], ['rune-wheel', 'The rune wheel', []],
        ['restock', 'The restock gamble', []], ['explain-restock', 'Why the rope rotted', []],
        ['audit-revenue', "Audit I: Hrolf's figures", []], ['audit-tax', 'Audit II: the short tax', []],
        ['audit-discrepancy', 'Audit III: the missing coins', []], ['audit-rune', "Audit IV: Hrolf's riddle", []],
        ['audit-verdict', 'Audit V: the verdict', []]
      ] },
    { id: 'great-hall-dashboard', number: 5, title: "The Jarl's Dashboard", subject: 'Business analytics', destination: 'great-hall',
      challenges: [
        ['what-kpi', 'What is a KPI?', ['define-kpi']], ['sort-kpis', 'Build the dashboard', ['categorise-kpis']],
        ['tradeoff', 'Reading KPIs together', ['interpret-tradeoffs']], ['chart', 'Choosing a chart', ['choose-visual']]
      ] },
    { id: 'star-chart', number: 6, title: 'The Star Chart', subject: 'Data modelling', destination: 'great-hall', requires: ['the-ledger'],
      challenges: [['grain-check', 'Check the grain', []], ['build-star', 'The modelling lab', []], ['filter-path', 'Check your understanding', []]] }
  ];

  var DESTINATIONS = [
    { id: 'signal-woods', name: 'The Signal Woods', icon: '🌲', quests: ['missing-signal', 'the-ledger'], unlockedBy: [] },
    { id: 'trading-market', name: 'The Trading Market', icon: '⚖️', quests: ['market-ledger'], unlockedBy: ['missing-signal'] },
    { id: 'viking-workshop', name: 'The Viking Workshop', icon: '🛠️', quests: ['broken-tally'], unlockedBy: ['missing-signal'] },
    { id: 'great-hall', name: 'The Great Hall', icon: '🏛️', quests: ['great-hall-dashboard', 'star-chart'], unlockedBy: ['market-ledger'] }
  ];

  // Readable names for skill ids. Where a lesson teaches the skill, this is the
  // lesson's own "concept" title from the quest JSON.
  var SKILLS = {
    'distinguish-source': 'Sources and summaries', 'identify-contradiction': 'Spotting contradictions',
    'verify-claims': 'Checking claims', 'prompt-context': 'Writing a useful prompt',
    'read-query': 'Reading a query', 'filter-rows': 'Filtering rows with WHERE', 'group-aggregate': 'Grouping data',
    'rank-results': 'Sorting and finding the top result', 'interpret': 'Interpreting results',
    'read-errors': 'Reading errors', 'fix-types': 'Data types', 'write-expressions': 'Calculating from variables',
    'predict-output': 'Predicting output', 'read-cells': 'Reading cells', 'write-formulas': 'Writing formulas',
    'use-ranges': 'Using ranges', 'define-kpi': 'What a KPI is', 'categorise-kpis': 'Grouping KPIs on a dashboard',
    'interpret-tradeoffs': 'Reading KPIs together', 'choose-visual': 'Choosing the right chart'
  };

  // Existing level thresholds, copied from src/engine/game-engine.ts (LEVELS).
  var LEVELS = [
    { min: 0, name: 'Newcomer' }, { min: 40, name: 'Scout' }, { min: 100, name: 'Trailblazer' },
    { min: 200, name: 'Wayfinder' }, { min: 320, name: 'Navigator' }, { min: 480, name: 'Cartographer' }
  ];

  // ---- Learner activity (illustrative) --------------------------------------
  // [quest, challenge, date, start time, script]
  var DEFAULT_SCRIPTS = [
    ['missing-signal', 'investigate', '2026-09-29', '18:05', 'o'],
    ['missing-signal', 'find-source', '2026-09-29', '18:12', 'xo'],
    ['missing-signal', 'spot-conflict', '2026-09-29', '18:20', 'o'],
    ['missing-signal', 'verify-time', '2026-09-30', '19:02', 'xho'],
    ['missing-signal', 'rumour', '2026-09-30', '19:10', 'o'],
    ['missing-signal', 'better-prompt', '2026-09-30', '19:18', 'xxo'],
    ['missing-signal', 'assemble', '2026-09-30', '19:30', 'o'],
    ['the-ledger', 'read-select', '2026-10-06', '17:40', 'o'],
    ['the-ledger', 'filter-north', '2026-10-06', '17:48', 'xho'],
    ['the-ledger', 'group-products', '2026-10-07', '18:30', 'xxho'],
    ['the-ledger', 'top-product', '2026-10-08', '18:10', 'xo'],
    ['the-ledger', 'interpret', '2026-10-08', '18:22', 'o'],
    ['broken-tally', 'read-error', '2026-10-15', '19:00', 'o'],
    ['broken-tally', 'fix-print', '2026-10-15', '19:08', 'xo'],
    ['broken-tally', 'average', '2026-10-16', '18:45', 'xhxo'],
    ['broken-tally', 'revenue', '2026-10-16', '18:58', 'o'],
    ['broken-tally', 'predict', '2026-10-17', '18:15', 'xho'],
    ['market-ledger', 'find-cell', '2026-10-22', '17:55', 'o'],
    ['market-ledger', 'row-revenue', '2026-10-22', '18:03', 'xho'],
    ['market-ledger', 'total', '2026-10-23', '18:40', 'o'],
    ['market-ledger', 'average-price', '2026-10-24', '19:05', 'xx'],
    ['market-ledger', 'rune-max', '2026-10-27', '18:20', '']
  ];
  // Mastery checks: [quest, date, time, items correct, items in the check]
  var DEFAULT_MASTERY = [
    ['missing-signal', '2026-09-30', '19:40', 3, 5],
    ['the-ledger', '2026-10-08', '18:35', 2, 5],
    ['broken-tally', '2026-10-17', '18:30', 3, 5],
    ['the-ledger', '2026-10-17', '18:40', 3, 5],
    ['missing-signal', '2026-10-20', '17:30', 4, 5],
    ['the-ledger', '2026-10-25', '11:10', 4, 5],
    ['broken-tally', '2026-10-27', '18:50', 4, 5]
  ];
  // Concept revisits (a Practice round or re-opening a lesson): [skill, quest, date, time, via]
  var DEFAULT_REVISITS = [
    ['filter-rows', 'the-ledger', '2026-10-12', '20:10', 'practice'],
    ['verify-claims', 'missing-signal', '2026-10-20', '17:20', 'lesson'],
    ['group-aggregate', 'the-ledger', '2026-10-24', '18:50', 'practice'],
    ['write-expressions', 'broken-tally', '2026-10-26', '19:30', 'practice']
  ];

  // A learner who has answered everything correctly first time: exercises the
  // zero-retry, zero-hint and empty-recovery states.
  var NO_RETRY_SCRIPTS = [
    ['missing-signal', 'investigate', '2026-10-21', '18:05', 'o'],
    ['missing-signal', 'find-source', '2026-10-21', '18:12', 'o'],
    ['missing-signal', 'spot-conflict', '2026-10-21', '18:20', 'o'],
    ['missing-signal', 'verify-time', '2026-10-23', '19:02', 'o'],
    ['missing-signal', 'rumour', '2026-10-23', '19:10', 'o']
  ];
  var NO_RETRY_MASTERY = [['missing-signal', '2026-10-23', '19:30', 4, 5]];

  // ---- Expansion into one event log -----------------------------------------
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function addMinutes(date, time, minutes) {
    var parts = time.split(':');
    var total = Number(parts[0]) * 60 + Number(parts[1]) + minutes;
    return date + 'T' + pad(Math.floor(total / 60)) + ':' + pad(total % 60) + ':00';
  }

  function build(scripts, mastery, revisits) {
    var events = [];
    scripts.forEach(function (s) {
      var quest = s[0], challenge = s[1], date = s[2], time = s[3], script = s[4];
      var minute = 0;
      events.push({ type: 'challenge_started', ts: addMinutes(date, time, minute), quest: quest, challenge: challenge });
      script.split('').forEach(function (step) {
        minute += 2;
        var ts = addMinutes(date, time, minute);
        if (step === 'h') events.push({ type: 'hint_requested', ts: ts, quest: quest, challenge: challenge });
        else events.push({ type: 'answer_submitted', ts: ts, quest: quest, challenge: challenge, correct: step === 'o' });
      });
    });
    mastery.forEach(function (m) {
      events.push({ type: 'mastery_check', ts: m[1] + 'T' + m[2] + ':00', quest: m[0], correctItems: m[3], items: m[4] });
    });
    revisits.forEach(function (r) {
      events.push({ type: 'concept_revisited', ts: r[2] + 'T' + r[3] + ':00', skill: r[0], quest: r[1], via: r[4] });
    });
    events.sort(function (a, b) { return a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0; });
    events.forEach(function (e, i) { e.id = 'e' + String(i + 1).padStart(3, '0'); });
    return events;
  }

  var data = {
    label: 'Illustrative prototype data',
    // The prototype's fixed "today", so periods are reproducible.
    clock: '2026-10-28',
    // Placeholder XP: the real value comes from the game's existing XP rules.
    placeholderXp: 165,
    learner: { displayName: 'Sample Pathfinder', emblem: '🦉', emblemLabel: 'Owl' },
    quests: QUESTS, destinations: DESTINATIONS, skills: SKILLS, levels: LEVELS,
    scenarios: {
      default: { label: 'Illustrative learner (default)', events: build(DEFAULT_SCRIPTS, DEFAULT_MASTERY, DEFAULT_REVISITS) },
      'no-retries': { label: 'Everything right first time (zero retries)', events: build(NO_RETRY_SCRIPTS, NO_RETRY_MASTERY, []) },
      empty: { label: 'New learner (no activity yet)', events: [] }
    }
  };

  root.CURIO_PROTO = data;
  if (typeof module !== 'undefined' && module.exports) module.exports = data;
})(typeof globalThis !== 'undefined' ? globalThis : this);
