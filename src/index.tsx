import { definePlugin, routerHook } from "@decky/api";
import {
  PanelSection,
  PanelSectionRow,
  ButtonItem,
  Field,
  SliderField,
  staticClasses,
  appDetailsClasses,
  findInReactTree,
  createReactTreePatcher,
  afterPatch,
  useParams,
} from "@decky/ui";
import {
  FC,
  Component,
  ReactNode,
  useState,
  useEffect,
  useRef,
  useReducer,
  useCallback,
  createElement,
} from "react";

// ─── Icon ──────────────────────────────────────────────────────────────────

const FriendsIcon: FC<{ size?: number; style?: React.CSSProperties }> = ({ size = 20, style }) =>
  createElement(
    "svg",
    {
      "aria-hidden": "true",
      viewBox: "0 0 24 24",
      focusable: "false",
      style: { width: size, height: size, display: "block", flexShrink: 0, ...style },
    },
    createElement("circle", { cx: "8.5", cy: "8", r: "3.2", fill: "#67c1f5" }),
    createElement("circle", { cx: "16", cy: "9.5", r: "2.6", fill: "#417a9b" }),
    createElement("path", { d: "M2 20 Q2 13.5 8.5 13.5 Q15 13.5 15 20 Z", fill: "#67c1f5" }),
    createElement("path", { d: "M13.5 20 Q13.5 15 18.5 15 Q22.5 15 22.5 20 Z", fill: "#417a9b" }),
  );

// ─── Settings (position/offset, persisted in localStorage) ─────────────────

type Position =
  | "top-right"
  | "top-left"
  | "top-center"
  | "bottom-right"
  | "bottom-left"
  | "bottom-center";

interface Settings {
  position: Position;
  horizontalOffset: number;
  verticalOffset: number;
  maxFriends: number;
}

const POSITION_OPTIONS: { value: Position; label: string }[] = [
  { value: "top-right", label: "Top right" },
  { value: "top-left", label: "Top left" },
  { value: "top-center", label: "Top center" },
  { value: "bottom-right", label: "Bottom right" },
  { value: "bottom-left", label: "Bottom left" },
  { value: "bottom-center", label: "Bottom center" },
];

const STORAGE_KEY = "friends-activity-bubble.settings";

const defaultSettings: Settings = {
  position: "top-left",
  horizontalOffset: 0,
  verticalOffset: 40,
  maxFriends: 4,
};

const readSettings = (): Settings => {
  if (typeof localStorage === "undefined") return defaultSettings;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultSettings;
    return { ...defaultSettings, ...JSON.parse(raw) };
  } catch (_error) {
    return defaultSettings;
  }
};

let _globalSettings: Settings = readSettings();
const _listeners = new Set<(s: Settings) => void>();
const _notifyListeners = () => {
  _listeners.forEach((fn) => fn(_globalSettings));
};
const _setGlobal = (partial: Partial<Settings>) => {
  _globalSettings = { ..._globalSettings, ...partial };
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(_globalSettings));
  }
  _notifyListeners();
};

const useSettings = () => {
  const [settings, setSettings] = useState<Settings>(_globalSettings);
  useEffect(() => {
    const handler = (s: Settings) => setSettings({ ...s });
    _listeners.add(handler);
    setSettings({ ..._globalSettings });
    return () => {
      _listeners.delete(handler);
    };
  }, []);
  const setSetting = useCallback((partial: Partial<Settings>) => {
    _setGlobal(partial);
  }, []);
  return { settings, setSetting };
};

// ─── Settings Panel (Quick Access Menu) ────────────────────────────────────

const SettingsPanel: FC = () => {
  const { settings, setSetting } = useSettings();
  const posIdx = POSITION_OPTIONS.findIndex((o) => o.value === settings.position);

  return (
    <PanelSection title="Friends Activity Bubble">
      <PanelSectionRow>
        <Field label="Bubble position">
          <ButtonItem
            layout="below"
            onClick={() => {
              const next = POSITION_OPTIONS[(posIdx + 1) % POSITION_OPTIONS.length];
              setSetting({ position: next.value });
            }}
          >
            {POSITION_OPTIONS[posIdx]?.label ?? settings.position}
          </ButtonItem>
        </Field>
      </PanelSectionRow>
      <PanelSectionRow>
        <SliderField
          label="Horizontal offset (- left / + right)"
          value={settings.horizontalOffset}
          min={-300}
          max={300}
          step={4}
          showValue
          onChange={(val: number) => setSetting({ horizontalOffset: val })}
        />
      </PanelSectionRow>
      <PanelSectionRow>
        <SliderField
          label="Vertical offset"
          value={settings.verticalOffset}
          min={0}
          max={900}
          step={8}
          showValue
          onChange={(val: number) => setSetting({ verticalOffset: val })}
        />
      </PanelSectionRow>
      <PanelSectionRow>
        <SliderField
          label="Max friends shown"
          value={settings.maxFriends}
          min={1}
          max={14}
          step={1}
          showValue
          editableValue
          notchCount={14}
          notchTicksVisible
          onChange={(val: number) => setSetting({ maxFriends: val })}
        />
      </PanelSectionRow>
    </PanelSection>
  );
};

