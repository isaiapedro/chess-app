import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import * as AuthSession from "expo-auth-session";
import * as SecureStore from "expo-secure-store";
import * as WebBrowser from "expo-web-browser";
import type { Platform } from "../api/types";
import { setPlatformGamesAuth } from "../data/platformGames";

WebBrowser.maybeCompleteAuthSession();

const AUTH_KEY = "chess-wrapped-auth-v1";
const LICHESS_CLIENT_ID = "chess-wrapped-mobile";
const LICHESS_SCOPES = ["email:read", "study:write"];

const lichessDiscovery: AuthSession.DiscoveryDocument = {
  authorizationEndpoint: "https://lichess.org/oauth",
  tokenEndpoint: "https://lichess.org/api/token",
  revocationEndpoint: "https://lichess.org/api/token",
};

export type AuthState = {
  ready: boolean;
  isLoggedIn: boolean;
  platform: Platform | null;
  username: string;
  email: string;
  lichessAccessToken: string | null;
  loginChesscom: (username: string, email: string) => Promise<void>;
  loginLichess: () => Promise<void>;
  logout: () => Promise<void>;
};

type PersistedAuth = {
  platform: Platform;
  username: string;
  email: string;
  lichessAccessToken?: string | null;
};

const AuthContext = createContext<AuthState | null>(null);

async function readPersisted(): Promise<PersistedAuth | null> {
  try {
    const raw = await SecureStore.getItemAsync(AUTH_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedAuth;
    if (!parsed?.platform || !parsed?.username) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function writePersisted(data: PersistedAuth | null): Promise<void> {
  if (!data) {
    await SecureStore.deleteItemAsync(AUTH_KEY);
    return;
  }
  await SecureStore.setItemAsync(AUTH_KEY, JSON.stringify(data));
}

function applyGamesAuth(data: PersistedAuth | null): void {
  setPlatformGamesAuth({
    email: data?.email || null,
    lichessAccessToken: data?.lichessAccessToken || null,
  });
}

async function fetchLichessProfile(token: string): Promise<{
  username: string;
  email: string;
}> {
  const [accountRes, emailRes] = await Promise.all([
    fetch("https://lichess.org/api/account", {
      headers: { Authorization: `Bearer ${token}` },
    }),
    fetch("https://lichess.org/api/account/email", {
      headers: { Authorization: `Bearer ${token}` },
    }),
  ]);
  if (!accountRes.ok) {
    throw new Error(`Lichess account failed (${accountRes.status})`);
  }
  const account = (await accountRes.json()) as { username?: string };
  const username = String(account.username || "").trim();
  if (!username) throw new Error("Lichess account missing username");

  let email = "";
  if (emailRes.ok) {
    const body = (await emailRes.json()) as { email?: string };
    email = String(body.email || "").trim();
  }
  return { username, email };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [platform, setPlatform] = useState<Platform | null>(null);
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [lichessAccessToken, setLichessAccessToken] = useState<string | null>(
    null
  );

  const redirectUri = AuthSession.makeRedirectUri({
    scheme: "com.chesswrapped.app",
    path: "oauth",
  });

  const [request, , promptAsync] = AuthSession.useAuthRequest(
    {
      clientId: LICHESS_CLIENT_ID,
      redirectUri,
      scopes: LICHESS_SCOPES,
      usePKCE: true,
      responseType: AuthSession.ResponseType.Code,
    },
    lichessDiscovery
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const persisted = await readPersisted();
      if (cancelled) return;
      if (persisted) {
        setPlatform(persisted.platform);
        setUsername(persisted.username);
        setEmail(persisted.email || "");
        setLichessAccessToken(persisted.lichessAccessToken || null);
        applyGamesAuth(persisted);
      } else {
        applyGamesAuth(null);
      }
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const persistAndSet = useCallback(async (data: PersistedAuth) => {
    await writePersisted(data);
    setPlatform(data.platform);
    setUsername(data.username);
    setEmail(data.email || "");
    setLichessAccessToken(data.lichessAccessToken || null);
    applyGamesAuth(data);
  }, []);

  const loginChesscom = useCallback(
    async (nextUsername: string, nextEmail: string) => {
      const cleanedUser = nextUsername.trim();
      const cleanedEmail = nextEmail.trim();
      if (!cleanedUser) throw new Error("Chess.com username is required");
      if (!cleanedEmail || !cleanedEmail.includes("@")) {
        throw new Error("A valid email is required for Chess.com API contact");
      }
      await persistAndSet({
        platform: "chesscom",
        username: cleanedUser,
        email: cleanedEmail,
        lichessAccessToken: null,
      });
    },
    [persistAndSet]
  );

  const loginLichess = useCallback(async () => {
    if (!request) {
      throw new Error("Lichess login is not ready yet");
    }
    const result = await promptAsync();
    if (result.type !== "success" || !result.params.code) {
      if (result.type === "dismiss" || result.type === "cancel") {
        throw new Error("Lichess login cancelled");
      }
      throw new Error("Lichess login failed");
    }
    const tokenResult = await AuthSession.exchangeCodeAsync(
      {
        clientId: LICHESS_CLIENT_ID,
        code: String(result.params.code),
        redirectUri,
        extraParams: {
          code_verifier: request.codeVerifier || "",
        },
      },
      lichessDiscovery
    );
    const accessToken = tokenResult.accessToken;
    if (!accessToken) throw new Error("Lichess token missing");
    const profile = await fetchLichessProfile(accessToken);
    await persistAndSet({
      platform: "lichess",
      username: profile.username,
      email: profile.email,
      lichessAccessToken: accessToken,
    });
  }, [persistAndSet, promptAsync, redirectUri, request]);

  const logout = useCallback(async () => {
    await writePersisted(null);
    setPlatform(null);
    setUsername("");
    setEmail("");
    setLichessAccessToken(null);
    applyGamesAuth(null);
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      ready,
      isLoggedIn: Boolean(platform && username),
      platform,
      username,
      email,
      lichessAccessToken,
      loginChesscom,
      loginLichess,
      logout,
    }),
    [
      ready,
      platform,
      username,
      email,
      lichessAccessToken,
      loginChesscom,
      loginLichess,
      logout,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return ctx;
}
