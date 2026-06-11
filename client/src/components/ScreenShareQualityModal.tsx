import React from "react";

type ScreenShareResolution = "720p" | "1080p";
type ScreenShareFps = 30 | 60;

type ScreenShareQualityModalProps = {
  open: boolean;
  isStarting?: boolean;
  resolution: ScreenShareResolution;
  fps: ScreenShareFps;
  shareSystemAudio: boolean;
  onClose: () => void;
  onResolutionChange: (value: ScreenShareResolution) => void;
  onFpsChange: (value: ScreenShareFps) => void;
  onShareSystemAudioChange: (value: boolean) => void;
  onConfirm: () => void;
};

function SegmentedOption<T extends string | number>({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        flex: 1,
        height: 48,
        borderRadius: 14,
        border: active
          ? "1px solid rgba(123,138,255,0.42)"
          : "1px solid rgba(255,255,255,0.08)",
        background: active
          ? "linear-gradient(135deg, rgba(88,101,242,0.34), rgba(123,138,255,0.22))"
          : "rgba(255,255,255,0.03)",
        color: active ? "#ffffff" : "#cfd7e3",
        fontWeight: 800,
        fontSize: 14,
        cursor: "pointer",
        transition: "all 160ms ease",
      }}
    >
      {label}
    </button>
  );
}

