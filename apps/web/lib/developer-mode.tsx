"use client";

import { createContext, useContext, useState, useEffect, ReactNode } from "react";

interface DevModeContextType {
  isDeveloperMode: boolean;
  toggleDeveloperMode: () => void;
}

const DevModeContext = createContext<DevModeContextType>({
  isDeveloperMode: false,
  toggleDeveloperMode: () => {},
});

export function DevModeProvider({ children }: { children: ReactNode }) {
  const [isDeveloperMode, setIsDeveloperMode] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem("developer-mode");
    if (saved === "true") setIsDeveloperMode(true);
  }, []);

  const toggleDeveloperMode = () => {
    const next = !isDeveloperMode;
    setIsDeveloperMode(next);
    localStorage.setItem("developer-mode", String(next));
  };

  return (
    <DevModeContext.Provider value={{ isDeveloperMode, toggleDeveloperMode }}>
      {children}
    </DevModeContext.Provider>
  );
}

export const useDeveloperMode = () => useContext(DevModeContext);
