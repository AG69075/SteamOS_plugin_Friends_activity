// Decky Loader will pass this api in, it's versioned to allow for backwards compatibility.
// @ts-ignore

const manifest = { "name": "friends-activity-bubble" };
const API_VERSION = 2;
const internalAPIConnection = window.__DECKY_SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED_deckyLoaderAPIInit;
if (!internalAPIConnection) {
    throw new Error('[@decky/api]: Failed to connect to the loader as the loader API was not initialized. This is likely a bug in Decky Loader.');
}
let api;
try {
    api = internalAPIConnection.connect(API_VERSION, manifest.name);
}
catch {
    api = internalAPIConnection.connect(1, manifest.name);
    console.warn(`[@decky/api] Requested API version ${API_VERSION} but the running loader only supports version 1. Some features may not work.`);
}
if (api._version != API_VERSION) {
    console.warn(`[@decky/api] Requested API version ${API_VERSION} but the running loader only supports version ${api._version}. Some features may not work.`);
}
const routerHook = api.routerHook;

// ─── Icon ──────────────────────────────────────────────────────────────────

function FriendsIcon(props) {
    const size = props.size || 20;
    return SP_REACT.createElement("svg", {
        "aria-hidden": "true", viewBox: "0 0 24 24", focusable: "false",
        style: { width: size, height: size, display: 'block', flexShrink: 0, ...(props.style || {}) }
    },
        SP_REACT.createElement("circle", { cx: "8.5", cy: "8", r: "3.2", fill: "#67c1f5" }),
        SP_REACT.createElement("circle", { cx: "16", cy: "9.5", r: "2.6", fill: "#417a9b" }),
        SP_REACT.createElement("path", { d: "M2 20 Q2 13.5 8.5 13.5 Q15 13.5 15 20 Z", fill: "#67c1f5" }),
        SP_REACT.createElement("path", { d: "M13.5 20 Q13.5 15 18.5 15 Q22.5 15 22.5 20 Z", fill: "#417a9b" })
    );
}

// ─── Settings (position/offset, persisted) ─────────────────────────────────

const STORAGE_KEY = 'friends-activity-bubble.settings';
const POSITION_OPTIONS = [
    { value: 'top-right', label: 'Top right' },
    { value: 'top-left', label: 'Top left' },
    { value: 'top-center', label: 'Top center' }
];
const defaultSettings = {
    position: 'top-left',
    horizontalOffset: 0,
    verticalOffset: 40,
    maxFriends: 4,
};
const readSettings = () => {
    if (typeof localStorage === 'undefined') return defaultSettings;
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return defaultSettings;
        return { ...defaultSettings, ...JSON.parse(raw) };
    } catch (_error) {
        return defaultSettings;
    }
};

let _globalSettings = readSettings();
const _listeners = new Set();
const _notifyListeners = () => { _listeners.forEach(fn => fn(_globalSettings)); };
const _setGlobal = (partial) => {
    _globalSettings = { ..._globalSettings, ...partial };
    if (typeof localStorage !== 'undefined') {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(_globalSettings));
    }
    _notifyListeners();
};

const useSettings = () => {
    const [settings, setSettings] = SP_REACT.useState(_globalSettings);
    SP_REACT.useEffect(() => {
        const handler = (s) => setSettings({ ...s });
        _listeners.add(handler);
        setSettings({ ..._globalSettings });
        return () => { _listeners.delete(handler); };
    }, []);
    const setPartialSetting = SP_REACT.useCallback((partial) => { _setGlobal(partial); }, []);
    return { settings, setSetting: setPartialSetting };
};

// ─── Settings Panel (Quick Access Menu) ────────────────────────────────────

