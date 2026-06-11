import { useEffect, useMemo, useState, type CSSProperties } from "react";

type Server = {
  id: string;
  name: string;
  ownerId?: string;
  avatarUrl?: string | null;
};

type SidebarServersProps = {
  selectedServerId: string | null;
  onSelectServer: (serverId: string | null) => void;
  isDMView?: boolean;
  onOpenDM?: () => void | Promise<void>;
  dmUnreadCount?: number;
  serverUnreadMap?: Record<string, number>;
  onClearAllUnread?: () => void;
};

type ServerModalStep = "root" | "create" | "join";

const SERVER_ORDER_STORAGE_KEY = "vice_sidebar_server_order_v4";

function getInitials(name: string) {
  const parts = String(name || "?").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

function resolveAssetUrl(value?: string | null) {
  const normalized = String(value ?? "").trim();
  if (!normalized) return "";
  if (/^https?:\/\//i.test(normalized)) return normalized;
  if (normalized.startsWith("/")) return `http://localhost:3001${normalized}`;
  return `http://localhost:3001/${normalized.replace(/^\/+/, "")}`;
}

export default function SidebarServers({
  selectedServerId,
  onSelectServer,
  isDMView = false,
  onOpenDM,
  dmUnreadCount = 0,
  serverUnreadMap = {},
  onClearAllUnread,
}: SidebarServersProps) {
  const [servers, setServers] = useState<Server[]>([]);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [step, setStep] = useState<ServerModalStep>("root");

  const [serverName, setServerName] = useState("");
  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError] = useState("");

  const [inviteCode, setInviteCode] = useState("");
  const [joinLoading, setJoinLoading] = useState(false);
  const [joinError, setJoinError] = useState("");

  const [draggingServerId, setDraggingServerId] = useState<string | null>(null);
  const [dragOverServerId, setDragOverServerId] = useState<string | null>(null);
  const [hoveredServerId, setHoveredServerId] = useState<string | null>(null);
  const [isDmHovered, setIsDmHovered] = useState(false);
  const [isAddHovered, setIsAddHovered] = useState(false);

  const getStoredServerOrder = (): string[] => {
    try {
      const raw = localStorage.getItem(SERVER_ORDER_STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  };

  const saveServerOrder = (orderedIds: string[]) => {
    try {
      localStorage.setItem(SERVER_ORDER_STORAGE_KEY, JSON.stringify(orderedIds));
    } catch {}
  };

  const sortServersByStoredOrder = (list: Server[]) => {
    const order = getStoredServerOrder();
    if (!order.length) return list;

    const orderIndex = new Map(order.map((id, index) => [id, index]));

    return [...list].sort((a, b) => {
      const aIndex = orderIndex.has(a.id) ? orderIndex.get(a.id)! : Number.MAX_SAFE_INTEGER;
      const bIndex = orderIndex.has(b.id) ? orderIndex.get(b.id)! : Number.MAX_SAFE_INTEGER;

      if (aIndex !== bIndex) return aIndex - bIndex;
      return a.name.localeCompare(b.name, "tr");
    });
  };

  const syncStoredOrderWithServers = (list: Server[]) => {
    const currentIds = list.map((server) => server.id);
    const storedOrder = getStoredServerOrder();

    const filteredStored = storedOrder.filter((id) => currentIds.includes(id));
    const missingIds = currentIds.filter((id) => !filteredStored.includes(id));
    const nextOrder = [...filteredStored, ...missingIds];

    saveServerOrder(nextOrder);
    return nextOrder;
  };

  const loadServers = async () => {
    const token = localStorage.getItem("token");
    if (!token) return [];

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
    const rawServers = Array.isArray(data) ? data : [];

    syncStoredOrderWithServers(rawServers);
    const nextServers = sortServersByStoredOrder(rawServers);

    setServers(nextServers);

    if (!selectedServerId && nextServers.length > 0 && !isDMView) {
      onSelectServer(nextServers[0].id);
    }

    if (
      selectedServerId &&
      !nextServers.some((server) => server.id === selectedServerId) &&
      !isDMView
    ) {
      onSelectServer(nextServers[0]?.id ?? null);
    }

    return nextServers;
  };

  useEffect(() => {
    loadServers().catch((err) => {
      console.error("servers fetch error:", err);
    });
  }, []);

  useEffect(() => {
    const handleServersUpdated = () => {
      loadServers().catch((err) => {
        console.error("servers live fetch error:", err);
      });
    };

    window.addEventListener("vice-servers-updated", handleServersUpdated);
    return () => {
      window.removeEventListener("vice-servers-updated", handleServersUpdated);
    };
  }, [selectedServerId, isDMView]);

  const resetModal = () => {
    setStep("root");
    setServerName("");
    setCreateError("");
    setInviteCode("");
    setJoinError("");
  };

  const openModal = () => {
    resetModal();
    setIsModalOpen(true);
  };

  const closeModal = () => {
    if (createLoading || joinLoading) return;
    setIsModalOpen(false);
    resetModal();
  };

  const createServer = async () => {
    const token = localStorage.getItem("token");
    if (!token) return;

    const trimmedName = serverName.trim();

    if (trimmedName.length < 2) {
      setCreateError("Sunucu adı en az 2 karakter olmalı.");
      return;
    }

    try {
      setCreateLoading(true);
      setCreateError("");

      const res = await fetch("http://localhost:3001/servers", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: trimmedName,
        }),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok) {
        setCreateError(data?.error || "Sunucu oluşturulamadı.");
        return;
      }

      await loadServers();
      window.dispatchEvent(new CustomEvent("vice-servers-updated"));

      if (data?.id) {
        onSelectServer(data.id);
      }

      closeModal();
    } catch (err) {
      console.error(err);
      setCreateError("Sunucu oluşturulurken bağlantı hatası oldu.");
    } finally {
      setCreateLoading(false);
    }
  };

  const joinServer = async () => {
    const token = localStorage.getItem("token");
    if (!token) return;

    const trimmedCode = inviteCode.trim().toUpperCase();

    if (trimmedCode.length < 3) {
      setJoinError("Geçerli bir davet kodu gir.");
      return;
    }

    try {
      setJoinLoading(true);
      setJoinError("");

      const res = await fetch("http://localhost:3001/servers/join", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          code: trimmedCode,
        }),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok) {
        setJoinError(data?.error || "Sunucuya katılınamadı.");
        return;
      }

      await loadServers();
      window.dispatchEvent(new CustomEvent("vice-servers-updated"));

      if (data?.server?.id) {
        onSelectServer(data.server.id);
      }

      closeModal();
    } catch (err) {
      console.error(err);
      setJoinError("Sunucuya katılırken bağlantı hatası oldu.");
    } finally {
      setJoinLoading(false);
    }
  };

  const moveServer = (sourceId: string, targetId: string) => {
    if (!sourceId || !targetId || sourceId === targetId) return;

    setServers((prev) => {
      const next = [...prev];
      const sourceIndex = next.findIndex((item) => item.id === sourceId);
      const targetIndex = next.findIndex((item) => item.id === targetId);

      if (sourceIndex === -1 || targetIndex === -1) return prev;

      const [moved] = next.splice(sourceIndex, 1);
      next.splice(targetIndex, 0, moved);

      saveServerOrder(next.map((item) => item.id));
      return next;
    });
  };

  const handleDragStart = (serverId: string) => {
    setDraggingServerId(serverId);
    setDragOverServerId(null);
  };

  const handleDragEnter = (serverId: string) => {
    if (!draggingServerId || draggingServerId === serverId) return;
    setDragOverServerId(serverId);
  };

  const handleDrop = (targetServerId: string) => {
    if (!draggingServerId || draggingServerId === targetServerId) {
      setDraggingServerId(null);
      setDragOverServerId(null);
      return;
    }

    moveServer(draggingServerId, targetServerId);
    setDraggingServerId(null);
    setDragOverServerId(null);
  };

  const handleDragEnd = () => {
    setDraggingServerId(null);
    setDragOverServerId(null);
  };

  const orderedServers = useMemo(() => servers, [servers]);
  const totalServerUnread = useMemo(
    () =>
      Object.values(serverUnreadMap).reduce(
        (sum, value) => sum + Math.max(0, Number(value || 0)),
        0
      ),
    [serverUnreadMap]
  );

  return (
    <>
      <div style={topShellStyle}>
        <div style={topRailStyle}>
          <div style={sideFixedAreaStyle}>
            <div style={serverSlotStyle}>
              <button
                title="Direkt mesajlar"
                onClick={() => onOpenDM?.()}
                onMouseEnter={() => setIsDmHovered(true)}
                onMouseLeave={() => setIsDmHovered(false)}
                style={{
                  ...dmButtonStyle,
                  ...(isDMView ? activeDmButtonStyle : {}),
                  ...(isDmHovered && !isDMView ? hoverDmButtonStyle : {}),
                }}
              >
                <span
                  style={{
                    ...buttonGlowStyle,
                    ...(isDMView ? activeButtonGlowStyle : {}),
                    ...(isDmHovered ? hoverButtonGlowStyle : {}),
                  }}
                />
                <span style={buttonTextStyle}>DM</span>
              </button>

              {!isDMView && dmUnreadCount > 0 && (
                <span style={badgeStyle}>
                  {dmUnreadCount > 99 ? "99+" : dmUnreadCount}
                </span>
              )}
            </div>
          </div>

          <div style={centerAreaStyle}>
            <div style={centerScrollerOuterStyle}>
              <div style={centerScrollerInnerStyle}>
                {orderedServers.map((server) => {
                  const isActive = !isDMView && server.id === selectedServerId;
                  const isDragging = draggingServerId === server.id;
                  const isDragOver =
                    dragOverServerId === server.id && draggingServerId !== server.id;
                  const isHovered = hoveredServerId === server.id;
                  const unreadCount = Number(serverUnreadMap[server.id] || 0);

                  return (
                    <div
                      key={server.id}
                      onDragOver={(e) => e.preventDefault()}
                      onDragEnter={() => handleDragEnter(server.id)}
                      onDrop={() => handleDrop(server.id)}
                      style={serverSlotStyle}
                    >
                      {isDragOver && <div style={dropIndicatorStyle} />}

                      <button
                        draggable
                        onDragStart={() => handleDragStart(server.id)}
                        onDragEnd={handleDragEnd}
                        onMouseEnter={() => setHoveredServerId(server.id)}
                        onMouseLeave={() =>
                          setHoveredServerId((current) => (current === server.id ? null : current))
                        }
                        onClick={() => onSelectServer(server.id)}
                        title={server.name}
                        style={{
                          ...serverButtonStyle,
                          ...(isActive ? activeServerButtonStyle : {}),
                          ...(isHovered && !isActive ? hoverServerButtonStyle : {}),
                          ...(isDragging ? draggingServerButtonStyle : {}),
                        }}
                      >
                        <span
                          style={{
                            ...buttonGlowStyle,
                            ...(isActive ? activeButtonGlowStyle : {}),
                            ...(isHovered ? hoverButtonGlowStyle : {}),
                          }}
                        />
                        {server.avatarUrl ? (
                          <div
                            style={{
                              ...serverAvatarInnerStyle,
                              ...(isActive ? activeServerAvatarInnerStyle : {}),
                              ...(isHovered && !isActive ? hoverServerAvatarInnerStyle : {}),
                            }}
                          >
                            <img
                              src={resolveAssetUrl(server.avatarUrl)}
                              alt={server.name}
                              style={serverAvatarImageStyle}
                            />
                          </div>
                        ) : (
                          <span style={buttonTextStyle}>{getInitials(server.name)}</span>
                        )}
                      </button>

                      {unreadCount > 0 && (
                        <span style={badgeStyle}>
                          {unreadCount > 99 ? "99+" : unreadCount}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div style={sideFixedAreaStyleRight}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              {totalServerUnread > 0 && (
                <button
                  title="Tüm sunucu bildirimlerini okundu yap"
                  onClick={() => onClearAllUnread?.()}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.opacity = "1";
                    e.currentTarget.style.background = "rgba(255,255,255,0.08)";
                    e.currentTarget.style.borderColor = "rgba(255,255,255,0.12)";
                    e.currentTarget.style.transform = "translateY(-1px)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.opacity = "0.7";
                    e.currentTarget.style.background = "rgba(255,255,255,0.04)";
                    e.currentTarget.style.borderColor = "rgba(255,255,255,0.06)";
                    e.currentTarget.style.transform = "translateY(0)";
                  }}
                  style={markReadButtonStyle}
                >
                  <span style={markReadButtonTextStyle}>Read all</span>
                </button>
              )}

              <button
                title="Sunucu ekle"
                onClick={openModal}
                onMouseEnter={() => setIsAddHovered(true)}
                onMouseLeave={() => setIsAddHovered(false)}
                style={{
                  ...addButtonStyle,
                  ...(isAddHovered ? hoverAddButtonStyle : {}),
                }}
              >
                <span
                  style={{
                    ...buttonGlowStyle,
                    ...(isAddHovered ? hoverButtonGlowStyle : {}),
                  }}
                />
                <span style={buttonTextStyle}>+</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {isModalOpen && (
        <div onClick={closeModal} style={overlayStyle}>
          <div onClick={(e) => e.stopPropagation()} style={modalCardStyle}>
            <button onClick={closeModal} style={closeButtonStyle}>
              ×
            </button>

            {step === "root" && (
              <>
                <div style={modalTitleStyle}>Sunucu Alanı</div>
                <div style={modalTextStyle}>
                  Yeni bir sunucu oluşturabilir ya da davet koduyla mevcut bir sunucuya katılabilirsin.
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 18 }}>
                  <button onClick={() => setStep("create")} style={optionButtonStyle}>
                    <div>
                      <div style={optionTitleStyle}>Yeni Sunucu Oluştur</div>
                      <div style={optionDescStyle}>
                        Sıfırdan alan kur ve otomatik kanallarla başla.
                      </div>
                    </div>
                    <span style={arrowStyle}>›</span>
                  </button>

                  <button onClick={() => setStep("join")} style={optionButtonStyle}>
                    <div>
                      <div style={optionTitleStyle}>Davetle Katıl</div>
                      <div style={optionDescStyle}>
                        Davet kodunu gir ve doğrudan sunucuya bağlan.
                      </div>
                    </div>
                    <span style={arrowStyle}>›</span>
                  </button>
                </div>
              </>
            )}

            {step === "create" && (
              <>
                <button onClick={() => setStep("root")} style={backButtonStyle}>
                  Geri
                </button>

                <div style={modalTitleStyle}>Yeni sunucu oluştur</div>
                <div style={modalTextStyle}>
                  Oluşturduğunda otomatik olarak bir yazı kanalı ve bir ses kanalı açılacak.
                </div>

                <input
                  value={serverName}
                  onChange={(e) => setServerName(e.target.value)}
                  placeholder="Sunucu adı"
                  autoFocus
                  style={inputStyle}
                />

                {createError && <div style={errorStyle}>{createError}</div>}

                <div style={footerActionsStyle}>
                  <button
                    onClick={() => setStep("root")}
                    disabled={createLoading}
                    style={secondaryButtonStyle}
                  >
                    Vazgeç
                  </button>

                  <button
                    onClick={createServer}
                    disabled={createLoading}
                    style={primaryButtonStyle}
                  >
                    {createLoading ? "Oluşturuluyor..." : "Oluştur"}
                  </button>
                </div>
              </>
            )}

            {step === "join" && (
              <>
                <button onClick={() => setStep("root")} style={backButtonStyle}>
                  Geri
                </button>

                <div style={modalTitleStyle}>Bir sunucuya katıl</div>
                <div style={modalTextStyle}>
                  Davet kodunu girerek doğrudan sunucuya bağlanabilirsin.
                </div>

                <input
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value)}
                  placeholder="Davet kodu"
                  autoFocus
                  style={inputStyle}
                />

                {joinError && <div style={errorStyle}>{joinError}</div>}

                <div style={footerActionsStyle}>
                  <button
                    onClick={() => setStep("root")}
                    disabled={joinLoading}
                    style={secondaryButtonStyle}
                  >
                    Vazgeç
                  </button>

                  <button
                    onClick={joinServer}
                    disabled={joinLoading}
                    style={primaryButtonStyle}
                  >
                    {joinLoading ? "Katılınıyor..." : "Sunucuya Katıl"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}

const topShellStyle: CSSProperties = {
  width: "100%",
  minHeight: 82,
  padding: "12px 16px 10px",
  boxSizing: "border-box",
  borderBottom: "1px solid rgba(88,104,150,0.14)",
  background:
    "linear-gradient(180deg, rgba(12,16,24,0.94) 0%, rgba(13,18,28,0.89) 100%)",
  backdropFilter: "blur(18px)",
};

const topRailStyle: CSSProperties = {
  width: "100%",
  minHeight: 64,
  display: "grid",
  gridTemplateColumns: "92px minmax(0, 1fr) 92px",
  alignItems: "center",
  gap: 10,
  padding: "8px 12px",
  borderRadius: 22,
  border: "1px solid rgba(255,255,255,0.035)",
  background:
    "linear-gradient(135deg, rgba(255,255,255,0.018), rgba(255,255,255,0.008))",
  boxShadow:
    "inset 0 1px 0 rgba(255,255,255,0.025), 0 8px 24px rgba(0,0,0,0.14)",
  overflow: "visible",
};

const sideFixedAreaStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "flex-start",
  minWidth: 0,
};

const sideFixedAreaStyleRight: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "flex-end",
  minWidth: 0,
};

const centerAreaStyle: CSSProperties = {
  minWidth: 0,
  display: "flex",
  justifyContent: "center",
  alignItems: "center",
};

const centerScrollerOuterStyle: CSSProperties = {
  maxWidth: "100%",
  overflowX: "auto",
  overflowY: "hidden",
  scrollbarWidth: "none",
  display: "flex",
  justifyContent: "center",
  minWidth: 0,
};

const centerScrollerInnerStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 12,
  minWidth: "fit-content",
  padding: "6px 4px",
};

const serverSlotStyle: CSSProperties = {
  position: "relative",
  flexShrink: 0,
};

const dmButtonStyle: CSSProperties = {
  position: "relative",
  width: 52,
  height: 52,
  borderRadius: 18,
  border: "1px solid rgba(122,136,176,0.10)",
  background:
    "linear-gradient(180deg, rgba(30,35,47,0.78) 0%, rgba(21,26,36,0.78) 100%)",
  color: "#e4eaff",
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  overflow: "hidden",
  flexShrink: 0,
  boxShadow:
    "0 6px 14px rgba(0,0,0,0.14), inset 0 1px 0 rgba(255,255,255,0.04)",
  transition:
    "transform 0.18s ease, box-shadow 0.18s ease, border-color 0.18s ease, background 0.18s ease, border-radius 0.18s ease",
  backdropFilter: "blur(8px)",
  padding: 0,
};

const hoverDmButtonStyle: CSSProperties = {
  transform: "translateY(-2px) scale(1.06)",
  borderRadius: 16,
  border: "1px solid rgba(140,155,255,0.25)",
  boxShadow:
    "0 12px 26px rgba(0,0,0,0.22), inset 0 1px 0 rgba(255,255,255,0.06)",
};

const activeDmButtonStyle: CSSProperties = {
  borderRadius: 16,
  border: "1px solid rgba(132,147,255,0.22)",
  background:
    "linear-gradient(180deg, rgba(84,98,220,0.80) 0%, rgba(61,74,182,0.80) 100%)",
  color: "#ffffff",
  transform: "translateY(-1px) scale(1.03)",
  boxShadow:
    "0 10px 20px rgba(88,101,242,0.16), inset 0 1px 0 rgba(255,255,255,0.10)",
};

const serverButtonStyle: CSSProperties = {
  position: "relative",
  width: 52,
  height: 52,
  borderRadius: 18,
  border: "1px solid rgba(122,136,176,0.10)",
  background:
    "linear-gradient(180deg, rgba(30,35,47,0.78) 0%, rgba(21,26,36,0.78) 100%)",
  color: "#e4eaff",
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  overflow: "hidden",
  flexShrink: 0,
  boxShadow:
    "0 6px 14px rgba(0,0,0,0.14), inset 0 1px 0 rgba(255,255,255,0.04)",
  transition:
    "transform 0.18s ease, box-shadow 0.18s ease, border-color 0.18s ease, background 0.18s ease, border-radius 0.18s ease",
  backdropFilter: "blur(8px)",
  padding: 0,
};

const hoverServerButtonStyle: CSSProperties = {
  transform: "translateY(-2px) scale(1.06)",
  borderRadius: 16,
  border: "1px solid rgba(140,155,255,0.35)",
  boxShadow:
    "0 10px 24px rgba(0,0,0,0.25), 0 0 0 1px rgba(120,140,255,0.15)",
};

const activeServerButtonStyle: CSSProperties = {
  borderRadius: 16,
  border: "1px solid rgba(120,140,255,0.55)",
  background:
    "linear-gradient(180deg, rgba(70,85,220,0.95) 0%, rgba(55,65,170,0.95) 100%)",
  color: "#ffffff",
  transform: "translateY(-1px) scale(1.06)",
  transformOrigin: "center",
  boxShadow:
    "0 12px 30px rgba(88,101,242,0.35), 0 0 0 2px rgba(120,140,255,0.25), inset 0 1px 0 rgba(255,255,255,0.12)",
};

const draggingServerButtonStyle: CSSProperties = {
  opacity: 0.52,
  transform: "scale(0.95)",
  cursor: "grabbing",
};

const buttonGlowStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  background:
    "radial-gradient(circle at 30% 24%, rgba(255,255,255,0.06), transparent 42%)",
  pointerEvents: "none",
  transition: "opacity 0.2s ease, filter 0.2s ease, background 0.2s ease",
  opacity: 0.82,
};

const hoverButtonGlowStyle: CSSProperties = {
  opacity: 1,
  filter: "brightness(1.16)",
};

const activeButtonGlowStyle: CSSProperties = {
  background:
    "radial-gradient(circle at 32% 24%, rgba(255,255,255,0.12), transparent 40%)",
  opacity: 1,
};

const buttonTextStyle: CSSProperties = {
  position: "relative",
  zIndex: 1,
  fontSize: 14,
  fontWeight: 800,
  lineHeight: 1,
  letterSpacing: 0.2,
};

const serverAvatarInnerStyle: CSSProperties = {
  width: 52,
  height: 52,
  borderRadius: 18,
  overflow: "hidden",
  position: "relative",
  zIndex: 1,
  flexShrink: 0,
  background: "#161b24",
  transition: "all 0.16s ease",
};

const hoverServerAvatarInnerStyle: CSSProperties = {
  borderRadius: 16,
};

const activeServerAvatarInnerStyle: CSSProperties = {
  borderRadius: 16,
  transform: "scale(1.03)",
};

const serverAvatarImageStyle: CSSProperties = {
  width: "100%",
  height: "100%",
  objectFit: "cover",
  objectPosition: "center",
  display: "block",
};

const addButtonStyle: CSSProperties = {
  ...dmButtonStyle,
  color: "#98e8b3",
  background:
    "linear-gradient(180deg, rgba(22,42,27,0.78) 0%, rgba(16,31,21,0.78) 100%)",
  border: "1px solid rgba(97,176,127,0.14)",
  boxShadow:
    "0 6px 14px rgba(0,0,0,0.14), inset 0 1px 0 rgba(255,255,255,0.04)",
};

const hoverAddButtonStyle: CSSProperties = {
  transform: "translateY(-2px) scale(1.06)",
  borderRadius: 16,
  border: "1px solid rgba(110,200,145,0.24)",
  boxShadow:
    "0 12px 26px rgba(0,0,0,0.22), inset 0 1px 0 rgba(255,255,255,0.06)",
};

const markReadButtonStyle: CSSProperties = {
  height: 26,
  minWidth: 0,
  padding: "0 10px",
  borderRadius: 999,
  border: "1px solid rgba(255,255,255,0.06)",
  background: "rgba(255,255,255,0.04)",
  color: "#cbd5e1",
  cursor: "pointer",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  backdropFilter: "blur(6px)",
  opacity: 0.7,
  transition: "all 0.18s ease",
  boxShadow: "0 4px 10px rgba(0,0,0,0.10)",
};

const markReadButtonTextStyle: CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  lineHeight: 1,
  whiteSpace: "nowrap",
  letterSpacing: 0.2,
};

