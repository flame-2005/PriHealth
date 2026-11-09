# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

PrivateFit is an offline, dark-only health and fitness tracker. Bare React Native 0.85 (no Expo, New
Architecture and Hermes on), TypeScript, Android first. The `ios/` folder is the unbuilt template; the
development machine is Windows.

## Commands

```sh
npm install
npm start                        # Metro
npm run android                  # debug build onto a connected device (needs Metro)

npm run typecheck                # tsc --noEmit
npm run lint                     # eslint .
npm test                         # jest
npx jest __tests__/tracking.test.ts          # one file
npx jest -t "detects a reboot"               # one test by name

npm run build:android:release    # android/app/build/outputs/apk/release/app-release.apk (JS bundled in)
npm run build:android:debug
npm run check:manifest           # privacy gate, run after a release build (see below)
```

The `build:android:*` scripts call `gradlew.bat`; from Git Bash use `cd android && ./gradlew.bat assembleRelease`.
The release build is signed with the debug keystore, which is fine for sideloading and not for a store.
A release build compiles C++ for four ABIs: about half an hour from clean on the development machine,
about a minute when only JS or Kotlin changed. The four-ABI APK is around 80 MB; add
`-PreactNativeArchitectures=arm64-v8a` to the Gradle command for a phone-only build of around 30 MB.

Requires Node 22+, JDK 17, Android SDK 36, NDK 27.1.12297006, CMake 3.22.1. The step counter and Bluetooth
do not exist in emulators, so those paths need a physical phone.

**If the project folder is moved or copied**, Gradle fails with "Configuring project ... without an existing
directory" because autolinking caches absolute paths. Delete `android/build/generated/autolinking`, the
`generated`, `intermediates`, `tmp` and `kotlin` folders under `android/app/build`, and
`node_modules/<native lib>/android/build`, then rebuild.

## Product constraints (do not break these)

- **No network.** `android/app/src/main/AndroidManifest.xml` must never declare `INTERNET`; only
  `src/debug/AndroidManifest.xml` does, for Metro. `npm run check:manifest` fails if it appears in the
  source or merged release manifest. Do not add dependencies that need network access, analytics or accounts.
- **One self-contained app, direct Bluetooth only.** Data comes from phone sensors and from devices over
  Bluetooth, and the app is meant to replace the vendor app for the platforms it supports: it syncs the
  device's history and sets its clock, profile and settings. Everything it sends a device is local
  Bluetooth. Never a vendor cloud, account, pairing server, Health Connect, HealthKit or other apps' data;
  a platform that needs a pairing key takes the key the user pastes in. `docs/DEVICES.md` has the tiers
  and the device matrix.
- **Protocol facts, not code.** Vendor protocols are implemented from published documentation and our own
  captures, recorded in `docs/PROTOCOLS.md`. Gadgetbridge is AGPL-3.0: never copy its code, identifiers
  or comments. A driver written without the device in hand ships marked experimental.
- **Encryption is off by default.** `ENCRYPTED_DB` in `src/config.ts` and `"op-sqlite": { "sqlcipher": true }`
  in `package.json` must change together. User-facing copy must not claim encryption while the flag is off.
- `docs/PRIVACY.md` and `PrivacyScreen` describe these promises; keep them true when behaviour changes.

## Architecture

`src/domain/` is pure maths and types with no React Native imports, and everything else builds on it:
`db/` (SQLite), `tracking/` (step sync, workout session, sleep log, source policy), `store/` (zustand state
plus AsyncStorage prefs), `hooks/` (data loading), `integrations/` (Bluetooth) and `screens/`. Keep new
logic out of screens where it can live in `domain/`, `tracking/` or a driver.

**Refresh model.** Screens load through `useAsyncData` (`src/hooks/useData.ts`), which re-runs its loader on
screen focus and whenever `dataVersion` in the zustand store changes. Every write must be followed by
`bump()` (device code uses the coalesced `scheduleBump()` in `integrations/devices/sync.ts`), otherwise
other screens show stale data. zustand 5 is `useSyncExternalStore`: select one entry or a scalar from
`store.connected`, never `Object.values(...)` inline in a selector.

