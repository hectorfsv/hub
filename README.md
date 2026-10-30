# HUB

The desk tablet's front door: **https://hectorfsv.github.io/hub/**

ARC with the Forge. A gold reactor holds the clock (24-hour) and the date, with power and air beside it and the sun or the
moon on its ring. The core's talk is out for now, until a better tablet; hold the clock for the kitchen timer. The Lounge,
the Pit and Home sit on its orbit. While a cook runs on
the Pit, embers rise and the bottom of the screen glows like a firebox.

- **In the Hubs app on the tablet** (`window.HubsApp`):
  - a pod opens its service;
  - the gear opens the app's panel;
  - after sunset, a minute untouched dims the screen. The first touch only wakes it.
- **In any browser,** the pods are plain links.
- **Samples:** `?demo=cook` shows a pretend brisket; `?demo=night` dims after 4 s; `?boot=0` skips the start-up check.

## Around the clock: his picks 10-28

These were on preview (`?try=1`) for an hour. They have been on for everyone since his "Put it on!" that night. Undo:
revert the commit "Put the add-ons on".

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
  - At zero: DONE blinks, the reactor flares, and a kitchen-timer beep-beep-beep-beep sounds every 2.4 s. The beeps are
    square waves at 2.7 kHz, near full scale; the first soft 1 kHz sines "barely sound" on the tablet. That lasts two
    minutes or until a touch, and the touch does nothing else. `hub.chime()` plays one burst.
  - The ring is 60 cells, so each step redraws one cell.
  - The timer survives a reload (`hub.timer`).
  - Sound starts with the tap that starts the timer (the browser's rule).
- **Holidays,** on the day itself: Halloween, Thanksgiving, Dec 24-25, Dec 31-Jan 1, July 4.
  - The greeting changes and takes the day's color.
  - The dust and the orbit's sparks wear the day's colors and burn brighter.
- **Two fixes that ride along:**
  - The weather now refreshes every 15 min while the HUB stays on screen. Before, it refreshed only when coming back from
    a service.
  - In landscape, the footer no longer runs "ONLINE" into "HUB".
- **Samples:** `?demo=cook` (battery 64%, AQI 38); `?holiday=halloween` (or `xmas`, `thanksgiving`, `newyear`, `july4`) shows
  a holiday on any day.

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
- **Nothing new gets a layer of its own at rest.** The tablet's GPU blends every composited layer every frame, even a still
  one. Each add-on as its own layer cost ~25 late frames in 500 (measured 10-29). Draw new things into a layer that already
  exists: the static outer ring, or the core. The suite checks it.
- **Nothing runs while it is hidden** (a service on screen): no polling, and every animation stops.
- **`sw.js` keeps an offline copy** of the page and its fonts, so it opens before the Wi-Fi is back. The page comes from the
  network whenever the network answers within 4 s.

## On a TV (the Fire TV Stick, 2026-10-29)

Hubs 2.1 says `tv: true` in its services and hands the stick's arrows and Select to the page as ArrowLeft/Right/Up/Down
and Enter. The page then moves a gold ring (`.cur`) by direction over the pods, LINK LIVE COOKS, the clock and the gear;
inside a sheet, over that sheet's buttons and fields. Select presses; on the clock it opens the kitchen timer (the hold);
Back closes a sheet (the app sends Escape) and the ring returns to where it was. The page lays out at 1443x812 there
(the app's wide viewport). A finger never sees the ring; a keyboard's focus wears the same one. **The stick's layer
diet:** on a TV the 1-px scan line, the three orbit runners and 8 of the 14 motes stay out (`.tv` rules): on that chip
every composited layer costs CPU every frame (measured 10-29, `projects/desk-tablet/README.md`); the tablet keeps them all.

### The TV layout (10-29 night, his "Go and build the tv layout!")

Only with the app's `tv` (the tablet is untouched): the reactor smaller and to the left; **his streaming apps as a ring
around it** (`.tapp`, the app's own icons from `HubsApp.apps()`, at most 24 degrees apart on the left 240 degrees; Up and
Down walk the ring, Right leaves it; Select asks the app to `launch` it; the clock's date line names the app the ring is on);
the pods beyond; a right column: the weather folded to one line and six hours, **a YouTube tile** with the Lounge's 12
channels copied word for word (`LOUNGE.TV`; Select plays with sound, Select again is full screen, Left/Right in full screen
change the channel, Back leaves full screen, Back again stops; search is the YouTube app's chip: the Lounge's search goes
through n8n behind its passphrase, the HUB has none) and **the news**: the Lounge's five free feeds and its ranking copied
word for word (`LOUNGE.FEEDS`, `newsRank`: US, then Israel and the Middle East, then Mexico), read by the page every 15
minutes on screen (0 n8n runs); Select opens a story on top (Back closes it). While a video plays the room holds still and
the sparks step out; no night dimming on a TV; the clock's power bracket goes and its air reading and timer countdown are
an HTML line under the date (the stick misdraws the core's SVG text).

## Tests

`node test/check.mjs` runs headless Chromium at the tablet's size (533×853 at 1.5×), landscape, an iPhone and a desktop.
It has 218 checks (the TV view, the remote and the TV layout since 10-29):

- the layout: nothing off screen or overlapping;
- the boot check, the weather, the link flow, the forge, the app's calls, and night;
- the add-ons:
  - the brackets measured against the digits' ink at the widest times (00:00);
  - the bead taken all the way round its ring at every size;
  - the timer from the hold to the alarm;
  - the moon's phase;
  - the holidays by date;
  - the battery low, then plugged in.

Every page runs on a fake clock inside the saved weather's day (10-28), so the suite passes on any date.

Screenshots go to `test/shots/`.
