# Personal Cloudflare deployment

Deployed on 2026-10-09 from upstream commit `ec7a2bb`.
The local mail-claim feature was deployed on the same date as Worker version
`f2791f3c-659b-4a44-a1c3-9fdbdbc5049f`.
The personalization card update was subsequently deployed as Worker version
`5a65bbe3-b860-4514-851e-b3cccadcc8f6`.
The private R2 transition was deployed on 2026-10-12 as Worker version
`b76503cc-40d2-4d8d-abc6-32ca2adf892f`.
The structured Telegram notifications were deployed on 2026-10-14 as Worker
version `3f6734c3-b1ee-4c6a-889e-b5d3f0b8acf3`.
The forwarded-email preview cleanup was deployed on 2026-10-14 as Worker
version `bc2b88d0-f901-4a61-9e1e-3ddd5cdf18c4`.
The mail intercept report was deployed on 2026-10-15 as Worker version
`15d59873-ab4c-4272-8419-63662c63adc8`.
The mail privacy isolation was deployed on 2026-10-16 as Worker version
`6dfa4561-4dd7-4fe0-91b5-6dae465e6a03`.
The upstream 3.4.0 merge was deployed on 2026-10-30 as Worker version
`311e623a-c6ed-4783-9d13-1abc30b552b3`.
The two-way Telegram bot was deployed on 2026-10-30 as Worker version
`82669878-aecf-414d-a412-2763ab4f5e6c`.
Sendflare sending and the provider selector were deployed on 2026-10-30 as
Worker version `3b6850b5-755c-400e-9e9d-70c4a4ab232a`.

## Endpoints

- Website: https://mail.florin-studio.com
- Worker: `cloud-mail`
- Mail domain: `florin-studio.com`
- Administrator: `admin@florin-studio.com`
- Personal bindings: `mail-worker/wrangler.personal.toml`

## Current behavior

- Public registration is disabled. Resend sending is configured and domain
  authentication was verified on 2026-10-09.
- Catch-all routes incoming mail to the `cloud-mail` Email Worker.
- Existing addresses receive mail in their own inbox.
- Unknown addresses are saved as unclaimed mail in the administrator's
  mail-management screen. They are NOT assigned to the administrator's inbox.
- Administrators can open an unclaimed incoming message in All Mail and use
  "认领到邮箱" to assign it to an existing mailbox matching its original SMTP
  envelope recipient (case-insensitive). Create the matching mailbox first
  if none is available, then refresh the dialog.
- Claiming updates the message and all attachment ownership in one transaction.
  The message leaves the unclaimed view and appears in its owner's inbox.
  Deleted messages, inactive owners, and already assigned messages cannot be
  claimed. Creating a mailbox alone does not claim its historical messages.
- Plus aliases, such as `admin+github@florin-studio.com`, resolve to an existing
  base account when no exact account exists.
- Mail bodies remain in D1. New attachments and uploaded backgrounds use the
  private R2 Standard bucket `cloud-mail-files` through the `r2` Worker binding.
- R2 public development access is disabled and no bucket custom domain is
  connected. The application object-storage domain may stay empty or point to
  the authenticated Worker website origin; never set a public bucket domain.
- Reads fall back to KV when an object is absent from R2. KV continues to hold
  settings, login sessions, and counters/caches; never delete the namespace.
- Attachment API and legacy file routes require an active session and an
  attachment record owned by the caller (or administrator/all-mail access).
  Only the currently configured login background is served without a session.
- Forwarding, AI extraction, and automatic deletion remain disabled.
- Resend uses a dedicated sending-only key restricted to `florin-studio.com`.
  The key is stored in application settings, never in this repository.
- The four records in `resend-dns.zone` have been added to Cloudflare DNS.
  The CNAME uses DNS-only mode; existing inbound root MX records are retained.
  Public DNS lookups match the requested records. Resend reports the domain
  and all four records as verified.
- The outgoing mail switch is enabled; the D1 and KV sending credentials match.
  Outgoing delivery to Gmail was confirmed on 2026-10-30.
- Storage and request quotas still apply; this is not unlimited storage.
- The personalization card includes a login appearance preview, a labeled
  opacity slider, and text actions for editing the title, changing the background,
  and restoring the default sky background. Existing settings remain in use.

## Credentials

Login details are stored outside this public repository in
`/Users/cassyx/.config/cloud-mail/login.txt` (owner-only permissions).
The signing secret is stored in Cloudflare Worker Secrets. Never commit
`.dev.vars`, credentials, database exports, or authentication-session files.
The administrator changed the initial password after signing in; the original
bootstrap password is obsolete.

