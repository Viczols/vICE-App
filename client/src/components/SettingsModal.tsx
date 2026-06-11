import { useEffect, useMemo, useRef, useState } from "react";

type SettingsModalProps = {
  isOpen: boolean;
  onClose: () => void;
  currentUser: {
    id: string;
    username?: string;
    displayName: string;
    role: string;
    avatarUrl?: string | null;
  };
  blockedUsers?: Array<{
    id: string;
    username?: string;
    displayName: string;
    avatarUrl?: string | null;
  }>;
  onRefreshBlockedUsers?: () => Promise<void> | void;
  onUnblockUser?: (targetUserId: string) => Promise<void> | void;
  onLogout: () => void;
  onUserUpdated?: (nextUser: {
    displayName: string;
    avatarUrl?: string | null;
  }) => void;
};

type SettingsTab = "profile" | "audio" | "blocked" | "session";

type VoiceAudioSettings = {
  rnnoiseEnabled: boolean;
  echoCancellation: boolean;
  noiseSuppression: boolean;
  autoGainControl: boolean;
  inputSensitivityMode: "auto" | "manual";
  inputThreshold: number;
  micGain: number;
  outputVolume: number;
  inputDeviceId: string;
  outputDeviceId: string;
};

const VOICE_AUDIO_SETTINGS_STORAGE_KEY = "vice_voice_audio_settings_v1";

const DEFAULT_VOICE_AUDIO_SETTINGS: VoiceAudioSettings = {
  rnnoiseEnabled: true,
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
  inputSensitivityMode: "auto",
  inputThreshold: 0.007,
  micGain: 1,
  outputVolume: 1,
  inputDeviceId: "",
  outputDeviceId: "",
};

const INPUT_THRESHOLD_MIN = 0.002;
const INPUT_THRESHOLD_MAX = 0.012;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function thresholdToSliderValue(threshold: number) {
  const normalized =
    (clamp(threshold, INPUT_THRESHOLD_MIN, INPUT_THRESHOLD_MAX) - INPUT_THRESHOLD_MIN) /
    (INPUT_THRESHOLD_MAX - INPUT_THRESHOLD_MIN);
  return Math.round(normalized * 100);
}

function sliderValueToThreshold(sliderValue: number) {
  const normalized = clamp(sliderValue, 0, 100) / 100;
  return Number(
    (
      INPUT_THRESHOLD_MIN +
      normalized * (INPUT_THRESHOLD_MAX - INPUT_THRESHOLD_MIN)
    ).toFixed(4)
  );
}

function getSensitivityLabel(sliderValue: number) {
  if (sliderValue <= 15) return "Çok hassas";
  if (sliderValue <= 35) return "Hassas";
  if (sliderValue <= 65) return "Dengeli";
  if (sliderValue <= 85) return "Sert";
  return "Çok sert";
}

function thresholdToDb(threshold: number) {
  const normalized =
    (clamp(threshold, INPUT_THRESHOLD_MIN, INPUT_THRESHOLD_MAX) - INPUT_THRESHOLD_MIN) /
    (INPUT_THRESHOLD_MAX - INPUT_THRESHOLD_MIN);

  const curved = Math.pow(normalized, 1.18);
  return Math.round((-62 + curved * 34) * 10) / 10;
}

function AvatarPreview({
  displayName,
  avatarUrl,
  previewUrl,
  size = 82,
}: {
  displayName: string;
  avatarUrl?: string | null;
  previewUrl?: string | null;
  size?: number;
}) {
  const src = previewUrl || avatarUrl || "";

  if (src) {
    return (
      <img
        src={src}
        alt={displayName}
        style={{
          width: size,
          height: size,
          borderRadius: 999,
          objectFit: "cover",
          flexShrink: 0,
          border: "1px solid rgba(255,255,255,0.08)",
          background: "#10141a",
          boxShadow: "0 12px 28px rgba(0,0,0,0.24)",
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
        fontSize: 28,
        flexShrink: 0,
        boxShadow: "0 12px 28px rgba(88,101,242,0.24)",
      }}
    >
      {(displayName || "?").slice(0, 1).toUpperCase()}
    </div>
  );
}

function SmallAvatar({
  displayName,
  avatarUrl,
  size = 44,
}: {
  displayName: string;
  avatarUrl?: string | null;
  size?: number;
}) {
  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt={displayName}
        style={{
          width: size,
          height: size,
          borderRadius: 999,
          objectFit: "cover",
          flexShrink: 0,
          border: "1px solid rgba(255,255,255,0.08)",
          background: "#10141a",
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
        fontSize: 16,
        flexShrink: 0,
      }}
    >
      {(displayName || "?").slice(0, 1).toUpperCase()}
    </div>
  );
}

