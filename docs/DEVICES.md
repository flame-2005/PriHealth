# Device support

PrivateFit talks to wearables and sensors directly over Bluetooth. No vendor app, cloud or account
is involved, and nothing about you leaves the phone. The app is meant to replace the vendor app
for the devices it supports: it pulls the device's history (steps, sleep with stages, heart rate,
SpO2, stress, workouts), keeps its clock and your profile set, and, when you turn it on, forwards
phone notifications to it.

Support is organised by **platform protocol, not brand**. Hundreds of brand names sit on a handful
of ODM platforms, and one driver per platform covers every brand on it.

## Tiers

| Tier | What | Rule |
|---|---|---|
| Standard profiles | Bluetooth SIG services any brand may expose | Works with no per-brand code: heart-rate straps, scales, and the live parts of most watches |
| Open local platforms | Vendor protocols that are documented, need no vendor pairing and no secret | Implemented from documentation and our own captures; the whole vendor-app replacement |
| Bring-your-own-key platforms | Vendor protocols that need a secret only the vendor's servers hand out | Supported when the user pastes the key they extracted once with the vendor app; the app never goes online for it |
| Companion-app platforms | Watches with no Bluetooth path for third-party phone apps (Wear OS, Apple Watch) | Only reachable with our own app running on the watch; separate projects |
| Not possible | Proprietary and cloud-only devices (Fitbit, Whoop, Ultrahuman, Tizen Galaxy Watches) | Listed so the Devices screen can say so |

## Device matrix

| Family (brands) | Protocol | Secret | Gives | Status |
|---|---|---|---|---|
| Straps, armbands, standard scales (Polar, Garmin HRM, Wahoo, Coospo, SIG scales) | 0x180D, 0x181D, 0x181B, 0x180F, 0x180A | none | live HR, weight, body composition, battery | works |
| Da Fit / MoYoung watches (Noise Icon Plus, Fire-Boltt Talk, Colmi watches, most Indian and AliExpress budget watches; firmware `MOY-*`) | 0xFEEA (write 0xFEE2, notify 0xFEE3), plus 0x180D live HR and 0xFEE7/0xFEA1 live steps | none | steps, sleep stages, HR history, SpO2, stress, workouts, clock, profile, HR interval, alarms, find, notifications | live parts work; driver written (`drivers/moyoung`): clock, profile, HR interval, find and notifications on by default, history sync behind switches until captured (see "Validating the Da Fit driver") |
| Colmi / QRing rings (R02, R06, R10 and rebrands) | Nordic-UART-like service `6E40FFF0-...`, 16-byte packets | none | battery, clock, HR log interval, steps per day, HR log (5-minute); SpO2 and sleep logs once documented | driver written from the reference client's layouts (`drivers/colmi`); experimental until a ring is tested |
| FitCloudPro (Topstep) and GloryFit watches | open local protocols | none | steps, HR, SpO2, sleep stages, workouts, clock, profile, alarms | planned, experimental |
| Xiaomi Mi Band / Amazfit / Zepp OS | Huami legacy and Xiaomi protobuf protocols, encrypted | 16-byte auth key from Xiaomi/Zepp servers, pasted by the user | steps, HR, SpO2, sleep, stress, workouts | planned, experimental |
| Samsung Galaxy Watch 4+, Pixel Watch (Wear OS) | none for phone apps | | only via our own Wear OS companion app | separate project |
| Apple Watch | none for any third-party app | | only via an iOS build plus our own watchOS companion | separate project |
| Oura, RingConn | community reverse-engineered clients, fragile | | | backlog |
| Fitbit, Whoop, Ultrahuman, Tizen Galaxy Watches, Galaxy Fit | proprietary or cloud-only | | | not possible |

## How it works

`src/integrations/devices/` is the driver layer:

- **Handlers.** A device gets the standard handler for each SIG service it exposes (`drivers/gatt`:
  heart rate, pedometer, scale, battery) plus at most one vendor driver, matched on its vendor
  service UUID or the manufacturer string from Device Information 0x180A. `registry.ts` composes
  them; the device's capabilities are the union, and its kind (watch, band, ring, strap, scale) comes
  from the vendor driver, else from a name hint, else from the profiles. A vendor driver can suppress
  a standard handler whose data it owns.
- **Links.** `link.ts` wraps a react-native-ble-plx connection: reads, writes chunked to the MTU,
  one native monitor per characteristic shared by its listeners, and `request()` for
  command/response protocols, which arms its matcher before writing because a reply can arrive before
  the write promise resolves. It keeps a transcript of the last frames so a session on a real device
  can be exported as a regression fixture.
- **Pure protocols.** `drivers/<platform>/protocol.ts` is bytes in, typed messages out, with no IO,
  like the parsers in `src/integrations/ble/gatt/`. They are tested with fixtures captured from real
  devices (`__tests__/fixtures/`). `driver.ts` only sequences IO over the link and is tested against
  `testing/fakeLink.ts`, which replays a transcript. This is how drivers for devices nobody has in hand
  get written and still have tests.
