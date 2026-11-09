# PrivateFit privacy design

## The three promises

1. **No account.** There is no sign-up, login, or user identifier of any kind.
2. **No network.** `android/app/src/main/AndroidManifest.xml` declares no `android.permission.INTERNET`.
   Android refuses socket access to apps without it, so the release build cannot upload anything,
   even by accident or through a dependency. `npm run check:manifest` fails the build if anyone adds it.
   Debug builds add the permission in `src/debug/AndroidManifest.xml` only so Metro can serve the bundle.
3. **Your data is a file you own.** Settings offers JSON and CSV export to the Downloads folder and a
   two-step "Delete all data". `android:allowBackup="false"` keeps the database out of Google backups.

## Bluetooth devices

Watches, bands, rings, heart-rate straps and scales are read directly over Bluetooth, so the vendor
app, its cloud and its login are not needed. The app only ever talks to a device over Bluetooth, and
only sends it what is needed to read your data and to set its clock, your profile and its
measurement settings. Nothing about you leaves the phone, and no vendor server is ever contacted,
not even for a pairing key: platforms that need one (Xiaomi, Amazfit) take the key you paste in.

A device connects when you tap Connect, or on its own when you turn on auto-connect for it.
Forwarding phone notifications to a device is a separate, off-by-default switch per device; when it
is on, notification text is sent to that device over Bluetooth and never stored.

## What is stored

| Table | Contents | Source |
|---|---|---|
| `samples` | steps (phone sensor, or a device's daily total), heart-rate points, SpO2 and stress readings | `phone`, `ble:<id>` |
| `workouts` | timed or manually logged sessions, and sessions synced from a device, with duration, distance, kcal, HR summary, effort, notes | `manual`, `ble:<id>` |
| `sleep_sessions`, `sleep_stages` | bed and wake times; for device nights, the awake / light / deep / REM spans | `manual`, `ble:<id>` |
| `body_measurements` | weight, body fat (manual or Bluetooth scale) | `manual`, `ble:<id>` |
| `devices` | paired device ids and names, what platform they speak and what they share, their auto-connect and per-device settings, last sync time | |

`<id>` is the device's Bluetooth address on Android. Preferences (units, goals, source ranking,
onboarding flag, step-counter state, in-progress workout) live in AsyncStorage inside the app sandbox.

## Encryption at rest

`src/config.ts` has `ENCRYPTED_DB`. When true, the database opens with SQLCipher using a random
256-bit secret generated once by `SecureKeyModule` and wrapped by an AES-GCM key inside the Android
Keystore. Enabling it requires the SQLCipher build of op-sqlite (`"op-sqlite": { "sqlcipher": true }`
in package.json). It ships off until that build is verified on a device (see README). Device pairing
keys the user pastes in are kept through the same Keystore-backed module, never in the database.

## Threat model

Protected against: any remote party. There is no server and no network path.

Partly protected: someone with the unlocked phone in hand. They can open the app like any other app.
Encryption at rest protects the database file if the phone storage is copied while locked.

Not protected: a compromised or rooted phone, or the user's own exports once they leave the
Downloads folder. Bluetooth itself: a cheap ring with no pairing security can be read by any phone
in range, which is the device's property, not the app's.

## Why this design

The research behind the product (Synthesize run `2026-09-13-health-fitness-scan`) found that
"de-identified" wearable data is re-identifiable: one day of raw accelerometer data identifies a
person with 96% accuracy. Removing identifiers is not enough. The only robust design is to never
transmit the data, so the app does not have the ability to.
