import AppKit
import SwiftUI

@main
struct Things3ppApp: App {
  @StateObject private var state = AppState()

  var body: some Scene {
    MenuBarExtra {
      MenuContent().environmentObject(state)
    } label: {
      MenuIcon().environmentObject(state)
    }
    .menuBarExtraStyle(.menu)

    Window("Set up things3pp", id: "setup") {
      SetupView().environmentObject(state)
        .frame(width: 520)
        .onAppear { state.schedulePermissionChecks(fast: true) }
        .onDisappear { state.schedulePermissionChecks(fast: false) }
    }
    .windowResizability(.contentSize)
    .windowStyle(.hiddenTitleBar)
  }
}

struct MenuIcon: View {
  @EnvironmentObject var state: AppState
  @Environment(\.openWindow) private var openWindow
  @State private var opened = false

  var body: some View {
    Image(systemName: symbol)
      .onAppear {
        // First run (or something needs attention): show setup.
        guard !opened, state.needsSetup else { return }
        opened = true
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) {
          NSApp.activate(ignoringOtherApps: true)
          openWindow(id: "setup")
        }
      }
  }

  var symbol: String {
    if !state.isLinked { return "checkmark.circle.badge.questionmark" }
    switch state.status {
    case .connected: return "checkmark.circle.fill"
    case .offline, .revoked: return "exclamationmark.circle"
    default: return "checkmark.circle"
    }
  }
}

struct MenuContent: View {
  @EnvironmentObject var state: AppState
  @Environment(\.openWindow) private var openWindow

  var body: some View {
    Text(state.statusText)
    if state.isLinked, state.mode == .basic {
      Text("Basic mode · no checklists or headings yet")
    }
    Divider()
    Button("Open Things on the Web") { state.openWebApp() }.disabled(!state.isLinked)
    Button(state.needsSetup ? "Finish Setup…" : "Setup…") {
      NSApp.activate(ignoringOtherApps: true)
      openWindow(id: "setup")
    }
    Divider()
    Toggle("Start at Login", isOn: Binding(get: { state.startAtLogin }, set: { state.setStartAtLogin($0) }))
    Button("Quit things3pp") { NSApp.terminate(nil) }.keyboardShortcut("q")
  }
}

// ----- setup window -----

struct SetupView: View {
  @EnvironmentObject var state: AppState
  @State private var advanced = false

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      HStack(spacing: 14) {
        Image(nsImage: NSApp.applicationIconImage).resizable().frame(width: 52, height: 52)
        VStack(alignment: .leading, spacing: 3) {
          Text("Set up things3pp").font(.system(size: 20, weight: .bold))
          Text("Use your Things to-dos on the web and from AI apps. Your Mac stays the source of truth.")
            .foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
        }
      }
      .padding(.bottom, 18)

