// src/App.tsx
import { useCallback, useEffect, useState } from "react";
import { SessionListView } from "./views/SessionListView";
import { SessionView } from "./views/SessionView";
import { useTheme } from "./lib/useTheme";
import { useFontSize } from "./lib/useFontSize";

export type Route =
  | { kind: "list" }
  | { kind: "session"; id: string };

function parseHash(hash: string): Route {
  // strip leading "#" and any leading "/"
  const raw = hash.replace(/^#/, "");
  const path = raw.startsWith("/") ? raw : `/${raw}`;
  if (path === "/" || path === "") return { kind: "list" };
  const m = path.match(/^\/session\/([^/]+)$/);
  if (m) return { kind: "session", id: decodeURIComponent(m[1]) };
  return { kind: "list" };
}

function navigate(to: string): void {
  if (typeof window === "undefined") return;
  if (window.location.hash !== to) {
    window.location.hash = to;
  }
}

export function App(): JSX.Element {
  const [route, setRoute] = useState<Route>(() =>
    typeof window === "undefined"
      ? { kind: "list" }
      : parseHash(window.location.hash),
  );

  useEffect(() => {
    const onChange = (): void => {
      setRoute(parseHash(window.location.hash));
    };
    window.addEventListener("hashchange", onChange);
    return () => {
      window.removeEventListener("hashchange", onChange);
    };
  }, []);

  const goList = useCallback(() => navigate("/"), []);
  const goSession = useCallback(
    (id: string) => navigate(`/session/${encodeURIComponent(id)}`),
    [],
  );

  // Theme is app-wide so both views share it.
  const { theme, setTheme } = useTheme();
  const { fontSize, setFontSize } = useFontSize();

  return (
    <div className="app">
      {route.kind === "list" ? (
        <SessionListView
          onNavigate={goSession}
          theme={theme}
          onThemeChange={setTheme}
          fontSize={fontSize}
          onFontSizeChange={setFontSize}
        />
      ) : (
        <SessionView
          sessionId={route.id}
          onBack={goList}
          onNavigate={goSession}
          theme={theme}
          onThemeChange={setTheme}
          fontSize={fontSize}
          onFontSizeChange={setFontSize}
        />
      )}
    </div>
  );
}
