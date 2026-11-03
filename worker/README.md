# The website on Cloudflare

The site runs on Cloudflare's free plan:

| What | Where | Free plan |
|---|---|---|
| Pages, photos, the video | Cloudflare's static files: `dist/`, built from `public/` by `scripts/build-cloudflare.mjs` | Unlimited, and they don't count toward the Worker's daily limit |
| `/api/*`: free times, bookings, messages, the admin panel | The Worker: `worker/index.js` | 100,000 requests a day |
| The data: bookings, closed days, opening hours, messages | Cloudflare D1, a database named `clinic` (tables in `migrations/`) | 5 GB; 5 million rows read and 100,000 written a day |
| Signing in to the admin panel | Cloudflare Access: a one-time code sent by email, no password | Up to 50 people |

`BOOKING_MODE` in `wrangler.jsonc` decides how bookings work:

- `"whatsapp"` (now): exactly like the GitHub Pages site today. A booking request or a message opens WhatsApp, and nothing is stored. The free times come from the opening hours, minus the days closed in the admin panel.
- `"online"`: bookings and messages are taken and stored on the site, and show up in the admin panel. Switch to it only once payments and emails are connected (next step, after David's answers).

## What's ready, and what waits for David

Ready now:
- Everything the site does today, on Cloudflare.
- The admin panel, behind Cloudflare Access.
- Security headers on every page and file.
- Limits per visitor.
- The database.

Waiting for David's answers:
- **Payments** (Grow): his account and how payment works (questions 6–13).
- **The iPhone calendar**: iCloud or Google, and which calendar (14–17).
- **Emails** to him and to clients (19–20).
- **The domain** (18).
- **The terms and privacy policy** (21–23).

## Setting it up

You'll need David's Cloudflare account. Cloudflare's dashboard is renamed now and then, so a menu may have a slightly different name.

1. **David's account.** He opens a Cloudflare account with the business email and turns on two-step login. He then invites you under **Manage account → Members** as an administrator.
2. **On your computer**, in this folder:
   ```sh
   npm install
   npx wrangler login        # sign in as yourself, then choose David's account
   ```
3. **The database.**
   ```sh
   npx wrangler d1 create clinic --jurisdiction eu
   ```
   Paste the `database_id` it prints into `wrangler.jsonc`, under `d1_databases`, and commit.

   `--jurisdiction eu` keeps the data inside the EU. Israel's rules on sending personal data abroad allow EU countries. If the option is refused, use `--location eeur` instead.
4. **Create the tables and deploy:**
   ```sh
   npm run cf:deploy
   ```
   The site is now at `https://clinic.<account>.workers.dev`. Run `npm run cf:deploy` again for every later change, or let Cloudflare deploy each push:
   - Go to **Workers & Pages → clinic → Settings → Builds → Connect** and pick this repository and branch.
   - Keep the deploy command `npx wrangler deploy`.
   - When a new file appears in `migrations/`, run `npx wrangler d1 migrations apply clinic --remote` once yourself.
5. **The admin panel's sign-in (Cloudflare Access).**
   1. Open **Zero Trust**. The first time, it asks for a team name (for example `davidneeman`) and a plan: choose Free.
   2. Under **Settings → Authentication**, add the **One-time PIN** login method.
   3. Under **Access → Applications → Add an application → Self-hosted**:
      - Add the site's address twice, with the paths `admin` and `api/admin`.
      - Add a policy: **Allow**, Include → Emails → David's email (and yours).

      While the site is still on workers.dev, turn on Access for the whole workers.dev address from the Worker's **Settings → Domains & Routes** instead. Only you two will be able to open the site until the domain is connected.
   4. Copy the application's **Audience (AUD) tag**, then:
      ```sh
      npx wrangler secret put ACCESS_TEAM_DOMAIN   # https://<team name>.cloudflareaccess.com
      npx wrangler secret put ACCESS_AUD           # the AUD tag
      npx wrangler secret put ADMIN_EMAILS         # david@…, you@… (comma between them)
      ```
   5. Open `/admin`: Cloudflare sends a code to the email, and the panel opens.

   The Worker checks Access's token on every admin request. That covers the signature, that it's for this application, that it hasn't expired, and that the email is in `ADMIN_EMAILS`. So the data stays closed even if the Access settings are ever changed by mistake. Until all three secrets are set, the admin panel is closed.
6. **The domain** (question 18).
   1. Cloudflare doesn't sell `.co.il` addresses: buy it from an Israeli registrar, in David's name. A `.com` can be bought on Cloudflare itself.
   2. In Cloudflare, add the domain to David's account (**Add a site**, Free plan). At the registrar, switch its nameservers to the two that Cloudflare shows.
   3. Under **Workers & Pages → clinic → Settings → Domains & Routes → Add → Custom domain**, add the address, and `www.` too.
   4. Set `siteUrl` in `config/site.json` to `https://<domain>/`. Link previews, the canonical address and search results all use it.
   5. Move the Access application from step 5 to the new address.
   6. Send the old GitHub Pages address to the new one.
7. **Extra protection, also free:**
   - Under **Security → WAF → Rate limiting rules**, add one rule: when the URI path starts with `/api/`, at most 60 requests in 10 seconds per IP, otherwise block. Floods are stopped before they reach the Worker or its daily limit.
   - **Backups:** D1 keeps a restorable history of the database (Time Travel), with nothing to set up. `npx wrangler d1 export clinic --remote --output <file>` writes a full copy, which contains clients' personal details. Keep such a copy encrypted, and never in this repository.

## Settings

| Name | Kind | What |
|---|---|---|
| `BOOKING_MODE` | `vars` in `wrangler.jsonc` | `whatsapp` or `online` (see above) |
| `ACCESS_TEAM_DOMAIN` | secret | `https://<team name>.cloudflareaccess.com` |
| `ACCESS_AUD` | secret | The Access application's AUD tag |
| `ADMIN_EMAILS` | secret | Who may open the admin panel, with a comma between addresses |

Secrets are set only with `npx wrangler secret put` (or in the dashboard). Never put them in this repository, in WhatsApp or in an email. Deploys never change them.

## Working on it locally

```sh
cp .dev.vars.example .dev.vars   # local settings; git ignores .dev.vars
npm run cf:dev                   # http://localhost:8787, with a local database
npm test                         # includes test/worker.test.js
```

The local database lives in `.wrangler/`, which git ignores. There's no Cloudflare Access locally, so the admin panel stays closed. `test/worker.test.js` shows how its sign-in tokens are checked.
