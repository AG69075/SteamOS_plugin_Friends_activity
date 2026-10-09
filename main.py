import decky_plugin


class Plugin:
    """
    No backend logic needed: all friend-activity data is read directly from
    the same data object the Steam client already loaded for the app details
    page (SteamClient IPC / React tree), on the frontend side. This file only
    exists so Decky Loader accepts the plugin folder structure.
    """

    async def _main(self) -> None:
        decky_plugin.logger.info("SteamOS_Friends_activity backend loaded (no-op).")

    async def _unload(self) -> None:
        pass
