
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type CSSProperties } from "react";
import { GripVertical, Search, ShieldBan, UserX, X, Settings2, Shield, Users, Ban, Upload, Save, Trash2 } from "lucide-react";

type ServerSettingsModalProps = {
  serverId: string;
  currentName: string;
  currentAvatarUrl?: string | null;
  onClose: () => void;
  onSaved: (nextServer: { name: string; avatarUrl?: string | null }) => void | Promise<void>;
};

type PermissionKey =
  | "administrator"
  | "manage_server"
  | "manage_roles"
  | "manage_channels"
  | "kick_members"
  | "ban_members"
  | "mute_members"
  | "deafen_members"
  | "move_members"
  | "disconnect_members"
  | "view_audit_log"
  | "view_channel"
  | "send_messages"
  | "connect"
  | "speak";

type ServerRole = {
  id: string;
  name: string;
  color: string | null;
  position: number;
  permissions: Partial<Record<PermissionKey, boolean>>;
  isDefault?: boolean;
  isManaged?: boolean;
};

type MemberRole = {
  id: string;
  name: string;
  color?: string | null;
  position?: number;
  isDefault?: boolean;
  isManaged?: boolean;
};

type ServerMember = {
  id: string;
  username?: string | null;
  displayName: string;
  avatarUrl?: string | null;
  status?: string;
  role?: string;
  serverMuted?: boolean;
  serverDeafened?: boolean;
  timeoutUntil?: string | null;
  roles?: MemberRole[];
};

type ServerBan = {
  userId: string;
  displayName: string;
  username?: string | null;
  avatarUrl?: string | null;
  reason?: string | null;
  createdAt?: string | null;
};

type TabKey = "general" | "roles" | "members" | "bans";

const ROLE_PERMISSION_OPTIONS: Array<{ key: PermissionKey; label: string; hint: string }> = [
  { key: "administrator", label: "Administrator", hint: "Tüm izinleri verir." },
  { key: "manage_server", label: "Manage Server", hint: "Sunucu ayarlarını değiştirebilir." },
  { key: "manage_roles", label: "Manage Roles", hint: "Rol oluşturabilir ve düzenleyebilir." },
  { key: "manage_channels", label: "Manage Channels", hint: "Kanal oluşturabilir ve düzenleyebilir." },
  { key: "kick_members", label: "Kick Members", hint: "Kullanıcıyı sunucudan atabilir." },
  { key: "ban_members", label: "Ban Members", hint: "Kullanıcıyı yasaklayabilir." },
  { key: "mute_members", label: "Mute Members", hint: "Server mute uygulayabilir." },
  { key: "deafen_members", label: "Deafen Members", hint: "Server deafen uygulayabilir." },
  { key: "move_members", label: "Move Members", hint: "Kullanıcıyı başka voice odaya taşıyabilir." },
  { key: "disconnect_members", label: "Disconnect Members", hint: "Kullanıcıyı voicedan atabilir." },
  { key: "view_audit_log", label: "View Audit Log", hint: "Logları görebilir." },
  { key: "view_channel", label: "View Channel", hint: "Kanalları görebilir." },
  { key: "send_messages", label: "Send Messages", hint: "Mesaj gönderebilir." },
  { key: "connect", label: "Connect", hint: "Voice odalara katılabilir." },
  { key: "speak", label: "Speak", hint: "Voice odalarda konuşabilir." },
];

