import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useColorScheme } from "react-native";
import { colors, type ColorMode, type ColorToken } from "./tokens";

type Theme = {
  mode: ColorMode;
  color: (token: ColorToken) => string;
};

const ThemeContext = createContext<Theme | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const systemMode = useColorScheme();
  const mode: ColorMode = systemMode === "dark" ? "dark" : "light";

  const theme = useMemo<Theme>(
    () => ({
      mode,
      color: (token) => colors[token][mode],
    }),
    [mode],
  );

  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme must be used inside <ThemeProvider>");
  }
  return ctx;
}
