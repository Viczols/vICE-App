import { useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent } from "react";
import { Bell, PanelRightClose, Settings, UserPlus } from "lucide-react";
import SidebarServers from "../components/SidebarServers";
import SidebarChannels from "../components/SidebarChannels";
import ChatArea from "../components/ChatArea";
import VoicePanel from "../components/VoicePanel";
import UserBar from "../components/UserBar";
import DirectMessageArea, { type DmRealtimeMutationEvent } from "../components/DirectMessageArea";
import NotificationsModal from "../components/NotificationsModal";
import SettingsModal from "../components/SettingsModal";
import type { AuthUser } from "../App";
import {
  getDmNotificationSettings,
  getServerNotificationSettings,
  playSound,
  resumeAudioContext,
  startDmCallLoop,
  stopDmCallLoop,
  updateDmNotificationSettings,
} from "../utils/soundManager";

export type Channel = {
  id: string;
  name: string;
  type: "voice" | "text";
  serverId?: string;
  isPrivate?: boolean;
  position?: number;
};

export type VoicePresenceItem = {
  userId: string;
  displayName: string;
  username?: string;
  avatarUrl?: string | null;
  joinedAt: number;
  selfMuted?: boolean;
  selfDeafened?: boolean;
  serverMuted?: boolean;
  serverDeafened?: boolean;
  muted: boolean;
  deafened: boolean;
};

type MainLayoutProps = {
  onLogout: () => void;
  currentUser: AuthUser;
};

type UserStatus = "online" | "idle" | "dnd" | "invisible" | "offline";

type CurrentUserState = AuthUser & {
  avatarUrl?: string | null;
  status?: UserStatus;
};

type ServerItem = {
  id: string;
  name: string;
  ownerId?: string;
  avatarUrl?: string | null;
};

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

type FriendItem = {
  id: string;
  username: string;
  displayName: string;
  avatarUrl?: string | null;
  status?: UserStatus;
};

type IncomingFriendRequest = {
  id: string;
  username: string;
  displayName: string;
  avatarUrl?: string | null;
  createdAt: string;
};

type IncomingServerInvite = {
  id: string;
  serverName: string;
  inviterDisplayName: string;
  inviterUserId?: string;
  avatarUrl?: string | null;
  createdAt: string;
};

type BlockedUserItem = {
  id: string;
  username?: string;
  displayName: string;
  avatarUrl?: string | null;
};

export type DmConversation = {
  id: string;
  userOneId: string;
  userTwoId: string;
  createdAt: string;
  updatedAt: string;
  otherUser: {
    id: string;
    username?: string | null;
    displayName: string;
    avatarUrl?: string | null;
  } | null;
  lastMessage: {
    id: string;
    content: string;
    createdAt: string;
    senderUserId: string;
    editedAt?: string | null;
    attachments?: DmAttachmentLike[];
  } | null;
};

type DmAttachmentLike = {
  id: string;
  messageId: string;
  kind: "image" | "video" | "file";
  url: string;
  originalName: string;
  mimeType?: string | null;
  sizeBytes?: number;
  createdAt?: string;
};

type DmMessageLike = {
  id: string;
  conversationId: string;
  content: string;
  createdAt: string;
  senderUserId: string;
  editedAt?: string | null;
  deletedAt?: string | null;
  isPinned?: boolean;
  pinnedAt?: string | null;
  pinnedBy?: string | null;
  attachments?: DmAttachmentLike[];
};


export type DmCallState = {
  conversationId: string | null;
  status: "idle" | "incoming" | "outgoing" | "active" | "left";
  roomName: string | null;
  callerUserId: string | null;
  callerDisplayName: string | null;
  targetUserId: string | null;
  isAlone?: boolean;
  aloneExpiresAt?: number | null;
  selfLeft?: boolean;
  canRejoin?: boolean;
};

function getInitials(name: string) {
  const parts = String(name || "?").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}


function resolveDisplayRoleColor(
  roles?: Array<{
    id: string;
    name: string;
    color?: string | null;
    position?: number;
    isDefault?: boolean;
    isManaged?: boolean;
  }>
) {
  if (!Array.isArray(roles) || roles.length === 0) return "#ffffff";

  const sorted = [...roles].sort((a, b) => {
    const positionDiff = Number(b?.position ?? 0) - Number(a?.position ?? 0);
    if (positionDiff !== 0) return positionDiff;
    return String(a?.name ?? "").localeCompare(String(b?.name ?? ""), "tr");
  });

  for (const role of sorted) {
    const color = String(role?.color ?? "").trim();
    if (color) return color;
  }

  return "#ffffff";
}

function UserAvatar({
  name,
  avatarUrl,
  size = 44,
}: {
  name: string;
  avatarUrl?: string | null;
  size?: number;
}) {
  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt={name}
        style={{
          width: size,
          height: size,
          borderRadius: 999,
          objectFit: "cover",
          border: "1px solid rgba(255,255,255,0.08)",
          background: "#1b2028",
          flexShrink: 0,
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
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "linear-gradient(135deg, #5865f2, #7b8aff)",
        color: "#fff",
        fontWeight: 900,
        fontSize: Math.max(14, Math.floor(size * 0.34)),
        boxShadow: "0 12px 28px rgba(88,101,242,0.28)",
        flexShrink: 0,
      }}
    >
      {getInitials(name)}
    </div>
  );
}

