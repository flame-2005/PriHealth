# PrivateFit

A standalone, dark-only health and fitness tracker for Android (iOS later) that keeps every byte on
the phone. No account. No internet permission. Your data is a file you own. It is built to replace
the vendor app of your watch, band or ring: the device talks to PrivateFit directly over Bluetooth.

- **Steps** from the phone's hardware step counter, or from a connected watch, band or ring
- **Workouts** with a live timer, optional heart-rate strap or watch, calorie estimate, manual logging
- **Sleep** log with one-tap bed / wake and manual entry, and device nights with sleep stages
- **Weight and body composition** by hand or from a Bluetooth smart scale
- **Trends** over 7 / 30 / 90 days for every metric, including SpO2 and stress, with goals and streaks
- **Devices**: several at once, each ranked per metric so a ring's night and a watch's steps never add up
- **Export** JSON / CSV to Downloads, **delete everything** in two taps

Bare React Native 0.85 (no Expo), TypeScript, op-sqlite, react-native-ble-plx, react-navigation 7.
See `docs/PRIVACY.md` for the privacy design, `docs/DEVICES.md` for the device matrix and the driver
layer, and `docs/PROTOCOLS.md` for the protocol facts drivers are written from.

## Run it

Prerequisites: Node 22+, JDK 17, Android SDK with NDK 27 and CMake 3.22 (the standard React Native
setup). A physical Android phone is best; the step counter and Bluetooth do not exist in emulators.

```sh
npm install
npm start                # Metro, in one terminal
npm run android          # build + install debug on the connected device
```

Debug builds add `INTERNET` only so Metro can serve the bundle. Release builds have no network
permission at all:

```sh
npm run build:android:release   # android/app/build/outputs/apk/release/app-release.apk
npm run check:manifest          # fails if INTERNET sneaks into the release manifest
```

## Checks

```sh
npm run typecheck
npm test
npm run lint
```

## Layout

```
src/
  app/App.tsx           bootstrap: forced dark scheme, store hydration, step tracking, device links, session HR
  navigation/           root stack + bottom tabs (Today, Activity, Sleep, Body, More)
  screens/              one file per screen
  components/           Screen, Card, Button, StatTile, RingProgress, TrendChart, Sheet, Field, ListRow
  theme/                dark tokens
  domain/               pure types and maths (time, units, aggregate, sleep, sources, devices, bytes, base64)
  db/                   op-sqlite open + migrations, repositories per table
  tracking/             step counter maths, workout session state machine, sleep log, source policy
  integrations/ble/     BleManager wrapper (permissions, scan, connect), pure SIG parsers in gatt/
  integrations/devices/ driver layer: link, registry, session manager, sync, drivers/<platform>, testing/
  bridge/               JS side of the Kotlin modules
  store/                zustand store + AsyncStorage prefs
  export/               JSON / CSV export
android/app/src/main/java/com/privatefit/
  StepCounterModule.kt     hardware step counter (TYPE_STEP_COUNTER)
  SecureKeyModule.kt       Keystore-wrapped secret for SQLCipher
  ExportFileModule.kt      writes exports to Downloads via MediaStore
  BondedDevicesModule.kt   LE devices the phone is paired with or connected to
  DeviceLinkService.kt     foreground service keeping device links alive with the app closed (+ DeviceLinkModule)
  NotificationRelayService.kt  forwards phone notifications to a watch once access is granted (+ NotificationRelayModule)
```

## Encryption at rest (optional, off by default)

1. Add `"op-sqlite": { "sqlcipher": true }` to `package.json`, then `npm install`.
2. Set `ENCRYPTED_DB = true` in `src/config.ts`.
3. Rebuild. The key is generated once by `SecureKeyModule` and never leaves the Android Keystore.

Do this on a fresh install; an existing unencrypted database will not open with a key.

## Roadmap

Done in code, awaiting a phone session to validate: the Da Fit / MoYoung driver (clock, profile,
heart-rate interval, find, notifications; history sync behind switches until captured), the
background link and notification relay, and the Colmi / QRing ring driver (experimental). Next:
validate on the Noise Icon Plus and turn its captures into fixtures; FitCloudPro and GloryFit
drivers once their command tables are captured; Xiaomi / Amazfit with a user-supplied key;
companion apps for Wear OS and Apple Watch as separate projects; file importers (FIT/TCX);
on-device activity recognition from the accelerometer.
