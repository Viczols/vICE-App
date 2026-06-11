import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Bell,
  ChevronDown,
  ChevronRight,
  UserRoundKey,
  Ellipsis,
  MessageCircle,
  Phone,
  Search,
  Settings,
  UserPlus,
  UserMinus,
  Ban,
  VolumeX,
  EarOff,
  PhoneOff,
  ArrowRightLeft,
  UserX,
  ShieldBan,
  Volume2,
  PanelRightClose,
} from "lucide-react";
import NotificationsModal from "../components/NotificationsModal";
import SettingsModal from "../components/SettingsModal";

type UserStatus = "online" | "idle" | "dnd" | "invisible" | "offline";

type PresenceUser = {
  userId: string;
  username?: string;
  displayName: string;
  avatarUrl?: string | null;
  status?: UserStatus;
  isOnline: boolean;
  activeVoiceChannelId: string | null;
  activeVoiceChannelName: string | null;
  serverMuted?: boolean;
  serverDeafened?: boolean;
  highestRoleColor?: string | null;
  highestRoleName?: string | null;
  roles?: Array<{
    id: string;
    name: string;
    color?: string | null;
    position?: number;
    isDefault?: boolean;
    isManaged?: boolean;
  }>;
};

type IncomingFriendRequest = {
  id: string;
  username: string;
  displayName: string;
  createdAt: string;
};

type IncomingServerInvite = {
  id: string;
  serverName: string;
  inviterDisplayName: string;
  createdAt: string;
};

type CurrentUser = {
  id: string;
  username?: string;
  displayName: string;
  role: string;
  avatarUrl?: string | null;
  status?: UserStatus;
};

type CurrentUserServer = {
  id: string;
  name: string;
};

type ServerChannel = {
  id: string;
  name: string;
  type: "text" | "voice";
  serverId?: string | null;
};

type ServerRole = {
  id: string;
  name: string;
  color?: string | null;
  position?: number;
  isDefault?: boolean;
  isManaged?: boolean;
};

type BlockedUser = {
  id: string;
  username?: string;
  displayName: string;
  avatarUrl?: string | null;
};

type UserBarProps = {
  width: number;
  onLogout: () => void;
  currentUser: CurrentUser;
  currentUserServers: CurrentUserServer[];
  blockedUserIds?: string[];
  blockedUsers?: BlockedUser[];
  onRefreshBlockedUsers?: () => Promise<void> | void;
  onUnblockUser?: (targetUserId: string) => Promise<void> | void;
  serverMembers: PresenceUser[];
  friends: PresenceUser[];
  incomingRequests: IncomingFriendRequest[];
  incomingServerInvites: IncomingServerInvite[];
  onSendFriendRequest: (username: string) => Promise<void> | void;
  onAcceptFriendRequest: (requesterUserId: string) => Promise<void> | void;
  onRejectFriendRequest: (requesterUserId: string) => Promise<void> | void;
  onAcceptServerInvite: (inviteId: string) => Promise<void> | void;
  onRejectServerInvite: (inviteId: string) => Promise<void> | void;
  isDMView: boolean;
  onStartDirectMessage: (targetUserId: string) => Promise<void> | void;
  onCallUser: (targetUserId: string) => Promise<void> | void;
  onRemoveFriend: (targetUserId: string) => Promise<void> | void;
  onBlockUser: (targetUserId: string) => Promise<void> | void;
  onInviteToServer: (targetUserId: string, serverId: string) => Promise<void> | void;
  selectedServerId?: string | null;
  serverChannels?: ServerChannel[];
  canManageRoles?: boolean;
  canKickMembers?: boolean;
  canBanMembers?: boolean;
  canMuteMembers?: boolean;
  canDeafenMembers?: boolean;
  canMoveMembers?: boolean;
  canDisconnectMembers?: boolean;
  onServerMembersChanged?: () => Promise<void> | void;
  onHideUserBar?: () => void;
  onUserUpdated?: (nextUser: CurrentUser) => void;
  onStatusChange?: (status: Exclude<UserStatus, "offline">) => Promise<void> | void;
};

type ActionMenuState = {
  userId: string;
  x: number;
  y: number;
} | null;

type InviteMenuState = {
  targetUserId: string;
  x: number;
  y: number;
} | null;

type RoleMenuState = {
  targetUserId: string;
  x: number;
  y: number;
} | null;

type MoveMenuState = {
  targetUserId: string;
  x: number;
  y: number;
} | null;

type StatusOption = {
  value: Exclude<UserStatus, "offline">;
  label: string;
  color: string;
};

const STATUS_OPTIONS: StatusOption[] = [
  { value: "online", label: "Online", color: "#3ba55d" },
  { value: "dnd", label: "Meşgul", color: "#ed4245" },
  { value: "idle", label: "Idle", color: "#faa61a" },
  { value: "invisible", label: "Gizli", color: "#747f8d" },
];

const ACTION_MENU_WIDTH = 272;
const ACTION_MENU_HEIGHT_ESTIMATE = 760;
const INVITE_MENU_WIDTH = 230;
const ROLE_MENU_WIDTH = 240;
const MOVE_MENU_WIDTH = 240;
const VIEWPORT_GAP = 12;

function normalizeRoleName(name?: string | null) {
  return String(name ?? "").trim().toLowerCase();
}

function shouldHideRoleFromQuickMenu(role?: { name?: string | null; isDefault?: boolean }) {
  const normalized = normalizeRoleName(role?.name);
  return normalized === "owner" || normalized === "member" || role?.isDefault === true;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(value, max));
}

function getPresenceStatus(user: {
  status?: UserStatus;
  isOnline?: boolean;
}): UserStatus {
  if (user.status === "invisible") return "offline";
  if (user.status && user.status !== "offline") {
    return user.isOnline === false ? "offline" : user.status;
  }
  return user.isOnline ? "online" : "offline";
}

function getStatusMeta(status: UserStatus | Exclude<UserStatus, "offline">) {
  switch (status) {
    case "online":
      return { label: "Online", color: "#3ba55d" };
    case "idle":
      return { label: "Idle", color: "#faa61a" };
    case "dnd":
      return { label: "Meşgul", color: "#ed4245" };
    case "invisible":
      return { label: "Gizli", color: "#747f8d" };
    case "offline":
    default:
      return { label: "Offline", color: "#747f8d" };
  }
}

function Avatar({
  label,
  avatarUrl,
  size = 40,
}: {
  label: string;
  avatarUrl?: string | null;
  size?: number;
}) {
  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt={label}
        style={{
          width: size,
          height: size,
          borderRadius: 999,
          objectFit: "cover",
          flexShrink: 0,
          border: "1px solid rgba(255,255,255,0.08)",
          boxShadow: "0 8px 18px rgba(0,0,0,0.22)",
          background: "rgba(255,255,255,0.04)",
        }}
      />
    );
  }

  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: 999,
        background: "linear-gradient(135deg,#5865f2,#7b8aff)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "white",
        fontWeight: 800,
        fontSize: size >= 40 ? 14 : 12,
        flexShrink: 0,
        boxShadow: "0 8px 18px rgba(88,101,242,0.22)",
      }}
    >
      {(label || "?").slice(0, 1).toUpperCase()}
    </div>
  );
}

