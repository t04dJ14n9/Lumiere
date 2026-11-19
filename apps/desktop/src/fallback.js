// The window's first page (src-tauri/src/lib.rs): "starting" until the
// server's page replaces it, or why the server did not start, from the URL.
const reason = new URLSearchParams(location.search).get("reason");
if (reason !== null) {
  document.getElementById("reason").textContent = reason;
  document.getElementById("starting").hidden = true;
  document.getElementById("failed").hidden = false;
}
