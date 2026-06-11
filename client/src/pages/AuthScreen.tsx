import { useEffect, useRef, useState } from "react";

type AuthScreenProps = {
  onAuthSuccess: (
    token: string,
    user: { id: string; displayName: string; role: string }
  ) => void;
};

type Mode = "login" | "signup";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ID_REGEX = /^[a-z0-9._]{3,20}$/;

type UsernameStatus = "idle" | "checking" | "available" | "taken" | "invalid";

export default function AuthScreen({ onAuthSuccess }: AuthScreenProps) {
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [usernameStatus, setUsernameStatus] = useState<UsernameStatus>("idle");
  const [usernameStatusText, setUsernameStatusText] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);

  const usernameCheckSeq = useRef(0);
  const suggestionsSeq = useRef(0);

  const isSignup = mode === "signup";

  const handleDisplayNameChange = (value: string) => {
    setDisplayName(value);
  };

  const handleUsernameChange = (value: string) => {
    const normalized = value.toLowerCase().replace(/[^a-z0-9._]/g, "");
    setUsername(normalized);
  };

  const loadSuggestions = async (name: string, refreshValue: number) => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setSuggestions([]);
      return;
    }

    const seq = ++suggestionsSeq.current;
    setSuggestionsLoading(true);

    try {
      const res = await fetch(
        `http://localhost:3001/auth/username-suggestions?displayName=${encodeURIComponent(
          trimmedName
        )}&refresh=${refreshValue}`
      );

      const data = await res.json().catch(() => null);
      if (seq !== suggestionsSeq.current) return;

      if (!res.ok) {
        setSuggestions([]);
        return;
      }

      setSuggestions(Array.isArray(data?.suggestions) ? data.suggestions : []);
    } catch {
      if (seq !== suggestionsSeq.current) return;
      setSuggestions([]);
    } finally {
      if (seq === suggestionsSeq.current) {
        setSuggestionsLoading(false);
      }
    }
  };

  useEffect(() => {
    if (!isSignup) return;

    const trimmedDisplayName = displayName.trim();
    const trimmedUsername = username.trim();

    if (!trimmedDisplayName) {
      setSuggestions([]);
      return;
    }

    if (trimmedUsername.length > 0) {
      return;
    }

    const timeout = window.setTimeout(() => {
      void loadSuggestions(trimmedDisplayName, refreshTick);
    }, 350);

    return () => window.clearTimeout(timeout);
  }, [displayName, username, isSignup, refreshTick]);

  useEffect(() => {
    if (!isSignup) return;

    const trimmedUsername = username.trim().toLowerCase();
    const seq = ++usernameCheckSeq.current;

    if (!trimmedUsername) {
      setUsernameStatus("idle");
      setUsernameStatusText("");
      return;
    }

    if (!ID_REGEX.test(trimmedUsername)) {
      setUsernameStatus("invalid");
      setUsernameStatusText(
        "ID 3-20 karakter olmalı ve sadece küçük harf, sayı, nokta veya alt çizgi içermeli."
      );
      return;
    }

    setUsernameStatus("checking");
    setUsernameStatusText("ID kontrol ediliyor...");

    const timeout = window.setTimeout(async () => {
      try {
        const res = await fetch(
          `http://localhost:3001/auth/check-username?username=${encodeURIComponent(
            trimmedUsername
          )}`
        );

        const data = await res.json().catch(() => null);
        if (seq !== usernameCheckSeq.current) return;

        if (!res.ok) {
          setUsernameStatus("invalid");
          setUsernameStatusText("ID kontrol edilemedi.");
          return;
        }

        if (data?.available) {
          setUsernameStatus("available");
          setUsernameStatusText("Bu ID kullanılabilir.");
        } else if (data?.reason === "USERNAME_IN_USE") {
          setUsernameStatus("taken");
          setUsernameStatusText("Bu ID kullanımda.");
        } else {
          setUsernameStatus("invalid");
          setUsernameStatusText("Bu ID geçersiz.");
        }
      } catch {
        if (seq !== usernameCheckSeq.current) return;
        setUsernameStatus("invalid");
        setUsernameStatusText("ID kontrol edilemedi.");
      }
    }, 400);

    return () => window.clearTimeout(timeout);
  }, [username, isSignup]);

  const validateSignupFields = () => {
    const trimmedDisplayName = displayName.trim();
    const trimmedEmail = email.trim();
    const trimmedUsername = username.trim().toLowerCase();

    if (!trimmedDisplayName) {
      return "Username gerekli.";
    }

    if (trimmedDisplayName.length < 2) {
      return "Username en az 2 karakter olmalı.";
    }

    if (trimmedDisplayName.length > 24) {
      return "Username en fazla 24 karakter olabilir.";
    }

    if (!trimmedUsername) {
      return "ID gerekli.";
    }

    if (!ID_REGEX.test(trimmedUsername)) {
      return "ID 3-20 karakter olmalı ve sadece küçük harf, sayı, nokta veya alt çizgi içermeli.";
    }

    if (usernameStatus === "taken") {
      return "Bu ID kullanımda.";
    }

    if (usernameStatus === "invalid") {
      return "Geçerli bir ID gir.";
    }

    if (usernameStatus === "checking") {
      return "ID kontrolü tamamlanmadan devam edemezsin.";
    }

    if (!trimmedEmail) {
      return "Email gerekli.";
    }

    if (!EMAIL_REGEX.test(trimmedEmail)) {
      return "Geçerli bir email adresi gir.";
    }

    if (!password) {
      return "Şifre gerekli.";
    }

    if (password.length < 8) {
      return "Şifre en az 8 karakter olmalı.";
    }

    return "";
  };

  const validateLoginFields = () => {
    const trimmedEmail = email.trim();

    if (!trimmedEmail || !password) {
      return "Email ve şifre gerekli.";
    }

    if (!EMAIL_REGEX.test(trimmedEmail)) {
      return "Geçerli bir email adresi gir.";
    }

    return "";
  };

  const submit = async () => {
    setError("");

    const validationError = isSignup
      ? validateSignupFields()
      : validateLoginFields();

    if (validationError) {
      setError(validationError);
      return;
    }

    try {
      setLoading(true);

      const endpoint = isSignup
        ? "http://localhost:3001/auth/signup"
        : "http://localhost:3001/auth/login";

      const body = isSignup
        ? {
            email: email.trim(),
            password,
            displayName: displayName.trim(),
            username: username.trim().toLowerCase(),
          }
        : {
            email: email.trim(),
            password,
          };

      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok) {
        const errorCode = data?.error;

        if (errorCode === "EMAIL_IN_USE") {
          setError("Bu email zaten kullanımda.");
          return;
        }

        if (errorCode === "USERNAME_IN_USE") {
          setError("Bu ID zaten kullanımda.");
          setUsernameStatus("taken");
          setUsernameStatusText("Bu ID kullanımda.");
          return;
        }

        if (errorCode === "INVALID_USERNAME") {
          setError("ID geçersiz.");
          setUsernameStatus("invalid");
          setUsernameStatusText("Bu ID geçersiz.");
          return;
        }

        if (errorCode === "INVALID_CREDENTIALS") {
          setError("Email veya şifre hatalı.");
          return;
        }

        setError(errorCode || "İşlem başarısız.");
        return;
      }

      if (!data?.token) {
        setError("Token alınamadı.");
        return;
      }

      onAuthSuccess(data.token, data.user);
    } catch (err) {
      console.error(err);
      setError("Sunucu bağlantı hatası.");
    } finally {
      setLoading(false);
    }
  };

  const usernameStatusColor =
    usernameStatus === "available"
      ? "#86efac"
      : usernameStatus === "taken" || usernameStatus === "invalid"
        ? "#fda4af"
        : "#9da7b3";

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "linear-gradient(180deg, #1e1f22 0%, #17181b 100%)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        color: "white",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 420,
          background: "#23252b",
          border: "1px solid #31343b",
          borderRadius: 18,
          padding: 24,
          boxShadow: "0 20px 50px rgba(0,0,0,0.35)",
        }}
      >
        <div style={{ marginBottom: 20 }}>
          <div
            style={{
              fontSize: 12,
              textTransform: "uppercase",
              letterSpacing: 1,
              color: "#9da1a8",
              marginBottom: 6,
            }}
          >
            vICE
          </div>
          <h1
            style={{
              margin: 0,
              fontSize: 28,
              fontWeight: 800,
            }}
          >
            {isSignup ? "Hesap Oluştur" : "Giriş Yap"}
          </h1>
          <p
            style={{
              marginTop: 8,
              marginBottom: 0,
              color: "#b5bac1",
              fontSize: 14,
            }}
          >
            {isSignup
              ? "Yeni hesap oluştur ve voice sisteme bağlan."
              : "Devam etmek için hesabınla giriş yap."}
          </p>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {isSignup && (
            <>
              <div
                style={{
                  display: "flex",
                  gap: 10,
                  alignItems: "flex-start",
                }}
              >
                <div
                  style={{
                    flex: "0 0 60%",
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                  }}
                >
                  <div style={fieldLabelStyle}>Username</div>
                  <input
                    value={displayName}
                    onChange={(e) => handleDisplayNameChange(e.target.value)}
                    placeholder="Username"
                    maxLength={24}
                    style={inputStyle}
                  />
                </div>

                <div
                  style={{
                    flex: "0 0 40%",
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                  }}
                >
                  <div style={fieldLabelStyle}>ID</div>
                  <input
                    value={username}
                    onChange={(e) => handleUsernameChange(e.target.value)}
                    placeholder="id"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    maxLength={20}
                    style={inputStyle}
                  />
                </div>
              </div>

              <div
                style={{
                  marginTop: -2,
                  fontSize: 12,
                  lineHeight: 1.45,
                  color: "#9da7b3",
                  padding: "0 2px",
                }}
              >
                ID tek seferlik belirlenir ve sonradan değiştirilemez.
              </div>

              {usernameStatusText ? (
                <div
                  style={{
                    marginTop: -2,
                    fontSize: 12,
                    lineHeight: 1.45,
                    color: usernameStatusColor,
                    padding: "0 2px",
                  }}
                >
                  {usernameStatusText}
                </div>
              ) : null}

              {!username.trim() ? (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 10,
                    marginTop: 2,
                  }}
                >
                  <div
                    style={{
                      fontSize: 12,
                      color: "#9da7b3",
                    }}
                  >
                    {suggestionsLoading
                      ? "ID önerileri hazırlanıyor..."
                      : suggestions.length > 0
                        ? "Önerilen ID’ler"
                        : "ID önerisi bulunamadı."}
                  </div>

                  {!!displayName.trim() && (
                    <button
                      type="button"
                      onClick={() => setRefreshTick((prev) => prev + 1)}
                      disabled={suggestionsLoading}
                      style={{
                        border: "1px solid #3a3f49",
                        background: "#1b1d22",
                        color: "white",
                        borderRadius: 10,
                        padding: "6px 10px",
                        fontSize: 12,
                        cursor: suggestionsLoading ? "not-allowed" : "pointer",
                        opacity: suggestionsLoading ? 0.7 : 1,
                      }}
                    >
                      Yenile
                    </button>
                  )}
                </div>
              ) : null}

              {suggestions.length > 0 && !username.trim() ? (
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 8,
                    marginTop: 2,
                  }}
                >
                  {suggestions.slice(0, 8).map((item) => (
  <button
    key={item}
    type="button"
    onClick={() => setUsername(item)}
    style={{
      border: "1px solid #3a3f49",
      background: "#1b1d22",
      color: "#d7dbe3",
      borderRadius: 999,
      padding: "6px 10px",
      fontSize: 12,
      cursor: "pointer",
    }}
  >
    @{item}
  </button>
))}
                </div>
              ) : null}
            </>
          )}

          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email"
            type="email"
            style={inputStyle}
          />

          <input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Şifre"
            type="password"
            style={inputStyle}
          />

          {error && (
            <div
              style={{
                background: "rgba(237, 66, 69, 0.14)",
                border: "1px solid rgba(237, 66, 69, 0.3)",
                color: "#ffb3b5",
                padding: "10px 12px",
                borderRadius: 12,
                fontSize: 14,
              }}
            >
              {error}
            </div>
          )}

          <button
            onClick={submit}
            disabled={loading}
            style={{
              marginTop: 4,
              background: "#5865f2",
              color: "white",
              border: "none",
              borderRadius: 12,
              padding: "12px 14px",
              fontWeight: 700,
              fontSize: 15,
              cursor: loading ? "not-allowed" : "pointer",
              opacity: loading ? 0.7 : 1,
            }}
          >
            {loading
              ? "Bekle..."
              : isSignup
                ? "Hesap Oluştur"
                : "Giriş Yap"}
          </button>
        </div>

        <div
          style={{
            marginTop: 18,
            fontSize: 14,
            color: "#b5bac1",
            textAlign: "center",
          }}
        >
          {isSignup ? "Zaten hesabın var mı?" : "Hesabın yok mu?"}{" "}
          <button
            onClick={() => {
              setMode(isSignup ? "login" : "signup");
              setError("");
              setUsernameStatus("idle");
              setUsernameStatusText("");
              setSuggestions([]);
              setRefreshTick(0);
            }}
            style={{
              background: "transparent",
              border: "none",
              color: "#8ea1ff",
              cursor: "pointer",
              fontWeight: 700,
              padding: 0,
            }}
          >
            {isSignup ? "Giriş Yap" : "Kayıt Ol"}
          </button>
        </div>
      </div>
    </div>
  );
}

const fieldLabelStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 700,
  color: "#d7dbe3",
  padding: "0 2px",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  background: "#1a1c20",
  color: "white",
  border: "1px solid #343841",
  borderRadius: 12,
  padding: "12px 14px",
  fontSize: 14,
  outline: "none",
  boxSizing: "border-box",
};