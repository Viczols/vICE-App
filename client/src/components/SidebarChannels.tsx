import { useEffect, useMemo, useRef, useState } from "react";
import { MicOff, HeadphoneOff, Volume2, VolumeX, SlidersHorizontal, Radio } from "lucide-react";
import type { Channel, VoicePresenceItem } from "../layout/MainLayout";
import ServerSettingsModal from "./ServerSettingsModal";
import {
  getServerNotificationSettings,
  playSound,
  updateServerNotificationSettings,
} from "../utils/soundManager";

type SidebarChannelsProps = {
  width: number;
  channels: Channel[];
  selectedChannel: Channel | null;
  onSelectChannel: (channel: Channel) => void;
  activeVoiceChannelId: string | null;
  voicePresenceMap: Record<string, VoicePresenceItem[]>;
  streamingUserIdsByChannel?: Record<string, string[]>;
  isConnected: boolean;
  isMobile: boolean;
  serverName?: string;
  serverAvatarUrl?: string | null;
  selectedServerId?: string | null;
  channelUnreadMap?: Record<string, number>;
  onChannelCreated?: () => void;
  onChannelsChanged?: () => void;
  onServerUpdated?: (nextServer: { name: string; avatarUrl?: string | null }) => void | Promise<void>;
  onServerLeft?: () => void | Promise<void>;
  onServerDeleted?: () => void | Promise<void>;
  canCreateChannels?: boolean;
  canManageChannels?: boolean;
  canManageServer?: boolean;
  canMuteMembers?: boolean;
  canDeafenMembers?: boolean;
  canMoveMembers?: boolean;
  canDisconnectMembers?: boolean;
  disableVoiceJoin?: boolean;
};

type InviteLimitOption = "unlimited" | 10 | 50 | 100;

type VoiceUserUiSetting = {
  volume: number;
  locallyMuted: boolean;
};

type VoiceUserMenuState = {
  participantId: string;
  label: string;
  x: number;
  y: number;
  channelId: string;
  serverMuted: boolean;
  serverDeafened: boolean;
};
type DraggedChannelState = {
  channelId: string;
  type: "text" | "voice";
};

type DraggedVoiceMemberState = {
  participantId: string;
  fromChannelId: string;
  label: string;
};


const VOICE_USER_ACTION_EVENT_NAME = "vice-voice-user-action";
const VOICE_USER_SETTINGS_SYNC_EVENT_NAME = "vice-voice-user-settings-sync";

function formatDuration(ms: number) {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${String(min).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

function getInitials(name: string) {
  const parts = String(name || "?").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
  return `${parts[0].slice(0, 1)}${parts[1].slice(0, 1)}`.toUpperCase();
}

function getChannelStreamingUserIds(
  channel: Channel,
  streamingUserIdsByChannel: Record<string, string[]>
) {
  const directIds = Array.isArray(streamingUserIdsByChannel[String(channel.id)])
    ? streamingUserIdsByChannel[String(channel.id)]
    : [];
  const scopedKey = channel.serverId
    ? `server:${channel.serverId}:channel:${channel.id}`
    : null;
  const scopedIds =
    scopedKey && Array.isArray(streamingUserIdsByChannel[scopedKey])
      ? streamingUserIdsByChannel[scopedKey]
      : [];

  return Array.from(new Set([...directIds, ...scopedIds]));
}

function VoiceStateIcons({
  selfMuted,
  selfDeafened,
  serverMuted,
  serverDeafened,
}: {
  selfMuted?: boolean;
  selfDeafened?: boolean;
  serverMuted?: boolean;
  serverDeafened?: boolean;
}) {
  const showMute = Boolean(selfMuted || serverMuted);
  const showDeafen = Boolean(selfDeafened || serverDeafened);

  if (!showMute && !showDeafen) return null;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        flexShrink: 0,
      }}
    >
      {showMute && (
        <span
          title={serverMuted ? "Server Muted" : "Self Muted"}
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            opacity: 0.98,
            color: serverMuted ? "#ed4245" : "#f2f3f5",
          }}
        >
          <MicOff size={16} strokeWidth={2.2} />
        </span>
      )}

      {showDeafen && (
        <span
          title={serverDeafened ? "Server Deafened" : "Self Deafened"}
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            opacity: 0.98,
            color: serverDeafened ? "#ed4245" : "#f2f3f5",
          }}
        >
          <HeadphoneOff size={16} strokeWidth={2.2} />
        </span>
      )}
    </div>
  );
}

function SectionHeader({
  title,
  count,
}: {
  title: string;
  count: number;
}) {
  return (
    <div
      style={{
        padding: "14px 14px 8px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8,
      }}
    >
      <span
        style={{
          fontSize: 11,
          letterSpacing: 1,
          textTransform: "uppercase",
          color: "#7f8794",
          fontWeight: 800,
        }}
      >
        {title}
      </span>

      <span
        style={{
          minWidth: 20,
          height: 20,
          borderRadius: 999,
          padding: "0 7px",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          background: "rgba(255,255,255,0.05)",
          border: "1px solid rgba(255,255,255,0.05)",
          color: "#9ea7b5",
          fontSize: 11,
          fontWeight: 800,
          flexShrink: 0,
        }}
      >
        {count}
      </span>
    </div>
  );
}