## Redeploy

```sh
cd /Users/cassyx/OpenSourceProject/cloud-mail/mail-vue
pnpm install --frozen-lockfile
pnpm run build

cd /Users/cassyx/OpenSourceProject/cloud-mail/mail-worker
pnpm install --frozen-lockfile
pnpm run test:claim
pnpm run test:storage
pnpm run test:telegram
pnpm run test:sendflare
pnpm exec wrangler deploy --config wrangler.personal.toml
```

Use the personal configuration, not the default `pnpm deploy` script.
The bootstrap database is already initialized; do not replay initialization
exports or migrations as a routine deployment step.

## Private R2 transition on 2026-10-12

The owner enabled the R2 subscription in the Cloudflare dashboard. The bucket
was created in Standard storage and checked with:

```sh
pnpm exec wrangler r2 bucket dev-url get cloud-mail-files --config wrangler.personal.toml
pnpm exec wrangler r2 bucket domain list cloud-mail-files --config wrangler.personal.toml
```

The development URL is disabled; the custom-domain list is empty. No public
bucket URL or new S3 access key is needed for the Worker binding.

The pre-transition inventory contained 0 attachment records and the default
login background. KV held only the `setting:` and `auth-uid:1`
keys. Consequently there were no historical file objects to copy or delete;
configuration and authentication data must remain in KV.

The compatibility layer supports both R2 objects and legacy KV files and
preserves MIME type/disposition. Private file responses use `private, no-store`.
Deleting a file also deletes its legacy file copy, so fallback cannot revive a
removed file. This operation never targets settings or cache prefixes.

Validation includes the storage/authorization regression suite, a frontend
production build, and a local browser fixture for inline images, previews and
byte-for-byte downloads. A remote R2 binding was also exercised through the
actual Worker handlers using local test identities, KV and SQLite: both
authenticated attachment paths returned the real R2 bytes and metadata; a
missing R2 object fell back to the test KV file. That validation wrote no
production D1/KV data, sent no email, and removed its temporary R2 object.
After the production deployment, the website returned HTTP 200, both anonymous
attachment routes returned HTTP 401, and a non-current background returned
HTTP 404. The existing website object-storage origin and KV settings/session
keys were retained.

For future transitions with existing files, inventory only `attachments/`
and `static/background/` objects, preserve object keys and HTTP metadata, and
compare bytes before removing any KV file copy. Keep fallback enabled during
the transition and never treat a settings/authentication key as a file.

## Structured Telegram notifications (2026-10-14)

New incoming mail uses Telegram `sendRichMessage` with native heading,
paragraph, divider, quotation, and footer blocks. The existing sender,
recipient, and body visibility settings still apply. Body previews contain
up to 500 visible characters; previews over 250 characters use an expandable
quotation. The original email remains available through the signed View
button, and valid verification codes retain a native clipboard button.

Preview links display a compact hostname while retaining their original
destination. Leading ASCII banners and a repeated subject are removed.
Non-breaking spaces remain word separators and emoji joiners are preserved.
Sender-supplied markup is treated as text rather than Telegram formatting.

The 17 notification tests passed with mocked Telegram requests. The 10
mail-claim and 10 private-storage regressions and Wrangler release dry run
also passed. After deployment, the latest deployment assigned 100% of traffic
to `3f6734c3-b1ee-4c6a-889e-b5d3f0b8acf3`, the website returned HTTP 200, and
an invalid signed View token returned the expected Access denied page.
Subsequent external delivery tests confirmed real Telegram notifications.
The owner verified the DeepL preview and original HTML detail view in Telegram.
Existing Telegram messages are not rewritten by this deployment.

## Forwarded-email preview cleanup (2026-10-14)

Telegram previews remove leading `>` quote markers, including nested `>>`
and `> >` prefixes. Quote-only lines become paragraph gaps, with consecutive
blank lines reduced to one gap. Inline greater-than signs, forwarded metadata,
link destinations, and original stored mail bodies are retained. Plain-text
and HTML-only messages use the same cleanup; Telegram supplies the quotation
styling. Internal deliveries continue without Telegram notifications.

All 21 notification tests passed, including forwarded metadata, nested quotes,
HTML-only quotes, inline signs, and preservation of the original body. The 10
mail-claim tests, 10 storage tests, and Wrangler dry run also passed.
Deployment `998150e5-d9c9-463c-a226-2de8958e1b43` assigns 100% of traffic to
`bc2b88d0-f901-4a61-9e1e-3ddd5cdf18c4`. The website returned HTTP 200 and
an invalid signed View token returned the expected Access denied page.
This cleanup applies to future notifications; existing Telegram messages
are not rewritten. No real email or Telegram message was sent by the agent for
this release. The owner subsequently forwarded an external email and confirmed
the cleaned preview with a Telegram screenshot.

