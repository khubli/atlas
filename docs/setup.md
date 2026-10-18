# Setting up Atlas

About **5 minutes** to see your own travels: export the file on your phone, open Atlas,
choose the file. Nothing to install, no account, and it costs nothing.

**You need:** Google Timeline turned on (on your phone, in Google Maps), and a browser
on the phone or a computer. Chrome, Edge, Safari and Firefox all work.

- [1. Export your Timeline](#1-export-your-timeline)
- [2. Open Atlas and choose the file](#2-open-atlas-and-choose-the-file)
- [3. Better place names (optional)](#3-better-place-names-optional)
- [4. Keep your data safe](#4-keep-your-data-safe)
- [Run your own copy](#run-your-own-copy)

## 1. Export your Timeline

Timeline now lives on the phone, so the export comes from the phone too.

**Android**

1. Open the phone's own **Settings** app (not Google Maps).
2. Go to **Location** → **Location services** → **Timeline**. Can't find it? Search
   Settings for "Timeline".
3. Tap **Export Timeline data**, confirm it's you, and save the file. It usually lands
   in **Downloads** as `Timeline.json` (the name can differ by language).

**iPhone**

1. Open **Google Maps**, tap your profile picture, then **Settings** → **Personal
   content**.
2. Tap **Export Timeline data** → **Save to Files**. The file is usually
   `location-history.json`.

**Older history from Google Takeout.** If you downloaded a Location History Takeout in
earlier years, it can fill in history the phone no longer has. Atlas reads the Takeout
`.zip`, or all the monthly files from its *Semantic Location History* folder at once.
Importing the phone export and an old Takeout is fine: Atlas skips what it already has.

`Records.json` (raw GPS points from old Takeouts) can't be used; Atlas tells you if you
pick it.

## 2. Open Atlas and choose the file

1. Open **https://atlas.khubli.in** (or your own copy).
2. Tap **Choose your Timeline file**, or drop the file on the page. A 100 MB export
   takes a few seconds on a laptop, longer on a phone.
3. **Check what Atlas found.** A short setup screen shows your homes over time, your
   workplace, places you often stay the night (family homes) and what counts as a trip.
   One tap corrects any of them; everything can be changed later.

**Install it** (optional): in Chrome, menu → **Install app** (or **Add to Home
screen**); in Safari, Share → **Add to Home Screen**. Once installed on Android, you can
share the export straight to Atlas from the Files app: **Share → Atlas**.

Want to look around first? **Try with demo data** loads a made-up traveller.

## 3. Better place names (optional)

The export holds place IDs and coordinates but no names. Atlas names places from
OpenStreetMap on its own after each import, and labels the rest by a nearby landmark or
the neighbourhood. Two ways to get exact names for the places you care about:

**Your Google Maps saved places (recommended, free).** The places you starred or
labelled in Google Maps are your own data.

1. Open [Google Takeout](https://takeout.google.com/) and tap **Deselect all**.
2. Tick **Maps (your places)** and **Maps**, then **Next step** → **Create export**.
3. Download the zip when Google emails you, and choose it in Atlas (Import → **Saved
   places** tab). Every visited place at the same spot takes that name; your own labels
   ("Grandma's place") beat a starred business name.

**Name your top places.** Places opens with a short card of the places you spend the
most time at. "See it in Google Maps" opens each exact place, so you can type its name
once.

**Google Places with your own key.** This gives exact names for every place ID, and
about 1,600 places fit Google's free monthly allowance. But Google's terms don't allow
keeping Places content (only place IDs) or showing it on a non-Google map, and Atlas does
both, so it isn't part of the default setup. Whether to use it on your own copy is your
call. If you do:

1. In [Google Cloud console](https://console.cloud.google.com/), create a project and
   enable **Maps JavaScript API** and **Places API (New)**.
2. **APIs & Services** → **Credentials** → **Create credentials** → **API key**. Under
   *Application restrictions* choose **Websites** and add your Atlas address
   (`https://atlas.khubli.in/*` or your own).
3. In Atlas, Settings → Names → paste the key → **Save**. Naming starts straight away.

The key stays on the device and is never put in backups. Atlas asks only for the
*Place Details Pro* fields (name, type, address, map link).

## 4. Keep your data safe

Your history lives in this browser on this device, nowhere else.

- **Back up:** Settings → Your data → **Back up** saves one `.atlas` file with your
  history, labels, trip edits and settings (not your Google key).
- **Move devices:** open Atlas on the new device and use **Restore** with that file.
- **Stop the browser clearing it:** browsers can clear site data when storage runs low.
  Installing Atlas, and tapping **Keep my data** in Settings → This device, asks the
  browser to keep it.
- **Delete everything:** Settings → Your data → **Delete everything**.

## Run your own copy

Atlas is a static site, so any static host works. With Node 22.12+:

```bash
git clone https://github.com/khubli/atlas.git && cd atlas
npm ci
npm run build        # writes dist/
```

Upload `dist/` to your host. Serve it from **one address** only: browsers keep data per
address, so a second address looks like an empty Atlas.

**Cloudflare, published on every push** (what atlas.khubli.in uses, free tier):

1. Fork the repository.
2. In `wrangler.toml`, change `atlas.khubli.in` to your own domain (it must be a zone
   in your Cloudflare account), and `name` if you like.
3. Cloudflare → My Profile → **API Tokens** → **Create Token** → **Edit Cloudflare
   Workers** template; include your account and your domain's zone.
4. In your fork on GitHub: **Settings** → **Secrets and variables** → **Actions** →
   **New repository secret**, twice:
   - `CLOUDFLARE_API_TOKEN`: the token from step 3;
   - `CLOUDFLARE_ACCOUNT_ID`: Cloudflare → Workers & Pages → *Account ID*.
5. Push to `main`. The **Tests** workflow runs, then **Deploy** publishes the site and
   creates the address and its certificate on the first run. Without the secrets,
   Deploy skips publishing with a warning.