// ─── Friend-activity data ───────────────────────────────────────────────────
//
// Confirmed on real hardware (CEF devtools console):
//   1. window.SteamClient.Apps.GetFriendsWhoPlay(appid) -> Promise<string[]>
//      (array of SteamID64 strings — friends who've actually played the
//      game, same list as the native "Friends who played this game" widget
//      under the Activity tab. Owning-but-never-launched friends are NOT
//      included.)
//   2. SteamID64 -> accountid (32-bit) via BigInt(id64) & 0xFFFFFFFFn
//   3. window.friendStore.allFriends is an already-loaded array of friend
//      objects (mobx observables) keyed by m_unAccountID, each exposing
//      .display_name and .persona.avatar_url — no extra fetch/load needed,
//      it's already populated for your real friends list.

interface FriendEntry {
  id: string;
  name: string;
  avatar?: string;
}

declare global {
  interface Window {
    SteamClient: any;
    friendStore: any;
  }
}

const steamId64ToAccountId = (id64: string): number | undefined => {
  try {
    return Number(BigInt(id64) & 0xffffffffn);
  } catch (_err) {
    return undefined;
  }
};

const lookupFriend = (accountId: number): any => {
  try {
    return window.friendStore?.allFriends?.find((f: any) => f.m_unAccountID === accountId);
  } catch (_err) {
    return undefined;
  }
};

const fetchFriendsWhoPlay = async (appid: number): Promise<FriendEntry[]> => {
  if (!appid || !window.SteamClient?.Apps?.GetFriendsWhoPlay) return [];
  let ids: string[];
  try {
    ids = await window.SteamClient.Apps.GetFriendsWhoPlay(appid);
  } catch (err) {
    console.error("[friends-activity-bubble] GetFriendsWhoPlay failed:", err);
    return [];
  }
  if (!Array.isArray(ids)) return [];

  return ids.map((id64) => {
    const accountId = steamId64ToAccountId(id64);
    const friend = accountId !== undefined ? lookupFriend(accountId) : undefined;
    return {
      id: id64,
      name: friend?.display_name || "Friend",
      avatar: friend?.persona?.avatar_url,
    };
  });
};

