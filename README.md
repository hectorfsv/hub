# HUB

The desk tablet's front door: **https://hectorfsv.github.io/hub/**

ARC with the Forge. A gold reactor holds the clock (24-hour) and the date. The core's talk is out for now, until a better
tablet. The Lounge, the Pit and Home sit on its orbit. While a cook runs on
the Pit, embers rise and the bottom of the screen glows like a firebox.

- **In the Hubs app on the tablet** (`window.HubsApp`):
  - a pod opens its service;
  - the gear opens the app's panel;
  - after sunset, a minute untouched dims the screen. The first touch only wakes it.
- **In any browser,** the pods are plain links.
- **Samples:** `?demo=cook` shows a pretend brisket; `?demo=night` dims after 4 s; `?boot=0` skips the start-up check.

## The add-ons: his picks 10-28, on preview behind `?try=1`

They show only at **https://hectorfsv.github.io/hub/?try=1** until he says "put it on". Without the flag, the page the tablet
runs draws, reads and listens to nothing new (the tests prove it).

- **Power and air.** Two brackets of 8 cells hug the time.
  - Left: the tablet's battery, from `navigator.getBattery()`. Android's web view answers (checked on the tablet 10-28:
    WebView 156, 100%, charging); an iPhone doesn't, so its bracket shows a dash.
    - Gold. Red under 20% when unplugged, and a toast under 10%.
    - A bolt while charging. Plugging in sends a spark up the bracket.
  - Right: the US AQI from Open-Meteo's air-quality service (free, no key). It's read once an hour while the HUB is on
    screen. Gold up to 100, ember to 150, red above.
- **The day orbit.** A bead on the reactor's outer ring.
  - The sun goes from sunrise (left) over the top to sunset (right).
  - At night the moon, in its real phase (computed on the tablet), rides the bottom half back.
  - One layer is turned once a minute.
- **The hour flare.** On the hour: a one-shot glow, and a kick of the two outer rings. Never while dimmed.
- **The kitchen timer.** Hold the clock.
  - 12 times from 1 min to 3 h. While it runs: +1, +5 and STOP.
  - A countdown above the time and a ring draining inside the core.
  - At zero: DONE blinks, the reactor flares, and three tones chime every 2.4 s. That lasts two minutes or until a touch,
    and the touch does nothing else.
  - The timer survives a reload (`hub.timer`).
  - Sound starts with the tap that starts the timer (the browser's rule).
- **Holidays,** on the day itself: Halloween, Thanksgiving, Dec 24-25, Dec 31-Jan 1, July 4.
  - The greeting changes and takes the day's color.
  - The dust and the orbit's sparks wear the day's colors and burn brighter.
- **Two fixes that ride along:**
  - The weather now refreshes every 15 min while the HUB stays on screen. Before, it refreshed only when coming back from
    a service.
  - In landscape, the footer no longer runs "ONLINE" into "HUB".
- **Samples:** `?try=1&demo=cook` (battery 64%, AQI 38); `?try=1&holiday=halloween` shows a holiday on any day.

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

`node test/check.mjs` runs headless Chromium at the tablet's size (533×853 at 1.5×), landscape, an iPhone and a desktop.
It has 163 checks:

- the layout: nothing off screen or overlapping;
- the boot check, the weather, the link flow, the forge, the app's calls, and night;
- the add-ons:
  - with the flag off: nothing new;
  - with it on:
    - the brackets measured against the digits' ink at the widest times (00:00);
    - the bead taken all the way round its ring at every size;
    - the timer from the hold to the alarm;
    - the moon's phase;
    - the holidays by date;
    - the battery low, then plugged in.

Every page runs on a fake clock inside the saved weather's day (10-28), so the suite passes on any date.

Screenshots go to `test/shots/`.
