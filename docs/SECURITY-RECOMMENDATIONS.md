# Protecting the source and the account: recommendations

> Recommendations only. Nothing here has been changed: repository visibility, settings and deployment are left exactly as they were until the owner decides.

## Audit results (October 2026)

| Check | Result |
|---|---|
| Secrets in the working tree | **None found.** Searched for AWS, GitHub, OpenAI-style, Slack and Google keys, private-key blocks, and `key`/`secret`/`token`/`password` assignments. |
| Secrets in git history | **None found** across all 4 commits on all branches. |
| Sensitive files ever committed | None (`.env`, `.pem`, `.key`, `id_rsa`, credentials files). |
| Rotation needed | No. |
| `.gitignore` | Covers `node_modules/`, `dist/`, `.scratch/`, OS files and logs. `.env` and `.env.*` were added as a safeguard in case keys are ever introduced. No tracked files are affected or removed. |
| Source maps in the build | None. `dist/` ships minified JavaScript only. |
| Deployment workflow | Builds from source on GitHub Actions and publishes `dist/` to Pages. Uses `GITHUB_TOKEN` only; no stored secrets. |

## Browser code can't be kept secret

Everything the game needs (JavaScript, quest JSON, lesson text, 3D models) is downloaded to every player's browser and can be read with the browser's developer tools. Minification makes it harder to read; the SG · CurioTrail mark and copyright notice show where it came from. **Neither prevents copying.** They are deterrents and evidence. CurioTrail deliberately does not add tracking, fingerprinting, DRM or anti-inspection code, which would harm learners and accessibility without stopping a determined copier.

What actually protects the work is:

1. the licence terms (once reviewed),
2. keeping the *source repository* (history, tools, tests, unminified code) private, and
3. the brand and the official hosted game.

## Can the game be published without a public source repository?

Yes. The game is a static site; only the built `dist/` folder needs to be public.

**GitHub Pages on a private repository requires a paid plan.** GitHub's documentation states that Pages is available "in public repositories with GitHub Free and GitHub Free for organizations, and in public and private repositories with GitHub Pro, GitHub Team, GitHub Enterprise Cloud, and GitHub Enterprise Server" ([GitHub Pages limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits), [publishing source](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)). A Pages site built from a private repository is still publicly viewable; only the source is hidden. If the paid plan lapses, the site stops being served from the private repository.

Options, from least to most change:

| Option | Cost | Effect |
|---|---|---|
| A. Keep CURIO public (as now) | Free | Source and history stay readable; only the licence protects them. |
| B. Make CURIO private and upgrade to GitHub Pro | Paid | Same URL (`denilthaks.github.io/CURIO/`), source hidden. |
| C. Make CURIO private; publish only `dist/` to a separate public repository (for example `denilthaks/curiotrail-site`) with Pages | Free | Source hidden; the public repo holds only minified build output and notices. The game URL changes unless a custom domain is used. Needs a deploy token with write access to that one repository only. |
| D. Make CURIO private; host the build on another static host (Cloudflare Pages, Netlify, Vercel) | Free tiers available | Source hidden; new URL unless a custom domain is used; check the host's terms. |

**Before any of these:** the current MIT-licensed commits are already public and may have been copied; making the repository private does not withdraw those rights (see [IP-OWNERSHIP.md](IP-OWNERSHIP.md)). Changing visibility also resets stars and watchers, and may break links.

## Account and repository settings to turn on

- **Two-factor authentication** on the `denilthaks` account, preferably with a passkey or security key, and saved recovery codes.
- **Least-privilege access:** no other collaborators unless needed; give contributors *Triage* or *Write*, never *Admin*. Review **Settings → Applications** and remove unused OAuth apps and GitHub Apps, keeping only those in use.
- **Branch protection / rulesets on `main`:** require pull requests and passing `test.yml` checks; block force-pushes and deletion.
- **Dependabot alerts and security updates**, plus `npm audit` before releases.
- **Secret scanning and push protection** (available free for public repositories; on private repositories it is a paid add-on, GitHub Secret Protection).
- **Private vulnerability reporting**, so [SECURITY.md](../SECURITY.md) works.
- **Actions:** keep the default `GITHUB_TOKEN` read-only (the Pages workflow requests only `contents: read`, `pages: write` and `id-token: write`). The workflows use only GitHub's own `actions/*` actions; pin any third-party action added later to a commit SHA.
