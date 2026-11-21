import Capacitor
import Foundation

/// Serves vault files to the web view at `/_lumiere/vault/<vault id>/<path>`,
/// the URLs the window gives a note's images, videos and embedded PDFs
/// (apps/ipad/src/resources.ts). Capacitor's own file handler then answers
/// them, with their types and byte ranges, as it does the app's files. The
/// path is checked as every vault path is (VaultPath): nothing outside the
/// vault's folder. Every other path is Capacitor's.
///
/// Only what a note shows is served: the images, audio, video and PDFs the
/// editor embeds (host-node's vault-file-headers.ts). These answers are on the
/// app's own origin, next to the native plugins, and Capacitor's handler
/// adds no `Content-Security-Policy: sandbox` as the other hosts do, so an
/// HTML page or a script from a vault must never be served as one.
///
/// Nor an SVG, which is a page that can run script: its bytes are served at
/// `/_lumiere/vault-svg/<vault id>/<path>.txt`, where Capacitor's handler
/// types them by the `.txt` as plain text, and the note's page shows them
/// from a `data:` URL (host-node's page/svg-images.ts).
public struct VaultRouter: Router {
    public static let prefix = "/_lumiere/vault/"
    public static let svgPrefix = "/_lumiere/vault-svg/"

    /// The extensions served at `prefix`, lowercased.
    static let servedExtensions: Set<String> = [
        "avif", "bmp", "gif", "jpeg", "jpg", "png", "webp",
        "aac", "aif", "aiff", "flac", "m4a", "mp3", "ogg", "wav",
        "mkv", "mov", "mp4", "ogv", "webm",
        "pdf",
    ]

    private let vaults: VaultStore
    private var fallback: Router

    public init(vaults: VaultStore, fallback: Router) {
        self.vaults = vaults
        self.fallback = fallback
    }

    public var basePath: String {
        get { fallback.basePath }
        set { fallback.basePath = newValue }
    }

    public func route(for path: String) -> String {
        let file: URL?
        if path.hasPrefix(Self.prefix) {
            file = try? self.file(for: String(path.dropFirst(Self.prefix.count)))
        } else if path.hasPrefix(Self.svgPrefix) {
            file = try? svgFile(for: String(path.dropFirst(Self.svgPrefix.count)))
        } else {
            return fallback.route(for: path)
        }
        // A path that is not there, for anything refused: the handler answers it as missing.
        return file?.path ?? fallback.route(for: "/_lumiere/missing")
    }

    /// The vault file `rest` (`<vault id>/<path>`) names, if it is one.
    func file(for rest: String, extensions: Set<String> = VaultRouter.servedExtensions) throws -> URL {
        guard let slash = rest.firstIndex(of: "/") else { throw VaultError.invalidPath(rest) }
        let id = String(rest[..<slash])
        let path = String(rest[rest.index(after: slash)...])
        let url = try VaultPath.url(for: path, in: try vaults.root(of: id))
        guard extensions.contains(url.pathExtension.lowercased())
        else { throw VaultError.notFound(path) }
        var isFolder: ObjCBool = false
        guard FileManager.default.fileExists(atPath: url.path, isDirectory: &isFolder), !isFolder.boolValue
        else { throw VaultError.notFound(path) }
        return url
    }

    /// The SVG `rest` (`<vault id>/<path>.svg.txt`) names, if it is one.
    func svgFile(for rest: String) throws -> URL {
        guard rest.hasSuffix(".txt") else { throw VaultError.invalidPath(rest) }
        return try file(for: String(rest.dropLast(".txt".count)), extensions: ["svg"])
    }
}
