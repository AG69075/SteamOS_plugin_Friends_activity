# Friends Activity Bubble

A Decky Loader plugin that shows a floating "Friends who played" bubble over the hero art on a game's details page (Clean GameView compatible), with adjustable position/offset like `steam-achievements`.

![description](images/friends_activity.png)

## How it works (confirmed on real hardware)

1. `window.SteamClient.Apps.GetFriendsWhoPlay(appid)` → returns an array of SteamID64s (the same friends shown by the native "Friends who played this game" widget under the Activity tab).
2. Each SteamID64 is converted to its 32-bit accountid (`BigInt(id64) & 0xFFFFFFFFn`).
3. `window.friendStore.allFriends` (already loaded by the Steam client for your real friends list — no extra network call needed) is used to look up `display_name` and `persona.avatar_url` for each accountid.
4. The route patch injects the bubble into the same `InnerContainer` as `steam-achievements`, with the same scroll-to-hide behavior (so it doesn't duplicate the native widget if you're not using Clean GameView and the Activity tab is visible further down the page).

## Known limitations

- `GetFriendsWhoPlay` and `friendStore` are undocumented internal APIs — they could change in a future SteamOS update, same as `GetMyAchievementsForApp` for `steam-achievements`.
- If a friend isn't present in `friendStore.allFriends` (rare, e.g. not yet loaded into memory), their name falls back to a generic "Friend".

## Installation

1. Zip up the `friends-activity-bubble/` folder (this one, with `dist/`, `main.py`, `package.json`, `plugin.json` inside it — not the files loose at the root of the zip).
2. Transfer the zip to your Deck.
3. Decky Loader → **Developer** → **Install Plugin from ZIP file** (uninstall the previous version first if you're updating).

## Settings (Quick Access Menu `...` → Friends Activity Bubble)

- Bubble position (top-left / top-right / top-center)
- Horizontal / vertical offset
- Max number of friends shown

## Project structure

```
.
├── main.py        # no-op, just here for Decky's expected plugin structure
├── dist/
│   └── index.js   # route patch + bubble component + settings panel
├── plugin.json
└── package.json
```
