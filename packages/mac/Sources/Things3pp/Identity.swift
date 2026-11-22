// This Mac's link to a hosted Things: server URL + device key (Ed25519) + ids, kept in the Keychain.
import CryptoKit
import Foundation
import Security

struct DeviceIdentity: Codable, Equatable {
  var serverURL: String
  var name: String
  /// Raw 32-byte Curve25519 signing key, base64. Never leaves this Mac.
  var privateKey: String
  /// Raw Ed25519 public key, base64url (what the Worker stores).
  var publicKey: String
  var accountId: String?
  var deviceId: String?

  var isLinked: Bool { accountId != nil && deviceId != nil }

  static func fresh(serverURL: String) -> DeviceIdentity {
    let key = Curve25519.Signing.PrivateKey()
    return DeviceIdentity(
      serverURL: serverURL, name: Host.current().localizedName ?? "Mac",
      privateKey: key.rawRepresentation.base64EncodedString(), publicKey: base64url(key.publicKey.rawRepresentation))
  }

  func sign(_ text: String) throws -> String {
    guard let raw = Data(base64Encoded: privateKey) else { throw DatabaseError(message: "Broken device key. Sign in again.") }
    let key = try Curve25519.Signing.PrivateKey(rawRepresentation: raw)
    return base64url(try key.signature(for: Data(text.utf8)))
  }
}

func base64url(_ d: Data) -> String {
  d.base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
}

func base64urlDecode(_ s: String) -> Data? {
  var b = s.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
  while b.count % 4 != 0 { b += "=" }
  return Data(base64Encoded: b)
}

enum Keychain {
  static let service = "dev.things3pp.app"
  static let account = "device"

  static func load() -> DeviceIdentity? {
    let q: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account, kSecReturnData as String: true]
    var out: CFTypeRef?
    guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let data = out as? Data else { return nil }
    return try? JSONDecoder().decode(DeviceIdentity.self, from: data)
  }

  static func save(_ id: DeviceIdentity) {
    guard let data = try? JSONEncoder().encode(id) else { return }
    let q: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account]
    let attrs: [String: Any] = [kSecValueData as String: data, kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly]
    if SecItemUpdate(q as CFDictionary, attrs as CFDictionary) == errSecItemNotFound {
      SecItemAdd(q.merging(attrs) { $1 } as CFDictionary, nil)
    }
  }

  static func delete() {
    let q: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account]
    SecItemDelete(q as CFDictionary)
  }
}

/// Takes over a link made with the `things3pp` CLI (~/.config/things3pp/cloud.json), so people
/// who set it up from Terminal don't have to pair again. Returns nil if there's nothing to import.
enum CLIImport {
  static var configPath: URL {
    let base = ProcessInfo.processInfo.environment["XDG_CONFIG_HOME"].map { URL(fileURLWithPath: $0) }
      ?? FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".config")
    return base.appendingPathComponent("things3pp/cloud.json")
  }

  static func linkedIdentity() -> DeviceIdentity? {
    guard let data = try? Data(contentsOf: configPath),
      let cfg = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
      let url = cfg["url"] as? String,
      let device = cfg["device"] as? [String: Any],
      let pem = device["privateKey"] as? String,
      let accountId = device["accountId"] as? String, let deviceId = device["deviceId"] as? String,
      let raw = rawKey(fromPKCS8PEM: pem)
    else { return nil }
    guard let key = try? Curve25519.Signing.PrivateKey(rawRepresentation: raw) else { return nil }
    return DeviceIdentity(
      serverURL: url, name: device["name"] as? String ?? (Host.current().localizedName ?? "Mac"),
      privateKey: raw.base64EncodedString(), publicKey: base64url(key.publicKey.rawRepresentation),
      accountId: accountId, deviceId: deviceId)
  }

  /// PKCS#8 Ed25519 private key: the last 32 bytes of the DER are the seed.
  static func rawKey(fromPKCS8PEM pem: String) -> Data? {
    let b64 = pem.split(separator: "\n").filter { !$0.hasPrefix("-----") }.joined()
    guard let der = Data(base64Encoded: b64), der.count >= 32 else { return nil }
    return der.suffix(32)
  }

  static let agentLabel = "dev.things3pp.agent"
  static var agentPlist: URL { FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/LaunchAgents/\(agentLabel).plist") }

  /// The CLI's background agent would fight the app for the same connection; stop and remove it.
  static func removeCLIAgent() {
    guard FileManager.default.fileExists(atPath: agentPlist.path) else { return }
    let p = Process()
    p.executableURL = URL(fileURLWithPath: "/bin/launchctl")
    p.arguments = ["bootout", "gui/\(getuid())", agentPlist.path]
    try? p.run()
    p.waitUntilExit()
    try? FileManager.default.removeItem(at: agentPlist)
  }
}