function resolveAssetUrl(value?: string | null) {
  const normalized = String(value ?? "").trim();
  if (!normalized) return "";
  if (/^https?:\/\//i.test(normalized)) return normalized;
  if (normalized.startsWith("/")) return `http://localhost:3001${normalized}`;
  return `http://localhost:3001/${normalized.replace(/^\/+/, "")}`;
}

function getInitials(name: string) {
  const parts = String(name || "?").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

function trimmedOrFallback(value: string) {
  const trimmed = String(value || "").trim();
  return trimmed || "Server";
}

function formatDateTime(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("tr-TR");
}

function normalizeRoleName(name?: string | null) {
  return String(name ?? "").trim().toLowerCase();
}

function isOwnerRole(role?: { name?: string | null }) {
  return normalizeRoleName(role?.name) === "owner";
}

function isAdminRole(role?: { name?: string | null }) {
  return normalizeRoleName(role?.name) === "admin";
}

function isHiddenRole(role?: { name?: string | null }) {
  return isOwnerRole(role) || isAdminRole(role);
}

function sortRolesDescending<T extends { position?: number | null; name?: string | null }>(roles: T[]) {
  return [...roles].sort((a, b) => {
    const positionDiff = Number(b.position ?? 0) - Number(a.position ?? 0);
    if (positionDiff !== 0) return positionDiff;
    return String(a.name ?? "").localeCompare(String(b.name ?? ""), "tr");
  });
}

function getVisibleRoleOrderPreservingInput<T extends { name?: string | null }>(roles: T[]) {
  return roles.filter((role) => !isHiddenRole(role));
}

function Avatar({
  name,
  avatarUrl,
  size = 42,
  square = false,
}: {
  name: string;
  avatarUrl?: string | null;
  size?: number;
  square?: boolean;
}) {
  const radius = square ? 18 : 999;
  if (avatarUrl) {
    return (
      <img
        src={resolveAssetUrl(avatarUrl)}
        alt={name}
        style={{
          width: size,
          height: size,
          borderRadius: radius,
          objectFit: "cover",
          border: "1px solid rgba(255,255,255,0.08)",
          background: "#11151c",
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
        borderRadius: radius,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "linear-gradient(135deg, #5865f2, #7b8aff)",
        color: "#fff",
        fontWeight: 900,
        fontSize: Math.max(12, Math.floor(size * 0.34)),
        border: "1px solid rgba(255,255,255,0.08)",
        flexShrink: 0,
      }}
    >
      {getInitials(name)}
    </div>
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
      type="button"
      onClick={onClick}
      style={{
        height: 44,
        borderRadius: 14,
        padding: "0 16px",
        border: active
          ? "1px solid rgba(124, 138, 255, 0.34)"
          : "1px solid rgba(255,255,255,0.06)",
        background: active
          ? "linear-gradient(180deg, rgba(88,101,242,0.22), rgba(88,101,242,0.10))"
          : "rgba(255,255,255,0.03)",
        color: active ? "#f7f9ff" : "#aeb8c8",
        fontWeight: 800,
        cursor: "pointer",
        boxShadow: active ? "0 12px 30px rgba(88,101,242,0.18)" : "none",
        transition: "all 160ms ease",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </button>
  );
}

function PermissionToggle({
  checked,
  label,
  hint,
  onChange,
}: {
  checked: boolean;
  label: string;
  hint: string;
  onChange: (next: boolean) => void;
}) {
  return (
    <label
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 16,
        padding: "14px 16px",
        borderRadius: 16,
        background: checked
          ? "linear-gradient(180deg, rgba(88,101,242,0.16), rgba(88,101,242,0.08))"
          : "linear-gradient(180deg, rgba(255,255,255,0.045), rgba(255,255,255,0.025))",
        border: checked
          ? "1px solid rgba(124,138,255,0.24)"
          : "1px solid rgba(255,255,255,0.06)",
        cursor: "pointer",
        minHeight: 78,
        boxSizing: "border-box",
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ color: "#eef2f7", fontWeight: 800, fontSize: 13 }}>{label}</div>
        <div style={{ color: "#96a0af", fontSize: 12, marginTop: 5, lineHeight: 1.45 }}>{hint}</div>
      </div>

      <div
        style={{
          width: 42,
          height: 24,
          borderRadius: 999,
          background: checked ? "#5865f2" : "rgba(255,255,255,0.10)",
          position: "relative",
          flexShrink: 0,
          transition: "all 140ms ease",
          boxShadow: checked ? "0 8px 18px rgba(88,101,242,0.26)" : "none",
        }}
      >
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          style={{
            position: "absolute",
            inset: 0,
            opacity: 0,
            cursor: "pointer",
            width: "100%",
            height: "100%",
          }}
        />
        <span
          style={{
            position: "absolute",
            top: 3,
            left: checked ? 21 : 3,
            width: 18,
            height: 18,
            borderRadius: 999,
            background: "#fff",
            transition: "left 140ms ease",
          }}
        />
      </div>
    </label>
  );
}

function SearchInput({
  value,
  placeholder,
  onChange,
}: {
  value: string;
  placeholder: string;
  onChange: (next: string) => void;
}) {
  return (
    <div style={searchWrapStyle}>
      <Search size={16} color="#90a0b8" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={searchInputStyle}
      />
      {value ? (
        <button type="button" onClick={() => onChange("")} style={searchClearButtonStyle}>
          <X size={14} />
        </button>
      ) : null}
    </div>
  );
}

export default function ServerSettingsModal({
  serverId,
  currentName,
  currentAvatarUrl,
  onClose,
  onSaved,
}: ServerSettingsModalProps) {
  const [tab, setTab] = useState<TabKey>("general");

  const [name, setName] = useState(currentName || "");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [removeAvatar, setRemoveAvatar] = useState(false);
  const [savingGeneral, setSavingGeneral] = useState(false);
  const [generalError, setGeneralError] = useState("");

  const [roles, setRoles] = useState<ServerRole[]>([]);
  const [rolesLoading, setRolesLoading] = useState(false);
  const [rolesError, setRolesError] = useState("");
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);
  const [roleDraftName, setRoleDraftName] = useState("");
  const [roleDraftColor, setRoleDraftColor] = useState("#5865f2");
  const [roleDraftUseColor, setRoleDraftUseColor] = useState(false);
  const [roleDraftPermissions, setRoleDraftPermissions] = useState<Partial<Record<PermissionKey, boolean>>>({});
  const [roleSaving, setRoleSaving] = useState(false);
  const [newRoleName, setNewRoleName] = useState("");
  const [roleSearch, setRoleSearch] = useState("");
  const [dragRoleId, setDragRoleId] = useState<string | null>(null);
  const [dragOverRoleId, setDragOverRoleId] = useState<string | null>(null);
  const [reorderingRoles, setReorderingRoles] = useState(false);

  const [members, setMembers] = useState<ServerMember[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [membersError, setMembersError] = useState("");
  const [memberActionLoadingKey, setMemberActionLoadingKey] = useState<string | null>(null);
  const [memberSearch, setMemberSearch] = useState("");
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);

  const [bans, setBans] = useState<ServerBan[]>([]);
  const [bansLoading, setBansLoading] = useState(false);
  const [bansError, setBansError] = useState("");
  const [unbanLoadingUserId, setUnbanLoadingUserId] = useState<string | null>(null);

  const reorderingRolesRef = useRef(false);
  const skipRolesEventUntilRef = useRef(0);
  const rolesRefreshTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    reorderingRolesRef.current = reorderingRoles;
  }, [reorderingRoles]);

  const scheduleSilentRolesRefresh = (delay = 180) => {
    if (rolesRefreshTimeoutRef.current != null) {
      window.clearTimeout(rolesRefreshTimeoutRef.current);
    }

    rolesRefreshTimeoutRef.current = window.setTimeout(() => {
      rolesRefreshTimeoutRef.current = null;
      void loadRoles({ silent: true, preserveSelectedRole: true });
    }, delay);
  };

  useEffect(() => {
    setName(currentName || "");
  }, [currentName]);

  const token = useMemo(() => localStorage.getItem("token"), []);
  const previewUrl = useMemo(() => {
    if (selectedFile) return URL.createObjectURL(selectedFile);
    if (removeAvatar) return "";
    return resolveAssetUrl(currentAvatarUrl);
  }, [selectedFile, removeAvatar, currentAvatarUrl]);

  useEffect(() => {
    return () => {
      if (selectedFile && previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [selectedFile, previewUrl]);

  const visibleRoles = useMemo(
    () => sortRolesDescending(roles.filter((role) => !isHiddenRole(role))),
    [roles]
  );

  const selectedRole = useMemo(
    () => visibleRoles.find((role) => role.id === selectedRoleId) ?? null,
    [visibleRoles, selectedRoleId]
  );

  const filteredRoles = useMemo(() => {
    const q = roleSearch.trim().toLowerCase();
    if (!q) return visibleRoles;
    return visibleRoles.filter((role) => role.name.toLowerCase().includes(q));
  }, [roleSearch, visibleRoles]);

  const selectableMemberRoles = useMemo(
    () => visibleRoles.filter((role) => !isOwnerRole(role)),
    [visibleRoles]
  );

  const filteredMembers = useMemo(() => {
    const q = memberSearch.trim().toLowerCase();
    if (!q) return members;
    return members.filter((member) => {
      const display = member.displayName?.toLowerCase() ?? "";
      const username = member.username?.toLowerCase() ?? "";
      const rolesText = Array.isArray(member.roles)
        ? member.roles
            .filter((role) => !isHiddenRole(role))
            .map((role) => String(role.name ?? "").toLowerCase())
            .join(" ")
        : "";
      return display.includes(q) || username.includes(q) || rolesText.includes(q);
    });
  }, [members, memberSearch]);

  const selectedMember = useMemo(
    () => filteredMembers.find((member) => String(member.id) === String(selectedMemberId)) ?? filteredMembers[0] ?? null,
    [filteredMembers, selectedMemberId]
  );

  useEffect(() => {
    if (!filteredMembers.length) {
      setSelectedMemberId(null);
      return;
    }

    setSelectedMemberId((prev) => {
      if (prev && filteredMembers.some((member) => String(member.id) === String(prev))) {
        return prev;
      }
      return String(filteredMembers[0].id);
    });
  }, [filteredMembers]);

  useEffect(() => {
    if (!selectedRole) return;
    setRoleDraftName(selectedRole.name);
    setRoleDraftUseColor(Boolean(selectedRole.color));
    setRoleDraftColor(selectedRole.color || "#5865f2");
    setRoleDraftPermissions({ ...(selectedRole.permissions || {}) });
  }, [selectedRole]);

  const loadRoles = async (options?: { silent?: boolean; preserveSelectedRole?: boolean }) => {
    if (!token) return;
    try {
      if (!options?.silent) setRolesLoading(true);
      setRolesError("");
      const res = await fetch(`http://localhost:3001/servers/${serverId}/roles`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setRolesError(data?.error || "Roller alınamadı.");
        return;
      }
      const nextRoles = Array.isArray(data) ? sortRolesDescending(data) : [];
      setRoles(nextRoles);

      const nextVisible = nextRoles.filter((role) => !isHiddenRole(role));
      if (!options?.preserveSelectedRole) {
        setSelectedRoleId((prev) => {
          if (prev && nextVisible.some((role) => role.id === prev)) return prev;
          return nextVisible[0]?.id ?? null;
        });
      }
    } catch (error) {
      console.error(error);
      setRolesError("Roller yüklenirken bağlantı hatası oldu.");
    } finally {
      if (!options?.silent) setRolesLoading(false);
    }
  };

  const loadMembers = async (options?: { silent?: boolean }) => {
    if (!token) return;
    try {
      if (!options?.silent) setMembersLoading(true);
      setMembersError("");
      const res = await fetch(`http://localhost:3001/servers/${serverId}/members`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setMembersError(data?.error || "Üyeler alınamadı.");
        return;
      }
      setMembers(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error(error);
      setMembersError("Üyeler yüklenirken bağlantı hatası oldu.");
    } finally {
      if (!options?.silent) setMembersLoading(false);
    }
  };

  const loadBans = async () => {
    if (!token) return;
    try {
      setBansLoading(true);
      setBansError("");
      const res = await fetch(`http://localhost:3001/servers/${serverId}/bans`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setBansError(data?.error || "Yasaklı listesi alınamadı.");
        return;
      }
      const normalized = Array.isArray(data)
        ? data.map((item: any) => ({
            userId: String(item.userId ?? item.id ?? item.user_id ?? ""),
            displayName: String(item.displayName ?? item.display_name ?? item.username ?? "User"),
            username: item.username ? String(item.username) : null,
            avatarUrl: item.avatarUrl ?? item.avatar_url ?? null,
            reason: item.reason ?? null,
            createdAt: item.createdAt ?? item.created_at ?? null,
          }))
        : [];
      setBans(normalized);
    } catch (error) {
      console.error(error);
      setBansError("Yasaklı listesi yüklenirken bağlantı hatası oldu.");
    } finally {
      setBansLoading(false);
    }
  };

  useEffect(() => {
    if (tab === "roles") void loadRoles();
    if (tab === "members") void Promise.all([
      loadMembers(),
      loadRoles({ preserveSelectedRole: true }),
    ]);
    if (tab === "bans") void loadBans();
  }, [tab]);

  useEffect(() => {
    return () => {
      if (rolesRefreshTimeoutRef.current != null) {
        window.clearTimeout(rolesRefreshTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const handleRolesUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ serverId?: string }>).detail;
      if (String(detail?.serverId ?? "") !== String(serverId)) return;
      if (reorderingRolesRef.current) return;
      if (Date.now() < skipRolesEventUntilRef.current) return;
      scheduleSilentRolesRefresh(120);
    };

    const handleMembersUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ serverId?: string }>).detail;
      if (String(detail?.serverId ?? "") !== String(serverId)) return;
      void loadMembers({ silent: true });
    };

    const handleBansUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ serverId?: string }>).detail;
      if (String(detail?.serverId ?? "") !== String(serverId)) return;
      void loadBans();
    };

    const handleServerUpdated = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          serverId?: string;
          name?: string;
          avatarUrl?: string | null;
        }>
      ).detail;
      if (String(detail?.serverId ?? "") !== String(serverId)) return;

      if (typeof detail?.name === "string" && detail.name.trim()) {
        setName(detail.name);
      }

      if (detail?.avatarUrl !== undefined) {
        setSelectedFile(null);
        setRemoveAvatar(false);
      }
    };

    window.addEventListener("vice-server-roles-updated", handleRolesUpdated);
    window.addEventListener("vice-server-members-updated", handleMembersUpdated);
    window.addEventListener("vice-server-bans-updated", handleBansUpdated);
    window.addEventListener("vice-server-updated", handleServerUpdated);

    return () => {
      window.removeEventListener("vice-server-roles-updated", handleRolesUpdated);
      window.removeEventListener("vice-server-members-updated", handleMembersUpdated);
      window.removeEventListener("vice-server-bans-updated", handleBansUpdated);
      window.removeEventListener("vice-server-updated", handleServerUpdated);
    };
  }, [serverId]);

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    if (!file) return;
    const allowed = ["image/png", "image/jpeg", "image/webp"];
    if (!allowed.includes(file.type)) {
      setGeneralError("Sadece PNG, JPG veya WEBP seçebilirsin.");
      event.target.value = "";
      return;
    }
    if (file.size > 4 * 1024 * 1024) {
      setGeneralError("Avatar dosyası en fazla 4 MB olabilir.");
      event.target.value = "";
      return;
    }
    setGeneralError("");
    setSelectedFile(file);
    setRemoveAvatar(false);
  };

  const handleSaveGeneral = async () => {
    if (!token) return;
    const trimmedName = name.trim();
    if (trimmedName.length < 2) {
      setGeneralError("Sunucu adı en az 2 karakter olmalı.");
      return;
    }

    try {
      setSavingGeneral(true);
      setGeneralError("");
      let nextAvatarUrl: string | null | undefined = removeAvatar ? null : currentAvatarUrl ?? null;

      if (selectedFile) {
        const formData = new FormData();
        formData.append("avatar", selectedFile);

        const uploadRes = await fetch(`http://localhost:3001/servers/${serverId}/avatar`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: formData,
        });

        const uploadData = await uploadRes.json().catch(() => null);
        if (!uploadRes.ok) {
          setGeneralError(uploadData?.error || "Avatar yüklenemedi.");
          return;
        }
        nextAvatarUrl = uploadData?.avatarUrl ?? null;
      }

      const patchRes = await fetch(`http://localhost:3001/servers/${serverId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: trimmedName,
          avatarUrl: nextAvatarUrl,
        }),
      });

      const patchData = await patchRes.json().catch(() => null);
      if (!patchRes.ok) {
        setGeneralError(patchData?.error || "Sunucu ayarları güncellenemedi.");
        return;
      }

      await onSaved({
        name: patchData?.name ?? trimmedName,
        avatarUrl: patchData?.avatarUrl ?? nextAvatarUrl ?? null,
      });

      setSelectedFile(null);
      setRemoveAvatar(false);
    } catch (err) {
      console.error(err);
      setGeneralError("Sunucu ayarları kaydedilirken bağlantı hatası oldu.");
    } finally {
      setSavingGeneral(false);
    }
  };

  const handleCreateRole = async () => {
    if (!token) return;
    const trimmed = newRoleName.trim();
    if (trimmed.length < 2) {
      setRolesError("Rol adı en az 2 karakter olmalı.");
      return;
    }
    try {
      setRoleSaving(true);
      setRolesError("");
      const res = await fetch(`http://localhost:3001/servers/${serverId}/roles`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: trimmed,
          color: null,
          permissions: {},
        }),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setRolesError(data?.error || "Rol oluşturulamadı.");
        return;
      }

      setNewRoleName("");
      await loadRoles();

      if (data?.id) {
        const createdRoleId = String(data.id);
        setSelectedRoleId(createdRoleId);

        const latestRes = await fetch(`http://localhost:3001/servers/${serverId}/roles`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const latestData = await latestRes.json().catch(() => null);

        if (latestRes.ok && Array.isArray(latestData)) {
          const latestVisible = sortRolesDescending(
            latestData.filter((role) => !isHiddenRole(role))
          );

          const createdIndex = latestVisible.findIndex((role) => String(role.id) === createdRoleId);
          if (createdIndex >= 0) {
            const reordered = [...latestVisible];
            const [createdRole] = reordered.splice(createdIndex, 1);

            const memberIndex = reordered.findIndex((role) => role.isDefault);
            reordered.splice(memberIndex >= 0 ? memberIndex : reordered.length, 0, createdRole);

            const hidden = latestData.filter((role) => isHiddenRole(role));
            const nextRoles = [...hidden, ...reordered];
            setRoles(sortRolesDescending(nextRoles));
            await persistRoleOrder(nextRoles);
          }
        }
      }
    } catch (error) {
      console.error(error);
      setRolesError("Rol oluşturulurken bağlantı hatası oldu.");
    } finally {
      setRoleSaving(false);
    }
  };

  const handleSaveRole = async () => {
    if (!token || !selectedRole) return;
    const trimmed = roleDraftName.trim();
    if (trimmed.length < 2) {
      setRolesError("Rol adı en az 2 karakter olmalı.");
      return;
    }

    try {
      setRoleSaving(true);
      setRolesError("");
      const res = await fetch(`http://localhost:3001/servers/${serverId}/roles/${selectedRole.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: trimmed,
          color: roleDraftUseColor ? (roleDraftColor || null) : null,
          permissions: roleDraftPermissions,
        }),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setRolesError(data?.error || "Rol güncellenemedi.");
        return;
      }

      await loadRoles();
    } catch (error) {
      console.error(error);
      setRolesError("Rol güncellenirken bağlantı hatası oldu.");
    } finally {
      setRoleSaving(false);
    }
  };

  const handleDeleteRole = async () => {
    if (!token || !selectedRole) return;
    if (selectedRole.isDefault) {
      setRolesError("Varsayılan rol silinemez.");
      return;
    }

    const ok = window.confirm(`"${selectedRole.name}" rolünü silmek istiyor musun?`);
    if (!ok) return;

    try {
      setRoleSaving(true);
      setRolesError("");
      const res = await fetch(`http://localhost:3001/servers/${serverId}/roles/${selectedRole.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });

      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setRolesError(data?.error || "Rol silinemedi.");
        return;
      }

      await loadRoles();
    } catch (error) {
      console.error(error);
      setRolesError("Rol silinirken bağlantı hatası oldu.");
    } finally {
      setRoleSaving(false);
    }
  };

  const handleToggleMemberRole = async (memberUserId: string, roleId: string, hasRole: boolean) => {
    if (!token) return;
    const loadingKey = `${memberUserId}:${roleId}`;

    const targetRole = roles.find((role) => String(role.id) === String(roleId)) ?? null;
    const previousMembers = members;

    try {
      setMemberActionLoadingKey(loadingKey);
      setMembersError("");

      setMembers((prev) =>
        prev.map((member) => {
          if (String(member.id) !== String(memberUserId)) return member;

          const currentRoles = Array.isArray(member.roles) ? member.roles : [];
          const nextRoles = hasRole
            ? currentRoles.filter((role) => String(role.id) !== String(roleId))
            : targetRole
              ? [...currentRoles, {
                  id: targetRole.id,
                  name: targetRole.name,
                  color: targetRole.color ?? null,
                  position: targetRole.position,
                  isDefault: targetRole.isDefault,
                  isManaged: targetRole.isManaged,
                }]
              : currentRoles;

          return {
            ...member,
            roles: sortRolesDescending(nextRoles),
          };
        })
      );

      const url = `http://localhost:3001/servers/${serverId}/members/${memberUserId}/roles/${roleId}`;
      const res = await fetch(url, {
        method: hasRole ? "DELETE" : "POST",
        headers: { Authorization: `Bearer ${token}` },
      });

      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setMembers(previousMembers);
        setMembersError(data?.error || "Üye rolü güncellenemedi.");
        return;
      }

      void loadMembers({ silent: true });
    } catch (error) {
      console.error(error);
      setMembers(previousMembers);
      setMembersError("Üye rolü güncellenirken bağlantı hatası oldu.");
    } finally {
      setMemberActionLoadingKey(null);
    }
  };

  const handleKickMember = async (member: ServerMember) => {
    if (!token) return;
    const ok = window.confirm(`${member.displayName} sunucudan atılsın mı?`);
    if (!ok) return;
    try {
      setMemberActionLoadingKey(`kick:${member.id}`);
      setMembersError("");
      const res = await fetch(`http://localhost:3001/servers/${serverId}/kick`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ targetUserId: member.id }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setMembersError(data?.error || "Üye atılamadı.");
        return;
      }
      await loadMembers();
    } catch (error) {
      console.error(error);
      setMembersError("Üye atılırken bağlantı hatası oldu.");
    } finally {
      setMemberActionLoadingKey(null);
    }
  };

  const handleBanMember = async (member: ServerMember) => {
    if (!token) return;
    const ok = window.confirm(`${member.displayName} sunucudan yasaklansın mı?`);
    if (!ok) return;
    try {
      setMemberActionLoadingKey(`ban:${member.id}`);
      setMembersError("");
      const res = await fetch(`http://localhost:3001/servers/${serverId}/ban`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ targetUserId: member.id }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setMembersError(data?.error || "Üye yasaklanamadı.");
        return;
      }
      await Promise.all([loadMembers(), loadBans()]);
    } catch (error) {
      console.error(error);
      setMembersError("Üye yasaklanırken bağlantı hatası oldu.");
    } finally {
      setMemberActionLoadingKey(null);
    }
  };

  const handleUnban = async (userId: string) => {
    if (!token) return;
    try {
      setUnbanLoadingUserId(userId);
      setBansError("");
      const res = await fetch(`http://localhost:3001/servers/${serverId}/bans/${userId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setBansError(data?.error || "Yasak kaldırılamadı.");
        return;
      }
      await loadBans();
    } catch (error) {
      console.error(error);
      setBansError("Yasak kaldırılırken bağlantı hatası oldu.");
    } finally {
      setUnbanLoadingUserId(null);
    }
  };

  const persistRoleOrder = async (nextRoles: ServerRole[]) => {
    if (!token) return;
    try {
      setReorderingRoles(true);
      setRolesError("");
      skipRolesEventUntilRef.current = Date.now() + 1500;

      const visibleOrdered = getVisibleRoleOrderPreservingInput(nextRoles);
      const defaultRole = visibleOrdered.find((role) => role.isDefault) ?? null;
      const movableTopToBottom = visibleOrdered.filter((role) => !role.isDefault);

      const defaultBasePosition = Number(defaultRole?.position ?? 0);

      const updates = movableTopToBottom.map((role, index) => ({
        roleId: role.id,
        nextPosition: defaultBasePosition + (movableTopToBottom.length - index) * 10,
      }));

      const optimisticRoles = nextRoles.map((role) => {
        const update = updates.find((item) => item.roleId === role.id);
        return update ? { ...role, position: update.nextPosition } : role;
      });

      setRoles(sortRolesDescending(optimisticRoles));

      for (const update of updates) {
        const role = optimisticRoles.find((item) => item.id === update.roleId);
        if (!role) continue;

        const res = await fetch(`http://localhost:3001/servers/${serverId}/roles/${update.roleId}`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            name: role.name,
            color: role.color,
            permissions: role.permissions ?? {},
            position: update.nextPosition,
          }),
        });

        const data = await res.json().catch(() => null);
        if (!res.ok) {
          setRolesError(data?.error || "Rol sırası güncellenemedi.");
          scheduleSilentRolesRefresh(50);
          return;
        }
      }

      scheduleSilentRolesRefresh(220);
    } catch (error) {
      console.error(error);
      setRolesError("Rol sırası güncellenirken bağlantı hatası oldu.");
      scheduleSilentRolesRefresh(50);
    } finally {
      setReorderingRoles(false);
      window.setTimeout(() => {
        skipRolesEventUntilRef.current = 0;
      }, 250);
    }
  };

  const moveRoleBeforeTarget = async (draggedId: string, targetId: string) => {
    if (draggedId === targetId) return;

    const dragRole = visibleRoles.find((role) => role.id === draggedId);
    const targetRole = visibleRoles.find((role) => role.id === targetId);
    if (!dragRole || !targetRole) return;
    if (dragRole.isDefault) return;

    const reordered = [...visibleRoles];
    const dragIndex = reordered.findIndex((role) => role.id === draggedId);
    const targetIndex = reordered.findIndex((role) => role.id === targetId);
    if (dragIndex < 0 || targetIndex < 0) return;

    const [dragItem] = reordered.splice(dragIndex, 1);
    const nextTargetIndex = reordered.findIndex((role) => role.id === targetId);
    if (nextTargetIndex < 0) return;

    reordered.splice(nextTargetIndex, 0, dragItem);

    const hidden = roles.filter((role) => isHiddenRole(role));
    const nextRoles = [...hidden, ...reordered];
    setDragRoleId(null);
    setDragOverRoleId(null);
    await persistRoleOrder(nextRoles);
  };

  const contentHeight = 650;

  return (
    <div onClick={savingGeneral || roleSaving || reorderingRoles ? undefined : onClose} style={overlayStyle}>
      <div onClick={(e) => e.stopPropagation()} style={modalStyle}>
        <button onClick={onClose} disabled={savingGeneral || roleSaving || reorderingRoles} style={closeButtonStyle}>
          ×
        </button>

        <div style={titleStyle}>Sunucu Ayarları</div>
        <div style={subtitleStyle}>
          Genel ayarlar, roller, üyeler ve yasaklı listesini buradan yönetebilirsin.
        </div>

        <div style={tabsRowStyle}>
          <TabButton active={tab === "general"} onClick={() => setTab("general")}><span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}><Settings2 size={15} />Genel</span></TabButton>
          <TabButton active={tab === "roles"} onClick={() => setTab("roles")}><span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}><Shield size={15} />Roller</span></TabButton>
          <TabButton active={tab === "members"} onClick={() => setTab("members")}><span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}><Users size={15} />Üyeler</span></TabButton>
          <TabButton active={tab === "bans"} onClick={() => setTab("bans")}><span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}><Ban size={15} />Yasaklılar</span></TabButton>
        </div>

        <div style={{ ...fixedBodyStyle, height: contentHeight }}>
          {tab === "general" && (
            <div style={generalLayoutStyle}>
              <div style={heroCardStyle}>
                <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                  {previewUrl ? (
                    <img src={previewUrl} alt={trimmedOrFallback(name)} style={largeAvatarStyle} />
                  ) : (
                    <div style={largeAvatarFallbackStyle}>{getInitials(trimmedOrFallback(name))}</div>
                  )}

                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={sectionTitleStyle}>Sunucu Kimliği</div>
                    <div style={hintStyle}>Avatarı ve adı buradan güncelleyebilirsin. Genel sekme yüksekliği artık diğer sekmelerle aynı tutuluyor.</div>
                  </div>
                </div>

                <div style={generalActionsStyle}>
                  <label style={uploadButtonStyle}>
                    Avatar Seç
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      onChange={handleFileChange}
                      style={{ display: "none" }}
                    />
                  </label>

                  <button
                    type="button"
                    onClick={() => {
                      setSelectedFile(null);
                      setRemoveAvatar(true);
                      setGeneralError("");
                    }}
                    style={secondaryButtonStyle}
                  >
                    Avatarı Kaldır
                  </button>
                </div>
              </div>

              <div style={surfaceCardStyle}>
                <div style={labelStyle}>Sunucu Adı</div>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Sunucu adı"
                  autoFocus
                  style={inputStyle}
                />
                <div style={hintStyle}>Öneri: kare avatar kullan. PNG / JPG / WEBP, max 4 MB.</div>
              </div>

              {generalError && <div style={errorStyle}>{generalError}</div>}

              <div style={footerStyle}>
                <button type="button" onClick={onClose} disabled={savingGeneral} style={cancelButtonStyle}>
                  İptal
                </button>
                <button type="button" onClick={handleSaveGeneral} disabled={savingGeneral} style={saveButtonStyle}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>{savingGeneral ? "Kaydediliyor..." : <><Save size={15} />Kaydet</>}</span>
                </button>
              </div>
            </div>
          )}

          {tab === "roles" && (
            <div style={rolesShellStyle}>
              <div style={rolesSidebarStyle}>
                <div style={sidebarHeaderStyle}>
                  <div>
                    <div style={sectionTitleStyle}>Roller</div>
                    <div style={microHintStyle}>Owner gizli. Çok rol olduğunda burası scroll olur.</div>
                  </div>
                </div>

                <SearchInput
                  value={roleSearch}
                  placeholder="Rol ara..."
                  onChange={setRoleSearch}
                />

                <div style={createRoleRowStyle}>
                  <input
                    value={newRoleName}
                    onChange={(e) => setNewRoleName(e.target.value)}
                    placeholder="Yeni rol adı"
                    style={smallInputStyle}
                  />
                  <button type="button" onClick={handleCreateRole} disabled={roleSaving} style={miniPrimaryButtonStyle}>
                    Oluştur
                  </button>
                </div>

                {rolesLoading ? (
                  <div style={emptyStateStyle}>Roller yükleniyor...</div>
                ) : filteredRoles.length === 0 ? (
                  <div style={emptyStateStyle}>Gösterilecek rol yok.</div>
                ) : (
                  <div style={roleListStyle}>
                    {filteredRoles.map((role) => {
                      const isActive = role.id === selectedRoleId;
                      const draggable = !role.isDefault;
                      const canAcceptDrop = !isHiddenRole(role);
                      return (
                        <button
                          key={role.id}
                          type="button"
                          draggable={draggable}
                          onDragStart={() => draggable && setDragRoleId(role.id)}
                          onDragEnter={() => canAcceptDrop && setDragOverRoleId(role.id)}
                          onDragOver={(e) => {
                            if (!canAcceptDrop) return;
                            e.preventDefault();
                          }}
                          onDrop={(e) => {
                            e.preventDefault();
                            if (dragRoleId && canAcceptDrop) void moveRoleBeforeTarget(dragRoleId, role.id);
                          }}
                          onDragEnd={() => {
                            setDragRoleId(null);
                            setDragOverRoleId(null);
                          }}
                          onClick={() => setSelectedRoleId(role.id)}
                          style={{
                            ...roleListItemStyle,
                            border: isActive
                              ? "1px solid rgba(88,101,242,0.28)"
                              : dragOverRoleId === role.id
                                ? "1px solid rgba(130,145,255,0.22)"
                                : "1px solid rgba(255,255,255,0.06)",
                            background: isActive
                              ? "linear-gradient(135deg, rgba(88,101,242,0.18), rgba(123,138,255,0.10))"
                              : dragOverRoleId === role.id
                                ? "rgba(88,101,242,0.10)"
                                : "rgba(255,255,255,0.03)",
                            opacity: dragRoleId === role.id ? 0.72 : 1,
                            cursor: draggable ? "grab" : "pointer",
                          }}
                        >
                          <span style={{ display: "inline-flex", alignItems: "center", color: "#8993a6" }}>
                            <GripVertical size={15} />
                          </span>
                          <span
                            style={{
                              width: 12,
                              height: 12,
                              borderRadius: 999,
                              background: role.color || "#8f98a6",
                              flexShrink: 0,
                            }}
                          />
                          <span style={{ flex: 1, minWidth: 0, textAlign: "left", color: "#eef2f7", fontWeight: 700 }}>
                            {role.name}
                          </span>
                          {role.isDefault ? <span style={pillStyle}>Sabit</span> : null}
                        </button>
                      );
                    })}
                  </div>
                )}

                {reorderingRoles ? <div style={hintStyle}>Rol sırası kaydediliyor...</div> : null}
              </div>

              <div style={rolesEditorStyle}>
                {!selectedRole ? (
                  <div style={emptyStateStyle}>Düzenlemek için soldan bir rol seç.</div>
                ) : (
                  <>
                    <div style={editorTopRowStyle}>
                      <div>
                        <div style={sectionTitleStyle}>Rol Düzenle</div>
                        <div style={microHintStyle}>
                          {selectedRole.isDefault
                            ? "Varsayılan rol sabit. Adı ve yetkileri backend iznine bağlı olarak değişebilir."
                            : "Yetkileri ve görünümü burada düzenleyebilirsin."}
                        </div>
                      </div>

                      <div style={previewRoleChipStyle}>
                        <span
                          style={{
                            width: 10,
                            height: 10,
                            borderRadius: 999,
                            background: roleDraftColor || selectedRole.color || "#8f98a6",
                          }}
                        />
                        <span>{roleDraftName || selectedRole.name}</span>
                      </div>
                    </div>

                    <div style={surfaceCardStyle}>
                      <div style={formGridStyle}>
                        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                          <div style={labelStyle}>Rol Adı</div>
                          <input
                            value={roleDraftName}
                            onChange={(e) => setRoleDraftName(e.target.value)}
                            style={inputStyle}
                          />
                        </div>

                        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                          <div style={labelStyle}>Rol Rengi</div>
                          <label
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 8,
                              color: "#d7deea",
                              fontSize: 13,
                              fontWeight: 700,
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={roleDraftUseColor}
                              onChange={(e) => setRoleDraftUseColor(e.target.checked)}
                              style={{ width: 16, height: 16, accentColor: "#7b8aff" }}
                            />
                            Renk kullan
                          </label>
                          {roleDraftUseColor ? (
                            <div style={colorRowStyle}>
                              <input
                                type="color"
                                value={roleDraftColor || "#5865f2"}
                                onChange={(e) => setRoleDraftColor(e.target.value)}
                                style={colorInputStyle}
                              />
                              <input
                                value={roleDraftColor || ""}
                                onChange={(e) => setRoleDraftColor(e.target.value)}
                                placeholder="#5865f2"
                                style={inputStyle}
                              />
                            </div>
                          ) : (
                            <div style={{ ...hintStyle, marginTop: 2 }}>
                              Bu rol için renk kullanılmayacak.
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    <div style={{ marginTop: 18, marginBottom: 10, ...labelStyle }}>Yetkiler</div>
                    <div style={permissionsGridStyle}>
                      {ROLE_PERMISSION_OPTIONS.map((permission) => (
                        <PermissionToggle
                          key={permission.key}
                          checked={roleDraftPermissions[permission.key] === true}
                          label={permission.label}
                          hint={permission.hint}
                          onChange={(next) =>
                            setRoleDraftPermissions((prev) => ({
                              ...prev,
                              [permission.key]: next,
                            }))
                          }
                        />
                      ))}
                    </div>

                    {rolesError && <div style={errorStyle}>{rolesError}</div>}

                    <div style={footerStyle}>
                      <button
                        type="button"
                        onClick={handleDeleteRole}
                        disabled={roleSaving || selectedRole.isDefault}
                        style={dangerButtonStyle}
                      >
                        Rolü Sil
                      </button>

                      <button
                        type="button"
                        onClick={handleSaveRole}
                        disabled={roleSaving}
                        style={saveButtonStyle}
                      >
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>{roleSaving ? "Kaydediliyor..." : <><Save size={15} />Rolü Kaydet</>}</span>
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          {tab === "members" && (
            <div style={membersWorkspaceStyle}>
              <div style={membersSidebarShellStyle}>
                <div style={panelHeaderRowStyle}>
                  <div>
                    <div style={sectionTitleStyle}>Üyeler</div>
                    <div style={microHintStyle}>Bir üyeyi seç, sağ panelden rol akışını yönet.</div>
                  </div>
                </div>

                <SearchInput value={memberSearch} placeholder="Üye veya rol ara..." onChange={setMemberSearch} />

                {membersError && <div style={errorStyle}>{membersError}</div>}

                {membersLoading ? (
                  <div style={emptyStateStyle}>Üyeler yükleniyor...</div>
                ) : filteredMembers.length === 0 ? (
                  <div style={emptyStateStyle}>Aramana uygun üye bulunamadı.</div>
                ) : (
                  <div style={memberSelectorListStyle}>
                    {filteredMembers.map((member) => {
                      const visibleMemberRoles = sortRolesDescending(
                        Array.isArray(member.roles) ? member.roles.filter((role) => !isHiddenRole(role)) : []
                      );
                      const isActive = String(selectedMember?.id ?? "") === String(member.id);

                      return (
                        <button
                          key={member.id}
                          type="button"
                          onClick={() => setSelectedMemberId(String(member.id))}
                          style={{
                            ...memberSelectorCardStyle,
                            border: isActive
                              ? "1px solid rgba(124,138,255,0.3)"
                              : "1px solid rgba(255,255,255,0.05)",
                            background: isActive
                              ? "linear-gradient(180deg, rgba(88,101,242,0.14), rgba(88,101,242,0.05))"
                              : "rgba(255,255,255,0.02)",
                            boxShadow: isActive ? "0 10px 24px rgba(88,101,242,0.1)" : "none",
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                            <Avatar name={member.displayName} avatarUrl={member.avatarUrl} size={34} />
                            <div style={{ minWidth: 0, flex: 1, textAlign: "left" }}>
                              <div style={{ ...memberNameStyle, fontSize: 13 }}>{member.displayName}</div>
                              <div style={memberMetaStyle}>@{member.username || "user"}</div>
                            </div>
                            <span style={memberCountTinyPillStyle}>{visibleMemberRoles.length}</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              <div style={memberInspectorStyle}>
                {!selectedMember ? (
                  <div style={emptyStateStyle}>Soldan bir üye seç.</div>
                ) : (() => {
                  const visibleMemberRoles = sortRolesDescending(
                    Array.isArray(selectedMember.roles)
                      ? selectedMember.roles.filter((role) => !isHiddenRole(role))
                      : []
                  );
                  const memberRoleIds = new Set(visibleMemberRoles.map((role) => String(role.id)));
                  const highestRole = visibleMemberRoles[0] ?? null;
                  const isMemberOwner =
                    isOwnerRole(highestRole) ||
                    String(selectedMember.role ?? "").trim().toLowerCase() === "owner";
                  const availableRoles = selectableMemberRoles.filter(
                    (role) => !memberRoleIds.has(String(role.id))
                  );
                  const isKickLoading = memberActionLoadingKey === `kick:${selectedMember.id}`;
                  const isBanLoading = memberActionLoadingKey === `ban:${selectedMember.id}`;

                  return (
                    <>
                      <div style={memberHeroStyle}>
                        <div style={{ display: "flex", alignItems: "center", gap: 14, minWidth: 0 }}>
                          <Avatar name={selectedMember.displayName} avatarUrl={selectedMember.avatarUrl} size={52} />
                          <div style={{ minWidth: 0 }}>
                            <div style={{ color: "#f6f8fc", fontSize: 22, fontWeight: 900, lineHeight: 1.1 }}>
                              {selectedMember.displayName}
                            </div>
                            <div style={{ color: "#96a0af", fontSize: 13, marginTop: 5 }}>
                              @{selectedMember.username || "user"}
                            </div>
                          </div>
                        </div>

                        {!isMemberOwner ? (
                          <div style={memberHeroActionsStyle}>
                            <button type="button" onClick={() => handleKickMember(selectedMember)} disabled={isKickLoading} style={memberDangerButtonStyle}>
                              <UserX size={14} />
                              <span>{isKickLoading ? "Atılıyor..." : "Sunucudan At"}</span>
                            </button>
                            <button type="button" onClick={() => handleBanMember(selectedMember)} disabled={isBanLoading} style={memberBanButtonStyle}>
                              <ShieldBan size={14} />
                              <span>{isBanLoading ? "Banlanıyor..." : "Banla"}</span>
                            </button>
                          </div>
                        ) : (
                          <div style={{ ...microHintStyle, minWidth: 160, textAlign: "right" }}>
                            Sunucu sahibi korunur
                          </div>
                        )}
                      </div>

                      <div style={roleFlowShellStyle}>
                        <div style={roleLaneStyle}>
                          <div style={roleLaneHeaderStyle}>
                            <div>
                              <div style={sectionTitleStyle}>Atanmış</div>
                              <div style={microHintStyle}>Rolün üstüne tıklayıp kaldır.</div>
                            </div>
                            <span style={memberCountPillStyle}>{visibleMemberRoles.length}</span>
                          </div>

                          {visibleMemberRoles.length === 0 ? (
                            <div style={emptyStateStyle}>Görünür rol yok.</div>
                          ) : (
                            <div style={roleTokenRailStyle}>
                              {visibleMemberRoles.map((role) => {
                                const loadingKey = `${selectedMember.id}:${role.id}`;
                                return (
                                  <button
                                    key={role.id}
                                    type="button"
                                    onClick={() => handleToggleMemberRole(selectedMember.id, role.id, true)}
                                    disabled={memberActionLoadingKey === loadingKey}
                                    style={{
                                      ...roleTokenStyle,
                                      border: "1px solid rgba(255,255,255,0.08)",
                                      background: "rgba(255,255,255,0.05)",
                                    }}
                                  >
                                    <span style={{ width: 8, height: 8, borderRadius: 999, background: role.color || "#8f98a6", flexShrink: 0 }} />
                                    <span style={roleTokenTextStyle}>{role.name}</span>
                                    <span style={roleTokenNegativeBadgeStyle}>{memberActionLoadingKey === loadingKey ? "..." : "×"}</span>
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>

                        <div style={roleFlowDividerStyle}>
                          <div style={roleFlowDividerLineStyle} />
                          <span style={roleFlowDividerLabelStyle}>Rol Akışı</span>
                          <div style={roleFlowDividerLineStyle} />
                        </div>

                        <div style={roleLaneStyle}>
                          <div style={roleLaneHeaderStyle}>
                            <div>
                              <div style={sectionTitleStyle}>Uygun</div>
                              <div style={microHintStyle}>Rolün üstüne tıklayıp ekle.</div>
                            </div>
                            <span style={memberCountPillStyle}>{availableRoles.length}</span>
                          </div>

                          {availableRoles.length === 0 ? (
                            <div style={emptyStateStyle}>Eklenebilir rol kalmadı.</div>
                          ) : (
                            <div style={roleTokenRailStyle}>
                              {availableRoles.map((role) => {
                                const loadingKey = `${selectedMember.id}:${role.id}`;
                                return (
                                  <button
                                    key={role.id}
                                    type="button"
                                    onClick={() => handleToggleMemberRole(selectedMember.id, role.id, false)}
                                    disabled={memberActionLoadingKey === loadingKey}
                                    style={{
                                      ...roleTokenStyle,
                                      border: "1px solid rgba(124,138,255,0.2)",
                                      background: "rgba(88,101,242,0.09)",
                                    }}
                                  >
                                    <span style={{ width: 8, height: 8, borderRadius: 999, background: role.color || "#8f98a6", flexShrink: 0 }} />
                                    <span style={roleTokenTextStyle}>{role.name}</span>
                                    <span style={roleTokenPositiveBadgeStyle}>{memberActionLoadingKey === loadingKey ? "..." : "+"}</span>
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </div>
                    </>
                  );
                })()}
              </div>
            </div>
          )}


          {tab === "bans" && (
            <div style={panelColumnStyle}>
              <div style={panelHeaderRowStyle}>
                <div>
                  <div style={sectionTitleStyle}>Yasaklılar</div>
                  <div style={microHintStyle}>Sunucudan yasaklanan kullanıcıları buradan görebilir ve geri alabilirsin.</div>
                </div>
              </div>

              {bansError && <div style={errorStyle}>{bansError}</div>}

              {bansLoading ? (
                <div style={emptyStateStyle}>Yasaklı listesi yükleniyor...</div>
              ) : bans.length === 0 ? (
                <div style={emptyStateStyle}>Yasaklı kullanıcı yok.</div>
              ) : (
                <div style={memberListStyle}>
                  {bans.map((ban) => (
                    <div key={ban.userId} style={memberCardStyle}>
                      <div style={memberTopStyle}>
                        <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
                          <Avatar name={ban.displayName} avatarUrl={ban.avatarUrl} size={46} />
                          <div style={{ minWidth: 0 }}>
                            <div style={memberNameStyle}>{ban.displayName}</div>
                            <div style={memberMetaStyle}>
                              @{ban.username || "user"} • {ban.reason || "Sebep yok"} • {formatDateTime(ban.createdAt)}
                            </div>
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => handleUnban(ban.userId)}
                          disabled={unbanLoadingUserId === ban.userId}
                          style={miniPrimaryButtonStyle}
                        >
                          {unbanLoadingUserId === ban.userId ? "Kaldırılıyor..." : "Unban"}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const membersWorkspaceStyle: CSSProperties = {
  height: "100%",
  display: "grid",
  gridTemplateColumns: "248px minmax(0, 1fr)",
  gap: 12,
};

const membersSidebarShellStyle: CSSProperties = {
  height: "100%",
  display: "flex",
  flexDirection: "column",
  gap: 14,
  minHeight: 0,
};

const memberSelectorListStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 10,
  overflowY: "auto",
  minHeight: 0,
  paddingRight: 4,
};

const memberSelectorCardStyle: CSSProperties = {
  borderRadius: 15,
  padding: "10px 11px",
  cursor: "pointer",
  transition: "all 160ms ease",
  textAlign: "left",
};

const memberInspectorStyle: CSSProperties = {
  minWidth: 0,
  height: "100%",
  overflowY: "auto",
  paddingRight: 4,
  display: "flex",
  flexDirection: "column",
  gap: 10,
};

const memberHeroStyle: CSSProperties = {
  borderRadius: 20,
  padding: 16,
  border: "1px solid rgba(255,255,255,0.06)",
  background: "linear-gradient(180deg, rgba(255,255,255,0.035), rgba(255,255,255,0.018))",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 18,
  flexWrap: "wrap",
};

const memberHeroActionsStyle: CSSProperties = {
  display: "flex",
  gap: 8,
  flexWrap: "wrap",
  alignItems: "center",
};

const softInfoPillStyle: CSSProperties = {
  
  height: 30,
  padding: "0 12px",
  borderRadius: 999,
  display: "inline-flex",
  alignItems: "center",
  background: "rgba(255,255,255,0.05)",
  border: "1px solid rgba(255,255,255,0.06)",
  color: "#c7d0dd",
  fontSize: 12,
  fontWeight: 700,
};

const roleFlowShellStyle: CSSProperties = {
  borderRadius: 20,
  border: "1px solid rgba(255,255,255,0.06)",
  background: "linear-gradient(180deg, rgba(255,255,255,0.028), rgba(255,255,255,0.016))",
  padding: 16,
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) 72px minmax(0, 1fr)",
  gap: 14,
  alignItems: "stretch",
};

const roleLaneStyle: CSSProperties = {
  minWidth: 0,
  display: "flex",
  flexDirection: "column",
  gap: 12,
};

const roleLaneHeaderStyle: CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "space-between",
  gap: 10,
};

const roleFlowDividerStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: 10,
  minWidth: 0,
};

const roleFlowDividerLineStyle: CSSProperties = {
  width: 1,
  flex: 1,
  minHeight: 24,
  background: "linear-gradient(180deg, rgba(255,255,255,0.02), rgba(255,255,255,0.12), rgba(255,255,255,0.02))",
};

const roleFlowDividerLabelStyle: CSSProperties = {
  height: 28,
  padding: "0 10px",
  borderRadius: 999,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  background: "rgba(255,255,255,0.05)",
  border: "1px solid rgba(255,255,255,0.06)",
  color: "#b8c3d4",
  fontSize: 11,
  fontWeight: 800,
  letterSpacing: 0.2,
};

const roleTokenRailStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 10,
  alignContent: "flex-start",
};

const roleTokenStyle: CSSProperties = {
  minHeight: 36,
  maxWidth: "100%",
  borderRadius: 999,
  padding: "0 8px 0 10px",
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  cursor: "pointer",
  transition: "all 140ms ease",
  textAlign: "left",
};

const roleTokenTextStyle: CSSProperties = {
  color: "#edf2fa",
  fontSize: 12,
  fontWeight: 800,
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

const roleTokenPositiveBadgeStyle: CSSProperties = {
  width: 20,
  height: 20,
  borderRadius: 999,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  background: "rgba(124,138,255,0.18)",
  color: "#e8edff",
  fontSize: 13,
  fontWeight: 900,
  flexShrink: 0,
};

const roleTokenNegativeBadgeStyle: CSSProperties = {
  width: 20,
  height: 20,
  borderRadius: 999,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  background: "rgba(255,255,255,0.08)",
  color: "#ffbcbc",
  fontSize: 13,
  fontWeight: 900,
  flexShrink: 0,
};

const memberCountPillStyle: CSSProperties = {
  minWidth: 28,
  height: 28,
  padding: "0 10px",
  borderRadius: 999,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  background: "rgba(255,255,255,0.06)",
  border: "1px solid rgba(255,255,255,0.06)",
  color: "#eef2f7",
  fontSize: 12,
  fontWeight: 800,
  flexShrink: 0,
};

const overlayStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(4,6,10,0.74)",
  backdropFilter: "blur(10px)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 28,
  zIndex: 4000,
};

const modalStyle: CSSProperties = {
  width: "min(1180px, calc(100vw - 40px))",
  maxHeight: "min(880px, calc(100vh - 40px))",
  borderRadius: 30,
  background:
    "radial-gradient(circle at top left, rgba(88,101,242,0.12), transparent 28%), linear-gradient(180deg, rgba(23,27,36,0.99), rgba(17,21,29,0.99))",
  border: "1px solid rgba(255,255,255,0.07)",
  boxShadow: "0 32px 100px rgba(0,0,0,0.5)",
  padding: "30px 30px 24px",
  position: "relative",
  boxSizing: "border-box",
  overflow: "hidden",
};

const closeButtonStyle: CSSProperties = {
  position: "absolute",
  right: 18,
  top: 18,
  width: 38,
  height: 38,
  borderRadius: 999,
  border: "1px solid rgba(255,255,255,0.08)",
  background: "rgba(255,255,255,0.04)",
  color: "#d7deea",
  cursor: "pointer",
  fontSize: 22,
  lineHeight: 1,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

const titleStyle: CSSProperties = {
  color: "#f8fbff",
  fontWeight: 900,
  fontSize: 28,
  letterSpacing: -0.4,
};

const subtitleStyle: CSSProperties = {
  color: "#93a0b5",
  fontSize: 14,
  marginTop: 8,
  lineHeight: 1.6,
  maxWidth: 720,
};

const tabsRowStyle: CSSProperties = {
  display: "flex",
  gap: 10,
  marginTop: 24,
  marginBottom: 18,
  flexWrap: "wrap",
  padding: 6,
  borderRadius: 18,
  background: "rgba(255,255,255,0.025)",
  border: "1px solid rgba(255,255,255,0.05)",
  width: "fit-content",
};

const fixedBodyStyle: CSSProperties = {
  borderRadius: 24,
  border: "1px solid rgba(255,255,255,0.06)",
  background: "linear-gradient(180deg, rgba(255,255,255,0.022), rgba(255,255,255,0.012))",
  padding: 20,
  boxSizing: "border-box",
  overflow: "hidden",
  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.03)",
};

const generalLayoutStyle: CSSProperties = {
  height: "100%",
  display: "flex",
  flexDirection: "column",
  gap: 16,
};

const heroCardStyle: CSSProperties = {
  borderRadius: 24,
  padding: 22,
  border: "1px solid rgba(255,255,255,0.06)",
  background: "linear-gradient(180deg, rgba(255,255,255,0.05), rgba(255,255,255,0.025))",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 20,
  boxShadow: "0 18px 40px rgba(0,0,0,0.14)",
};

const largeAvatarStyle: CSSProperties = {
  width: 92,
  height: 92,
  borderRadius: 24,
  objectFit: "cover",
  border: "1px solid rgba(255,255,255,0.08)",
  background: "#10141b",
  flexShrink: 0,
  boxShadow: "0 16px 34px rgba(0,0,0,0.22)",
};

const largeAvatarFallbackStyle: CSSProperties = {
  width: 92,
  height: 92,
  borderRadius: 24,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "linear-gradient(135deg,#5865f2,#7b8aff)",
  color: "white",
  fontWeight: 900,
  fontSize: 28,
  border: "1px solid rgba(255,255,255,0.08)",
  flexShrink: 0,
  boxShadow: "0 16px 34px rgba(88,101,242,0.24)",
};

const generalActionsStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 10,
  minWidth: 230,
};

const surfaceCardStyle: CSSProperties = {
  borderRadius: 20,
  padding: 18,
  border: "1px solid rgba(255,255,255,0.06)",
  background: "linear-gradient(180deg, rgba(255,255,255,0.03), rgba(255,255,255,0.018))",
  display: "flex",
  flexDirection: "column",
  gap: 8,
};

const uploadButtonStyle: CSSProperties = {
  height: 44,
  borderRadius: 14,
  border: "1px solid rgba(110,124,255,0.24)",
  background: "linear-gradient(135deg, rgba(88,101,242,0.22), rgba(123,138,255,0.14))",
  color: "#eef2ff",
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontWeight: 800,
  fontSize: 14,
  padding: "0 16px",
};

const secondaryButtonStyle: CSSProperties = {
  height: 44,
  borderRadius: 14,
  border: "1px solid rgba(255,255,255,0.08)",
  background: "rgba(255,255,255,0.045)",
  color: "#dfe4ee",
  cursor: "pointer",
  fontWeight: 700,
  fontSize: 14,
};

const inputStyle: CSSProperties = {
  width: "100%",
  minHeight: 48,
  borderRadius: 14,
  border: "1px solid rgba(255,255,255,0.08)",
  background: "rgba(9,12,18,0.88)",
  color: "#f4f7fb",
  padding: "0 14px",
  outline: "none",
  boxSizing: "border-box",
  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.02)",
};

const smallInputStyle: CSSProperties = {
  ...inputStyle,
  minHeight: 42,
  height: 42,
  padding: "0 12px",
};

const labelStyle: CSSProperties = {
  color: "#d5deea",
  fontWeight: 800,
  fontSize: 12,
  textTransform: "uppercase",
  letterSpacing: 0.8,
};

const hintStyle: CSSProperties = {
  color: "#8f9aac",
  fontSize: 12,
  lineHeight: 1.55,
};

const microHintStyle: CSSProperties = {
  color: "#8894a8",
  fontSize: 12,
  lineHeight: 1.45,
};

const errorStyle: CSSProperties = {
  color: "#ffb1b3",
  fontSize: 13,
  marginTop: 4,
  padding: "10px 12px",
  borderRadius: 12,
  background: "rgba(237,66,69,0.10)",
  border: "1px solid rgba(237,66,69,0.16)",
};

const footerStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 10,
  marginTop: "auto",
  paddingTop: 10,
};

const cancelButtonStyle: CSSProperties = {
  height: 46,
  minWidth: 120,
  borderRadius: 14,
  border: "1px solid rgba(255,255,255,0.08)",
  background: "rgba(255,255,255,0.045)",
  color: "#e4e9f3",
  cursor: "pointer",
  fontWeight: 800,
  padding: "0 16px",
};

const saveButtonStyle: CSSProperties = {
  height: 46,
  minWidth: 152,
  borderRadius: 14,
  border: "1px solid rgba(110,124,255,0.24)",
  background: "linear-gradient(135deg,#5865f2,#7b8aff)",
  color: "white",
  cursor: "pointer",
  fontWeight: 900,
  padding: "0 16px",
  boxShadow: "0 16px 32px rgba(88,101,242,0.24)",
};

const dangerButtonStyle: CSSProperties = {
  height: 46,
  minWidth: 132,
  borderRadius: 14,
  border: "1px solid rgba(237,66,69,0.24)",
  background: "rgba(237,66,69,0.12)",
  color: "#ffc2c4",
  cursor: "pointer",
  fontWeight: 800,
  padding: "0 16px",
};

const rolesShellStyle: CSSProperties = {
  height: "100%",
  display: "grid",
  gridTemplateColumns: "340px minmax(0, 1fr)",
  gap: 18,
};

const rolesSidebarStyle: CSSProperties = {
  borderRadius: 22,
  border: "1px solid rgba(255,255,255,0.06)",
  background: "linear-gradient(180deg, rgba(255,255,255,0.03), rgba(255,255,255,0.018))",
  padding: 16,
  display: "flex",
  flexDirection: "column",
  gap: 10,
  minHeight: 0,
  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.02)",
};

const rolesEditorStyle: CSSProperties = {
  borderRadius: 22,
  border: "1px solid rgba(255,255,255,0.06)",
  background: "linear-gradient(180deg, rgba(255,255,255,0.03), rgba(255,255,255,0.018))",
  padding: 20,
  minHeight: 0,
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
};

const sidebarHeaderStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 10,
};

const sectionTitleStyle: CSSProperties = {
  color: "#f4f7fb",
  fontWeight: 900,
  fontSize: 17,
  letterSpacing: -0.2,
};

const createRoleRowStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) auto",
  gap: 10,
};

const miniPrimaryButtonStyle: CSSProperties = {
  height: 42,
  borderRadius: 14,
  border: "1px solid rgba(110,124,255,0.24)",
  background: "linear-gradient(135deg,#5865f2,#7b8aff)",
  color: "white",
  cursor: "pointer",
  fontWeight: 800,
  padding: "0 14px",
  flexShrink: 0,
  boxShadow: "0 10px 24px rgba(88,101,242,0.18)",
};

const roleListStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 8,
  overflowY: "auto",
  minHeight: 0,
  paddingRight: 2,
};

const roleListItemStyle: CSSProperties = {
  width: "100%",
  minHeight: 46,
  borderRadius: 14,
  padding: "0 12px",
  display: "flex",
  alignItems: "center",
  gap: 10,
  boxSizing: "border-box",
  transition: "all 140ms ease",
};

const pillStyle: CSSProperties = {
  height: 22,
  borderRadius: 999,
  padding: "0 8px",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  border: "1px solid rgba(255,255,255,0.08)",
  background: "rgba(255,255,255,0.05)",
  color: "#c8d0de",
  fontSize: 11,
  fontWeight: 800,
};

const editorTopRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "space-between",
  gap: 10,
  marginBottom: 14,
};

const previewRoleChipStyle: CSSProperties = {
  minHeight: 38,
  borderRadius: 999,
  padding: "0 14px",
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  border: "1px solid rgba(255,255,255,0.08)",
  background: "rgba(255,255,255,0.04)",
  color: "#eef2f7",
  fontWeight: 800,
};

const formGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) minmax(260px, 320px)",
  gap: 16,
};

const colorRowStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "56px minmax(0, 1fr)",
  gap: 10,
};

const colorInputStyle: CSSProperties = {
  width: 56,
  minWidth: 56,
  height: 46,
  padding: 4,
  borderRadius: 14,
  border: "1px solid rgba(255,255,255,0.08)",
  background: "#0d1118",
  cursor: "pointer",
};

const permissionsGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
  gap: 10,
  overflowY: "auto",
  paddingRight: 4,
  minHeight: 0,
  alignContent: "start",
};

const panelColumnStyle: CSSProperties = {
  height: "100%",
  display: "flex",
  flexDirection: "column",
  minHeight: 0,
};

const panelHeaderRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "space-between",
  gap: 16,
  marginBottom: 16,
};

const memberListStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 10,
  overflowY: "auto",
  minHeight: 0,
  paddingRight: 4,
};

const memberCardStyle: CSSProperties = {
  borderRadius: 20,
  border: "1px solid rgba(255,255,255,0.06)",
  background: "linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.02))",
  padding: 18,
  display: "flex",
  flexDirection: "column",
  gap: 14,
  boxShadow: "0 12px 28px rgba(0,0,0,0.12)",
};

const memberTopStyle: CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "space-between",
  gap: 14,
};

const memberNameStyle: CSSProperties = {
  color: "#f4f7fb",
  fontWeight: 900,
  fontSize: 14,
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
  letterSpacing: -0.1,
};

const memberMetaStyle: CSSProperties = {
  color: "#98a3b6",
  fontSize: 11,
  marginTop: 2,
  lineHeight: 1.45,
};

const memberCountTinyPillStyle: CSSProperties = {
  minWidth: 24,
  height: 22,
  padding: "0 7px",
  borderRadius: 999,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  background: "rgba(255,255,255,0.05)",
  border: "1px solid rgba(255,255,255,0.05)",
  color: "#d8dfec",
  fontSize: 11,
  fontWeight: 800,
  flexShrink: 0,
};

const memberDangerActionsStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  flexShrink: 0,
};

const memberDangerButtonStyle: CSSProperties = {
  height: 38,
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.08)",
  background: "rgba(255,255,255,0.045)",
  color: "#eef2f7",
  cursor: "pointer",
  fontWeight: 800,
  padding: "0 12px",
  display: "inline-flex",
  alignItems: "center",
  gap: 7,
};

const memberBanButtonStyle: CSSProperties = {
  ...memberDangerButtonStyle,
  border: "1px solid rgba(237,66,69,0.22)",
  background: "rgba(237,66,69,0.12)",
  color: "#ffc2c4",
};

const memberRolesWrapStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 8,
};

const memberRoleChipStyle: CSSProperties = {
  minHeight: 34,
  borderRadius: 999,
  padding: "0 12px",
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  fontWeight: 800,
  cursor: "pointer",
  transition: "all 140ms ease",
};

const emptyStateStyle: CSSProperties = {
  color: "#98a3b6",
  fontSize: 13,
  padding: "16px 6px",
  borderRadius: 14,
  background: "rgba(255,255,255,0.02)",
  border: "1px dashed rgba(255,255,255,0.06)",
};

const searchWrapStyle: CSSProperties = {
  height: 44,
  borderRadius: 14,
  border: "1px solid rgba(255,255,255,0.08)",
  background: "rgba(9,12,18,0.88)",
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "0 12px",
  boxSizing: "border-box",
};

const searchInputStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  border: "none",
  outline: "none",
  background: "transparent",
  color: "#f4f7fb",
  fontSize: 14,
};

const searchClearButtonStyle: CSSProperties = {
  width: 24,
  height: 24,
  borderRadius: 999,
  border: "none",
  background: "rgba(255,255,255,0.06)",
  color: "#c9d0dc",
  cursor: "pointer",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 0,
};