## Mail intercept report (2026-10-15)

Opening an HTML message lists what that message had removed: scripts and
active content, tracking pixels, remote stylesheets, imported styles, web
fonts, remote images, and rewritten tracking links. Choosing to show pictures
loads ordinary remote images and keeps the list from the moment the message
was opened. The Telegram full-email page shows the same list. Plain-text
messages have no list.

The anti-track suite passed 12 tests. The 10 mail-claim tests, 10 storage
tests, and 21 Telegram notification tests also passed. The frontend production
build passed. Deployment `15d59873-ab4c-4272-8419-63662c63adc8` serves
https://mail.florin-studio.com. The website returned HTTP 200 and referenced
`/assets/index-WEQaCGgp.js`, which contains the intercept report. An anonymous
attachment request returned HTTP 401. No database migration was applied.

## Mail privacy isolation (2026-10-16)

HTML mail is shown in a sandboxed frame that cannot run scripts, so message
markup cannot read the login token. Showing ordinary remote pictures fetches
them through the authenticated server. The reader's network address is not
sent to the sender, though the sender may still learn that a picture was
fetched. Tracking pixels, remote styles, web fonts, opaque tracker links, and
executable markup stay removed. Known tracker links whose destination is not
visible cannot be clicked. HTML, SVG, and XML attachments are sanitized on
download; stored objects are unchanged. The Telegram full-email page uses the
same sandbox and does not load remote images. In-app replies continue to use
the stored sender address.

The anti-track and privacy suites passed 15 tests. The 10 mail-claim tests,
10 storage tests, and 21 Telegram notification tests also passed. The frontend
production build passed. Deployment `6dfa4561-4dd7-4fe0-91b5-6dae465e6a03`
serves https://mail.florin-studio.com. The website returned HTTP 200 and,
after cache revalidation, referenced `/assets/index-DtD_tdOG.js`, which
contains the disabled-tracker label. An anonymous attachment request and an
anonymous remote-image request both returned HTTP 401. No database migration
was applied.

## Upstream 3.4.0 merge (2026-10-30)

Merged maillab/cloud-mail up to `d115f4c` (3.4.0 and later fixes): advanced
search with keyword highlighting, on-behalf-of sender display, per-recipient
sending, internal forwarding to external mailboxes, invitation-code fixes and
UI updates. Private R2 access, the sandboxed reader and anti-track handling
were kept; upstream's anonymous root `/oss/` route was not adopted, and the
store-level DOMPurify pass was dropped so the intercept report stays complete.
`wrangler.personal.toml` gained the `forward` send-email binding.

Before deploying, the production D1 `email` table received one new column:
`ALTER TABLE email ADD COLUMN sender_email TEXT NOT NULL DEFAULT ''`. No other
migration or initialization was replayed.

The anti-track (13), privacy (2), mail-claim (10), storage (10) and Telegram
(21) tests passed, and the frontend production build passed. Deployment
`311e623a-c6ed-4783-9d13-1abc30b552b3` serves https://mail.florin-studio.com.
The website returned HTTP 200 and referenced `/assets/index-B2E0VsGK.js`.
Anonymous requests to `/api/oss/`, `/attachments/` and `/api/remote-image`
returned HTTP 401; root `/oss/` paths fall through to the single-page app
HTML and do not serve stored objects. No real email was sent by the agent.

## Two-way Telegram bot (2026-10-30)

The bot now accepts updates at `/api/telegram/webhook`. Requests must carry a
`secret_token` derived from `jwt_secret`, and only chats listed in the Telegram
chat-ID setting are answered. Saving the Telegram settings registers the
webhook and command menu; turning the bot off removes the webhook. The webhook
is not active until the settings are saved once after this deployment.

- `/new [prefix|address]` creates a mailbox owned by the administrator,
  without the human-verification check or mailbox limit.
- `/latest [n]` re-sends the latest 1-10 received messages; `/code` returns the
  latest verification code.
- Notifications gain Mark-read and Delete buttons.
- Replying to a notification sends a plain-text reply from the original
  recipient address to the original sender. The message is identified by the
  signed View link of the bot's own message, so no KV mapping is stored.
- Notifications show the on-behalf-of marker when the envelope sender differs
  from the From address, matching the web detail page. The address is shown
  only when the sender display setting is "show".