export default function ScreenShareQualityModal({
  open,
  isStarting = false,
  resolution,
  fps,
  shareSystemAudio,
  onClose,
  onResolutionChange,
  onFpsChange,
  onShareSystemAudioChange,
  onConfirm,
}: ScreenShareQualityModalProps) {
  if (!open) return null;

  const currentPresetLabel = `${resolution} • ${fps} FPS${shareSystemAudio ? " • Ses Açık" : ""}`;

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 2000,
        background: "rgba(3, 6, 12, 0.72)",
        backdropFilter: "blur(10px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
        boxSizing: "border-box",
      }}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        style={{
          width: "min(760px, 100%)",
          borderRadius: 24,
          overflow: "hidden",
          border: "1px solid rgba(255,255,255,0.08)",
          background:
            "linear-gradient(180deg, rgba(17,20,29,0.98), rgba(13,16,24,0.98))",
          boxShadow: "0 24px 80px rgba(0,0,0,0.45)",
        }}
      >
        <div
          style={{
            padding: "18px 22px",
            borderBottom: "1px solid rgba(255,255,255,0.06)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <div>
            <div
              style={{
                color: "#ffffff",
                fontWeight: 900,
                fontSize: 20,
              }}
            >
              Ekran paylaşımı
            </div>
            <div
              style={{
                color: "#99a4b5",
                fontSize: 13,
                marginTop: 4,
                lineHeight: 1.5,
              }}
            >
              Discord benzeri kalite seçimi. Önce çözünürlük ve kare hızını seç, sonra paylaşımı başlat.
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={isStarting}
            style={{
              width: 38,
              height: 38,
              borderRadius: 12,
              border: "1px solid rgba(255,255,255,0.08)",
              background: "rgba(255,255,255,0.04)",
              color: "#dbe3ee",
              fontSize: 18,
              cursor: isStarting ? "default" : "pointer",
            }}
          >
            ×
          </button>
        </div>

        <div
          style={{
            padding: 22,
            display: "grid",
            gridTemplateColumns: "1.25fr 0.95fr",
            gap: 18,
          }}
        >
          <div
            style={{
              borderRadius: 22,
              border: "1px solid rgba(255,255,255,0.06)",
              background:
                "linear-gradient(180deg, rgba(255,255,255,0.025), rgba(255,255,255,0.015))",
              padding: 18,
              minHeight: 320,
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(3, 1fr)",
                gap: 10,
                marginBottom: 18,
                background: "rgba(255,255,255,0.025)",
                borderRadius: 18,
                padding: 8,
              }}
            >
              <div
                style={{
                  height: 38,
                  borderRadius: 12,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#cfd7e3",
                  fontWeight: 800,
                  background: "rgba(255,255,255,0.03)",
                }}
              >
                🗂️ Uygulamalar
              </div>
              <div
                style={{
                  height: 38,
                  borderRadius: 12,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#ffffff",
                  fontWeight: 900,
                  background: "linear-gradient(135deg, rgba(88,101,242,0.28), rgba(123,138,255,0.2))",
                  border: "1px solid rgba(123,138,255,0.28)",
                }}
              >
                🖥️ Tüm Ekran
              </div>
              <div
                style={{
                  height: 38,
                  borderRadius: 12,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#cfd7e3",
                  fontWeight: 800,
                  background: "rgba(255,255,255,0.03)",
                }}
              >
                📁 Cihazlar
              </div>
            </div>

            <div
              style={{
                flex: 1,
                borderRadius: 20,
                border: "1px solid rgba(255,255,255,0.06)",
                background:
                  "radial-gradient(circle at top left, rgba(88,101,242,0.2), rgba(88,101,242,0) 42%), linear-gradient(180deg, rgba(9,12,18,0.96), rgba(12,15,21,0.98))",
                padding: 16,
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 12,
              }}
            >
              {[
                { title: "Ekran 1", subtitle: "Kod + klasörler" },
                { title: "Ekran 2", subtitle: "Tarayıcı + uygulama" },
              ].map((item, index) => (
                <div
                  key={item.title}
                  style={{
                    borderRadius: 18,
                    overflow: "hidden",
                    border:
                      index === 0
                        ? "1px solid rgba(123,138,255,0.34)"
                        : "1px solid rgba(255,255,255,0.06)",
                    background: "rgba(255,255,255,0.03)",
                    display: "flex",
                    flexDirection: "column",
                  }}
                >
                  <div
                    style={{
                      aspectRatio: "16 / 9",
                      background:
                        index === 0
                          ? "linear-gradient(135deg, rgba(88,101,242,0.28), rgba(88,101,242,0.04))"
                          : "linear-gradient(135deg, rgba(255,255,255,0.06), rgba(255,255,255,0.015))",
                      position: "relative",
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        position: "absolute",
                        inset: 10,
                        borderRadius: 14,
                        border: "1px solid rgba(255,255,255,0.08)",
                        background:
                          "linear-gradient(180deg, rgba(10,13,20,0.95), rgba(14,18,27,0.95))",
                      }}
                    />
                    <div
                      style={{
                        position: "absolute",
                        inset: "16px 18px auto 18px",
                        height: 10,
                        borderRadius: 999,
                        background: "rgba(255,255,255,0.06)",
                      }}
                    />
                    <div
                      style={{
                        position: "absolute",
                        left: 18,
                        right: 18,
                        bottom: 18,
                        top: 42,
                        display: "grid",
                        gridTemplateColumns: "0.9fr 1.1fr",
                        gap: 8,
                      }}
                    >
                      <div
                        style={{
                          borderRadius: 12,
                          background: "rgba(255,255,255,0.045)",
                        }}
                      />
                      <div
                        style={{
                          display: "grid",
                          gap: 8,
                        }}
                      >
                        <div
                          style={{
                            borderRadius: 12,
                            background: "rgba(255,255,255,0.045)",
                          }}
                        />
                        <div
                          style={{
                            borderRadius: 12,
                            background: "rgba(255,255,255,0.045)",
                          }}
                        />
                      </div>
                    </div>
                  </div>

                  <div
                    style={{
                      padding: "10px 12px 12px",
                      color: "#dbe3ee",
                    }}
                  >
                    <div style={{ fontWeight: 800, fontSize: 13 }}>{item.title}</div>
                    <div
                      style={{
                        marginTop: 4,
                        color: "#95a2b5",
                        fontSize: 12,
                      }}
                    >
                      {item.subtitle}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div
              style={{
                marginTop: 14,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                color: "#9fabc0",
                fontSize: 13,
              }}
            >
              <span>Seçili ön ayar</span>
              <span
                style={{
                  borderRadius: 999,
                  padding: "6px 10px",
                  background: "rgba(88,101,242,0.16)",
                  border: "1px solid rgba(88,101,242,0.24)",
                  color: "#edf2ff",
                  fontWeight: 800,
                }}
              >
                {currentPresetLabel}
              </span>
            </div>
          </div>

          <div
            style={{
              borderRadius: 22,
              border: "1px solid rgba(255,255,255,0.06)",
              background:
                "linear-gradient(180deg, rgba(255,255,255,0.025), rgba(255,255,255,0.015))",
              padding: 18,
              display: "flex",
              flexDirection: "column",
              gap: 18,
            }}
          >
            <div>
              <div
                style={{
                  color: "#ffffff",
                  fontWeight: 900,
                  fontSize: 15,
                  marginBottom: 10,
                }}
              >
                Ekran çözünürlüğü
              </div>

              <div style={{ display: "flex", gap: 10 }}>
                <SegmentedOption
                  label="720p"
                  active={resolution === "720p"}
                  onClick={() => onResolutionChange("720p")}
                />
                <SegmentedOption
                  label="1080p"
                  active={resolution === "1080p"}
                  onClick={() => onResolutionChange("1080p")}
                />
              </div>
            </div>

            <div>
              <div
                style={{
                  color: "#ffffff",
                  fontWeight: 900,
                  fontSize: 15,
                  marginBottom: 10,
                }}
              >
                Kare hızı
              </div>

              <div style={{ display: "flex", gap: 10 }}>
                <SegmentedOption
                  label="30 FPS"
                  active={fps === 30}
                  onClick={() => onFpsChange(30)}
                />
                <SegmentedOption
                  label="60 FPS"
                  active={fps === 60}
                  onClick={() => onFpsChange(60)}
                />
              </div>
            </div>

            <div
              style={{
                borderRadius: 18,
                border: shareSystemAudio
                  ? "1px solid rgba(88,101,242,0.26)"
                  : "1px solid rgba(255,255,255,0.06)",
                background: shareSystemAudio
                  ? "linear-gradient(180deg, rgba(88,101,242,0.12), rgba(88,101,242,0.04))"
                  : "rgba(255,255,255,0.03)",
                padding: 14,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 14,
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      color: "#ffffff",
                      fontWeight: 900,
                      fontSize: 14,
                      marginBottom: 6,
                    }}
                  >
                    Sistem sesi
                  </div>
                  <div
                    style={{
                      color: "#9fabc0",
                      fontSize: 13,
                      lineHeight: 1.6,
                    }}
                  >
                    Uygulama penceresi seçersen mümkünse sadece o uygulamanın sesi paylaşılır. Tüm ekran seçersen sistem sesi paylaşılabilir. Mikrofon sesi bu yayına dahil edilmez.
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => onShareSystemAudioChange(!shareSystemAudio)}
                  style={{
                    width: 54,
                    height: 30,
                    borderRadius: 999,
                    border: shareSystemAudio
                      ? "1px solid rgba(123,138,255,0.44)"
                      : "1px solid rgba(255,255,255,0.10)",
                    background: shareSystemAudio
                      ? "linear-gradient(135deg, rgba(88,101,242,0.46), rgba(123,138,255,0.30))"
                      : "rgba(255,255,255,0.06)",
                    position: "relative",
                    cursor: "pointer",
                    flexShrink: 0,
                  }}
                >
                  <span
                    style={{
                      position: "absolute",
                      top: 3,
                      left: shareSystemAudio ? 27 : 3,
                      width: 22,
                      height: 22,
                      borderRadius: 999,
                      background: "#ffffff",
                      transition: "left 160ms ease",
                      boxShadow: "0 6px 18px rgba(0,0,0,0.24)",
                    }}
                  />
                </button>
              </div>
            </div>

            <div
              style={{
                borderRadius: 18,
                border: "1px solid rgba(255,255,255,0.06)",
                background: "rgba(255,255,255,0.03)",
                padding: 14,
              }}
            >
              <div
                style={{
                  color: "#ffffff",
                  fontWeight: 900,
                  fontSize: 14,
                  marginBottom: 8,
                }}
              >
                Yayın modu önerisi
              </div>

              <div
                style={{
                  color: "#9fabc0",
                  fontSize: 13,
                  lineHeight: 1.65,
                }}
              >
                {fps === 60
                  ? "Daha akıcı hareket için uygun. Oyun ya da hızlı animasyon gösterirken daha iyi görünür."
                  : "Daha stabil ve hafif çalışır. Kod, tasarım, döküman ve masaüstü paylaşımı için daha uygundur."}
              </div>
            </div>

            <div
              style={{
                borderRadius: 18,
                border: "1px solid rgba(255,255,255,0.06)",
                background: "rgba(255,255,255,0.03)",
                padding: 14,
              }}
            >
              <div
                style={{
                  color: "#ffffff",
                  fontWeight: 900,
                  fontSize: 14,
                  marginBottom: 8,
                }}
              >
                Seçilen kalite
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                  gap: 10,
                }}
              >
                <div
                  style={{
                    borderRadius: 14,
                    background: "rgba(255,255,255,0.03)",
                    padding: 12,
                  }}
                >
                  <div style={{ color: "#8ea0b8", fontSize: 12 }}>Çözünürlük</div>
                  <div style={{ color: "#fff", fontWeight: 900, marginTop: 4 }}>
                    {resolution}
                  </div>
                </div>

                <div
                  style={{
                    borderRadius: 14,
                    background: "rgba(255,255,255,0.03)",
                    padding: 12,
                  }}
                >
                  <div style={{ color: "#8ea0b8", fontSize: 12 }}>Kare hızı</div>
                  <div style={{ color: "#fff", fontWeight: 900, marginTop: 4 }}>
                    {fps} FPS
                  </div>
                </div>

                <div
                  style={{
                    borderRadius: 14,
                    background: shareSystemAudio
                      ? "rgba(88,101,242,0.14)"
                      : "rgba(255,255,255,0.03)",
                    padding: 12,
                  }}
                >
                  <div style={{ color: "#8ea0b8", fontSize: 12 }}>Sistem sesi</div>
                  <div style={{ color: "#fff", fontWeight: 900, marginTop: 4 }}>
                    {shareSystemAudio ? "Açık • Mikrofon hariç" : "Kapalı"}
                  </div>
                </div>
              </div>
            </div>

            <div style={{ marginTop: "auto", display: "flex", gap: 10 }}>
              <button
                type="button"
                onClick={onClose}
                disabled={isStarting}
                style={{
                  flex: 1,
                  height: 48,
                  borderRadius: 14,
                  border: "1px solid rgba(255,255,255,0.08)",
                  background: "rgba(255,255,255,0.04)",
                  color: "#dbe3ee",
                  fontWeight: 800,
                  cursor: isStarting ? "default" : "pointer",
                }}
              >
                Vazgeç
              </button>

              <button
                type="button"
                onClick={onConfirm}
                disabled={isStarting}
                style={{
                  flex: 1.25,
                  height: 48,
                  borderRadius: 14,
                  border: "1px solid rgba(123,138,255,0.26)",
                  background:
                    "linear-gradient(135deg, rgba(88,101,242,0.92), rgba(123,138,255,0.9))",
                  color: "#ffffff",
                  fontWeight: 900,
                  cursor: isStarting ? "default" : "pointer",
                  boxShadow: "0 16px 30px rgba(88,101,242,0.24)",
                }}
              >
                {isStarting ? "Başlatılıyor..." : "Yayını Başlat"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