export default function MainLayout({
  onLogout,
  currentUser,
}: MainLayoutProps) {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [selectedChannel, setSelectedChannel] = useState<Channel | null>(null);
  const [selectedServerId, setSelectedServerId] = useState<string | null>(null);
  const [selectedServerName, setSelectedServerName] = useState("");
  const [selectedServerAvatarUrl, setSelectedServerAvatarUrl] = useState<string | null>(null);

  const [currentUserState, setCurrentUserState] = useState<CurrentUserState>({
    ...currentUser,
    avatarUrl: (currentUser as any)?.avatarUrl ?? null,
    status: (currentUser as any)?.status ?? "online",
  });

  const [currentUserServers, setCurrentUserServers] = useState<ServerItem[]>([]);
  const [blockedUsers, setBlockedUsers] = useState<BlockedUserItem[]>([]);
  const [serverPermissions, setServerPermissions] = useState({
    canManageServer: false,
    canManageRoles: false,
    canManageChannels: false,
    canKickMembers: false,
    canBanMembers: false,
    canMuteMembers: false,
    canDeafenMembers: false,
    canMoveMembers: false,
    canDisconnectMembers: false,
  });

  const [isDMView, setIsDMView] = useState(false);
  const [dmConversations, setDmConversations] = useState<DmConversation[]>([]);
  const [selectedDM, setSelectedDM] = useState<DmConversation | null>(null);
  const [dmTypingMap, setDmTypingMap] = useState<Record<string, string[]>>({});
  const [dmUnreadMap, setDmUnreadMap] = useState<Record<string, number>>({});
  const [serverUnreadMap, setServerUnreadMap] = useState<Record<string, number>>({});
  const [channelUnreadMap, setChannelUnreadMap] = useState<Record<string, number>>({});
  const [dmSearchText, setDmSearchText] = useState("");
  const [dmNotificationMenu, setDmNotificationMenu] = useState<{
    conversationId: string;
    x: number;
    y: number;
  } | null>(null);
  const [dmRealtimeEvent, setDmRealtimeEvent] = useState<DmRealtimeMutationEvent | null>(null);
  const [ignoredIncomingConversationId, setIgnoredIncomingConversationId] = useState<string | null>(null);

  const [dmCallState, setDmCallState] = useState<DmCallState>({
    conversationId: null,
    status: "idle",
    roomName: null,
    callerUserId: null,
    callerDisplayName: null,
    targetUserId: null,
    isAlone: false,
    aloneExpiresAt: null,
    selfLeft: false,
    canRejoin: false,
  });

  const [activeVoiceChannelId, setActiveVoiceChannelId] = useState<string | null>(
    null
  );
  const [voiceParticipants, setVoiceParticipants] = useState<string[]>([]);
  const [voicePresenceMap, setVoicePresenceMap] = useState<
    Record<string, VoicePresenceItem[]>
  >({});
  const [streamingUserIdsByChannel, setStreamingUserIdsByChannel] = useState<
    Record<string, string[]>
  >({});
  const [onlineUsers, setOnlineUsers] = useState<
    {
      userId: string;
      username?: string;
      displayName: string;
      avatarUrl?: string | null;
      status?: UserStatus;
    }[]
  >([]);

  const [serverMembersRaw, setServerMembersRaw] = useState<
    {
      id: string;
      username?: string;
      displayName: string;
      avatarUrl?: string | null;
      status?: UserStatus;
      role?: string;
      serverMuted?: boolean;
      serverDeafened?: boolean;
      roles?: Array<{
        id: string;
        name: string;
        color?: string | null;
        position?: number;
        isDefault?: boolean;
        isManaged?: boolean;
      }>;
    }[]
  >([]);
  const [friendsRaw, setFriendsRaw] = useState<FriendItem[]>([]);
  const [incomingRequests, setIncomingRequests] = useState<IncomingFriendRequest[]>([]);
  const [incomingServerInvites, setIncomingServerInvites] = useState<
    IncomingServerInvite[]
  >([]);

  const [isConnected, setIsConnected] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isDeafened, setIsDeafened] = useState(false);
  const [viewportWidth, setViewportWidth] = useState(window.innerWidth);
  const [isGlobalWsReady, setIsGlobalWsReady] = useState(false);

  const [isUserBarHidden, setIsUserBarHidden] = useState(false);
  const [isCollapsedNotificationsOpen, setIsCollapsedNotificationsOpen] =
    useState(false);
  const [isCollapsedSettingsOpen, setIsCollapsedSettingsOpen] = useState(false);
  const [isCollapsedAddFriendOpen, setIsCollapsedAddFriendOpen] = useState(false);
  const [collapsedFriendName, setCollapsedFriendName] = useState("");
  const [collapsedFriendLoading, setCollapsedFriendLoading] = useState(false);
  const [collapsedFriendError, setCollapsedFriendError] = useState("");
  const [collapsedFriendSuccess, setCollapsedFriendSuccess] = useState("");

  const globalWsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<number | null>(null);
  const closeGlobalWsRef = useRef<(() => void) | null>(null);
  const selectedDMRef = useRef<DmConversation | null>(null);
  const selectedChannelRef = useRef<Channel | null>(null);
  const isDMViewRef = useRef(false);
  const dmCallStateRef = useRef<DmCallState>(dmCallState);
  const channelsRef = useRef<Channel[]>([]);
  const selectedServerIdRef = useRef<string | null>(null);
  const activeVoiceChannelIdRef = useRef<string | null>(activeVoiceChannelId);
  const onlineUsersRef = useRef(onlineUsers);
  const serverMembersRawRef = useRef(serverMembersRaw);
  const currentUserStateRef = useRef(currentUserState);
  const selfVoiceLeftGraceTimerRef = useRef<number | null>(null);
  const dmMediaScreenStateRef = useRef<Record<string, boolean>>({});

  const SERVER_VOICE_CHANNEL_STORAGE_KEY = "vice_active_server_voice_channel_id";
  const SERVER_VOICE_SERVER_STORAGE_KEY = "vice_active_server_voice_server_id";
  const USER_IDENTITY_EVENT_NAME = "vice-user-identity-map-updated";
  const USER_IDENTITY_SNAPSHOT_KEY = "__vice_user_identity_map__";
  const STREAM_ANNOUNCEMENT_EVENT_NAME = "vice-voice-stream-announcements-updated";
  const STREAM_ANNOUNCEMENT_CLEAR_EVENT_NAME =
    "vice-voice-stream-announcements-cleared";
  const STREAM_ANNOUNCEMENT_UPSTREAM_EVENT_NAME =
    "vice-voice-stream-announcements-local-state";
  const STREAM_ANNOUNCEMENT_SNAPSHOT_KEY = "__vice_voice_stream_announcements__";
  const FORCE_SERVER_VOICE_LEFT_EVENT_NAME = "vice-force-server-voice-left";
  const DM_MEDIA_STATE_EVENT_NAME = "vice-dm-media-state";

  const collectStreamingUserIdsFromSnapshot = (snapshot: Record<string, any>) => {
    const nextByChannel: Record<string, string[]> = {};

    for (const [channelKey, detail] of Object.entries(snapshot || {})) {
      const announcements = Array.isArray((detail as any)?.announcements)
        ? (detail as any).announcements
        : [];

      const ids = new Set<string>();

      for (const item of announcements) {
        if (item?.source === "screen" && item?.participantId) {
          ids.add(String(item.participantId));
        }
      }

      if (ids.size > 0) {
        nextByChannel[String(channelKey)] = Array.from(ids);
      }
    }

    setStreamingUserIdsByChannel(nextByChannel);
  };

  const getServerVoiceNotificationVolumeForChannel = (
    channelId?: string | null
  ) => {
    const normalizedChannelId = String(channelId ?? "").trim();
    if (!normalizedChannelId) return null;

    const matchingChannel = channelsRef.current.find(
      (channel) => String(channel.id) === normalizedChannelId
    );

    const serverId =
      matchingChannel?.serverId || selectedServerIdRef.current || null;
    if (!serverId) return null;

    const settings = getServerNotificationSettings(serverId);
    const volume = Number(settings?.message?.volume ?? 1);

    if (!Number.isFinite(volume) || volume <= 0) return null;
    return volume;
  };

  const playServerPresenceNotification = (
    channelId: string | null | undefined,
    sound: "voice-join" | "voice-leave" | "screen-share-start" | "screen-share-stop",
    actorUserId?: string | null
  ) => {
    const normalizedChannelId = String(channelId ?? "").trim();
    const activeChannelId = String(activeVoiceChannelIdRef.current ?? "").trim();
    const selfUserId = String(currentUserStateRef.current?.id ?? "").trim();

    if (!normalizedChannelId || normalizedChannelId !== activeChannelId) return;
    if (actorUserId && String(actorUserId) === selfUserId) return;

    const volume = getServerVoiceNotificationVolumeForChannel(normalizedChannelId);
    if (!volume) return;

    void playSound(sound, volume);
  };

  const getConversationIdFromMediaChannelId = (channelId?: string | null) => {
    const normalized = String(channelId ?? "").trim();
    if (!normalized.startsWith("dm:")) return null;
    const conversationId = normalized.slice(3).trim();
    return conversationId || null;
  };

  const isTrackedDmMediaChannel = (channelId?: string | null) => {
    const normalized = String(channelId ?? "").trim();
    if (!normalized) return false;

    const selectedConversationId = String(selectedDMRef.current?.id ?? "").trim();
    const activeConversationId = String(
      dmCallStateRef.current?.conversationId ?? ""
    ).trim();

    return (
      (!!selectedConversationId && normalized === `dm:${selectedConversationId}`) ||
      (!!activeConversationId && normalized === `dm:${activeConversationId}`)
    );
  };

  const playDmPresenceNotification = (
    channelId: string | null | undefined,
    sound: "screen-share-start" | "screen-share-stop",
    actorUserId?: string | null
  ) => {
    const normalizedChannelId = String(channelId ?? "").trim();
    const selfUserId = String(currentUserStateRef.current?.id ?? "").trim();

    if (!isTrackedDmMediaChannel(normalizedChannelId)) return;
    if (actorUserId && String(actorUserId) === selfUserId) return;

    const conversationId = getConversationIdFromMediaChannelId(normalizedChannelId);
    if (!conversationId) return;

    const settings = getDmNotificationSettings(conversationId);
    if (!settings?.message?.enabled) return;

    const volume = Number(settings?.message?.volume ?? 1);
    if (!Number.isFinite(volume) || volume <= 0) return;

    void playSound(sound, volume);
  };

  const getAnnouncementIdentityKey = (announcement: any) =>
    `${String(announcement?.participantId ?? "")}:${String(
      announcement?.trackSid ?? ""
    )}:${String(announcement?.source ?? "")}`;
  useEffect(() => {
    selectedDMRef.current = selectedDM;
  }, [selectedDM]);

  useEffect(() => {
    selectedChannelRef.current = selectedChannel;
  }, [selectedChannel]);

  useEffect(() => {
    isDMViewRef.current = isDMView;
  }, [isDMView]);

  useEffect(() => {
    dmCallStateRef.current = dmCallState;
  }, [dmCallState]);

  useEffect(() => {
    channelsRef.current = channels;
  }, [channels]);

  useEffect(() => {
    selectedServerIdRef.current = selectedServerId;
  }, [selectedServerId]);

  useEffect(() => {
    activeVoiceChannelIdRef.current = activeVoiceChannelId;
  }, [activeVoiceChannelId]);

  const refreshServerPermissions = async (serverId: string) => {
    const token = localStorage.getItem("token");
    if (!token || !serverId) return;

    const res = await fetch(`http://localhost:3001/servers/${serverId}/permissions`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    const data = await res.json().catch(() => null);

    if (!res.ok) {
      throw new Error(data?.error || "permissions alınamadı");
    }

    setServerPermissions({
      canManageServer: data?.canManageServer === true,
      canManageRoles: data?.canManageRoles === true,
      canManageChannels: data?.canManageChannels === true,
      canKickMembers: data?.canKickMembers === true,
      canBanMembers: data?.canBanMembers === true,
      canMuteMembers: data?.canMuteMembers === true,
      canDeafenMembers: data?.canDeafenMembers === true,
      canMoveMembers: data?.canMoveMembers === true,
      canDisconnectMembers: data?.canDisconnectMembers === true,
    });
  };

  const resetServerPermissions = () => {
    setServerPermissions({
      canManageServer: false,
      canManageRoles: false,
      canManageChannels: false,
      canKickMembers: false,
      canBanMembers: false,
      canMuteMembers: false,
      canDeafenMembers: false,
      canMoveMembers: false,
      canDisconnectMembers: false,
    });
  };

  useEffect(() => {
    if (!selectedServerId || isDMView) {
      resetServerPermissions();
      return;
    }

    let cancelled = false;

    refreshServerPermissions(selectedServerId).catch((err) => {
      console.error("server permissions fetch error:", err);
      if (!cancelled) {
        resetServerPermissions();
      }
    });

    return () => {
      cancelled = true;
    };
  }, [selectedServerId, isDMView]);

  useEffect(() => {
    onlineUsersRef.current = onlineUsers;
  }, [onlineUsers]);

  useEffect(() => {
    serverMembersRawRef.current = serverMembersRaw;
  }, [serverMembersRaw]);

  useEffect(() => {
    currentUserStateRef.current = currentUserState;
  }, [currentUserState]);

  useEffect(() => {
    emitUserIdentityMap();
  }, [onlineUsers, serverMembersRaw, currentUserState]);

  useEffect(() => {
  try {
    const snapshot =
      ((window as any)[STREAM_ANNOUNCEMENT_SNAPSHOT_KEY] || {}) as Record<string, any>;
    collectStreamingUserIdsFromSnapshot(snapshot);
  } catch {
    setStreamingUserIdsByChannel({});
  }
}, []);

  useEffect(() => {
    setCurrentUserState((prev) => ({
      ...prev,
      ...currentUser,
      avatarUrl: (currentUser as any)?.avatarUrl ?? prev.avatarUrl ?? null,
      status: (currentUser as any)?.status ?? prev.status ?? "online",
    }));
  }, [currentUser]);


  const incrementUnreadForServerChannel = (
    serverId: string,
    channelId: string,
    amount = 1
  ) => {
    if (!serverId || !channelId || amount <= 0) return;

    setChannelUnreadMap((prev) => ({
      ...prev,
      [channelId]: Math.max(0, Number(prev[channelId] || 0) + amount),
    }));

    setServerUnreadMap((prev) => ({
      ...prev,
      [serverId]: Math.max(0, Number(prev[serverId] || 0) + amount),
    }));
  };

  const clearUnreadForChannel = (channelId: string, serverId?: string | null) => {
    if (!channelId) return;

    const resolvedServerId =
      serverId ||
      channelsRef.current.find((channel) => String(channel.id) === String(channelId))?.serverId ||
      null;

    const removedCount = Number(channelUnreadMap[channelId] || 0);
    if (!removedCount) return;

    setChannelUnreadMap((prev) => {
      if (!prev[channelId]) return prev;
      const next = { ...prev };
      delete next[channelId];
      return next;
    });

    if (resolvedServerId) {
      setServerUnreadMap((prev) => {
        const current = Number(prev[resolvedServerId] || 0);
        if (!current) return prev;

        const nextValue = Math.max(0, current - removedCount);

        if (nextValue <= 0) {
          const next = { ...prev };
          delete next[resolvedServerId];
          return next;
        }

        return {
          ...prev,
          [resolvedServerId]: nextValue,
        };
      });
    }
  };


  const clearAllUnread = () => {
    setChannelUnreadMap({});
    setServerUnreadMap({});
  };

  useEffect(() => {
    if (isDMView) return;
    if (!selectedChannel || selectedChannel.type !== "text") return;

    const currentUnread = Number(channelUnreadMap[String(selectedChannel.id)] || 0);
    if (currentUnread <= 0) return;

    clearUnreadForChannel(String(selectedChannel.id), selectedChannel.serverId ?? selectedServerId);
  }, [selectedChannel?.id, selectedChannel?.type, selectedServerId, isDMView, channelUnreadMap]);

  const applyCurrentUserUpdate = (nextUser: Partial<CurrentUserState>) => {
    setCurrentUserState((prev) => {
      const merged = {
        ...prev,
        ...nextUser,
      };

      try {
        const existingRaw = localStorage.getItem("auth_user");
        const existing = existingRaw ? JSON.parse(existingRaw) : {};
        localStorage.setItem(
          "auth_user",
          JSON.stringify({
            ...existing,
            ...merged,
          })
        );
      } catch {}

      return merged;
    });
  };

  const emitUserIdentityMap = () => {
    const memberEntries = serverMembersRawRef.current.map((member) => [
      member.id,
      {
        displayName: member.displayName,
        username: member.username,
        avatarUrl: member.avatarUrl ?? null,
        highestRoleColor: resolveDisplayRoleColor(Array.isArray(member.roles) ? member.roles : []),
      },
    ]);

    const onlineEntries = onlineUsersRef.current.map((user) => [
      user.userId,
      {
        displayName: user.displayName,
        username: user.username,
        avatarUrl: user.avatarUrl ?? null,
        highestRoleColor: resolveDisplayRoleColor(
          Array.isArray(serverMembersRawRef.current.find((member) => member.id === user.userId)?.roles)
            ? serverMembersRawRef.current.find((member) => member.id === user.userId)!.roles!
            : []
        ),
      },
    ]);

    const self = currentUserStateRef.current;
    const map = Object.fromEntries([
      ...memberEntries,
      ...onlineEntries,
      [
        self.id,
        {
          displayName: self.displayName,
          username: self.username,
          avatarUrl: self.avatarUrl ?? null,
          highestRoleColor: resolveDisplayRoleColor(
            Array.isArray(serverMembersRawRef.current.find((member) => member.id === self.id)?.roles)
              ? serverMembersRawRef.current.find((member) => member.id === self.id)!.roles!
              : []
          ),
        },
      ],
    ]);

    try {
      (window as any)[USER_IDENTITY_SNAPSHOT_KEY] = map;
    } catch {}

    window.dispatchEvent(
      new CustomEvent(USER_IDENTITY_EVENT_NAME, {
        detail: { map },
      })
    );
  };



  const getVoicePresenceIdentityPatch = (
    userId: string,
    fallbackDisplayName?: string | null
  ) => {
    const liveUser = onlineUsersRef.current.find((item) => item.userId === userId);
    const member = serverMembersRawRef.current.find((item) => item.id === userId);
    const self = currentUserStateRef.current;

    return {
      displayName:
        liveUser?.displayName ||
        (self.id === userId ? self.displayName : undefined) ||
        member?.displayName ||
        fallbackDisplayName ||
        "Kullanıcı",
      username:
        liveUser?.username ||
        (self.id === userId ? self.username : undefined) ||
        member?.username,
      avatarUrl:
        liveUser?.avatarUrl ??
        (self.id === userId ? self.avatarUrl : undefined) ??
        member?.avatarUrl ??
        null,
    };
  };

  const enrichVoicePresenceUser = (item: VoicePresenceItem): VoicePresenceItem => {
    const patch = getVoicePresenceIdentityPatch(item.userId, item.displayName);
    return {
      ...item,
      displayName: patch.displayName,
      username: patch.username,
      avatarUrl: patch.avatarUrl,
    };
  };

  const emitServersUiRefresh = () => {
    window.dispatchEvent(new CustomEvent("vice-servers-updated"));
  };

  const emitNotificationsUiRefresh = () => {
    window.dispatchEvent(new CustomEvent("vice-notifications-updated"));
  };

  const refreshSocialAndServerState = async () => {
    await Promise.all([
      refreshFriends().catch((err) => console.error("friends refresh error:", err)),
      refreshIncomingServerInvites().catch((err) =>
        console.error("server invites refresh error:", err)
      ),
      refreshCurrentUserServers().catch((err) =>
        console.error("current user servers refresh error:", err)
      ),
      refreshBlockedUsers().catch((err) =>
        console.error("blocked users refresh error:", err)
      ),
    ]);
    emitServersUiRefresh();
    emitNotificationsUiRefresh();
  };

  useEffect(() => {
    const handleViceUserUpdated = (event: Event) => {
      const customEvent = event as CustomEvent<Partial<CurrentUserState>>;
      if (!customEvent.detail) return;
      applyCurrentUserUpdate(customEvent.detail);
    };

    window.addEventListener("vice-user-updated", handleViceUserUpdated as EventListener);
    return () => {
      window.removeEventListener(
        "vice-user-updated",
        handleViceUserUpdated as EventListener
      );
    };
  }, []);

  useEffect(() => {
    return () => {
      if (selfVoiceLeftGraceTimerRef.current) {
        window.clearTimeout(selfVoiceLeftGraceTimerRef.current);
        selfVoiceLeftGraceTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const onResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    const unlock = () => {
      resumeAudioContext().catch(() => {});
    };

    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });

    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  useEffect(() => {
    const close = () => setDmNotificationMenu(null);
    window.addEventListener("click", close);
    window.addEventListener("contextmenu", close);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("contextmenu", close);
      window.removeEventListener("resize", close);
    };
  }, []);

  useEffect(() => {
    const handler = (event: Event) => {
      const customEvent = event as CustomEvent<{
        channelId?: string | null;
        screen?: boolean;
      }>;

      const conversationId = String(customEvent.detail?.channelId ?? "");
      if (!conversationId) return;

      const nextScreen = Boolean(customEvent.detail?.screen);
      const prevScreen = Boolean(dmMediaScreenStateRef.current[conversationId]);
      if (prevScreen === nextScreen) return;

      dmMediaScreenStateRef.current[conversationId] = nextScreen;

      const settings = getDmNotificationSettings(conversationId);
      if (!settings.message.enabled) return;

      void playSound(
        nextScreen ? "screen-share-start" : "screen-share-stop",
        settings.message.volume
      );
    };

    window.addEventListener(DM_MEDIA_STATE_EVENT_NAME, handler as EventListener);
    return () => {
      window.removeEventListener(DM_MEDIA_STATE_EVENT_NAME, handler as EventListener);
    };
  }, []);

  useEffect(() => {
    const storedServerId = localStorage.getItem(
      SERVER_VOICE_SERVER_STORAGE_KEY
    );
    const storedChannelId = localStorage.getItem(
      SERVER_VOICE_CHANNEL_STORAGE_KEY
    );

    if (storedServerId) {
      setSelectedServerId((prev) => prev || storedServerId);
      setIsDMView(false);
    }

    if (storedChannelId) {
      setActiveVoiceChannelId((prev) => prev || storedChannelId);
    }
  }, []);

  useEffect(() => {
    setIsCollapsedAddFriendOpen(false);
    setCollapsedFriendName("");
    setCollapsedFriendError("");
    setCollapsedFriendSuccess("");
  }, [selectedServerId, isDMView]);

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) return;

    let cancelled = false;

    fetch("http://localhost:3001/auth/me", {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })
      .then(async (res) => {
        if (!res.ok) {
          const text = await res.text();
          throw new Error(text || "profil alınamadı");
        }
        return res.json();
      })
      .then((data) => {
        if (cancelled || !data) return;
        applyCurrentUserUpdate({
          id: data.id,
          username: data.username,
          displayName: data.displayName,
          role: data.role,
          avatarUrl: data.avatarUrl ?? null,
          status: data.status ?? "online",
        });
      })
      .catch((err) => {
        console.error("auth me fetch error:", err);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const handler = (event: Event) => {
      const customEvent = event as CustomEvent<{
        channelId?: string | null;
        announcements?: any[];
        emittedAt?: number;
        userId?: string | null;
        participantId?: string | null;
        trackSid?: string | null;
        source?: "camera" | "screen" | null;
      }>;

      const channelId = String(customEvent.detail?.channelId ?? "");
      if (!channelId) return;

      const rawAnnouncements = Array.isArray(customEvent.detail?.announcements)
        ? customEvent.detail.announcements
        : [];
      const emittedAt = Number(customEvent.detail?.emittedAt ?? Date.now());
      const actorUserId = customEvent.detail?.userId
        ? String(customEvent.detail.userId)
        : customEvent.detail?.participantId
          ? String(customEvent.detail.participantId)
          : rawAnnouncements[0]?.participantId
            ? String(rawAnnouncements[0].participantId)
            : undefined;
      const actorTrackSid = customEvent.detail?.trackSid
        ? String(customEvent.detail.trackSid)
        : rawAnnouncements[0]?.trackSid
          ? String(rawAnnouncements[0].trackSid)
          : undefined;
      const actorSource =
        customEvent.detail?.source === "camera" || customEvent.detail?.source === "screen"
          ? customEvent.detail.source
          : rawAnnouncements[0]?.source === "camera" || rawAnnouncements[0]?.source === "screen"
            ? rawAnnouncements[0].source
            : undefined;

      const rawDetail = {
        channelId,
        announcements: rawAnnouncements,
        emittedAt,
        userId: actorUserId,
        trackSid: actorTrackSid,
        source: actorSource,
      };

      try {
        const snapshot =
          ((window as any)[STREAM_ANNOUNCEMENT_SNAPSHOT_KEY] || {}) as Record<string, any>;
        const nextSnapshot = { ...snapshot };
        const currentEntry = nextSnapshot[channelId];
        const currentAnnouncements = Array.isArray(currentEntry?.announcements)
          ? currentEntry.announcements
          : [];

        const filterForActor = (item: any) => {
          if (actorTrackSid && String(item?.trackSid ?? "") === actorTrackSid) {
            return false;
          }
          if (actorUserId && actorSource) {
            return !(
              String(item?.participantId ?? "") === actorUserId &&
              item?.source === actorSource
            );
          }
          return true;
        };

        const mergedAnnouncements =
          rawAnnouncements.length > 0
            ? [...currentAnnouncements.filter(filterForActor), ...rawAnnouncements]
            : currentAnnouncements.filter(filterForActor);

        const mergedDetail = {
          channelId,
          announcements: mergedAnnouncements,
          emittedAt,
          userId: actorUserId,
          trackSid: actorTrackSid,
          source: actorSource,
        };

        if (mergedAnnouncements.length > 0) {
          nextSnapshot[channelId] = mergedDetail;
        } else {
          delete nextSnapshot[channelId];
        }

        (window as any)[STREAM_ANNOUNCEMENT_SNAPSHOT_KEY] = nextSnapshot;

        if (mergedAnnouncements.length > 0) {
          window.dispatchEvent(
            new CustomEvent(STREAM_ANNOUNCEMENT_EVENT_NAME, {
              detail: mergedDetail,
            })
          );
        } else {
          window.dispatchEvent(
            new CustomEvent(STREAM_ANNOUNCEMENT_CLEAR_EVENT_NAME, {
              detail: {
                channelId,
                emittedAt,
                userId: actorUserId,
                trackSid: actorTrackSid,
                source: actorSource,
              },
            })
          );
        }
      } catch {}

      const ws = globalWsRef.current;
if (!ws || ws.readyState !== WebSocket.OPEN) {
  collectStreamingUserIdsFromSnapshot(
    (((window as any)[STREAM_ANNOUNCEMENT_SNAPSHOT_KEY] || {}) as Record<string, any>)
  );
  return;
}

ws.send(
  JSON.stringify({
    type:
      rawAnnouncements.length > 0
        ? "VOICE_STREAM_ANNOUNCEMENTS_UPDATE"
        : "VOICE_STREAM_ANNOUNCEMENTS_CLEAR",
    payload: rawDetail,
  })
);
    };

    window.addEventListener(
      STREAM_ANNOUNCEMENT_UPSTREAM_EVENT_NAME,
      handler as EventListener
    );
    return () => {
      window.removeEventListener(
        STREAM_ANNOUNCEMENT_UPSTREAM_EVENT_NAME,
        handler as EventListener
      );
    };
  }, []);

  const isDmCallOngoing = dmCallState.status === "active";

  const clearUnreadForConversation = (conversationId: string) => {
    setDmUnreadMap((prev) => {
      if (!prev[conversationId]) return prev;
      return {
        ...prev,
        [conversationId]: 0,
      };
    });
  };

  const clearSharedVoiceUiState = () => {
    setIsConnected(false);
    setIsMuted(false);
    setIsDeafened(false);
    setVoiceParticipants([]);
    setActiveVoiceChannelId(null);
  };

  const clearStoredServerVoiceReconnect = () => {
    localStorage.removeItem(SERVER_VOICE_CHANNEL_STORAGE_KEY);
    localStorage.removeItem(SERVER_VOICE_SERVER_STORAGE_KEY);
  };

  const resetDmCallState = () => {
    stopDmCallLoop();
    setIgnoredIncomingConversationId(null);
    setDmCallState({
      conversationId: null,
      status: "idle",
      roomName: null,
      callerUserId: null,
      callerDisplayName: null,
      targetUserId: null,
      isAlone: false,
      aloneExpiresAt: null,
      selfLeft: false,
      canRejoin: false,
    });
  };

  const leaveServerVoiceBeforeDm = async () => {
    if (!activeVoiceChannelId) return;

    clearStoredServerVoiceReconnect();

    const token = localStorage.getItem("token");

    if (token) {
      try {
        await fetch("http://localhost:3001/voice/leave", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({}),
        });
      } catch (error) {
        console.error("server voice leave before dm error:", error);
      }
    }

    clearSharedVoiceUiState();
  };

  const toConversationLastMessage = (message: DmMessageLike) => ({
    id: message.id,
    content: message.deletedAt ? "" : message.content,
    createdAt: message.createdAt,
    senderUserId: message.senderUserId,
    editedAt: message.editedAt ?? null,
    attachments: message.deletedAt ? [] : (Array.isArray(message.attachments) ? message.attachments : []),
  });

  const upsertConversationWithLastMessage = (
    list: DmConversation[],
    conversationId: string,
    message: DmMessageLike
  ) => {
    const existing = list.find((item) => item.id === conversationId);
    if (!existing) return list;

    const updatedConversation: DmConversation = {
      ...existing,
      updatedAt: message.createdAt,
      lastMessage: toConversationLastMessage(message),
    };

    return [
      updatedConversation,
      ...list.filter((item) => item.id !== conversationId),
    ];
  };

  const applyDmMutationPreview = (
    type: DmRealtimeMutationEvent["type"],
    conversationId: string,
    message: DmMessageLike
  ) => {
    setDmRealtimeEvent({
      eventId: Date.now() + Math.floor(Math.random() * 1000),
      type,
      conversationId,
      message: { ...message, conversationId: message.conversationId || conversationId },
    });

    setDmConversations((prev) => {
      const existing = prev.find((item) => item.id === conversationId);
      if (!existing) {
        void refreshDmConversations().catch((err) => {
          console.error("dm conversations refresh error:", err);
        });
        return prev;
      }

      if (type === "DM_MESSAGE") {
        return upsertConversationWithLastMessage(prev, conversationId, message);
      }

      const updatedConversation: DmConversation = {
        ...existing,
        updatedAt:
          type === "DM_MESSAGE_UPDATED" || type === "DM_MESSAGE_PINNED" || type === "DM_MESSAGE_UNPINNED"
            ? new Date().toISOString()
            : existing.updatedAt,
        lastMessage:
          existing.lastMessage?.id === message.id
            ? toConversationLastMessage(message)
            : existing.lastMessage,
      };

      return [
        updatedConversation,
        ...prev.filter((item) => item.id !== conversationId),
      ];
    });

    setSelectedDM((prev) => {
      if (!prev || prev.id !== conversationId) return prev;

      const currentLastMessage = prev.lastMessage;
      const nextLastMessage =
        currentLastMessage?.id === message.id
          ? toConversationLastMessage(message)
          : currentLastMessage;

      return {
        ...prev,
        updatedAt:
          type === "DM_MESSAGE"
            ? message.createdAt
            : type === "DM_MESSAGE_UPDATED" || type === "DM_MESSAGE_PINNED" || type === "DM_MESSAGE_UNPINNED"
              ? new Date().toISOString()
              : prev.updatedAt,
        lastMessage: nextLastMessage,
      };
    });
  };

  const SYSTEM_MESSAGE_PREFIX = "__SYSTEM__:";

  type PreviewSystemMessageType =
    | "call_started"
    | "call_accepted"
    | "call_rejected"
    | "call_missed"
    | "call_ended";

  type PreviewSystemMeta = {
    type: PreviewSystemMessageType;
    actorUserId?: string | null;
    actorDisplayName?: string | null;
    targetUserId?: string | null;
    targetDisplayName?: string | null;
    durationSeconds?: number | null;
  };

  const tryDecodePreviewSystemMessage = (
    content: string | null | undefined
  ): PreviewSystemMeta | null => {
    const raw = String(content ?? "");
    if (!raw.startsWith(SYSTEM_MESSAGE_PREFIX)) return null;

    try {
      return JSON.parse(raw.slice(SYSTEM_MESSAGE_PREFIX.length));
    } catch {
      return null;
    }
  };

  const formatPreviewDuration = (seconds?: number | null) => {
    const total = Math.max(0, Math.floor(Number(seconds || 0)));
    const min = Math.floor(total / 60);
    const sec = total % 60;
    return `${String(min).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  };

  const getAttachmentPreviewText = (
    attachments?: DmAttachmentLike[] | null
  ) => {
    const list = Array.isArray(attachments) ? attachments : [];
    if (!list.length) return "";

    const imageCount = list.filter((item) => item.kind === "image").length;
    const videoCount = list.filter((item) => item.kind === "video").length;
    const fileCount = list.filter((item) => item.kind === "file").length;

    const parts: string[] = [];
    if (imageCount > 0) parts.push(imageCount > 1 ? `📷 ${imageCount} görsel` : "📷 Görsel");
    if (videoCount > 0) parts.push(videoCount > 1 ? `🎞️ ${videoCount} video` : "🎞️ Video");
    if (fileCount > 0) parts.push(fileCount > 1 ? `📎 ${fileCount} dosya` : "📎 Dosya");

    return parts.join(" • ");
  };

  const getConversationPreviewText = (
    content: string | null | undefined,
    currentUserId: string,
    fallbackOtherName: string,
    attachments?: DmAttachmentLike[] | null
  ) => {
    const raw = String(content ?? "").trim();
    const attachmentPreview = getAttachmentPreviewText(attachments);
    const meta = tryDecodePreviewSystemMessage(raw);

    if (!meta) {
      if (raw && attachmentPreview) return `${raw} • ${attachmentPreview}`;
      if (raw) return raw;
      if (attachmentPreview) return attachmentPreview;
      return "";
    }

    const actorName =
      meta.actorUserId === currentUserId
        ? "Sen"
        : meta.actorDisplayName || fallbackOtherName || "Kullanıcı";

    switch (meta.type) {
      case "call_started":
        return `📞 ${actorName} aramayı başlattı`;
      case "call_accepted":
        return "📞 Sesli görüşme başladı";
      case "call_rejected":
        return `❌ ${actorName} aramayı reddetti`;
      case "call_missed":
        return "📞 Cevapsız arama";
      case "call_ended":
        return `📞 Görüşme sona erdi • ${formatPreviewDuration(
          meta.durationSeconds
        )}`;
      default:
        return "Sistem mesajı";
    }
  };

  const getConversationPreviewWithFallback = (conversation: DmConversation) => {
    const fallbackName = conversation.otherUser?.displayName || "Kullanıcı";

    const primaryPreview = getConversationPreviewText(
      conversation.lastMessage?.content,
      currentUser.id,
      fallbackName,
      conversation.lastMessage?.attachments
    ).trim();

    if (primaryPreview) return primaryPreview;

    const selectedPreview =
      selectedDM?.id === conversation.id
        ? getConversationPreviewText(
            selectedDM.lastMessage?.content,
            currentUser.id,
            fallbackName,
            selectedDM.lastMessage?.attachments
          ).trim()
        : "";

    if (selectedPreview) return selectedPreview;

    if (dmCallState.conversationId === conversation.id) {
      if (dmCallState.status === "incoming") {
        return `📞 ${dmCallState.callerDisplayName || fallbackName} seni arıyor`;
      }
      if (dmCallState.status === "outgoing") {
        return `📞 ${fallbackName} aranıyor`;
      }
      if (dmCallState.status === "active") {
        return "📞 Sesli görüşme aktif";
      }
    }

    return "Henüz mesaj yok";
  };

  const filteredDmConversations = useMemo(() => {
    const q = dmSearchText.trim().toLowerCase();
    if (!q) return dmConversations;

    return dmConversations.filter((conversation) => {
      const displayName = conversation.otherUser?.displayName?.toLowerCase() ?? "";
      const username = conversation.otherUser?.username?.toLowerCase() ?? "";
      const lastMessage = getConversationPreviewWithFallback(conversation).toLowerCase();

      return (
        displayName.includes(q) ||
        username.includes(q) ||
        lastMessage.includes(q)
      );
    });
  }, [dmConversations, dmSearchText, currentUser.id]);

  const getDmConversationAvatarUrl = (conversation: DmConversation) => {
    const otherUserId = conversation.otherUser?.id ? String(conversation.otherUser.id) : "";
    if (!otherUserId) return null;

    return (
      conversation.otherUser?.avatarUrl ??
      onlineUsers.find((user) => user.userId === otherUserId)?.avatarUrl ??
      friendsRaw.find((friend) => friend.id === otherUserId)?.avatarUrl ??
      null
    );
  };

  const getDmNotificationSummary = (conversationId: string) => {
    return getDmNotificationSettings(conversationId);
  };

  const updateDmNotificationPreference = (
    conversationId: string,
    kind: "message" | "call",
    patch: { enabled?: boolean; volume?: number }
  ) => {
    updateDmNotificationSettings(conversationId, {
      [kind]: patch,
    } as any);
    setDmNotificationMenu((prev) =>
      prev && prev.conversationId === conversationId ? { ...prev } : prev
    );
  };

  const maybePlayDmMessageSound = (conversationId: string) => {
    const settings = getDmNotificationSettings(conversationId);
    if (!settings.message.enabled) return;
    void playSound("dm-message", settings.message.volume);
  };

  const maybePlayDmCallSound = (conversationId: string) => {
    const settings = getDmNotificationSettings(conversationId);
    if (!settings.call.enabled) return;
    startDmCallLoop(settings.call.volume);
  };

  const maybePlayServerMessageSound = (serverId: string) => {
    const settings = getServerNotificationSettings(serverId);
    if (!settings.message.enabled) return;
    void playSound("server-message", settings.message.volume);
  };

  const openDmNotificationMenu = (
    event: MouseEvent<HTMLButtonElement>,
    conversationId: string
  ) => {
    event.preventDefault();
    event.stopPropagation();
    setDmNotificationMenu({
      conversationId,
      x: event.clientX,
      y: event.clientY,
    });
  };


  const refreshChannels = async (serverId: string) => {
    const token = localStorage.getItem("token");
    if (!token) return;

    const res = await fetch(`http://localhost:3001/channels/server/${serverId}`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || "channels alınamadı");
    }

    const data: Channel[] = await res.json();
    const nextChannels = Array.isArray(data) ? data : [];
    setChannels(nextChannels);

    setVoicePresenceMap((prev) => {
      const next = { ...prev };
      for (const channel of nextChannels) {
        if (!next[channel.id]) {
          next[channel.id] = [];
        }
      }
      return next;
    });

    setSelectedChannel((prev) => {
      const activeVoiceChannel = activeVoiceChannelId
        ? nextChannels.find((c) => c.id === activeVoiceChannelId)
        : null;

      if (activeVoiceChannel) return activeVoiceChannel;

      if (prev) {
        const stillExists = nextChannels.find((c) => c.id === prev.id);
        if (stillExists) return stillExists;
      }
      return nextChannels[0] ?? null;
    });
  };

  const refreshServerMembers = async (serverId: string) => {
    const token = localStorage.getItem("token");
    if (!token) return;

    const res = await fetch(`http://localhost:3001/servers/${serverId}/members`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || "server members alınamadı");
    }

    const data = await res.json();
    setServerMembersRaw(Array.isArray(data) ? data : []);
  };

  const refreshSelectedServerMembers = async () => {
    if (!selectedServerIdRef.current) return;
    await refreshServerMembers(selectedServerIdRef.current);
  };

  const refreshSelectedServerPermissions = async () => {
    if (!selectedServerIdRef.current || isDMViewRef.current) return;
    await refreshServerPermissions(selectedServerIdRef.current);
  };

  useEffect(() => {
    if (!selectedServerId) return;

    const selectedServerChannelIds = new Set(
      channels
        .filter((channel) => String(channel.serverId ?? "") === String(selectedServerId))
        .map((channel) => String(channel.id))
    );

    if (selectedServerChannelIds.size === 0) return;

    const moderationStateByUserId = new Map<
      string,
      { serverMuted: boolean; serverDeafened: boolean }
    >();

    for (const member of serverMembersRaw) {
      moderationStateByUserId.set(String(member.id), {
        serverMuted: member.serverMuted === true,
        serverDeafened: member.serverDeafened === true,
      });
    }

    if (moderationStateByUserId.size === 0) return;

    setVoicePresenceMap((prev) => {
      let changed = false;
      const next: Record<string, VoicePresenceItem[]> = {};

      for (const [channelId, members] of Object.entries(prev)) {
        if (!selectedServerChannelIds.has(String(channelId))) {
          next[channelId] = members;
          continue;
        }

        const patchedMembers = (members || []).map((member) => {
          const moderationState = moderationStateByUserId.get(String(member.userId));
          if (!moderationState) return member;

          const nextServerMuted = moderationState.serverMuted;
          const nextServerDeafened = moderationState.serverDeafened;
          const nextMuted = Boolean(member.selfMuted) || nextServerMuted;
          const nextDeafened = Boolean(member.selfDeafened) || nextServerDeafened;

          if (
            member.serverMuted === nextServerMuted &&
            member.serverDeafened === nextServerDeafened &&
            member.muted === nextMuted &&
            member.deafened === nextDeafened
          ) {
            return member;
          }

          changed = true;
          return {
            ...member,
            serverMuted: nextServerMuted,
            serverDeafened: nextServerDeafened,
            muted: nextMuted,
            deafened: nextDeafened,
          };
        });

        next[channelId] = patchedMembers;
      }

      return changed ? next : prev;
    });
  }, [channels, selectedServerId, serverMembersRaw]);

  const refreshFriends = async () => {
    const token = localStorage.getItem("token");
    if (!token) return;

    const [friendsRes, incomingRes] = await Promise.all([
      fetch("http://localhost:3001/friends", {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }),
      fetch("http://localhost:3001/friends/incoming", {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }),
    ]);

    if (friendsRes.ok) {
      const friendsData = await friendsRes.json();
      setFriendsRaw(Array.isArray(friendsData) ? friendsData : []);
    }

    if (incomingRes.ok) {
      const incomingData = await incomingRes.json();
      setIncomingRequests(
        Array.isArray(incomingData)
          ? incomingData.map((item: any) => ({
              id: String(item.id ?? ""),
              username: String(item.username ?? ""),
              displayName: String(item.displayName ?? item.display_name ?? item.username ?? "Kullanıcı"),
              avatarUrl:
                item.avatarUrl === undefined && item.avatar_url === undefined
                  ? null
                  : item.avatarUrl ?? item.avatar_url ?? null,
              createdAt: String(item.createdAt ?? item.created_at ?? new Date().toISOString()),
            }))
          : []
      );
    }
  };

  const refreshCurrentUserServers = async () => {
    const token = localStorage.getItem("token");
    if (!token) return;

    const res = await fetch("http://localhost:3001/servers/my", {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || "servers alınamadı");
    }

    const data = await res.json();
    const safeServers = Array.isArray(data)
      ? data.map((item: any) => ({
          id: String(item?.id ?? ""),
          name: String(item?.name ?? "Server"),
          ownerId: item?.ownerId ?? item?.owner_id ?? undefined,
          avatarUrl:
            item?.avatarUrl === undefined && item?.avatar_url === undefined
              ? null
              : item?.avatarUrl ?? item?.avatar_url ?? null,
        }))
      : [];

    setCurrentUserServers(safeServers);

    if (selectedServerIdRef.current) {
      const activeServer = safeServers.find(
        (item) => item.id === selectedServerIdRef.current
      );
      if (activeServer) {
        setSelectedServerName(activeServer.name);
        setSelectedServerAvatarUrl(activeServer.avatarUrl ?? null);
      }
    }
  };

  const refreshBlockedUsers = async () => {
    const token = localStorage.getItem("token");
    if (!token) return;

    const res = await fetch("http://localhost:3001/blocks", {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || "blocked users alınamadı");
    }

    const data = await res.json();
    setBlockedUsers(
      Array.isArray(data)
        ? data.map((item: any) => ({
            id: String(item.id ?? item.blockedUserId ?? item.blocked_user_id ?? ""),
            username: item.username ? String(item.username) : undefined,
            displayName: String(item.displayName ?? item.display_name ?? item.username ?? "Kullanıcı"),
            avatarUrl:
              item.avatarUrl === undefined && item.avatar_url === undefined
                ? null
                : item.avatarUrl ?? item.avatar_url ?? null,
          }))
        : []
    );
  };

  const refreshIncomingServerInvites = async () => {
    const token = localStorage.getItem("token");
    if (!token) return;

    const res = await fetch("http://localhost:3001/servers/invites/incoming", {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || "server invites alınamadı");
    }

    const data = await res.json();

    setIncomingServerInvites(
      Array.isArray(data)
        ? data.map((item: any) => ({
            id: String(item.id ?? ""),
            serverName: String(
              item.serverName ?? item.server_name ?? item.name ?? "Sunucu"
            ),
            inviterDisplayName: String(
              item.inviterDisplayName ??
                item.inviter_display_name ??
                item.createdByDisplayName ??
                "Kullanıcı"
            ),
            inviterUserId:
              item.inviterUserId === undefined && item.inviter_user_id === undefined
                ? undefined
                : String(item.inviterUserId ?? item.inviter_user_id ?? ""),
            avatarUrl:
              item.avatarUrl === undefined &&
              item.serverAvatarUrl === undefined &&
              item.server_avatar_url === undefined
                ? null
                : item.avatarUrl ??
                  item.serverAvatarUrl ??
                  item.server_avatar_url ??
                  null,
            createdAt: String(
              item.createdAt ?? item.created_at ?? new Date().toISOString()
            ),
          }))
        : []
    );
  };

  const refreshDmConversations = async (): Promise<DmConversation[]> => {
    const token = localStorage.getItem("token");
    if (!token) return [];

    const res = await fetch("http://localhost:3001/dm/conversations", {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || "dm conversations alınamadı");
    }

    const data = await res.json();
    const nextConversations = Array.isArray(data) ? data : [];
    setDmConversations(nextConversations);

    setSelectedDM((prev) => {
      if (prev) {
        const stillExists = nextConversations.find((item) => item.id === prev.id);
        if (stillExists) return stillExists;
      }
      return nextConversations[0] ?? null;
    });

    return nextConversations;
  };

  const ensureDmConversationOpen = async (conversationId: string) => {
    setIsDMView(true);
    setSelectedServerId(null);
    setDmSearchText("");

    const existing =
      selectedDMRef.current?.id === conversationId
        ? selectedDMRef.current
        : dmConversations.find((c) => c.id === conversationId) || null;

    if (existing) {
      setSelectedDM(existing);
      clearUnreadForConversation(conversationId);
      return;
    }

    try {
      const nextConversations = await refreshDmConversations();
      const found = nextConversations.find((c) => c.id === conversationId) || null;
      if (found) {
        setSelectedDM(found);
        clearUnreadForConversation(conversationId);
      }
    } catch (err) {
      console.error("ensure dm conversation open error:", err);
    }
  };

  const sendDmWsEvent = (payload: unknown) => {
    const ws = globalWsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      console.error("DM websocket hazır değil");
      return false;
    }

    ws.send(JSON.stringify(payload));
    return true;
  };

  const requestEndActiveDmCall = async (conversationId: string) => {
    const sent = sendDmWsEvent({
      type: "DM_CALL_END",
      payload: { conversationId },
    });

    if (!sent) {
      throw new Error("Çağrıdan ayrılamadın. WebSocket hazır değil.");
    }
  };

  const startDmCall = async (conversationId: string) => {
    setIgnoredIncomingConversationId(null);

    setDmCallState((prev) => ({
      ...prev,
      conversationId,
      status: "outgoing",
      roomName: prev.roomName || `dm:${conversationId}`,
      selfLeft: false,
      canRejoin: false,
      isAlone: false,
      aloneExpiresAt: null,
    }));

    const sent = sendDmWsEvent({
      type: "DM_CALL_START",
      payload: { conversationId },
    });

    if (!sent) {
      throw new Error("Çağrı başlatılamadı. WebSocket hazır değil.");
    }
  };

  const rejoinDmCall = async (conversationId: string) => {
    await startDmCall(conversationId);
  };

  const acceptDmCall = async (conversationId: string) => {
    setIgnoredIncomingConversationId(null);
    await leaveServerVoiceBeforeDm();
    await ensureDmConversationOpen(conversationId);

    setDmCallState((prev) => ({
      ...prev,
      conversationId,
      status: "active",
      roomName: prev.roomName || `dm:${conversationId}`,
      selfLeft: false,
      canRejoin: false,
      isAlone: false,
      aloneExpiresAt: null,
    }));

    const sent = sendDmWsEvent({
      type: "DM_CALL_ACCEPT",
      payload: { conversationId },
    });

    if (!sent) {
      throw new Error("Çağrı kabul edilemedi. WebSocket hazır değil.");
    }
  };

  const rejectDmCall = (conversationId: string) => {
    const sent = sendDmWsEvent({
      type: "DM_CALL_REJECT",
      payload: { conversationId },
    });

    if (!sent) {
      throw new Error("Çağrı reddedilemedi. WebSocket hazır değil.");
    }
  };


  const ignoreDmCall = (conversationId: string) => {
    if (!conversationId) return;
    stopDmCallLoop();
    setIgnoredIncomingConversationId(conversationId);
  };


  useEffect(() => {
    if (isDMView || !selectedChannel || selectedChannel.type !== "text") return;
    clearUnreadForChannel(selectedChannel.id, selectedChannel.serverId);
  }, [selectedChannel?.id, selectedChannel?.serverId, selectedChannel?.type, isDMView]);

  const handleSelectServer = (serverId: string | null) => {
    setIsDMView(false);
    setSelectedDM(null);
    setDmSearchText("");
    setSelectedServerId(serverId);
  };

  const handleOpenDMHome = async () => {
    setIsDMView(true);
    setSelectedServerId(null);
    setDmSearchText("");

    try {
      await refreshDmConversations();
    } catch (err) {
      console.error("dm conversations fetch error:", err);
      setDmConversations([]);
      setSelectedDM(null);
    }
  };

  const handleSelectDMConversation = (conversation: DmConversation) => {
    setSelectedDM(conversation);
    clearUnreadForConversation(conversation.id);
  };

  const handleOpenDMWithUser = async (targetUserId: string) => {
    const token = localStorage.getItem("token");
    if (!token) {
      throw new Error("Oturum bulunamadı.");
    }

    const res = await fetch("http://localhost:3001/dm/conversations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ targetUserId }),
    });

    const data = await res.json().catch(() => null);

    if (!res.ok) {
      throw new Error(data?.error || "DM başlatılamadı.");
    }

    const conversation = data?.conversation as DmConversation;

    setIsDMView(true);
    setSelectedServerId(null);
    setDmSearchText("");

    setDmConversations((prev) => {
      const filtered = prev.filter((item) => item.id !== conversation.id);
      return [conversation, ...filtered];
    });

    setSelectedDM(conversation);
    clearUnreadForConversation(conversation.id);

    refreshDmConversations().catch((err) => {
      console.error("dm conversations refresh error:", err);
    });
  };

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token || !selectedServerId || isDMView) return;

    refreshChannels(selectedServerId).catch((err) => {
      console.error("channels fetch error:", err);
      setChannels([]);
      setSelectedChannel(null);
    });

    refreshServerMembers(selectedServerId).catch((err) => {
      console.error("server members fetch error:", err);
      setServerMembersRaw([]);
    });
  }, [selectedServerId, isDMView]);

  useEffect(() => {
    refreshFriends().catch((err) => {
      console.error("friends fetch error:", err);
    });

    refreshIncomingServerInvites().catch((err) => {
      console.error("server invites fetch error:", err);
      setIncomingServerInvites([]);
    });

    refreshCurrentUserServers().catch((err) => {
      console.error("current user servers fetch error:", err);
      setCurrentUserServers([]);
    });

    refreshBlockedUsers().catch((err) => {
      console.error("blocked users fetch error:", err);
      setBlockedUsers([]);
    });
  }, []);

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token || !selectedServerId || isDMView) return;

    fetch("http://localhost:3001/servers/my", {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })
      .then(async (res) => {
        if (!res.ok) {
          const text = await res.text();
          throw new Error(text || "servers alınamadı");
        }
        return res.json();
      })
      .then((data: ServerItem[]) => {
        const safeServers = Array.isArray(data) ? data : [];
        setCurrentUserServers(safeServers);

        const found = safeServers.find((item) => item.id === selectedServerId);
        setSelectedServerName(found?.name || "");
        setSelectedServerAvatarUrl(found?.avatarUrl ?? null);
      })
      .catch((err) => {
        console.error("server name fetch error:", err);
      });
  }, [selectedServerId, isDMView]);

  useEffect(() => {
    const authToken = localStorage.getItem("token");
    if (!authToken) return;

    let disposed = false;

    const clearReconnectTimer = () => {
      if (reconnectTimeoutRef.current != null) {
        window.clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
    };

    const hardCloseSocket = (socket?: WebSocket | null) => {
      const ws = socket ?? globalWsRef.current;
      if (!ws) return;

      try {
        ws.onopen = null;
        ws.onmessage = null;
        ws.onerror = null;
        ws.onclose = null;
      } catch {}

      try {
        if (
          ws.readyState === WebSocket.OPEN ||
          ws.readyState === WebSocket.CONNECTING
        ) {
          ws.close(1000, "client_unloading");
        }
      } catch {}
    };

    const handleWindowGoingAway = () => {
      clearReconnectTimer();
      setIsGlobalWsReady(false);

      const ws = globalWsRef.current;
      globalWsRef.current = null;
      hardCloseSocket(ws);
    };

    closeGlobalWsRef.current = handleWindowGoingAway;

    const connect = () => {
      if (disposed) return;

      const ws = new WebSocket(
        `ws://localhost:3001/ws?token=${encodeURIComponent(authToken)}`
      );

      globalWsRef.current = ws;

      ws.onopen = () => {
        if (disposed) {
          hardCloseSocket(ws);
          return;
        }

        if (globalWsRef.current !== ws) {
          hardCloseSocket(ws);
          return;
        }

        setIsGlobalWsReady(true);
        clearReconnectTimer();
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);

          if (message.type === "ONLINE_USERS") {
            setOnlineUsers(
              Array.isArray(message.payload)
                ? message.payload.map((item: any) => ({
                    userId: String(item?.userId ?? ""),
                    username: item?.username ? String(item.username) : undefined,
                    displayName: String(item?.displayName ?? "User"),
                    avatarUrl: item?.avatarUrl ?? null,
                    status: (item?.status ?? "online") as UserStatus,
                  }))
                : []
            );
            return;
          }

          if (message.type === "USER_STATUS_UPDATED") {
            const userId = String(message.payload?.userId ?? "");
            const status = (message.payload?.status ?? "online") as UserStatus;
            if (!userId) return;

            setOnlineUsers((prev) =>
              prev.map((user) =>
                user.userId === userId ? { ...user, status } : user
              )
            );

            if (userId === currentUser.id) {
              applyCurrentUserUpdate({ status });
            }
            return;
          }

          if (message.type === "USER_PROFILE_UPDATED") {
            const userId = String(message.payload?.userId ?? "");
            if (!userId) return;

            const patch: {
              displayName?: string;
              username?: string;
              avatarUrl?: string | null;
            } = {
              displayName: message.payload?.displayName
                ? String(message.payload.displayName)
                : undefined,
              username: message.payload?.username
                ? String(message.payload.username)
                : undefined,
              avatarUrl:
                message.payload?.avatarUrl === undefined
                  ? undefined
                  : message.payload?.avatarUrl ?? null,
            };

            setOnlineUsers((prev) =>
              prev.map((user) =>
                user.userId === userId
                  ? {
                      ...user,
                      ...(patch.displayName ? { displayName: patch.displayName } : {}),
                      ...(patch.username !== undefined ? { username: patch.username } : {}),
                      ...(patch.avatarUrl !== undefined ? { avatarUrl: patch.avatarUrl } : {}),
                    }
                  : user
              )
            );

            if (userId === currentUser.id) {
              applyCurrentUserUpdate({
                ...(patch.displayName ? { displayName: patch.displayName } : {}),
                ...(patch.avatarUrl !== undefined ? { avatarUrl: patch.avatarUrl } : {}),
              });
            }

            setServerMembersRaw((prev) =>
              prev.map((member) =>
                member.id === userId
                  ? {
                      ...member,
                      ...(patch.displayName ? { displayName: patch.displayName } : {}),
                      ...(patch.avatarUrl !== undefined ? { avatarUrl: patch.avatarUrl } : {}),
                    }
                  : member
              )
            );

            setFriendsRaw((prev) =>
              prev.map((friend) =>
                friend.id === userId
                  ? {
                      ...friend,
                      ...(patch.displayName ? { displayName: patch.displayName } : {}),
                      ...(patch.avatarUrl !== undefined ? { avatarUrl: patch.avatarUrl } : {}),
                    }
                  : friend
              )
            );

            setIncomingRequests((prev) =>
              prev.map((request) =>
                request.id === userId
                  ? {
                      ...request,
                      ...(patch.displayName ? { displayName: patch.displayName } : {}),
                      ...(patch.avatarUrl !== undefined ? { avatarUrl: patch.avatarUrl } : {}),
                    }
                  : request
              )
            );

            setIncomingServerInvites((prev) =>
              prev.map((invite) =>
                String(invite.inviterUserId ?? "") === userId
                  ? {
                      ...invite,
                      ...(patch.displayName
                        ? { inviterDisplayName: patch.displayName }
                        : {}),
                    }
                  : invite
              )
            );

            setBlockedUsers((prev) =>
              prev.map((user) =>
                user.id === userId
                  ? {
                      ...user,
                      ...(patch.displayName ? { displayName: patch.displayName } : {}),
                      ...(patch.avatarUrl !== undefined ? { avatarUrl: patch.avatarUrl } : {}),
                    }
                  : user
              )
            );

            setVoicePresenceMap((prev) => {
              const next: Record<string, VoicePresenceItem[]> = {};
              for (const [channelId, members] of Object.entries(prev)) {
                next[channelId] = (members || []).map((member) =>
                  member.userId === userId
                    ? {
                        ...member,
                        ...(patch.displayName ? { displayName: patch.displayName } : {}),
                        ...(patch.username !== undefined ? { username: patch.username as string | undefined } : {}),
                        ...(patch.avatarUrl !== undefined ? { avatarUrl: patch.avatarUrl } : {}),
                      }
                    : member
                );
              }
              return next;
            });

            return;
          }


          if (message.type === "FRIEND_REQUESTS_UPDATED") {
            const affectedUserIds = Array.isArray(message.payload?.userIds)
              ? message.payload.userIds.map((x: any) => String(x))
              : [];
            if (affectedUserIds.includes(currentUser.id)) {
              void refreshFriends().catch((err) => {
                console.error("friend requests live refresh error:", err);
              });
              emitNotificationsUiRefresh();
            }
            return;
          }

          if (message.type === "FRIENDS_UPDATED") {
            const affectedUserIds = Array.isArray(message.payload?.userIds)
              ? message.payload.userIds.map((x: any) => String(x))
              : [];
            if (affectedUserIds.includes(currentUser.id)) {
              void refreshFriends().catch((err) => {
                console.error("friends live refresh error:", err);
              });
            }
            return;
          }

          if (message.type === "SERVER_INVITES_UPDATED") {
            const affectedUserIds = Array.isArray(message.payload?.userIds)
              ? message.payload.userIds.map((x: any) => String(x))
              : [];
            if (affectedUserIds.includes(currentUser.id)) {
              void refreshIncomingServerInvites().catch((err) => {
                console.error("server invites live refresh error:", err);
              });
              emitNotificationsUiRefresh();
            }
            return;
          }

          if (message.type === "BLOCKS_UPDATED") {
            const affectedUserIds = Array.isArray(message.payload?.userIds)
              ? message.payload.userIds.map((x: any) => String(x))
              : [];
            if (affectedUserIds.includes(currentUser.id)) {
              void Promise.all([
                refreshBlockedUsers(),
                refreshFriends(),
                selectedServerIdRef.current
                  ? refreshServerMembers(selectedServerIdRef.current)
                  : Promise.resolve(),
              ]).catch((err) => {
                console.error("blocks live refresh error:", err);
              });
            }
            return;
          }

          if (message.type === "SERVERS_UPDATED") {
  const affectedUserIds = Array.isArray(message.payload?.userIds)
    ? message.payload.userIds.map((x: any) => String(x))
    : [];
  const serverId = String(message.payload?.serverId ?? "");
  const reason = String(message.payload?.reason ?? "");

  const isCurrentUserAffected = affectedUserIds.includes(currentUser.id);
  const isViewingAffectedServer =
    Boolean(serverId) && selectedServerIdRef.current === serverId;

  if (isCurrentUserAffected) {
    void refreshCurrentUserServers()
      .then(async () => {
        emitServersUiRefresh();

        if (serverId && selectedServerIdRef.current === serverId) {
          if (reason === "deleted" || reason === "removed") {
            setSelectedServerId(null);
            setSelectedServerName("");
            setChannels([]);
            setSelectedChannel(null);
            setServerMembersRaw([]);
            setVoicePresenceMap((prev) => ({ ...prev }));
          } else if (reason === "left") {
            const stillMember = await fetch("http://localhost:3001/servers/my", {
              headers: {
                Authorization: `Bearer ${localStorage.getItem("token") || ""}`,
              },
            })
              .then((res) => (res.ok ? res.json() : []))
              .then((rows) =>
                Array.isArray(rows)
                  ? rows.some((row: any) => String(row?.id ?? "") === serverId)
                  : false
              )
              .catch(() => false);

            if (!stillMember) {
              setSelectedServerId(null);
              setSelectedServerName("");
              setChannels([]);
              setSelectedChannel(null);
              setServerMembersRaw([]);
              setVoicePresenceMap((prev) => ({ ...prev }));
            } else {
              await Promise.all([
                refreshChannels(serverId).catch((err) =>
                  console.error("channels live refresh error:", err)
                ),
                refreshServerMembers(serverId).catch((err) =>
                  console.error("server members live refresh error:", err)
                ),
                refreshServerPermissions(serverId).catch((err) =>
                  console.error("server permissions live refresh error:", err)
                ),
              ]);
            }
          } else {
            await Promise.all([
              refreshChannels(serverId).catch((err) =>
                console.error("channels live refresh error:", err)
              ),
              refreshServerMembers(serverId).catch((err) =>
                console.error("server members live refresh error:", err)
              ),
              refreshServerPermissions(serverId).catch((err) =>
                console.error("server permissions live refresh error:", err)
              ),
            ]);
          }
        }
      })
      .catch((err) => {
        console.error("servers live refresh error:", err);
      });

    return;
  }

  if (isViewingAffectedServer) {
    void Promise.all([
      refreshChannels(serverId).catch((err) =>
        console.error("channels passive live refresh error:", err)
      ),
      refreshServerMembers(serverId).catch((err) =>
        console.error("server members passive live refresh error:", err)
      ),
      refreshServerPermissions(serverId).catch((err) =>
        console.error("server permissions passive live refresh error:", err)
      ),
    ]);

    return;
  }

  return;
}


          if (message.type === "TEXT_CHANNEL_UNREAD") {
            const serverId = String(message.payload?.serverId ?? "");
            const channelId = String(message.payload?.channelId ?? "");
            const actorUserId = String(message.payload?.actorUserId ?? "");
            const amount = Math.max(1, Number(message.payload?.count ?? 1) || 1);

            if (!serverId || !channelId) return;
            if (actorUserId && actorUserId === currentUser.id) return;

            const selectedLiveChannel = selectedChannelRef.current;
            const isSameOpenTextChannel =
              !isDMViewRef.current &&
              selectedLiveChannel?.type === "text" &&
              String(selectedLiveChannel?.id ?? "") === channelId;

            if (!isSameOpenTextChannel) {
              incrementUnreadForServerChannel(serverId, channelId, amount);
              maybePlayServerMessageSound(serverId);
            }

            return;
          }

          if (message.type === "VOICE_SNAPSHOT") {
            const incomingPresence = message.payload?.presence ?? {};

            setVoicePresenceMap(() => {
              const next: Record<string, VoicePresenceItem[]> = {};

              for (const channel of channelsRef.current) {
                next[channel.id] = Array.isArray(incomingPresence[channel.id])
                  ? (incomingPresence[channel.id] as VoicePresenceItem[]).map(enrichVoicePresenceUser)
                  : [];
              }

              for (const [channelId, members] of Object.entries(incomingPresence)) {
                if (!next[channelId]) {
                  next[channelId] = Array.isArray(members)
                    ? (members as VoicePresenceItem[]).map(enrichVoicePresenceUser)
                    : [];
                }
              }

              return next;
            });

            return;
          }

          if (message.type === "VOICE_JOINED") {
            const { channelId, user } = message.payload;
            const enrichedUser = enrichVoicePresenceUser(user as VoicePresenceItem);
            playServerPresenceNotification(
              String(channelId ?? ""),
              "voice-join",
              String((user as any)?.userId ?? enrichedUser.userId ?? "")
            );
            const joinedChannelId = String(channelId ?? "");
            const joinedUserId = String(enrichedUser.userId ?? "");
            const selfUserId = String(currentUserStateRef.current?.id ?? "");
            const isSelfVoiceMove = Boolean(
              joinedChannelId &&
              joinedUserId &&
              joinedUserId === selfUserId &&
              activeVoiceChannelIdRef.current !== joinedChannelId
            );

            setVoicePresenceMap((prev) => {
              const next: Record<string, VoicePresenceItem[]> = {};

              for (const key of Object.keys(prev)) {
                next[key] = (prev[key] || []).filter((x) => x.userId !== enrichedUser.userId);
              }

              next[joinedChannelId] = [...(next[joinedChannelId] || []), enrichedUser];
              return next;
            });

            if (joinedUserId && joinedUserId === selfUserId && joinedChannelId) {
              if (selfVoiceLeftGraceTimerRef.current) {
                window.clearTimeout(selfVoiceLeftGraceTimerRef.current);
                selfVoiceLeftGraceTimerRef.current = null;
              }

              setActiveVoiceChannelId(joinedChannelId);

              const targetChannel = channelsRef.current.find(
                (channel) => String(channel.id) === joinedChannelId
              ) || null;

              if (targetChannel) {
                setSelectedChannel((prev) => {
                  if (!prev) return targetChannel;
                  if (prev.type !== "voice") return prev;
                  if (String(prev.id) === joinedChannelId) return prev;
                  return targetChannel;
                });

                if (isSelfVoiceMove) {
                  window.dispatchEvent(
                    new CustomEvent("vice-join-voice-channel", {
                      detail: { channel: targetChannel },
                    })
                  );
                }
              }
            }

            return;
          }

          if (message.type === "VOICE_LEFT") {
            const { channelId, userId } = message.payload;
            const leftChannelId = String(channelId ?? "");
            playServerPresenceNotification(leftChannelId, "voice-leave", String(userId ?? ""));
            const leftUserId = String(userId ?? "");
            const selfUserId = String(currentUserStateRef.current?.id ?? "");

            setVoicePresenceMap((prev) => ({
              ...prev,
              [leftChannelId]: (prev[leftChannelId] || []).filter((x) => x.userId !== leftUserId),
            }));

            if (leftUserId && leftUserId === selfUserId && leftChannelId) {
              if (selfVoiceLeftGraceTimerRef.current) {
                window.clearTimeout(selfVoiceLeftGraceTimerRef.current);
              }

              selfVoiceLeftGraceTimerRef.current = window.setTimeout(() => {
                selfVoiceLeftGraceTimerRef.current = null;

                const stillActiveChannelId = String(activeVoiceChannelIdRef.current ?? "");
                const stillInPresence = Boolean(
                  stillActiveChannelId &&
                  (voicePresenceMap[stillActiveChannelId] || []).some(
                    (item) => String(item.userId) === selfUserId
                  )
                );

                if (stillInPresence) return;

                window.dispatchEvent(
                  new CustomEvent(FORCE_SERVER_VOICE_LEFT_EVENT_NAME, {
                    detail: {
                      channelId: leftChannelId,
                      userId: selfUserId,
                    },
                  })
                );
              }, 120);
            }

            return;
          }

          if (message.type === "VOICE_UPDATED") {
            const { channelId, user } = message.payload;
            const enrichedUser = enrichVoicePresenceUser(user as VoicePresenceItem);

            setVoicePresenceMap((prev) => {
              const next: Record<string, VoicePresenceItem[]> = {};

              for (const key of Object.keys(prev)) {
                next[key] = (prev[key] || []).filter((x) => x.userId !== enrichedUser.userId);
              }

              next[channelId] = [...(next[channelId] || []), enrichedUser];
              return next;
            });

            return;
          }

          if (message.type === "VOICE_STREAM_ANNOUNCEMENTS_SNAPSHOT") {
            const incoming =
              message.payload?.announcementsByChannel &&
              typeof message.payload.announcementsByChannel === "object"
                ? message.payload.announcementsByChannel
                : {};

            try {
              (window as any)[STREAM_ANNOUNCEMENT_SNAPSHOT_KEY] = incoming;
            } catch {}

            collectStreamingUserIdsFromSnapshot(incoming as Record<string, any>);

            for (const detail of Object.values(incoming as Record<string, any>)) {
              window.dispatchEvent(
                new CustomEvent(STREAM_ANNOUNCEMENT_EVENT_NAME, {
                  detail,
                })
              );
            }

            return;
          }

          if (message.type === "VOICE_STREAM_ANNOUNCEMENTS_UPDATED") {
            const channelId = String(message.payload?.channelId ?? "");
            if (!channelId) return;

            const detail = {
              channelId,
              announcements: Array.isArray(message.payload?.announcements)
                ? message.payload.announcements
                : [],
              emittedAt: Number(message.payload?.updatedAt ?? Date.now()),
            };

            try {
              const snapshot =
                ((window as any)[STREAM_ANNOUNCEMENT_SNAPSHOT_KEY] || {}) as Record<string, any>;
              const previousAnnouncements = Array.isArray(snapshot[channelId]?.announcements)
                ? snapshot[channelId].announcements
                : [];
              const previousScreenKeys = new Set(
                previousAnnouncements
                  .filter((item: any) => item?.source === "screen")
                  .map((item: any) => getAnnouncementIdentityKey(item))
              );
              const nextSnapshot = {
                ...snapshot,
                [channelId]: detail,
              };
              (window as any)[STREAM_ANNOUNCEMENT_SNAPSHOT_KEY] = nextSnapshot;
              collectStreamingUserIdsFromSnapshot(nextSnapshot);

              const newlyAddedRemoteScreen = detail.announcements.find((item: any) => {
                if (item?.source !== "screen") return false;
                const key = getAnnouncementIdentityKey(item);
                return !previousScreenKeys.has(key);
              });

              if (newlyAddedRemoteScreen) {
                const actorUserId = String(newlyAddedRemoteScreen?.participantId ?? "");
                if (channelId.startsWith("dm:")) {
                  playDmPresenceNotification(channelId, "screen-share-start", actorUserId);
                } else {
                  playServerPresenceNotification(channelId, "screen-share-start", actorUserId);
                }
              }
            } catch {}

            if (detail.announcements.length > 0) {
              window.dispatchEvent(
                new CustomEvent(STREAM_ANNOUNCEMENT_EVENT_NAME, {
                  detail,
                })
              );
            } else {
              window.dispatchEvent(
                new CustomEvent(STREAM_ANNOUNCEMENT_CLEAR_EVENT_NAME, {
                  detail: {
                    channelId,
                    emittedAt: detail.emittedAt,
                  },
                })
              );
            }
            return;
          }

          if (message.type === "VOICE_STREAM_ANNOUNCEMENTS_CLEARED") {
            const channelId = String(message.payload?.channelId ?? "");
            if (!channelId) return;

            const clearedUserId = message.payload?.userId
              ? String(message.payload.userId)
              : undefined;
            const clearedTrackSid = message.payload?.trackSid
              ? String(message.payload.trackSid)
              : undefined;
            const clearedSource =
              message.payload?.source === "camera" || message.payload?.source === "screen"
                ? message.payload.source
                : undefined;

            if (clearedSource === "screen") {
              if (channelId.startsWith("dm:")) {
                playDmPresenceNotification(channelId, "screen-share-stop", clearedUserId);
              } else {
                playServerPresenceNotification(channelId, "screen-share-stop", clearedUserId);
              }
            }

            try {
              const snapshot =
                ((window as any)[STREAM_ANNOUNCEMENT_SNAPSHOT_KEY] || {}) as Record<string, any>;
              const nextSnapshot = { ...snapshot };
              const currentEntry = nextSnapshot[channelId];
              const currentAnnouncements = Array.isArray(currentEntry?.announcements)
                ? currentEntry.announcements
                : [];

              const remainingAnnouncements = currentAnnouncements.filter((item: any) => {
                if (clearedTrackSid && String(item?.trackSid ?? "") === clearedTrackSid) {
                  return false;
                }
                if (clearedUserId && clearedSource) {
                  return !(
                    String(item?.participantId ?? "") === clearedUserId &&
                    item?.source === clearedSource
                  );
                }
                return true;
              });

              if (remainingAnnouncements.length > 0) {
                nextSnapshot[channelId] = {
                  channelId,
                  announcements: remainingAnnouncements,
                  emittedAt: Number(message.payload?.updatedAt ?? Date.now()),
                };
                window.dispatchEvent(
                  new CustomEvent(STREAM_ANNOUNCEMENT_EVENT_NAME, {
                    detail: nextSnapshot[channelId],
                  })
                );
              } else {
                delete nextSnapshot[channelId];
                window.dispatchEvent(
                  new CustomEvent(STREAM_ANNOUNCEMENT_CLEAR_EVENT_NAME, {
                    detail: {
                      channelId,
                      emittedAt: Number(message.payload?.updatedAt ?? Date.now()),
                      userId: clearedUserId,
                      trackSid: clearedTrackSid,
                      source: clearedSource,
                    },
                  })
                );
              }

              (window as any)[STREAM_ANNOUNCEMENT_SNAPSHOT_KEY] = nextSnapshot;
              collectStreamingUserIdsFromSnapshot(nextSnapshot);
            } catch {}

            return;
          }

          if (message.type === "SERVER_MEMBER_UPDATED") {
            const serverId = String(message.payload?.serverId ?? "");
            if (serverId) {
              window.dispatchEvent(
                new CustomEvent("vice-server-members-updated", {
                  detail: {
                    serverId,
                    userId: String(message.payload?.userId ?? "") || null,
                  },
                })
              );
            }
            if (serverId && selectedServerIdRef.current === serverId) {
              void Promise.all([
                refreshServerMembers(serverId).catch((err) => {
                  console.error("server member live refresh error:", err);
                }),
                refreshServerPermissions(serverId).catch((err) => {
                  console.error("server permissions live refresh error:", err);
                }),
              ]);
            }
            return;
          }

          if (message.type === "SERVER_ROLES_UPDATED") {
            const serverId = String(message.payload?.serverId ?? "");
            if (serverId) {
              window.dispatchEvent(
                new CustomEvent("vice-server-roles-updated", {
                  detail: { serverId },
                })
              );
              window.dispatchEvent(
                new CustomEvent("vice-server-members-updated", {
                  detail: { serverId },
                })
              );
            }
            if (serverId && selectedServerIdRef.current === serverId) {
              void Promise.all([
                refreshServerMembers(serverId).catch((err) => {
                  console.error("server roles member refresh error:", err);
                }),
                refreshServerPermissions(serverId).catch((err) => {
                  console.error("server roles permissions refresh error:", err);
                }),
              ]);
            }
            return;
          }

          if (message.type === "SERVER_CHANNELS_UPDATED") {
            const serverId = String(message.payload?.serverId ?? "");
            if (serverId && selectedServerIdRef.current === serverId) {
              void refreshChannels(serverId).catch((err) => {
                console.error("channel refresh error:", err);
              });
            }
            return;
          }

          if (message.type === "SERVER_UPDATED") {
            const serverId = String(message.payload?.serverId ?? "");
            const nextName = String(message.payload?.name ?? "");
            const nextAvatarUrl =
              message.payload?.avatarUrl === undefined
                ? undefined
                : message.payload?.avatarUrl ?? null;

            if (serverId) {
              window.dispatchEvent(
                new CustomEvent("vice-server-updated", {
                  detail: {
                    serverId,
                    name: nextName || "",
                    avatarUrl: nextAvatarUrl,
                  },
                })
              );
            }

            if (serverId && selectedServerIdRef.current === serverId) {
              if (nextName) {
                setSelectedServerName(nextName);
              }
              if (nextAvatarUrl !== undefined) {
                setSelectedServerAvatarUrl(nextAvatarUrl);
              }
              void Promise.all([
                refreshServerMembers(serverId).catch((err) => {
                  console.error("server members refresh error:", err);
                }),
                refreshServerPermissions(serverId).catch((err) => {
                  console.error("server permissions refresh error:", err);
                }),
              ]);
            }
            return;
          }

          if (message.type === "SERVER_MEMBER_KICKED") {
            const serverId = String(message.payload?.serverId ?? "");
            if (serverId) {
              window.dispatchEvent(
                new CustomEvent("vice-server-members-updated", {
                  detail: {
                    serverId,
                    userId: String(message.payload?.userId ?? "") || null,
                  },
                })
              );
            }
            if (serverId && selectedServerIdRef.current === serverId) {
              void Promise.all([
                refreshServerMembers(serverId).catch((err) => {
                  console.error("server member kicked refresh error:", err);
                }),
                refreshServerPermissions(serverId).catch((err) => {
                  console.error("server member kicked permissions refresh error:", err);
                }),
              ]);
            }
            return;
          }

          if (message.type === "SERVER_MEMBER_BANNED") {
            const serverId = String(message.payload?.serverId ?? "");
            if (serverId) {
              window.dispatchEvent(
                new CustomEvent("vice-server-members-updated", {
                  detail: {
                    serverId,
                    userId: String(message.payload?.userId ?? "") || null,
                  },
                })
              );
              window.dispatchEvent(
                new CustomEvent("vice-server-bans-updated", {
                  detail: {
                    serverId,
                    userId: String(message.payload?.userId ?? "") || null,
                  },
                })
              );
            }
            if (serverId && selectedServerIdRef.current === serverId) {
              void Promise.all([
                refreshServerMembers(serverId).catch((err) => {
                  console.error("server member banned refresh error:", err);
                }),
                refreshServerPermissions(serverId).catch((err) => {
                  console.error("server member banned permissions refresh error:", err);
                }),
              ]);
            }
            return;
          }

          if (
            message.type === "DM_MESSAGE" ||
            message.type === "DM_MESSAGE_UPDATED" ||
            message.type === "DM_MESSAGE_DELETED" ||
            message.type === "DM_MESSAGE_PINNED" ||
            message.type === "DM_MESSAGE_UNPINNED"
          ) {
            const conversationId = String(message.payload?.conversationId ?? "");
            const incomingMessage = message.payload?.message as DmMessageLike | undefined;

            if (!conversationId || !incomingMessage) return;

            applyDmMutationPreview(message.type, conversationId, incomingMessage);

            const openedConversationId = selectedDMRef.current?.id ?? null;
            const isActivelyViewingThisConversation =
              isDMViewRef.current && openedConversationId === conversationId;

            if (
              message.type === "DM_MESSAGE" &&
              incomingMessage.senderUserId !== currentUser.id &&
              !isActivelyViewingThisConversation
            ) {
              setDmUnreadMap((prev) => ({
                ...prev,
                [conversationId]: (prev[conversationId] || 0) + 1,
              }));
              maybePlayDmMessageSound(conversationId);
            }

            return;
          }

          if (message.type === "DM_TYPING") {
            const conversationId = String(message.payload?.conversationId ?? "");
            const userId = String(message.payload?.userId ?? "");
            const isTyping = Boolean(message.payload?.isTyping);

            if (!conversationId || !userId) return;
            if (userId === currentUser.id) return;

            setDmTypingMap((prev) => {
              const currentIds = prev[conversationId] || [];
              const nextIds = currentIds.filter((id) => id !== userId);

              return {
                ...prev,
                [conversationId]: isTyping ? [...nextIds, userId] : nextIds,
              };
            });

            return;
          }

          if (message.type === "DM_CALL_RINGING") {
            const conversationId = String(message.payload?.conversationId ?? "");
            const callerUserId = String(message.payload?.callerUserId ?? "");
            const callerDisplayName = String(
              message.payload?.callerDisplayName ?? "User"
            );
            const roomName = String(message.payload?.roomName ?? "");

            if (!conversationId) return;

            setIgnoredIncomingConversationId(null);

            setDmCallState({
              conversationId,
              status: "incoming",
              roomName: roomName || `dm:${conversationId}`,
              callerUserId,
              callerDisplayName,
              targetUserId: currentUser.id,
              isAlone: false,
              aloneExpiresAt: null,
              selfLeft: false,
              canRejoin: false,
            });

            maybePlayDmCallSound(conversationId);
            return;
          }

          if (message.type === "DM_CALL_OUTGOING") {
            const conversationId = String(message.payload?.conversationId ?? "");
            const roomName = String(message.payload?.roomName ?? "");
            const targetUserId = String(message.payload?.targetUserId ?? "");

            if (!conversationId) return;

            setIgnoredIncomingConversationId(null);

            setDmCallState({
              conversationId,
              status: "outgoing",
              roomName: roomName || `dm:${conversationId}`,
              callerUserId: currentUser.id,
              callerDisplayName: currentUserState.displayName,
              targetUserId,
              isAlone: false,
              aloneExpiresAt: null,
              selfLeft: false,
              canRejoin: false,
            });

            return;
          }

          if (message.type === "DM_CALL_ACCEPTED") {
            const conversationId = String(message.payload?.conversationId ?? "");
            const roomName = String(message.payload?.roomName ?? "");

            if (!conversationId) return;

            setIgnoredIncomingConversationId(null);
            void leaveServerVoiceBeforeDm();
            void ensureDmConversationOpen(conversationId);

            stopDmCallLoop();

            setDmCallState((prev) => ({
              ...prev,
              conversationId,
              status: "active",
              roomName: roomName || prev.roomName || `dm:${conversationId}`,
              isAlone: false,
              aloneExpiresAt: null,
              selfLeft: false,
              canRejoin: false,
            }));

            return;
          }

          if (message.type === "DM_CALL_ALONE" || message.type === "DM_CALL_LEFT") {
            return;
          }

          if (message.type === "DM_CALL_REJECTED") {
            const conversationId = String(message.payload?.conversationId ?? "");
            if (!conversationId) return;
            if (dmCallStateRef.current.conversationId !== conversationId) return;

            resetDmCallState();
            return;
          }

          if (message.type === "DM_CALL_ENDED") {
            const conversationId = String(message.payload?.conversationId ?? "");
            if (!conversationId) return;
            if (dmCallStateRef.current.conversationId !== conversationId) return;

            if (dmCallStateRef.current.status === "active") {
              clearSharedVoiceUiState();
            }
            resetDmCallState();
            return;
          }
        } catch (err) {
          console.error("global ws parse error:", err);
        }
      };

      ws.onerror = (err) => {
        console.error("global websocket error:", err);
      };

      ws.onclose = () => {
        if (globalWsRef.current === ws) {
          globalWsRef.current = null;
        }

        setIsGlobalWsReady(false);

        if (disposed) return;

        clearReconnectTimer();
        reconnectTimeoutRef.current = window.setTimeout(() => {
          connect();
        }, 1000);
      };
    };

    connect();

    window.addEventListener("beforeunload", handleWindowGoingAway);
    window.addEventListener("pagehide", handleWindowGoingAway);

    return () => {
      disposed = true;
      clearReconnectTimer();
      closeGlobalWsRef.current = null;

      window.removeEventListener("beforeunload", handleWindowGoingAway);
      window.removeEventListener("pagehide", handleWindowGoingAway);

      setIsGlobalWsReady(false);

      const ws = globalWsRef.current;
      globalWsRef.current = null;
      hardCloseSocket(ws);
    };
  }, [currentUser.id, currentUserState.displayName]);

  useEffect(() => {
    if (!isDMView || !selectedDM?.id) return;
    clearUnreadForConversation(selectedDM.id);
  }, [isDMView, selectedDM?.id]);

  useEffect(() => {
    if (!activeVoiceChannelId) {
      setVoiceParticipants([]);
      return;
    }

    const users = (voicePresenceMap[activeVoiceChannelId] || []).map(
      (item) => item.userId
    );
    setVoiceParticipants(users);
  }, [activeVoiceChannelId, voicePresenceMap]);

  const onlineUserById = useMemo(() => {
    const map = new Map<string, (typeof onlineUsers)[number]>();
    for (const user of onlineUsers) {
      map.set(user.userId, user);
    }
    return map;
  }, [onlineUsers]);

  const activeVoiceByUserId = useMemo(() => {
    const map = new Map<
      string,
      {
        channelId: string;
        channelName: string | null;
        serverMuted: boolean;
        serverDeafened: boolean;
        muted: boolean;
        deafened: boolean;
      }
    >();

    for (const channel of channels) {
      const members = voicePresenceMap[channel.id] || [];
      for (const member of members) {
        map.set(member.userId, {
          channelId: channel.id,
          channelName: channel.name,
          serverMuted: member.serverMuted === true,
          serverDeafened: member.serverDeafened === true,
          muted: member.muted === true,
          deafened: member.deafened === true,
        });
      }
    }

    for (const [channelId, members] of Object.entries(voicePresenceMap)) {
      for (const member of members) {
        if (!map.has(member.userId)) {
          map.set(member.userId, {
            channelId,
            channelName: null,
            serverMuted: member.serverMuted === true,
            serverDeafened: member.serverDeafened === true,
            muted: member.muted === true,
            deafened: member.deafened === true,
          });
        }
      }
    }

    return map;
  }, [channels, voicePresenceMap]);

  const serverMembers: PresenceUser[] = useMemo(() => {
  return serverMembersRaw.map((member) => {
    const activeVoice = activeVoiceByUserId.get(member.id);
    const liveUser = onlineUserById.get(member.id);
    const isSelf = member.id === currentUserState.id;
    const memberRoles = Array.isArray(member.roles) ? member.roles : [];
    const highestRole =
      memberRoles
        .slice()
        .sort((a, b) => Number(b?.position ?? 0) - Number(a?.position ?? 0))[0] ?? null;

    return {
      userId: member.id,
      username:
        liveUser?.username ??
        member.username ??
        (isSelf ? currentUserState.username : undefined),
      displayName:
        liveUser?.displayName ??
        (isSelf ? currentUserState.displayName : undefined) ??
        member.displayName ??
        "User",
      avatarUrl:
        liveUser?.avatarUrl ??
        (isSelf ? currentUserState.avatarUrl : undefined) ??
        member.avatarUrl ??
        null,
      status:
        liveUser?.status ??
        (isSelf ? currentUserState.status : undefined) ??
        member.status ??
        "offline",
      isOnline:
        Boolean(liveUser) &&
        liveUser?.status !== "offline" &&
        liveUser?.status !== "invisible",
      activeVoiceChannelId: activeVoice?.channelId ?? null,
      activeVoiceChannelName: activeVoice?.channelName ?? null,
      serverMuted:
        activeVoice?.serverMuted ?? (member.serverMuted === true),
      serverDeafened:
        activeVoice?.serverDeafened ?? (member.serverDeafened === true),
      highestRoleColor: resolveDisplayRoleColor(memberRoles),
      highestRoleName: highestRole?.name ?? null,
      roles: memberRoles,
    };
  });
}, [serverMembersRaw, activeVoiceByUserId, onlineUserById, currentUserState]);

  const friends: PresenceUser[] = useMemo(() => {
  return friendsRaw.map((friend) => {
    const activeVoice = activeVoiceByUserId.get(friend.id);
    const liveUser = onlineUserById.get(friend.id);
    const isSelf = friend.id === currentUserState.id;

    return {
      userId: friend.id,
      username:
        liveUser?.username ??
        friend.username ??
        (isSelf ? currentUserState.username : undefined),
      displayName:
        liveUser?.displayName ??
        (isSelf ? currentUserState.displayName : undefined) ??
        friend.displayName ??
        "User",
      avatarUrl:
        liveUser?.avatarUrl ??
        (isSelf ? currentUserState.avatarUrl : undefined) ??
        friend.avatarUrl ??
        null,
      status:
        liveUser?.status ??
        (isSelf ? currentUserState.status : undefined) ??
        friend.status ??
        "offline",
      isOnline:
        Boolean(liveUser) &&
        liveUser?.status !== "offline" &&
        liveUser?.status !== "invisible",
      activeVoiceChannelId: activeVoice?.channelId ?? null,
      activeVoiceChannelName: activeVoice?.channelName ?? null,
    };
  });
}, [friendsRaw, activeVoiceByUserId, onlineUserById, currentUserState]);

  const canManageServer = serverPermissions.canManageServer;
  const canCreateChannels = serverPermissions.canManageChannels;

  const totalDmUnreadCount = useMemo(() => {
    return Object.values(dmUnreadMap).reduce((sum, count) => sum + count, 0);
  }, [dmUnreadMap]);

  const blockedUserIds = useMemo(
    () => blockedUsers.map((item) => item.id).filter(Boolean),
    [blockedUsers]
  );

 const handleSendFriendRequest = async (username: string) => {
  const token = localStorage.getItem("token");
  if (!token) {
    throw new Error("Oturum bulunamadı.");
  }

  const normalizedUsername = username.trim().toLowerCase();

  const res = await fetch("http://localhost:3001/friends/request", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ username: normalizedUsername }),
  });

  const data = await res.json().catch(() => null);

  if (!res.ok) {
    const errorCode = data?.error;

    if (errorCode === "USERNAME_REQUIRED") {
      throw new Error("Username gerekli.");
    }

    if (errorCode === "INVALID_USERNAME") {
      throw new Error("Geçerli bir username gir.");
    }

    if (errorCode === "USER_NOT_FOUND") {
      throw new Error("Bu username ile kullanıcı bulunamadı.");
    }

    if (errorCode === "CANNOT_ADD_SELF") {
      throw new Error("Kendine arkadaşlık isteği gönderemezsin.");
    }

    if (errorCode === "REQUEST_ALREADY_EXISTS") {
      throw new Error("Bu kullanıcıyla zaten bekleyen veya mevcut bir bağlantı var.");
    }

    if (errorCode === "USER_BLOCKED") {
      throw new Error("Bu kullanıcıyla arkadaşlık işlemi yapılamıyor.");
    }

    throw new Error(errorCode || "Arkadaşlık isteği gönderilemedi.");
  }
};

  const handleAcceptFriendRequest = async (requesterUserId: string) => {
    const token = localStorage.getItem("token");
    if (!token) {
      throw new Error("Oturum bulunamadı.");
    }

    const res = await fetch("http://localhost:3001/friends/accept", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ requesterUserId }),
    });

    const data = await res.json().catch(() => null);

    if (!res.ok) {
      throw new Error(data?.error || "Arkadaşlık isteği kabul edilemedi.");
    }

    await refreshFriends();
    emitNotificationsUiRefresh();
  };

  const handleRejectFriendRequest = async (requesterUserId: string) => {
    const token = localStorage.getItem("token");
    if (!token) {
      throw new Error("Oturum bulunamadı.");
    }

    const res = await fetch("http://localhost:3001/friends/reject", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ requesterUserId }),
    });

    const data = await res.json().catch(() => null);

    if (!res.ok) {
      throw new Error(data?.error || "Arkadaşlık isteği reddedilemedi.");
    }

    await refreshFriends();
    emitNotificationsUiRefresh();
  };

  const handleAcceptServerInvite = async (inviteId: string) => {
    const token = localStorage.getItem("token");
    if (!token) {
      throw new Error("Oturum bulunamadı.");
    }

    const res = await fetch(
      `http://localhost:3001/servers/invites/${inviteId}/accept`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );

    const data = await res.json().catch(() => null);

    if (!res.ok) {
      throw new Error(data?.error || "Sunucu daveti kabul edilemedi.");
    }

    await Promise.all([
      refreshIncomingServerInvites().catch((err) => {
        console.error("server invites refresh error:", err);
      }),
      refreshCurrentUserServers().catch((err) => {
        console.error("current user servers refresh error:", err);
      }),
    ]);
    emitServersUiRefresh();
    emitNotificationsUiRefresh();
  };

  const handleRejectServerInvite = async (inviteId: string) => {
    const token = localStorage.getItem("token");
    if (!token) {
      throw new Error("Oturum bulunamadı.");
    }

    const res = await fetch(
      `http://localhost:3001/servers/invites/${inviteId}/reject`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );

    const data = await res.json().catch(() => null);

    if (!res.ok) {
      throw new Error(data?.error || "Sunucu daveti reddedilemedi.");
    }

    await refreshIncomingServerInvites().catch((err) => {
      console.error("server invites refresh error:", err);
    });
    emitNotificationsUiRefresh();
  };

  const handleCallUser = async (targetUserId: string) => {
    await handleOpenDMWithUser(targetUserId);
  };

  const handleRemoveFriend = async (targetUserId: string) => {
    const token = localStorage.getItem("token");
    if (!token) {
      throw new Error("Oturum bulunamadı.");
    }

    const res = await fetch(`http://localhost:3001/friends/${targetUserId}`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    const data = await res.json().catch(() => null);

    if (!res.ok) {
      throw new Error(data?.error || "Arkadaşlıktan çıkarılamadı.");
    }

    await refreshFriends();
    emitNotificationsUiRefresh();
  };

  const handleBlockUser = async (targetUserId: string) => {
    const token = localStorage.getItem("token");
    if (!token) {
      throw new Error("Oturum bulunamadı.");
    }

    const res = await fetch(`http://localhost:3001/blocks/${targetUserId}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    const data = await res.json().catch(() => null);

    if (!res.ok) {
      throw new Error(data?.error || "Kullanıcı engellenemedi.");
    }

    await Promise.all([
      refreshFriends().catch((err) => {
        console.error("friends refresh after block error:", err);
      }),
      refreshBlockedUsers().catch((err) => {
        console.error("blocked users refresh after block error:", err);
      }),
      selectedServerId
        ? refreshServerMembers(selectedServerId).catch((err) => {
            console.error("server members refresh after block error:", err);
          })
        : Promise.resolve(),
    ]);
    emitNotificationsUiRefresh();
  };

  const handleUnblockUser = async (targetUserId: string) => {
    const token = localStorage.getItem("token");
    if (!token) {
      throw new Error("Oturum bulunamadı.");
    }

    const res = await fetch(`http://localhost:3001/blocks/${targetUserId}`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    const data = await res.json().catch(() => null);

    if (!res.ok) {
      throw new Error(data?.error || "Engel kaldırılamadı.");
    }

    await refreshBlockedUsers();
    emitNotificationsUiRefresh();
  };

  const handleInviteToServer = async (targetUserId: string, serverId: string) => {
    const token = localStorage.getItem("token");
    if (!token) {
      throw new Error("Oturum bulunamadı.");
    }

    const res = await fetch("http://localhost:3001/servers/invite-user", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        serverId,
        targetUserId,
      }),
    });

    const data = await res.json().catch(() => null);

    if (!res.ok) {
      throw new Error(data?.error || "Sunucu daveti gönderilemedi.");
    }
  };

  const handleServerUpdated = async (nextServer: { name: string; avatarUrl?: string | null }) => {
    setSelectedServerName(nextServer.name);
    setSelectedServerAvatarUrl(nextServer.avatarUrl ?? null);
    if (selectedServerId) {
      await Promise.all([
        refreshChannels(selectedServerId).catch((err) => {
          console.error("channel refresh error:", err);
        }),
        refreshServerMembers(selectedServerId).catch((err) => {
          console.error("server members refresh error:", err);
        }),
        refreshServerPermissions(selectedServerId).catch((err) => {
          console.error("server permissions refresh error:", err);
        }),
        refreshCurrentUserServers().catch((err) => {
          console.error("current user servers refresh error:", err);
        }),
      ]);
    }
  };

  const handleServerLeft = async () => {
    setSelectedServerId(null);
    setSelectedServerName("");
    setSelectedServerAvatarUrl(null);
    setChannels([]);
    setSelectedChannel(null);
    setServerMembersRaw([]);
    setVoicePresenceMap((prev) => ({ ...prev }));
    await refreshCurrentUserServers().catch(() => {});
    emitServersUiRefresh();
  };

  const handleServerDeleted = async () => {
    setSelectedServerId(null);
    setSelectedServerName("");
    setSelectedServerAvatarUrl(null);
    setChannels([]);
    setSelectedChannel(null);
    setServerMembersRaw([]);
    setVoicePresenceMap((prev) => ({ ...prev }));
    await refreshCurrentUserServers().catch(() => {});
    emitServersUiRefresh();
  };

  const handleChannelsChanged = async () => {
    if (selectedServerId) {
      await refreshChannels(selectedServerId).catch((err) => {
        console.error("channel refresh error:", err);
      });
    }
  };

  const handleCollapsedAddFriend = async () => {
    const trimmed = collapsedFriendName.trim();

    if (!/^[a-zA-Z0-9_.]{3,20}$/.test(trimmed)) {
  setCollapsedFriendError("Geçerli bir username gir.");
      setCollapsedFriendSuccess("");
      return;
    }

    try {
      setCollapsedFriendLoading(true);
      setCollapsedFriendError("");
      setCollapsedFriendSuccess("");

      await handleSendFriendRequest(trimmed);

      setCollapsedFriendSuccess("İstek gönderildi.");
      setCollapsedFriendName("");
    } catch (error: any) {
      setCollapsedFriendError(
        error?.message || "Arkadaşlık isteği gönderilemedi."
      );
      setCollapsedFriendSuccess("");
    } finally {
      setCollapsedFriendLoading(false);
    }
  };

  const handleStatusChange = async (
    status: Exclude<UserStatus, "offline">
  ) => {
    const token = localStorage.getItem("token");
    if (!token) {
      throw new Error("Oturum bulunamadı.");
    }

    const res = await fetch("http://localhost:3001/profile/status", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ status }),
    });

    const data = await res.json().catch(() => null);

    if (!res.ok) {
      throw new Error(data?.error || "Durum güncellenemedi.");
    }

    applyCurrentUserUpdate({ status });

    setOnlineUsers((prev) => {
      const exists = prev.some((user) => user.userId === currentUser.id);
      const nextUser = {
        userId: currentUser.id,
        username: currentUserState.username,
        displayName: currentUserState.displayName,
        avatarUrl: currentUserState.avatarUrl ?? null,
        status,
      };

      if (!exists) return [...prev, nextUser];

      return prev.map((user) =>
        user.userId === currentUser.id ? { ...user, status } : user
      );
    });
  };

  const isSmallDesktop = viewportWidth <= 1440;
  const isTablet = viewportWidth <= 1180;
  const isMobile = viewportWidth <= 900;

  const channelSidebarWidth = useMemo(() => {
    if (isMobile) return 250;
    if (isTablet) return 280;
    if (isSmallDesktop) return 310;
    return 340;
  }, [isMobile, isTablet, isSmallDesktop]);

  const rightPanelWidth = useMemo(() => {
    if (isMobile) return 0;
    if (isTablet) return 220;
    if (isSmallDesktop) return 255;
    return 300;
  }, [isMobile, isTablet, isSmallDesktop]);

  const dmCallDisplayName =
    selectedDM?.otherUser?.displayName ||
    dmConversations.find((c) => c.id === dmCallState.conversationId)?.otherUser
      ?.displayName ||
    dmCallState.callerDisplayName ||
    "DM görüşmesi";

  const activeDmChannelId = useMemo(() => {
    const conversationId = dmCallState.conversationId;
    if (!conversationId) return null;
    return `dm:${conversationId}`;
  }, [dmCallState.conversationId]);

  const connectedServerVoiceChannel = activeVoiceChannelId
    ? channels.find((channel) => channel.id === activeVoiceChannelId) || null
    : null;

  const storedServerVoiceChannelId =
    activeVoiceChannelId ||
    localStorage.getItem(SERVER_VOICE_CHANNEL_STORAGE_KEY) ||
    null;
  const storedServerVoiceServerId =
    localStorage.getItem(SERVER_VOICE_SERVER_STORAGE_KEY) || null;

  const sidebarServerVoiceChannel = connectedServerVoiceChannel
    ? connectedServerVoiceChannel
    : storedServerVoiceChannelId
      ? {
          id: storedServerVoiceChannelId,
          name:
            selectedChannel?.type === "voice" &&
            selectedChannel.id === storedServerVoiceChannelId
              ? selectedChannel.name
              : "Ses Kanalı",
          type: "voice" as const,
          serverId: storedServerVoiceServerId || undefined,
        }
      : selectedChannel?.type === "voice"
        ? selectedChannel
        : null;

  const renderSidebarPanel = () => {
    if (isDmCallOngoing) {
      return (
        <VoicePanel
          key={`dm-${dmCallState.conversationId || "idle"}`}
          mode="dm"
          activeVoiceChannelId={activeVoiceChannelId}
          setActiveVoiceChannelId={setActiveVoiceChannelId}
          setVoiceParticipants={setVoiceParticipants}
          voicePresenceMap={voicePresenceMap}
          setVoicePresenceMap={setVoicePresenceMap}
          isConnected={isConnected}
          setIsConnected={setIsConnected}
          isMuted={isMuted}
          setIsMuted={setIsMuted}
          isDeafened={isDeafened}
          setIsDeafened={setIsDeafened}
          isMobile={isMobile}
          dmActive={true}
          dmShouldConnect={dmCallState.status === "active"}
          dmRoomName={dmCallState.roomName}
          dmChannelId={activeDmChannelId}
          dmDisplayName={dmCallDisplayName}
          dmStatus={dmCallState.status}
          dmSelfLeft={Boolean(dmCallState.selfLeft)}
          onDmLeave={async () => {
            const conversationId = dmCallState.conversationId;
            if (!conversationId) return;
            await requestEndActiveDmCall(conversationId);
          }}
        />
      );
    }

    const shouldKeepServerVoicePanelMounted =
      Boolean(activeVoiceChannelId) || Boolean(sidebarServerVoiceChannel) || isConnected;

    if (!selectedServerId && !shouldKeepServerVoicePanelMounted) return null;

    return (
      <VoicePanel
        key="server-voice-panel"
        mode="server"
        selectedChannel={sidebarServerVoiceChannel}
        activeVoiceChannelId={activeVoiceChannelId}
        setActiveVoiceChannelId={setActiveVoiceChannelId}
        setVoiceParticipants={setVoiceParticipants}
        voicePresenceMap={voicePresenceMap}
        setVoicePresenceMap={setVoicePresenceMap}
        isConnected={isConnected}
        setIsConnected={setIsConnected}
        isMuted={isMuted}
        setIsMuted={setIsMuted}
        isDeafened={isDeafened}
        setIsDeafened={setIsDeafened}
        isMobile={isMobile}
      />
    );
  };

  if (!selectedServerId && !isDMView) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          height: "100vh",
          width: "100%",
          background: "#0f1115",
          color: "white",
          overflow: "hidden",
        }}
      >
        <SidebarServers
          selectedServerId={selectedServerId}
          onSelectServer={handleSelectServer}
          isDMView={isDMView}
          onOpenDM={handleOpenDMHome}
          dmUnreadCount={totalDmUnreadCount}
          serverUnreadMap={serverUnreadMap}
        onClearAllUnread={clearAllUnread}
            />

        <div
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#9aa3af",
            fontSize: 15,
          }}
        >
          Bir sunucu seç veya direkt mesaj alanını aç.
        </div>
      </div>
    );
  }

  if (!selectedChannel && !isDMView) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          height: "100vh",
          width: "100%",
          background: "#0f1115",
          color: "white",
          overflow: "hidden",
        }}
      >
        <SidebarServers
          selectedServerId={selectedServerId}
          onSelectServer={handleSelectServer}
          isDMView={isDMView}
          onOpenDM={handleOpenDMHome}
          dmUnreadCount={totalDmUnreadCount}
          serverUnreadMap={serverUnreadMap}
        onClearAllUnread={clearAllUnread}
            />

        <div
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#9aa3af",
            fontSize: 15,
          }}
        >
          Bu sunucuda henüz kanal yok.
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        width: "100%",
        background: "#0f1115",
        color: "white",
        overflow: "hidden",
      }}
    >
      <SidebarServers
        selectedServerId={selectedServerId}
        onSelectServer={handleSelectServer}
        isDMView={isDMView}
        onOpenDM={handleOpenDMHome}
        dmUnreadCount={totalDmUnreadCount}
      serverUnreadMap={serverUnreadMap}
            onClearAllUnread={clearAllUnread}
            />

      <div
        style={{
          flex: 1,
          minHeight: 0,
          minWidth: 0,
          display: "flex",
          overflow: "hidden",
          position: "relative",
        }}
      >
        <div
          style={{
            width: channelSidebarWidth,
            minWidth: channelSidebarWidth,
            display: "flex",
            flexDirection: "column",
            minHeight: 0,
            borderRight: "1px solid #232833",
            background: "linear-gradient(180deg, #171a20 0%, #14171d 100%)",
            overflow: "hidden",
          }}
        >
          {isDMView ? (
            <>
              <div
                style={{
                  width: channelSidebarWidth,
                  minWidth: channelSidebarWidth,
                  background: "linear-gradient(180deg, #171a20 0%, #14171d 100%)",
                  display: "flex",
                  flexDirection: "column",
                  overflow: "hidden",
                  flex: 1,
                  minHeight: 0,
                }}
              >
                <div
                  style={{
                    padding: "16px 14px",
                    borderBottom: "1px solid #232833",
                    background: "linear-gradient(180deg, #1b1f26 0%, #171a20 100%)",
                    boxShadow: "0 10px 24px rgba(0,0,0,0.12)",
                  }}
                >
                  <div
                    style={{
                      fontSize: 17,
                      fontWeight: 800,
                      color: "#ffffff",
                      marginBottom: 6,
                    }}
                  >
                    Direkt Mesajlar
                  </div>

                  <div
                    style={{
                      fontSize: 13,
                      color: "#9aa3af",
                      marginBottom: 12,
                    }}
                  >
                    Arkadaşların ve DM konuşmaların
                  </div>

                  <input
                    value={dmSearchText}
                    onChange={(e) => setDmSearchText(e.target.value)}
                    placeholder="DM kişisi veya mesaj ara..."
                    style={{
                      width: "100%",
                      background: "#10141a",
                      color: "white",
                      border: "1px solid #2f3642",
                      borderRadius: 12,
                      padding: "10px 12px",
                      fontSize: 13,
                      outline: "none",
                      boxSizing: "border-box",
                    }}
                  />
                </div>

                <div
                  style={{
                    flex: 1,
                    overflowY: "auto",
                    padding: "8px 8px 14px",
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                    minHeight: 0,
                  }}
                >
                  {filteredDmConversations.length === 0 ? (
                    <div
                      style={{
                        marginTop: 12,
                        padding: "12px 14px",
                        borderRadius: 14,
                        background: "rgba(255,255,255,0.03)",
                        border: "1px solid rgba(255,255,255,0.04)",
                        color: "#8f98a6",
                        fontSize: 13,
                        lineHeight: 1.6,
                      }}
                    >
                      {dmConversations.length === 0
                        ? "Henüz DM konuşman yok."
                        : "Eşleşen DM bulunamadı."}
                    </div>
                  ) : (
                    filteredDmConversations.map((conversation) => {
                      const isActive = selectedDM?.id === conversation.id;
                      const unreadCount = dmUnreadMap[conversation.id] || 0;
                      const isCallConversation =
                        dmCallState.conversationId === conversation.id;

                      return (
                        <button
                          key={conversation.id}
                          onClick={() => handleSelectDMConversation(conversation)}
                          onContextMenu={(event) =>
                            openDmNotificationMenu(event, conversation.id)
                          }
                          style={{
                            width: "100%",
                            background: isActive
                              ? "linear-gradient(135deg, rgba(88,101,242,0.22), rgba(88,101,242,0.10))"
                              : "transparent",
                            color: isActive ? "#ffffff" : "#aeb6c2",
                            border: isActive
                              ? "1px solid rgba(88,101,242,0.28)"
                              : "1px solid transparent",
                            borderRadius: 12,
                            padding: "11px 12px",
                            textAlign: "left",
                            cursor: "pointer",
                            transition: "0.18s ease",
                            position: "relative",
                          }}
                          title={conversation.otherUser?.displayName ?? "Kullanıcı"}
                        >
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "space-between",
                              gap: 10,
                            }}
                          >
                            <div
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 10,
                                minWidth: 0,
                                flex: 1,
                              }}
                            >
                              <UserAvatar
                                name={conversation.otherUser?.displayName ?? "Bilinmeyen kullanıcı"}
                                avatarUrl={getDmConversationAvatarUrl(conversation)}
                                size={38}
                              />

                              <div
                                style={{
                                  fontSize: 14,
                                  fontWeight: isActive ? 700 : 600,
                                  whiteSpace: "nowrap",
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  minWidth: 0,
                                  flex: 1,
                                }}
                              >
                                {conversation.otherUser?.displayName ??
                                  "Bilinmeyen kullanıcı"}
                              </div>
                            </div>

                            <div
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 6,
                                flexShrink: 0,
                              }}
                            >
                              {isCallConversation && dmCallState.status !== "idle" && (
                                <div
                                  style={{
                                    width: 8,
                                    height: 8,
                                    borderRadius: 999,
                                    background:
                                      dmCallState.status === "active"
                                        ? "#3ba55d"
                                        : "#f0b232",
                                    boxShadow:
                                      dmCallState.status === "active"
                                        ? "0 0 12px rgba(59,165,93,0.45)"
                                        : "0 0 12px rgba(240,178,50,0.35)",
                                  }}
                                />
                              )}

                              {unreadCount > 0 && (
                                <div
                                  style={{
                                    minWidth: 20,
                                    height: 20,
                                    borderRadius: 999,
                                    padding: "0 6px",
                                    background: "#ed4245",
                                    color: "white",
                                    fontSize: 11,
                                    fontWeight: 800,
                                    display: "inline-flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    boxShadow: "0 6px 16px rgba(237,66,69,0.35)",
                                  }}
                                >
                                  {unreadCount > 99 ? "99+" : unreadCount}
                                </div>
                              )}
                            </div>
                          </div>

                          <div
                            style={{
                              marginTop: 4,
                              fontSize: 12,
                              color: isActive ? "#dbe1ff" : "#8f98a6",
                              whiteSpace: "nowrap",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                            }}
                          >
                            {getConversationPreviewWithFallback(conversation)}
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>

                {dmNotificationMenu && (() => {
                  const settings = getDmNotificationSummary(dmNotificationMenu.conversationId);
                  return (
                    <div
                      onClick={(e) => e.stopPropagation()}
                      style={{
                        position: "fixed",
                        left: Math.min(dmNotificationMenu.x, window.innerWidth - 332),
                        top: Math.min(dmNotificationMenu.y, window.innerHeight - 320),
                        width: 320,
                        background:
                          "linear-gradient(180deg, rgba(20,24,35,0.98) 0%, rgba(15,18,27,0.98) 100%)",
                        border: "1px solid rgba(255,255,255,0.08)",
                        borderRadius: 22,
                        boxShadow: "0 28px 70px rgba(0,0,0,0.5)",
                        padding: 16,
                        zIndex: 120,
                        backdropFilter: "blur(18px)",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "flex-start",
                          justifyContent: "space-between",
                          gap: 12,
                          marginBottom: 14,
                        }}
                      >
                        <div style={{ minWidth: 0 }}>
                          <div
                            style={{
                              fontSize: 15,
                              fontWeight: 900,
                              color: "#f7faff",
                              letterSpacing: 0.2,
                            }}
                          >
                            DM Bildirimleri
                          </div>
                          <div
                            style={{
                              marginTop: 4,
                              fontSize: 12,
                              lineHeight: 1.45,
                              color: "#98a3b6",
                            }}
                          >
                            Bu konuşma için mesaj ve arama bildirimlerini ayrı ayrı yönet.
                          </div>
                        </div>

                        <button
                          onClick={() => setDmNotificationMenu(null)}
                          style={{
                            width: 30,
                            height: 30,
                            borderRadius: 999,
                            border: "1px solid rgba(255,255,255,0.07)",
                            background: "rgba(255,255,255,0.04)",
                            color: "#b8c0cc",
                            cursor: "pointer",
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: 16,
                            flexShrink: 0,
                          }}
                          title="Kapat"
                        >
                          ×
                        </button>
                      </div>

                      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                        {(["message", "call"] as const).map((kind) => (
                          <div
                            key={kind}
                            style={{
                              borderRadius: 18,
                              border: "1px solid rgba(255,255,255,0.07)",
                              background: "rgba(255,255,255,0.035)",
                              padding: 12,
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
                                gap: 12,
                              }}
                            >
                              <div style={{ minWidth: 0 }}>
                                <div
                                  style={{
                                    color: "#eef3fb",
                                    fontSize: 13,
                                    fontWeight: 800,
                                  }}
                                >
                                  {kind === "message" ? "Mesaj sesi" : "Arama sesi"}
                                </div>
                                <div
                                  style={{
                                    marginTop: 3,
                                    color: "#8f9aad",
                                    fontSize: 11,
                                    lineHeight: 1.4,
                                  }}
                                >
                                  {kind === "message"
                                    ? "Yeni mesaj geldiğinde kısa bildirim sesi çalar."
                                    : "Arama sırasında zil sesi çalma davranışını yönetir."}
                                </div>
                              </div>

                              <button
                                onClick={() =>
                                  updateDmNotificationPreference(dmNotificationMenu.conversationId, kind, {
                                    enabled: !settings[kind].enabled,
                                  })
                                }
                                style={{
                                  position: "relative",
                                  width: 52,
                                  height: 30,
                                  borderRadius: 999,
                                  border: "1px solid rgba(255,255,255,0.08)",
                                  background: settings[kind].enabled
                                    ? "linear-gradient(135deg, rgba(108,92,231,0.95), rgba(199,102,255,0.9))"
                                    : "rgba(255,255,255,0.08)",
                                  boxShadow: settings[kind].enabled
                                    ? "0 10px 24px rgba(141,92,255,0.28)"
                                    : "none",
                                  cursor: "pointer",
                                  flexShrink: 0,
                                }}
                                title={settings[kind].enabled ? "Açık" : "Kapalı"}
                              >
                                <span
                                  style={{
                                    position: "absolute",
                                    top: 3,
                                    left: settings[kind].enabled ? 25 : 3,
                                    width: 22,
                                    height: 22,
                                    borderRadius: 999,
                                    background: "#fff",
                                    boxShadow: "0 6px 14px rgba(0,0,0,0.24)",
                                    transition: "left 160ms ease",
                                  }}
                                />
                              </button>
                            </div>

                            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                              <span
                                style={{
                                  color: "#98a3b6",
                                  fontSize: 11,
                                  fontWeight: 800,
                                  minWidth: 30,
                                }}
                              >
                                %{Math.round((settings[kind].volume || 0) * 100)}
                              </span>
                              <input
                                type="range"
                                min={0}
                                max={100}
                                value={Math.round((settings[kind].volume || 0) * 100)}
                                onChange={(e) =>
                                  updateDmNotificationPreference(dmNotificationMenu.conversationId, kind, {
                                    volume: Number(e.target.value) / 100,
                                  })
                                }
                                style={{
                                  width: "100%",
                                  accentColor: "#b15cff",
                                  cursor: "pointer",
                                }}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })()}
              </div>

              <div
                style={{
                  flexShrink: 0,
                  borderTop: "1px solid rgba(255,255,255,0.05)",
                  background: "linear-gradient(180deg, #20242c 0%, #1a1e25 100%)",
                  maxHeight: isMobile ? "52vh" : isTablet ? "48vh" : "46vh",
                  overflow: "hidden",
                }}
              >
                {renderSidebarPanel()}
              </div>
            </>
          ) : (
            <>
              <div
                style={{
                  flex: 1,
                  minHeight: 0,
                  overflow: "hidden",
                }}
              >
                <SidebarChannels
                  width={channelSidebarWidth}
                  channels={channels}
                  selectedChannel={selectedChannel}
                  onSelectChannel={(channel) => {
                    setSelectedChannel(channel);
                    clearUnreadForChannel(channel.id, channel.serverId);
                  }}
                  activeVoiceChannelId={activeVoiceChannelId}
                  voicePresenceMap={voicePresenceMap}
                  streamingUserIdsByChannel={streamingUserIdsByChannel}
                  isConnected={isConnected}
                  isMobile={isMobile}
                  serverName={selectedServerName}
                  serverAvatarUrl={selectedServerAvatarUrl}
                  selectedServerId={selectedServerId}
                  channelUnreadMap={channelUnreadMap}
                  onChannelCreated={handleChannelsChanged}
                  onChannelsChanged={handleChannelsChanged}
                  onServerUpdated={handleServerUpdated}
                  onServerLeft={handleServerLeft}
                  onServerDeleted={handleServerDeleted}
                  canCreateChannels={canCreateChannels}
                  canManageServer={canManageServer}
                  canManageChannels={serverPermissions.canManageChannels}
                  canMuteMembers={serverPermissions.canMuteMembers}
                  canDeafenMembers={serverPermissions.canDeafenMembers}
                  canMoveMembers={serverPermissions.canMoveMembers}
                  canDisconnectMembers={serverPermissions.canDisconnectMembers}
                  disableVoiceJoin={isDmCallOngoing}
                />
              </div>

              <div
                style={{
                  flexShrink: 0,
                  borderTop: "1px solid rgba(255,255,255,0.05)",
                  background:
                    "linear-gradient(180deg, rgba(255,255,255,0.01), rgba(255,255,255,0.02))",
                  maxHeight: isMobile ? "52vh" : isTablet ? "48vh" : "46vh",
                  overflow: "hidden",
                }}
              >
                {renderSidebarPanel()}
              </div>
            </>
          )}
        </div>

        <div
          style={{
            flex: 1,
            minWidth: 0,
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            background: "linear-gradient(180deg, #11141a 0%, #0f1217 100%)",
            position: "relative",
          }}
        >
          {isDMView ? (
            <DirectMessageArea
              conversation={selectedDM}
              currentUserId={currentUser.id}
              typingUserIds={selectedDM ? dmTypingMap[selectedDM.id] || [] : []}
              sendDmWsEvent={sendDmWsEvent}
              isWsReady={isGlobalWsReady}
              onStartCall={startDmCall}
              onEndCall={(conversationId) => requestEndActiveDmCall(conversationId)}
              onAcceptCall={acceptDmCall}
              onRejectCall={async (conversationId) => {
                rejectDmCall(conversationId);
                resetDmCallState();
              }}
              onIgnoreCall={async (conversationId) => {
                ignoreDmCall(conversationId);
              }}
              onRejoinCall={rejoinDmCall}
              dmCallState={dmCallState}
              voicePresenceMap={voicePresenceMap}
              realtimeMutationEvent={dmRealtimeEvent}
            />
          ) : selectedChannel ? (
            <ChatArea
              selectedChannel={selectedChannel}
              voicePresenceMap={voicePresenceMap}
              activeVoiceChannelId={activeVoiceChannelId}
            />
          ) : null}
        </div>

        {!isMobile && !isUserBarHidden && (
          <UserBar
            width={rightPanelWidth}
            onLogout={onLogout}
            currentUser={currentUserState}
            currentUserServers={currentUserServers}
            blockedUserIds={blockedUserIds}
            blockedUsers={blockedUsers}
            onRefreshBlockedUsers={refreshBlockedUsers}
            onUnblockUser={handleUnblockUser}
            serverMembers={serverMembers}
            friends={friends}
            incomingRequests={incomingRequests}
            incomingServerInvites={incomingServerInvites}
            onSendFriendRequest={handleSendFriendRequest}
            onAcceptFriendRequest={handleAcceptFriendRequest}
            onRejectFriendRequest={handleRejectFriendRequest}
            onAcceptServerInvite={handleAcceptServerInvite}
            onRejectServerInvite={handleRejectServerInvite}
            isDMView={isDMView}
            onStartDirectMessage={handleOpenDMWithUser}
            onCallUser={handleCallUser}
            onRemoveFriend={handleRemoveFriend}
            onBlockUser={handleBlockUser}
            onInviteToServer={handleInviteToServer}
            selectedServerId={selectedServerId}
            serverChannels={channels}
            canManageRoles={serverPermissions.canManageRoles}
            canKickMembers={serverPermissions.canKickMembers}
            canBanMembers={serverPermissions.canBanMembers}
            canMuteMembers={serverPermissions.canMuteMembers}
            canDeafenMembers={serverPermissions.canDeafenMembers}
            canMoveMembers={serverPermissions.canMoveMembers}
            canDisconnectMembers={serverPermissions.canDisconnectMembers}
            onServerMembersChanged={refreshSelectedServerMembers}
            onHideUserBar={() => setIsUserBarHidden(true)}
            onUserUpdated={applyCurrentUserUpdate}
            onStatusChange={handleStatusChange}
          />
        )}

        {!isMobile && isUserBarHidden && (
          <div
            style={{
              width: 58,
              minWidth: 58,
              borderLeft: "1px solid #232833",
              background: "linear-gradient(180deg,#171a20,#14171d)",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 10,
              paddingTop: 14,
              paddingBottom: 14,
              position: "relative",
            }}
          >
            <button
              onClick={() => setIsUserBarHidden(false)}
              title="Üyeleri göster"
              style={collapsedBarButtonStyle}
            >
              <PanelRightClose size={18} />
            </button>

            <button
              title="Bildirimler"
              style={collapsedBarButtonStyle}
              onClick={() => setIsCollapsedNotificationsOpen(true)}
            >
              <Bell size={18} />
            </button>

            <button
              title={isCollapsedAddFriendOpen ? "Kapat" : "Arkadaş ekle"}
              style={collapsedBarButtonStyle}
              onClick={() => setIsCollapsedAddFriendOpen((prev) => !prev)}
            >
              <UserPlus size={18} />
            </button>

            <button
              title="Ayarlar"
              style={collapsedBarButtonStyle}
              onClick={() => setIsCollapsedSettingsOpen(true)}
            >
              <Settings size={18} />
            </button>

            {isCollapsedAddFriendOpen && (
              <div
                style={{
                  position: "absolute",
                  right: 68,
                  top: 92,
                  width: 220,
                  borderRadius: 16,
                  border: "1px solid rgba(255,255,255,0.08)",
                  background: "#161a21",
                  boxShadow: "0 18px 40px rgba(0,0,0,0.35)",
                  padding: 12,
                  zIndex: 30,
                }}
              >
                <div
                  style={{
                    color: "#fff",
                    fontWeight: 800,
                    fontSize: 13,
                    marginBottom: 10,
                  }}
                >
                  Arkadaş ekle
                </div>

                <input
                  value={collapsedFriendName}
                  onChange={(e) => setCollapsedFriendName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      void handleCollapsedAddFriend();
                    }
                  }}
                  placeholder="Username"
                  style={{
                    width: "100%",
                    height: 40,
                    background: "#10141a",
                    color: "white",
                    border: "1px solid #2f3642",
                    borderRadius: 12,
                    padding: "0 12px",
                    fontSize: 13,
                    outline: "none",
                    boxSizing: "border-box",
                  }}
                />

                <button
                  onClick={() => void handleCollapsedAddFriend()}
                  disabled={collapsedFriendLoading}
                  style={{
                    marginTop: 10,
                    width: "100%",
                    height: 40,
                    borderRadius: 12,
                    border: "none",
                    background: "linear-gradient(135deg,#5865f2,#7b8aff)",
                    color: "white",
                    cursor: collapsedFriendLoading ? "not-allowed" : "pointer",
                    fontWeight: 800,
                    fontSize: 13,
                    opacity: collapsedFriendLoading ? 0.7 : 1,
                  }}
                >
                  Ekle
                </button>

                {collapsedFriendError && (
                  <div
                    style={{
                      marginTop: 8,
                      fontSize: 12,
                      color: "#ffb3b5",
                    }}
                  >
                    {collapsedFriendError}
                  </div>
                )}

                {collapsedFriendSuccess && (
                  <div
                    style={{
                      marginTop: 8,
                      fontSize: 12,
                      color: "#a8f0be",
                    }}
                  >
                    {collapsedFriendSuccess}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <NotificationsModal
        isOpen={isCollapsedNotificationsOpen}
        onClose={() => setIsCollapsedNotificationsOpen(false)}
        incomingFriendRequests={incomingRequests}
        incomingServerInvites={incomingServerInvites}
        onAcceptFriendRequest={handleAcceptFriendRequest}
        onRejectFriendRequest={handleRejectFriendRequest}
        onAcceptServerInvite={handleAcceptServerInvite}
        onRejectServerInvite={handleRejectServerInvite}
      />

      <SettingsModal
        isOpen={isCollapsedSettingsOpen}
        onClose={() => setIsCollapsedSettingsOpen(false)}
        currentUser={currentUserState}
        blockedUsers={blockedUsers}
        onRefreshBlockedUsers={refreshBlockedUsers}
        onUnblockUser={handleUnblockUser}
        onLogout={onLogout}
        onUserUpdated={(nextUser) =>
          applyCurrentUserUpdate({
            displayName: nextUser.displayName,
            avatarUrl: nextUser.avatarUrl,
          })
        }
      />

      {dmCallState.status === "incoming" &&
        ignoredIncomingConversationId !== dmCallState.conversationId && (
        <div style={callOverlayStyle}>
          <div style={callModalStyle}>
            <div style={callTitleStyle}>Gelen Arama</div>
            <div style={callTextStyle}>
              {dmCallState.callerDisplayName || "Bir kullanıcı"} seni arıyor
            </div>

            <div style={callButtonRowStyle}>
              <button
                style={{
                  ...rejectCallButtonStyle,
                  background: "rgba(255,255,255,0.08)",
                  color: "#dbe3ee",
                }}
                onClick={() => {
                  if (dmCallState.conversationId) {
                    ignoreDmCall(dmCallState.conversationId);
                  }
                }}
              >
                Yoksay
              </button>

              <button
                style={rejectCallButtonStyle}
                onClick={() => {
                  if (dmCallState.conversationId) {
                    rejectDmCall(dmCallState.conversationId);
                  }
                  resetDmCallState();
                }}
              >
                Reddet
              </button>

              <button
                style={acceptCallButtonStyle}
                onClick={() => {
                  if (dmCallState.conversationId) {
                    void acceptDmCall(dmCallState.conversationId);
                  }
                }}
              >
                Kabul Et
              </button>
            </div>
          </div>
        </div>
      )}

      {dmCallState.status === "outgoing" && (
        <div style={callOverlayStyle}>
          <div style={callModalStyle}>
            <div style={callTitleStyle}>Aranıyor...</div>
            <div style={callTextStyle}>Karşı tarafın yanıtı bekleniyor • 30 sn</div>

            <div style={callButtonRowStyle}>
              <button
                style={rejectCallButtonStyle}
                onClick={() => {
                  if (dmCallState.conversationId) {
                    void requestEndActiveDmCall(dmCallState.conversationId);
                  }
                }}
              >
                Ayrıl
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const collapsedBarButtonStyle: React.CSSProperties = {
  width: 38,
  height: 38,
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.08)",
  background: "rgba(255,255,255,0.04)",
  color: "white",
  cursor: "pointer",
  fontSize: 15,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  flexShrink: 0,
};

const callOverlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.45)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 9999,
};

const callModalStyle: React.CSSProperties = {
  width: 360,
  maxWidth: "92vw",
  borderRadius: 20,
  border: "1px solid rgba(255,255,255,0.08)",
  background: "linear-gradient(180deg,#1a1f28,#151921)",
  boxShadow: "0 24px 60px rgba(0,0,0,0.35)",
  padding: 22,
  color: "white",
};

const callTitleStyle: React.CSSProperties = {
  fontSize: 20,
  fontWeight: 800,
  marginBottom: 8,
};

const callTextStyle: React.CSSProperties = {
  fontSize: 14,
  color: "#a8b0bc",
  lineHeight: 1.6,
};

const callButtonRowStyle: React.CSSProperties = {
  display: "flex",
  gap: 10,
  marginTop: 18,
};

const acceptCallButtonStyle: React.CSSProperties = {
  flex: 1,
  height: 44,
  borderRadius: 14,
  border: "none",
  background: "linear-gradient(135deg,#3ba55d,#48c774)",
  color: "white",
  cursor: "pointer",
  fontWeight: 800,
  fontSize: 14,
};

const rejectCallButtonStyle: React.CSSProperties = {
  flex: 1,
  height: 44,
  borderRadius: 14,
  border: "1px solid rgba(237,66,69,0.14)",
  background: "linear-gradient(135deg,#ed4245,#ff6b6e)",
  color: "white",
  cursor: "pointer",
  fontWeight: 800,
  fontSize: 14,
};