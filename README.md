# Arcade: an 8-bit layout for Herdr

A night-time arcade for the [Herdr](https://herdr.dev) app: chunky neon pixel panels over a
pixel sunset, a city skyline and a neon grid. Agents are **players** (P1, P2…): **PLAYING** while
they work, **CONTINUE?** when they need you, **STAGE CLEAR** when they finish. The session panel
shows the run as **NOW PLAYING** with a **SCORE** (tokens) and an **HP** bar (context left).

Work in progress.

## Install

```sh
git clone https://github.com/PsyChaos/herdr-arcade
cp -r herdr-arcade/mods/arcade ~/.config/herdr-app/mods/
cp herdr-arcade/layouts/arcade.json ~/.config/herdr-app/layouts/
cp herdr-arcade/themes/arcade.json ~/.config/herdr-app/themes/
herdr-app do layout.switch '{"name":"arcade"}'
```

`ctrl-shift-l` switches back to your own layout.

## Fonts

`mods/arcade/fonts/` ships [Press Start 2P](https://fonts.google.com/specimen/Press+Start+2P)
and [VT323](https://fonts.google.com/specimen/VT323), both under the SIL Open Font License
(the license texts are next to them).
