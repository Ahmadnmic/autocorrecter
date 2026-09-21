# Security review and hardening (2026-09-21)

Scope: the web app and API on Vercel, the Electron desktop apps (macOS, Windows), the Android spell checker /
keyboard, the logging and learning pipeline, secrets and dependencies. Method: OWASP API Security Top 10 (2023),
OWASP ASVS 5.0 level 1, OWASP Top 10 for LLM apps (2025), the Electron security checklist and fuses guidance,
Android IME / spell checker guidance, Vercel's cron, Blob and WAF documentation, and the Next.js security releases
up to August 2026. Versions in use: Next.js 16.3.5 (≥ 16.3.3 required), React 19.2.8, Electron 44.4.3. `npm audit`
reports no known vulnerabilities in either package tree.

## Findings and fixes

| # | Area | Finding | Severity | Fix | Status |
|---|------|---------|----------|-----|--------|
| 1 | API | Model-calling routes were unauthenticated and unlimited: a script could run up the Jev/Anthropic bill. | High | Per-IP token-bucket limits per route (`lib/guard.ts`), a daily model budget per instance (`DAILY_MODEL_BUDGET`, default 20 000 units), and a Vercel WAF rule denying more than 600 API requests per IP per minute. | Fixed |
| 2 | API | `/api/learn` accepted anonymous calls when `CRON_SECRET` was unset (it was unset): anyone could trigger Haiku vetting runs and library writes. `/api/warm` was open. | High | `CRON_SECRET` set (sensitive env var), constant-time check, fails closed; `warm` allows anonymous calls only under a tight limit because the page uses it. | Fixed |
| 3 | Storage | Event logs (scrubbed text windows), learn state and feedback (may contain a contact address) were written to the public Blob store: unguessable URLs, but readable by anyone who has one. | High | A second, private Blob store (`inline-autocorrect-private`, fra1, token `BLOB_PRIVATE_READ_WRITE_TOKEN`). Logs, learn state and feedback are private; anonymous reads return 403. Public store keeps only downloads and the corrections library. | Fixed |
| 4 | API | `/api/feedback` GET listed every submission, including contact details, without authentication. | High | Requires `Authorization: Bearer $ADMIN_SECRET`. | Fixed |
| 5 | API | `/api/health?force=1` returned a key hint (first characters, length, character classes of the Jev key) and ran live probes against every endpoint. | Medium | Hint and probe helpers deleted; live probes need the admin secret; rate limited. | Fixed |
| 6 | API | Bodies were cast, not validated: non-string fields crashed handlers (500), numbers were unbounded, no size cap, any content type accepted. | Medium | 64 KB cap, JSON only (415 otherwise), every field coerced to a bounded typed value, arrays capped, ids sanitised. | Fixed |
| 7 | API | Upstream error messages (`detail`) were echoed to clients. | Low | Removed; clients get a `why` code only. | Fixed |
| 8 | LLM | Model output was inserted into user text without shape checks. | Medium | Alternatives and replacements must be short plain text (no line breaks, no `<>`), 1–3 words for resolutions; offsets must match the original word. User text is passed to the model as data under a fixed system prompt with a JSON schema on the output. | Fixed |
| 9 | Web | No security headers, no CSP. | Medium | Per-request nonce CSP (`proxy.ts`, `strict-dynamic`, `frame-ancestors 'none'`, `object-src 'none'`), HSTS with preload, nosniff, `X-Frame-Options: DENY`, referrer and permissions policies, COOP/CORP, no `X-Powered-By`. API responses are `no-store`. | Fixed |
| 10 | Logging | Scrubbing missed URLs, phone-like numbers and long tokens; logs were kept forever. | Medium | Scrubber covers e-mails, URLs, API-key shapes, card and phone-like numbers, tokens ≥ 24 chars (server) plus the client-side scrub; 14-day retention enforced by the learn cron. Session ids are random 8-character strings; IPs are never logged. | Fixed |
| 11 | Desktop | Self-update trusted whatever `/api/desktop-version` returned: no signature, no checksum, any host. | High | Ed25519-signed manifest (public key compiled into the app, private key only on the release machine outside the repo), SHA-256 and size for every archive, pinned hosts, redirects refused, streaming hash check, size cap. Unsigned or tampered manifests are refused (`desktop/test-updater.js`). | Fixed |
| 12 | Desktop | Update from a downloaded copy failed silently and relaunched the old version (macOS App Translocation runs the app from a read-only path; the same happens on Windows for a zip opened in place). | High (functional) | Detects temporary locations, installs the new version into Applications (or `%LOCALAPPDATA%\Programs`) and offers to move the app there on first run. Failure paths notify the user instead of relaunching silently. | Fixed |
| 13 | Desktop | Electron binary usable as a generic Node runtime (`ELECTRON_RUN_AS_NODE`, `NODE_OPTIONS`, `--inspect`) while holding Input Monitoring and Accessibility grants: a local process could use it as a signed keylogger launcher. | High | Fuses flipped at package time: run-as-node off, NODE_OPTIONS off, inspect off, app only from asar, asar integrity validation (macOS), no extra file:// privileges. Verified after packaging. | Fixed |
| 14 | Desktop | Renderer pages: inline scripts, no CSP, typed text rendered with `innerHTML` unescaped (a typed `<img onerror>` would run in the settings window), IPC accepted any sender and any settings key. | Medium | Scripts moved to files, strict CSP meta, HTML escaping, `sandbox: true`, navigation / new-window / webview / permission requests blocked, IPC accepted only from the app's own top-level pages, settings keys and values validated. | Fixed |
| 15 | Desktop | Windows delivers password-field keystrokes to low-level hooks. | Medium | Before the first word of a field is read, the app asks UI Automation whether the focused control is a password field and, if so, clears the buffer and ignores the field. macOS already blocks event taps during Secure Input (browser password fields, login windows). Fields that look like a credential (single token with digits/symbols, anything with `@`) are never sent. | Fixed |
| 16 | Desktop | Typed text reached PowerShell over a newline-delimited pipe; a line break in a correction would have split the command. | Low | Control characters are stripped before typing; corrections are capped server-side to short plain text. | Fixed |
| 17 | Android | Only password/number/e-mail/URL fields were skipped. | Medium | Also phone, person name, postal address, `TYPE_TEXT_FLAG_NO_SUGGESTIONS` and `IME_FLAG_NO_PERSONALIZED_LEARNING` (incognito) fields. The spell checker skips token-like sentences and anything with an address or URL. The system itself never sends password, e-mail or URL fields to a spell checker. | Fixed |
| 18 | Android | No network security config, no data-extraction rules, no R8, API base editable to any URL. | Low | Cleartext disabled, system CAs only; cloud backup and device transfer exclude everything; R8 minify and resource shrinking; API base must be HTTPS. Services remain exported only with `BIND_INPUT_METHOD` / `BIND_TEXT_SERVICE`. | Fixed |
| 19 | Secrets | `JEV` and `CLAUDE` are sensitive env vars; Blob tokens are plain config vars; no `NEXT_PUBLIC_` secrets; `.env*` ignored by git. Keys were pasted into the chat during development. | Low | New secrets created as sensitive. Recommendation: rotate the Jev and Anthropic keys once at your convenience, since they passed through chat. | Advice |