- **Sessions.** `session.ts` owns every connection (up to four at once) so they outlive screens.
  Events from handlers land there: the headline live values (`store.liveHr`, `store.liveSteps`)
  follow the device the source policy ranks first, readings are logged, and history goes through
  `sync.ts`, where every record is keyed by (source, external id) so a re-sync changes nothing.
  Devices marked auto-connect are brought back on launch and after a drop, with backoff, while
  Bluetooth is on and until the user disconnects or forgets them.
- **Source policy** (`src/domain/sources.ts`, applied in `src/tracking/sourcePolicy.ts`). Several
  devices can report the same thing and their numbers must never be added. Each metric has a
  best-first ranking of source classes (steps: watch, band, ring, phone; sleep: ring, watch, band,
  manual; heart rate: strap, watch, band, ring; weight: scale, manual) that the user can reorder in
  Settings. For a day, the best-ranked class that has data wins; two devices of the same class worn
  one after the other add up, worn together the last reporter stands alone. Step screens read
  through `src/tracking/daySteps.ts`, never a plain sum.

## Background link and phone notifications

- **`DeviceLinkService`** (Kotlin, foreground service of the "connected device" type) keeps the app
  process, and with it the Bluetooth links, alive while any auto-connect device is linked or coming
  back. It shows one quiet notification ("Connected to Icon Plus") and runs the JS headless task
  `DeviceLink` (`src/integrations/devices/headless.ts`), which restores the auto-connect devices
  after the system restarts the service and ends once nothing is linked, which stops the service.
  The session manager starts it from the foreground (Android 12+ refuses otherwise) only with a
  Bluetooth permission granted (Android 14+ refuses otherwise), and stops it when the last
  auto-connect device is disconnected or forgotten. Samsung's "sleeping apps" can still kill it;
  the app reconnects on the next open.
