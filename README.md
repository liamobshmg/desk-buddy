# Desk Buddy

A little cutout-head desktop companion. He hops around your screen, says unhinged things, and can be picked up, thrown around and dunked in the bin.

## Download

Grab **Desk-Buddy.exe** from the [latest release](../../releases/latest). No install, just double-click it.

Windows SmartScreen may warn about an "unknown publisher" because the file isn't code-signed. Click **More info → Run anyway**. You can check the download against the SHA-256 listed in the release notes.

## How to use him

- **Click** him to poke him.
- **Drag** him to pick him up. Let go while moving to throw him, and he bounces off the screen edges.
- **Throw him into the bin** in the bottom-right corner to put him away.
- **Click the bin**, or drag from it, to get him back out.
- **Right-click** him for a small menu. **Right-click the bin → Quit Desk Buddy** closes the app completely.

## Privacy

Everything runs locally. No network access, no accounts, no data collected. "Start with Windows" is off unless you tick it.

## Build from source

```bash
npm install
npm start        # run it
npm run dist     # build dist/Desk-Buddy.exe
```

Lines he says live in `phrases.json`.
