# David Neeman – acupuncture clinic website

The website of an acupuncture clinic in Tel Aviv, in Hebrew. Clients see the treatments and send a booking request.

All the text on the site is the practitioner's own wording, lightly proofread. Add new text only when it comes from him.

The design is warm and natural:
- **Look:** warm paper colors with terracotta, serif headings, thin lines, and a photo of the empty treatment room in an arch. Soft sunlight drifts slowly behind the opening screen.
- **Fonts:** Frank Ruhl Libre for headings and Assistant for text. Light and dark themes.
- **Motion:**
  - a short intro (once per visit); then the header slides in, each word of "טיפולי דיקור" rises out of its own slot, the lines of the treatment list draw in and the rows follow one by one, and the room photo rises, a curtain lifts off it and it slowly "breathes"
  - section titles rise out of a slot and the short line by their number draws in
  - each treatment's photo is wiped in from the side, its text follows, and the line under it draws across
  - photos drift a little inside their frames while scrolling
  - gallery photos arrive one after another; the full-screen viewer opens out of the photo you tapped and slides between photos
  - on computers the treatment photos lean slightly toward the mouse
  - the About portrait: a curtain lifts and it warms from black and white into color; his quote lights up word by word
  - the big "טיפולי דיקור" at the very bottom rises into view
  - buttons fill with a darker tone on hover and press in slightly on touch; the header slides away while scrolling down
  - switching the theme ripples a circle out from the button
  - everything respects the "reduce motion" setting and "stop animations" in the accessibility menu

- **Pages:** home and booking (`#book` on GitHub Pages, `/book` on the server).
- **Home page sections, in order:**
  - opening section: "טיפולי דיקור", links to the three treatments, the address and an "open now / opens at…" status from the opening hours (no large treatment photo)
  - the treatments, each with its photo, description and a booking button
  - photo gallery (a grid on computers, a swipe strip on phones) with a full-screen viewer
  - about, with his quote beside a short silent video of a treatment (it plays only while on screen, never with "reduce motion", "stop animations" or data saver on, and a button pauses it)
  - address and hours: Waze / Google Maps, an hours table with today marked, and what to know before a treatment
  - contact
- **Design options:** nine versions share the same content (`data-look` on `<html>`). Each has its own colors, fonts, photo shapes and motion, in light and dark.
  - **א – warm and natural** (`2`, the default): terracotta; the text beside an arched photo of the room.
  - **ג – sand and honey** (`2c`): honey tones; a very large, light headline across the width that comes in letter by letter, a numbered treatment list beside a framed photo, big outlined numbers.
  - **ה – sage and clay** (`2e`): the layout of א with colors from the `Color palettes` folder – cream and sand as the base, calm sage green for buttons and links, soft clay (a lighter terracotta) for small warm touches, and blush and pale blue as light glows.
  - **ז – sunset** (`2g`): golden-hour colors; the room photo rises in a circle like the sun, and the sky behind the page turns from dawn to dusk as you scroll; the treatments as soft pills on the opening screen and as three warm cards below.
  - **ח – meridians** (`2h`): a thin line with points runs through the opening screen like an acupuncture meridian – it draws itself, then its points light up (on wider screens); on tablets and computers a point travels down the page edge as you scroll; photos in capsules, the treatments in circles. Fonts: Noto Serif Hebrew and IBM Plex Sans Hebrew.
  - **ט – night** (`2i`): opens in the dark theme; warm dark with gold lines and a candle glow that flickers behind the photo; the headline appears letter by letter. Font: Bona Nova.
  - **י – botanical** (`2j`): deep leaf green; two big leaves sway at the edges of the opening screen, and the headline's letters spring into place. Each photo has its own botanical frame: the room photo a leaf with a thin outline that opens out around it, the treatments a leaf, a pebble that slowly changes shape and a petal, the gallery six shapes mixed (leaf, arch, pebble, petal, seed), the about photo a seed with a soft green pebble behind it, and the video an arch in a light mat like a framed picture. Fonts: Suez One and Rubik.
  - **כ – sea and sand** (`2k`): pale blue and sand; soft rounded shapes, waves drifting between the sections, and photos that float gently. Font: Varela Round.
  - **ל – stage** (`2l`): on wide screens (1100 px and up) the page runs beside a large photo panel that changes with what you're reading – the room, each treatment, the gallery, about; on smaller screens it's a regular page. Font: Heebo.

  On computers, ג, ט and ל show a small photo of a treatment beside the mouse while it's over that treatment in the opening screen's list. Photos lean toward the mouse in א, ג, ה, ט and ל.

  Open the site with `?options` at the end of the address (for example `https://solosoosi.github.io/Website/?options`) to get a switcher (a bar at the bottom on computers, a round button on phones); the pick is remembered on that device. Normal visitors never see it and get version א.