**Database** (`src/db/`). One op-sqlite connection, opened lazily by `getDb()`. Migrations are versioned
arrays in `schema.ts` keyed by `PRAGMA user_version`: append a new array, never edit an existing one (v2
added device platforms, sleep stages and external ids). All writes go through `run()` and `batch()`, which
share a JS-side queue so transactions cannot overlap. Do not issue `BEGIN`/`COMMIT` yourself, and do not
use op-sqlite's `transaction()`, `executeBatch()` or `executeSync()`: they run statements synchronously on
the JS thread against a connection the worker thread may be using (the library is built with
`SQLITE_THREADSAFE=2`). There are no foreign keys (op-sqlite never turns them on): delete child rows
yourself, in the same `batch`. The Jest stand-in (`__mocks__/@op-engineering/op-sqlite.ts`) only treats
statements starting with `SELECT`, `WITH` or a bare `PRAGMA` as reads, so no `RETURNING`.

**Units and time.** Stored values are always kg, metres, epoch milliseconds. Convert only at the edge with
`domain/units.ts`. `day` columns are local `YYYY-MM-DD` keys from `domain/time.ts` (`dayKey`); a sleep
session's day is the wake-up day. `loadSeries` (`hooks/useSeries.ts`) returns 0 for missing days of totals
and `NaN` for measurements (heart rate, weight, SpO2, stress); `TrendChart` treats `NaN` as a gap.

**Sources and the policy.** Every row carries `source_id`: `phone`, `manual`, `demo` or `ble:<device id>`.
Device history rows also carry an `external_id` that is deterministic per device (`day:<YYYY-MM-DD>` for
daily totals, `hr:<epoch minute>`, `sleep:<start ms>`, `workout:<device start ms>`), and the partial unique
indexes on `(source_id, external_id)` make every sync idempotent. Several devices can report the same
thing and their numbers must never be added: `domain/sources.ts` ranks source classes per metric (steps:
watch, band, ring, phone; sleep: ring, watch, band, manual; heart rate: strap, watch, band, ring; weight:
scale, manual), the user can reorder them (`store.sourcePolicy`), and `tracking/sourcePolicy.ts` applies
the ranking per day. Step screens must read through `tracking/daySteps.ts` (`stepsForDay`, `stepsByDay`),
never `sumForDay('steps')`, or a phone count and a watch total get added.

**Steps.** `StepCounterModule.kt` exposes the hardware counter, cumulative since boot. `tracking/stepMath.ts`
(pure) diffs successive readings, detects reboots and spreads a delta across local days;
`tracking/stepTracker.ts` persists the result and keeps the last reading in AsyncStorage (`pf.stepState`).
Sync runs on launch, on every foreground and live while open (`useStepTracking` in `src/app/App.tsx`).
There is no background service yet, so steps taken while the app is closed are attributed by time on the
next sync. A connected watch writes its running daily total as one `ble:<id>` row per day
(`tracking/watchSteps.ts`, external id `day:<YYYY-MM-DD>`, MAX semantics, `start_ms` = first report of the
day), and the source policy shows that row instead of the phone's rows for the day.

