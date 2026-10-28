# ARES / Mars Mission — timed WIN/LOSE edition

## Rules

| Your final action | Mission succeeds | Mission fails |
|---|---|---|
| Stay on Mars | WIN | LOSE |
| Return to Earth | LOSE | WIN |

The player briefing shows the matrix and exactly:
“Your decision is final. Your reward depends also on what other players do.”
No physical reward is mentioned in the app. Announce any real-world reward separately
before players decide, and use the final personal WIN/LOSE screen to distribute it.
Returning is irreversible, but its reward is not guaranteed. The arrival screen says
“You have returned safely to Earth” and waits for the final reward. At closure it
updates to WIN or LOSE. No warnings, departure notifications or other game controls
appear on that screen.

## One minute, two thresholds, three endings

The server fixes the roster and starts a 60-second evacuation window. It ends:
1. At the deadline, even if host and player pages are closed.
2. When mission control presses End mission.
3. When departures reach 60% of the fixed roster.

Failure and automatic stop use **at least**, matching the specified examples:
- q = 30%: with 40 astronauts, the mission fails from 12 departures.
- h = 60%: with 40 astronauts, the session ends at 24 departures.
- With another roster size, thresholds are rounded up: ceil(N*0.30), ceil(N*0.60).

Reaching q does not immediately close the game. The actual result is settled at closure.
Thresholds are visible in mission control, not sent to player devices. Players do see
actual roster size and departures: they can infer percentages, but q/h are not announced
on their interface. A large timer appears at the top during play and becomes urgent
in the last 15 seconds. Time is authoritative on the server; network delays may delay
screen updates. Late actions are rejected by the server.

## Real crew bar and forced departures

Crew Confidence is removed. The sticky CREW ON MARS bar displays the actual percentage
remaining and the percentage that has left. Every departure reduces the remaining
COUNT by one, so with 40 astronauts each departure reduces the bar by 2.5 percentage
points. Displayed percentages are rounded to integers; the bar uses actual counts.
Warning broadcasts do not alter the bar or the outcome rules.

Every departure generates a cascading anonymous banner for other active players,
never for the person leaving. Up to four banners appear together. The feed preserves
all received events; the banners do not intercept taps. Reduced motion is respected.

Mission control can press Force one departure, or click an available astronaut in the
crew list to force that specific person to leave. This is a real, irreversible state
change, not just a visual message: it affects the bar, thresholds and that person's
reward. It is recorded with actor and forced flag in the CSV. It bypasses the slow
procedure. Tell the class in the debrief which departures were externally induced.
In class mode no virtual players are added.

## Start on Mac

Install Python 3.10+, extract the ZIP and open Terminal inside the folder:

```sh
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
python server.py
```

Keep Terminal open and open its Host link on the computer. Keep that private link/key
secret. Windows: use `py` instead of `python3`; AVVIA-WINDOWS.bat is included. The Mac
launcher is also included; use Terminal if pip/macOS asks for an environment or blocks it.
Stop with Ctrl+C. Restarting clears both sessions.

## Classroom QR and tester QR

Mission control displays two separate QR codes and a session selector. Neither QR
contains a control key. Both phones show the same player interface. Session data,
warnings, resets and exports are isolated.

- Classroom: select CLASSROOM, share its QR, wait for at least four people and launch.
  Target size is 40. The real roster is fixed at launch; no late joins.
- Tester: scan TESTER QR with one phone, press Join, then select TESTER on the computer
  and launch. The server adds 39 virtual crew members to simulate a 40-person class.
  Virtual crew do not act autonomously. Force one departure chooses a virtual member
  by default; click the real astronaut's number if you want to force the phone to leave.
  Warning, bar, notifications, clock and outcomes work exactly as in class mode.
  At 12 departures the mission fails; at 24 it auto-stops. Reset selected session and
  rejoin on the phone for another rehearsal. No extra controls appear on the phone.

Use Project QR before displaying mission control publicly: private controls and the
TESTER QR are hidden. During play operate from a private display. The host's crew buttons
identify astronauts by anonymous number, not by name.

## Network and online hosting

This package is not deployed online. Phones must reach the running server. Use a shared
Wi-Fi permitting device-to-device traffic; campus Wi-Fi can isolate devices. If needed,
set LAN_IP to the computer's IPv4 before launch. Example on Mac:
`LAN_IP=192.168.1.20 python server.py`. Allow incoming connections on port 8000.
Never use localhost/127.0.0.1 in a QR for another device.

For Internet access, use a Python/container hosting service (not static-only hosting).
Install: `pip install -r requirements.txt`. Start: `python -u server.py`.
Set PUBLIC_URL to the actual HTTPS origin, PORT to the service's port and HOST_KEY to
a private long key. Health endpoint: /health. Dockerfile included. Use one process and
one instance because state is in memory. The app polls approximately every 0.8 seconds;
keep the page open. It is not background push messaging.

## Checks and interpretation

Run `python test_game.py`. Integration checks cover rewards either side of 12/40,
24/40 auto-stop, manual stop, locked choices, public counts, own-event suppression,
forced departures, tester isolation, QR authorization, and timer-expiry logic.
JavaScript syntax and UI logic were also checked. Browser visual QA and a real-phone
rehearsal remain necessary; no browser executable is available in the creation environment.

This is a sequential coordination exercise with irreversible exits and imposed shocks.
Both coordinated outcomes can give every player WIN: mission failure is a collective
narrative loss, not a lower individual reward at the all-depart equilibrium. A cascade
is not guaranteed. No account/name is collected. The tool does not prevent one person
joining through multiple browser profiles before launch.
