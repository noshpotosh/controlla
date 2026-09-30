/** Bundled clients and signaling must agree before any room or peer is joined. */
export const APP_PROTOCOL_VERSION = 5;
export const PROTOCOL_MISMATCH = 'protocol-mismatch';
export const PROTOCOL_RELOAD_MESSAGE =
  'This room uses a different app version. Reload every screen and phone, then rejoin.';
/** Close code for a socket whose room identity was resumed elsewhere. */
export const REPLACED_CLOSE_CODE = 4001;