export default function SidebarChannels({
  width,
  channels,
  selectedChannel,
  onSelectChannel,
  activeVoiceChannelId,
  voicePresenceMap,
  streamingUserIdsByChannel = {},
  isConnected,
  isMobile,
  serverName,
  serverAvatarUrl,
  selectedServerId,
  channelUnreadMap = {},
  onChannelCreated,
  onChannelsChanged,
  onServerUpdated,
  onServerLeft,
  onServerDeleted,
  canCreateChannels = false,
  canManageChannels = false,
  canManageServer = false,
  canMuteMembers = false,
  canDeafenMembers = false,
  canMoveMembers = false,
  canDisconnectMembers = false,
  disableVoiceJoin = false,
}: SidebarChannelsProps) {
  const [, forceTick] = useState(0);

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [channelName, setChannelName] = useState("");
  const [channelType, setChannelType] = useState<"text" | "voice">("text");
  const [isPrivate, setIsPrivate] = useState(false);
  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError] = useState("");

  const [inviteCode, setInviteCode] = useState("");
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteError, setInviteError] = useState("");
  const [inviteSuccess, setInviteSuccess] = useState("");
  const [isInviteOpen, setIsInviteOpen] = useState(false);
  const [inviteLimit, setInviteLimit] = useState<InviteLimitOption>("unlimited");

  const [isServerMenuOpen, setIsServerMenuOpen] = useState(false);
  const [openChannelMenuId, setOpenChannelMenuId] = useState<string | null>(null);
  const [isRenameServerOpen, setIsRenameServerOpen] = useState(false);
  const [renameServerValue, setRenameServerValue] = useState(serverName || "");
  const [renameServerLoading, setRenameServerLoading] = useState(false);
  const [renameServerError, setRenameServerError] = useState("");
  const [isServerSettingsOpen, setIsServerSettingsOpen] = useState(false);
  const [isServerNotificationsOpen, setIsServerNotificationsOpen] = useState(false);
  const [serverNotificationRefreshTick, setServerNotificationRefreshTick] = useState(0);

  const [editingChannel, setEditingChannel] = useState<Channel | null>(null);
  const [renameChannelValue, setRenameChannelValue] = useState("");
  const [renameChannelLoading, setRenameChannelLoading] = useState(false);
  const [renameChannelError, setRenameChannelError] = useState("");

  const [voiceUserMenu, setVoiceUserMenu] = useState<VoiceUserMenuState | null>(null);
  const [voiceMovePanel, setVoiceMovePanel] = useState<{ target: VoiceUserMenuState; x: number; y: number } | null>(null);
  const [voiceUserSettings, setVoiceUserSettings] = useState<Record<string, VoiceUserUiSetting>>({});
  const [voiceModerationLoading, setVoiceModerationLoading] = useState<string | null>(null);
  const [voiceModerationError, setVoiceModerationError] = useState("");
  const [orderedChannels, setOrderedChannels] = useState<Channel[]>(channels);
  const [draggedChannel, setDraggedChannel] = useState<DraggedChannelState | null>(null);
  const [draggedVoiceMember, setDraggedVoiceMember] = useState<DraggedVoiceMemberState | null>(null);
  const [dragOverChannelId, setDragOverChannelId] = useState<string | null>(null);
  const dragCommitInFlightRef = useRef(false);

  const currentUserId = useMemo(() => {
    try {
      const raw = localStorage.getItem("auth_user");
      if (!raw) return "";
      const parsed = JSON.parse(raw);
      return String(parsed?.id ?? "");
    } catch {
      return "";
    }
  }, []);

  const updateServerNotificationPreference = (patch: {
  enabled?: boolean;
  volume?: number;
}) => {
  if (!selectedServerId) return;

  const current = getServerNotificationSettings(selectedServerId);

  updateServerNotificationSettings(selectedServerId, {
    message: {
      ...current.message,
      ...patch,
    },
  });

  setServerNotificationRefreshTick((prev) => prev + 1);
};


  useEffect(() => {
    const interval = setInterval(() => {
      forceTick((v) => v + 1);
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    setRenameServerValue(serverName || "");
  }, [serverName]);

  useEffect(() => {
    setOrderedChannels(channels);
  }, [channels]);

  useEffect(() => {
    const handleOutside = () => {
      setIsServerMenuOpen(false);
      setOpenChannelMenuId(null);
      setIsServerNotificationsOpen(false);
    };

    window.addEventListener("click", handleOutside);
    return () => window.removeEventListener("click", handleOutside);
  }, []);

  useEffect(() => {
    const closeVoiceUserMenu = () => setVoiceUserMenu(null);

    const syncHandler = (event: Event) => {
      const customEvent = event as CustomEvent<{
        participantId?: string;
        volume?: number;
        locallyMuted?: boolean;
      }>;

      const participantId = customEvent.detail?.participantId;
      if (!participantId) return;

      setVoiceUserSettings((prev) => ({
        ...prev,
        [participantId]: {
          volume: typeof customEvent.detail?.volume === "number" ? customEvent.detail.volume : prev[participantId]?.volume ?? 1,
          locallyMuted: typeof customEvent.detail?.locallyMuted === "boolean" ? customEvent.detail.locallyMuted : prev[participantId]?.locallyMuted ?? false,
        },
      }));
    };

    window.addEventListener("click", closeVoiceUserMenu);
    window.addEventListener(VOICE_USER_SETTINGS_SYNC_EVENT_NAME, syncHandler as EventListener);

    return () => {
      window.removeEventListener("click", closeVoiceUserMenu);
      window.removeEventListener(VOICE_USER_SETTINGS_SYNC_EVENT_NAME, syncHandler as EventListener);
    };
  }, []);

  const handleChannelDoubleClick = (channel: Channel) => {
    if (channel.type !== "voice") return;
    if (disableVoiceJoin) return;

    window.dispatchEvent(
      new CustomEvent("vice-join-voice-channel", {
        detail: { channel },
      })
    );
  };

  const isVoiceMenuSelf =
    voiceUserMenu !== null && String(voiceUserMenu.participantId) === String(currentUserId);

  const showVoiceModerationActions =
    Boolean(selectedServerId) &&
    (canMuteMembers ||
      canDeafenMembers ||
      canMoveMembers ||
      canDisconnectMembers ||
      canManageServer);

  const canShowSelfVoiceModeration =
    Boolean(selectedServerId) &&
    Boolean(voiceUserMenu) &&
    isVoiceMenuSelf &&
    Boolean(voiceUserMenu?.channelId) &&
    (canMuteMembers || canDeafenMembers);

  const canShowOtherVoiceModeration =
    Boolean(selectedServerId) &&
    Boolean(voiceUserMenu) &&
    !isVoiceMenuSelf &&
    Boolean(voiceUserMenu?.channelId) &&
    (canMuteMembers ||
      canDeafenMembers ||
      canMoveMembers ||
      canDisconnectMembers ||
      canManageServer);

  const runVoiceModerationRequest = async (
    actionKey: string,
    url: string,
    body: Record<string, unknown>,
    options?: {
      closeMenu?: boolean;
      confirmText?: string;
      requireOpenVoiceMenu?: boolean;
    }
  ) => {
    const token = localStorage.getItem("token");
    if (!token || !selectedServerId) return false;
    if (options?.requireOpenVoiceMenu !== false && !voiceUserMenu) return false;

    if (options?.confirmText) {
      const ok = window.confirm(options.confirmText);
      if (!ok) return false;
    }

    try {
      setVoiceModerationLoading(actionKey);
      setVoiceModerationError("");

      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok) {
        setVoiceModerationError(data?.error || "İşlem başarısız oldu.");
        return false;
      }

      if (options?.closeMenu !== false) {
        setVoiceUserMenu(null);
        setVoiceMovePanel(null);
      }

      return true;
    } catch (error) {
      console.error(error);
      setVoiceModerationError("İşlem sırasında bağlantı hatası oldu.");
      return false;
    } finally {
      setVoiceModerationLoading(null);
    }
  };

  const handleServerMuteToggle = async () => {
    if (!voiceUserMenu || !selectedServerId) return;

    const nextMuted = !voiceUserMenu.serverMuted;
    const ok = await runVoiceModerationRequest(
      nextMuted ? "mute-user" : "unmute-user",
      "http://localhost:3001/voice/mute-user",
      {
        serverId: selectedServerId,
        targetUserId: voiceUserMenu.participantId,
        muted: nextMuted,
      },
      { closeMenu: false }
    );

    if (ok) {
      setVoiceUserMenu((prev) =>
        prev && prev.participantId === voiceUserMenu.participantId
          ? { ...prev, serverMuted: nextMuted }
          : prev
      );
    }
  };

  const handleServerDeafenToggle = async () => {
    if (!voiceUserMenu || !selectedServerId) return;

    const nextDeafened = !voiceUserMenu.serverDeafened;
    const ok = await runVoiceModerationRequest(
      nextDeafened ? "deafen-user" : "undeafen-user",
      "http://localhost:3001/voice/deafen-user",
      {
        serverId: selectedServerId,
        targetUserId: voiceUserMenu.participantId,
        deafened: nextDeafened,
      },
      { closeMenu: false }
    );

    if (ok) {
      setVoiceUserMenu((prev) =>
        prev && prev.participantId === voiceUserMenu.participantId
          ? { ...prev, serverDeafened: nextDeafened }
          : prev
      );
    }
  };

  const handleVoiceDisconnect = async () => {
    if (!voiceUserMenu || !selectedServerId) return;

    await runVoiceModerationRequest(
      "disconnect-user",
      "http://localhost:3001/voice/disconnect-user",
      {
        serverId: selectedServerId,
        targetUserId: voiceUserMenu.participantId,
      },
      {
        confirmText: `${voiceUserMenu.label} adlı kullanıcıyı ses odasından atmak istiyor musun?`,
      }
    );
  };

  const handleVoiceMoveByUserId = async (targetUserId: string, targetChannelId: string) => {
    if (!selectedServerId || !targetChannelId || !targetUserId) return;

    await runVoiceModerationRequest(
      `move-user:${targetChannelId}:${targetUserId}`,
      "http://localhost:3001/voice/move-user",
      {
        serverId: selectedServerId,
        targetUserId,
        targetChannelId,
      },
      {
        requireOpenVoiceMenu: false,
      }
    );
  };

  const handleVoiceMove = async (targetChannelId: string) => {
    if (!voiceUserMenu || !selectedServerId || !targetChannelId) return;
    await handleVoiceMoveByUserId(voiceUserMenu.participantId, targetChannelId);
  };

  const handleKickMember = async () => {
    if (!voiceUserMenu || !selectedServerId) return;

    await runVoiceModerationRequest(
      "kick-member",
      `http://localhost:3001/servers/${selectedServerId}/kick`,
      {
        targetUserId: voiceUserMenu.participantId,
      },
      {
        confirmText: `${voiceUserMenu.label} adlı kullanıcı sunucudan atılsın mı?`,
      }
    );
  };

  const handleBanMember = async () => {
    if (!voiceUserMenu || !selectedServerId) return;

    await runVoiceModerationRequest(
      "ban-member",
      `http://localhost:3001/servers/${selectedServerId}/ban`,
      {
        targetUserId: voiceUserMenu.participantId,
      },
      {
        confirmText: `${voiceUserMenu.label} adlı kullanıcı sunucudan yasaklansın mı?`,
      }
    );
  };

  const createChannel = async () => {
    if (!canCreateChannels) {
      setCreateError("Bu işlem için yetkin yok.");
      return;
    }

    const token = localStorage.getItem("token");
    if (!token || !selectedServerId) return;

    const trimmedName = channelName.trim();

    if (trimmedName.length < 2) {
      setCreateError("Kanal adı en az 2 karakter olmalı.");
      return;
    }

    try {
      setCreateLoading(true);
      setCreateError("");

      const res = await fetch(
        `http://localhost:3001/channels/server/${selectedServerId}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            name: trimmedName,
            type: channelType,
            isPrivate,
          }),
        }
      );

      const data = await res.json().catch(() => null);

      if (!res.ok) {
        setCreateError(data?.error || "Kanal oluşturulamadı.");
        return;
      }

      setChannelName("");
      setChannelType("text");
      setIsPrivate(false);
      setIsCreateOpen(false);
      onChannelCreated?.();
    } catch (err) {
      console.error(err);
      setCreateError("Kanal oluşturulurken bağlantı hatası oldu.");
    } finally {
      setCreateLoading(false);
    }
  };

  const closeInvitePanel = () => {
    setInviteCode("");
    setInviteError("");
    setInviteSuccess("");
  };

  const openInviteModal = () => {
    setInviteError("");
    setInviteSuccess("");
    setIsInviteOpen(true);
  };

  const closeInviteModal = () => {
    if (inviteLoading) return;
    setIsInviteOpen(false);
  };

  const createInvite = async () => {
    const token = localStorage.getItem("token");
    if (!token || !selectedServerId) return;

    try {
      setInviteLoading(true);
      setInviteError("");
      setInviteSuccess("");

      const maxUses = inviteLimit === "unlimited" ? 9999 : inviteLimit;

      const res = await fetch(
        `http://localhost:3001/servers/${selectedServerId}/invites`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            maxUses,
          }),
        }
      );

      const data = await res.json().catch(() => null);

      if (!res.ok) {
        setInviteError(data?.error || "Davet kodu üretilemedi.");
        return;
      }

      setInviteCode(data?.code || "");
      setInviteSuccess(
        inviteLimit === "unlimited"
          ? "Sınırsız davet kodu oluşturuldu."
          : "Davet kodu oluşturuldu."
      );
      setIsInviteOpen(false);
    } catch (err) {
      console.error(err);
      setInviteError("Davet kodu oluşturulurken bağlantı hatası oldu.");
    } finally {
      setInviteLoading(false);
    }
  };

  const renameServer = async () => {
    if (!canManageServer) {
      setRenameServerError("Bu işlem için yetkin yok.");
      return;
    }

    const token = localStorage.getItem("token");
    if (!token || !selectedServerId) return;

    const trimmed = renameServerValue.trim();
    if (trimmed.length < 2) {
      setRenameServerError("Sunucu adı en az 2 karakter olmalı.");
      return;
    }

    try {
      setRenameServerLoading(true);
      setRenameServerError("");

      const res = await fetch(`http://localhost:3001/servers/${selectedServerId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ name: trimmed }),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setRenameServerError(data?.error || "Sunucu adı güncellenemedi.");
        return;
      }

      setIsRenameServerOpen(false);
      setIsServerMenuOpen(false);
      await onServerUpdated?.({ name: trimmed, avatarUrl: serverAvatarUrl ?? null });
    } catch (err) {
      console.error(err);
      setRenameServerError("Sunucu güncellenirken bağlantı hatası oldu.");
    } finally {
      setRenameServerLoading(false);
    }
  };

  const leaveServer = async () => {
    const token = localStorage.getItem("token");
    if (!token || !selectedServerId) return;
    const ok = window.confirm("Bu sunucudan çıkmak istiyor musun?");
    if (!ok) return;

    try {
      const res = await fetch(`http://localhost:3001/servers/${selectedServerId}/leave`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        window.alert(data?.error || "Sunucudan çıkılamadı.");
        return;
      }
      await onServerLeft?.();
    } catch (err) {
      console.error(err);
      window.alert("Sunucudan çıkılırken bağlantı hatası oldu.");
    }
  };

  const deleteServer = async () => {
    if (!canManageServer) {
      window.alert("Bu işlem için yetkin yok.");
      return;
    }

    const token = localStorage.getItem("token");
    if (!token || !selectedServerId) return;
    const ok = window.confirm("Bu sunucuyu kalıcı olarak silmek istiyor musun?");
    if (!ok) return;

    try {
      const res = await fetch(`http://localhost:3001/servers/${selectedServerId}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        window.alert(data?.error || "Sunucu silinemedi.");
        return;
      }
      await onServerDeleted?.();
    } catch (err) {
      console.error(err);
      window.alert("Sunucu silinirken bağlantı hatası oldu.");
    }
  };

  const openRenameChannelModal = (channel: Channel) => {
    if (!canManageChannels) return;
    setEditingChannel(channel);
    setRenameChannelValue(channel.name);
    setRenameChannelError("");
    setOpenChannelMenuId(null);
  };

  const renameChannel = async () => {
    if (!canManageChannels) {
      setRenameChannelError("Bu işlem için yetkin yok.");
      return;
    }

    const token = localStorage.getItem("token");
    if (!token || !editingChannel) return;

    const trimmed = renameChannelValue.trim();
    if (trimmed.length < 2) {
      setRenameChannelError("Kanal adı en az 2 karakter olmalı.");
      return;
    }

    try {
      setRenameChannelLoading(true);
      setRenameChannelError("");

      const res = await fetch(`http://localhost:3001/channels/${editingChannel.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ name: trimmed }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setRenameChannelError(data?.error || "Kanal güncellenemedi.");
        return;
      }

      setEditingChannel(null);
      await onChannelsChanged?.();
      onChannelCreated?.();
    } catch (err) {
      console.error(err);
      setRenameChannelError("Kanal güncellenirken bağlantı hatası oldu.");
    } finally {
      setRenameChannelLoading(false);
    }
  };

  const deleteChannel = async (channel: Channel) => {
    if (!canManageChannels) {
      window.alert("Bu işlem için yetkin yok.");
      return;
    }

    const token = localStorage.getItem("token");
    if (!token) return;
    const ok = window.confirm(`"${channel.name}" kanalını silmek istiyor musun?`);
    if (!ok) return;

    try {
      const res = await fetch(`http://localhost:3001/channels/${channel.id}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        window.alert(data?.error || "Kanal silinemedi.");
        return;
      }
      setOpenChannelMenuId(null);
      await onChannelsChanged?.();
      onChannelCreated?.();
    } catch (err) {
      console.error(err);
      window.alert("Kanal silinirken bağlantı hatası oldu.");
    }
  };

  const copyInviteCode = async () => {
    if (!inviteCode) return;

    try {
      await navigator.clipboard.writeText(inviteCode);
      setInviteSuccess("Davet kodu panoya kopyalandı.");
    } catch {
      setInviteSuccess("Kopyalama başarısız. Kodu elle kopyalayabilirsin.");
    }
  };

  const textChannels = useMemo(
    () => orderedChannels.filter((channel) => channel.type === "text"),
    [orderedChannels]
  );

  const voiceChannels = useMemo(
    () => orderedChannels.filter((channel) => channel.type === "voice"),
    [orderedChannels]
  );

  const reorderChannelsInList = (
    list: Channel[],
    draggedId: string,
    targetId: string,
    type: "text" | "voice"
  ) => {
    if (!draggedId || !targetId || draggedId === targetId) return list;

    const scoped = list.filter((item) => item.type === type);
    const fromIndex = scoped.findIndex((item) => item.id === draggedId);
    const toIndex = scoped.findIndex((item) => item.id === targetId);
    if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return list;

    const nextScoped = [...scoped];
    const [moved] = nextScoped.splice(fromIndex, 1);
    nextScoped.splice(toIndex, 0, moved);

    let scopedCursor = 0;
    return list.map((item) => {
      if (item.type !== type) return item;
      const nextItem = nextScoped[scopedCursor++];
      return nextItem ? { ...nextItem, position: scopedCursor - 1 } : item;
    });
  };

  const commitChannelReorder = async (type: "text" | "voice", nextList: Channel[]) => {
    const token = localStorage.getItem("token");
    if (!token || !selectedServerId) return false;

    const orderedChannelIds = nextList
      .filter((channel) => channel.type === type)
      .map((channel) => channel.id);

    try {
      dragCommitInFlightRef.current = true;
      const res = await fetch("http://localhost:3001/channels/reorder", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          serverId: selectedServerId,
          type,
          orderedChannelIds,
        }),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok) {
        window.alert(data?.error || "Kanal sırası güncellenemedi.");
        return false;
      }

      await onChannelsChanged?.();
      onChannelCreated?.();
      return true;
    } catch (error) {
      console.error(error);
      window.alert("Kanal sırası güncellenirken bağlantı hatası oldu.");
      return false;
    } finally {
      dragCommitInFlightRef.current = false;
    }
  };

  const handleChannelDragStart = (channel: Channel) => {
    if (!canManageChannels) return;
    setDraggedVoiceMember(null);
    setDraggedChannel({ channelId: channel.id, type: channel.type });
    setDragOverChannelId(channel.id);
  };

  const handleChannelDrop = async (targetChannel: Channel) => {
    if (draggedVoiceMember && canMoveMembers && targetChannel.type === "voice") {
      if (draggedVoiceMember.fromChannelId !== targetChannel.id) {
        await handleVoiceMoveByUserId(draggedVoiceMember.participantId, targetChannel.id);
      }
      setDraggedVoiceMember(null);
      setDragOverChannelId(null);
      return;
    }

    if (!draggedChannel || !canManageChannels) {
      setDragOverChannelId(null);
      return;
    }

    if (draggedChannel.type !== targetChannel.type) {
      setDragOverChannelId(null);
      setDraggedChannel(null);
      return;
    }

    const nextList = reorderChannelsInList(orderedChannels, draggedChannel.channelId, targetChannel.id, draggedChannel.type);
    setDragOverChannelId(null);
    setDraggedChannel(null);

    if (nextList === orderedChannels) return;

    const previous = orderedChannels;
    setOrderedChannels(nextList);
    const ok = await commitChannelReorder(draggedChannel.type, nextList);
    if (!ok) {
      setOrderedChannels(previous);
    }
  };

  const moveTargetVoiceChannels = useMemo(() => {
    if (!voiceUserMenu) return [];
    return voiceChannels.filter((channel) => channel.id !== voiceUserMenu.channelId);
  }, [voiceChannels, voiceUserMenu]);


  return (
    <>
      <div
        style={{
          width,
          minWidth: width,
          height: "100%",
          minHeight: 0,
          background: "linear-gradient(180deg, #171a20 0%, #14171d 100%)",
          borderRight: "1px solid #232833",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            padding: "16px 14px",
            borderBottom: "1px solid #232833",
            background: "linear-gradient(180deg, #1b1f26 0%, #171a20 100%)",
            boxShadow: "0 10px 24px rgba(0,0,0,0.12)",
            flexShrink: 0,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 8,
              marginBottom: 6,
              position: "relative",
            }}
          >
            <button
              onClick={(e) => {
                e.stopPropagation();
                setIsServerMenuOpen((prev) => !prev);
              }}
              style={{
                flex: 1,
                minWidth: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 10,
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.06)",
                color: "white",
                borderRadius: 12,
                padding: "10px 12px",
                cursor: "pointer",
              }}
              title="Sunucu işlemleri"
            >
              <span
                style={{
                  fontSize: 17,
                  fontWeight: 800,
                  minWidth: 0,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  textAlign: "left",
                }}
              >
                {serverName || "Server"}
              </span>
              <span style={{ color: "#aeb6c2", fontSize: 12 }}>▾</span>
            </button>

            {isServerMenuOpen && (
              <div
                onClick={(e) => e.stopPropagation()}
                style={{
                  position: "absolute",
                  top: 52,
                  left: 0,
                  width: 260,
                  background: "#1a1f28",
                  border: "1px solid rgba(255,255,255,0.08)",
                  borderRadius: 16,
                  boxShadow: "0 24px 60px rgba(0,0,0,0.42)",
                  padding: 8,
                  zIndex: 30,
                }}
              >
                <button
                  onClick={() => {
                    setIsServerMenuOpen(false);
                    openInviteModal();
                  }}
                  style={dropdownMenuItemStyle}
                >
                  Sunucuyu Davet Et
                </button>

                {canManageServer && (
                  <button
                    onClick={() => {
                      setIsServerSettingsOpen(true);
                      setIsServerMenuOpen(false);
                    }}
                    style={dropdownMenuItemStyle}
                  >
                    Sunucu Ayarları
                  </button>
                )}

                {canManageServer && (
                  <button
                    onClick={() => {
                      setRenameServerError("");
                      setRenameServerValue(serverName || "");
                      setIsRenameServerOpen(true);
                      setIsServerMenuOpen(false);
                    }}
                    style={dropdownMenuItemStyle}
                  >
                    Sunucu Adını Değiştir
                  </button>
                )}

                {canCreateChannels && (
                  <button
                    onClick={() => {
                      setCreateError("");
                      setChannelName("");
                      setChannelType("text");
                      setIsPrivate(false);
                      setIsCreateOpen(true);
                      setIsServerMenuOpen(false);
                    }}
                    style={dropdownMenuItemStyle}
                  >
                    Kanal Oluştur
                  </button>
                )}

                <button
                  onClick={() => {
                    setIsServerNotificationsOpen(true);
                    setIsServerMenuOpen(false);
                  }}
                  style={dropdownMenuItemStyle}
                >
                  Bildirimler
                </button>

                <div style={dropdownDividerStyle} />

                <button onClick={leaveServer} style={dropdownMenuItemStyle}>
                  Sunucudan Çık
                </button>

                {canManageServer && (
                  <button onClick={deleteServer} style={dropdownDangerItemStyle}>
                    Sunucuyu Sil
                  </button>
                )}
              </div>
            )}

            {isServerNotificationsOpen && selectedServerId && (
              <div
                onClick={(e) => e.stopPropagation()}
                style={{
                  position: "absolute",
                  top: 54,
                  left: 0,
                  width: 286,
                  background:
                    "linear-gradient(180deg, rgba(20,24,35,0.98) 0%, rgba(15,18,27,0.98) 100%)",
                  border: "1px solid rgba(255,255,255,0.08)",
                  borderRadius: 20,
                  boxShadow: "0 28px 70px rgba(0,0,0,0.5)",
                  padding: 12,
                  zIndex: 31,
                  backdropFilter: "blur(18px)",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    justifyContent: "space-between",
                    gap: 10,
                    marginBottom: 10,
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 900, color: "#f7faff", letterSpacing: 0.2 }}>
                      Sunucu Bildirimleri
                    </div>
                    <div
                      style={{
                        marginTop: 3,
                        color: "#98a3b6",
                        fontSize: 11,
                        lineHeight: 1.4,
                      }}
                    >
                      Sunucu mesaj sesini yönet, genel ses seviyesini tüm sunucu bildirimlerine uygula.
                    </div>
                  </div>
                  <button
                    onClick={() => setIsServerNotificationsOpen(false)}
                    style={{
                      width: 28,
                      height: 28,
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

                <div
                  style={{
                    borderRadius: 16,
                    border: "1px solid rgba(255,255,255,0.07)",
                    background: "rgba(255,255,255,0.035)",
                    padding: 10,
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
                      <div style={{ color: "#eef3fb", fontSize: 12, fontWeight: 800 }}>
                        Mesaj sesi
                      </div>
                      <div
                        style={{
                          marginTop: 2,
                          color: "#8f9aad",
                          fontSize: 10.5,
                          lineHeight: 1.35,
                        }}
                      >
                        Yeni mesaj geldiğinde bildirim sesi çalar.
                      </div>
                    </div>

                    <button
                      onClick={() =>
                        updateServerNotificationPreference({
                          enabled: !getServerNotificationSettings(selectedServerId).message.enabled,
                        })
                      }
                      style={{
                        position: "relative",
                        width: 46,
                        height: 26,
                        borderRadius: 999,
                        border: "1px solid rgba(255,255,255,0.08)",
                        background: getServerNotificationSettings(selectedServerId).message.enabled
                          ? "linear-gradient(135deg, rgba(108,92,231,0.95), rgba(199,102,255,0.9))"
                          : "rgba(255,255,255,0.08)",
                        boxShadow: getServerNotificationSettings(selectedServerId).message.enabled
                          ? "0 10px 24px rgba(141,92,255,0.28)"
                          : "none",
                        cursor: "pointer",
                        flexShrink: 0,
                      }}
                      title={getServerNotificationSettings(selectedServerId).message.enabled ? "Açık" : "Kapalı"}
                    >
                      <span
                        style={{
                          position: "absolute",
                          top: 2,
                          left: getServerNotificationSettings(selectedServerId).message.enabled ? 21 : 2,
                          width: 20,
                          height: 20,
                          borderRadius: 999,
                          background: "#fff",
                          boxShadow: "0 6px 14px rgba(0,0,0,0.24)",
                          transition: "left 160ms ease",
                        }}
                      />
                    </button>
                  </div>
                </div>

                <div
                  style={{
                    marginTop: 12,
                    borderRadius: 16,
                    border: "1px solid rgba(255,255,255,0.07)",
                    background: "rgba(255,255,255,0.035)",
                    padding: 10,
                    display: "flex",
                    flexDirection: "column",
                    gap: 10,
                  }}
                >
                  <div style={{ color: "#eef3fb", fontSize: 12, fontWeight: 800 }}>
                    Genel ses seviyesi
                  </div>
                  <div
                    style={{
                      color: "#8f9aad",
                      fontSize: 10.5,
                      lineHeight: 1.35,
                    }}
                  >
                    Join, leave ve yayın açma/kapatma sesleri her zaman çalışır. Bu seviye tüm sunucu seslerine uygulanır.
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span
                      style={{
                        color: "#98a3b6",
                        fontSize: 10.5,
                        fontWeight: 800,
                        minWidth: 32,
                      }}
                    >
                      %{Math.round(getServerNotificationSettings(selectedServerId).message.volume * 100)}
                    </span>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={getServerNotificationSettings(selectedServerId).message.volume}
                      onChange={(e) =>
                        updateServerNotificationPreference({
                          volume: Number(e.target.value),
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

                <button
                  onClick={() => {
                    const settings = getServerNotificationSettings(selectedServerId);
                    void playSound("server-message", settings.message.volume);
                  }}
                  style={{
                    marginTop: 10,
                    width: "100%",
                    height: 38,
                    borderRadius: 12,
                    border: "1px solid rgba(255,255,255,0.08)",
                    background: "linear-gradient(135deg, rgba(255,255,255,0.08), rgba(255,255,255,0.03))",
                    color: "#f2f3f5",
                    cursor: "pointer",
                    fontWeight: 800,
                    boxShadow: "0 12px 28px rgba(0,0,0,0.2)",
                  }}
                >
                  Test Sesi Çal
                </button>
              </div>
            )}
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
              flexWrap: "wrap",
            }}
          >
            <div
              style={{
                fontSize: 13,
                color: "#9aa3af",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                minWidth: 0,
                flex: 1,
              }}
            >
              Kanal listesi ve voice geçiş alanı
            </div>

            <div
              style={{
                padding: "5px 9px",
                borderRadius: 999,
                fontSize: 11,
                fontWeight: 800,
                color: isConnected ? "#b8ffd0" : "#aab2bf",
                background: isConnected
                  ? "rgba(59, 165, 93, 0.16)"
                  : "rgba(255,255,255,0.05)",
                border: isConnected
                  ? "1px solid rgba(59, 165, 93, 0.28)"
                  : "1px solid rgba(255,255,255,0.06)",
                flexShrink: 0,
              }}
            >
              {isConnected ? "VOICE ON" : "IDLE"}
            </div>
          </div>

          {disableVoiceJoin && (
            <div
              style={{
                marginTop: 12,
                borderRadius: 12,
                padding: "10px 12px",
                background: "rgba(88,101,242,0.12)",
                border: "1px solid rgba(88,101,242,0.18)",
                color: "#dbe2ff",
                fontSize: 12,
                lineHeight: 1.5,
              }}
            >
              Aktif DM görüşmesi sırasında server voice odalarına katılım kapalı.
            </div>
          )}

          {(inviteCode || inviteError || inviteSuccess) && (
            <div
              style={{
                marginTop: 12,
                borderRadius: 12,
                padding: 12,
                background: "rgba(255,255,255,0.03)",
                border: "1px solid rgba(255,255,255,0.06)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 10,
                  marginBottom: 8,
                }}
              >
                <div
                  style={{
                    fontSize: 11,
                    letterSpacing: 1,
                    textTransform: "uppercase",
                    color: "#7f8794",
                    fontWeight: 800,
                  }}
                >
                  Invite Code
                </div>

                <button
                  onClick={closeInvitePanel}
                  style={{
                    width: 26,
                    height: 26,
                    borderRadius: 999,
                    border: "none",
                    background: "transparent",
                    color: "#8f98a6",
                    cursor: "pointer",
                    fontSize: 18,
                    lineHeight: 1,
                  }}
                  title="Kapat"
                >
                  ×
                </button>
              </div>

              {inviteCode && (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  <input
                    readOnly
                    value={inviteCode}
                    style={{
                      flex: 1,
                      minWidth: 0,
                      background: "#10141a",
                      color: "white",
                      border: "1px solid #2f3642",
                      borderRadius: 10,
                      padding: "10px 12px",
                      fontSize: 13,
                      outline: "none",
                    }}
                  />

                  <button
                    onClick={copyInviteCode}
                    style={{
                      height: 38,
                      borderRadius: 10,
                      border: "1px solid rgba(255,255,255,0.08)",
                      background: "rgba(255,255,255,0.04)",
                      color: "#d9e0ea",
                      padding: "0 12px",
                      cursor: "pointer",
                      fontWeight: 700,
                    }}
                  >
                    Kopyala
                  </button>
                </div>
              )}

              {inviteError && (
                <div
                  style={{
                    marginTop: 8,
                    color: "#ffb3b5",
                    fontSize: 12,
                  }}
                >
                  {inviteError}
                </div>
              )}

              {inviteSuccess && (
                <div
                  style={{
                    marginTop: 8,
                    color: "#a8f0be",
                    fontSize: 12,
                  }}
                >
                  {inviteSuccess}
                </div>
              )}
            </div>
          )}
        </div>

        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            overflowX: "hidden",
            padding: "8px 8px 14px",
            overscrollBehavior: "contain",
          }}
        >
          {textChannels.length > 0 && (
            <>
              <SectionHeader title="Text Channels" count={textChannels.length} />

              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {textChannels.map((channel) => {
                  const isActive = selectedChannel?.id === channel.id;
                  const menuOpen = openChannelMenuId === channel.id;
                  const unreadCount = Number(channelUnreadMap[channel.id] || 0);

                  return (
                    <div key={channel.id} style={{ position: "relative" }}
                      draggable={canManageChannels}
                      onDragStart={(e) => {
                        if (!canManageChannels) return;
                        e.dataTransfer.effectAllowed = "move";
                        handleChannelDragStart(channel);
                      }}
                      onDragEnd={() => {
                        setDraggedChannel(null);
                        setDragOverChannelId(null);
                      }}
                      onDragOver={(e) => {
                        if (!canManageChannels || !draggedChannel || draggedChannel.type !== "text") return;
                        e.preventDefault();
                        setDragOverChannelId(channel.id);
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        void handleChannelDrop(channel);
                      }}
                    >
                      <button
                        onClick={() => onSelectChannel(channel)}
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
                          padding: canManageChannels ? "11px 44px 11px 12px" : "11px 12px 11px 12px",
                          textAlign: "left",
                          cursor: "pointer",
                          fontSize: 14,
                          fontWeight: isActive ? 700 : 500,
                          display: "flex",
                          alignItems: "center",
                          gap: 10,
                          transition: "0.18s ease",
                          boxShadow: dragOverChannelId === channel.id && draggedChannel?.type === "text"
                            ? "inset 0 2px 0 #7b8aff"
                            : "none",
                        }}
                        title={channel.name}
                      >
                        <span
                          style={{
                            width: 24,
                            height: 24,
                            borderRadius: 8,
                            background: isActive
                              ? "rgba(88,101,242,0.22)"
                              : "rgba(255,255,255,0.04)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            flexShrink: 0,
                            color: isActive ? "#cfd5ff" : "#8791a0",
                            fontWeight: 800,
                            fontSize: 13,
                          }}
                        >
                          #
                        </span>

                        <span
                          style={{
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            flex: 1,
                            minWidth: 0,
                          }}
                        >
                          {channel.name}
                        </span>

                        {unreadCount > 0 && !isActive ? (
                          <span
                            style={{
                              minWidth: 20,
                              height: 20,
                              borderRadius: 999,
                              padding: "0 7px",
                              display: "inline-flex",
                              alignItems: "center",
                              justifyContent: "center",
                              background: "#ed4245",
                              color: "#fff",
                              fontSize: 11,
                              fontWeight: 800,
                              flexShrink: 0,
                              boxShadow: "0 8px 18px rgba(237,66,69,0.28)",
                            }}
                          >
                            {unreadCount > 99 ? "99+" : unreadCount}
                          </span>
                        ) : null}
                      </button>

                      {canManageChannels && (
                        <>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setOpenChannelMenuId((prev) => (prev === channel.id ? null : channel.id));
                            }}
                            style={channelActionButtonStyle}
                            title="Kanal işlemleri"
                          >
                            ⋯
                          </button>

                          {menuOpen && (
                            <div
                              onClick={(e) => e.stopPropagation()}
                              style={channelMenuStyle}
                            >
                              <button
                                onClick={() => openRenameChannelModal(channel)}
                                style={dropdownMenuItemStyle}
                              >
                                Kanalı Yeniden Adlandır
                              </button>
                              <button
                                onClick={() => deleteChannel(channel)}
                                style={dropdownDangerItemStyle}
                              >
                                Kanalı Sil
                              </button>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {voiceChannels.length > 0 && (
            <>
              <SectionHeader title="Voice Channels" count={voiceChannels.length} />

              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                }}
              >
                {voiceChannels.map((channel) => {
                  const isSelected = selectedChannel?.id === channel.id;
                  const isCurrentVoiceRoom = activeVoiceChannelId === channel.id;
                  const members = voicePresenceMap[channel.id] || [];
                  const sortedMembers = [...members].sort((a, b) =>
                    String(a.displayName || "").localeCompare(
                      String(b.displayName || ""),
                      "tr",
                      { sensitivity: "base" }
                    )
                  );
                  const menuOpen = openChannelMenuId === channel.id;
                  const joinBlocked = disableVoiceJoin && !isCurrentVoiceRoom;
                  const channelStreamingUserIds = getChannelStreamingUserIds(
                    channel,
                    streamingUserIdsByChannel
                  );
                  const activeLiveCount = members.filter((member) =>
                    channelStreamingUserIds.includes(String(member.userId))
                  ).length;

                  return (
                    <div
                      key={channel.id}
                      draggable={canManageChannels}
                      onDragStart={(e) => {
                        if (!canManageChannels) return;
                        e.dataTransfer.effectAllowed = "move";
                        handleChannelDragStart(channel);
                      }}
                      onDragEnd={() => {
                        setDraggedChannel(null);
                        setDraggedVoiceMember(null);
                        setDragOverChannelId(null);
                      }}
                      onDragOver={(e) => {
                        const canAcceptChannel = canManageChannels && Boolean(draggedChannel) && draggedChannel?.type === "voice";
                        const canAcceptMember = canMoveMembers && Boolean(draggedVoiceMember);
                        if (!canAcceptChannel && !canAcceptMember) return;
                        e.preventDefault();
                        setDragOverChannelId(channel.id);
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        void handleChannelDrop(channel);
                      }}
                      onContextMenu={(e) => {
                        if (!canManageChannels) return;
                        e.preventDefault();
                        e.stopPropagation();
                        setOpenChannelMenuId((prev) =>
                          prev === channel.id ? null : channel.id
                        );
                      }}
                      style={{
                        position: "relative",
                        borderRadius: 20,
                        overflow: "visible",
                        opacity: joinBlocked ? 0.82 : 1,
                        border: isSelected || isCurrentVoiceRoom
                          ? "1px solid rgba(88,101,242,0.22)"
                          : "1px solid rgba(255,255,255,0.05)",
                        background: isSelected || isCurrentVoiceRoom
                          ? "linear-gradient(180deg, rgba(88,101,242,0.13), rgba(255,255,255,0.03))"
                          : "linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.02))",
                        boxShadow: dragOverChannelId === channel.id
                          ? "0 0 0 2px rgba(123,138,255,0.55), 0 18px 36px rgba(88,101,242,0.14)"
                          : isCurrentVoiceRoom
                            ? "0 16px 34px rgba(88,101,242,0.14)"
                            : "0 12px 28px rgba(0,0,0,0.16)",
                      }}
                    >
                      <button
                        onClick={() => onSelectChannel(channel)}
                        onDoubleClick={() => handleChannelDoubleClick(channel)}
                        style={{
                          width: "100%",
                          background: "transparent",
                          color: isSelected ? "#ffffff" : "#c6ccd6",
                          border: "none",
                          padding: canManageChannels ? "14px 52px 12px 14px" : "14px 14px 12px 14px",
                          textAlign: "left",
                          cursor: "pointer",
                          fontSize: 14,
                          fontWeight: isSelected ? 700 : 600,
                          display: "flex",
                          alignItems: "flex-start",
                          justifyContent: "space-between",
                          gap: 12,
                        }}
                        title={
                          joinBlocked
                            ? "Aktif DM görüşmesi sırasında server voice devre dışı"
                            : "Çift tıkla ve voice'a bağlan"
                        }
                      >
                        <span
                          style={{
                            display: "flex",
                            alignItems: "flex-start",
                            gap: 12,
                            minWidth: 0,
                            flex: 1,
                          }}
                        >
                          <span
                            style={{
                              width: 34,
                              height: 34,
                              borderRadius: 12,
                              background: isCurrentVoiceRoom
                                ? "linear-gradient(135deg, #5865f2, #7b8aff)"
                                : joinBlocked
                                  ? "rgba(255,255,255,0.08)"
                                  : "rgba(255,255,255,0.05)",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              flexShrink: 0,
                              boxShadow: isCurrentVoiceRoom
                                ? "0 10px 24px rgba(88,101,242,0.25)"
                                : "none",
                            }}
                          >
                            {joinBlocked ? "🔒" : "🔊"}
                          </span>

                          <span
                            style={{
                              display: "flex",
                              flexDirection: "column",
                              minWidth: 0,
                              flex: 1,
                            }}
                          >
                            <span
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 8,
                                flexWrap: "wrap",
                                marginBottom: 4,
                              }}
                            >
                              <span
                                style={{
                                  whiteSpace: "nowrap",
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  fontSize: 15,
                                  fontWeight: 800,
                                }}
                              >
                                {channel.name}
                              </span>

                              {activeLiveCount > 0 ? (
                                <span
                                  style={{
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: 4,
                                    height: 20,
                                    padding: "0 7px",
                                    borderRadius: 999,
                                    background: "rgba(237,66,69,0.14)",
                                    border: "1px solid rgba(237,66,69,0.22)",
                                    color: "#ffc6c8",
                                    fontSize: 10,
                                    fontWeight: 900,
                                    letterSpacing: 0.25,
                                  }}
                                >
                                  <Radio size={10} strokeWidth={2.3} />
                                  LIVE
                                </span>
                              ) : null}
                            </span>

                            <span
                              style={{
                                fontSize: 12,
                                color: isCurrentVoiceRoom ? "#9fb0ff" : "#7f8794",
                                lineHeight: 1.45,
                              }}
                            >
                              {isCurrentVoiceRoom
                                ? "Şu an bu odadasın"
                                : joinBlocked
                                  ? "DM görüşmesi bitmeden katılım kapalı"
                                  : members.length > 0
                                    ? `${sortedMembers.length} kişi içeride • çift tıkla ve katıl`
                                    : "Bağlanmak için çift tıkla"}
                            </span>
                          </span>
                        </span>

                        <span
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "flex-end",
                            gap: 8,
                            flexShrink: 0,
                          }}
                        >
                          {members.length > 0 ? (
                            <span
                              style={{
                                minWidth: 28,
                                height: 28,
                                borderRadius: 999,
                                padding: "0 9px",
                                background: isCurrentVoiceRoom
                                  ? "rgba(88,101,242,0.18)"
                                  : "rgba(255,255,255,0.05)",
                                border: isCurrentVoiceRoom
                                  ? "1px solid rgba(88,101,242,0.22)"
                                  : "1px solid rgba(255,255,255,0.06)",
                                display: "inline-flex",
                                alignItems: "center",
                                justifyContent: "center",
                                fontSize: 12,
                                fontWeight: 800,
                                color: isCurrentVoiceRoom ? "#d7ddff" : "#c0c7d2",
                              }}
                            >
                              {sortedMembers.length}
                            </span>
                          ) : null}

                          {members.length > 0 ? (
                            <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                              {sortedMembers.slice(0, 4).map((member) => (
                                member.avatarUrl ? (
                                  <img
                                    key={member.userId}
                                    src={member.avatarUrl}
                                    alt={member.displayName}
                                    style={{
                                      width: 24,
                                      height: 24,
                                      borderRadius: 999,
                                      objectFit: "cover",
                                      border: "1px solid rgba(255,255,255,0.12)",
                                      background: "#20242c",
                                      marginLeft: -8,
                                    }}
                                  />
                                ) : (
                                  <span
                                    key={member.userId}
                                    style={{
                                      width: 24,
                                      height: 24,
                                      borderRadius: 999,
                                      background: isCurrentVoiceRoom
                                        ? "linear-gradient(135deg, #5865f2, #7b8aff)"
                                        : "#343946",
                                      display: "inline-flex",
                                      alignItems: "center",
                                      justifyContent: "center",
                                      fontSize: 9,
                                      color: "white",
                                      fontWeight: 800,
                                      marginLeft: -8,
                                      border: "1px solid rgba(255,255,255,0.12)",
                                    }}
                                  >
                                    {getInitials(member.displayName)}
                                  </span>
                                )
                              ))}
                            </span>
                          ) : null}
                        </span>
                      </button>

                      {canManageChannels && (
                        <>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setOpenChannelMenuId((prev) => (prev === channel.id ? null : channel.id));
                            }}
                            style={channelActionButtonStyle}
                            title="Kanal işlemleri"
                          >
                            ⋯
                          </button>

                          {menuOpen && (
                            <div
                              onClick={(e) => e.stopPropagation()}
                              style={channelMenuStyle}
                            >
                              <button
                                onClick={() => openRenameChannelModal(channel)}
                                style={dropdownMenuItemStyle}
                              >
                                Kanalı Yeniden Adlandır
                              </button>
                              <button
                                onClick={() => deleteChannel(channel)}
                                style={dropdownDangerItemStyle}
                              >
                                Kanalı Sil
                              </button>
                            </div>
                          )}
                        </>
                      )}

                      {members.length > 0 && (
                        <div
                          style={{
                            padding: "0 12px 12px 12px",
                            display: "grid",
                            gridTemplateColumns: "1fr",
                            gap: 7,
                          }}
                        >
                          {sortedMembers.map((member) => {
                            const duration = formatDuration(Date.now() - member.joinedAt);
                            const isSelf = currentUserId === String(member.userId);
                            const isStreaming = channelStreamingUserIds.includes(
                              String(member.userId)
                            );

                            return (
                              <button
                                key={member.userId}
                                draggable={canMoveMembers && !isSelf}
                                title={
                                  isSelf
                                    ? `${member.displayName}${canMuteMembers || canDeafenMembers ? " • Sağ tık ile moderasyon menüsü" : ""}`
                                    : `${member.displayName} • Sağ tık ile yerel ses ayarı${canMoveMembers ? " • Sürükleyerek başka odaya taşı" : ""}`
                                }
                                onDragStart={(e) => {
                                  if (!canMoveMembers || isSelf) return;
                                  e.stopPropagation();
                                  e.dataTransfer.effectAllowed = "move";
                                  setDraggedChannel(null);
                                  setDraggedVoiceMember({
                                    participantId: String(member.userId),
                                    fromChannelId: String(channel.id),
                                    label: member.displayName,
                                  });
                                  setVoiceUserMenu(null);
                                  setDragOverChannelId(channel.id);
                                }}
                                onDragEnd={() => {
                                  setDraggedVoiceMember(null);
                                  setDragOverChannelId(null);
                                }}
                                onContextMenu={(e) => {
                                  const canSelfOpenModerationMenu =
                                    isSelf &&
                                    Boolean(selectedServerId) &&
                                    (canMuteMembers || canDeafenMembers);

                                  const canOpenVoiceUserMenu = isSelf
                                    ? canSelfOpenModerationMenu
                                    : true;

                                  if (!canOpenVoiceUserMenu) return;
                                  e.preventDefault();
                                  e.stopPropagation();
                                  setVoiceUserMenu({
                                    participantId: String(member.userId),
                                    label: member.displayName,
                                    x: e.clientX,
                                    y: e.clientY,
                                    channelId: String(channel.id),
                                    serverMuted: Boolean(member.serverMuted),
                                    serverDeafened: Boolean(member.serverDeafened),
                                  });
                                }}
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: 10,
                                  minWidth: 0,
                                  width: "100%",
                                  padding: "9px 10px",
                                  borderRadius: 12,
                                  background: "rgba(255,255,255,0.03)",
                                  border: "1px solid rgba(255,255,255,0.05)",
                                  boxSizing: "border-box",
                                  cursor:
                                    isSelf && !(canMuteMembers || canDeafenMembers)
                                      ? "default"
                                      : "context-menu",
                                  textAlign: "left",
                                }}
                              >
                                {member.avatarUrl ? (
                                  <img
                                    src={member.avatarUrl}
                                    alt={member.displayName}
                                    style={{
                                      width: 30,
                                      height: 30,
                                      borderRadius: 12,
                                      objectFit: "cover",
                                      flexShrink: 0,
                                      background: "#20242c",
                                    }}
                                  />
                                ) : (
                                  <div
                                    style={{
                                      width: 30,
                                      height: 30,
                                      borderRadius: 12,
                                      background: isCurrentVoiceRoom
                                        ? "linear-gradient(135deg, #5865f2, #7b8aff)"
                                        : "#343946",
                                      display: "flex",
                                      alignItems: "center",
                                      justifyContent: "center",
                                      fontSize: 11,
                                      color: "white",
                                      fontWeight: 800,
                                      flexShrink: 0,
                                    }}
                                  >
                                    {getInitials(member.displayName)}
                                  </div>
                                )}

                                <div
                                  style={{
                                    display: "flex",
                                    flexDirection: "column",
                                    minWidth: 0,
                                    flex: 1,
                                  }}
                                >
                                  <div
                                    style={{
                                      display: "flex",
                                      alignItems: "center",
                                      gap: 6,
                                      minWidth: 0,
                                    }}
                                  >
                                    <span
                                      style={{
                                        color: "#edf1f7",
                                        fontSize: 13,
                                        fontWeight: 600,
                                        whiteSpace: "nowrap",
                                        overflow: "hidden",
                                        textOverflow: "ellipsis",
                                        minWidth: 0,
                                      }}
                                    >
                                      {member.displayName}
                                    </span>

                                    {isStreaming && (
                                      <span
                                        style={{
                                          display: "inline-flex",
                                          alignItems: "center",
                                          gap: 4,
                                          height: 18,
                                          padding: "0 6px",
                                          borderRadius: 999,
                                          background: "rgba(237,66,69,0.12)",
                                          border: "1px solid rgba(237,66,69,0.20)",
                                          color: "#ffc4c6",
                                          fontSize: 10,
                                          fontWeight: 800,
                                          letterSpacing: 0.25,
                                          flexShrink: 0,
                                        }}
                                      >
                                        <Radio size={10} strokeWidth={2.3} />
                                        LIVE
                                      </span>
                                    )}
                                  </div>

                                  {!isSelf && (
                                    <span
                                      style={{
                                        marginTop: 2,
                                        color: voiceUserSettings[member.userId]?.locallyMuted ? "#c38f95" : "#7f8794",
                                        fontSize: 11,
                                        fontWeight: 500,
                                      }}
                                    >
                                      {voiceUserSettings[member.userId]?.locallyMuted
                                        ? `Yerelde susturuldu • ${Math.round((voiceUserSettings[member.userId]?.volume ?? 1) * 100)}%`
                                        : `Yerel ses • ${Math.round((voiceUserSettings[member.userId]?.volume ?? 1) * 100)}%`}
                                    </span>
                                  )}
                                </div>

                                <span
                                  style={{
                                    color: "#97a0b1",
                                    fontSize: 11,
                                    flexShrink: 0,
                                    fontVariantNumeric: "tabular-nums",
                                  }}
                                >
                                  {duration}
                                </span>

                                <VoiceStateIcons
                                  selfMuted={Boolean((member as any).selfMuted)}
                                  selfDeafened={Boolean((member as any).selfDeafened)}
                                  serverMuted={Boolean((member as any).serverMuted)}
                                  serverDeafened={Boolean((member as any).serverDeafened)}
                                />
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {textChannels.length === 0 && voiceChannels.length === 0 && (
            <div
              style={{
                marginTop: 12,
                padding: "12px 14px",
                borderRadius: 12,
                background: "rgba(255,255,255,0.03)",
                border: "1px solid rgba(255,255,255,0.04)",
                color: "#8f98a6",
                fontSize: 13,
                lineHeight: 1.6,
              }}
            >
              Bu sunucuda henüz kanal yok.
            </div>
          )}
        </div>
      </div>

            {voiceUserMenu && (!isVoiceMenuSelf || canShowSelfVoiceModeration) && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            position: "fixed",
            top: Math.min(voiceUserMenu.y, window.innerHeight - 520),
            left: Math.min(voiceUserMenu.x, window.innerWidth - 320),
            width: 302,
            maxHeight: "min(78vh, 620px)",
            overflowY: "auto",
            background: "linear-gradient(180deg, rgba(26,31,40,0.98) 0%, rgba(20,24,31,0.98) 100%)",
            border: "1px solid rgba(255,255,255,0.06)",
            borderRadius: 16,
            boxShadow: "0 18px 44px rgba(0,0,0,0.34)",
            backdropFilter: "blur(12px)",
            padding: 12,
            zIndex: 9999,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              marginBottom: 12,
            }}
          >
            <div
              style={{
                width: 30,
                height: 30,
                borderRadius: 10,
                background: "rgba(123,138,255,0.10)",
                border: "1px solid rgba(123,138,255,0.16)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#bcc7ff",
                flexShrink: 0,
              }}
            >
              <SlidersHorizontal size={14} strokeWidth={2.1} />
            </div>

            <div style={{ minWidth: 0, flex: 1 }}>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 700,
                  color: "#ebf0f8",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {voiceUserMenu.label}
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: "#8f98a6",
                  marginTop: 2,
                }}
              >
                {isVoiceMenuSelf
                  ? "Moderasyon işlemleri"
                  : canShowOtherVoiceModeration
                    ? "Yerel ses + moderasyon işlemleri"
                    : "Yerel ses ayarları"}
              </div>
            </div>
          </div>

          {!isVoiceMenuSelf && (
            <>
              <button
                onClick={() => {
                  const current = voiceUserSettings[voiceUserMenu.participantId] || {
                    volume: 1,
                    locallyMuted: false,
                  };
                  const nextMuted = !current.locallyMuted;

                  setVoiceUserSettings((prev) => ({
                    ...prev,
                    [voiceUserMenu.participantId]: {
                      volume: prev[voiceUserMenu.participantId]?.volume ?? 1,
                      locallyMuted: nextMuted,
                    },
                  }));

                  window.dispatchEvent(
                    new CustomEvent(VOICE_USER_ACTION_EVENT_NAME, {
                      detail: {
                        participantId: voiceUserMenu.participantId,
                        action: "toggle-local-mute",
                      },
                    })
                  );
                }}
                style={{
                  width: "100%",
                  height: 42,
                  borderRadius: 12,
                  border: "1px solid rgba(255,255,255,0.06)",
                  background: voiceUserSettings[voiceUserMenu.participantId]?.locallyMuted
                    ? "rgba(237,66,69,0.11)"
                    : "rgba(255,255,255,0.035)",
                  color: voiceUserSettings[voiceUserMenu.participantId]?.locallyMuted
                    ? "#ffc2c3"
                    : "#dde4ef",
                  cursor: "pointer",
                  fontWeight: 600,
                  padding: "0 12px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  transition: "0.16s ease",
                }}
              >
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  {voiceUserSettings[voiceUserMenu.participantId]?.locallyMuted ? (
                    <Volume2 size={15} strokeWidth={2.1} />
                  ) : (
                    <VolumeX size={15} strokeWidth={2.1} />
                  )}
                  {voiceUserSettings[voiceUserMenu.participantId]?.locallyMuted
                    ? "Yerel sesi aç"
                    : "Yerel sustur"}
                </span>

                <span
                  style={{
                    fontSize: 11,
                    color: voiceUserSettings[voiceUserMenu.participantId]?.locallyMuted
                      ? "#ffc2c3"
                      : "#9eabc0",
                    fontWeight: 700,
                  }}
                >
                  {voiceUserSettings[voiceUserMenu.participantId]?.locallyMuted ? "Açık" : "Kapalı"}
                </span>
              </button>

              <div
                style={{
                  marginTop: 12,
                  padding: "10px 10px 8px",
                  borderRadius: 12,
                  background: "rgba(255,255,255,0.025)",
                  border: "1px solid rgba(255,255,255,0.045)",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 10,
                    marginBottom: 8,
                  }}
                >
                  <div
                    style={{
                      fontSize: 11,
                      color: "#8f98a6",
                      fontWeight: 600,
                    }}
                  >
                    Ses seviyesi
                  </div>

                  <div
                    style={{
                      fontSize: 11,
                      color: "#c7cfde",
                      fontWeight: 700,
                    }}
                  >
                    {Math.round((voiceUserSettings[voiceUserMenu.participantId]?.volume ?? 1) * 100)}%
                  </div>
                </div>

                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={voiceUserSettings[voiceUserMenu.participantId]?.volume ?? 1}
                  onChange={(e) => {
                    const volume = Number(e.target.value);
                    setVoiceUserSettings((prev) => ({
                      ...prev,
                      [voiceUserMenu.participantId]: {
                        volume,
                        locallyMuted: prev[voiceUserMenu.participantId]?.locallyMuted ?? false,
                      },
                    }));
                    window.dispatchEvent(
                      new CustomEvent(VOICE_USER_ACTION_EVENT_NAME, {
                        detail: {
                          participantId: voiceUserMenu.participantId,
                          action: "set-volume",
                          volume,
                        },
                      })
                    );
                  }}
                  style={{
                    width: "100%",
                    accentColor: "#7b8aff",
                  }}
                />
              </div>
            </>
          )}

          {(canShowSelfVoiceModeration || canShowOtherVoiceModeration) && (
            <div
              style={{
                marginTop: isVoiceMenuSelf ? 0 : 12,
                padding: 10,
                borderRadius: 12,
                background: "rgba(255,255,255,0.025)",
                border: "1px solid rgba(255,255,255,0.045)",
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  color: "#8f98a6",
                  fontWeight: 700,
                  letterSpacing: 0.4,
                  textTransform: "uppercase",
                }}
              >
                Moderasyon
              </div>

              {canMuteMembers && (
                <button
                  onClick={handleServerMuteToggle}
                  disabled={voiceModerationLoading !== null}
                  style={{
                    ...voiceModerationButtonStyle,
                    background: voiceUserMenu.serverMuted
                      ? "rgba(237,66,69,0.11)"
                      : "rgba(255,255,255,0.035)",
                    color: voiceUserMenu.serverMuted ? "#ffc2c3" : "#dde4ef",
                  }}
                >
                  {voiceModerationLoading === "mute-user" || voiceModerationLoading === "unmute-user"
                    ? "İşleniyor..."
                    : voiceUserMenu.serverMuted
                      ? "Sunucu susturmasını kaldır"
                      : "Sunucuda sustur"}
                </button>
              )}

              {canDeafenMembers && (
                <button
                  onClick={handleServerDeafenToggle}
                  disabled={voiceModerationLoading !== null}
                  style={{
                    ...voiceModerationButtonStyle,
                    background: voiceUserMenu.serverDeafened
                      ? "rgba(237,66,69,0.11)"
                      : "rgba(255,255,255,0.035)",
                    color: voiceUserMenu.serverDeafened ? "#ffc2c3" : "#dde4ef",
                  }}
                >
                  {voiceModerationLoading === "deafen-user" || voiceModerationLoading === "undeafen-user"
                    ? "İşleniyor..."
                    : voiceUserMenu.serverDeafened
                      ? "Sağırlaştırmayı kaldır"
                      : "Sağırlaştır"}
                </button>
              )}

              {canDisconnectMembers && !isVoiceMenuSelf && (
                <button
                  onClick={handleVoiceDisconnect}
                  disabled={voiceModerationLoading !== null}
                  style={voiceModerationDangerButtonStyle}
                >
                  {voiceModerationLoading === "disconnect-user" ? "İşleniyor..." : "Sesten at"}
                </button>
              )}

              {canMoveMembers && !isVoiceMenuSelf && moveTargetVoiceChannels.length > 0 && (
                <button
                  onClick={() => {
                    if (!voiceUserMenu) return;
                    const panelWidth = 260;
                    const nextX = Math.min(voiceUserMenu.x + 314, window.innerWidth - panelWidth - 12);
                    const nextY = Math.min(voiceUserMenu.y + 140, window.innerHeight - 360);
                    setVoiceMovePanel({ target: { ...voiceUserMenu }, x: Math.max(12, nextX), y: Math.max(12, nextY) });
                  }}
                  disabled={voiceModerationLoading !== null}
                  style={voiceModerationButtonStyle}
                >
                  {voiceModerationLoading?.startsWith("move-user:") ? "Taşınıyor..." : "Başka odaya taşı"}
                </button>
              )}

              {canManageServer && !isVoiceMenuSelf && (
                <>
                  <div style={{ height: 1, background: "rgba(255,255,255,0.05)", margin: "4px 0" }} />

                  <button
                    onClick={handleKickMember}
                    disabled={voiceModerationLoading !== null}
                    style={voiceModerationDangerButtonStyle}
                  >
                    {voiceModerationLoading === "kick-member" ? "İşleniyor..." : "Sunucudan at"}
                  </button>

                  <button
                    onClick={handleBanMember}
                    disabled={voiceModerationLoading !== null}
                    style={voiceModerationDangerButtonStyle}
                  >
                    {voiceModerationLoading === "ban-member" ? "İşleniyor..." : "Sunucudan yasakla"}
                  </button>
                </>
              )}

              {voiceModerationError && (
                <div
                  style={{
                    fontSize: 12,
                    color: "#ffb3b5",
                    lineHeight: 1.45,
                    marginTop: 4,
                  }}
                >
                  {voiceModerationError}
                </div>
              )}
            </div>
          )}
        </div>
      )}


      {voiceMovePanel && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            position: "fixed",
            top: voiceMovePanel.y,
            left: voiceMovePanel.x,
            width: 248,
            maxHeight: "min(62vh, 360px)",
            overflow: "hidden",
            borderRadius: 16,
            border: "1px solid rgba(255,255,255,0.08)",
            background: "linear-gradient(180deg,#1b2028,#151922)",
            boxShadow: "0 24px 60px rgba(0,0,0,0.38)",
            zIndex: 10000,
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
              padding: "12px 12px 10px",
              borderBottom: "1px solid rgba(255,255,255,0.06)",
            }}
          >
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ color: "#eef2f7", fontSize: 13, fontWeight: 800, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                Başka odaya taşı
              </div>
              <div style={{ color: "#8f98a6", fontSize: 11, marginTop: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {voiceMovePanel.target.label} için hedef kanal
              </div>
            </div>

            <button
              onClick={() => setVoiceMovePanel(null)}
              disabled={voiceModerationLoading !== null}
              style={{
                width: 28, minWidth: 28, height: 28, borderRadius: 9,
                border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.04)",
                color: "#cfd6e4", cursor: voiceModerationLoading !== null ? "not-allowed" : "pointer",
                display: "inline-flex", alignItems: "center", justifyContent: "center", padding: 0, flexShrink: 0,
              }}
              title="Kapat"
            >
              ×
            </button>
          </div>

          <div style={{ padding: 8, maxHeight: "min(62vh, 300px)", overflowY: "auto" }}>
            {voiceChannels
              .filter((channel) => channel.id !== voiceMovePanel.target.channelId)
              .map((channel) => (
                <button
                  key={channel.id}
                  onClick={async () => {
                    await handleVoiceMoveByUserId(voiceMovePanel.target.participantId, channel.id);
                    setVoiceMovePanel(null);
                    setVoiceUserMenu(null);
                  }}
                  disabled={voiceModerationLoading !== null}
                  style={{
                    width: "100%", minHeight: 42, borderRadius: 10, border: "none", background: "transparent",
                    color: "#e8edf5", textAlign: "left", padding: "0 12px",
                    cursor: voiceModerationLoading !== null ? "not-allowed" : "pointer",
                    fontSize: 13, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10,
                    opacity: voiceModerationLoading !== null ? 0.65 : 1,
                  }}
                >
                  <span style={{ minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {channel.name}
                  </span>
                  <span style={{ color: "#8f98a6", fontSize: 12, flexShrink: 0 }}>›</span>
                </button>
              ))}
          </div>
        </div>
      )}

      {isCreateOpen && (
        <div
          onClick={() => {
            if (!createLoading) setIsCreateOpen(false);
          }}
          style={modalOverlayStyle}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={modalCardStyle}
          >
            <div style={modalLabelStyle}>Create Channel</div>

            <div style={modalTitleStyle}>
              Yeni kanal oluştur
            </div>

            <div style={modalTextStyle}>
              Yazı veya ses kanalı oluşturabilirsin.
            </div>

            <input
              value={channelName}
              onChange={(e) => setChannelName(e.target.value)}
              placeholder="Kanal adı"
              autoFocus
              style={modalInputStyle}
            />

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 10,
                marginBottom: 12,
              }}
            >
              <button
                onClick={() => setChannelType("text")}
                style={{
                  height: 42,
                  borderRadius: 12,
                  border:
                    channelType === "text"
                      ? "1px solid rgba(88,101,242,0.25)"
                      : "1px solid rgba(255,255,255,0.08)",
                  background:
                    channelType === "text"
                      ? "linear-gradient(135deg, rgba(88,101,242,0.18), rgba(123,138,255,0.10))"
                      : "rgba(255,255,255,0.04)",
                  color: "white",
                  cursor: "pointer",
                  fontWeight: 700,
                }}
              >
                # Text
              </button>

              <button
                onClick={() => setChannelType("voice")}
                style={{
                  height: 42,
                  borderRadius: 12,
                  border:
                    channelType === "voice"
                      ? "1px solid rgba(88,101,242,0.25)"
                      : "1px solid rgba(255,255,255,0.08)",
                  background:
                    channelType === "voice"
                      ? "linear-gradient(135deg, rgba(88,101,242,0.18), rgba(123,138,255,0.10))"
                      : "rgba(255,255,255,0.04)",
                  color: "white",
                  cursor: "pointer",
                  fontWeight: 700,
                }}
              >
                🔊 Voice
              </button>
            </div>

            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                color: "#cfd6e4",
                fontSize: 14,
                marginBottom: 6,
                cursor: "pointer",
              }}
            >
              <input
                type="checkbox"
                checked={isPrivate}
                onChange={(e) => setIsPrivate(e.target.checked)}
              />
              Private channel
            </label>

            {createError && (
              <div style={modalErrorStyle}>
                {createError}
              </div>
            )}

            <div style={modalFooterActionsStyle}>
              <button
                onClick={() => setIsCreateOpen(false)}
                disabled={createLoading}
                style={modalSecondaryButtonStyle}
              >
                İptal
              </button>

              <button
                onClick={createChannel}
                disabled={createLoading}
                style={modalPrimaryButtonStyle}
              >
                {createLoading ? "Oluşturuluyor..." : "Oluştur"}
              </button>
            </div>
          </div>
        </div>
      )}

            {isServerSettingsOpen && selectedServerId && (
        <ServerSettingsModal
          serverId={selectedServerId}
          currentName={serverName || ""}
          currentAvatarUrl={serverAvatarUrl ?? null}
          onClose={() => setIsServerSettingsOpen(false)}
          onSaved={async (nextServer) => {
            setIsServerSettingsOpen(false);
            await onServerUpdated?.(nextServer);
          }}
        />
      )}

{isRenameServerOpen && (
        <div onClick={() => !renameServerLoading && setIsRenameServerOpen(false)} style={modalOverlayStyle}>
          <div onClick={(e) => e.stopPropagation()} style={modalCardStyle}>
            <div style={modalLabelStyle}>Server Settings</div>
            <div style={modalTitleStyle}>Sunucu adını değiştir</div>
            <div style={modalTextStyle}>Sunucu başlığında görünecek yeni adı gir.</div>
            <input
              value={renameServerValue}
              onChange={(e) => setRenameServerValue(e.target.value)}
              placeholder="Sunucu adı"
              autoFocus
              style={modalInputStyle}
            />
            {renameServerError && <div style={modalErrorStyle}>{renameServerError}</div>}
            <div style={modalFooterActionsStyle}>
              <button onClick={() => setIsRenameServerOpen(false)} disabled={renameServerLoading} style={modalSecondaryButtonStyle}>İptal</button>
              <button onClick={renameServer} disabled={renameServerLoading} style={modalPrimaryButtonStyle}>{renameServerLoading ? "Kaydediliyor..." : "Kaydet"}</button>
            </div>
          </div>
        </div>
      )}

      {editingChannel && (
        <div onClick={() => !renameChannelLoading && setEditingChannel(null)} style={modalOverlayStyle}>
          <div onClick={(e) => e.stopPropagation()} style={modalCardStyle}>
            <div style={modalLabelStyle}>Channel Settings</div>
            <div style={modalTitleStyle}>Kanalı yeniden adlandır</div>
            <div style={modalTextStyle}>Kanalın yeni adını gir.</div>
            <input
              value={renameChannelValue}
              onChange={(e) => setRenameChannelValue(e.target.value)}
              placeholder="Kanal adı"
              autoFocus
              style={modalInputStyle}
            />
            {renameChannelError && <div style={modalErrorStyle}>{renameChannelError}</div>}
            <div style={modalFooterActionsStyle}>
              <button onClick={() => setEditingChannel(null)} disabled={renameChannelLoading} style={modalSecondaryButtonStyle}>İptal</button>
              <button onClick={renameChannel} disabled={renameChannelLoading} style={modalPrimaryButtonStyle}>{renameChannelLoading ? "Kaydediliyor..." : "Kaydet"}</button>
            </div>
          </div>
        </div>
      )}

      {isInviteOpen && (
        <div
          onClick={closeInviteModal}
          style={modalOverlayStyle}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={modalCardStyle}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 10,
                marginBottom: 8,
              }}
            >
              <div style={modalLabelStyle}>Create Invite</div>

              <button
                onClick={closeInviteModal}
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: 999,
                  border: "none",
                  background: "transparent",
                  color: "#8f98a6",
                  cursor: "pointer",
                  fontSize: 22,
                  lineHeight: 1,
                }}
              >
                ×
              </button>
            </div>

            <div style={modalTitleStyle}>Davet kodu oluştur</div>

            <div style={modalTextStyle}>
              Davet kodunun kaç kez kullanılabileceğini seç.
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 10,
                marginTop: 14,
              }}
            >
              {(
                [
                  { label: "Sınırsız", value: "unlimited" },
                  { label: "10 kullanım", value: 10 },
                  { label: "50 kullanım", value: 50 },
                  { label: "100 kullanım", value: 100 },
                ] as { label: string; value: InviteLimitOption }[]
              ).map((option) => {
                const active = inviteLimit === option.value;

                return (
                  <button
                    key={String(option.value)}
                    onClick={() => setInviteLimit(option.value)}
                    style={{
                      height: 46,
                      borderRadius: 12,
                      border: active
                        ? "1px solid rgba(88,101,242,0.26)"
                        : "1px solid rgba(255,255,255,0.08)",
                      background: active
                        ? "linear-gradient(135deg, rgba(88,101,242,0.18), rgba(123,138,255,0.10))"
                        : "rgba(255,255,255,0.04)",
                      color: "white",
                      cursor: "pointer",
                      fontWeight: 700,
                      fontSize: 13,
                    }}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>

            <div
              style={{
                marginTop: 12,
                fontSize: 12,
                color: "#8f98a6",
                lineHeight: 1.5,
              }}
            >
              “Sınırsız” seçeneği arka planda 9999 kullanım olarak oluşturulur.
            </div>

            <div style={modalFooterActionsStyle}>
              <button
                onClick={closeInviteModal}
                disabled={inviteLoading}
                style={modalSecondaryButtonStyle}
              >
                İptal
              </button>

              <button
                onClick={createInvite}
                disabled={inviteLoading}
                style={modalPrimaryButtonStyle}
              >
                {inviteLoading ? "Oluşturuluyor..." : "Kodu Oluştur"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

const channelActionButtonStyle: React.CSSProperties = {
  position: "absolute",
  top: 8,
  right: 8,
  width: 28,
  height: 28,
  borderRadius: 10,
  border: "1px solid rgba(255,255,255,0.08)",
  background: "rgba(18,22,29,0.94)",
  color: "#d7deea",
  fontSize: 16,
  cursor: "pointer",
  zIndex: 2,
};

const dropdownMenuItemStyle: React.CSSProperties = {
  width: "100%",
  height: 38,
  borderRadius: 10,
  border: "none",
  background: "transparent",
  color: "#d9e0ea",
  textAlign: "left",
  padding: "0 12px",
  cursor: "pointer",
  fontWeight: 600,
};

const dropdownDangerItemStyle: React.CSSProperties = {
  ...dropdownMenuItemStyle,
  color: "#ffb3b5",
};

const dropdownDividerStyle: React.CSSProperties = {
  height: 1,
  background: "rgba(255,255,255,0.08)",
  margin: "8px 0",
};

const channelMenuStyle: React.CSSProperties = {
  position: "absolute",
  top: 42,
  right: 8,
  width: 220,
  background: "#1a1f28",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 12,
  boxShadow: "0 24px 60px rgba(0,0,0,0.42)",
  padding: 8,
  zIndex: 20,
};

const menuButtonStyle: React.CSSProperties = {
  width: "100%",
  height: 36,
  borderRadius: 10,
  border: "1px solid rgba(255,255,255,0.08)",
  background: "rgba(255,255,255,0.05)",
  color: "#d9e0ea",
  textAlign: "left",
  padding: "0 12px",
  cursor: "pointer",
  fontWeight: 700,
};

const voiceModerationButtonStyle: React.CSSProperties = {
  width: "100%",
  minHeight: 40,
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.06)",
  background: "rgba(255,255,255,0.035)",
  color: "#dde4ef",
  cursor: "pointer",
  fontWeight: 600,
  padding: "10px 12px",
  textAlign: "left",
};

const voiceModerationDangerButtonStyle: React.CSSProperties = {
  width: "100%",
  minHeight: 40,
  borderRadius: 12,
  border: "1px solid rgba(237,66,69,0.18)",
  background: "rgba(237,66,69,0.10)",
  color: "#ffc2c3",
  cursor: "pointer",
  fontWeight: 700,
  padding: "10px 12px",
  textAlign: "left",
};

const modalOverlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.55)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 1000,
  padding: 20,
};

const modalCardStyle: React.CSSProperties = {
  width: "100%",
  maxWidth: 420,
  background: "#181c23",
  border: "1px solid #2a2f39",
  borderRadius: 20,
  padding: 20,
  boxShadow: "0 24px 80px rgba(0,0,0,0.45)",
};

const modalLabelStyle: React.CSSProperties = {
  fontSize: 12,
  textTransform: "uppercase",
  letterSpacing: 1,
  color: "#8f98a6",
  fontWeight: 800,
};

const modalTitleStyle: React.CSSProperties = {
  fontSize: 24,
  fontWeight: 800,
  color: "white",
  marginBottom: 8,
};

const modalTextStyle: React.CSSProperties = {
  fontSize: 14,
  color: "#aab3bf",
  lineHeight: 1.6,
  marginBottom: 16,
};

const modalInputStyle: React.CSSProperties = {
  width: "100%",
  background: "#10141a",
  color: "white",
  border: "1px solid #2f3642",
  borderRadius: 12,
  padding: "13px 14px",
  fontSize: 14,
  outline: "none",
  boxSizing: "border-box",
  marginBottom: 12,
};

const modalErrorStyle: React.CSSProperties = {
  marginTop: 12,
  background: "rgba(237,66,69,0.14)",
  border: "1px solid rgba(237,66,69,0.28)",
  color: "#ffb3b5",
  borderRadius: 12,
  padding: "10px 12px",
  fontSize: 13,
};

const modalFooterActionsStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  gap: 10,
  marginTop: 18,
};

const modalSecondaryButtonStyle: React.CSSProperties = {
  height: 40,
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.08)",
  background: "rgba(255,255,255,0.04)",
  color: "#d9e0ea",
  padding: "0 14px",
  cursor: "pointer",
  fontWeight: 700,
};

const modalPrimaryButtonStyle: React.CSSProperties = {
  height: 40,
  borderRadius: 12,
  border: "none",
  background: "linear-gradient(135deg,#5865f2,#7b8aff)",
  color: "white",
  padding: "0 16px",
  cursor: "pointer",
  fontWeight: 800,
  boxShadow: "0 10px 24px rgba(88,101,242,0.22)",
};