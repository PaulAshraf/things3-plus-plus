// The relay (port of packages/cli/src/cloud/connector.ts): one WebSocket to the hosted Things,
// a signed challenge, then a full snapshot followed by patches; runs the actions it's asked for.
// SECURITY: only validated actions run (MacActions.run); there's no delete; nothing becomes code.
import Foundation

final class Connector: NSObject, URLSessionWebSocketDelegate {
  enum Status: Equatable {
    case idle
    case connecting
    case connected
    case offline(String)
    case revoked
  }
  enum Mode: String { case database, basic }

  private let identity: DeviceIdentity
  private let queue = DispatchQueue(label: "dev.things3pp.connector")
  private var session: URLSession!
  private var task: URLSessionWebSocketTask?
  private var stopped = false
  private var backoff: TimeInterval = 1
  private var last: Snapshot?
  private var rev = 0
  private var mode: Mode?
  private var basicLogbook: [TaskItem] = []
  private var basicReads = 0
  private var logbookDue = false
  private var dbPath: String?
  private var lastSeenChange: Date?
  private var pollTimer: DispatchSourceTimer?
  private var pingTimer: DispatchSourceTimer?
  private var tokenCache: (value: String?, at: Date)?

  /// Called on the main queue.
  var onStatus: ((Status) -> Void)?
  var onSync: ((_ items: Int, _ mode: Mode) -> Void)?
  var onLog: ((String) -> Void)?

  init(identity: DeviceIdentity) {
    self.identity = identity
    super.init()
    session = URLSession(configuration: .default, delegate: self, delegateQueue: nil)
  }

  func start() {
    queue.async { self.connect() }
    let t = DispatchSource.makeTimerSource(queue: queue)
    // Cheap check every second (file times); basic mode re-reads every 30 s.
    t.schedule(deadline: .now() + 1, repeating: 1)
    var tick = 0
    t.setEventHandler { [weak self] in
      guard let self else { return }
      tick += 1
      if self.mode == .database, let path = self.dbPath, let changed = ThingsDatabase.lastChange(path: path), changed != self.lastSeenChange {
        self.lastSeenChange = changed
        self.refresh()
      } else if tick % 30 == 0 {
        self.refresh()
      }
    }
    t.resume()
    pollTimer = t
  }

  func stop() {
    queue.async {
      self.stopped = true
      self.pollTimer?.cancel()
      self.pingTimer?.cancel()
      self.task?.cancel(with: .normalClosure, reason: nil)
    }
  }

  /// Re-read Things now (e.g. after the user grants access).
  func poke() { queue.async { self.refresh() } }

  // ----- connection -----

  private func status(_ s: Status) { DispatchQueue.main.async { self.onStatus?(s) } }
  private func log(_ s: String) {
    NSLog("things3pp: %@", s)
    DispatchQueue.main.async { self.onLog?(s) }
  }

  private func connect() {
    guard !stopped, let accountId = identity.accountId, var comps = URLComponents(string: identity.serverURL) else { return }
    comps.scheme = comps.scheme == "http" ? "ws" : "wss"
    comps.path = "/device/connect"
    comps.queryItems = [URLQueryItem(name: "account", value: accountId)]
    guard let url = comps.url else { return }
    status(.connecting)
    let t = session.webSocketTask(with: url)
    task = t
    t.resume()
    receive(t)
  }

