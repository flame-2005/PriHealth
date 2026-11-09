# Protocol facts

What each platform's protocol looks like, as facts with their sources. Drivers are written from
these tables and from our own captures (`docs/DEVICES.md`, "Capturing a device"), never from
another project's code. Anything marked *unconfirmed* must be seen in a capture from a real device
before its command switch defaults to on.

## MoYoung / Da Fit (`drivers/moyoung`)

Sources: gadgetbridge.org, "MoYoung protocol" (internals/specifics/moyoung-protocol) and the MoYoung
device page; our Noise Icon Plus captures.

**Service and characteristics**

| UUID | Role |
|---|---|
| `0xFEEA` | vendor service |
| `0xFEE1` | live step counter, read + notify (we use the WeChat `0xFEE7`/`0xFEA1` pair instead) |
| `0xFEE2` | phone to watch, write |
| `0xFEE3` | watch to phone, notify |
| `0xFEE5`, `0xFEE6` | "special channels", unused on the watches seen |
| `0xFEE7`, `0xFEE8` | ECG, old and new |

Protocol version comes from the manufacturer string in Device Information: `MOYOUNG` is the older
fixed-size variant (64-byte packets, 256 from firmware 1.6.5), `MOYOUNG-V2` the MTU variant. The
Noise Icon Plus is `MOYOUNG-V2`.

**Framing (V2)**

```
FE EA | size hi | size lo | command | payload...
```

With MTU 20 the size bytes are `0x10, total length`; otherwise `0x20 + (length >> 8), length & 0xFF`.
The length counts every byte including the header, so a command with no payload has length 5.
Writes go out in MTU-sized chunks; replies arrive as notifications with the same framing and echo the
command byte with data appended. Get commands are usually set + 0x10 and carry no payload.

**Commands**

| Area | Command | Value | Notes |
|---|---|---|---|
| Time | sync time | 49 | uint32 seconds; the watch keeps its clock in a fixed "GMT+8" convention, so local time is encoded as if it were that zone; confirm the sign on the watch face before shipping |
| Time | time system set / query | 23 / 39 | 12 h or 24 h |
| Profile | set user info | 18 | height, weight, age, gender; no query |
| Steps | sync past sleep and steps | 51 | step history entries are `{distance u24, steps u24, calories u24}` |
| Steps | goal set / query | 22 / 38 | query and set use swapped endianness |
| Sleep | sync sleep (today) | 50 | repeating `{type, start_h, start_m}`; types 0 awake, 1 light, 2 deep ("restful"), 3 REM |
| Heart rate | past HR, 5-minute samples | 53 | four packets for today, four for yesterday |
| Heart rate | past HR, 1-minute samples | 54 | twenty indexed packets; not working on the documented watch |
| Heart rate | last dynamic (workout) HR | 52 | first byte 0 first / 1 continuation / 2 last; uint32 time in the first packet; then one byte per minute, 0 invalid |
| Heart rate | movement HR summary | 55 | last three workouts, 24 bytes each: start u32, end u32, valid u16, index u8, type u8, steps u32, distance u32, calories u16 |
| Heart rate | timed measurement set / query | 31 / 47 | 0 off, 1 = 5 min, 2 = 10, 4 = 20, 6 = 30 |
| Heart rate | trigger manual measurement | 109 | start / stop |
| SpO2 | trigger measurement | 107 | |
| Blood pressure | trigger measurement | 105 | unconfirmed |
| Stress | advanced query | 0xB9, argument 0x11 | |
| Workouts | v2 workout sync | 0xB2 | sub-commands 0 list request, 1 list reply, 2 detail request, 3 detail reply, 4 HR request, 5 HR reply; training type ids 0 walk, 1 run, 2 bike, 7 swim, 31 GPS run, 132 open-water swim, up to 146 |
| Device | version query / set | 46 / 30 | firmware and manufacturer come from Device Information |
| Alarms | set / query | 17 / 33 | advanced variants 0xB9 argument 0x05 set, 0x15 query; args 0 set, 2 delete, 4 from watch |
| Find | find my watch | 97 | |
| Find | find my phone | 98 | unconfirmed; watch to phone |
| Notifications | send message | 65 | type byte: 0 call, 1 SMS, 2 WeChat, 3 QQ, 4 Facebook, 5 Twitter, 6 Instagram, 7 Skype, 8 WhatsApp, 9 LINE, 10 KakaoTalk, 11 other; -1 off-hook; text split by U+2080 |
| Phone operation | watch to phone | 103 | 0 play/pause, 1 previous, 2 next, 3 drop call, 4 volume up, 5 volume down, 6 play, 7 pause, 12 send volume |
| Music | set info / state | 68 / 123 | |
| Settings | dominant hand 36/20, display functions 37/21, other message state 44/28, sedentary 45/29, metric system 42/26, language 43/27, quick view 40/24, watch face 41/25, do not disturb 113/-127, power saving set 0x94 / query 0xA4 | | query / set pairs |
| Power | shutdown 81, camera view 102, hi-speed DFU 99, G-sensor calibration 82 | | not used |

Battery has no vendor command: it is the standard Battery Service.

