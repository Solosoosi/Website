# Booking requests in Google Calendar

This connects the website (the GitHub Pages version) to David's Google Calendar:

- **Taken times don't show on the booking page.** Anything in his calendar blocks that time, with the usual 15-minute break around it. An all-day event, for example "חופש", closes the whole day. Birthdays and invitations he declined don't block anything.
- **Each booking request goes into his calendar** as a yellow event, "בקשה מהאתר: name – treatment", at the time the client chose, with the client's notes. It happens while WhatsApp opens for the client. The conversation and the confirmation stay on WhatsApp, as before.
- **The website never sees his events.** It only gets which times are taken, without titles or details.
- **If Google doesn't answer** (rare), the booking page shows the times from the opening hours, exactly as before.

It's free and needs no server: a small script runs in David's own Google account.

## Set it up (about 10 minutes, once)

Do this signed in to **the Google account whose calendar David uses**, on a computer.

1. Go to [script.google.com](https://script.google.com) and click **New project**.
2. Click **Untitled project** at the top and name it, for example `Website bookings`.
3. Delete everything in the editor, then paste the whole content of [`booking-calendar.gs`](booking-calendar.gs). Click the **Save** icon (or Ctrl+S).
4. Click **Deploy** (top right) → **New deployment**.
5. Next to "Select type", click the gear icon → **Web app**.
6. Set:
   - **Execute as:** Me
   - **Who has access:** Anyone

   Then click **Deploy**.
7. Google asks for permission:
   1. Click **Authorize access** and choose David's account.
   2. A screen says "Google hasn't verified this app". That's normal for a script you wrote yourself: click **Advanced** → **Go to Website bookings (unsafe)**.
   3. Click **Allow**. The script needs his calendar to read the busy times and add the requests.
8. Copy the **Web app URL**. It looks like `https://script.google.com/macros/s/…/exec`.
9. Check it works: open that address in the browser with `?from=2026-11-01&to=2026-11-07` added at the end. You should see something like `{"ok":true,"busy":{…}}`.
10. Put the address on the website: send it to Claude, or paste it into `config/site.json` → `"googleCalendarUrl": "…"`. Then run `npm run build:pages`, commit and push.

Then try it: book a time on the website. A yellow event appears in his calendar at that time, and the time disappears from the booking page.

## Day to day

- **A new request:** a yellow event "בקשה מהאתר: …" arrives, and the client's WhatsApp message comes too.
  - When he confirms on WhatsApp, he can leave the event as it is, or change its color or title.
  - If a request never arrives on WhatsApp (the client didn't send it), he deletes the event to free the time.
- **A day off:** an all-day event closes the day on the website.
- **A personal appointment:** any event blocks that time.
- **To free a time:** delete or move the event.

## Changing the script later

1. Paste the new code and save.
2. Click **Deploy** → **Manage deployments** → the pencil icon.
3. Under **Version**, choose **New version** → **Deploy**.

The address stays the same, so the website needs no change.

Settings at the top of the script:
- `CALENDAR_ID`: another calendar instead of his main one.
- `MAX_REQUESTS_PER_DAY`: 25. This guards against a flood of fake requests.

## Turning it off

Empty `googleCalendarUrl` in `config/site.json` and rebuild. The site goes back to the opening hours alone.
