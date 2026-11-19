import { createContext, useContext } from "react";

export interface Shell {
  isExpired: boolean;
  isRecovering: boolean;
  requestRenew: () => void;
  setShorts: (n: number) => void;
}

export const ShellContext = createContext<Shell>({
  isExpired: false,
  isRecovering: false,
  requestRenew() {},
  setShorts() {},
});

export const useShell = () => useContext(ShellContext);
