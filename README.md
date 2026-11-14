# ascii-sharks-theme

A theme for the Claude Code desktop app: four sharks drawn in ASCII characters (a hammerhead, a classic shark, a mako and a thresher) swim behind the chat, light gray on a near-black background, like a terminal. They cross the screen from side to side, tails swaying. The app's colors switch to dark grays with light text, and a veil dims the sharks while they pass behind the chat column so the text stays readable.

Based on [ascii-sharks](https://github.com/stackedlol/ascii-sharks) by drewdi (MIT license; the notice is in `LICENSE`).

## Install

In the desktop app: click **+** next to the message box, then **Plugins**, **Add marketplace** with `Ryukamy/ascii-sharks-theme`, then **Add plugin**.

In a Claude Code terminal session:

```
/plugin install ascii-sharks-theme --marketplace Ryukamy/ascii-sharks-theme
```

Answer `y` to add the marketplace and press Enter to install it for your user. Or, from a shell:

```bash
claude plugin install ascii-sharks-theme --marketplace Ryukamy/ascii-sharks-theme
```

Open a new session in the desktop app and the sharks appear behind the chat.

## Usage

- `/sharks`: says whether it is on and lists the options.
- `/sharks on` and `/sharks off`: turn the backdrop on or off. Remembered for later sessions.
- `/sharks saver` (default): the sharks move in small steps, all at once, 8 times per second. The backdrop repaints at most 8 times per second instead of 60 or 120.
- `/sharks smooth`: continuous gliding. Smoother, uses more battery.

If the system's "reduce motion" setting is on, the scene holds still.

## What's inside

- `hooks/scene.ts`: the scene. It rasterizes each shark in six tail poses and builds an SVG whose CSS moves them and cycles the poses. The SVG runs no scripts.
- `hooks/register.tsx`: applies the theme when a session starts, reapplies it after `/clear`, registers `/sharks` and draws the backdrop.
- `hooks/make-colors.js`: the palette generator that ships with Claude Code, unchanged.
- `tests/sharks.test.ts`: tests for `claude plugin test`.

## Limits

Only the desktop app (and the mobile app) draw backdrops. The terminal and editors show nothing. The theme is made for dark mode: if the app is in light mode and the text looks dark, switch it in Settings → General → Appearance.