export default function SettingsModal({
  isOpen,
  onClose,
  currentUser,
  blockedUsers = [],
  onRefreshBlockedUsers,
  onUnblockUser,
  onLogout,
  onUserUpdated,
}: SettingsModalProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>("profile");
  const [displayName, setDisplayName] = useState(currentUser.displayName || "");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [unblockingUserId, setUnblockingUserId] = useState<string | null>(null);
  const [audioSettings, setAudioSettings] = useState<VoiceAudioSettings>(
    DEFAULT_VOICE_AUDIO_SETTINGS
  );
  const [audioMessage, setAudioMessage] = useState("");
  const [inputDevices, setInputDevices] = useState<MediaDeviceInfo[]>([]);
  const [outputDevices, setOutputDevices] = useState<MediaDeviceInfo[]>([]);
  const [devicePermissionError, setDevicePermissionError] = useState("");
  const [refreshingDevices, setRefreshingDevices] = useState(false);
  const audioPreviewInitializedRef = useRef(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setActiveTab("profile");
    setDisplayName(currentUser.displayName || "");
    setSelectedFile(null);
    setPreviewUrl(null);
    setMessage("");
    setError("");
    setUnblockingUserId(null);
    setAudioMessage("");
    setAudioSettings(readVoiceAudioSettings());
  }, [isOpen, currentUser.displayName, currentUser.avatarUrl]);

  useEffect(() => {
    if (!selectedFile) {
      setPreviewUrl(null);
      return;
    }

    const objectUrl = URL.createObjectURL(selectedFile);
    setPreviewUrl(objectUrl);

    return () => {
      URL.revokeObjectURL(objectUrl);
    };
  }, [selectedFile]);

  useEffect(() => {
    if (!isOpen) return;
    if (activeTab !== "blocked") return;

    Promise.resolve(onRefreshBlockedUsers?.()).catch((err) => {
      console.error("blocked users refresh in settings error:", err);
    });
  }, [isOpen, activeTab, onRefreshBlockedUsers]);

  useEffect(() => {
    if (!isOpen) return;
    void refreshAudioDevices(false);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || activeTab !== "audio") return;

    const handleDevicesChanged = () => {
      void refreshAudioDevices(false);
    };

    navigator.mediaDevices?.addEventListener?.("devicechange", handleDevicesChanged);
    return () => {
      navigator.mediaDevices?.removeEventListener?.("devicechange", handleDevicesChanged);
    };
  }, [isOpen, activeTab]);

  const token = localStorage.getItem("token");
  const previewDisplayName =
    displayName.trim() || currentUser.displayName || "User";

  const inputSensitivitySliderValue = useMemo(
    () => thresholdToSliderValue(audioSettings.inputThreshold),
    [audioSettings.inputThreshold]
  );
  const refreshAudioDevices = async (requestPermission = false) => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices) {
      setInputDevices([]);
      setOutputDevices([]);
      return;
    }

    setRefreshingDevices(true);
    try {
      if (requestPermission && navigator.mediaDevices.getUserMedia) {
        try {
          const permissionStream = await navigator.mediaDevices.getUserMedia({
            audio: true,
            video: false,
          });
          permissionStream.getTracks().forEach((track) => {
            try {
              track.stop();
            } catch {}
          });
        } catch (error) {
          console.error("audio device permission error:", error);
        }
      }

      const devices = await navigator.mediaDevices.enumerateDevices();
      const nextInputDevices = devices.filter((device) => device.kind === "audioinput");
      const nextOutputDevices = devices.filter((device) => device.kind === "audiooutput");

      setInputDevices(nextInputDevices);
      setOutputDevices(nextOutputDevices);
      setDevicePermissionError("");

      setAudioSettings((prev) => {
        const nextInputDeviceId =
          prev.inputDeviceId && nextInputDevices.some((device) => device.deviceId === prev.inputDeviceId)
            ? prev.inputDeviceId
            : nextInputDevices[0]?.deviceId || "";
        const nextOutputDeviceId =
          prev.outputDeviceId && nextOutputDevices.some((device) => device.deviceId === prev.outputDeviceId)
            ? prev.outputDeviceId
            : nextOutputDevices[0]?.deviceId || "";

        if (
          nextInputDeviceId === prev.inputDeviceId &&
          nextOutputDeviceId === prev.outputDeviceId
        ) {
          return prev;
        }

        return {
          ...prev,
          inputDeviceId: nextInputDeviceId,
          outputDeviceId: nextOutputDeviceId,
        };
      });
    } catch (error) {
      console.error("audio devices enumerate error:", error);
      setDevicePermissionError("Ses cihazları alınamadı. Tarayıcı iznini kontrol et.");
    } finally {
      setRefreshingDevices(false);
    }
  };

  const inputDeviceLabel = useMemo(() => {
    return inputDevices.find((device) => device.deviceId === audioSettings.inputDeviceId)?.label || "";
  }, [inputDevices, audioSettings.inputDeviceId]);

  const outputDeviceLabel = useMemo(() => {
    return outputDevices.find((device) => device.deviceId === audioSettings.outputDeviceId)?.label || "";
  }, [outputDevices, audioSettings.outputDeviceId]);


  const readVoiceAudioSettings = (): VoiceAudioSettings => {
    try {
      const raw = localStorage.getItem(VOICE_AUDIO_SETTINGS_STORAGE_KEY);
      if (!raw) return DEFAULT_VOICE_AUDIO_SETTINGS;

      const parsed = JSON.parse(raw);

      return {
        rnnoiseEnabled:
          typeof parsed?.rnnoiseEnabled === "boolean"
            ? parsed.rnnoiseEnabled
            : DEFAULT_VOICE_AUDIO_SETTINGS.rnnoiseEnabled,
        echoCancellation:
          typeof parsed?.echoCancellation === "boolean"
            ? parsed.echoCancellation
            : DEFAULT_VOICE_AUDIO_SETTINGS.echoCancellation,
        noiseSuppression:
          typeof parsed?.noiseSuppression === "boolean"
            ? parsed.noiseSuppression
            : DEFAULT_VOICE_AUDIO_SETTINGS.noiseSuppression,
        autoGainControl:
          typeof parsed?.autoGainControl === "boolean"
            ? parsed.autoGainControl
            : DEFAULT_VOICE_AUDIO_SETTINGS.autoGainControl,
        inputSensitivityMode:
          parsed?.inputSensitivityMode === "manual" ? "manual" : "auto",
        inputThreshold:
          typeof parsed?.inputThreshold === "number"
            ? clamp(parsed.inputThreshold, INPUT_THRESHOLD_MIN, INPUT_THRESHOLD_MAX)
            : DEFAULT_VOICE_AUDIO_SETTINGS.inputThreshold,
        micGain:
          typeof parsed?.micGain === "number"
            ? Math.min(3, Math.max(0.4, parsed.micGain))
            : DEFAULT_VOICE_AUDIO_SETTINGS.micGain,
        outputVolume:
          typeof parsed?.outputVolume === "number"
            ? Math.min(1, Math.max(0, parsed.outputVolume))
            : DEFAULT_VOICE_AUDIO_SETTINGS.outputVolume,
        inputDeviceId:
          typeof parsed?.inputDeviceId === "string"
            ? parsed.inputDeviceId
            : DEFAULT_VOICE_AUDIO_SETTINGS.inputDeviceId,
        outputDeviceId:
          typeof parsed?.outputDeviceId === "string"
            ? parsed.outputDeviceId
            : DEFAULT_VOICE_AUDIO_SETTINGS.outputDeviceId,
      };
    } catch {
      return DEFAULT_VOICE_AUDIO_SETTINGS;
    }
  };


  useEffect(() => {
    if (!isOpen) {
      audioPreviewInitializedRef.current = false;
      return;
    }

    if (!audioPreviewInitializedRef.current) {
      audioPreviewInitializedRef.current = true;
      return;
    }

    try {
      localStorage.setItem(
        VOICE_AUDIO_SETTINGS_STORAGE_KEY,
        JSON.stringify(audioSettings)
      );

      window.dispatchEvent(
        new CustomEvent("vice-voice-audio-settings-updated", {
          detail: audioSettings,
        })
      );

      setAudioMessage("Ses ayarları canlı önizleme ile uygulanıyor.");
      setError("");
    } catch {
      setError("Ses ayarları canlı uygulanamadı.");
      setAudioMessage("");
    }
  }, [audioSettings, isOpen]);

  const dirty = useMemo(() => {
    return (
      displayName.trim() !== (currentUser.displayName || "") || !!selectedFile
    );
  }, [displayName, currentUser.displayName, selectedFile]);

  const applyLocalUserUpdate = (patch: {
    displayName?: string;
    avatarUrl?: string | null;
  }) => {
    const nextUser = {
      ...currentUser,
      displayName: patch.displayName ?? currentUser.displayName,
      avatarUrl:
        patch.avatarUrl !== undefined
          ? patch.avatarUrl
          : currentUser.avatarUrl ?? null,
    };

    try {
      const raw = localStorage.getItem("auth_user");
      const parsed = raw ? JSON.parse(raw) : {};
      localStorage.setItem(
        "auth_user",
        JSON.stringify({
          ...parsed,
          ...nextUser,
        })
      );
    } catch {}

    onUserUpdated?.({
      displayName: nextUser.displayName,
      avatarUrl: nextUser.avatarUrl,
    });

    window.dispatchEvent(
      new CustomEvent("vice-user-updated", {
        detail: nextUser,
      })
    );
  };

  const handleFileChange = (file: File | null) => {
    if (!file) {
      setSelectedFile(null);
      setError("");
      return;
    }

    const allowedTypes = [
      "image/png",
      "image/jpeg",
      "image/jpg",
      "image/webp",
    ];

    if (!allowedTypes.includes(file.type)) {
      setError("Sadece PNG, JPG, JPEG veya WEBP yükleyebilirsin.");
      setMessage("");
      return;
    }

    const maxSizeMb = 4;
    if (file.size > maxSizeMb * 1024 * 1024) {
      setError("Profil resmi en fazla 4 MB olabilir.");
      setMessage("");
      return;
    }

    setError("");
    setSelectedFile(file);
  };

  const saveProfile = async () => {
  const trimmedDisplayName = displayName.trim();

  if (!trimmedDisplayName || trimmedDisplayName.length < 2) {
    setError("Display name en az 2 karakter olmalı.");
    setMessage("");
    return;
  }

  if (!token) {
    setError("Oturum bulunamadı.");
    setMessage("");
    return;
  }

  try {
    setSaving(true);
    setError("");
    setMessage("");

    let nextDisplayName = trimmedDisplayName;
    let nextAvatarUrl = currentUser.avatarUrl ?? null;

    const profileRes = await fetch("http://localhost:3001/profile/me", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        displayName: trimmedDisplayName,
      }),
    });

    const profileData = await profileRes.json().catch(() => null);
    if (!profileRes.ok) {
      throw new Error(profileData?.error || "Profil güncellenemedi.");
    }

    nextDisplayName = profileData?.user?.displayName ?? trimmedDisplayName;
    nextAvatarUrl = profileData?.user?.avatarUrl ?? nextAvatarUrl;

    if (selectedFile) {
      const formData = new FormData();
      formData.append("avatar", selectedFile);

      const avatarRes = await fetch("http://localhost:3001/profile/avatar", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: formData,
      });

      const avatarData = await avatarRes.json().catch(() => null);
      if (!avatarRes.ok) {
        throw new Error(avatarData?.error || "Profil resmi yüklenemedi.");
      }

      nextDisplayName = avatarData?.user?.displayName ?? nextDisplayName;
      nextAvatarUrl =
        avatarData?.user?.avatarUrl ??
        avatarData?.avatarUrl ??
        nextAvatarUrl;
    }

    applyLocalUserUpdate({
      displayName: nextDisplayName,
      avatarUrl: nextAvatarUrl,
    });

    setSelectedFile(null);
    setMessage("Profil başarıyla güncellendi.");
  } catch (err: any) {
    setError(err?.message || "Profil güncellenemedi.");
    setMessage("");
  } finally {
    setSaving(false);
  }
};


  const updateAudioSetting = <K extends keyof VoiceAudioSettings>(
    key: K,
    value: VoiceAudioSettings[K]
  ) => {
    setAudioSettings((prev) => ({
      ...prev,
      [key]: value,
    }));
  };

  const saveAudioSettings = () => {
    try {
      localStorage.setItem(
        VOICE_AUDIO_SETTINGS_STORAGE_KEY,
        JSON.stringify(audioSettings)
      );

      window.dispatchEvent(
        new CustomEvent("vice-voice-audio-settings-updated", {
          detail: audioSettings,
        })
      );

      setAudioMessage("Ses ayarları kaydedildi.");
      setError("");
    } catch {
      setError("Ses ayarları kaydedilemedi.");
      setAudioMessage("");
    }
  };

  const resetAudioSettings = () => {
    setAudioSettings(DEFAULT_VOICE_AUDIO_SETTINGS);
    setAudioMessage("");
  };

  const handleUnblockUser = async (targetUserId: string) => {
    if (!onUnblockUser) return;

    try {
      setUnblockingUserId(targetUserId);
      setError("");
      setMessage("");
      await onUnblockUser(targetUserId);
      await Promise.resolve(onRefreshBlockedUsers?.());
      setMessage("Kullanıcının engeli kaldırıldı.");
    } catch (err: any) {
      setError(err?.message || "Engel kaldırılamadı.");
    } finally {
      setUnblockingUserId(null);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(4,8,14,0.64)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1450,
        padding: 28,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 980,
          background: "linear-gradient(180deg,#171b22,#13171d)",
          border: "1px solid rgba(255,255,255,0.06)",
          borderRadius: 30,
          boxShadow: "0 30px 90px rgba(0,0,0,0.32)",
          overflow: "hidden",
          display: "grid",
          gridTemplateColumns: "250px minmax(0,1fr)",
          height: "82vh",
          maxHeight: "82vh",
          backdropFilter: "blur(16px)",
        }}
      >
        <div
          style={{
            borderRight: "1px solid rgba(255,255,255,0.06)",
            background:
              "linear-gradient(180deg,rgba(255,255,255,0.02),rgba(255,255,255,0.01))",
            padding: 22,
            display: "flex",
            flexDirection: "column",
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
              Ayarlar
            </div>

            <div
              style={{
                fontSize: 13,
                color: "#98a2b0",
                marginTop: 4,
                lineHeight: 1.5,
              }}
            >
              Profilini, ses ayarlarını, engellenenleri ve oturumunu buradan yönet.
            </div>
          </div>

          <div
            style={{
              borderRadius: 18,
              padding: 14,
              background:
                "linear-gradient(180deg,rgba(255,255,255,0.035),rgba(255,255,255,0.02))",
              border: "1px solid rgba(255,255,255,0.06)",
              display: "flex",
              alignItems: "center",
              gap: 12,
            }}
          >
            <AvatarPreview
              displayName={previewDisplayName}
              avatarUrl={currentUser.avatarUrl}
              previewUrl={previewUrl}
              size={56}
            />

            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  fontSize: 16,
                  fontWeight: 800,
                  color: "white",
                  marginBottom: 4,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {previewDisplayName}
              </div>

              <div
                style={{
                  fontSize: 13,
                  color: "#a3adba",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                @{currentUser.username || ""}
              </div>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <button
              onClick={() => setActiveTab("profile")}
              style={{
                ...sideButtonStyle,
                ...(activeTab === "profile" ? activeSideButtonStyle : {}),
              }}
            >
              Profil
            </button>

            <button
              onClick={() => setActiveTab("audio")}
              style={{
                ...sideButtonStyle,
                ...(activeTab === "audio" ? activeSideButtonStyle : {}),
              }}
            >
              Ses ve Mikrofon
            </button>

            <button
              onClick={() => setActiveTab("blocked")}
              style={{
                ...sideButtonStyle,
                ...(activeTab === "blocked" ? activeSideButtonStyle : {}),
              }}
            >
              Engellenenler
              {blockedUsers.length > 0 && (
                <span style={badgeStyle}>{blockedUsers.length}</span>
              )}
            </button>

            <button
              onClick={() => setActiveTab("session")}
              style={{
                ...sideButtonStyle,
                ...(activeTab === "session" ? activeSideButtonStyle : {}),
              }}
            >
              Oturum
            </button>
          </div>
        </div>

        <div style={{ minWidth: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div
            style={{
              padding: "22px 24px",
              borderBottom: "1px solid rgba(255,255,255,0.06)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 14,
            }}
          >
            <div
              style={{
                fontSize: 18,
                fontWeight: 800,
                color: "white",
              }}
            >
              {activeTab === "profile"
                ? "Profil"
                : activeTab === "audio"
                ? "Ses ve Mikrofon"
                : activeTab === "blocked"
                ? "Engellenenler"
                : "Oturum"}
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

          <div
            style={{
              padding: 24,
              display: "flex",
              flexDirection: "column",
              gap: 18,
              flex: 1,
              minHeight: 0,
              overflowY: "auto",
            }}
          >
            {activeTab === "profile" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 18, minHeight: "100%" }}>
                <div
                  style={{
                    borderRadius: 22,
                    padding: 20,
                    background:
                      "linear-gradient(180deg,rgba(255,255,255,0.035),rgba(255,255,255,0.02))",
                    border: "1px solid rgba(255,255,255,0.06)",
                    display: "flex",
                    alignItems: "center",
                    gap: 14,
                  }}
                >
                  <AvatarPreview
                    displayName={previewDisplayName}
                    avatarUrl={currentUser.avatarUrl}
                    previewUrl={previewUrl}
                  />

                  <div style={{ minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 18,
                        fontWeight: 800,
                        color: "white",
                        marginBottom: 6,
                      }}
                    >
                      {previewDisplayName}
                    </div>

                    <div
                      style={{
                        fontSize: 14,
                        color: "#a3adba",
                        marginBottom: 4,
                      }}
                    >
                      @{currentUser.username || ""}
                    </div>

                    <div
                      style={{
                        fontSize: 13,
                        color: "#7f8794",
                      }}
                    >
                      Rol: {currentUser.role}
                    </div>
                  </div>
                </div>

                <div
                  style={{
                    borderRadius: 22,
                    padding: 20,
                    flex: 1,
                    background:
                      "linear-gradient(180deg,rgba(255,255,255,0.035),rgba(255,255,255,0.02))",
                    border: "1px solid rgba(255,255,255,0.06)",
                    display: "flex",
                    flexDirection: "column",
                    gap: 14,
                  }}
                >
                  <div
                    style={{
                      fontSize: 12,
                      textTransform: "uppercase",
                      letterSpacing: 1,
                      color: "#8f98a6",
                      fontWeight: 800,
                    }}
                  >
                    Profil
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <label
                      style={{
                        fontSize: 13,
                        color: "#c9d2df",
                        fontWeight: 700,
                      }}
                    >
                      Display Name
                    </label>
                    <input
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      placeholder="Görünen ad"
                      style={textInputStyle}
                    />
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <label
                      style={{
                        fontSize: 13,
                        color: "#c9d2df",
                        fontWeight: 700,
                      }}
                    >
                      Profil Resmi
                    </label>

                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/png,image/jpeg,image/jpg,image/webp"
                      onChange={(e) => handleFileChange(e.target.files?.[0] || null)}
                      style={{ display: "none" }}
                    />

                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        flexWrap: "wrap",
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        style={secondaryButtonStyle}
                      >
                        Dosya Seç
                      </button>

                      {selectedFile ? (
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedFile(null);
                            setError("");
                          }}
                          style={dangerGhostButtonStyle}
                        >
                          Seçimi Temizle
                        </button>
                      ) : null}

                      <div
                        style={{
                          fontSize: 12,
                          color: "#8f98a6",
                        }}
                      >
                        PNG, JPG, JPEG, WEBP • Maks 4 MB
                      </div>
                    </div>

                    <div
                      style={{
                        minHeight: 18,
                        fontSize: 13,
                        color: selectedFile ? "#d8e0ea" : "#7f8794",
                      }}
                    >
                      {selectedFile
                        ? `Seçilen dosya: ${selectedFile.name}`
                        : "Henüz yeni profil resmi seçilmedi."}
                    </div>
                  </div>

                  {error ? <div style={errorBoxStyle}>{error}</div> : null}
                  {message ? <div style={successBoxStyle}>{message}</div> : null}

                  <div style={{ display: "flex", justifyContent: "flex-end" }}>
                    <button
                      onClick={saveProfile}
                      disabled={!dirty || saving}
                      style={{
                        ...primaryButtonStyle,
                        background:
                          !dirty || saving
                            ? "rgba(88,101,242,0.34)"
                            : "linear-gradient(135deg,#5865f2,#7b8aff)",
                        cursor: !dirty || saving ? "not-allowed" : "pointer",
                        boxShadow:
                          !dirty || saving
                            ? "none"
                            : "0 10px 24px rgba(88,101,242,0.24)",
                        opacity: !dirty || saving ? 0.72 : 1,
                      }}
                    >
                      {saving ? "Kaydediliyor." : "Profili Kaydet"}
                    </button>
                  </div>
                </div>
              </div>
            )}


            {activeTab === "audio" && (
              <>
                <div
                  style={{
                    borderRadius: 22,
                    padding: 20,
                    background:
                      "linear-gradient(180deg,rgba(255,255,255,0.035),rgba(255,255,255,0.02))",
                    border: "1px solid rgba(255,255,255,0.06)",
                    display: "flex",
                    flexDirection: "column",
                    gap: 14,
                  }}
                >
                  <div
                    style={{
                      fontSize: 12,
                      textTransform: "uppercase",
                      letterSpacing: 1,
                      color: "#8f98a6",
                      fontWeight: 800,
                    }}
                  >
                    Cihaz seçimi
                  </div>

                  <div
                    style={{
                      fontSize: 13,
                      color: "#9aa3b2",
                      lineHeight: 1.6,
                    }}
                  >
                    Buradan kullanılacak mikrofonu ve ses çıkışını seçebilirsin. Değişiklikler canlı uygulanır.
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12 }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      <label style={settingTitleStyle}>Mikrofon Girişi</label>
                      <select
                        value={audioSettings.inputDeviceId}
                        onChange={(e) => updateAudioSetting("inputDeviceId", e.target.value)}
                        style={selectInputStyle}
                      >
                        {inputDevices.length === 0 ? (
                          <option value="">Varsayılan mikrofon</option>
                        ) : (
                          inputDevices.map((device, index) => (
                            <option key={device.deviceId || `input-${index}`} value={device.deviceId}>
                              {device.label || `Mikrofon ${index + 1}`}
                            </option>
                          ))
                        )}
                      </select>
                      <div style={settingHintStyle}>
                        {inputDeviceLabel || "Tarayıcının varsayılan mikrofonu kullanılacak."}
                      </div>
                    </div>

                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      <label style={settingTitleStyle}>Kulaklık / Ses Çıkışı</label>
                      <select
                        value={audioSettings.outputDeviceId}
                        onChange={(e) => updateAudioSetting("outputDeviceId", e.target.value)}
                        style={selectInputStyle}
                      >
                        {outputDevices.length === 0 ? (
                          <option value="">Varsayılan çıkış</option>
                        ) : (
                          outputDevices.map((device, index) => (
                            <option key={device.deviceId || `output-${index}`} value={device.deviceId}>
                              {device.label || `Çıkış ${index + 1}`}
                            </option>
                          ))
                        )}
                      </select>
                      <div style={settingHintStyle}>
                        {outputDeviceLabel || "Tarayıcının varsayılan ses çıkışı kullanılacak."}
                      </div>
                    </div>
                  </div>

                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 12,
                      flexWrap: "wrap",
                    }}
                  >
                    <div
                      style={{
                        ...settingHintStyle,
                        marginTop: 0,
                        color: devicePermissionError ? "#ffb4b4" : "#8f98a6",
                      }}
                    >
                      {devicePermissionError ||
                        (refreshingDevices
                          ? "Ses cihazları otomatik yenileniyor..."
                          : "Kulaklık veya mikrofon değiştiğinde liste otomatik güncellenir.")}
                    </div>
                  </div>
                </div>

                <div
                  style={{
                    borderRadius: 22,
                    padding: 20,
                    background:
                      "linear-gradient(180deg,rgba(255,255,255,0.035),rgba(255,255,255,0.02))",
                    border: "1px solid rgba(255,255,255,0.06)",
                    display: "flex",
                    flexDirection: "column",
                    gap: 14,
                  }}
                >
                  <div
                    style={{
                      fontSize: 12,
                      textTransform: "uppercase",
                      letterSpacing: 1,
                      color: "#8f98a6",
                      fontWeight: 800,
                    }}
                  >
                    Ses işleme
                  </div>

                  <div
                    style={{
                      fontSize: 13,
                      color: "#9aa3b2",
                      lineHeight: 1.6,
                    }}
                  >
                    Bu ayarlar VoicePanel içindeki işlenmiş mikrofon hattını kontrol eder. Bu ekrandaki değişiklikler artık canlı önizleme olarak hemen uygulanır; Kaydet butonu da mevcut ayarı sabitlemek için kalır.
                  </div>

                  <div style={switchRowStyle}>
                    <div style={{ minWidth: 0 }}>
                      <div style={settingTitleStyle}>RNNoise Gürültü Engelleme</div>
                      <div style={settingHintStyle}>
                        En iyi temel temizlik. Açık kalması önerilir.
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() =>
                        updateAudioSetting("rnnoiseEnabled", !audioSettings.rnnoiseEnabled)
                      }
                      style={{
                        ...toggleButtonStyle,
                        ...(audioSettings.rnnoiseEnabled
                          ? activeToggleButtonStyle
                          : inactiveToggleButtonStyle),
                      }}
                    >
                      {audioSettings.rnnoiseEnabled ? "Açık" : "Kapalı"}
                    </button>
                  </div>

                  <div style={switchRowStyle}>
                    <div style={{ minWidth: 0 }}>
                      <div style={settingTitleStyle}>Echo Cancellation</div>
                      <div style={settingHintStyle}>
                        Hoparlör geri dönüşünü azaltır. Kulaklık kullanıyorsan kapalı bırakabilirsin.
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() =>
                        updateAudioSetting(
                          "echoCancellation",
                          !audioSettings.echoCancellation
                        )
                      }
                      style={{
                        ...toggleButtonStyle,
                        ...(audioSettings.echoCancellation
                          ? activeToggleButtonStyle
                          : inactiveToggleButtonStyle),
                      }}
                    >
                      {audioSettings.echoCancellation ? "Açık" : "Kapalı"}
                    </button>
                  </div>

                  <div style={switchRowStyle}>
                    <div style={{ minWidth: 0 }}>
                      <div style={settingTitleStyle}>Browser Noise Suppression</div>
                      <div style={settingHintStyle}>
                        RNNoise ile birlikte bazen sesi fazla boğabilir. Gerekirse aç.
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() =>
                        updateAudioSetting(
                          "noiseSuppression",
                          !audioSettings.noiseSuppression
                        )
                      }
                      style={{
                        ...toggleButtonStyle,
                        ...(audioSettings.noiseSuppression
                          ? activeToggleButtonStyle
                          : inactiveToggleButtonStyle),
                      }}
                    >
                      {audioSettings.noiseSuppression ? "Açık" : "Kapalı"}
                    </button>
                  </div>

                  <div style={switchRowStyle}>
                    <div style={{ minWidth: 0 }}>
                      <div style={settingTitleStyle}>Auto Gain Control</div>
                      <div style={settingHintStyle}>
                        Mikrofon seviyesini tarayıcı ayarlar. Patlama olursa kapalı bırakman daha iyi olabilir.
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() =>
                        updateAudioSetting(
                          "autoGainControl",
                          !audioSettings.autoGainControl
                        )
                      }
                      style={{
                        ...toggleButtonStyle,
                        ...(audioSettings.autoGainControl
                          ? activeToggleButtonStyle
                          : inactiveToggleButtonStyle),
                      }}
                    >
                      {audioSettings.autoGainControl ? "Açık" : "Kapalı"}
                    </button>
                  </div>
                </div>

                <div
                  style={{
                    borderRadius: 22,
                    padding: 20,
                    background:
                      "linear-gradient(180deg,rgba(255,255,255,0.035),rgba(255,255,255,0.02))",
                    border: "1px solid rgba(255,255,255,0.06)",
                    display: "flex",
                    flexDirection: "column",
                    gap: 16,
                  }}
                >
                  <div
                    style={{
                      fontSize: 12,
                      textTransform: "uppercase",
                      letterSpacing: 1,
                      color: "#8f98a6",
                      fontWeight: 800,
                    }}
                  >
                    Giriş hassasiyeti
                  </div>

                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                    <button
                      type="button"
                      onClick={() =>
                        updateAudioSetting("inputSensitivityMode", "auto")
                      }
                      style={{
                        ...modeChipStyle,
                        ...(audioSettings.inputSensitivityMode === "auto"
                          ? activeModeChipStyle
                          : {}),
                      }}
                    >
                      Otomatik
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        updateAudioSetting("inputSensitivityMode", "manual")
                      }
                      style={{
                        ...modeChipStyle,
                        ...(audioSettings.inputSensitivityMode === "manual"
                          ? activeModeChipStyle
                          : {}),
                      }}
                    >
                      Manuel
                    </button>
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    <div style={sliderHeaderStyle}>
                      <span style={settingTitleStyle}>Giriş Hassasiyeti</span>
                      <span style={sliderValueStyle}>
                        {audioSettings.inputSensitivityMode === "manual"
                          ? `${inputSensitivitySliderValue}/100 • ${getSensitivityLabel(
                              inputSensitivitySliderValue
                            )} • ${thresholdToDb(audioSettings.inputThreshold).toFixed(1)} dB`
                          : "AUTO"}
                      </span>
                    </div>

                    <input
                      type="range"
                      min="0"
                      max="100"
                      step="1"
                      value={inputSensitivitySliderValue}
                      disabled={audioSettings.inputSensitivityMode !== "manual"}
                      onChange={(e) =>
                        updateAudioSetting(
                          "inputThreshold",
                          sliderValueToThreshold(Number(e.target.value))
                        )
                      }
                      style={{
                        ...rangeInputStyle,
                        opacity:
                          audioSettings.inputSensitivityMode === "manual" ? 1 : 0.55,
                        cursor:
                          audioSettings.inputSensitivityMode === "manual"
                            ? "pointer"
                            : "not-allowed",
                      }}
                    />

                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 10,
                        fontSize: 11,
                        color: "#7f8794",
                        fontWeight: 700,
                      }}
                    >
                      <span>0 • En hassas • -62 dB</span>
                      <span>50 • Dengeli • ~-47 dB</span>
                      <span>100 • En sert • -28 dB</span>
                    </div>

                    <div style={settingHintStyle}>
                      Bu ayar mikrofon sesini yükseltmez. Sadece mikrofonun hangi seviyeden sonra sesi konuşma sayacağını belirler. Sağa gittikçe eşik yükselir ve nefes/ortam sesi daha sert kesilir. Manuel modda mevcut eşik {audioSettings.inputThreshold.toFixed(4)} ve yaklaşık {thresholdToDb(audioSettings.inputThreshold).toFixed(1)} dB. Artık bu kaydırıcıyı oynattığında etkiyi anında duyman gerekir.
                    </div>
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    <div style={sliderHeaderStyle}>
                      <span style={settingTitleStyle}>Mic Ses Seviyesi</span>
                      <span style={sliderValueStyle}>
                        {audioSettings.micGain.toFixed(2)}x
                      </span>
                    </div>

                    <input
                      type="range"
                      min="0.4"
                      max="3"
                      step="0.05"
                      value={audioSettings.micGain}
                      onChange={(e) =>
                        updateAudioSetting("micGain", Number(e.target.value))
                      }
                      style={rangeInputStyle}
                    />

                    <div style={settingHintStyle}>
                      Bu ayar sadece senin gönderdiğin sesin seviyesini değiştirir.
                    </div>
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    <div style={sliderHeaderStyle}>
                      <span style={settingTitleStyle}>Kulaklık Ses Seviyesi</span>
                      <span style={sliderValueStyle}>
                        %{Math.round(audioSettings.outputVolume * 100)}
                      </span>
                    </div>

                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.01"
                      value={audioSettings.outputVolume}
                      onChange={(e) =>
                        updateAudioSetting("outputVolume", Number(e.target.value))
                      }
                      style={rangeInputStyle}
                    />

                    <div style={settingHintStyle}>
                      Odadaki diğer kişilerin sana geliş ses seviyesini ayarlar.
                    </div>
                  </div>

                  <div
                    style={{
                      borderRadius: 14,
                      padding: "12px 14px",
                      background: "rgba(255,255,255,0.03)",
                      border: "1px solid rgba(255,255,255,0.05)",
                      display: "flex",
                      flexDirection: "column",
                      gap: 6,
                    }}
                  >
                    <div style={settingTitleStyle}>Önerilen başlangıç</div>
                    <div style={settingHintStyle}>
                      RNNoise açık, Auto Gain kapalı, Noise Suppression kapalı, hassasiyet manuel ve 40 - 60 aralığı çoğu mikrofonda iyi başlar.
                    </div>
                  </div>

                  {error ? <div style={errorBoxStyle}>{error}</div> : null}
                  {audioMessage ? <div style={successBoxStyle}>{audioMessage}</div> : null}

                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 12,
                      flexWrap: "wrap",
                    }}
                  >
                    <button
                      type="button"
                      onClick={resetAudioSettings}
                      style={secondaryButtonStyle}
                    >
                      Varsayılana Dön
                    </button>

                    <button
                      type="button"
                      onClick={saveAudioSettings}
                      style={{
                        ...primaryButtonStyle,
                        background: "linear-gradient(135deg,#5865f2,#7b8aff)",
                        cursor: "pointer",
                        boxShadow: "0 10px 24px rgba(88,101,242,0.24)",
                      }}
                    >
                      Ses Ayarlarını Kaydet
                    </button>
                  </div>
                </div>
              </>
            )}

            {activeTab === "blocked" && (
              <div
                style={{
                  borderRadius: 18,
                  padding: 16,
                  background:
                    "linear-gradient(180deg,rgba(255,255,255,0.035),rgba(255,255,255,0.02))",
                  border: "1px solid rgba(255,255,255,0.06)",
                  display: "flex",
                  flexDirection: "column",
                  gap: 14,
                  minHeight: "100%",
                }}
              >
                <div
                  style={{
                    fontSize: 12,
                    textTransform: "uppercase",
                    letterSpacing: 1,
                    color: "#8f98a6",
                    fontWeight: 800,
                  }}
                >
                  Engellenen kullanıcılar
                </div>

                <div
                  style={{
                    fontSize: 13,
                    color: "#9aa3b2",
                    lineHeight: 1.6,
                  }}
                >
                  Burada engellediğin kullanıcıları görebilir ve istersen engellerini kaldırabilirsin.
                </div>

                {error ? <div style={errorBoxStyle}>{error}</div> : null}
                {message ? <div style={successBoxStyle}>{message}</div> : null}

                {blockedUsers.length === 0 ? (
                  <div
                    style={{
                      borderRadius: 16,
                      padding: "14px 16px",
                      background: "rgba(255,255,255,0.03)",
                      border: "1px solid rgba(255,255,255,0.05)",
                      color: "#8f98a6",
                      fontSize: 13,
                    }}
                  >
                    Şu anda engellenmiş kullanıcı bulunmuyor.
                  </div>
                ) : (
                  blockedUsers.map((user) => (
                    <div
                      key={user.id}
                      style={{
                        borderRadius: 16,
                        padding: 14,
                        background: "rgba(255,255,255,0.03)",
                        border: "1px solid rgba(255,255,255,0.05)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 12,
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 12,
                          minWidth: 0,
                        }}
                      >
                        <SmallAvatar
                          displayName={user.displayName}
                          avatarUrl={user.avatarUrl}
                        />

                        <div style={{ minWidth: 0 }}>
                          <div
                            style={{
                              fontSize: 14,
                              fontWeight: 800,
                              color: "white",
                              whiteSpace: "nowrap",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                            }}
                          >
                            {user.displayName}
                          </div>

                          <div
                            style={{
                              fontSize: 12,
                              color: "#8f98a6",
                              marginTop: 3,
                              whiteSpace: "nowrap",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                            }}
                          >
                            @{user.username || "user"}
                          </div>
                        </div>
                      </div>

                      <button
                        onClick={() => void handleUnblockUser(user.id)}
                        disabled={unblockingUserId === user.id}
                        style={{
                          ...dangerGhostButtonStyle,
                          minWidth: 128,
                          justifyContent: "center",
                          cursor:
                            unblockingUserId === user.id
                              ? "not-allowed"
                              : "pointer",
                          opacity: unblockingUserId === user.id ? 0.72 : 1,
                        }}
                      >
                        {unblockingUserId === user.id
                          ? "Kaldırılıyor..."
                          : "Engeli Kaldır"}
                      </button>
                    </div>
                  ))
                )}
              </div>
            )}

            {activeTab === "session" && (
              <div
                style={{
                  borderRadius: 22,
                  padding: 20,
                  background:
                    "linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.018))",
                  border: "1px solid rgba(255,255,255,0.06)",
                  minHeight: "100%",
                }}
              >
                <div
                  style={{
                    fontSize: 12,
                    textTransform: "uppercase",
                    letterSpacing: 1,
                    color: "#8f98a6",
                    fontWeight: 800,
                    marginBottom: 12,
                  }}
                >
                  Oturum
                </div>

                <div
                  style={{
                    fontSize: 13,
                    color: "#9aa3b2",
                    lineHeight: 1.6,
                    marginBottom: 14,
                  }}
                >
                  Hesabından çıkış yaparak mevcut oturumunu sonlandırabilirsin.
                </div>

                <button onClick={onLogout} style={logoutButtonStyle}>
                  Logout
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

const sideButtonStyle: React.CSSProperties = {
  width: "100%",
  height: 48,
  borderRadius: 16,
  border: "1px solid rgba(255,255,255,0.07)",
  background: "linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.025))",
  color: "#d6deea",
  cursor: "pointer",
  fontWeight: 800,
  fontSize: 13,
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "0 16px",
};

const activeSideButtonStyle: React.CSSProperties = {
  background: "linear-gradient(135deg, rgba(88,101,242,0.24), rgba(123,138,255,0.12))",
  border: "1px solid rgba(123,138,255,0.22)",
  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.05), 0 12px 30px rgba(30,45,90,0.18)",
  color: "#ffffff",
};

const badgeStyle: React.CSSProperties = {
  minWidth: 20,
  height: 20,
  borderRadius: 999,
  padding: "0 6px",
  background: "rgba(88,101,242,0.24)",
  color: "white",
  fontSize: 11,
  fontWeight: 800,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
};

const textInputStyle: React.CSSProperties = {
  height: 48,
  borderRadius: 16,
  border: "1px solid rgba(255,255,255,0.08)",
  background: "rgba(8,12,18,0.82)",
  color: "white",
  padding: "0 14px",
  outline: "none",
  fontSize: 14,
};


const selectInputStyle: React.CSSProperties = {
  ...textInputStyle,
  cursor: "pointer",
  appearance: "none",
  WebkitAppearance: "none",
  MozAppearance: "none",
  paddingRight: 40,
};

const primaryButtonStyle: React.CSSProperties = {
  height: 46,
  borderRadius: 16,
  border: "1px solid rgba(88,101,242,0.16)",
  color: "white",
  padding: "0 18px",
  fontWeight: 800,
  fontSize: 13,
};

const secondaryButtonStyle: React.CSSProperties = {
  height: 44,
  borderRadius: 15,
  border: "1px solid rgba(255,255,255,0.09)",
  background: "rgba(255,255,255,0.05)",
  color: "white",
  padding: "0 16px",
  fontWeight: 800,
  fontSize: 13,
  cursor: "pointer",
};

const dangerGhostButtonStyle: React.CSSProperties = {
  height: 44,
  borderRadius: 15,
  border: "1px solid rgba(237,66,69,0.18)",
  background: "rgba(237,66,69,0.08)",
  color: "#ffd4d5",
  padding: "0 16px",
  fontWeight: 800,
  fontSize: 13,
  cursor: "pointer",
  display: "inline-flex",
  alignItems: "center",
};

const logoutButtonStyle: React.CSSProperties = {
  height: 46,
  borderRadius: 16,
  border: "1px solid rgba(237,66,69,0.22)",
  background: "linear-gradient(135deg, #ed4245, #ff686b)",
  color: "white",
  padding: "0 16px",
  fontWeight: 800,
  fontSize: 13,
  cursor: "pointer",
  boxShadow: "0 10px 20px rgba(237,66,69,0.18)",
};


const switchRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 14,
  flexWrap: "wrap",
  padding: "14px 16px",
  borderRadius: 18,
  background: "linear-gradient(180deg, rgba(255,255,255,0.035), rgba(255,255,255,0.02))",
  border: "1px solid rgba(255,255,255,0.05)",
};