const SettingsPanel = () => {
    const { settings, setSetting } = useSettings();
    const posIdx = POSITION_OPTIONS.findIndex(o => o.value === settings.position);
    return (SP_REACT.createElement(DFL.PanelSection, { title: "Friends Activity Bubble" },
        SP_REACT.createElement(DFL.PanelSectionRow, null,
            SP_REACT.createElement(DFL.Field, { label: "Bubble position" },
                SP_REACT.createElement(DFL.ButtonItem, {
                    layout: "below",
                    onClick: () => {
                        const next = POSITION_OPTIONS[(posIdx + 1) % POSITION_OPTIONS.length];
                        setSetting({ position: next.value });
                    }
                }, POSITION_OPTIONS[posIdx]?.label ?? settings.position))),
        SP_REACT.createElement(DFL.PanelSectionRow, null,
            SP_REACT.createElement(DFL.SliderField, {
                label: "Horizontal offset (- left / + right)", value: settings.horizontalOffset,
                min: -300, max: 300, step: 4,
                onChange: (val) => setSetting({ horizontalOffset: val })
            })),
        SP_REACT.createElement(DFL.PanelSectionRow, null,
            SP_REACT.createElement(DFL.SliderField, {
                label: "Vertical offset", value: settings.verticalOffset,
                min: 0, max: 900, step: 8,
                onChange: (val) => setSetting({ verticalOffset: val })
            })),
        SP_REACT.createElement(DFL.PanelSectionRow, null,
            SP_REACT.createElement(DFL.SliderField, {
                label: "Max friends shown", value: settings.maxFriends,
                min: 1, max: 8, step: 1,
                onChange: (val) => setSetting({ maxFriends: val })
            }))
    ));
};

// ─── Route params ──────────────────────────────────────────────────────────

const useParams = Object.values(DFL.ReactRouter).find((val) => /return (\w)\?\1\.params:{}/.test(`${val}`));

// ─── Friend-activity data ───────────────────────────────────────────────────
//
// Confirmed on real hardware (CEF devtools console):
//   1. window.SteamClient.Apps.GetFriendsWhoPlay(appid) -> Promise<string[]>
//      (array of SteamID64 strings, same list as the native "Friends who
//      played this game" widget under the Activity tab)
//   2. SteamID64 -> accountid (32-bit) via BigInt(id64) & 0xFFFFFFFFn
//   3. window.friendStore.allFriends is an already-loaded array of friend
//      objects (mobx observables) keyed by m_unAccountID, each exposing
//      .display_name and .persona.avatar_url — no extra fetch/load needed,
//      it's already populated for your real friends list.

const steamId64ToAccountId = (id64) => {
    try {
        return Number(BigInt(id64) & 0xFFFFFFFFn);
    } catch (_err) {
        return undefined;
    }
};

const lookupFriend = (accountId) => {
    try {
        return window.friendStore?.allFriends?.find((f) => f.m_unAccountID === accountId);
    } catch (_err) {
        return undefined;
    }
};

const fetchFriendsWhoPlay = async (appid) => {
    if (!appid || !window.SteamClient?.Apps?.GetFriendsWhoPlay) return [];
    let ids;
    try {
        ids = await window.SteamClient.Apps.GetFriendsWhoPlay(appid);
    } catch (err) {
        console.error('[friends-activity-bubble] GetFriendsWhoPlay failed:', err);
        return [];
    }
    if (!Array.isArray(ids)) return [];

    return ids.map((id64) => {
        const accountId = steamId64ToAccountId(id64);
        const friend = accountId !== undefined ? lookupFriend(accountId) : undefined;
        return {
            id: id64,
            name: friend?.display_name || 'Friend',
            avatar: friend?.persona?.avatar_url,
        };
    });
};

const useFriendsWhoPlay = (appid) => {
    const [friends, setFriends] = SP_REACT.useState([]);
    SP_REACT.useEffect(() => {
        let cancelled = false;
        if (!appid) { setFriends([]); return; }
        fetchFriendsWhoPlay(appid).then((list) => {
            if (!cancelled) {
                console.log(`[friends-activity-bubble] friends who play appid ${appid}:`, list);
                setFriends(list);
            }
        });
        return () => { cancelled = true; };
    }, [appid]);
    return friends;
};

// ─── CSS ────────────────────────────────────────────────────────────────────

