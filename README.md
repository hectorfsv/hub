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

## Mark II: the main HUB, five pods and a new look (his ask 11-19). ON PREVIEW: `?mk2`; he liked it (11-19 17:05)

**Look at it:** https://hectorfsv.github.io/hub/?mk2&as=tablet (`as=tablet` draws Drone and Remote as the tablet's app
will; without it a browser draws them unfed and a tap says "OPENS ON THE TABLET"). Samples work with it: `&demo=cook`,
`&demo=night`, `&boot=0`. Without `?mk2` the page is exactly what it was: the tablet's controller, the TV and the old HUB
never see any of it (`MK2 = !CTL && ?mk2`, and off when the app says `tv`).

**What it is (his go 11-19 on this concept).** The reactor in the middle; a belt of dark metal round it with his five set
in it (`MK2_PODS`: Drone and Remote on top, the Lounge and Home on the sides, the Pit at the bottom over the fire); a wire
from the core to each, under the turning rings; a pulse runs out along the wire of each pod that is up and the pod's glow
peaks as it lands, one after the other round the ring (6 s a lap); a tap fires the wire, kicks the two outer rings toward
the pod, then the iris opens from it (`mk2Lock`, 130 ms ahead of the iris). During a cook the Pit's wire, pulse and pod
run ember. Drone and Remote say what they are (MAVIC AIR, FIRE TV) until the app can give a live reading. Everything else
is the old page: the clock and its add-ons, the forecast, the cook card, the boot check, night, the holidays.

**The chip (measured 11-19 in the suite's headless Chromium, NOT yet on the tablet's glass):** 56 composited layers, the
same as the old page, and less painted area (11.2 screens against 13.6). How: the belt, the wires and the pods' faces are
painted once into layers that already exist (`#orbit`, `#ring-static`); the three orbit runners (each a layer the size
of the orbit) are not drawn, five small pulses are (`#mk2-pz`, inside the reactor); the pods' dashed rings stand still as
engraved ticks; a pod's glow is a ring OUTSIDE its face and the last thing painted in it, so nothing still sits above a
moving layer (one layer a pod, not two). Two traps found: a wire with a CSS transition took a layer of its own and gave
one to every path drawn after it (no transition on `.m-w`); the pulses under the reactor were hidden by the wire's dark
channel (they live inside `#reactor`, after `#ring-static`). **Before "put it on": the 10-29 test on the glass
(61.9 fps, 0 late of ~500), calm and with the forge lit.**

**Tests:** `node test/check.mjs` is 371 checks now (95 for Mark II: four sizes in a browser, the app's taps with the list
Mark II needs, a cook upright and sideways, the layers, night, a TV untouched); `node test/remote-check.mjs` 473, unchanged.

**His verdict, 11-19 ~17:05, after opening it on his phone: "I opened it on my phone, i liked it!"**

**Still to do, in order:** (1) the tablet's Hubs app (below); (2) the test on the glass; (3) his
"put it on" (the tablet's Setup gets this page with `?mk2`, or the flag becomes the default off a TV). Offered, his call:
one still from Dionysus, a forged-metal plate behind everything (the drawn `#bg` is its stand-in).

### His ask, word for word

**His words, 11-19 ~16:10, in order.** To my read ("the tablet opens on the HUB again, with two new pods: Drone opens Drone
Link and Remote opens the TV remote, next to the Pit, the Lounge and Home (Home Assistant, not set up yet); Drone Link and
its locks stay exactly as they are"): **"No, you're right. It is exactly that. just one more thing. With this new addition,
now the hub is not gonna have the streaming services in there. Because the hub, I want it to be like my hub, you know what
I'm saying? Like the streaming services is gonna be on the hub of my Amazon stick. And the Amazon stick hub comes up when we
go to remote. So now in the main hub, I want that idea of the design, the interface, but I want you to make it better. Take
it to the next level. I know it's still this tablet, so you cannot use a lot of chip, but just the design itself. Give me
something."** Then: "Tell me you need Fable." (he switched this window to Fable 5.2). Then, by voice ("the initials" =
Dionysus): **"if you need [Dionysus] to build you any motion graphics, any video, any generation of AI to make it look
cool, let me know."** My answer: stills only (anything that plays redraws every frame and breaks the page's rule); the
concept names each picture and its price before he makes anything.

**What it means.** The tablet's front door is this page again (since 10-30 it has been the stick's controller,
its `/hub?ctl` page on :8790; the address is in `projects/desk-tablet/README.md`). Five pods: **Drone / Remote / Home / The Pit / Lounge.** No streaming apps on it:
those live on the stick's HUB and on the controller, which stay as they are. The TV layout (`tv`) and the controller
(`?ctl`) are not part of this job.