const settingTitleStyle: React.CSSProperties = {
  fontSize: 13,
  color: "#e8eef8",
  fontWeight: 800,
};

const settingHintStyle: React.CSSProperties = {
  fontSize: 12,
  color: "#8f98a6",
  lineHeight: 1.55,
  marginTop: 4,
};

const toggleButtonStyle: React.CSSProperties = {
  minWidth: 78,
  height: 38,
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.08)",
  padding: "0 14px",
  fontWeight: 800,
  fontSize: 12,
  cursor: "pointer",
};

const activeToggleButtonStyle: React.CSSProperties = {
  background: "linear-gradient(135deg,#5865f2,#7b8aff)",
  color: "white",
  boxShadow: "0 10px 24px rgba(88,101,242,0.22)",
};

const inactiveToggleButtonStyle: React.CSSProperties = {
  background: "rgba(255,255,255,0.04)",
  color: "#c9d2df",
};

const modeChipStyle: React.CSSProperties = {
  height: 38,
  borderRadius: 999,
  border: "1px solid rgba(255,255,255,0.08)",
  background: "rgba(255,255,255,0.04)",
  color: "#c9d2df",
  padding: "0 16px",
  fontWeight: 800,
  fontSize: 12,
  cursor: "pointer",
};

const activeModeChipStyle: React.CSSProperties = {
  background: "linear-gradient(135deg, rgba(88,101,242,0.18), rgba(123,138,255,0.10))",
  border: "1px solid rgba(88,101,242,0.24)",
  color: "#ffffff",
};

const sliderHeaderStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
};

const sliderValueStyle: React.CSSProperties = {
  fontSize: 12,
  color: "#bfc8d6",
  fontWeight: 800,
};

const rangeInputStyle: React.CSSProperties = {
  width: "100%",
  accentColor: "#7b8aff",
  cursor: "pointer",
};

const errorBoxStyle: React.CSSProperties = {
  borderRadius: 14,
  padding: "10px 12px",
  background: "rgba(237,66,69,0.1)",
  border: "1px solid rgba(237,66,69,0.18)",
  color: "#ffb4b6",
  fontSize: 13,
  fontWeight: 700,
};

const successBoxStyle: React.CSSProperties = {
  borderRadius: 14,
  padding: "10px 12px",
  background: "rgba(59,165,93,0.12)",
  border: "1px solid rgba(59,165,93,0.2)",
  color: "#c8f7d3",
  fontSize: 13,
  fontWeight: 700,
};