**Workouts.** `tracking/workoutSession.ts` is a pure state machine. The live session sits in the store and
is persisted to AsyncStorage, and elapsed time is derived from wall-clock timestamps, so a session survives
the app being killed. Heart-rate samples are saved with `externalId = workout:<id>:<n>` (device workouts:
`wk:<external id>:<n>` under the device's source), which is how `workoutsRepo.remove` finds them.

**Devices** (`src/integrations/devices/`, documented in `docs/DEVICES.md`). `session.ts` owns every
connection (up to four) so they outlive screens. On connect, `registry.ts` gives the device the standard
handler for each SIG service it exposes (`drivers/gatt`: heart rate, pedometer, scale, battery) plus at
most one vendor driver matched on its vendor service or manufacturer string; capabilities are the union
and the kind (watch, band, ring, strap, scale) comes from the vendor driver, a name hint, or the profiles.
A device with nothing readable is released with an explanation. Handlers talk to the device through a
`GattLink` (`link.ts`: MTU chunking, shared monitors, `request()` that arms its matcher before writing);
`testing/fakeLink.ts` replays transcripts so drivers are tested without hardware. Each
`drivers/<platform>/protocol.ts` is pure (bytes in, typed messages out) and fixture-tested; `driver.ts`
only sequences IO. Events land in `session.ts`: `store.liveHr` and `store.liveSteps` follow the device the
policy ranks first (a ring takes over when the watch stops streaming), heart rate outside a session is
logged every 5 s (`tracking/heartRateLog.ts`), SpO2 is logged per minute, and history records go through
`sync.ts`. Scale readings and watch-to-phone operations reach `App.tsx` through `onEvent`. `discovery.ts`
holds the pure scan listing rules; the scan has no service filter, and the Devices screen also offers the
LE devices the phone is already paired with (`BondedDevicesModule`). Auto-connect devices are restored on
launch and after a drop with backoff. `src/integrations/ble/` keeps the ble-plx wrapper (permissions,
scan, connect) and the pure SIG parsers in `gatt/`.

**Native modules.** Six Kotlin modules under `android/app/src/main/java/com/privatefit/` (step counter,
Keystore-wrapped DB key, export to Downloads, paired Bluetooth devices, the device-link foreground service
control, the notification relay), registered in `PrivateFitPackage` and reached through `NativeModules` in
`src/bridge/`. They are legacy bridge modules running through the New Architecture interop layer. The JS
wrappers must keep tolerating a missing module, because Jest and iOS have none. Two services sit next to
them: `DeviceLinkService` (foreground, type `connectedDevice`, runs the `DeviceLink` headless task
registered in `index.js` so links survive the app being closed) and `NotificationRelayService`
(`NotificationListenerService`, only active once the user grants access). A Kotlin change needs a Gradle
build to compile: `cd android && ./gradlew.bat assembleDebug -PreactNativeArchitectures=arm64-v8a`.

**UI.** Tokens live in `src/theme`. Build screens from `Screen` (safe area plus keyboard avoidance) and
`Sheet` (modal form). The app targets SDK 36, where Android 15+ windows are edge-to-edge and are not resized
for the keyboard, so text inputs belong inside one of those two. Charts are hand-rolled with
`react-native-svg`; Skia and Reanimated are deliberately not used.

## Tests

Development so far has had no phone or emulator in the loop, so the Jest suite is the safety net:

- Pure logic: `domain/`, the GATT parsers, step and session maths, the source policy (`sources.test.ts`).
  New maths belongs in `domain/` or `tracking/*Math` so it can be tested without a device.
- `repos.test.ts` runs the real schema and every repository query against a real SQLite engine.
  `__mocks__/@op-engineering/op-sqlite.ts` stands in for op-sqlite using Node's built-in `node:sqlite`
  and is applied automatically. When you add or change SQL, cover it there. `migrations.test.ts` runs the
  migration list from scratch and as an upgrade of a populated v1 database.
- `devices.test.ts` drives the device layer with `FakeLink`s: connect, several devices, headline values,
  drops, vendor composition, sync. A new driver gets `__tests__/<platform>.test.ts` on fixtures under
  `__tests__/fixtures/<platform>/` (only `.ts` files directly under `__tests__/` are suites; helpers live in
  `src/integrations/devices/testing/`).
- `screens.test.tsx` mounts every screen and the whole app on top of that database and fails on any
  `console.error`. A new screen needs a row in its table. It asserts on visible text, so update it when
  copy changes.
- `db.test.ts` declares its own op-sqlite mock to prove that writes cannot overlap.

The SQLite-backed suites skip themselves when `node:sqlite` is unavailable (Node below 22.13 without the
flag). `jest.config.js` extends the preset's `transformIgnorePatterns` and maps `lucide-react-native` to its
CommonJS build; both are needed for screens to load under Jest.

None of this covers what only a phone has: the step sensor, Bluetooth, the Kotlin modules and keyboard
layout. CI (`.github/workflows/ci.yml`) runs typecheck, lint, tests, the manifest gate and a debug build.

## Repository notes

This folder is not its own git repository. It sits untracked inside a repository rooted higher up, so
`git status` and `git log` here show unrelated paths. `.kilo/worktrees/` is a worktree of that outer
repository, not project code.