- **The treatment video:** `public/images/clinic.mp4` (12 seconds, silent, 720×900, about 820 KB) and its still `clinic-poster.jpg` are made from `Videos/WhatsApp Video 2026-10-30 at 10.49.57 AM.mp4`: cropped to 4:5, cut between two near-identical moments (4.0 s and 17.0 s) and joined with a short fade so it loops smoothly. 720 px is the full width of the file WhatsApp sent; the original from the phone (sent as a file, not as a video) would make a sharper copy.
- **Treatment photos:** cosmetic = needles on the face; dry needling = needles along the back; stress = a relaxed client with needles on the forehead and face (best match – confirm with David).
- **Accessibility menu** (the person icon in the header): bigger text, high contrast, underlined links, stop animations, readable font. Also an accessibility statement.
- **Phones:** a bottom bar with "book", WhatsApp and call. It slides up once the opening screen's own booking button has scrolled away, so the two never show at once. The gallery is a swipe strip with a thin progress line under it, and the browser's address bar takes the page's background color.
- **Link previews:** when the link is shared on WhatsApp or Facebook it shows a picture card (`public/images/og.jpg`), and Google gets the business details (address, phone, hours).
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
| Treatment photo | `config/site.json` → `services` → `image` |
| Site address (used for link previews) | `config/site.json` → `siteUrl` |
| All page text: about, address and hours, accessibility statement, buttons… | `public/js/i18n.js` |
| Colors and fonts | top of `public/css/styles.css` (`:root` for light, `[data-theme='dark']` for dark) |

**Photos:** the originals are in `photos/`. `scripts/make-images.py` makes the web copies in `public/images/` from them: cropped, compressed, without location data, and each in a few widths. With `srcset`, every phone, tablet or computer downloads the copy that is sharp on its screen, so no photo is shown larger than its real size. To change a crop or use a different photo, edit the script and run it (needs Pillow: `pip install pillow`), then rebuild `docs/`:

```bash
python3 scripts/make-images.py
npm run build:pages
```

**Accessibility statement:** the text in `public/js/i18n.js` → `statement` is a starting point. Have the business review it. Add details about the clinic's physical accessibility (entrance, elevator, parking) if it applies.

A missing phone, WhatsApp, email, Instagram or Facebook value hides that link automatically.

## GitHub Pages (free hosting, no server)

The `docs/` folder holds a static, single-page version of the site, made for GitHub Pages:

- Free times are calculated in the visitor's browser from the opening hours in `config/site.json`. Nothing is stored, so the site can't know about existing bookings.
- **Booking requests and contact messages open WhatsApp** with a ready message to the practitioner, who confirms the time with the client. The booking form only asks for a name (and optional notes): the message comes from the client's own WhatsApp, so the practitioner already has their number.
- Direct link to the booking page: add `#book` to the address. An old or mistyped address (for example `.../book`) is sent to the right place by `docs/404.html`.

**Turn it on (one time):** on GitHub, open the repo → **Settings → Pages** → under **Build and deployment**, choose **Deploy from a branch**, pick this branch and the **`/docs`** folder → **Save**. After a minute or two the site is live at `https://<username>.github.io/<repo>/`.

**After changing content** (`config/site.json`, `public/js/i18n.js`, the HTML or CSS), rebuild and commit `docs/`:

```bash
npm run build:pages
```

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
- [ ] **Privacy notice:** on the server version the booking form collects names and phone numbers, so add a short privacy policy page. (The GitHub Pages version stores nothing; the request goes out from the client's own WhatsApp.)

## Project layout

```
config/site.json      business details, treatments, default hours
server/               Express app, SQLite store, availability logic, auth, email
public/               HTML pages, CSS, JS (i18n, theme, booking, admin)
scripts/              build-pages.mjs (builds docs/), make-images.py (makes the web photos)
test/                 node:test unit and API tests
render.yaml           Render blueprint
Dockerfile            container image for other hosts
```
