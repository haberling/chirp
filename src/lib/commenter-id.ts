import { sha256Hex } from "./hash";

// The client generates a random GUID once (crypto.randomUUID(), kept in
// localStorage) and sends it raw with every submission. The server salts +
// hashes it into `commenter_id` and returns/stores only the hash — the raw
// GUID is never persisted or echoed back. This lets two comments be tagged
// as "same commenter" (a good-faith continuity signal, not an identity
// guarantee: clearing localStorage or minting a fresh GUID trivially starts
// a new one) while making it impossible to reproduce someone's commenter_id
// from the public API alone — that requires their raw GUID, which only
// ever lives in their own browser storage.
export async function hashCommenterGuid(guid: string, salt: string): Promise<string> {
  return sha256Hex(`commenter:${salt}:${guid}`);
}
