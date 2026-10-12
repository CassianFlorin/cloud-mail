# Personal Cloudflare deployment

Deployed on 2026-10-09 from upstream commit `ec7a2bb`.
The local mail-claim feature was deployed on the same date as Worker version
`f2791f3c-659b-4a44-a1c3-9fdbdbc5049f`.
The personalization card update was subsequently deployed as Worker version
`5a65bbe3-b860-4514-851e-b3cccadcc8f6`.
The private R2 transition was deployed on 2026-10-12 as Worker version
`b76503cc-40d2-4d8d-abc6-32ca2adf892f`.

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
  An actual outgoing reply still needs delivery confirmation.
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
- Resend domain authentication passed; actual outgoing email delivery remains
  unverified until a test reply is received externally.
- The user confirmed the mail-claim result. Automated browser inspection of the
  authenticated live session was unavailable; personalization checks used local
  mocked settings.
- Existing repository tests are Hello World scaffolding referencing a missing
  `wrangler.jsonc`; they are not evidence of email behavior.

Send an external test message to `admin@florin-studio.com`, then to a previously
unused address. Verify the first in the inbox and the second in unclaimed mail.
