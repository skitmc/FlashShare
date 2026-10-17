# FLASHSHARE Cloud Sync (Cloudflare Pages + Workers + D1)

This bundle adds encrypted cloud backup/sync for FLASHSHARE contacts and chat history. The existing P2P messaging transport remains PeerJS; this feature syncs history that each device has already received or sent. It does **not** provide offline message delivery to a recipient who has never received a message.

## What is stored

- D1 stores the Flash ID, an authentication-token hash, an AES-GCM IV, encrypted snapshot bytes, and an update timestamp.
- Contacts, messages, and display name are encrypted in the browser with AES-GCM before upload.
- The recovery code itself is never sent to the Worker. A derived bearer token is sent over HTTPS; the Worker stores only a hash of that token.
- Anyone who steals a user's recovery code can still recover the account and decrypt its cloud snapshot. Tell users to keep the code private.

## 1. Create the D1 database

In Cloudflare Dashboard, open **Workers & Pages → D1 SQL Database**, create a database named `flashshare-cloud`, then open its Console and run the contents of `schema.sql`.

Or with Wrangler installed:

```sh
npx wrangler d1 create flashshare-cloud
npx wrangler d1 execute flashshare-cloud --remote --file=./schema.sql
```

Copy the database ID printed by `wrangler d1 create` into `wrangler.toml` in place of `DATABASE_ID`.

## 2. Deploy the Worker

From this directory, with Wrangler installed and logged in to your Cloudflare account:

```sh
npx wrangler login
npx wrangler deploy
```

Wrangler will print a URL similar to `https://flashshare-cloud-sync.YOUR-SUBDOMAIN.workers.dev`.

If you want to restrict browser calls to your Pages domain, uncomment the `[vars]` section in `wrangler.toml` and set `ALLOWED_ORIGIN` to the exact origin of your website (no trailing slash), then deploy again. Leave it unset during initial testing if you are unsure of the Pages domain. API credentials are still required either way.

## 3. Connect the Pages app to the Worker

Open `index.html` and find this line near the top of the main script:

```js
const FLASHSHARE_CLOUD_API = '';
```

Set it to the Worker URL you deployed, for example:

```js
const FLASHSHARE_CLOUD_API = 'https://flashshare-cloud-sync.YOUR-SUBDOMAIN.workers.dev';
```

Save and redeploy the updated `index.html` to your existing Cloudflare Pages site. Do not include `/v1/snapshot` in the setting; the app adds that path itself.

## 4. Test it

1. Open the deployed HTTPS Pages site and open Account Security & Backup.
2. Make sure you have downloaded/saved the recovery code.
3. Add a contact and exchange a few messages while both peers are online. Sent and received messages are synced separately from each user's device.
4. In the recovery-code status area, wait for **Cloud backup synced**.
5. Open the site in a different browser/device, recover the same account with its code, and check that the cloud backup is loaded.

## Important limitations and safety notes

- This is a first-pass encrypted snapshot sync, not a full messaging server. It cannot recover history that was never uploaded from a device, and it does not queue/deliver P2P messages while the other peer is offline.
- Simultaneous use on multiple devices can cause last-write-wins updates; the client merges local and cloud messages at startup, but there is no transactional per-message merge API yet.
- Cloudflare D1 and Worker must be deployed before cloud sync works. Until `FLASHSHARE_CLOUD_API` is configured, the app remains local-only.
- The existing app's peer identity protocol is not a complete end-to-end authentication system. This feature encrypts stored snapshots but does not redesign live PeerJS transport.
- Large attachments may exceed storage limits. The Worker caps encrypted snapshots at 6 MB; the app already limits individual files locally.
- Keep the recovery code private. Anyone who has it can derive both the cloud API credential and the decryption key.