const useFriendsWhoPlay = (appid?: number): FriendEntry[] => {
  const [friends, setFriends] = useState<FriendEntry[]>([]);
  useEffect(() => {
    let cancelled = false;
    if (!appid) {
      setFriends([]);
      return;
    }
    fetchFriendsWhoPlay(appid).then((list) => {
      if (!cancelled) {
        console.log(`[friends-activity-bubble] friends who play appid ${appid}:`, list);
        setFriends(list);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [appid]);
  return friends;
};

// ─── Game-launch hiding (confirmed pattern, shared with steam-achievements) ─
//
// Registered once at plugin mount (see definePlugin below), never inside a
// per-instance component, since components remount frequently via route
// patches and would otherwise miss events. A safety timeout auto-clears
// state in case GameActionEnd never fires (observed on some SteamOS
// versions).

let _launchingAppid: number | undefined = undefined;
const _launchListeners = new Set<() => void>();
const _notifyLaunchListeners = () => {
  _launchListeners.forEach((fn) => fn());
};
let _launchSafetyTimeout: ReturnType<typeof setTimeout> | null = null;

const _setLaunchingAppid = (appid: number | undefined) => {
  _launchingAppid = appid;
  _notifyLaunchListeners();
  if (_launchSafetyTimeout) clearTimeout(_launchSafetyTimeout);
  if (appid !== undefined) {
    _launchSafetyTimeout = setTimeout(() => {
      console.warn("[friends-activity-bubble] launch safety timeout hit, clearing launching state.");
      _setLaunchingAppid(undefined);
    }, 20000);
  }
};

const useIsGameLaunching = (appid?: number): boolean => {
  const [, forceRender] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    const handler = () => forceRender();
    _launchListeners.add(handler);
    return () => {
      _launchListeners.delete(handler);
    };
  }, []);
  return appid !== undefined && _launchingAppid === appid;
};

function registerGameLaunchTracking() {
  let unregisterActionStart: { unregister?: () => void } | undefined;
  let unregisterActionEnd: { unregister?: () => void } | undefined;
  let unregisterLifetime: { unregister?: () => void } | undefined;

  try {
    unregisterActionStart = window.SteamClient?.Apps?.RegisterForGameActionStart?.(
      (_actionType: number, strAppId: string, actionName: string) => {
        if (actionName === "LaunchApp") {
          _setLaunchingAppid(parseInt(strAppId, 10));
        }
      },
    );
  } catch (err) {
    console.error("[friends-activity-bubble] RegisterForGameActionStart failed:", err);
  }

  try {
    unregisterActionEnd = window.SteamClient?.Apps?.RegisterForGameActionEnd?.(() => {
      // strAppId/actionName can come back undefined on some SteamOS
      // versions — clear unconditionally, matching steam-achievements.
      _setLaunchingAppid(undefined);
    });
  } catch (err) {
    console.error("[friends-activity-bubble] RegisterForGameActionEnd failed:", err);
  }

  try {
    unregisterLifetime = window.SteamClient?.GameSessions?.RegisterForAppLifetimeNotifications?.(
      (update: { bRunning?: boolean; unAppID?: number }) => {
        if (update?.bRunning === true && update?.unAppID === _launchingAppid) {
          _setLaunchingAppid(undefined);
        }
      },
    );
  } catch (err) {
    console.error("[friends-activity-bubble] RegisterForAppLifetimeNotifications failed:", err);
  }

  return () => {
    try {
      unregisterActionStart?.unregister?.();
    } catch (_err) {
      /* ignore */
    }
    try {
      unregisterActionEnd?.unregister?.();
    } catch (_err) {
      /* ignore */
    }
    try {
      unregisterLifetime?.unregister?.();
    } catch (_err) {
      /* ignore */
    }
    if (_launchSafetyTimeout) clearTimeout(_launchSafetyTimeout);
  };
}

// ─── Hide once scrolled into the native Activity/Community section ────────
// (Avoids duplicating Steam's own native "Friends who played" widget when
// not using Clean GameView and the Activity tab is visible below the fold.)

const useScrolledDown = (rootRef: React.RefObject<HTMLElement>): boolean => {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const findScrollableAncestor = (el: HTMLElement | null): HTMLElement | null => {
      let node = el?.parentElement ?? null;
      while (node && node !== document.body && node !== document.documentElement) {
        try {
          const style = window.getComputedStyle(node);
          if (
            (style.overflowY === "auto" || style.overflowY === "scroll") &&
            node.scrollHeight > node.clientHeight + 4
          ) {
            return node;
          }
        } catch (_err) {
          /* ignore */
        }
        node = node.parentElement;
      }
      return null;
    };

    let target: HTMLElement | null = null;
    const getScrollTop = () => {
      const winTop = window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0;
      const targetTop = target ? target.scrollTop : 0;
      return Math.max(winTop, targetTop);
    };
    const onScroll = () => setScrolled(getScrollTop() > 40);

    target = rootRef.current ? findScrollableAncestor(rootRef.current) : null;
    window.addEventListener("scroll", onScroll, { passive: true });
    document.addEventListener("scroll", onScroll, { passive: true, capture: true });
    if (target) target.addEventListener("scroll", onScroll, { passive: true });
    onScroll();

    return () => {
      window.removeEventListener("scroll", onScroll);
      document.removeEventListener("scroll", onScroll, { capture: true });
      if (target) target.removeEventListener("scroll", onScroll);
    };
  }, [rootRef]);
  return scrolled;
};

// ─── CSS ────────────────────────────────────────────────────────────────────

const BubbleStyle: FC = () => (
  <style>{`
    .fab-bubble-root {
      position: absolute;
      z-index: 2;
      --fab-offset-x: 24px;
      --fab-offset-y: 56px;
    }
    .fab-bubble-root[data-position='top-right'] { top: var(--fab-offset-y); right: var(--fab-offset-x); }
    .fab-bubble-root[data-position='top-left'] { top: var(--fab-offset-y); left: var(--fab-offset-x); }
    .fab-bubble-root[data-position='top-center'] { top: var(--fab-offset-y); left: 50%; transform: translateX(calc(-50% + var(--fab-offset-x))); }
    .fab-bubble-root[data-position='bottom-right'] { bottom: var(--fab-offset-y); right: var(--fab-offset-x); }
    .fab-bubble-root[data-position='bottom-left'] { bottom: var(--fab-offset-y); left: var(--fab-offset-x); }
    .fab-bubble-root[data-position='bottom-center'] { bottom: var(--fab-offset-y); left: 50%; transform: translateX(calc(-50% + var(--fab-offset-x))); }

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
  `}</style>
);

// ─── Bubble Component ───────────────────────────────────────────────────────

