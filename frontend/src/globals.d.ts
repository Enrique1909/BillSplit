/// <reference types="vite/client" />

// Ambient types for the CDN-loaded Google Identity Services + gtag globals.
// (We load both via <script> rather than npm packages, so declare them here.)

interface GoogleCredentialResponse {
  credential: string;
  select_by?: string;
}

interface GoogleIdConfig {
  client_id: string;
  callback: (response: GoogleCredentialResponse) => void;
  auto_select?: boolean;
  cancel_on_tap_outside?: boolean;
  use_fedcm_for_prompt?: boolean;
}

interface GoogleIdButtonOptions {
  type?: "standard" | "icon";
  theme?: "outline" | "filled_blue" | "filled_black";
  size?: "small" | "medium" | "large";
  text?: "signin_with" | "signup_with" | "continue_with" | "signin";
  shape?: "rectangular" | "pill" | "circle" | "square";
  logo_alignment?: "left" | "center";
  width?: number | string;
}

interface GoogleAccountsId {
  initialize: (config: GoogleIdConfig) => void;
  renderButton: (parent: HTMLElement, options: GoogleIdButtonOptions) => void;
  prompt: (listener?: (notification: unknown) => void) => void;
  disableAutoSelect: () => void;
  cancel: () => void;
}

interface Window {
  google?: { accounts: { id: GoogleAccountsId } };
  dataLayer?: unknown[];
  gtag?: (...args: unknown[]) => void;
}
