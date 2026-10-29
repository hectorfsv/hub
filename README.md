# HUB

The desk tablet's front door: **https://hectorfsv.github.io/hub/**

ARC with the Forge. A gold reactor holds the clock. The Lounge, the Pit and Home sit on its orbit. While a cook runs on
the Pit, embers rise and the bottom of the screen glows like a firebox.

- **In the Hubs app on the tablet** (`window.HubsApp`):
  - a pod opens its service;
  - the core opens the Lounge in voice mode;
  - the gear opens the app's panel;
  - after sunset, a minute untouched dims the screen. The first touch only wakes it.
- **In any browser,** the pods are plain links.
- **Samples:** `?demo=cook` shows a pretend brisket; `?demo=night` dims after 4 s; `?boot=0` skips the start-up check.

## What it reads (all free, no n8n)

- **Weather:** from Open-Meteo, which needs no key.
- **Is each service up?** One `HEAD` request to its page.
- **The Pit's notebook (Supabase):** read with **its own sign-in**, the "Link live cooks" chip, kept in localStorage `hub.pit`.
  - It never touches the Pit page's session: two pages sharing one refresh token sign each other out.
  - The addresses come from the Pit's public `../the-pit/config.js`.
  - Read-only: the running cook, and its latest reading.

## Rules it keeps

- **Everything that moves is a `transform` or an `opacity`** on a layer painted once. The tablet's chip only composites;
  nothing repaints per frame and no script runs per frame.
- **Nothing runs while it is hidden** (a service on screen): no polling, and every animation stops.
- **`sw.js` keeps an offline copy** of the page and its fonts, so it opens before the Wi-Fi is back. The page comes from the
  network whenever the network answers within 4 s.

## Tests

`node test/check.mjs` runs headless Chromium at the tablet's size (533×853 at 1.5×), landscape, an iPhone and a desktop:

- the layout: nothing off screen or overlapping;
- the boot check, the weather, the link flow, the forge, the app's calls, and night.

Screenshots go to `test/shots/`.
