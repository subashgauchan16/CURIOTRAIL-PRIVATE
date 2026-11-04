/*
 * Prototype consent state. A LOCAL DEMONSTRATION, not a consent-management
 * platform: it records choices in this browser's localStorage and changes
 * what the page does (only the Preferences category has a real effect here:
 * whether the analytics filters are remembered). Nothing is ever sent.
 *
 * Keys written (both removable with "Reset prototype choices"):
 *   curio-proto-consent  the choices below (treated as essential storage)
 *   curio-proto-prefs    remembered filters, written ONLY while Preferences is on
 */
(function (root) {
  'use strict';

  var KEY = 'curio-proto-consent';
  var PREFS_KEY = 'curio-proto-prefs';
  var OPTIONAL = ['preferences', 'analytics', 'marketing'];
  var memory = {}; // fallback when storage is blocked

  function store() {
    try { var s = root.localStorage; s.setItem('__t', '1'); s.removeItem('__t'); return s; } catch (e) { return null; }
  }
  function read(key) {
    var s = store();
    try { var raw = s ? s.getItem(key) : memory[key]; return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
  }
  function write(key, value) {
    var raw = JSON.stringify(value);
    var s = store();
    try { if (s) s.setItem(key, raw); else memory[key] = raw; } catch (e) { memory[key] = raw; }
  }
  function remove(key) {
    var s = store();
    try { if (s) s.removeItem(key); } catch (e) { /* ignore */ }
    delete memory[key];
  }

  /** Nothing optional is on until the learner chooses. */
  function defaults() {
    return { version: 1, decided: false, preferences: false, analytics: false, marketing: false, learningImprovement: false, decidedAt: null };
  }

  var listeners = [];
  var state = Object.assign(defaults(), read(KEY) || {});

  function set(change) {
    state = Object.assign({}, state, change, { decided: true, decidedAt: new Date().toISOString() });
    write(KEY, state);
    if (!state.preferences) remove(PREFS_KEY); // withdrawing Preferences forgets remembered choices
    listeners.forEach(function (fn) { fn(state); });
  }

  var api = {
    get: function () { return Object.assign({}, state); },
    onChange: function (fn) { listeners.push(fn); },
    acceptOptional: function () { set({ preferences: true, analytics: true, marketing: true }); },
    rejectOptional: function () { set({ preferences: false, analytics: false, marketing: false }); },
    save: function (choices) {
      var c = {};
      OPTIONAL.concat('learningImprovement').forEach(function (k) { c[k] = Boolean(choices[k]); });
      set(c);
    },
    reset: function () {
      remove(KEY); remove(PREFS_KEY);
      state = defaults();
      listeners.forEach(function (fn) { fn(state); });
    },
    storageAvailable: function () { return Boolean(store()); },
    // Preferences-gated storage for remembered filters.
    loadPrefs: function () { return state.preferences ? read(PREFS_KEY) : null; },
    savePrefs: function (value) { if (state.preferences) write(PREFS_KEY, value); },
    KEYS: { consent: KEY, prefs: PREFS_KEY }
  };
  root.CURIO_CONSENT = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
