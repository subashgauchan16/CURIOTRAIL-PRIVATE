"""Browser checks + screenshots for the profile prototype (Playwright, Chromium).

Usage, from the repository root:
    python3 -m http.server 8765 --bind 127.0.0.1 &
    python3 prototype/profile-analytics/tests/browser-check.py

Each check prints PASS or FAIL. Screenshots are written to
prototype/profile-analytics/screenshots/.
"""
import os
import pathlib
import sys
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[1]
SHOTS = ROOT / 'screenshots'
SHOTS.mkdir(exist_ok=True)
BASE = os.environ.get('PROTO_URL', 'http://127.0.0.1:8765/prototype/profile-analytics/index.html')
results = []


def check(name, ok, detail=''):
    results.append(ok)
    print(('PASS ' if ok else 'FAIL ') + name + (f'  [{detail}]' if detail else ''))


def kpi(page, label):
    card = page.locator('.kpi').filter(has=page.locator('.kpi-label', has_text=__import__('re').compile('^' + label + '$')))
    return card.locator('.kpi-value').inner_text().strip()


def no_page_overflow(page):
    return page.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1')


with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={'width': 1366, 'height': 900})
    page = ctx.new_page()
    errors, requests = [], []
    page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('request', lambda r: requests.append(r.url))
    page.goto(BASE)
    page.wait_for_timeout(700)

    # ---- Cookie banner -------------------------------------------------------
    check('cookie banner shows before any choice', page.locator('#cookie-banner').is_visible())
    page.screenshot(path=str(SHOTS / '04-cookie-banner.png'))
    style = lambda sel: page.eval_on_selector(sel, "e => { const s = getComputedStyle(e); const r = e.getBoundingClientRect(); return [s.backgroundColor, s.color, s.fontSize, s.fontWeight, s.borderColor, Math.round(r.width), Math.round(r.height), Math.round(r.top)]; }")
    check('accept and reject look identical and sit on one row', style('#cookie-accept') == style('#cookie-reject'), str(style('#cookie-accept')))
    stored = page.evaluate("localStorage.getItem('curio-proto-consent')")
    check('nothing optional is stored before a choice', stored is None)

    page.click('#cookie-reject')
    check('reject hides the banner', not page.locator('#cookie-banner').is_visible())
    states = page.locator('#consent-state-storage').inner_text()
    check('reject: preferences, analytics and marketing shown Off', states.count('Off') == 3, states.replace('\n', ' | '))

    # ---- Default view ----------------------------------------------------------
    check('default KPIs: 24 attempts, 10 retries, 88%, +30 pts',
          [kpi(page, 'Total attempts'), kpi(page, 'Retries'), kpi(page, 'Retry-to-success'), kpi(page, 'Mastery change')] == ['24', '10', '88%', '+30 pts'],
          str([kpi(page, 'Total attempts'), kpi(page, 'Retries'), kpi(page, 'Retry-to-success'), kpi(page, 'Mastery change')]))
    check('chart A has 15 challenge columns', page.locator('.bc-hit').count() == 15)
    bar_sum = page.evaluate("[...document.querySelectorAll('.bc-total')].reduce((s, e) => s + Number(e.textContent), 0)")
    check('chart A column totals add up to the attempts KPI', bar_sum == 24, str(bar_sum))
    check('chart B shows 6 mastery points', page.locator('.lc-point').count() == 6)
    check('chart C recovery rate is 64%', page.locator('.rc-rate').inner_text().startswith('64'))
    check('page does not overflow at 1366px', no_page_overflow(page))
    chart_fits = page.evaluate("(() => { const s = document.querySelector('.bc-scroll'); return s.scrollWidth <= s.clientWidth + 1; })()")
    check('chart A fits without scrolling at 1366px', chart_fits)
    page.screenshot(path=str(SHOTS / '01-profile-full.png'), full_page=True)

    # ---- Tooltip, keyboard, detail panel --------------------------------------------
    first = page.locator('.bc-hit').first
    first.focus()
    check('focus on a bar shows the tooltip', page.locator('#tooltip').is_visible())
    page.keyboard.press('ArrowRight')
    page.keyboard.press('ArrowRight')
    focused = page.evaluate("document.activeElement.dataset.key")
    check('arrow keys move between bars', focused == 'the-ledger/group-products', focused)
    tip = page.locator('#tooltip').inner_text()
    check('tooltip shows exact counts for the focused challenge', 'Add it up' in tip and 'Retries\n2' in tip.replace('\t', '\n'), tip.replace('\n', ' | '))
    check('only one bar is in the tab order', page.locator('.bc-hit[tabindex="0"]').count() == 1)
    page.keyboard.press('Enter')
    page.wait_for_timeout(350)
    check('Enter opens the challenge breakdown', page.locator('#detail').is_visible() and 'Add it up' in page.locator('#detail-title').inner_text())
    detail = page.locator('#detail').inner_text()
    check('breakdown separates initial attempt, retries and hints', 'Initial attempt\n1' in detail and 'Retries\n2' in detail and 'Hints used\n1' in detail)
    # Screenshot: tall viewport, chart card at the top, tooltip from hover, breakdown open.
    page.set_viewport_size({'width': 1366, 'height': 1500})
    page.evaluate("window.scrollTo(0, document.querySelector('.analytics .chart-card').getBoundingClientRect().top + window.scrollY - 90)")
    page.locator('.bc-hit[data-key="the-ledger/group-products"]').hover()
    page.wait_for_timeout(250)
    top = page.locator('.analytics .chart-card').first.bounding_box()
    bottom = page.locator('#detail').bounding_box()
    page.screenshot(path=str(SHOTS / '02-attempts-tooltip-and-breakdown.png'),
                    clip={'x': 0, 'y': max(0, top['y'] - 70), 'width': 1366, 'height': min(1500, bottom['y'] + bottom['height'] - top['y'] + 90)})
    page.set_viewport_size({'width': 1366, 'height': 900})
    page.locator('.bc-hit[data-key="the-ledger/group-products"]').focus()
    page.click('#detail-close')
    check('closing the breakdown returns focus to its bar', page.evaluate("document.activeElement.dataset.key") == 'the-ledger/group-products')

    # ---- Filters -----------------------------------------------------------------
    page.click('label.seg-option:has-text("Last 7 days")')
    page.wait_for_timeout(200)
    check('7 days: attempts 6, retries 2, revisits 2, mastery change —',
          [kpi(page, 'Total attempts'), kpi(page, 'Retries'), kpi(page, 'Concepts revisited'), kpi(page, 'Mastery change')] == ['6', '2', '2', '—'])
    check('7 days: chart A shows 5 challenges', page.locator('.bc-hit').count() == 5)
    check('7 days: chart B shows 2 points', page.locator('.lc-point').count() == 2)
    check('7 days: chart C denominator is 3', '3 incorrect attempts' in page.locator('#chart-c').inner_text())
    check('7 days: journey starts on 27 Oct', page.locator('.journey-date').first.inner_text() == '27 Oct')
    check('filter change is announced', 'Last 7 days' in page.locator('#filter-status').inner_text())

    page.click('label.seg-option:has-text("All time")')
    page.select_option('#quest-filter', 'broken-tally')
    page.wait_for_timeout(200)
    check('All time + The Broken Tally: 9 attempts, 5 challenges, 1 mastery line',
          kpi(page, 'Total attempts') == '9' and page.locator('.bc-hit').count() == 5 and page.locator('.lc-point').count() == 2)
    check('quest filter keeps insights to that quest', 'The Broken Tally' in page.locator('#insights').inner_text() and 'Ledger in the Woods' not in page.locator('#insights').inner_text())

    page.select_option('#quest-filter', 'star-chart')
    page.wait_for_timeout(200)
    check('locked quest shows empty states, not broken charts', page.locator('.analytics .empty-state').count() == 3 and kpi(page, 'Total attempts') == '0')

    page.click('#reset-filters')
    page.wait_for_timeout(200)
    check('reset restores the default view', kpi(page, 'Total attempts') == '24' and page.locator('#quest-filter').input_value() == 'all'
          and page.locator('input[name="period"][value="28d"]').is_checked())

    # ---- Chart C rows, journey button ----------------------------------------------------
    page.locator('.rc-row', has_text='Used a hint').click()
    who = page.locator('#rc-who-hint-solved')
    check('recovery row reveals which challenges', who.is_visible() and 'Only the North' in who.inner_text(), who.inner_text())
    page.locator('#journey [data-select]').first.click()
    page.wait_for_timeout(300)
    check('journey challenge link opens its breakdown', page.locator('#detail').is_visible())
    page.click('#journey-more')
    check('"Show earlier days" adds days', page.locator('.journey-day').count() > 3)

    # ---- Privacy dialog & Preferences effect ----------------------------------------------
    page.locator('.privacy [data-open-privacy]').click()
    page.wait_for_timeout(200)
    check('privacy dialog opens as a modal', page.evaluate("document.getElementById('privacy-dialog').open"))
    checked = page.evaluate("['preferences','analytics','marketing','learningImprovement'].map(k => document.forms['privacy-form'].elements[k].checked)")
    check('dialog reflects the stored choices (all off after reject)', checked == [False, False, False, False], str(checked))
    page.screenshot(path=str(SHOTS / '03-privacy-settings.png'))
    page.check('input[name="preferences"]', force=True)
    page.check('input[name="learningImprovement"]', force=True)
    page.click('#dialog-save')
    page.wait_for_timeout(200)
    st = page.locator('.privacy').inner_text()
    check('saved choices update the displayed state', 'Preferences\n✓ On' in st and 'Help improve my learning experience\n✓ On' in st and 'Analytics\n○ Off' in st)
    page.click('label.seg-option:has-text("Last 14 days")')
    prefs = page.evaluate("localStorage.getItem('curio-proto-prefs')")
    check('with Preferences on, the filter is remembered', prefs is not None and '14d' in prefs, str(prefs))
    page.reload()
    page.wait_for_timeout(500)
    check('remembered filter survives a reload', page.locator('input[name="period"][value="14d"]').is_checked() and not page.locator('#cookie-banner').is_visible())
    page.locator('.privacy [data-open-privacy]').click()
    page.uncheck('input[name="preferences"]', force=True)
    page.click('#dialog-save')
    check('withdrawing Preferences deletes the remembered filter', page.evaluate("localStorage.getItem('curio-proto-prefs')") is None)
    page.click('#reset-consent')
    check('reset prototype choices brings the banner back and clears storage',
          page.locator('#cookie-banner').is_visible() and page.evaluate("localStorage.getItem('curio-proto-consent')") is None)
    page.click('#cookie-accept')
    st = page.locator('#consent-state-storage').inner_text()
    check('accept turns on all optional cookie categories', st.count('On') == 3, st.replace('\n', ' | '))
    check('accepting cookies does not switch on learning-improvement analytics', 'Help improve my learning experience\n○ Off' in page.locator('#consent-state-learning').inner_text())

    # ---- Scenarios: zero retries and empty -------------------------------------------------
    page.click('.proto-controls summary')
    page.select_option('#scenario', 'no-retries')
    page.wait_for_timeout(200)
    check('zero-retry learner: retries 0, retry-to-success —, recovery empty state',
          kpi(page, 'Retries') == '0' and kpi(page, 'Retry-to-success') == '—' and 'No incorrect answers' in page.locator('#chart-c').inner_text())
    check('zero-retry learner: no retry or hint insights', 'after a retry' not in page.locator('#insights').inner_text() and 'Hints helped' not in page.locator('#insights').inner_text())
    page.select_option('#scenario', 'empty')
    page.wait_for_timeout(200)
    check('new learner: empty states everywhere, quests show real unlock states',
          page.locator('.empty-state').count() >= 5 and 'Available' in page.locator('#trail').inner_text() and 'Locked' in page.locator('#trail').inner_text())
    page.select_option('#scenario', 'default')

    # ---- Event log ---------------------------------------------------------------------
    page.click('#open-log')
    rows = page.locator('#log-table tbody tr').count()
    check('event log lists every record', rows == page.evaluate("CURIO_PROTO.scenarios.default.events.length"), str(rows))
    page.click('#log-close')

    check('no console errors', not errors, '; '.join(errors))
    external = [u for u in requests if not u.startswith('http://127.0.0.1:8765/')]
    check('no external network requests', not external, ', '.join(external))
    check('every request is a local file the page needs', len(set(requests)) <= 11, str(len(set(requests))))

    # ---- Viewports ---------------------------------------------------------------------------
    for w, h, name in [(390, 844, 'mobile'), (768, 1024, 'tablet'), (1366, 900, 'desktop')]:
        page.set_viewport_size({'width': w, 'height': h})
        page.wait_for_timeout(250)
        check(f'{name} ({w}px): no horizontal page overflow', no_page_overflow(page))
    page.set_viewport_size({'width': 390, 'height': 844})
    page.screenshot(path=str(SHOTS / '05-mobile-full.png'), full_page=True)
    page.set_viewport_size({'width': 1366, 'height': 900})

    # ---- Reduced motion -------------------------------------------------------------------
    rm = browser.new_context(viewport={'width': 1366, 'height': 900}, reduced_motion='reduce')
    rp = rm.new_page()
    rp.goto(BASE)
    dur = rp.eval_on_selector('.bc-stack', 'e => getComputedStyle(e).animationDuration')
    check('reduced motion removes bar animation', dur in ('1e-06s', '0.001ms', '0s') or dur.startswith('1e-'), dur)
    rm.close()

    # ---- file:// -------------------------------------------------------------------------
    fp = ctx.new_page()
    ferr = []
    fp.on('pageerror', lambda e: ferr.append(str(e)))
    fp.on('console', lambda m: ferr.append(m.text) if m.type == 'error' else None)
    fp.goto((ROOT / 'index.html').as_uri())
    fp.wait_for_timeout(500)
    check('opens directly from disk (file://) with working charts', not ferr and fp.locator('.bc-hit').count() == 15, '; '.join(ferr))
    browser.close()

print(f'\n{sum(results)} of {len(results)} checks passed')
sys.exit(0 if all(results) else 1)