const FriendsActivityBubble: FC = () => {
  const { appid } = useParams<{ appid: string }>();
  const numericAppid = appid ? parseInt(appid, 10) : undefined;
  const friends = useFriendsWhoPlay(numericAppid !== undefined && !Number.isNaN(numericAppid) ? numericAppid : undefined);
  const { settings } = useSettings();
  const { position, horizontalOffset, verticalOffset, maxFriends } = settings;
  const rootRef = useRef<HTMLDivElement>(null);
  const scrolledDown = useScrolledDown(rootRef);
  const isLaunching = useIsGameLaunching(numericAppid);

  if (!numericAppid) return null;
  if (isLaunching) return null;
  if (scrolledDown) return null;
  if (friends.length === 0) return null;

  const shown = friends.slice(0, maxFriends);
  const extra = friends.length - shown.length;

  return (
    <div
      ref={rootRef}
      id="friends-activity-bubble-container"
      className="fab-bubble-root"
      data-position={position}
      style={
        {
          "--fab-offset-x": `${horizontalOffset || 0}px`,
          "--fab-offset-y": `${verticalOffset || 0}px`,
        } as React.CSSProperties
      }
    >
      <BubbleStyle />
      <div className="fab-card">
        <div className="fab-label-row">
          <FriendsIcon size={14} />
          <span className="fab-label">Friends who played</span>
        </div>
        <div className="fab-list">
          {shown.map((f, i) => (
            <div className="fab-row" key={`${f.id}-${i}`}>
              {f.avatar ? (
                <img className="fab-avatar" src={f.avatar} />
              ) : (
                <div className="fab-avatar-fallback">{(f.name[0] || "?").toUpperCase()}</div>
              )}
              <span className="fab-name">{f.name}</span>
            </div>
          ))}
        </div>
        {extra > 0 ? <div className="fab-more">{`+${extra} more`}</div> : null}
      </div>
    </div>
  );
};

// ─── Error boundary ─────────────────────────────────────────────────────────

class FriendsActivityErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(err: unknown) {
    console.error("[friends-activity-bubble] bubble crashed, disabling for this session:", err);
  }
  render() {
    if (this.state.hasError) return null;
    return this.props.children;
  }
}

// ─── Route Patch ────────────────────────────────────────────────────────────

function patchLibraryApp() {
  return routerHook.addPatch("/library/app/:appid", (tree: any) => {
    let routeProps: any;
    try {
      routeProps = findInReactTree(tree, (x: any) => x?.renderFunc);
    } catch (err) {
      console.error("[friends-activity-bubble] findInReactTree(routeProps) failed:", err);
      return tree;
    }
    if (!routeProps) {
      console.warn("[friends-activity-bubble] routeProps (renderFunc) not found — route shape may have changed.");
      return tree;
    }

    const patchHandler = createReactTreePatcher(
      [
        (root: any) => {
          try {
            const node = findInReactTree(root, (n: any) => n?.props?.children?.props?.overview);
            if (!node) console.warn('[friends-activity-bubble] "overview" anchor node not found in tree.');
            return node?.props?.children;
          } catch (err) {
            console.error("[friends-activity-bubble] node lookup failed:", err);
            return undefined;
          }
        },
      ],
      (_nodes: any[], ret: any) => {
        try {
          const container = findInReactTree(
            ret,
            (element: any) =>
              Array.isArray(element?.props?.children) &&
              typeof element?.props?.className === "string" &&
              element.props.className.includes(appDetailsClasses?.InnerContainer ?? "\u0000__never__"),
          );
          if (!container) {
            console.warn(
              "[friends-activity-bubble] InnerContainer not found — appDetailsClasses.InnerContainer =",
              appDetailsClasses?.InnerContainer,
            );
            return ret;
          }

          const hasBubble = container.props.children.some(
            (child: any) => child?.props?.id === "friends-activity-bubble-container",
          );
          if (!hasBubble) {
            const nextChildren = container.props.children.slice();
            nextChildren.splice(
              1,
              0,
              <FriendsActivityErrorBoundary key="friends-activity-bubble">
                <FriendsActivityBubble />
              </FriendsActivityErrorBoundary>,
            );
            container.props.children = nextChildren;
          }
          return ret;
        } catch (err) {
          console.error("[friends-activity-bubble] patch render failed, skipping bubble:", err);
          return ret;
        }
      },
    );

    afterPatch(routeProps, "renderFunc", patchHandler);
    return tree;
  });
}

// ─── Plugin Entry ───────────────────────────────────────────────────────────

export default definePlugin(() => {
  const libraryPatch = patchLibraryApp();
  const unregisterLaunchTracking = registerGameLaunchTracking();

  return {
    name: "Friends Activity Bubble",
    titleView: <div className={staticClasses.Title}>Friends Activity Bubble</div>,
    icon: <FriendsIcon />,
    content: (
      <FriendsActivityErrorBoundary>
        <SettingsPanel />
      </FriendsActivityErrorBoundary>
    ),
    onDismount() {
      routerHook.removePatch("/library/app/:appid", libraryPatch);
      unregisterLaunchTracking();
    },
  };
});
