import AppKit
import Foundation
import ServiceManagement

@MainActor
final class AppState: ObservableObject {
  static let defaultServer = (Bundle.main.object(forInfoDictionaryKey: "Things3ppServerURL") as? String) ?? "https://things.paulashraf.com"

  @Published var identity: DeviceIdentity?
  @Published var serverURL: String
  @Published var status: Connector.Status = .idle
  @Published var mode: Connector.Mode?
  @Published var items = 0
  @Published var lastSync: Date?
  @Published var lastLog = ""

  @Published var automation: Permission.State = .unknown
  @Published var database: Permission.State = .unknown
  @Published var urlScheme: Permission.State = .unknown
  @Published var thingsInstalled = Permission.thingsInstalled()

  @Published var pairingCode: String?
  @Published var pairing = false
  @Published var pairingError: String?
  @Published var cliIdentity: DeviceIdentity?
  @Published var startAtLogin = SMAppService.mainApp.status == .enabled

  private var connector: Connector?
  private var pairTask: Task<Void, Never>?
  private var permissionTimer: Timer?
  private var fastPolling = false

  var isLinked: Bool { identity?.isLinked == true }
  var needsSetup: Bool { !isLinked || automation != .granted }

  init() {
    identity = Keychain.load()
    serverURL = Keychain.load()?.serverURL ?? AppState.defaultServer
    if identity == nil { cliIdentity = CLIImport.linkedIdentity() }
    refreshPermissions()
    schedulePermissionChecks(fast: false)
    if isLinked { startConnector() }
    // First launch: start at login by default.
    if !UserDefaults.standard.bool(forKey: "didSetLoginItem") {
      UserDefaults.standard.set(true, forKey: "didSetLoginItem")
      setStartAtLogin(true)
    }
  }

  // ----- permissions -----

  func schedulePermissionChecks(fast: Bool) {
    fastPolling = fast
    permissionTimer?.invalidate()
    permissionTimer = Timer.scheduledTimer(withTimeInterval: fast ? 2 : 30, repeats: true) { [weak self] _ in
      Task { @MainActor in self?.refreshPermissions() }
    }
  }

  func refreshPermissions() {
    Task.detached(priority: .utility) {
      let db = Permission.database()
      let url = Permission.urlScheme()
      let auto = Permission.automation(ask: false)
      let installed = Permission.thingsInstalled()
      await MainActor.run {
        let gainedData = db == .granted && self.database != .granted
        self.database = db
        self.urlScheme = url
        if auto != .unknown || self.automation == .unknown { self.automation = auto }
        self.thingsInstalled = installed
        if gainedData { self.connector?.poke() }  // switch to full detail right away
      }
    }
  }

  func requestAutomation() {
    Task.detached(priority: .userInitiated) {
      let s = Permission.automation(ask: true)
      await MainActor.run {
        self.automation = s
        if s == .denied { Permission.openAutomationSettings() }
        self.connector?.poke()
      }
    }
  }

  func requestDatabase() {
    // Touching the container is what makes macOS ask (where it asks); otherwise guide to the pane.
    Task.detached(priority: .userInitiated) {
      let s = Permission.database()
      await MainActor.run {
        self.database = s
        if s != .granted {
          Permission.openFullDiskAccessSettings()
          Permission.revealApp()
        } else {
          self.connector?.poke()
        }
      }
    }
  }

  // ----- account -----

  func signIn() {
    pairTask?.cancel()
    pairingError = nil
    pairingCode = nil
    pairing = true
    let base = identity?.serverURL == serverURL ? identity! : DeviceIdentity.fresh(serverURL: normalized(serverURL))
    pairTask = Task {
      do {
        let linked = try await Pairing.pair(identity: base, setupKey: nil) { code in
          Task { @MainActor in self.pairingCode = code }
        }
        Keychain.save(linked)
        self.identity = linked
        self.pairing = false
        self.pairingCode = nil
        self.startConnector()
      } catch is CancellationError {
        self.pairing = false
      } catch {
        self.pairing = false
        self.pairingCode = nil
        self.pairingError = error.localizedDescription
      }
    }
  }

  func cancelSignIn() {
    pairTask?.cancel()
    pairing = false
    pairingCode = nil
  }

  /// Use the link made with the `things3pp` CLI, and stop the CLI's background agent.
  func importCLILink() {
    guard let cli = cliIdentity else { return }
    CLIImport.removeCLIAgent()
    Keychain.save(cli)
    identity = cli
    serverURL = cli.serverURL
    cliIdentity = nil
    startConnector()
  }

  func signOut() {
    connector?.stop()
    connector = nil
    Keychain.delete()
    identity = nil
    status = .idle
    mode = nil
  }

  private func normalized(_ s: String) -> String {
    var v = s.trimmingCharacters(in: .whitespacesAndNewlines)
    if !v.hasPrefix("http://") && !v.hasPrefix("https://") { v = "https://" + v }
    while v.hasSuffix("/") { v.removeLast() }
    return v
  }

  // ----- relay -----

  private func startConnector() {
    connector?.stop()
    guard let identity, identity.isLinked else { return }
    let c = Connector(identity: identity)
    c.onStatus = { [weak self] s in
      self?.status = s
      if s == .revoked { self?.signOut() }
    }
    c.onSync = { [weak self] n, m in
      self?.items = n
      self?.mode = m
      self?.lastSync = Date()
    }
    c.onLog = { [weak self] l in self?.lastLog = l }
    c.start()
    connector = c
  }

  func openWebApp() {
    if let url = URL(string: identity?.serverURL ?? serverURL) { NSWorkspace.shared.open(url) }
  }

  func setStartAtLogin(_ on: Bool) {
    do {
      if on { try SMAppService.mainApp.register() } else { try SMAppService.mainApp.unregister() }
    } catch {
      NSLog("things3pp: login item: %@", error.localizedDescription)
    }
    startAtLogin = SMAppService.mainApp.status == .enabled
  }

  var statusText: String {
    switch status {
    case .idle: return isLinked ? "Starting…" : "Not signed in"
    case .connecting: return "Connecting…"
    case .connected:
      if let lastSync { return "Synced \(items) items · \(lastSync.formatted(date: .omitted, time: .shortened))" }
      return "Connected"
    case .offline(let why): return "Offline · \(why)"
    case .revoked: return "Signed out on the server"
    }
  }
}
