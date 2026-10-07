/**
 * The identifiers that let this page talk to Google Drive, read from the build's
 * environment.
 *
 * They have to exist: Google hands out no anonymous access, so a page can only
 * ask for a Drive token through an OAuth client registered to the origin it is
 * served from.
 *
 * Keeping them in the environment keeps them out of this repository and its
 * history, and makes rotating one a settings change rather than a commit. It
 * does not make them private: Vite inlines these values into the bundle it
 * builds, and that bundle is served to every visitor, so all three are readable
 * in the deployed page's JavaScript. That is expected — an OAuth client ID is
 * public by design, the project number is an identifier rather than a
 * credential, and the API key is guarded by the origin restrictions set on it in
 * the Cloud console. No client secret, service-account key or refresh token is
 * involved anywhere in this flow.
 *
 * Unset, the site still works: the Drive button explains what is missing and the
 * local file picker is unaffected. See `.env.example` for how to fill them in.
 */

export const CLIENT_ID = String(import.meta.env.VITE_GOOGLE_CLIENT_ID ?? '')
export const API_KEY = String(import.meta.env.VITE_GOOGLE_API_KEY ?? '')
/** The Cloud project number, e.g. '123456789012'. */
export const APP_ID = String(import.meta.env.VITE_GOOGLE_APP_ID ?? '')