function StatusDot({ status, size = 10 }: { status: UserStatus; size?: number }) {
  const meta = getStatusMeta(status);

  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: 999,
        background: meta.color,
        flexShrink: 0,
        boxShadow: `0 0 0 3px #171b22`,
      }}
    />
  );
}

function TabButton({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1,
        height: 36,
        borderRadius: 12,
        border: active
          ? "1px solid rgba(88,101,242,0.22)"
          : "1px solid rgba(255,255,255,0.06)",
        background: active
          ? "linear-gradient(135deg, rgba(88,101,242,0.18), rgba(123,138,255,0.10))"
          : "rgba(255,255,255,0.03)",
        color: active ? "#eef1ff" : "#a8b0bc",
        cursor: "pointer",
        fontWeight: 800,
        fontSize: 13,
      }}
    >
      {children}
    </button>
  );
}

function UserRow({
  user,
  currentUserId,
  dimmed = false,
  onOpenMenu,
  canMuteMembers = false,
  canDeafenMembers = false,
}: {
  user: PresenceUser;
  currentUserId: string;
  dimmed?: boolean;
  onOpenMenu?: (userId: string, x: number, y: number) => void;
  canMuteMembers?: boolean;
  canDeafenMembers?: boolean;
}) {
  const isSelf = user.userId === currentUserId;
  const effectiveStatus = getPresenceStatus(user);

  const handleOpenMenu = (
    e:
      | React.MouseEvent<HTMLButtonElement>
      | React.MouseEvent<HTMLDivElement>
  ) => {
    const canSelfOpenMenu =
      isSelf &&
      Boolean(user.activeVoiceChannelId) &&
      (canMuteMembers || canDeafenMembers);

    if ((isSelf && !canSelfOpenMenu) || !onOpenMenu) return;
    e.preventDefault();
    e.stopPropagation();
    onOpenMenu(user.userId, e.clientX, e.clientY);
  };

  return (
    <div
      onContextMenu={handleOpenMenu}
      style={{
        width: "100%",
        boxSizing: "border-box",
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "10px 10px 10px 12px",
        borderRadius: 14,
        background: dimmed
          ? "rgba(255,255,255,0.018)"
          : "rgba(255,255,255,0.03)",
        border: "1px solid rgba(255,255,255,0.05)",
        opacity: dimmed ? 0.62 : 1,
        minWidth: 0,
        overflow: "hidden",
      }}
      title={user.displayName}
    >
      <div style={{ position: "relative", flexShrink: 0 }}>
        <Avatar label={user.displayName} avatarUrl={user.avatarUrl} size={34} />
        <div style={{ position: "absolute", right: -2, bottom: -2 }}>
          <StatusDot status={effectiveStatus} size={11} />
        </div>
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          minWidth: 0,
          flex: 1,
          overflow: "hidden",
        }}
      >
        <span
          style={{
            fontSize: 13,
            fontWeight: 700,
            color: user.highestRoleColor || "#e9edf5",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {user.displayName}
        </span>

        <span
          style={{
            fontSize: 11,
            color: "#8f98a6",
            marginTop: 2,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          {effectiveStatus === "offline"
            ? "offline"
            : user.activeVoiceChannelName ? (
              <>
                <Volume2 size={12} />
                <span>{user.activeVoiceChannelName}</span>
              </>
            ) : (
              getStatusMeta(effectiveStatus).label.toLowerCase()
            )}
        </span>
      </div>

      {(!isSelf ||
        (Boolean(user.activeVoiceChannelId) &&
          (canMuteMembers || canDeafenMembers))) && (
        <button
          onClick={handleOpenMenu}
          title="İşlemler"
          style={{
            width: 26,
            minWidth: 26,
            height: 26,
            borderRadius: 9,
            border: "1px solid rgba(255,255,255,0.08)",
            background: "rgba(255,255,255,0.04)",
            color: "#eef1ff",
            cursor: "pointer",
            flexShrink: 0,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 0,
            marginLeft: 0,
          }}
        >
          <Ellipsis size={16} />
        </button>
      )}
    </div>
  );
}

function MenuItem({
  label,
  onClick,
  danger = false,
  disabled = false,
  icon,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
  icon?: React.ReactNode;
}) {
  return (
    <button
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      style={{
        width: "100%",
        height: 38,
        borderRadius: 10,
        border: "none",
        background: "transparent",
        color: disabled ? "#6f7a89" : danger ? "#ff9ea1" : "#e8edf5",
        textAlign: "left",
        padding: "0 12px",
        cursor: disabled ? "not-allowed" : "pointer",
        fontSize: 13,
        fontWeight: 700,
        display: "inline-flex",
        alignItems: "center",
        gap: 10,
      }}
    >
      {icon ? <span style={{ display: "inline-flex", alignItems: "center" }}>{icon}</span> : null}
      <span>{label}</span>
    </button>
  );
}

export default function UserBar({
  width,
  onLogout,
  currentUser,
  currentUserServers,
  blockedUserIds = [],
  blockedUsers = [],
  onRefreshBlockedUsers,
  onUnblockUser,
  serverMembers,
  friends,
  incomingRequests,
  incomingServerInvites,
  onSendFriendRequest,
  onAcceptFriendRequest,
  onRejectFriendRequest,
  onAcceptServerInvite,
  onRejectServerInvite,
  isDMView,
  onStartDirectMessage,
  onCallUser,
  onRemoveFriend,
  onBlockUser,
  onInviteToServer,
  selectedServerId = null,
  serverChannels = [],
  canManageRoles = false,
  canKickMembers = false,
  canBanMembers = false,
  canMuteMembers = false,
  canDeafenMembers = false,
  canMoveMembers = false,
  canDisconnectMembers = false,
  onServerMembersChanged,
  onHideUserBar,
  onUserUpdated,
  onStatusChange,
}: UserBarProps) {
  const [tab, setTab] = useState<"members" | "friends">(
    isDMView ? "friends" : "members"
  );
  const [friendName, setFriendName] = useState("");
  const [searchText, setSearchText] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const [showAddFriend, setShowAddFriend] = useState(false);
  const [requestLoading, setRequestLoading] = useState(false);
  const [requestError, setRequestError] = useState("");
  const [requestSuccess, setRequestSuccess] = useState("");
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [actionMenu, setActionMenu] = useState<ActionMenuState>(null);
  const [inviteMenu, setInviteMenu] = useState<InviteMenuState>(null);
  const [roleMenu, setRoleMenu] = useState<RoleMenuState>(null);
  const [moveMenu, setMoveMenu] = useState<MoveMenuState>(null);
  const [statusMenuOpen, setStatusMenuOpen] = useState(false);
  const [statusLoading, setStatusLoading] = useState(false);
  const [inviteSendingServerId, setInviteSendingServerId] = useState<string | null>(null);
  const [localStatus, setLocalStatus] = useState<Exclude<UserStatus, "offline">>(
    currentUser.status && currentUser.status !== "offline"
      ? currentUser.status
      : "online"
  );
  const [moderationLoading, setModerationLoading] = useState(false);
  const [serverRoles, setServerRoles] = useState<ServerRole[]>([]);
  const [rolesLoading, setRolesLoading] = useState(false);

  const addFriendInputRef = useRef<HTMLInputElement | null>(null);
  const actionMenuRef = useRef<HTMLDivElement | null>(null);
  const inviteMenuRef = useRef<HTMLDivElement | null>(null);
  const roleMenuRef = useRef<HTMLDivElement | null>(null);
  const moveMenuRef = useRef<HTMLDivElement | null>(null);
  const statusMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setTab(isDMView ? "friends" : "members");
    setSearchText("");
    setShowSearch(false);
  }, [isDMView]);

  useEffect(() => {
    if (currentUser.status && currentUser.status !== "offline") {
      setLocalStatus(currentUser.status);
    }
  }, [currentUser.status]);

  const loadServerRoles = async (options?: { silent?: boolean }) => {
    if (!selectedServerId || isDMView) {
      setServerRoles([]);
      return;
    }

    const token = localStorage.getItem("token");
    if (!token) return;

    try {
      if (!options?.silent) setRolesLoading(true);

      const res = await fetch(`http://localhost:3001/servers/${selectedServerId}/roles`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(data?.error || "roles alınamadı");
      }

      const nextRoles = Array.isArray(data)
        ? data.filter((role) => !shouldHideRoleFromQuickMenu(role))
        : [];

      setServerRoles(nextRoles);
    } catch (err) {
      console.error("server roles fetch error:", err);
      setServerRoles([]);
    } finally {
      if (!options?.silent) setRolesLoading(false);
    }
  };

  useEffect(() => {
    void loadServerRoles();
  }, [selectedServerId, isDMView]);

  useEffect(() => {
    const handleRolesUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ serverId?: string }>).detail;
      if (String(detail?.serverId ?? "") !== String(selectedServerId ?? "")) return;
      void loadServerRoles({ silent: true });
    };

    window.addEventListener("vice-server-roles-updated", handleRolesUpdated as EventListener);

    return () => {
      window.removeEventListener("vice-server-roles-updated", handleRolesUpdated as EventListener);
    };
  }, [selectedServerId, isDMView]);

  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      const clickedActionMenu = Boolean(actionMenuRef.current?.contains(target));
      const clickedInviteMenu = Boolean(inviteMenuRef.current?.contains(target));
      const clickedRoleMenu = Boolean(roleMenuRef.current?.contains(target));
      const clickedMoveMenu = Boolean(moveMenuRef.current?.contains(target));
      const clickedStatusMenu = Boolean(statusMenuRef.current?.contains(target));

      if (!clickedActionMenu && !clickedInviteMenu && !clickedRoleMenu && !clickedMoveMenu) {
        setActionMenu(null);
      }
      if (!clickedInviteMenu) {
        setInviteMenu(null);
      }
      if (!clickedRoleMenu) {
        setRoleMenu(null);
      }
      if (!clickedMoveMenu) {
        setMoveMenu(null);
      }
      if (!clickedStatusMenu) {
        setStatusMenuOpen(false);
      }
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setActionMenu(null);
        setInviteMenu(null);
        setRoleMenu(null);
        setMoveMenu(null);
        setStatusMenuOpen(false);
        setShowSearch(false);
        setSearchText("");
      }
    };

    window.addEventListener("mousedown", handleOutside);
    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("mousedown", handleOutside);
      window.removeEventListener("keydown", handleEscape);
    };
  }, []);

  const totalNotificationCount =
    incomingRequests.length + incomingServerInvites.length;

  const selfStatusMeta = getStatusMeta(localStatus);

  const friendIdSet = useMemo(
    () => new Set(friends.map((friend) => friend.userId)),
    [friends]
  );

  const blockedIdSet = useMemo(
    () => new Set(blockedUserIds),
    [blockedUserIds]
  );

  const membersToShow = useMemo(() => {
    return isDMView ? friends : tab === "members" ? serverMembers : friends;
  }, [friends, isDMView, serverMembers, tab]);

  const filteredMembers = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    if (!q) return membersToShow;

    return membersToShow.filter((user) => {
      const display = user.displayName?.toLowerCase() ?? "";
      const username = user.username?.toLowerCase() ?? "";
      return display.includes(q) || username.includes(q);
    });
  }, [membersToShow, searchText]);

  const menuUser = useMemo(() => {
    if (!actionMenu) return null;
    return [...serverMembers, ...friends].find((u) => u.userId === actionMenu.userId) ?? null;
  }, [actionMenu, friends, serverMembers]);

  const roleMenuUser = useMemo(() => {
    if (!roleMenu) return null;
    return [...serverMembers, ...friends].find((u) => u.userId === roleMenu.targetUserId) ?? null;
  }, [roleMenu, friends, serverMembers]);

  const menuUserIsFriend = menuUser ? friendIdSet.has(menuUser.userId) : false;
  const menuUserIsBlocked = menuUser ? blockedIdSet.has(menuUser.userId) : false;
  const isMenuUserSelf = menuUser ? String(menuUser.userId) === String(currentUser.id) : false;
  const canInviteUser = !menuUserIsBlocked && currentUserServers.length > 0;
  const menuUserIsInVoice = Boolean(menuUser?.activeVoiceChannelId);
  const moveTargetVoiceChannels = useMemo(
    () =>
      serverChannels.filter(
        (channel) =>
          channel.type === "voice" &&
          String(channel.id) !== String(menuUser?.activeVoiceChannelId ?? "")
      ),
    [serverChannels, menuUser?.activeVoiceChannelId]
  );

  const isMembersContext = !isDMView && tab === "members";

  const canShowSelfVoiceModeration =
    isMembersContext &&
    Boolean(selectedServerId) &&
    isMenuUserSelf &&
    menuUserIsInVoice &&
    (canMuteMembers || canDeafenMembers);

  const canShowOtherVoiceModeration =
    isMembersContext &&
    Boolean(selectedServerId) &&
    !isMenuUserSelf &&
    menuUserIsInVoice &&
    (canMuteMembers || canDeafenMembers || canMoveMembers || canDisconnectMembers);

  const canShowOtherMemberModeration =
    isMembersContext &&
    Boolean(selectedServerId) &&
    !isMenuUserSelf &&
    (canKickMembers || canBanMembers);

  const canShowModerationSection =
    canShowSelfVoiceModeration ||
    canShowOtherVoiceModeration ||
    canShowOtherMemberModeration;

  const menuUserRoleIds = useMemo(
    () => new Set((menuUser?.roles || []).map((role) => String(role.id))),
    [menuUser]
  );

  const canShowRoleSection =
    isMembersContext &&
    Boolean(selectedServerId) &&
    canManageRoles &&
    serverRoles.length > 0;

  const sendRequest = async () => {
    const trimmed = friendName.trim();

    if (!trimmed) {
      setRequestError("Username gerekli.");
      setRequestSuccess("");
      return;
    }

    if (!/^[a-zA-Z0-9_.]{3,20}$/.test(trimmed)) {
      setRequestError("Geçerli bir username gir.");
      setRequestSuccess("");
      return;
    }

    try {
      setRequestLoading(true);
      setRequestError("");
      setRequestSuccess("");
      await onSendFriendRequest(trimmed);
      setFriendName("");
      setShowAddFriend(false);
      setRequestSuccess("Arkadaşlık isteği gönderildi.");
    } catch (error: any) {
      setRequestError(error?.message || "İstek gönderilemedi.");
      setRequestSuccess("");
    } finally {
      setRequestLoading(false);
    }
  };

  const runMenuAction = async (fn: (targetUserId: string) => Promise<void> | void) => {
    if (!menuUser) return;
    try {
      await fn(menuUser.userId);
    } finally {
      setActionMenu(null);
    }
  };

  const handleMenuFriendRequest = async () => {
    if (!menuUser?.username) return;

    try {
      await onSendFriendRequest(menuUser.username);
    } finally {
      setActionMenu(null);
    }
  };

  const callServerModeration = async (
    path: string,
    body: Record<string, unknown>
  ) => {
    const token = localStorage.getItem("token");
    if (!token) throw new Error("UNAUTHORIZED");

    const res = await fetch(`http://localhost:3001${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });

    const data = await res.json().catch(() => null);
    if (!res.ok) {
      throw new Error(data?.error || "REQUEST_FAILED");
    }

    return data;
  };

  const runModerationAction = async (
    fn: (targetUserId: string) => Promise<void>
  ) => {
    if (!menuUser || moderationLoading) return;
    try {
      setModerationLoading(true);
      await fn(menuUser.userId);
      await onServerMembersChanged?.();
    } catch (error: any) {
      window.alert(error?.message || "İşlem başarısız oldu.");
    } finally {
      setModerationLoading(false);
      setActionMenu(null);
      setInviteMenu(null);
    }
  };

  const handleKickMember = async (targetUserId: string) => {
    if (!selectedServerId) return;
    const ok = window.confirm("Bu kullanıcıyı sunucudan atmak istiyor musun?");
    if (!ok) return;
    await callServerModeration(`/servers/${selectedServerId}/kick`, { targetUserId });
  };

  const handleBanMember = async (targetUserId: string) => {
    if (!selectedServerId) return;
    const ok = window.confirm("Bu kullanıcıyı sunucudan yasaklamak istiyor musun?");
    if (!ok) return;
    await callServerModeration(`/servers/${selectedServerId}/ban`, { targetUserId });
  };

  const handleVoiceMuteMember = async (targetUserId: string, muted: boolean) => {
    if (!selectedServerId) return;
    await callServerModeration(`/voice/mute-user`, {
      serverId: selectedServerId,
      targetUserId,
      muted,
    });
  };

  const handleVoiceDeafenMember = async (targetUserId: string, deafened: boolean) => {
    if (!selectedServerId) return;
    await callServerModeration(`/voice/deafen-user`, {
      serverId: selectedServerId,
      targetUserId,
      deafened,
    });
  };

  const handleVoiceDisconnectMember = async (targetUserId: string) => {
    if (!selectedServerId) return;
    await callServerModeration(`/voice/disconnect-user`, {
      serverId: selectedServerId,
      targetUserId,
    });
  };

  const handleVoiceMoveMember = async (targetUserId: string, targetChannelId: string) => {
    if (!selectedServerId) return;
    await callServerModeration(`/voice/move-user`, {
      serverId: selectedServerId,
      targetUserId,
      targetChannelId,
    });
  };

  const handleToggleRole = async (targetUserId: string, roleId: string, hasRole: boolean) => {
    const token = localStorage.getItem("token");
    if (!token || !selectedServerId) throw new Error("UNAUTHORIZED");

    const res = await fetch(
      `http://localhost:3001/servers/${selectedServerId}/members/${targetUserId}/roles/${roleId}`,
      {
        method: hasRole ? "DELETE" : "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );

    const data = await res.json().catch(() => null);
    if (!res.ok) {
      throw new Error(data?.error || "ROLE_UPDATE_FAILED");
    }
  };

  const openInviteMenu = () => {
    if (!menuUser || !actionMenu || !canInviteUser) return;

    const nextX = clamp(
      actionMenu.x - INVITE_MENU_WIDTH - 10,
      VIEWPORT_GAP,
      window.innerWidth - INVITE_MENU_WIDTH - VIEWPORT_GAP
    );

    const nextY = clamp(
      actionMenu.y,
      VIEWPORT_GAP,
      window.innerHeight - 320 - VIEWPORT_GAP
    );

    setRoleMenu(null);
    setMoveMenu(null);
    setInviteMenu({
      targetUserId: menuUser.userId,
      x: nextX,
      y: nextY,
    });
  };

  const openRoleMenu = () => {
    if (!menuUser || !actionMenu || !canShowRoleSection) return;

    const estimatedHeight = Math.min(420, Math.max(180, serverRoles.length * 48 + 84));
    const nextX = clamp(
      actionMenu.x - ROLE_MENU_WIDTH - 10,
      VIEWPORT_GAP,
      window.innerWidth - ROLE_MENU_WIDTH - VIEWPORT_GAP
    );

    const nextY = clamp(
      actionMenu.y,
      VIEWPORT_GAP,
      window.innerHeight - estimatedHeight - VIEWPORT_GAP
    );

    setInviteMenu(null);
    setMoveMenu(null);
    setRoleMenu({
      targetUserId: menuUser.userId,
      x: nextX,
      y: nextY,
    });
  };

  const openMoveMenu = () => {
    if (!menuUser || !actionMenu || moveTargetVoiceChannels.length === 0) return;

    const estimatedHeight = Math.min(420, Math.max(180, moveTargetVoiceChannels.length * 44 + 72));
    const nextX = clamp(
      actionMenu.x - MOVE_MENU_WIDTH - 10,
      VIEWPORT_GAP,
      window.innerWidth - MOVE_MENU_WIDTH - VIEWPORT_GAP
    );

    const nextY = clamp(
      actionMenu.y,
      VIEWPORT_GAP,
      window.innerHeight - estimatedHeight - VIEWPORT_GAP
    );

    setInviteMenu(null);
    setRoleMenu(null);
    setMoveMenu({
      targetUserId: menuUser.userId,
      x: nextX,
      y: nextY,
    });
  };

  const handleInviteServerSelect = async (serverId: string) => {
    if (!inviteMenu) return;

    try {
      setInviteSendingServerId(serverId);
      await onInviteToServer(inviteMenu.targetUserId, serverId);
      setInviteMenu(null);
      setMoveMenu(null);
      setActionMenu(null);
    } finally {
      setInviteSendingServerId(null);
    }
  };

  const handleRoleSelect = async (roleId: string, hasRole: boolean) => {
    if (!roleMenu || moderationLoading) return;

    try {
      setModerationLoading(true);
      await handleToggleRole(roleMenu.targetUserId, roleId, hasRole);
      await onServerMembersChanged?.();
      setActionMenu(null);
      setRoleMenu(null);
      setInviteMenu(null);
      setMoveMenu(null);
    } catch (error: any) {
      window.alert(error?.message || "Rol güncellenemedi.");
    } finally {
      setModerationLoading(false);
    }
  };

  const handleStatusSelect = async (nextStatus: Exclude<UserStatus, "offline">) => {
    if (statusLoading || nextStatus === localStatus) {
      setStatusMenuOpen(false);
      return;
    }

    const previous = localStatus;
    setLocalStatus(nextStatus);
    setStatusLoading(true);

    try {
      await onStatusChange?.(nextStatus);
      const authRaw = localStorage.getItem("auth_user");
      const authUser = authRaw ? JSON.parse(authRaw) : null;
      if (authUser) {
        const nextUser = { ...authUser, status: nextStatus };
        localStorage.setItem("auth_user", JSON.stringify(nextUser));
        onUserUpdated?.({
          id: nextUser.id,
          username: nextUser.username,
          displayName: nextUser.displayName,
          role: nextUser.role,
          avatarUrl: nextUser.avatarUrl,
          status: nextUser.status,
        });
      }
    } catch (error) {
      console.error("status update error:", error);
      setLocalStatus(previous);
    } finally {
      setStatusLoading(false);
      setStatusMenuOpen(false);
    }
  };

  const openActionMenu = (userId: string, x: number, y: number) => {
    const nextX = clamp(
      x - ACTION_MENU_WIDTH + 20,
      VIEWPORT_GAP,
      window.innerWidth - ACTION_MENU_WIDTH - VIEWPORT_GAP
    );
    const nextY = clamp(
      y - 8,
      VIEWPORT_GAP,
      window.innerHeight - ACTION_MENU_HEIGHT_ESTIMATE - VIEWPORT_GAP
    );

    setInviteMenu(null);
    setRoleMenu(null);
    setMoveMenu(null);
    setActionMenu({ userId, x: nextX, y: nextY });
  };

  return (
    <>
      <div
        style={{
          width,
          minWidth: width,
          background: "linear-gradient(180deg,#171b22,#13171d)",
          borderLeft: "1px solid rgba(255,255,255,0.06)",
          padding: 14,
          display: "flex",
          flexDirection: "column",
          gap: 12,
          minHeight: 0,
          boxSizing: "border-box",
        }}
      >
        <div
          style={{
            borderRadius: 22,
            padding: 16,
            background:
              "linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.02))",
            border: "1px solid rgba(255,255,255,0.06)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ position: "relative" }}>
              <Avatar
                label={currentUser.displayName}
                avatarUrl={currentUser.avatarUrl}
                size={58}
              />
              <div style={{ position: "absolute", right: -1, bottom: -1 }}>
                <StatusDot status={getPresenceStatus({ status: localStatus, isOnline: true })} size={14} />
              </div>
            </div>

            <div style={{ minWidth: 0, flex: 1 }}>
              <div
                style={{
                  color: "white",
                  fontWeight: 800,
                  fontSize: 17,
                  lineHeight: 1.2,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {currentUser.displayName}
              </div>

              <div
                style={{
                  color: "#9aa3b2",
                  fontSize: 13,
                  marginTop: 4,
                }}
              >
                @{currentUser.username || "user"}
              </div>

              <div ref={statusMenuRef} style={{ position: "relative", marginTop: 10 }}>
                <button
                  onClick={() => setStatusMenuOpen((prev) => !prev)}
                  disabled={statusLoading}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                    height: 36,
                    borderRadius: 999,
                    border: "1px solid rgba(255,255,255,0.08)",
                    background: "rgba(255,255,255,0.045)",
                    color: "#eef2f7",
                    padding: "0 14px",
                    cursor: statusLoading ? "not-allowed" : "pointer",
                    fontWeight: 800,
                    fontSize: 13,
                    opacity: statusLoading ? 0.74 : 1,
                  }}
                  title="Durumu değiştir"
                >
                  <span
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: 999,
                      background: selfStatusMeta.color,
                      flexShrink: 0,
                    }}
                  />
                  <span>{statusLoading ? "Kaydediliyor..." : selfStatusMeta.label}</span>
                  <ChevronDown size={14} color="#96a0af" />
                </button>

                {statusMenuOpen && (
                  <div
                    style={{
                      position: "absolute",
                      top: "calc(100% + 10px)",
                      right: 0,
                      transform: "translateX(-22px)",
                      width: 188,
                      padding: 8,
                      borderRadius: 16,
                      background: "linear-gradient(180deg,#1b2028,#151922)",
                      border: "1px solid rgba(255,255,255,0.08)",
                      boxShadow: "0 24px 60px rgba(0,0,0,0.38)",
                      zIndex: 40,
                    }}
                  >
                    {STATUS_OPTIONS.map((option) => {
                      const active = localStatus === option.value;
                      return (
                        <button
                          key={option.value}
                          onClick={() => handleStatusSelect(option.value)}
                          style={{
                            width: "100%",
                            display: "flex",
                            alignItems: "center",
                            gap: 10,
                            padding: "11px 12px",
                            borderRadius: 12,
                            border: active
                              ? "1px solid rgba(255,255,255,0.08)"
                              : "1px solid transparent",
                            background: active
                              ? "rgba(255,255,255,0.05)"
                              : "transparent",
                            color: "#eef2f7",
                            cursor: "pointer",
                            textAlign: "left",
                          }}
                        >
                          <span
                            style={{
                              width: 10,
                              height: 10,
                              borderRadius: 999,
                              background: option.color,
                              flexShrink: 0,
                            }}
                          />
                          <span style={{ fontWeight: 800, fontSize: 13 }}>
                            {option.label}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            gap: 12,
            marginTop: -2,
            paddingInline: 2,
          }}
        >
          <button onClick={onHideUserBar} style={topActionButtonStyle} title="Üyeleri gizle">
            <PanelRightClose size={18} />
          </button>

          <button
            onClick={() => setIsNotificationsOpen(true)}
            style={topActionButtonStyle}
            title="Bildirimler"
          >
            <Bell size={18} />
            {totalNotificationCount > 0 && (
              <span
                style={{
                  position: "absolute",
                  top: -4,
                  right: -4,
                  minWidth: 18,
                  height: 18,
                  borderRadius: 999,
                  padding: "0 5px",
                  background: "#ed4245",
                  color: "white",
                  fontSize: 10,
                  fontWeight: 800,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  boxShadow: "0 6px 14px rgba(237,66,69,0.28)",
                }}
              >
                {totalNotificationCount}
              </span>
            )}
          </button>

          <button
            onClick={() => setShowAddFriend((prev) => !prev)}
            style={topActionButtonStyle}
            title={showAddFriend ? "Arkadaş eklemeyi kapat" : "Arkadaş ekle"}
          >
            <UserPlus size={18} />
          </button>

          <button
            onClick={() => setIsSettingsOpen(true)}
            style={topActionButtonStyle}
            title="Ayarlar"
          >
            <Settings size={18} />
          </button>
        </div>

        {showAddFriend && (
          <div
            style={{
              background:
                "linear-gradient(180deg,rgba(255,255,255,0.03),rgba(255,255,255,0.02))",
              border: "1px solid rgba(255,255,255,0.05)",
              borderRadius: 18,
              padding: 12,
              boxSizing: "border-box",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                fontWeight: 800,
                fontSize: 13,
                marginBottom: 10,
                color: "#eef2f7",
              }}
            >
              Arkadaş ekle
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(0, 1fr) 52px",
                gap: 8,
                alignItems: "center",
                width: "100%",
              }}
            >
              <input
                ref={addFriendInputRef}
                value={friendName}
                onChange={(e) => setFriendName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    sendRequest();
                  }
                }}
                placeholder="Username"
                style={{
                  ...inputStyle,
                  minWidth: 0,
                  width: "100%",
                }}
              />

              <button
                onClick={sendRequest}
                disabled={requestLoading}
                style={{
                  height: 40,
                  width: "100%",
                  borderRadius: 12,
                  border: "none",
                  background: "linear-gradient(135deg,#5865f2,#7b8aff)",
                  color: "white",
                  padding: 0,
                  cursor: requestLoading ? "not-allowed" : "pointer",
                  fontWeight: 800,
                  fontSize: 12,
                  whiteSpace: "nowrap",
                  opacity: requestLoading ? 0.7 : 1,
                }}
              >
                Ekle
              </button>
            </div>

            {requestError && (
              <div style={{ marginTop: 8, fontSize: 12, color: "#ffb3b5" }}>{requestError}</div>
            )}

            {requestSuccess && (
              <div style={{ marginTop: 8, fontSize: 12, color: "#a8f0be" }}>{requestSuccess}</div>
            )}
          </div>
        )}

        {!isDMView && (
          <div style={{ display: "flex", gap: 8 }}>
            <TabButton active={tab === "members"} onClick={() => setTab("members")}>
              Members
            </TabButton>

            <TabButton active={tab === "friends"} onClick={() => setTab("friends")}>
              Friends
            </TabButton>
          </div>
        )}

        <div
          style={{
            flex: 1,
            minHeight: 0,
            background:
              "linear-gradient(180deg,rgba(255,255,255,0.03),rgba(255,255,255,0.02))",
            border: "1px solid rgba(255,255,255,0.05)",
            borderRadius: 22,
            padding: 14,
            overflowY: "auto",
            overflowX: "hidden",
            boxSizing: "border-box",
          }}
        >
          <div
            style={{
              marginBottom: 14,
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 8,
              }}
            >
              <div style={{ color: "white", fontSize: 15, fontWeight: 800 }}>
                {isDMView ? "Arkadaşlar" : tab === "members" ? "Sunucu üyeleri" : "Arkadaşlar"}
              </div>

              <button
                onClick={() => {
                  if (showSearch) {
                    setShowSearch(false);
                    setSearchText("");
                  } else {
                    setShowSearch(true);
                  }
                }}
                title={showSearch ? "Aramayı kapat" : "Ara"}
                style={searchToggleButtonStyle}
              >
                <Search size={16} />
              </button>
            </div>

            {showSearch && (
              <div style={{ position: "relative", width: "100%" }}>
                <span
                  style={{
                    position: "absolute",
                    left: 12,
                    top: "50%",
                    transform: "translateY(-50%)",
                    color: "#8f98a6",
                    fontSize: 13,
                    pointerEvents: "none",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Search size={14} />
                </span>

                <input
                  value={searchText}
                  onChange={(e) => setSearchText(e.target.value)}
                  placeholder={isDMView ? "Arkadaş ara..." : "Üye ara..."}
                  style={{
                    ...inputStyle,
                    width: "100%",
                    minWidth: 0,
                    paddingLeft: 36,
                    paddingRight: 12,
                    boxSizing: "border-box",
                  }}
                />
              </div>
            )}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 10, paddingRight: 2 }}>
            {filteredMembers.length === 0 ? (
              <div
                style={{
                  color: "#96a0af",
                  fontSize: 13,
                  padding: "10px 4px",
                }}
              >
                {searchText.trim()
                  ? "Aramaya uygun kullanıcı bulunamadı."
                  : "Burada gösterilecek kullanıcı yok."}
              </div>
            ) : (
              filteredMembers.map((user) => (
                <UserRow
                  key={user.userId}
                  user={user}
                  currentUserId={currentUser.id}
                  dimmed={getPresenceStatus(user) === "offline"}
                  onOpenMenu={openActionMenu}
                  canMuteMembers={canMuteMembers}
                  canDeafenMembers={canDeafenMembers}
                />
              ))
            )}
          </div>
        </div>
      </div>

      {actionMenu && menuUser && (
        <div
          ref={actionMenuRef}
          style={{
            position: "fixed",
            top: actionMenu.y,
            left: actionMenu.x,
            width: ACTION_MENU_WIDTH,
            background: "linear-gradient(180deg,#1b2028,#151922)",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 16,
            boxShadow: "0 24px 60px rgba(0,0,0,0.38)",
            padding: 8,
            zIndex: 1500,
          }}
        >
          <div
            style={{
              padding: "10px 12px 12px",
              borderBottom: "1px solid rgba(255,255,255,0.06)",
              marginBottom: 8,
              display: "flex",
              alignItems: "center",
              gap: 10,
            }}
          >
            <Avatar label={menuUser.displayName} avatarUrl={menuUser.avatarUrl} size={34} />

            <div style={{ minWidth: 0, flex: 1 }}>
              <div
                style={{
                  color: "white",
                  fontSize: 13,
                  fontWeight: 800,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {menuUser.displayName}
              </div>

              {menuUser.highestRoleName ? (
                <div
                  style={{
                    color: menuUser.highestRoleColor || "#cfd6e4",
                    fontSize: 10,
                    marginTop: 4,
                    fontWeight: 800,
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: 999,
                      background: menuUser.highestRoleColor || "#8f98a6",
                      flexShrink: 0,
                    }}
                  />
                  {menuUser.highestRoleName}
                </div>
              ) : null}

              <div
                style={{
                  color: "#8f98a6",
                  fontSize: 11,
                  marginTop: 2,
                }}
              >
                @{menuUser.username || "user"}
              </div>

              {isMembersContext && menuUser.activeVoiceChannelName && (
                <div
                  style={{
                    color: "#9fb0ff",
                    fontSize: 11,
                    marginTop: 4,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
                  <Volume2 size={12} />
                  <span>{menuUser.activeVoiceChannelName}</span>
                </div>
              )}
            </div>
          </div>

          {!isMenuUserSelf && (
            <MenuItem
              label="Mesaj gönder"
              icon={<MessageCircle size={15} />}
              onClick={() => runMenuAction(onStartDirectMessage)}
            />
          )}
          {!isMenuUserSelf && (
            <MenuItem
              label="Ara"
              icon={<Phone size={15} />}
              onClick={() => runMenuAction(onCallUser)}
            />
          )}

          {!isMenuUserSelf && !menuUserIsBlocked && (
            menuUserIsFriend ? (
              <MenuItem
                label="Arkadaşlıktan çıkar"
                icon={<UserMinus size={15} />}
                onClick={() => runMenuAction(onRemoveFriend)}
              />
            ) : (
              <MenuItem
                label="Arkadaş ekle"
                icon={<UserPlus size={15} />}
                onClick={handleMenuFriendRequest}
              />
            )
          )}

          {!isMenuUserSelf && (
            <MenuItem
              label={menuUserIsBlocked ? "Engellendi" : "Engelle"}
              icon={<Ban size={15} />}
              danger
              disabled={menuUserIsBlocked}
              onClick={() => runMenuAction(onBlockUser)}
            />
          )}

          {canShowModerationSection && (
            <>
              <div
                style={{
                  height: 1,
                  background: "rgba(255,255,255,0.06)",
                  margin: "8px 0",
                }}
              />

              {menuUserIsInVoice && (
                <>
                  {canMuteMembers &&
                    (canShowSelfVoiceModeration || canShowOtherVoiceModeration) && (
                      <MenuItem
                        label={menuUser?.serverMuted ? "Sunucu susturmasını kaldır" : "Sunucuda sustur"}
                        icon={<VolumeX size={15} />}
                        disabled={moderationLoading}
                        onClick={() =>
                          runModerationAction((targetUserId) =>
                            handleVoiceMuteMember(targetUserId, !Boolean(menuUser?.serverMuted))
                          )
                        }
                      />
                    )}

                  {canDeafenMembers &&
                    (canShowSelfVoiceModeration || canShowOtherVoiceModeration) && (
                      <MenuItem
                        label={menuUser?.serverDeafened ? "Sağırlaştırmayı kaldır" : "Sağırlaştır"}
                        icon={<EarOff size={15} />}
                        disabled={moderationLoading}
                        onClick={() =>
                          runModerationAction((targetUserId) =>
                            handleVoiceDeafenMember(targetUserId, !Boolean(menuUser?.serverDeafened))
                          )
                        }
                      />
                    )}

                  {!isMenuUserSelf && canDisconnectMembers && (
                    <MenuItem
                      label="Sesten at"
                      icon={<PhoneOff size={15} />}
                      danger
                      disabled={moderationLoading}
                      onClick={() => runModerationAction(handleVoiceDisconnectMember)}
                    />
                  )}

                  {!isMenuUserSelf && canMoveMembers && moveTargetVoiceChannels.length > 0 && (
                    <MenuItem
                      label="Başka odaya taşı"
                      icon={<ArrowRightLeft size={15} />}
                      disabled={moderationLoading}
                      onClick={openMoveMenu}
                    />
                  )}
                </>
              )}

              {!isMenuUserSelf && canKickMembers && (
                <MenuItem
                  label="Sunucudan at"
                  icon={<UserX size={15} />}
                  danger
                  disabled={moderationLoading}
                  onClick={() => runModerationAction(handleKickMember)}
                />
              )}

              {!isMenuUserSelf && canBanMembers && (
                <MenuItem
                  label="Sunucudan yasakla"
                  icon={<ShieldBan size={15} />}
                  danger
                  disabled={moderationLoading}
                  onClick={() => runModerationAction(handleBanMember)}
                />
              )}
            </>
          )}

          {canShowRoleSection && menuUser && (
            <>
              <div
                style={{
                  height: 1,
                  background: "rgba(255,255,255,0.06)",
                  margin: "8px 0",
                }}
              />
              <MenuItem
                label={rolesLoading ? "Roller yükleniyor..." : "Rolleri yönet"}
                icon={<UserRoundKey size={15} />}
                disabled={rolesLoading || moderationLoading}
                onClick={openRoleMenu}
              />
            </>
          )}

          {canInviteUser && !isMenuUserSelf && (
            <MenuItem
              label="Sunucuya davet et"
              icon={<UserPlus size={15} />}
              disabled={!canInviteUser}
              onClick={openInviteMenu}
            />
          )}
        </div>
      )}


      {roleMenu && roleMenuUser && (
        <div
          ref={roleMenuRef}
          style={{
            position: "fixed",
            top: roleMenu.y,
            left: roleMenu.x,
            width: ROLE_MENU_WIDTH,
            background: "linear-gradient(180deg,#1b2028,#151922)",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 16,
            boxShadow: "0 24px 60px rgba(0,0,0,0.38)",
            padding: 8,
            zIndex: 1510,
          }}
        >
          <div
            style={{
              color: "#eef2f7",
              fontSize: 13,
              fontWeight: 800,
              padding: "10px 12px 12px",
              borderBottom: "1px solid rgba(255,255,255,0.06)",
              marginBottom: 8,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
            }}
          >
            <span
              style={{
                minWidth: 0,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {roleMenuUser.displayName} · Roller
            </span>
            <button
              type="button"
              onClick={() => setRoleMenu(null)}
              style={{
                width: 28,
                minWidth: 28,
                height: 28,
                borderRadius: 9,
                border: "1px solid rgba(255,255,255,0.08)",
                background: "rgba(255,255,255,0.04)",
                color: "#cfd6e4",
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                padding: 0,
                flexShrink: 0,
              }}
              title="Kapat"
            >
              <ChevronRight size={15} />
            </button>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 360, overflowY: "auto", padding: "0 2px 2px" }}>
            {rolesLoading ? (
              <div
                style={{
                  padding: "10px 12px",
                  color: "#8f98a6",
                  fontSize: 12,
                }}
              >
                Roller yükleniyor...
              </div>
            ) : serverRoles.length === 0 ? (
              <div
                style={{
                  padding: "10px 12px",
                  color: "#8f98a6",
                  fontSize: 12,
                }}
              >
                Gösterilecek rol bulunamadı.
              </div>
            ) : (
              serverRoles.map((role) => {
                const hasRole = roleMenuUser ? new Set((roleMenuUser.roles || []).map((item) => String(item.id))).has(String(role.id)) : false;
                return (
                  <button
                    key={role.id}
                    type="button"
                    disabled={moderationLoading}
                    onClick={() => void handleRoleSelect(role.id, hasRole)}
                    style={{
                      width: "100%",
                      minHeight: 46,
                      borderRadius: 12,
                      border: hasRole
                        ? "1px solid rgba(88,101,242,0.22)"
                        : "1px solid rgba(255,255,255,0.08)",
                      background: hasRole
                        ? "linear-gradient(135deg, rgba(88,101,242,0.18), rgba(123,138,255,0.08))"
                        : "rgba(255,255,255,0.03)",
                      color: "#e8edf5",
                      textAlign: "left",
                      padding: "10px 12px",
                      cursor: moderationLoading ? "not-allowed" : "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 12,
                      opacity: moderationLoading ? 0.72 : 1,
                    }}
                  >
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 10, minWidth: 0, flex: 1 }}>
                      <span
                        style={{
                          width: 12,
                          height: 12,
                          borderRadius: 999,
                          background: role.color || "#8f98a6",
                          boxShadow: `0 0 0 4px ${role.color ? `${role.color}22` : "rgba(143,152,166,0.16)"}`,
                          flexShrink: 0,
                        }}
                      />
                      <span style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                        <span
                          style={{
                            color: role.color || "#eef2f7",
                            fontSize: 13,
                            fontWeight: 800,
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                        >
                          {role.name}
                        </span>
                        <span style={{ color: "#8f98a6", fontSize: 11, fontWeight: 700 }}>
                          {hasRole ? "Rol kullanıcıda var" : "Rol verilebilir"}
                        </span>
                      </span>
                    </span>

                    <span
                      style={{
                        minWidth: 56,
                        height: 28,
                        borderRadius: 999,
                        padding: "0 10px",
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        background: hasRole ? "rgba(255,255,255,0.08)" : "rgba(88,101,242,0.16)",
                        color: hasRole ? "#eef2f7" : "#dfe4ff",
                        fontSize: 11,
                        fontWeight: 800,
                        flexShrink: 0,
                      }}
                    >
                      {hasRole ? "Kaldır" : "Ver"}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}

      {moveMenu && menuUser && (
        <div
          ref={moveMenuRef}
          style={{
            position: "fixed",
            top: moveMenu.y,
            left: moveMenu.x,
            width: MOVE_MENU_WIDTH,
            background: "linear-gradient(180deg,#1b2028,#151922)",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 16,
            boxShadow: "0 24px 60px rgba(0,0,0,0.38)",
            padding: 8,
            zIndex: 1510,
          }}
        >
          <div
            style={{
              color: "#eef2f7",
              fontSize: 13,
              fontWeight: 800,
              padding: "10px 12px 12px",
              borderBottom: "1px solid rgba(255,255,255,0.06)",
              marginBottom: 8,
            }}
          >
            Taşınacak odayı seç
          </div>

          <div style={{ maxHeight: 320, overflowY: "auto", paddingRight: 2 }}>
            {moveTargetVoiceChannels.length === 0 ? (
              <div
                style={{
                  padding: "10px 12px",
                  color: "#8f98a6",
                  fontSize: 12,
                }}
              >
                Taşınabilecek başka voice oda yok.
              </div>
            ) : (
              moveTargetVoiceChannels.map((channel) => (
                <button
                  key={channel.id}
                  onClick={() =>
                    runModerationAction((targetUserId) =>
                      handleVoiceMoveMember(targetUserId, channel.id)
                    )
                  }
                  disabled={moderationLoading}
                  style={{
                    width: "100%",
                    height: 40,
                    borderRadius: 10,
                    border: "none",
                    background: "transparent",
                    color: "#e8edf5",
                    textAlign: "left",
                    padding: "0 12px",
                    cursor: moderationLoading ? "not-allowed" : "pointer",
                    fontSize: 13,
                    fontWeight: 700,
                    opacity: moderationLoading ? 0.65 : 1,
                  }}
                >
                  {moderationLoading ? "Taşınıyor..." : channel.name}
                </button>
              ))
            )}
          </div>
        </div>
      )}

      {inviteMenu && (
        <div
          ref={inviteMenuRef}
          style={{
            position: "fixed",
            top: inviteMenu.y,
            left: inviteMenu.x,
            width: INVITE_MENU_WIDTH,
            background: "linear-gradient(180deg,#1b2028,#151922)",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 16,
            boxShadow: "0 24px 60px rgba(0,0,0,0.38)",
            padding: 8,
            zIndex: 1510,
          }}
        >
          <div
            style={{
              color: "#eef2f7",
              fontSize: 13,
              fontWeight: 800,
              padding: "10px 12px 12px",
              borderBottom: "1px solid rgba(255,255,255,0.06)",
              marginBottom: 8,
            }}
          >
            Sunucu seç
          </div>

          {currentUserServers.length === 0 ? (
            <div
              style={{
                padding: "10px 12px",
                color: "#8f98a6",
                fontSize: 12,
              }}
            >
              Davet gönderebileceğin sunucu bulunamadı.
            </div>
          ) : (
            currentUserServers.map((server) => (
              <button
                key={server.id}
                onClick={() => void handleInviteServerSelect(server.id)}
                disabled={inviteSendingServerId === server.id}
                style={{
                  width: "100%",
                  height: 40,
                  borderRadius: 10,
                  border: "none",
                  background: "transparent",
                  color: "#e8edf5",
                  textAlign: "left",
                  padding: "0 12px",
                  cursor: inviteSendingServerId === server.id ? "not-allowed" : "pointer",
                  fontSize: 13,
                  fontWeight: 700,
                  opacity: inviteSendingServerId === server.id ? 0.65 : 1,
                }}
              >
                {inviteSendingServerId === server.id ? "Gönderiliyor..." : server.name}
              </button>
            ))
          )}
        </div>
      )}

      <NotificationsModal
        isOpen={isNotificationsOpen}
        onClose={() => setIsNotificationsOpen(false)}
        incomingFriendRequests={incomingRequests}
        incomingServerInvites={incomingServerInvites}
        onAcceptFriendRequest={onAcceptFriendRequest}
        onRejectFriendRequest={onRejectFriendRequest}
        onAcceptServerInvite={onAcceptServerInvite}
        onRejectServerInvite={onRejectServerInvite}
      />

      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        currentUser={currentUser}
        blockedUsers={blockedUsers}
        onRefreshBlockedUsers={onRefreshBlockedUsers}
        onUnblockUser={onUnblockUser}
        onLogout={onLogout}
        onUserUpdated={(nextUser) =>
          onUserUpdated?.({
            ...currentUser,
            displayName: nextUser.displayName,
            avatarUrl: nextUser.avatarUrl,
          })
        }
      />
    </>
  );
}

const topActionButtonStyle: React.CSSProperties = {
  width: 42,
  minWidth: 42,
  height: 42,
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.08)",
  background: "rgba(255,255,255,0.04)",
  color: "white",
  cursor: "pointer",
  position: "relative",
  flexShrink: 0,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 0,
};

const searchToggleButtonStyle: React.CSSProperties = {
  width: 36,
  minWidth: 36,
  height: 36,
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.08)",
  background: "rgba(255,255,255,0.04)",
  color: "white",
  cursor: "pointer",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 0,
};

const inputStyle: React.CSSProperties = {
  flex: 1,
  height: 40,
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.08)",
  background: "rgba(255,255,255,0.04)",
  color: "white",
  padding: "0 12px",
  outline: "none",
};
