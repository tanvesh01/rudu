import { Toast } from "@base-ui/react/toast";

export type AppToastPlacement = "bottom-right" | "bottom-center";
export type AppToastVariant = "default" | "patch-loading";

export type AppToastData = {
  placement?: AppToastPlacement;
  variant?: AppToastVariant;
  hideClose?: boolean;
};

export const appToastManager = Toast.createToastManager<AppToastData>();
