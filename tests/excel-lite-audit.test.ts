// Audit of excel-lite against the formulas the Merchant's Ledger uses and the
// variants players are likely to type. excel-lite is a small teaching
// evaluator, NOT Excel: the second block pins down where it deliberately or
// knowingly differs, so a change in behaviour is a conscious decision.
import { describe, expect, test } from 'vitest';
import { evaluateFormula, fillFormula, makeSheet } from '../src/engine/excel-lite';
import { evaluateSheet } from '../src/engine/game-engine';
import * as engine from '../src/engine/game-engine';
import type { Quest, WheelFormula, WheelScene } from '../src/engine/types';
import { loadAllQuests, loadQuest } from './helpers';

const sheet = () => makeSheet(['Item', 'Price', 'Qty', 'Rev', 'Rate', 'X'], [['Furs', 25, 6, 150, 0.1, 6], ['Honey', 8, 15, 120, null, 15], ['Amber', 40, 3, 120, null, 0], ['Rope', 5, 22, 110, null, 22], ['Total', null, null, null, null, null]]);
const ev = (f: string, at = 'G2') => evaluateFormula(f, sheet(), at);
const val = (f: string, at = 'G2') => { const r = ev(f, at); return r.ok ? r.value : r.error; };

describe('formulas used in the quest, and equivalent player variants, match Excel', () => {
  test.each([
    ['=B2*C2', 150], ['=b2*c2', 150], ['= B2 * C2', 150], ['=+B2*C2', 150], ['=C2*B2', 150],
    ['=SUM(D2:D5)', 500], ['=SUM(D5:D2)', 500], ['=sum(d2:d5)', 500], ['=SUM(D2,D3,D4,D5)', 500],
    ['=AVERAGE(B2:B5)', 19.5], ['=AVERAGE(B1:B5)', 19.5], ['=MAX(B2:B5)', 40], ['=MIN(B2:B5)', 5],
    ['=(B2-C2)*D2', 2850], ['=B2*D2-C2*D2', 2850], ['=SUM(D2:D5)*E2', 50], ['=SUM(D2:D5)*$E$2', 50],
    ['=B2*MIN(C2,F2)-E2*F2', 149.4], ['=COUNT(A2:F5)', 17], ['=E3*B3', 0], ['=50%*B2', 12.5], ['=-B2^2', 625],
  ])('%s → %s', (f, expected) => {
    expect(val(f)).toBeCloseTo(expected as number, 9);
  });
  test('errors match Excel codes', () => {
    expect(val('=SUM(D2:D5)/0')).toBe('#DIV/0!');
    expect(val('=A2*2')).toBe('#VALUE!');
    expect(val('=SUMM(D2:D5)')).toBe('#NAME?');
    expect(val('=AVERAGE(E3:E5)')).toBe('#DIV/0!');
  });
  test('circular references are refused, including a range that contains the formula’s own cell', () => {
    expect(val('=D6*2', 'D6')).toMatch(/Circular/);
    expect(val('=SUM(D2:D6)', 'D6')).toMatch(/Circular/);
    expect(val('=SUM(D1:D7)', 'D6')).toMatch(/Circular/); // previously returned 500
    expect(val('=SUM(D2:D5)', 'D6')).toBe(500);
  });
  test('fill-down shifts relative rows and keeps $-locked rows, like the fill handle', () => {
    expect(fillFormula('=B2*$E$2', 2)).toBe('=B4*$E$2');
    expect(fillFormula('=B2*E$2', 2)).toBe('=B4*E$2');
    expect(fillFormula('=B2*$E2', 2)).toBe('=B4*$E4');
    expect(fillFormula('=B2*MIN(D2,E2)-C2*E2', 1)).toBe('=B3*MIN(D3,E3)-C3*E3');
  });
  test('the quest rejects formulas that give the right number for the wrong reason', () => {
    const q = loadQuest('market-ledger') as Quest;
    const total = q.scenes.find((s) => s.id === 'total')!;
    expect(engine.evaluate(total, { formula: '=150+120+120+110' }).feedback).toMatch(/typed numbers/);
    expect(engine.evaluate(total, { formula: '=D2+D3+D4+D5' }).feedback).toMatch(/SUM function/);
    expect(engine.evaluate(total, { formula: '=SUM(D1:D7)' }).correct).toBe(false);
  });
});

describe('known differences from Excel (documented, not hidden)', () => {
  test('unsupported syntax gets an honest message instead of a fake Excel error', () => {
    expect(val('=B2>C2')).toMatch(/Not supported in this ledger: comparisons/); // Excel: FALSE
    expect(val('="a"&"b"')).toMatch(/Not supported in this ledger: text/); // Excel: ab
    expect(val('=TRUE')).toMatch(/Not supported in this ledger: TRUE/); // Excel: TRUE
    expect(val('=Sheet1!B2')).toMatch(/other sheets/); // Excel: 25
    expect(val('=B2−C2')).toMatch(/ordinary minus/); // typographic minus; Excel also rejects
    expect(val('=B2×C2')).toMatch(/Use \*/);
  });
  test('stricter than Excel', () => {
    expect(ev('=SUM(D2:D5').ok).toBe(false); // Excel auto-adds the missing bracket
    expect(ev('=SUM(D2:D5,)').ok).toBe(false); // Excel treats the empty argument as 0
    expect(val('=SUM(D:D)')).toBe('#NAME?'); // whole columns unsupported
    expect(val('=AA1')).toBe('#REF!'); // only columns A–Z
  });
  test('more lenient than Excel', () => {
    expect(val('=MIN(D2;F2)')).toBe(6); // ; accepted as a separator (Excel en-GB/US: comma only)
    expect(val('=MAX()')).toBe(0); // Excel: "too few arguments"
  });
  test('binary floating point is not rounded to 15 digits as Excel displays it', () => {
    expect(val('=0.1+0.2')).not.toBe(0.3); // 0.30000000000000004; the quest compares with a 1e-6 tolerance
  });
});

describe('wheel segments are built, not picked', () => {
  const wheel = loadAllQuests().get('market-ledger')!.scenes.find((s) => s.id === 'rune-wheel') as WheelScene;
  const seg = (id: string) => wheel.segments.find((g) => g.id === id)!.challenge as WheelFormula;
  test('the exchange segment only passes with a locked rate, checked down every filled row', () => {
    const c = seg('exchange');
    expect(evaluateSheet(c, '=B2*$E$2').correct).toBe(true);
    expect(evaluateSheet(c, '=B2*E2').correct).toBe(false);
    expect(evaluateSheet(c, '=B2*2').correct).toBe(false); // typed-in rate
  });
  test('the crates segment needs MAX over the range', () => {
    const c = seg('crates');
    expect(evaluateSheet(c, '=MAX(B2:B7)').correct).toBe(true);
    expect(evaluateSheet(c, '=30').correct).toBe(false);
  });
});