The mail-claim (10), storage (10) and Telegram (24) tests passed, and the
frontend production build passed. Deployment
`82669878-aecf-414d-a412-2763ab4f5e6c` serves https://mail.florin-studio.com.
The website returned HTTP 200. Webhook requests without the secret, or with a
wrong secret, returned HTTP 403. An invalid signed View token returned the
Access denied page, and an anonymous attachment request returned HTTP 401.
No database migration was applied. No email or Telegram message was sent by
the agent, and the webhook was not registered by the agent.

The owner then saved the Telegram settings, which registered the webhook.
`/help` answered in the configured private chat. The owner replied in Telegram
to a notification for an external message sent from Gmail; the bot confirmed
the reply to the original sender. Gmail received the reply from
`admin@florin-studio.com` with the expected body, which also confirms actual
outgoing delivery through Resend.

## Sendflare sending and provider selector (2026-10-30)

Sendflare (https://sendflare.com) is available as an outgoing provider next to
Resend. Mail settings gain a sending-provider selector: Auto, Cloudflare,
Resend or Sendflare. Auto keeps the previous order (Cloudflare, then Resend,
then Sendflare); this deployment has no Cloudflare `email` binding, so Auto
continues to use Resend. A chosen provider is used exclusively; if the sending
domain has no token for it, outgoing mail is refused instead of falling back.
Switching providers never removes saved Resend or Sendflare tokens.

- Sendflare tokens are stored per domain in application settings, never in
  this repository.
- A normal send with several recipients puts the first in To and the rest in
  Cc, because Sendflare's single-send API accepts one To address. Per-recipient
  sending uses the batch API in groups of 50.
- Replies pass In-Reply-To/References as custom headers; whether Sendflare
  keeps them has not been confirmed.
- Delivery status webhooks: `https://mail.florin-studio.com/api/webhooks/sendflare`
  (delivered, bounced, complaint). Setting the Worker secret
  `sendflare_webhook_secret` enables signature checks; it is not set yet.

Sendflare DNS records in the Cloudflare zone (added 2026-10-30, public
resolution confirmed): DKIM TXT `sendflare._domainkey`, MX
`mail` -> `feedback-smtp.us-west-2.amazonses.com` (priority 10), TXT `mail`
`v=spf1 include:amazonses.com ~all`, and TXT `_dmarc` `v=DMARC1; p=none;`.
The `mail` MX/TXT coexist with the website's proxied AAAA record; inbound root
MX and the Resend `send`/`resend._domainkey` records are unchanged.

Before deploying, the production D1 `setting` table received two new columns:
`sendflare_tokens TEXT NOT NULL DEFAULT '{}'` and
`send_provider TEXT NOT NULL DEFAULT ''`. No other migration or initialization
was replayed.

The mail-claim (10), storage (10), Telegram (24) and Sendflare (5) tests
passed, and the frontend production build passed. Deployment
`3b6850b5-755c-400e-9e9d-70c4a4ab232a` serves https://mail.florin-studio.com.
The website returned HTTP 200 and referenced `/assets/index-B29QUzx_.js`,
which contains the provider selector. An anonymous settings request returned
the application's 401 code, and an engagement-only webhook probe returned
HTTP 200 without changing data. No Sendflare account, token or real email was
used by the agent.

## Verification

- Frontend production build passed.
- The mail-claim regression suite passed all 10 tests, including administrator
  authorization, exact recipient matching, attachment rollback, and races.
  Run it with `pnpm run test:claim` in `mail-worker` (Node 22.13+).
- The claim feature requires no database migration.
- The personalization card was checked in a local browser with mocked settings:
  desktop and 390px mobile layouts, opacity preview and automatic saving,
  default/custom backgrounds, and dark-mode overlay all passed.
- After deployment, the live website returned HTTP 200 and referenced the current
  frontend assets. Both claim endpoints rejected unauthenticated requests with
  the application's authentication code 401.
- Worker upload, HTTPS website, administrator login, and mailbox APIs passed.
- Public registration is disabled.
- MX records resolve to Cloudflare Email Routing.
- Enabled catch-all rule targets `cloud-mail`.
- The user confirmed receipt of external test messages sent both to the
  administrator and to a previously unused address.
- Resend domain authentication passed; actual outgoing delivery was confirmed
  on 2026-10-30 when Gmail received a reply sent from Telegram.
- The user confirmed the mail-claim result. Automated browser inspection of the
  authenticated live session was unavailable; personalization checks used local
  mocked settings.
- Existing repository tests are Hello World scaffolding referencing a missing
  `wrangler.jsonc`; they are not evidence of email behavior.

Send an external test message to `admin@florin-studio.com`, then to a previously
unused address. Verify the first in the inbox and the second in unclaimed mail.
