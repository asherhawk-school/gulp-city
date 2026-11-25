# Gulp City

Steer a hungry sinkhole through a little cartoon city. Swallow anything smaller than you — people, cones, cars, houses, and eventually skyscrapers — and grow bigger with every bite. Holes that are clearly bigger than you can swallow *you*, so watch your back. Whoever has the highest score when the timer runs out wins.

**Play it:** https://asherhawk-school.github.io/gulp-city/

## Modes

| Mode | How |
| --- | --- |
| **Vs Bots** | You against 0–11 computer holes (Easy / Normal / Hard). |
| **Local 2P** | Split screen on one keyboard. Player 1 uses **WASD**, Player 2 uses the **arrow keys**. Bots optional. |
| **Online** | Click **Host a game** and send friends the 5-letter code or the invite link. They click **Join**. Bots fill the empty spots. Up to 12 players. |

## Controls

- **Mouse:** the hole follows your cursor (farther away = faster)
- **Keyboard:** WASD or arrow keys
- **Touch:** drag anywhere to use the virtual joystick
- **Esc:** leave the round · **M:** mute sounds

## Rules

- You can swallow an object once your hole is a bit bigger than it. The bar in the corner shows what you can swallow next.
- A hole at least 20% bigger than another can swallow it. The swallowed player drops to 60% of their score and respawns after 3 seconds, blinking and safe for a short time.
- The round ends when the timer hits zero. Highest score wins.

## How online play works

Online games are peer-to-peer over WebRTC using [PeerJS](https://peerjs.com/). The host's browser runs the game and streams the state to everyone else. The free PeerJS cloud server is used only to introduce the browsers to each other. Notes:

- The host needs to keep their tab open and in front. If the host leaves, the room closes.
- A few strict school or office networks block peer-to-peer connections. If joining fails, try another network or a phone hotspot.

## Run locally

It's plain HTML/JS with no build step:

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000.
