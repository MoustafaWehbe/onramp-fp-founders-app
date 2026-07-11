/// <reference types="vite/client" />

interface GsiCredentialResponse {
  credential: string;
  select_by: string;
  clientId: string;
}

interface GsiIdConfiguration {
  client_id: string;
  callback: (response: GsiCredentialResponse) => void;
  auto_select?: boolean;
  cancel_on_tap_outside?: boolean;
}

interface GsiPromptMomentNotification {
  isDisplayMoment(): boolean;
  isDisplayed(): boolean;
  isNotDisplayed(): boolean;
  getNotDisplayedReason():
    | "browser_not_supported"
    | "invalid_client"
    | "missing_client_id"
    | "opt_out_or_no_session"
    | "secure_http_required"
    | "suppressed_by_user"
    | "unregistered_origin"
    | "unknown_reason";
  isSkippedMoment(): boolean;
  getSkippedReason(): "auto_cancel" | "user_cancel" | "tap_outside" | "issuing_failed";
  isDismissedMoment(): boolean;
  getDismissedReason(): "credential_returned" | "cancel_called" | "flow_restarted";
}

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: GsiIdConfiguration) => void;
          prompt: (callback?: (notification: GsiPromptMomentNotification) => void) => void;
          renderButton: (
            parent: HTMLElement,
            options: {
              type?: "standard" | "icon";
              theme?: "outline" | "filled_blue" | "filled_black";
              size?: "large" | "medium" | "small";
              text?: "signin_with" | "signup_with" | "continue_with" | "signin";
              shape?: "rectangular" | "pill" | "circle" | "square";
              width?: string;
            },
          ) => void;
          disableAutoSelect: () => void;
        };
      };
    };
  }
}

export {};