  private func receive(_ t: URLSessionWebSocketTask) {
    t.receive { [weak self] result in
      guard let self else { return }
      self.queue.async {
        guard t === self.task else { return }
        switch result {
        case .success(let message):
          if case .string(let text) = message, let data = text.data(using: .utf8), let msg = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            self.handle(msg)
          }
          self.receive(t)
        case .failure:
          self.reconnect(reason: nil)
        }
      }
    }
  }

  func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didCloseWith closeCode: URLSessionWebSocketTask.CloseCode, reason: Data?) {
    queue.async {
      guard webSocketTask === self.task else { return }
      if closeCode.rawValue == 4003 {
        self.log("This Mac isn't recognised anymore (removed, or a different server). Sign in again.")
        self.stopped = true
        self.status(.revoked)
        return
      }
      self.reconnect(reason: reason.flatMap { String(data: $0, encoding: .utf8) })
    }
  }

  private func reconnect(reason: String?) {
    pingTimer?.cancel()
    task = nil
    guard !stopped else { return }
    let wait = min(backoff, 60)
    backoff = min(backoff * 2, 60)
    status(.offline(reason ?? "Can't reach \(URL(string: identity.serverURL)?.host ?? "the server")"))
    queue.asyncAfter(deadline: .now() + wait) { self.connect() }
  }

  private func send(_ obj: [String: Any]) {
    guard let t = task, let data = try? JSONSerialization.data(withJSONObject: obj), let text = String(data: data, encoding: .utf8) else { return }
    t.send(.string(text)) { _ in }
  }

  private func sendEncodable<T: Encodable>(_ type: String, key: String, _ value: T) {
    guard let t = task, let inner = try? JSONEncoder().encode(value), let innerText = String(data: inner, encoding: .utf8) else { return }
    t.send(.string("{\"t\":\"\(type)\",\"\(key)\":\(innerText)}")) { _ in }
  }

  private func handle(_ msg: [String: Any]) {
    switch msg["t"] as? String {
    case "challenge":
      guard let nonce = msg["nonce"] as? String, let deviceId = identity.deviceId else { return }
      let sig = (try? identity.sign("things3pp-device-auth\n\(deviceId)\n\(nonce)")) ?? ""
      send(["t": "auth", "deviceId": deviceId, "signature": sig, "version": Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "dev"])
    case "ready":
      backoff = 1
      status(.connected)
      log("Connected.")
      let p = DispatchSource.makeTimerSource(queue: queue)
      p.schedule(deadline: .now() + 30, repeating: 30)
      p.setEventHandler { [weak self] in self?.task?.send(.string("{\"t\":\"ping\"}")) { _ in } }
      p.resume()
      pingTimer = p
      sendFull()
    case "resync":
      sendFull()
    case "call":
      guard let callId = msg["callId"] as? String, let action = msg["action"] as? [String: Any] else { return }
      let op = action["op"] as? String ?? ""
      let result = MacActions.run(action, token: { self.urlToken() })
      log("\(op): \(result.ok ? "done" : "failed (\(result.error ?? ""))")")
      if op == "setStatus" { logbookDue = true }
      if result.ok {
        // Let Things finish writing, then push the change before answering so readers see it.
        Thread.sleep(forTimeInterval: op == "setChecklist" ? 0.4 : 0.15)
        refresh()
      }
      send(["t": "result", "callId": callId, "result": result.json])
    case "revoked":
      log("This Mac was removed from your hosted Things.")
      stopped = true
      status(.revoked)
      task?.cancel(with: .normalClosure, reason: nil)
    default:
      break
    }
  }

  // ----- reading Things -----

  private func urlToken() -> String? {
    if let c = tokenCache, Date().timeIntervalSince(c.at) < 60 { return c.value }
    let v = dbPath.flatMap { ThingsDatabase.urlSchemeToken(path: $0) }
    tokenCache = (v, Date())
    return v
  }

  private func nextRev() -> Int {
    rev = max(rev + 1, Int(Date().timeIntervalSince1970 * 1000))
    return rev
  }

  /// The database when we can read it (full detail), otherwise AppleScript (basic mode).
  private func read() -> Snapshot? {
    if case .granted(let path) = ThingsDatabase.access() {
      do {
        let snap = try ThingsDatabase.readSnapshot(path: path)
        if mode != .database { log("Reading the Things database (full detail).") }
        dbPath = path
        mode = .database
        return snap
      } catch {
        log(error.localizedDescription)
      }
    }
    do {
      let readLogbook = mode != .basic || logbookDue || { basicReads += 1; return basicReads % 10 == 0 }()
      logbookDue = false
      let (snap, logbook) = try ThingsBridge.basicSnapshot(readLogbook: readLogbook, previousLogbook: basicLogbook)
      basicLogbook = logbook
      if mode != .basic { log("Basic mode: reading Things through AppleScript.") }
      mode = .basic
      return snap
    } catch {
      let message = "Couldn't read Things: \(error.localizedDescription)"
      log(message)
      send(["t": "status", "ok": false, "message": message])
      return nil
    }
  }

  private func sendFull() {
    guard var snap = read() else { return }
    snap.rev = nextRev()
    last = snap
    sendEncodable("snapshot", key: "snapshot", snap)
    send(["t": "status", "ok": true])
    let items = snap.tasks.count, m = mode ?? .basic
    log("Sent \(items) items.")
    DispatchQueue.main.async { self.onSync?(items, m) }
  }

  private func refresh() {
    guard task != nil else { return }
    guard let prev = last else { return sendFull() }
    guard let next = read() else { return }
    guard var patch = diffSnapshots(prev, next) else { return }
    let r = nextRev()
    patch.rev = r
    patch.baseRev = prev.rev
    var stored = next
    stored.rev = r
    last = stored
    sendEncodable("patch", key: "patch", patch)
    let items = next.tasks.count, m = mode ?? .basic
    DispatchQueue.main.async { self.onSync?(items, m) }
  }
}
