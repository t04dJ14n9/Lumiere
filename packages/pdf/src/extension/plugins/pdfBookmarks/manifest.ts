import { defineManifest } from "../manifest";

export default defineManifest({
  id: "pdfBookmarks",
  title: "PDF Bookmarks",
  capabilities: ["treeView", "commands", "storage"],
});
