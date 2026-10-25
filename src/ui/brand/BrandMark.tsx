// The "SG · CurioTrail" creator mark. It sits in normal document flow inside
// a panel (never an overlay), so it can't cover controls, text or credits.
// It marks CurioTrail's own interface only, not third-party assets.

export const BRAND = {
  name: 'CurioTrail',
  creator: 'SG',
  year: 2026,
} as const;

export const BRAND_LABEL = `${BRAND.creator} · ${BRAND.name}`;

export function BrandMark({ className = '' }: { className?: string }) {
  return (
    <p className={`brand-mark ${className}`.trim()}>
      <svg className="brand-mark-badge" viewBox="0 0 24 24" width="20" height="20" role="img" aria-label={BRAND_LABEL} focusable="false">
        <circle cx="12" cy="12" r="11" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <text x="12" y="16" textAnchor="middle" fontSize="10" fontWeight="700" fill="currentColor" fontFamily="system-ui, sans-serif">{BRAND.creator}</text>
      </svg>
      <span className="brand-mark-text" aria-hidden="true">{BRAND.creator} · {BRAND.name}</span>
    </p>
  );
}

export function CopyrightNotice({ className = '' }: { className?: string }) {
  return (
    <p className={`copyright-notice ${className}`.trim()}>
      © {BRAND.year} {BRAND.creator} · {BRAND.name}. All rights reserved, except third-party material,
      which keeps its own licence (<a href="./THIRD-PARTY-NOTICES.txt" target="_blank" rel="noopener">third-party notices<span className="sr-only"> (opens in a new tab)</span></a>).
    </p>
  );
}
