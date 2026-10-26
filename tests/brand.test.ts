import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { BRAND, BRAND_LABEL, BrandMark, CopyrightNotice } from '../src/ui/brand/BrandMark';

describe('brand mark', () => {
  const html = renderToStaticMarkup(createElement(BrandMark));

  it('shows "SG · CurioTrail" as scalable SVG plus text', () => {
    expect(BRAND_LABEL).toBe('SG · CurioTrail');
    expect(html).toContain('<svg');
    expect(html).toContain('viewBox="0 0 24 24"');
    expect(html).toContain('SG · CurioTrail');
  });

  it('is announced once, with an accessible label', () => {
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="SG · CurioTrail"');
    // The visible text duplicates the label, so it is hidden from assistive tech.
    expect(html).toMatch(/class="brand-mark-text" aria-hidden="true"/);
    expect(html.match(/role="img"/g)).toHaveLength(1);
  });

  it('is not interactive and not an overlay', () => {
    expect(html).not.toMatch(/<a |<button|tabindex/i);
    expect(html).not.toMatch(/position:\s*(fixed|absolute)/);
  });

  it('accepts a placement modifier', () => {
    expect(renderToStaticMarkup(createElement(BrandMark, { className: 'brand-mark--end' }))).toContain('class="brand-mark brand-mark--end"');
  });
});

describe('copyright notice', () => {
  const html = renderToStaticMarkup(createElement(CopyrightNotice));

  it('names the year and creator and links to third-party notices', () => {
    expect(BRAND.year).toBe(2026);
    expect(html).toContain('© 2026 SG · CurioTrail');
    expect(html).toContain('href="./THIRD-PARTY-NOTICES.txt"');
    expect(html).toContain('third-party material');
  });

  it('does not claim third-party material', () => {
    expect(html).toMatch(/except third-party material/);
  });
});
