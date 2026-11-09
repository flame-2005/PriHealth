/** Build-time switches. Keep ENCRYPTED_DB in sync with the "op-sqlite" block in package.json. */
export const ENCRYPTED_DB = false; // flip to true once the SQLCipher build is verified on device
export const DB_NAME = 'privatefit.db';
export const DB_KEY_ALIAS = 'privatefit_db_v1';
export const APP_NAME = 'PrivateFit';
/** Demo builds only: fills 90 days of sample history on first launch. Must be false for any real build. */
export const DEMO_SEED = false;
