import asyncio
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request

import decky_plugin

CACHE_TTL_SECONDS = 30 * 60
MAX_CANDIDATES = 250
MAX_CONCURRENCY = 8
REQUEST_TIMEOUT = 8

VALIDATE_URL = "https://api.steampowered.com/ISteamWebAPIUtil/GetSupportedAPIList/v1/"
ACHIEVEMENTS_URL = "https://api.steampowered.com/ISteamUserStats/GetPlayerAchievements/v0001/"


class Plugin:
    """
    Frontend reads the "Friends who played" list from the Steam client. This
    backend adds a second source for friends whose playtime is private: it
    queries the Steam Web API for their achievements on the game (works when
    their game details are visible to us) and reports those who unlocked any.
    The API key is entered by the user in the plugin panel and stored only in
    the plugin settings dir; it is never logged or sent anywhere but Steam.
    """

    async def _main(self) -> None:
        self._cache = {}  # (appid, steamid) -> (timestamp, has_achievements)
        self._settings_path = os.path.join(decky_plugin.DECKY_PLUGIN_SETTINGS_DIR, "settings.json")
        decky_plugin.logger.info("SteamOS_Friends_activity backend loaded.")

    async def _unload(self) -> None:
        pass

    # ── settings ────────────────────────────────────────────────────────────

    def _read_key(self) -> str:
        try:
            with open(self._settings_path, "r", encoding="utf-8") as f:
                return str(json.load(f).get("steam_api_key", "")).strip()
        except (OSError, ValueError):
            return ""

    async def has_api_key(self) -> bool:
        return bool(self._read_key())

    def _validate_key(self, key: str) -> str:
        """'valid', 'invalid' (Steam rejected it) or 'unreachable' (couldn't ask)."""
        params = urllib.parse.urlencode({"key": key})
        try:
            with urllib.request.urlopen(f"{VALIDATE_URL}?{params}", timeout=REQUEST_TIMEOUT) as resp:
                return "valid" if resp.status == 200 else "unreachable"
        except urllib.error.HTTPError as err:
            return "invalid" if err.code in (401, 403) else "unreachable"
        except Exception as err:  # noqa: BLE001
            decky_plugin.logger.warning(f"key validation failed: {type(err).__name__}")
            return "unreachable"

    async def set_api_key(self, key: str) -> str:
        """Returns 'valid', 'unverified' (saved, Steam unreachable), 'invalid' (not saved) or 'empty'."""
        key = (key or "").strip()
        if not key:
            return "empty"
        verdict = await asyncio.to_thread(self._validate_key, key)
        if verdict == "invalid":
            return "invalid"
        os.makedirs(os.path.dirname(self._settings_path), exist_ok=True)
        with open(self._settings_path, "w", encoding="utf-8") as f:
            json.dump({"steam_api_key": key}, f)
        try:
            os.chmod(self._settings_path, 0o600)
        except OSError:
            pass
        self._cache.clear()
        return "valid" if verdict == "valid" else "unverified"

    # ── achievements lookup ─────────────────────────────────────────────────

    def _query(self, key: str, appid: int, steamid: str):
        """True/False if readable, None if private/unavailable or request failed."""
        params = urllib.parse.urlencode({"appid": appid, "key": key, "steamid": steamid})
        try:
            with urllib.request.urlopen(f"{ACHIEVEMENTS_URL}?{params}", timeout=REQUEST_TIMEOUT) as resp:
                data = json.load(resp)
        except urllib.error.HTTPError as err:
            # 400/403 = private profile, no stats, or game not owned: not an error for us.
            if err.code in (400, 403, 500):
                return False
            decky_plugin.logger.warning(f"achievements HTTP {err.code} for appid {appid}")
            return None
        except Exception as err:  # noqa: BLE001 - network failure must not break the UI
            decky_plugin.logger.warning(f"achievements request failed: {type(err).__name__}")
            return None
        stats = data.get("playerstats", {})
        if not stats.get("success"):
            return False
        return any(a.get("achieved") == 1 for a in stats.get("achievements", []))

    async def get_friends_with_achievements(self, appid: int, steamids: list) -> list:
        key = self._read_key()
        if not key or not appid:
            return []

        now = time.time()
        sem = asyncio.Semaphore(MAX_CONCURRENCY)
        result = []

        async def check(steamid: str) -> None:
            cached = self._cache.get((appid, steamid))
            if cached and now - cached[0] < CACHE_TTL_SECONDS:
                if cached[1]:
                    result.append(steamid)
                return
            async with sem:
                found = await asyncio.to_thread(self._query, key, appid, steamid)
            if found is None:
                return
            self._cache[(appid, steamid)] = (time.time(), found)
            if found:
                result.append(steamid)

        await asyncio.gather(*(check(str(s)) for s in steamids[:MAX_CANDIDATES]))
        return result
