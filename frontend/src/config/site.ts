export const SITE_URL = "https://www.downloadit.pro";
export const BRAND_NAME = "Downloadit";
export const BRAND_TITLE = "Downloadit – Instagram Video, Reels & Photo Downloader";
export const BRAND_DESCRIPTION =
  "Download Instagram videos, Reels and photos with Downloadit. Preview public Instagram media and save it to your device quickly without creating an account.";
declare const process: {
  env: {
    NEXT_PUBLIC_SUPPORT_EMAIL?: string;
  };
};
//
// To use your real support address, set NEXT_PUBLIC_SUPPORT_EMAIL in the
// frontend environment (see .env.example). Falls back to an obvious
// placeholder so it is never silently a wrong address.
export const SUPPORT_EMAIL: string =
  process.env.NEXT_PUBLIC_SUPPORT_EMAIL || "support@downloadit.pro";

export const SUPPORT_MAILTO: string = `mailto:${SUPPORT_EMAIL}`;