      VStack(spacing: 0) {
        accountStep
        Divider().padding(.leading, 44)
        StepRow(
          number: 2, title: "Let things3pp control Things",
          detail: "So changes you make on the web reach Things. macOS asks once.",
          state: state.automation == .granted ? .done : state.automation == .denied ? .blocked : .todo
        ) {
          if state.automation == .denied {
            Button("Open Settings") { Permission.openAutomationSettings() }
          } else if state.automation != .granted {
            Button("Allow…") { state.requestAutomation() }.buttonStyle(.borderedProminent)
          }
        }
        Divider().padding(.leading, 44)
        StepRow(
          number: 3, title: "Give access to Things' data", optional: true,
          detail: state.database == .granted
            ? "Checklists, headings and This Evening are included."
            : "Adds checklists, headings and This Evening. In the list that opens, turn on things3pp, or drag it in from the Finder window.",
          state: state.database == .granted ? .done : .optional
        ) {
          if state.database != .granted { Button("Allow Access…") { state.requestDatabase() } }
        }
        Divider().padding(.leading, 44)
        StepRow(
          number: 4, title: "Turn on Things URLs", optional: true,
          detail: state.urlScheme == .granted
            ? "The web app can edit checklists and This Evening."
            : state.database == .granted
              ? "In Things, open Settings → General and turn on “Enable Things URLs”."
              : "Needed to edit checklists and This Evening. Finish step 3 first.",
          state: state.urlScheme == .granted ? .done : .optional
        ) {
          if state.urlScheme != .granted && state.database == .granted { Button("Open Things") { Permission.openThings() } }
        }
      }
      .background(RoundedRectangle(cornerRadius: 10).fill(Color(nsColor: .controlBackgroundColor)))
      .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(Color(nsColor: .separatorColor).opacity(0.5)))

      if !state.thingsInstalled {
        Label("Things 3 isn't installed on this Mac.", systemImage: "exclamationmark.triangle.fill")
          .foregroundStyle(.orange).padding(.top, 12)
      }

      HStack {
        Toggle("Start at login", isOn: Binding(get: { state.startAtLogin }, set: { state.setStartAtLogin($0) }))
        Spacer()
        if state.isLinked {
          Text(state.statusText).font(.callout).foregroundStyle(.secondary).lineLimit(1)
          Button("Open Things on the Web") { state.openWebApp() }.buttonStyle(.borderedProminent).disabled(state.automation != .granted && state.items == 0)
        }
      }
      .padding(.top, 16)
    }
    .padding(24)
  }

  @ViewBuilder var accountStep: some View {
    StepRow(
      number: 1, title: state.isLinked ? "Signed in" : "Sign in",
      detail: state.isLinked
        ? "Linked to \(URL(string: state.identity?.serverURL ?? "")?.host ?? "your Things") as “\(state.identity?.name ?? "this Mac")”."
        : state.pairingCode.map { "Confirm the code \($0) in your browser and create your passkey." }
          ?? state.pairingError
          ?? "Opens your browser to create a passkey (Touch ID). No password.",
      state: state.isLinked ? .done : state.pairingError != nil ? .blocked : .todo
    ) {
      if state.isLinked {
        Menu("…") {
          Button("Add a New Passkey") { state.signIn() }
          Button("Sign Out of This Mac", role: .destructive) { state.signOut() }
        }
        .menuStyle(.borderlessButton).fixedSize()
      } else if state.pairing {
        HStack {
          ProgressView().controlSize(.small)
          Button("Cancel") { state.cancelSignIn() }
        }
      } else {
        Button("Sign In…") { state.signIn() }.buttonStyle(.borderedProminent)
      }
    }
    if !state.isLinked {
      if let cli = state.cliIdentity {
        HStack {
          Text("Already linked from Terminal as “\(cli.name)”.").font(.callout).foregroundStyle(.secondary)
          Spacer()
          Button("Use That Link") { state.importCLILink() }
        }
        .padding(.horizontal, 14).padding(.bottom, 10).padding(.leading, 30)
      }
      DisclosureGroup("Server", isExpanded: $advanced) {
        TextField("https://things.example.com", text: $state.serverURL).textFieldStyle(.roundedBorder)
        Text("Leave as is unless you host your own (things3pp cloud deploy).").font(.caption).foregroundStyle(.secondary)
      }
      .font(.callout).padding(.horizontal, 14).padding(.bottom, 10).padding(.leading, 30)
    }
  }
}

struct StepRow<Actions: View>: View {
  enum Mark { case done, todo, optional, blocked }
  let number: Int
  let title: String
  var optional = false
  let detail: String
  let state: Mark
  @ViewBuilder var actions: () -> Actions

  var body: some View {
    HStack(alignment: .top, spacing: 12) {
      ZStack {
        Circle().fill(color.opacity(state == .done ? 1 : 0.15)).frame(width: 22, height: 22)
        if state == .done {
          Image(systemName: "checkmark").font(.system(size: 11, weight: .bold)).foregroundStyle(.white)
        } else if state == .blocked {
          Image(systemName: "exclamationmark").font(.system(size: 11, weight: .bold)).foregroundStyle(color)
        } else {
          Text("\(number)").font(.system(size: 11, weight: .semibold)).foregroundStyle(color)
        }
      }
      .padding(.top, 1)
      VStack(alignment: .leading, spacing: 3) {
        HStack(spacing: 6) {
          Text(title).font(.system(size: 13, weight: .semibold))
          if optional && state != .done { Text("Optional").font(.caption2.weight(.medium)).padding(.horizontal, 5).padding(.vertical, 1).background(Capsule().fill(.quaternary)) }
        }
        Text(detail).font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
      }
      Spacer(minLength: 8)
      actions()
    }
    .padding(14)
    .animation(.easeOut(duration: 0.2), value: state)
  }

  var color: Color {
    switch state {
    case .done: return .green
    case .todo: return .accentColor
    case .optional: return .secondary
    case .blocked: return .orange
    }
  }
}