## Residual risks and recommendations

- **Code signing.** The desktop apps are ad-hoc signed. Gatekeeper and SmartScreen warn on first launch, and macOS
  re-prompts for Accessibility / Input Monitoring after each update because ad-hoc identities are per build. A
  Developer ID certificate with notarisation (macOS) and an Authenticode certificate (Windows) removes both; the
  build script has the hooks to add them.
- **Rate limits are per instance.** The in-code limiter lives in each function instance; the WAF rule is the
  global brake. For exact global quotas add Upstash Redis (`@upstash/ratelimit`).
- **Native clients cannot be authenticated.** A token shipped in an app can be extracted, so the API stays
  anonymous and abuse control is by rate and budget. If cost ever becomes a problem, add short-lived tokens minted
  by the server after a device check.
- **Logs still contain text windows** (scrubbed, private, 14 days). That is what the learning loop needs. If
  you want zero retention of text, set the retention to 0 in `app/api/learn/route.ts` and the learner falls back to
  counting corrections only.
- **Provider retention.** Text sent to Anthropic and TypeSafe is subject to their retention policies; check that
  they match what the website promises.
- **Dependencies.** Next.js publishes monthly security releases; keep `next` ≥ 16.3.3 and `react-dom` ≥ 19.2.6,
  run `npm audit` before each deploy. GitHub Actions in the workflow are pinned to major tags; pin to commit SHAs
  for a stricter supply chain.

## Operations

- Secrets on Vercel: `JEV`, `CLAUDE` (model keys), `BLOB_READ_WRITE_TOKEN` (public store), `BLOB_PRIVATE_READ_WRITE_TOKEN`
  (private store), `CRON_SECRET` (cron), `ADMIN_SECRET` (feedback inbox, live health probes), optional `DAILY_MODEL_BUDGET`.
- Read the feedback inbox: `curl -H "Authorization: Bearer $ADMIN_SECRET" "https://inline-autocorrect.vercel.app/api/feedback?format=md"`.
- Release the desktop apps: `cd desktop && BLOB_READ_WRITE_TOKEN=… npm run release -- --notes "…"` (needs the
  Ed25519 key at `~/.config/inline-autocorrect/release-key.pem`; losing it means shipping a new public key in a manual
  download), then deploy the web app so `/api/desktop-version` serves the new signed manifest.
- Android: signing key and password are GitHub Actions secrets; every push to `android/` builds a signed release.
