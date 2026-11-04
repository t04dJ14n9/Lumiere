import {
  Bypass,
  Lease,
  nativeStayBlocks,
  type TabKind,
} from "./reclaim-policy";
import { readerText } from "./reader-text";

/** Notes this extension opens as text keep it (Open as Text, source commands). */
export const textBypass = new Bypass();

/**
 * cursorBridge Edit/Chat handoff: suppress reclaim for the whole native
 * session, not a fixed window. Released when the note leaves the text editor.
 */
export const handoffLease = new Lease();

export function hasNativeOptOut(uri: string, after: TabKind = "text"): boolean {
  return nativeStayBlocks(after, {
    bypass: textBypass.has(uri),
    handoff: handoffLease.has(uri),
    readerText: readerText.has(uri),
  });
}
