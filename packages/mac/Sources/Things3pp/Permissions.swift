// Live checks for each setup step, plus the buttons that help you grant them.
import AppKit
import ApplicationServices
import Foundation

enum Permission {
  enum State: Equatable { case granted, denied, unknown }

  static let thingsBundleId = "com.culturedcode.ThingsMac"

  /// Can this app send Apple Events to Things? `ask` shows macOS's prompt if it hasn't been answered.
  /// Blocks while the prompt is up: call off the main thread.
  static func automation(ask: Bool) -> State {
    guard NSRunningApplication.runningApplications(withBundleIdentifier: thingsBundleId).first != nil || ask else { return .unknown }
    if ask && NSRunningApplication.runningApplications(withBundleIdentifier: thingsBundleId).isEmpty {
      // The check needs Things running.
      if let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: thingsBundleId) {
        let config = NSWorkspace.OpenConfiguration()
        config.activates = false
        NSWorkspace.shared.openApplication(at: url, configuration: config)
        Thread.sleep(forTimeInterval: 2)
      }
    }
    var target = AEAddressDesc()
    let bundle = thingsBundleId.data(using: .utf8)!
    let created = bundle.withUnsafeBytes { AECreateDesc(DescType(typeApplicationBundleID), $0.baseAddress, bundle.count, &target) }
    guard created == noErr else { return .unknown }
    defer { AEDisposeDesc(&target) }
    let status = AEDeterminePermissionToAutomateTarget(&target, AEEventClass(typeWildCard), AEEventID(typeWildCard), ask)
    switch status {
    case noErr: return .granted
    case OSStatus(errAEEventNotPermitted): return .denied
    default: return .unknown  // e.g. procNotFound / not yet asked
    }
  }

  static func database() -> State {
    switch ThingsDatabase.access() {
    case .granted: return .granted
    case .denied: return .denied
    case .notFound: return .unknown
    }
  }

  /// Things URLs on? Only knowable when the database is readable.
  static func urlScheme() -> State {
    guard case .granted(let path) = ThingsDatabase.access() else { return .unknown }
    return ThingsDatabase.urlSchemeToken(path: path) != nil ? .granted : .denied
  }

  static func thingsInstalled() -> Bool {
    NSWorkspace.shared.urlForApplication(withBundleIdentifier: thingsBundleId) != nil
  }

  static func openFullDiskAccessSettings() {
    NSWorkspace.shared.open(URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles")!)
  }
  static func openAutomationSettings() {
    NSWorkspace.shared.open(URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Automation")!)
  }
  static func revealApp() {
    NSWorkspace.shared.activateFileViewerSelecting([Bundle.main.bundleURL])
  }
  static func openThings() {
    if let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: thingsBundleId) { NSWorkspace.shared.open(url) }
  }
}