**What it needs outside this page (found 11-19, not done):** the tablet's Hubs app (2.21) gives the key bridge
(`HubsApp.press/type/keyState`) only to a HUB view on a :8790 page, and `launch` only opens what its list holds, so Remote
as a pod and Drone Link as a pod (`com.hectorfsv.dronelink`) both need a small update of the app, and the tablet's Setup
changes its HUB address (copy its prefs first). Drone Link stays installed with its locks as they are.

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

### The Pit on the HUB (11-02)

`shapeCook` knows a session the smoker opened by itself (`state.auto`): the card reads SMOKER ON, every thermometer plugged in shows by his name or its port, and the fire goes out with the smoker (`state.offSince`), not when the session closes. The Pit's own TV screen is in `projects/the-pit/README.md`.

### Games and DirecTV (11-03, his "set the gaming ring on the big ones, between the pit and home assistant" and "set directv to play on the TV section")

On a TV (`S.tv`): when the app's list holds RetroArch (`GAMES`: `com.retroarch.ra32` and its
64-bit names), it leaves the apps ring and becomes a fourth pod, **Games**, drawn between the Pit and Home Assistant (`pos: 1.5`;
slot `i: 3`, so the app's slots 0-2 keep their numbers). Its label says RETROARCH; Select launches it through `HubsApp.launch`
(which only opens what its list holds). RetroArch uninstalled = the pod goes.
**The controller too since 11-04** (his "in the HUB controller just change the icon and move the games ring"): RetroArch leaves
the crown and is the Games pod (the gamepad icon) on top of the outer ring, the Pit at 230 degrees and Home Assistant at 310
(three pods: `[230, 270, 310]`; two stay at 245 and 295). The top was LOCK's place, so with Games **LOCK goes in, small, at 180
on the inner ring, between ON and OFF** (`CT.place`); without RetroArch it is back on top. A tap on Games opens RetroArch on the
TV (`/api/launch`), no iris, the tablet stays (as the crown's apps). Sideways a right-hand label stops before the panel; upright
HOME ASSISTANT wraps to two lines. The controller reads the stick's apps when it loads, so a new install shows after a reload.
`test/remote-check.mjs` → `controllerGames` checks it sideways and upright (shots `ctl-games-tablet*.png`).
**During a cook the controller keeps the forecast (11-05, his "the bottom has a gap ... only when the ambers come on"):** the TV swaps
the hourly forecast for the cook card, but the controller never shows the cook card (the Pit pod carries it), so the row vanished and
the panel slid up 61 px, leaving the gap. `body.ctl.forge #hours` keeps it: a cook and no cook lay out the same, both ways (measured).
**DirecTV** (`com.att.tv`) is one of the streaming apps on the ring, nothing more. The DIRECTV button under the tile (11-03) was
**removed 11-04, his word: "get rid of that directv button you put on the tv, i'll use directv as streaming platform."** Don't
bring it back. Its picture cannot play in the tile anyway: it is DRM-locked to its own player, unlike YouTube's embeds.

### The TV layout (10-29 night, his "Go and build the tv layout!")

Only with the app's `tv` (the tablet is untouched): the reactor smaller and to the left; **his streaming apps as a ring
around it** (`.tapp`, the app's own icons from `HubsApp.apps()`, at most 24 degrees apart on the left 240 degrees; Up and
Down walk the ring, Right leaves it; Select asks the app to `launch` it; the clock's date line names the app the ring is on);
the pods beyond; a right column: the weather folded to one line and six hours, **a YouTube tile** with the Lounge's 12
channels copied word for word (`LOUNGE.TV`; a channel is a switch: Select plays it with sound and shows a ■, Select again
stops it; while one plays, Up from the channels is the picture: Select is full screen, Left/Right in full screen change the
channel, Select or Back leave it; Back anywhere on the HUB stops the video; the channels are a row that scrolls: Left/Right
walk it in order and the ring only lands on chips in sight (10-29: it vanished onto chips scrolled away, his "no way to stop
it"); search is the YouTube app's chip: the Lounge's search goes through n8n behind its passphrase, the HUB has none) and **the news**: the Lounge's five free feeds and its ranking copied
word for word (`LOUNGE.FEEDS`, `newsRank`: US, then Israel and the Middle East, then Mexico), read by the page every 15
minutes on screen (0 n8n runs); Select opens a story on top (Back closes it). While a video plays the room holds still and
the sparks step out; no night dimming on a TV; the clock's power bracket goes and its air reading and timer countdown are
an HTML line under the date (the stick misdraws the core's SVG text).

## Tests

`node test/check.mjs` runs headless Chromium at the tablet's size (533×853 at 1.5×), landscape, an iPhone and a desktop.
It has 276 checks (the Games pod and DIRECTV since 11-03; the TV view, the remote and the TV layout since 10-29; the tile's square corners and the keyboard taken back from the player since 10-29 late):

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
