import { create } from "zustand";

type LinearIntegrationDialogState = {
  apiKey: string;
  isOpen: boolean;
  isReplacing: boolean;
};

type LinearIntegrationDialogActions = {
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
  create<LinearIntegrationDialogState & LinearIntegrationDialogActions>(
    (set) => ({
      apiKey: "",
      isOpen: false,
      isReplacing: false,
      closeAndReset: () => set({ isOpen: false, ...EMPTY_CREDENTIAL_FORM }),
      openChange: (isOpen) =>
        set(isOpen ? { isOpen } : { isOpen, ...EMPTY_CREDENTIAL_FORM }),
      setApiKey: (apiKey) => set({ apiKey }),
      startReplacing: () => set({ apiKey: "", isReplacing: true }),
      resetCredentialForm: () => set(EMPTY_CREDENTIAL_FORM),
    }),
  );

export { useLinearIntegrationDialogStore };
export type {
  LinearIntegrationDialogState,
  LinearIntegrationDialogActions,
};