const badgeStyle: CSSProperties = {
  position: "absolute",
  top: -5,
  right: -5,
  minWidth: 18,
  height: 18,
  padding: "0 5px",
  borderRadius: 999,
  background: "#ed4245",
  color: "#fff",
  fontSize: 10,
  fontWeight: 800,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  boxShadow: "0 6px 14px rgba(237,66,69,0.26)",
  border: "2px solid #10141d",
  zIndex: 5,
  lineHeight: 1,
  pointerEvents: "none",
};

const dropIndicatorStyle: CSSProperties = {
  position: "absolute",
  left: -8,
  top: "50%",
  transform: "translateY(-50%)",
  width: 3,
  height: 22,
  borderRadius: 999,
  background: "linear-gradient(180deg,#8b9cff,#6374ff)",
  boxShadow: "0 0 8px rgba(99,116,255,0.22)",
};

const overlayStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(4,6,11,0.58)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 1000,
  padding: 20,
  backdropFilter: "blur(8px)",
};

const modalCardStyle: CSSProperties = {
  position: "relative",
  width: "100%",
  maxWidth: 470,
  background:
    "linear-gradient(180deg, rgba(20,24,35,0.98), rgba(15,18,27,0.98))",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 24,
  padding: 24,
  boxShadow:
    "0 30px 90px rgba(0,0,0,0.48), inset 0 1px 0 rgba(255,255,255,0.05)",
};