const bubbleStyle = (SP_REACT.createElement("style", null, `
    .fab-bubble-root {
      position: absolute;
      z-index: 2;
      --fab-offset-x: 24px;
      --fab-offset-y: 56px;
    }
    .fab-bubble-root[data-position='top-right'] { top: var(--fab-offset-y); right: var(--fab-offset-x); }
    .fab-bubble-root[data-position='top-left'] { top: var(--fab-offset-y); left: var(--fab-offset-x); }
    .fab-bubble-root[data-position='top-center'] { top: var(--fab-offset-y); left: 50%; transform: translateX(calc(-50% + var(--fab-offset-x))); }

    .fab-card {
      width: 190px;
      background: rgba(0,0,0,0.55);
      backdrop-filter: blur(6px);
      border: 1px solid rgba(255,255,255,0.12);
      border-radius: 6px;
      padding: 8px 10px;
      display: flex;
      flex-direction: column;
      gap: 6px;
      color: #f5f5f5;
      font-family: var(--font-family, "Motiva Sans");
      box-shadow: 0 2px 10px rgba(0,0,0,0.4);
    }
    .fab-label-row { display: flex; align-items: center; gap: 6px; }
    .fab-label { font-size: 11px; line-height: 1; font-weight: 700; letter-spacing: 0.06em; color: rgba(255,255,255,0.65); text-transform: uppercase; }
    .fab-list { display: flex; flex-direction: column; gap: 5px; }
    .fab-row { display: flex; align-items: center; gap: 6px; }
    .fab-avatar { width: 20px; height: 20px; border-radius: 3px; background: #2a475e; flex-shrink: 0; object-fit: cover; }
    .fab-avatar-fallback { width: 20px; height: 20px; border-radius: 3px; background: #2a475e; flex-shrink: 0; display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 700; color: #67c1f5; }
    .fab-name { font-size: 13px; line-height: 1.1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .fab-more { font-size: 11px; color: rgba(255,255,255,0.55); padding-left: 26px; }
`));

// ─── Hide once scrolled into the native Activity/Community section ────────

const useScrolledDown = (rootRef) => {
    const [scrolled, setScrolled] = SP_REACT.useState(false);
    SP_REACT.useEffect(() => {
        const findScrollableAncestor = (el) => {
            let node = el?.parentElement;
            while (node && node !== document.body && node !== document.documentElement) {
                try {
                    const style = window.getComputedStyle(node);
                    if ((style.overflowY === 'auto' || style.overflowY === 'scroll') && node.scrollHeight > node.clientHeight + 4) {
                        return node;
                    }
                } catch (_err) { /* ignore */ }
                node = node.parentElement;
            }
            return null;
        };

        let target = null;
        const getScrollTop = () => {
            const winTop = window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0;
            const targetTop = target ? target.scrollTop : 0;
            return Math.max(winTop, targetTop);
        };
        const onScroll = () => setScrolled(getScrollTop() > 40);

        target = rootRef.current ? findScrollableAncestor(rootRef.current) : null;
        window.addEventListener('scroll', onScroll, { passive: true });
        document.addEventListener('scroll', onScroll, { passive: true, capture: true });
        if (target) target.addEventListener('scroll', onScroll, { passive: true });
        onScroll();

        return () => {
            window.removeEventListener('scroll', onScroll);
            document.removeEventListener('scroll', onScroll, { capture: true });
            if (target) target.removeEventListener('scroll', onScroll);
        };
    }, [rootRef]);
    return scrolled;
};

// ─── Bubble Component ───────────────────────────────────────────────────────

const FriendsActivityBubble = () => {
    const { appid } = useParams();
    const numericAppid = appid ? parseInt(appid, 10) : undefined;
    const friends = useFriendsWhoPlay(Number.isNaN(numericAppid) ? undefined : numericAppid);
    const { settings } = useSettings();
    const { position, horizontalOffset, verticalOffset, maxFriends } = settings;
    const rootRef = SP_REACT.useRef(null);
    const scrolledDown = useScrolledDown(rootRef);

    if (!numericAppid) return SP_REACT.createElement(SP_REACT.Fragment, null);
    if (scrolledDown) return SP_REACT.createElement(SP_REACT.Fragment, null);
    if (friends.length === 0) return SP_REACT.createElement(SP_REACT.Fragment, null);

    const shown = friends.slice(0, maxFriends);
    const extra = friends.length - shown.length;

    return (SP_REACT.createElement("div", {
        ref: rootRef,
        id: "friends-activity-bubble-container",
        className: "fab-bubble-root",
        "data-position": position,
        style: {
            '--fab-offset-x': `${horizontalOffset || 0}px`,
            '--fab-offset-y': `${verticalOffset || 0}px`
        }
    },
        bubbleStyle,
        SP_REACT.createElement("div", { className: "fab-card" },
            SP_REACT.createElement("div", { className: "fab-label-row" },
                SP_REACT.createElement(FriendsIcon, { size: 14 }),
                SP_REACT.createElement("span", { className: "fab-label" }, "Friends who played")),
            SP_REACT.createElement("div", { className: "fab-list" },
                shown.map((f, i) => SP_REACT.createElement("div", { className: "fab-row", key: `${f.id}-${i}` },
                    f.avatar
                        ? SP_REACT.createElement("img", { className: "fab-avatar", src: f.avatar })
                        : SP_REACT.createElement("div", { className: "fab-avatar-fallback" }, (f.name[0] || '?').toUpperCase()),
                    SP_REACT.createElement("span", { className: "fab-name" }, f.name)))),
            extra > 0 ? SP_REACT.createElement("div", { className: "fab-more" }, `+${extra} more`) : null)));
};

