import { create } from "zustand";

type LinearIntegrationDialogState = {
  apiKey: string;
  isOpen: boolean;
  isReplacing: boolean;
  closeAndReset: () => void;
  openChange: (isOpen: boolean) => void;
  setApiKey: (apiKey: string) => void;
  startReplacing: () => void;
  resetCredentialForm: () => void;
};

const EMPTY_CREDENTIAL_FORM = {
  apiKey: "",
  isReplacing: false,
};

const useLinearIntegrationDialogStore =
  create<LinearIntegrationDialogState>((set) => ({
    apiKey: "",
    isOpen: false,
    isReplacing: false,
    closeAndReset: () => set({ isOpen: false, ...EMPTY_CREDENTIAL_FORM }),
    openChange: (isOpen) =>
      set(isOpen ? { isOpen } : { isOpen, ...EMPTY_CREDENTIAL_FORM }),
    setApiKey: (apiKey) => set({ apiKey }),
    startReplacing: () => set({ apiKey: "", isReplacing: true }),
    resetCredentialForm: () => set(EMPTY_CREDENTIAL_FORM),
  }));

export { useLinearIntegrationDialogStore };