const closeButtonStyle: CSSProperties = {
  position: "absolute",
  top: 14,
  right: 14,
  width: 34,
  height: 34,
  borderRadius: 999,
  border: "none",
  background: "rgba(255,255,255,0.04)",
  color: "#a7b0be",
  fontSize: 24,
  cursor: "pointer",
  lineHeight: 1,
};

const backButtonStyle: CSSProperties = {
  border: "none",
  background: "transparent",
  color: "#aab3c5",
  fontSize: 14,
  cursor: "pointer",
  padding: 0,
  marginBottom: 14,
  fontWeight: 700,
};

const modalTitleStyle: CSSProperties = {
  fontSize: 24,
  fontWeight: 800,
  color: "white",
  marginBottom: 8,
  textAlign: "center",
};

const modalTextStyle: CSSProperties = {
  fontSize: 14,
  color: "#aab3bf",
  lineHeight: 1.65,
  marginBottom: 16,
  textAlign: "center",
};

const optionButtonStyle: CSSProperties = {
  width: "100%",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  padding: "16px 16px",
  borderRadius: 18,
  border: "1px solid rgba(255,255,255,0.08)",
  background: "rgba(255,255,255,0.04)",
  color: "white",
  cursor: "pointer",
  textAlign: "left",
};

const optionTitleStyle: CSSProperties = {
  fontSize: 17,
  fontWeight: 700,
  marginBottom: 4,
};

