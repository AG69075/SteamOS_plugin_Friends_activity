# Friends Activity Bubble

Plugin Decky Loader qui affiche une bulle flottante "Friends who played" par-dessus le hero art de la page détails de jeu (compatible Clean GameView), avec position/offset réglables comme dans `steam-achievements`.

## Comment ça marche (confirmé sur hardware réel)

1. `window.SteamClient.Apps.GetFriendsWhoPlay(appid)` → renvoie un tableau de SteamID64 (mêmes amis que le widget natif "Friends who played this game" de l'onglet Activité).
2. Chaque SteamID64 est converti en accountid 32 bits (`BigInt(id64) & 0xFFFFFFFFn`).
3. `window.friendStore.allFriends` (déjà chargé par le client Steam pour ta liste d'amis réelle, pas besoin d'appel réseau supplémentaire) est utilisé pour retrouver `display_name` et `persona.avatar_url` de chaque accountid.
4. Le patch de route insère la bulle dans le même `InnerContainer` que `steam-achievements`, avec la même logique de masquage au scroll (pour ne pas dupliquer le widget natif si tu n'es pas en Clean GameView et que l'onglet Activité est visible plus bas).

## Limites connues

- `GetFriendsWhoPlay` et `friendStore` sont des API internes non documentées : elles peuvent changer à une prochaine mise à jour SteamOS, comme `GetMyAchievementsForApp` pour `steam-achievements`.
- Si un ami n'apparaît pas dans `friendStore.allFriends` (cas rare, ami pas encore chargé en mémoire), son nom s'affiche comme "Friend" générique.

## Installation
1. Compresse le dossier `friends-activity-bubble/` (celui-ci, avec `dist/`, `main.py`, `package.json`, `plugin.json` à l'intérieur — pas les fichiers en vrac à la racine du zip).
2. Transfère le zip sur le Deck.
3. Decky Loader → **Developer** → **Install Plugin from ZIP file** (désinstalle l'ancienne version d'abord si tu mets à jour).

## Installation
1. Compresse le dossier `friends-activity-bubble/` (celui-ci, avec `dist/`, `main.py`, `package.json`, `plugin.json` à l'intérieur — pas les fichiers en vrac à la racine du zip).
2. Transfère le zip sur le Deck.
3. Decky Loader → **Developer** → **Install Plugin from ZIP file**.

## Réglages (menu rapide `...` → Friends Activity Bubble)
- Position de la bulle (top-left / top-right / top-center)
- Offset horizontal / vertical
- Nombre max d'amis affichés

## Structure
```
.
├── main.py        # no-op, juste pour la structure Decky
├── dist/
│   └── index.js   # patch de route + composant bulle + settings panel
├── plugin.json
└── package.json
```