**Seen on the Noise Icon Plus (2026-10-13, `__tests__/fixtures/moyoung/icon-plus-connect.json`):**

- The watch frames its own messages in the long size form (`FE EA 20 ...`) regardless of the MTU,
  so the driver uses that form for a `MOYOUNG-V2` manufacturer string.
- A heart-rate measurement started on the watch reports back on command 109 without being asked:
  `FE EA 20 06 6D FF` while measuring, then `FE EA 20 06 6D 4A` (74 bpm), right after a 1 Hz stream
  on 0x2A37. The driver treats the value as a live heart-rate reading; the same shape is assumed for
  SpO2 on command 107 (unconfirmed).
- No reply follows the sync-time (49), find-watch (97) or send-message (65) frames.
- Send-message as sent: `FE EA 20 12 41 0B` + `Mum` + `E2 82 80` + `Dinner` (type 11, title, U+2080, text).

## Colmi / QRing rings (`drivers/colmi`)

Source: the MIT-licensed `colmi_r02_client` README and protocol notes (github.com/tahnok/colmi_r02_client).

| UUID | Role |
|---|---|
| `6E40FFF0-B5A3-F393-E0A9-E50E24DCCA9E` | service (resembles Nordic UART) |
| `6E400002-B5A3-F393-E0A9-E50E24DCCA9E` | phone to ring, write |
| `6E400003-B5A3-F393-E0A9-E50E24DCCA9E` | ring to phone, notify |

Packets are 16 bytes in both directions: byte 0 is the command, bytes 1 to 14 the payload, byte 15 a
checksum that is the sum of the first 15 bytes masked to a byte (the README says "modulo 255"; the
code masks with 255). Writes go without response. Replies reuse the command byte; a reply with the
high bit set is an error. No pairing, binding or key is needed. Compatible when the listing says to
use the QRing app: R02, R06, R10 and rebrands. Rings with other hardware under the same names use a
different app and are not covered.

| Command | Value | Request | Reply |
|---|---|---|---|
| Set time | 1 | year-2000, month, day, hour, minute, second as BCD, then language 1 (0 Chinese). The client sends UTC; we send local wall-clock time so the ring's day is the user's | a capability bitmask the client ignores |
| Battery | 3 | none | byte 1 level %, byte 2 charging |
| Heart-rate log | 21 | the day's start as uint32 little-endian seconds (midnight of the day, on the ring's clock) | sub-type (byte 1) 0: byte 2 = number of packets that follow; 1: bytes 2 to 5 timestamp, bytes 6 to 14 the first nine readings; 2 and up: thirteen readings each; 255: no data. Readings are five minutes apart from midnight, 288 a day, 0 = none |
| Heart-rate log settings | 22 | read: `01`; write: `02, enabled (1 on, 2 off), interval minutes` | byte 2 enabled (1 on, 2 off), byte 3 interval |
| Real-time keepalive | 30 | `33` | |
| Steps for a day | 67 | `day offset (0 today), 0f, 00, 5f, 01` | header byte 1 = 240 (byte 3 = 1 means calories are in tens); then one packet per 15-minute slot with activity: bytes 1 to 3 BCD year, month, day; byte 4 slot index; byte 5 packet index; byte 6 packet count; bytes 7 to 8 calories, 9 to 10 steps, 11 to 12 distance in metres, all little-endian; byte 1 = 255 means no data |
| Start real-time reading | 105 | `type, action` with types 1 heart rate, 2 blood pressure, 3 SpO2, 4 fatigue, 5 health check, 7 ECG, 8 pressure, 9 blood sugar, 10 HRV; actions 1 start, 2 pause, 3 continue, 4 stop | byte 1 type, byte 2 error (0 fine), byte 3 value |
| Stop real-time reading | 106 | `type, 0, 0` | |

Sleep and SpO2 logs: not documented by the client at the time of writing; not claimed by the driver.

## FitCloudPro (Topstep) and GloryFit

Sources: gadgetbridge.org device pages for FitCloud and GloryFit. Both are open local protocols with
no auth; pairing needs no vendor app. FitCloud syncs steps, distance, calories, HR (automatic and
manual, resting), SpO2, stress, sleep and workouts with GPS, and writes time, user info, goals,
alarms, reminders and display settings. GloryFit syncs steps, HR, SpO2 and sleep with stages, and
writes date and time, user info, goals, language, units, alarms, HR and SpO2 monitoring schedules.
Command tables to be filled from captures when a device is available.

## Xiaomi / Huami / Zepp OS

Source: gadgetbridge.org, "Huami/Xiaomi server pairing". Every device needs a per-device auth key
that exists only on the vendor's servers; it is obtained once through the vendor app (Zepp Life for
older Mi Bands, Zepp for Amazfit and Mi Band 7 Pro / 8 Pro, Mi Fitness for Mi Band 8 and Xiaomi
watches), either from the app's own log file or with a community token tool, and pasted into the
app. Unpairing from the vendor app or a hard reset invalidates it. Two sub-protocols: the Huami
legacy one and the protobuf-based Xiaomi one for Mi Band 8 and later. Command tables to be filled
when the driver is written.