const optionDescStyle: CSSProperties = {
  fontSize: 13,
  color: "#9ea7b5",
  lineHeight: 1.5,
};

const arrowStyle: CSSProperties = {
  color: "#8f98a6",
  fontSize: 26,
  lineHeight: 1,
};

const inputStyle: CSSProperties = {
  width: "100%",
  background: "#0f131a",
  color: "white",
  border: "1px solid #2c3340",
  borderRadius: 14,
  padding: "13px 14px",
  fontSize: 14,
  outline: "none",
  boxSizing: "border-box",
};

const errorStyle: CSSProperties = {
  marginTop: 12,
  background: "rgba(237,66,69,0.14)",
  border: "1px solid rgba(237,66,69,0.28)",
  color: "#ffb3b5",
  borderRadius: 12,
  padding: "10px 12px",
  fontSize: 13,
};

const footerActionsStyle: CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  gap: 10,
  marginTop: 18,
};

const secondaryButtonStyle: CSSProperties = {
  height: 42,
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.08)",
  background: "rgba(255,255,255,0.04)",
  color: "#d9e0ea",
  padding: "0 14px",
  cursor: "pointer",
  fontWeight: 700,
};

const primaryButtonStyle: CSSProperties = {
  height: 42,
  borderRadius: 12,
  border: "none",
  background: "linear-gradient(135deg,#5865f2,#7b8aff)",
  color: "white",
  padding: "0 16px",
  cursor: "pointer",
  fontWeight: 800,
  boxShadow: "0 12px 28px rgba(88,101,242,0.34)",
};
