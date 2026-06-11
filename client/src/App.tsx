import { useEffect, useState } from "react";
import MainLayout from "./layout/MainLayout";
import AuthScreen from "./pages/AuthScreen";

export type AuthUser = {
  id: string;
  username?: string;
  displayName: string;
  role: string;
};

function App() {
  const [token, setToken] = useState<string | null>(() => {
    return localStorage.getItem("token");
  });

  const [user, setUser] = useState<AuthUser | null>(() => {
    const raw = localStorage.getItem("auth_user");
    return raw ? JSON.parse(raw) : null;
  });

  useEffect(() => {
    const loadMe = async () => {
      if (!token) return;

      try {
        const res = await fetch("http://localhost:3001/auth/me", {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (!res.ok) {
          throw new Error("auth/me failed");
        }

        const data = await res.json();
        setUser(data);
        localStorage.setItem("auth_user", JSON.stringify(data));
      } catch (error) {
        console.error(error);
        localStorage.removeItem("token");
        localStorage.removeItem("auth_user");
        setToken(null);
        setUser(null);
      }
    };

    loadMe();
  }, [token]);

  const handleAuthSuccess = (nextToken: string, nextUser: AuthUser) => {
    localStorage.setItem("token", nextToken);
    localStorage.setItem("auth_user", JSON.stringify(nextUser));
    setToken(nextToken);
    setUser(nextUser);
  };

  const handleLogout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("auth_user");
    setToken(null);
    setUser(null);
  };

  if (!token || !user) {
    return <AuthScreen onAuthSuccess={handleAuthSuccess} />;
  }

  return <MainLayout onLogout={handleLogout} currentUser={user} />;
}

export default App;