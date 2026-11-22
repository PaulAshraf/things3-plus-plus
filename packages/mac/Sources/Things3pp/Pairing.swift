// Sign in = pair this Mac with the hosted Things: the browser opens with a code, you confirm and
// create a passkey there, and the app gets its account + device ids. Same API as `things3pp connect`.
import AppKit
import Foundation

struct PairingError: Error, LocalizedError {
  let message: String
  var errorDescription: String? { message }
}

enum Pairing {
  struct Started: Decodable {
    let pairingId: String
    let code: String
    let pollToken: String
    let expiresAt: Double
    let approveUrl: String
  }

  static func post(_ url: URL, _ body: [String: Any]) async throws -> [String: Any] {
    var req = URLRequest(url: url)
    req.httpMethod = "POST"
    req.setValue("application/json", forHTTPHeaderField: "content-type")
    req.httpBody = try JSONSerialization.data(withJSONObject: body)
    req.timeoutInterval = 20
    let (data, res) = try await URLSession.shared.data(for: req)
    let json = (try? JSONSerialization.jsonObject(with: data) as? [String: Any]) ?? [:]
    if let http = res as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
      throw PairingError(message: json["message"] as? String ?? "The server answered \(http.statusCode).")
    }
    return json
  }

  /// Starts pairing, opens the browser, and waits for approval. `onCode` shows the code in the UI.
  static func pair(identity start: DeviceIdentity, setupKey: String?, onCode: @escaping (String) -> Void) async throws -> DeviceIdentity {
    var identity = start
    guard let base = URL(string: identity.serverURL) else { throw PairingError(message: "That server address doesn't look right.") }
    var body: [String: Any] = ["publicKey": identity.publicKey, "deviceName": sanitizedName(identity.name)]
    if let setupKey { body["setupKey"] = setupKey }
    if let accountId = identity.accountId, let deviceId = identity.deviceId {
      // Already linked: this adds a new passkey (lost-passkey recovery), proven with the device key.
      let ts = Int(Date().timeIntervalSince1970 * 1000)
      body["recover"] = ["accountId": accountId, "deviceId": deviceId, "ts": ts, "signature": try identity.sign("things3pp-recover\n\(deviceId)\n\(ts)")]
    }
    let json = try await post(base.appendingPathComponent("api/pair/start"), body)
    let data = try JSONSerialization.data(withJSONObject: json)
    let started = try JSONDecoder().decode(Started.self, from: data)
    onCode(started.code)
    if let url = URL(string: started.approveUrl) { NSWorkspace.shared.open(url) }

    while Date().timeIntervalSince1970 * 1000 < started.expiresAt {
      try await Task.sleep(nanoseconds: 2_000_000_000)
      try Task.checkCancellation()
      guard let res = try? await post(base.appendingPathComponent("api/pair/poll"), ["pairingId": started.pairingId, "pollToken": started.pollToken]) else { continue }
      if res["status"] as? String == "approved", let a = res["accountId"] as? String, let d = res["deviceId"] as? String {
        identity.accountId = a
        identity.deviceId = d
        return identity
      }
      if res["status"] as? String == "expired" { break }
    }
    throw PairingError(message: "The code expired before it was approved. Try again.")
  }

  static func sanitizedName(_ s: String) -> String {
    let allowed = s.unicodeScalars.filter { CharacterSet.alphanumerics.contains($0) || " ’'._()-".unicodeScalars.contains($0) }
    let name = String(String.UnicodeScalarView(allowed)).trimmingCharacters(in: .whitespaces)
    return name.isEmpty ? "Mac" : String(name.prefix(64))
  }
}
