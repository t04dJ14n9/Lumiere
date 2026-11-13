export { resolveAttachmentDir } from "./folder";
export { timestampStem, uniqueName, uniqueTimestampName } from "./naming";
export {
  downloadFileName,
  downloadStem,
  imageChoice,
  propertyImageUrls,
  remoteImages,
  withDownloadedImages,
  withDownloadedPropertyImages,
  type RemoteImage,
} from "./download";
export { embedFor, propertyLinkFor, type EmbedLink } from "./embed";
export { insertEmbed } from "./insert";
export {
  saveAttachment,
  type SaveAttachmentInput,
  type SavedAttachment,
} from "./save";
export {
  remoteImagesInMarkdown,
  rewriteRemoteImages,
  decodeDataUri,
  extensionForMime,
  extensionFromUrl,
} from "./html-images";
export { encodeBase64, decodeBase64 } from "./base64";
export {
  isAttachmentDrag,
  shouldClaimEditorDrop,
  urisFromDataTransfer,
  filesFromDataTransfer,
  type DragPayload,
  type DragFile,
} from "./drop";
export {
  isHostSourceUrl,
  loadAttachmentOutcome,
  loadAttachmentSource,
  type SourceBytes,
  type SourceFetch,
  type SourceOutcome,
  type SourceRead,
} from "./source";
export {
  isAttachableExplorerPath,
  shouldReclaimExplorerOpen,
  type ExplorerOpenFacts,
} from "./explorer-open";