// ─── Error boundary ─────────────────────────────────────────────────────────

class FriendsActivityErrorBoundary extends SP_REACT.Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false };
    }
    static getDerivedStateFromError() {
        return { hasError: true };
    }
    componentDidCatch(err) {
        console.error('[friends-activity-bubble] bubble crashed, disabling for this session:', err);
    }
    render() {
        if (this.state.hasError) return null;
        return this.props.children;
    }
}

// ─── Route Patch ────────────────────────────────────────────────────────────

function patchLibraryApp() {
    return routerHook.addPatch('/library/app/:appid', (tree) => {
        let routeProps;
        try {
            routeProps = DFL.findInReactTree(tree, (x) => x?.renderFunc);
        } catch (err) {
            console.error('[friends-activity-bubble] findInReactTree(routeProps) failed:', err);
            return tree;
        }
        if (!routeProps) {
            console.warn('[friends-activity-bubble] routeProps (renderFunc) not found — route shape may have changed.');
            return tree;
        }

        const patchHandler = DFL.createReactTreePatcher([
            (root) => {
                try {
                    const node = DFL.findInReactTree(root, (n) => n?.props?.children?.props?.overview);
                    if (!node) console.warn('[friends-activity-bubble] "overview" anchor node not found in tree.');
                    return node?.props?.children;
                } catch (err) {
                    console.error('[friends-activity-bubble] node lookup failed:', err);
                    return undefined;
                }
            }
        ], (_nodes, ret) => {
            try {
                const container = DFL.findInReactTree(ret, (element) =>
                    Array.isArray(element?.props?.children) &&
                    typeof element?.props?.className === 'string' &&
                    element.props.className.includes(DFL.appDetailsClasses?.InnerContainer ?? '\u0000__never__')
                );
                if (!container) {
                    console.warn('[friends-activity-bubble] InnerContainer not found — DFL.appDetailsClasses.InnerContainer =', DFL.appDetailsClasses?.InnerContainer);
                    return ret;
                }

                const hasBubble = container.props.children.some(
                    (child) => child?.props?.id === 'friends-activity-bubble-container'
                );
                if (!hasBubble) {
                    const nextChildren = container.props.children.slice();
                    nextChildren.splice(1, 0,
                        SP_REACT.createElement(FriendsActivityErrorBoundary, { key: "friends-activity-bubble" },
                            SP_REACT.createElement(FriendsActivityBubble, null))
                    );
                    container.props.children = nextChildren;
                }
                return ret;
            } catch (err) {
                console.error('[friends-activity-bubble] patch render failed, skipping bubble:', err);
                return ret;
            }
        });

        DFL.afterPatch(routeProps, 'renderFunc', patchHandler);
        return tree;
    });
}

// ─── Plugin Entry ───────────────────────────────────────────────────────────

var index = DFL.definePlugin(() => {
    const libraryPatch = patchLibraryApp();
    return {
        title: SP_REACT.createElement("div", { className: DFL.staticClasses.Title }, "Friends Activity Bubble"),
        icon: SP_REACT.createElement(FriendsIcon, null),
        content: SP_REACT.createElement(FriendsActivityErrorBoundary, null, SP_REACT.createElement(SettingsPanel, null)),
        onDismount() {
            routerHook.removePatch('/library/app/:appid', libraryPatch);
        }
    };
});

export default index;
