# Practice website with online booking

A bilingual (Hebrew by default, English optional) website for a therapy or healing practice. Clients can book a session online, and the practitioner manages bookings from a private admin panel.

- **Pages:** home (hero, about, treatments, how it works, testimonials, FAQ, contact), `/book` (booking) and `/admin` (management).
- **Hebrew / English:** the toggle is in the header. Hebrew is right-to-left and English is left-to-right, and the visitor's choice is remembered. You can link straight to English with `?lang=en`.
- **Light / dark theme:** follows the visitor's device setting by default. The toggle in the header overrides it.
- **Booking:** the client picks a session type, then a day on the calendar, then a free time, then enters their details. The server calculates free times from the weekly hours, session length, a break between sessions, minimum notice, blocked days and existing bookings. Two people can't book the same time.
- **Admin panel (`/admin`):**
  - See upcoming, past and cancelled bookings, and cancel a booking.
  - Edit the weekly opening hours.
  - Block days (vacations, holidays).
  - Read messages from the contact form.
- **Email (optional):** the client gets a confirmation in their language, and the practitioner gets a notification for every booking and contact message.
- Built with Node.js, Express and SQLite (built into Node). There is no build step and no front-end framework: plain HTML, CSS and JS.

## Run locally

```bash
npm install
cp .env.example .env   # set ADMIN_PASSWORD
npm run dev            # http://localhost:3000
npm test
```

Requires Node.js 22.13 or newer.

## Where to put the client's content

| What | File |
| --- | --- |
| Business name, tagline, phone, WhatsApp, email, address, Instagram/Facebook | `config/site.json` → `business` |
| Treatments: name, description, length in minutes, price (0 = free) | `config/site.json` → `services` |
| Default opening hours (later edited in `/admin`) | `config/site.json` → `defaultSchedule` |
| All page text: about, FAQ, testimonials, buttons… (Hebrew and English) | `public/js/i18n.js` |
| Colors and fonts | top of `public/css/styles.css` (`:root` for light, `[data-theme='dark']` for dark) |

**Photos:** put image files in `public/images/`. In `public/index.html`, find each `<div class="photo …">` block (each one has a comment above it) and replace its inside with an image, for example `<img src="/images/about.jpg" alt="…">`. The block keeps the arch or rounded shape.

**Testimonials:** the three cards are clearly marked as samples. Replace them with real client quotes, with the clients' permission, or delete the section.

A missing phone, WhatsApp, email, Instagram or Facebook value hides that link automatically.

## Hosting and domain

### Recommended: Render (about $7–8 per month)

1. Push this repo to GitHub.
2. On [render.com](https://render.com): **New → Blueprint** → pick the repo. `render.yaml` sets up everything:
   - the web service
   - a 1 GB disk for the database
   - the Frankfurt region (closest to Israel)
   - a health check
3. When asked, fill in `ADMIN_PASSWORD` and `NOTIFY_EMAIL`, plus the SMTP settings if you want email.
4. The site goes live at `https://healing-website.onrender.com`.

> Don't use Render's free plan for this site. Its storage is wiped on every restart, so bookings would be lost.

### Custom domain

1. Buy a domain:
   - **`.co.il`:** from an accredited Israeli registrar (e.g. LiveDNS, Domain The Net, Box). About ₪60–100 a year.
   - **`.com`:** from Cloudflare or Namecheap. About $10–15 a year.
2. In Render: **Settings → Custom Domains → Add**, e.g. `www.example.co.il`.
3. At the registrar, add the DNS records Render shows you. Usually that's a `CNAME` for `www` and an `A` record for the bare domain. Render issues the HTTPS certificate automatically.

### Alternatives

The `Dockerfile` runs anywhere that runs containers:

- **Railway:** add a volume mounted at `/data`.
- **Fly.io:** `fly launch`, then `fly volumes create data`, mounted at `/data`.
- **A VPS:** any small server, e.g. Hetzner or DigitalOcean.

Whatever host you use, the database needs **persistent storage**. Set `DATA_DIR` to the persistent folder.

### Email

Set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` and `MAIL_FROM`. Some options:

- **Gmail:** host `smtp.gmail.com`, port 587, with an [app password](https://support.google.com/accounts/answer/185833).
- **Brevo:** has a free tier.
- **Zoho Mail**
- **Resend** (SMTP mode)

Set `NOTIFY_EMAIL` to the practitioner's inbox. Without SMTP settings the site still works; emails are just written to the server log.

### Backups

All data is in one file: `$DATA_DIR/site.db`. On Render, disk snapshots are taken daily. You can also download the file from the Render shell.

## Before launch (checklist)

- [ ] Real business details, treatments and prices in `config/site.json`
- [ ] Real text in `public/js/i18n.js`, and photos in place
- [ ] Opening hours and blocked days set in `/admin`
- [ ] A strong `ADMIN_PASSWORD`, and SMTP tested with a real booking
- [ ] **Accessibility statement:** Israeli law (Equal Rights for Persons with Disabilities regulations, IS 5568) requires most business sites to publish one with a contact person. The site is built with accessibility in mind:
  - keyboard navigation and a skip link
  - labelled forms
  - good color contrast in both themes
  - reduced motion when the device asks for it

  The statement itself must come from the business.
- [ ] **Privacy notice:** the booking form collects names and phone numbers, so add a short privacy policy page.

## Project layout

```
config/site.json      business details, treatments, default hours
server/               Express app, SQLite store, availability logic, auth, email
public/               HTML pages, CSS, JS (i18n, theme, booking, admin)
test/                 node:test unit and API tests
render.yaml           Render blueprint
Dockerfile            container image for other hosts
```
