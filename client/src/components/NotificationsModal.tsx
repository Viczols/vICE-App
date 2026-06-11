import { useMemo, useState } from "react";

type FriendRequestItem = {
  id: string;
  username: string;
  displayName: string;
  avatarUrl?: string | null;
  createdAt: string;
};

type ServerInviteItem = {
  id: string;
  serverName: string;
  inviterDisplayName: string;
  avatarUrl?: string | null;
  createdAt: string;
};

type NotificationsModalProps = {
  isOpen: boolean;
  onClose: () => void;
  incomingFriendRequests: FriendRequestItem[];
  incomingServerInvites: ServerInviteItem[];
  onAcceptFriendRequest: (requesterUserId: string) => Promise<void> | void;
  onRejectFriendRequest: (requesterUserId: string) => Promise<void> | void;
  onAcceptServerInvite: (inviteId: string) => Promise<void> | void;
  onRejectServerInvite: (inviteId: string) => Promise<void> | void;
};

function resolveAssetUrl(value?: string | null) {
  const normalized = String(value ?? "").trim();
  if (!normalized) return "";
  if (/^https?:\/\//i.test(normalized)) return normalized;
  if (normalized.startsWith("/")) return `http://localhost:3001${normalized}`;
  return `http://localhost:3001/${normalized.replace(/^\/+/, "")}`;
}

function Avatar({
  label,
  avatarUrl,
  size = 42,
}: {
  label: string;
  avatarUrl?: string | null;
  size?: number;
}) {
  const resolvedAvatarUrl = resolveAssetUrl(avatarUrl);

  if (resolvedAvatarUrl) {
    return (
      <img
        src={resolvedAvatarUrl}
        alt={label}
        style={{
          width: size,
          height: size,
          borderRadius: 999,
          objectFit: "cover",
          objectPosition: "center",
          display: "block",
          flexShrink: 0,
          border: "1px solid rgba(255,255,255,0.08)",
          background: "#1b2028",
          boxShadow: "0 8px 18px rgba(0,0,0,0.18)",
          overflow: "hidden",
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
      {label.slice(0, 1).toUpperCase()}
    </div>
  );
}

function TabButton({
  active,
  children,
  onClick,
  badge,
}: {
  active: boolean;
  children: React.ReactNode;
  onClick: () => void;
  badge?: number;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1,
        height: 40,
        borderRadius: 14,
        border: active
          ? "1px solid rgba(88,101,242,0.22)"
          : "1px solid rgba(255,255,255,0.06)",
        background: active
          ? "linear-gradient(135deg, rgba(88,101,242,0.18), rgba(123,138,255,0.10))"
          : "rgba(255,255,255,0.03)",
        color: active ? "#eef1ff" : "#a8b0bc",
        cursor: "pointer",
        fontWeight: 700,
        fontSize: 13,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
      }}
    >
      <span>{children}</span>
      {!!badge && (
        <span
          style={{
            minWidth: 20,
            height: 20,
            borderRadius: 999,
            padding: "0 6px",
            background: "rgba(255,255,255,0.08)",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 11,
            fontWeight: 800,
            color: "white",
          }}
        >
          {badge}
        </span>
      )}
    </button>
  );
}

function EmptyState({
  title,
  subtitle,
}: {
  title: string;
  subtitle: string;
}) {
  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
    >
      <div
        style={{
          textAlign: "center",
          maxWidth: 320,
        }}
      >
        <div
          style={{
            fontSize: 18,
            fontWeight: 800,
            color: "white",
            marginBottom: 8,
          }}
        >
          {title}
        </div>

        <div
          style={{
            fontSize: 13,
            color: "#95a0ae",
            lineHeight: 1.6,
          }}
        >
          {subtitle}
        </div>
      </div>
    </div>
  );
}

export default function NotificationsModal({
  isOpen,
  onClose,
  incomingFriendRequests,
  incomingServerInvites,
  onAcceptFriendRequest,
  onRejectFriendRequest,
  onAcceptServerInvite,
  onRejectServerInvite,
}: NotificationsModalProps) {
  const [tab, setTab] = useState<"friends" | "servers">("friends");
  const [loadingKey, setLoadingKey] = useState<string | null>(null);

  const totalCount = useMemo(
    () => incomingFriendRequests.length + incomingServerInvites.length,
    [incomingFriendRequests.length, incomingServerInvites.length]
  );

  if (!isOpen) return null;

  const handleAction = async (key: string, fn: () => Promise<void> | void) => {
    try {
      setLoadingKey(key);
      await fn();
    } finally {
      setLoadingKey(null);
    }
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.58)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1400,
        padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 760,
          height: "min(82vh, 760px)",
          background: "linear-gradient(180deg,#171b22,#13171d)",
          border: "1px solid rgba(255,255,255,0.06)",
          borderRadius: 26,
          boxShadow: "0 28px 90px rgba(0,0,0,0.45)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            padding: "18px 20px",
            borderBottom: "1px solid rgba(255,255,255,0.06)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 14,
          }}
        >
          <div>
            <div
              style={{
                fontSize: 23,
                fontWeight: 800,
                color: "white",
              }}
            >
              Bildirimler
            </div>

            <div
              style={{
                fontSize: 13,
                color: "#98a2b0",
                marginTop: 4,
              }}
            >
              Bekleyen arkadaşlık ve sunucu davetlerini buradan yönetebilirsin.
            </div>
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
            }}
          >
            <div
              style={{
                minWidth: 28,
                height: 28,
                borderRadius: 999,
                padding: "0 10px",
                background: "rgba(88,101,242,0.18)",
                border: "1px solid rgba(88,101,242,0.24)",
                color: "white",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 12,
                fontWeight: 800,
              }}
            >
              {totalCount}
            </div>

            <button
              onClick={onClose}
              style={{
                width: 36,
                height: 36,
                borderRadius: 999,
                border: "none",
                background: "transparent",
                color: "#8f98a6",
                fontSize: 24,
                cursor: "pointer",
                lineHeight: 1,
              }}
            >
              ×
            </button>
          </div>
        </div>

        <div
          style={{
            padding: "14px 20px 0",
            display: "flex",
            gap: 10,
          }}
        >
          <TabButton
            active={tab === "friends"}
            onClick={() => setTab("friends")}
            badge={incomingFriendRequests.length}
          >
            Arkadaşlık
          </TabButton>

          <TabButton
            active={tab === "servers"}
            onClick={() => setTab("servers")}
            badge={incomingServerInvites.length}
          >
            Sunucu Davetleri
          </TabButton>
        </div>

        <div
          style={{
            flex: 1,
            minHeight: 0,
            padding: 20,
            overflowY: "auto",
          }}
        >
          {tab === "friends" ? (
            incomingFriendRequests.length === 0 ? (
              <EmptyState
                title="Bekleyen arkadaşlık isteği yok"
                subtitle="Yeni bir istek geldiğinde burada görünecek."
              />
            ) : (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 12,
                }}
              >
                {incomingFriendRequests.map((request) => {
                  const acceptKey = `friend-accept-${request.id}`;
                  const rejectKey = `friend-reject-${request.id}`;
                  const busy =
                    loadingKey === acceptKey || loadingKey === rejectKey;

                  return (
                    <div
                      key={request.id}
                      style={{
                        borderRadius: 18,
                        padding: 14,
                        background:
                          "linear-gradient(180deg,rgba(255,255,255,0.035),rgba(255,255,255,0.02))",
                        border: "1px solid rgba(255,255,255,0.06)",
                        display: "flex",
                        alignItems: "center",
                        gap: 14,
                      }}
                    >
                      <Avatar
                        label={request.displayName}
                        avatarUrl={request.avatarUrl}
                      />

                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div
                          style={{
                            fontSize: 15,
                            fontWeight: 800,
                            color: "#edf2fb",
                          }}
                        >
                          {request.displayName}
                        </div>

                        <div
                          style={{
                            marginTop: 4,
                            fontSize: 13,
                            color: "#97a1af",
                            lineHeight: 1.5,
                          }}
                        >
                          @{request.username} sana arkadaşlık isteği gönderdi.
                        </div>
                      </div>

                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          flexShrink: 0,
                        }}
                      >
                        <button
                          disabled={busy}
                          onClick={() =>
                            handleAction(acceptKey, () =>
                              onAcceptFriendRequest(request.id)
                            )
                          }
                          style={acceptButtonStyle}
                        >
                          {loadingKey === acceptKey ? "..." : "Kabul"}
                        </button>

                        <button
                          disabled={busy}
                          onClick={() =>
                            handleAction(rejectKey, () =>
                              onRejectFriendRequest(request.id)
                            )
                          }
                          style={rejectButtonStyle}
                        >
                          {loadingKey === rejectKey ? "..." : "Reddet"}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )
          ) : incomingServerInvites.length === 0 ? (
            <EmptyState
              title="Bekleyen sunucu daveti yok"
              subtitle="Sunucu davetleri geldiğinde burada görünecek."
            />
          ) : (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 12,
              }}
            >
              {incomingServerInvites.map((invite) => {
                const acceptKey = `server-accept-${invite.id}`;
                const rejectKey = `server-reject-${invite.id}`;
                const busy =
                  loadingKey === acceptKey || loadingKey === rejectKey;

                return (
                  <div
                    key={invite.id}
                    style={{
                      borderRadius: 18,
                      padding: 14,
                      background:
                        "linear-gradient(180deg,rgba(255,255,255,0.035),rgba(255,255,255,0.02))",
                      border: "1px solid rgba(255,255,255,0.06)",
                      display: "flex",
                      alignItems: "center",
                      gap: 14,
                    }}
                  >
                    <Avatar
                      label={invite.serverName}
                      avatarUrl={invite.avatarUrl}
                    />

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: 15,
                          fontWeight: 800,
                          color: "#edf2fb",
                        }}
                      >
                        {invite.serverName}
                      </div>

                      <div
                        style={{
                          marginTop: 4,
                          fontSize: 13,
                          color: "#97a1af",
                          lineHeight: 1.5,
                        }}
                      >
                        {invite.inviterDisplayName} seni bu sunucuya davet etti.
                      </div>
                    </div>

                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        flexShrink: 0,
                      }}
                    >
                      <button
                        disabled={busy}
                        onClick={() =>
                          handleAction(acceptKey, () =>
                            onAcceptServerInvite(invite.id)
                          )
                        }
                        style={acceptButtonStyle}
                      >
                        {loadingKey === acceptKey ? "..." : "Kabul"}
                      </button>

                      <button
                        disabled={busy}
                        onClick={() =>
                          handleAction(rejectKey, () =>
                            onRejectServerInvite(invite.id)
                          )
                        }
                        style={rejectButtonStyle}
                      >
                        {loadingKey === rejectKey ? "..." : "Reddet"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const acceptButtonStyle: React.CSSProperties = {
  height: 38,
  borderRadius: 12,
  border: "none",
  background: "linear-gradient(135deg,#5865f2,#7b8aff)",
  color: "white",
  padding: "0 14px",
  cursor: "pointer",
  fontWeight: 800,
  fontSize: 12,
  boxShadow: "0 10px 22px rgba(88,101,242,0.20)",
};

const rejectButtonStyle: React.CSSProperties = {
  height: 38,
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.08)",
  background: "rgba(255,255,255,0.04)",
  color: "#d9e0ea",
  padding: "0 14px",
  cursor: "pointer",
  fontWeight: 700,
  fontSize: 12,
};
