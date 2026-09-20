// Centralized site contact configuration.
//
// To use your real support address, set NEXT_PUBLIC_SUPPORT_EMAIL in the
// frontend environment (see .env.example). Falls back to an obvious
// placeholder so it is never silently a wrong address.
export const SUPPORT_EMAIL: string =
  process.env.NEXT_PUBLIC_SUPPORT_EMAIL || "support@YOUR-DOMAIN.com";

export const SUPPORT_MAILTO: string = `mailto:${SUPPORT_EMAIL}`;