- **`NotificationRelayService`** (Kotlin, `NotificationListenerService`) hands the phone's
  notifications to JS once the user grants notification access on the system page (Permissions
  screen, or the device's settings). It skips ongoing, group-summary and the app's own
  notifications, and `src/integrations/devices/notifications.ts` forwards the rest to every
  connected device whose settings have the switch on, with an optional package allowlist. Nothing is
  stored. Sideloaded builds on Android 13+ must first allow restricted settings for the app
  (App info > menu > Allow restricted settings); adb installs are exempt.
- Watch-to-phone operations (Da Fit command 103: music, reject call) arrive as `phone_op` events
  and are not acted on yet.

## Standard profiles

| Profile | Service | Characteristic | What we read |
|---|---|---|---|
| Heart Rate Service | `0x180D` | `0x2A37` notify | bpm, sensor contact, energy expended, RR intervals |
| Weight Scale Service | `0x181D` | `0x2A9D` indicate | weight (kg or lb), timestamp, user id, BMI/height |
| Body Composition Service | `0x181B` | `0x2A9C` indicate | body fat %, muscle %, muscle/water/fat-free mass, impedance, weight |
| Battery Service | `0x180F` | `0x2A19` read | battery %, refreshed every ten minutes |
| Device Information | `0x180A` | `0x2A29`, `0x2A24`, `0x2A26` read | manufacturer, model, firmware; how vendor platforms are told apart |
| WeChat Sports pedometer | `0xFEE7` | `0xFEA1` read + notify | the watch's step total for the day (distance and kcal when flagged) |

The pedometer profile is not a Bluetooth SIG one; it is Tencent's published WeChat Sports spec,
which most Chinese-ODM watches (MoYoung / Da Fit, Zeroner and others) carry so that third-party
apps can read steps without the vendor app.

## How devices are found

The scan runs without a service filter, in low-latency mode, for 12 seconds. Filtering on the
heart-rate and scale service UUIDs looked tidy but hid most watches: they advertise a name and a
vendor UUID only, even when they expose a standard profile once connected. Anonymous adverts (no
name, no standard service) are dropped so phones, TVs and beacons do not fill the list.

The list also includes the LE devices the phone is already paired with or holds a GATT connection to
(`BondedDevicesModule`, shown as "Paired with phone" / "Connected to phone"). A watch that is
connected to its vendor app stops advertising, so without this it would never appear while that
app runs. Android shares one link between apps, so connecting to such a device still works, but a
vendor app issuing its own commands on the same link makes results unreliable: the replacement
is meant to run with the vendor app uninstalled.

Connect decides what a device is from the services it actually exposes, not from the advert or the
saved record. A device with nothing here can read (a battery level alone does not count) is
disconnected again with an explanation instead of sitting "connected" and silent.

While a device streams heart rate outside a workout, one reading every 5 s is saved as a sample, so
the Today tile and the Devices card can show the last saved reading next to the live one, and the
trends include it. A running workout keeps its own trace instead.

## Experimental drivers

A driver written from documentation without the device in hand ships marked *experimental*: the
Devices screen says so, and each protocol command sits behind a per-device switch so an unconfirmed
command can be turned off without a rebuild. It leaves that state when someone validates it on real
hardware and the transcript becomes a fixture.

## Capturing a device

Fixtures are the ground truth for a driver and come from real traffic, never from another
project's code:

1. On the phone: Developer options > Enable Bluetooth HCI snoop log, toggle Bluetooth off and on,
   run one sync, a time set and a measurement in the vendor app, then `adb bugreport snoop.zip`.
   The log is `FS/data/misc/bluetooth/logs/btsnoop_hci.log` (Samsung: `FS/data/log/bt/`).
2. Extract the ATT traffic for the device with
   `tshark -r btsnoop_hci.log -Y "btatt && bluetooth.addr==<mac>" -T fields -e frame.time_epoch -e btatt.opcode -e btatt.handle -e btatt.value`.
3. `scripts/ble-fixture.js` maps handles to UUIDs, reassembles the frames and writes
   `__tests__/fixtures/<platform>/<name>.json` as `[{t, dir, uuid, hex}]`.
4. Raw logs contain health data: keep them in the git-ignored `captures/` folder and commit trimmed
   fixtures only.

Our own traffic is captured by the link's transcript buffer, exportable from a device's settings in
development builds, in the same shape.

## Validating the Da Fit driver (next phone session)

The driver was written without the watch in hand. With the Noise Icon Plus bonded to the S23 and
NoiseFit **uninstalled** (two apps issuing commands on one link gives unreliable results):

1. Connect from Devices. The card must read "Watch · Da Fit · battery N%" and "Shares: Steps ·
   Heart rate · Sleep · SpO2". Live steps and heart rate behave exactly as before.
2. Clock. The driver sets it on connect; open the device's Settings and compare the watch face with
   "The device will be set to HH:MM". If it is off by hours, the fixed-zone convention is wrong: turn
   "Set the clock on connect" off, note the difference, and fix `toWatchTime` in
   `drivers/moyoung/protocol.ts`.
3. Profile and interval. Send height and weight; pick a heart-rate interval and check the watch's own
   settings page reflects it. "Make the device vibrate" must buzz the watch.
4. Capture. In a development build, tap "Export Bluetooth transcript" after a session that included
   the three steps above; take an HCI snoop log of one NoiseFit sync on a phone that still has it (or
   turn the history switches on one at a time and export the transcript of each reply). Put the
   frames under `__tests__/fixtures/moyoung/` and extend `__tests__/moyoung.test.ts` with them.
5. History. Once a reply's layout is confirmed by a fixture, flip its default in `MOYOUNG_COMMANDS`
   to on and record the result in the tested matrix below.

## Protocol facts, not code

Command tables for each platform live in `docs/PROTOCOLS.md` as facts with their sources: published
documentation (gadgetbridge.org protocol pages, the MIT-licensed `colmi_r02_client` README) and our
captures. The Gadgetbridge source is AGPL-3.0 and is never copied, in code, identifiers or comments.

## Tested matrix

Fill in as devices are tested on real hardware.

| Device | Kind | Result | Notes |
|---|---|---|---|
| (LightBlue / nRF Connect simulated HR peripheral) | strap | pending | |
| Noise Icon Plus (MOYOUNG-V2, firmware MOY-BEU3-2.3.5) | watch | works: battery, live step total via `0xFEA1`, heart rate at 1 Hz over `0x2A37` (flags 0x06, contact detected) while the watch measures (its heart-rate screen or a workout); silent otherwise. 2026-10-13, driver layer: detected as "Watch · Da Fit" from the manufacturer string and 0xFEEA, connects in 4 s, auto-connect reconnects on launch, the foreground service keeps the link through a minute in the background, clock / find / notification frames go out (long frame form), a measurement started on the watch arrives as command 109 (`FF` then the value) and feeds live heart rate. Pending a human check: watch face time after the clock write, the vibration, the notification on the watch face. History sync still off until captured. | Advertises no standard UUIDs and stops advertising while NoiseFit holds it, so it is offered from the phone's paired list. Services: 0x180D, 0x180F, 0x180A, 0xFEE7, 0xFEEA. Tested on a Galaxy S23, Android 16, with NoiseFit installed and connected at the same time. The OS negotiated MTU 247 but ble-plx reported 23. Fixture: `__tests__/fixtures/moyoung/icon-plus-connect.json`. |

## Phone step counter

`StepCounterModule` reads `Sensor.TYPE_STEP_COUNTER`, the low-power hardware counter that runs while
the screen is off. It is cumulative since boot; `src/tracking/stepMath.ts` diffs readings, handles
reboots and splits overnight deltas across days by time. Some OEMs batch sensor events, so the
count catches up when the app opens. A watch total for a day outranks it (see the source policy).

## Not supported by design

Vendor clouds and accounts, Health Connect, HealthKit and other apps' data. Watch faces, firmware
updates and weather need the internet and stay with the vendor. Protocols that cannot be driven
locally (Fitbit, Whoop, Ultrahuman) are not attempted.
