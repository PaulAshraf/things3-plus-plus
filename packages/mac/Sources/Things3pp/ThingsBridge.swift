// Talks to Things through the same bundled JXA bridge the CLI uses (things.jxa.js), run by
// /usr/bin/osascript as a child of this app, so macOS attributes the permission to "things3pp".
// SECURITY: the scripts run verbatim; input is a single JSON argv string; nothing becomes code.
import AppKit
import Foundation

struct ThingsBridgeError: Error, LocalizedError {
  let message: String
  let code: String
  var errorDescription: String? { message }
}

enum ThingsBridge {
  static let listIds = ["inbox": "TMInboxListSource", "anytime": "TMNextListSource", "someday": "TMSomedayListSource"]

  static func script(_ name: String) -> String? {
    let parts = name.split(separator: ".", maxSplits: 1).map(String.init)
    if let url = Bundle.main.url(forResource: parts[0], withExtension: parts.count > 1 ? parts[1] : nil),
      let s = try? String(contentsOf: url)
    {
      return s
    }
    // `swift run` from the repo: use the source copy.
    let repo = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("../../../core/src/things/\(name)")
    return try? String(contentsOf: repo.standardizedFileURL)
  }

  /// Runs osascript with a static script and data arguments. Returns stdout.
  static func osascript(language: String, scriptName: String, args: [String], timeout: TimeInterval = 30) throws -> String {
    guard let source = script(scriptName) else { throw ThingsBridgeError(message: "Missing bundled script \(scriptName). Reinstall things3pp.", code: "things_error") }
    let p = Process()
    p.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
    p.arguments = ["-l", language, "-e", source] + args
    let out = Pipe(), err = Pipe()
    p.standardOutput = out
    p.standardError = err
    try p.run()
    let deadline = Date().addingTimeInterval(timeout)
    while p.isRunning && Date() < deadline { Thread.sleep(forTimeInterval: 0.02) }
    if p.isRunning {
      p.terminate()
      throw ThingsBridgeError(message: "Things didn't respond in time. If macOS is showing a permission prompt, click OK and try again.", code: "timeout")
    }
    let stdout = String(data: out.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
    let stderr = String(data: err.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
    if p.terminationStatus != 0 { throw mapError(stderr, nil) }
    return stdout
  }

  static func mapError(_ message: String, _ number: Int?) -> ThingsBridgeError {
    let n = number ?? Int(message.range(of: #"\((-?\d+)\)\s*$"#, options: .regularExpression).map { String(message[$0]).trimmingCharacters(in: CharacterSet(charactersIn: "() \n")) } ?? "")
    if n == -1743 || message.range(of: "not authori", options: .caseInsensitive) != nil {
      return ThingsBridgeError(message: "macOS blocked things3pp from controlling Things. Open System Settings → Privacy & Security → Automation and turn on Things3 under things3pp.", code: "permission_denied")
    }
    if n == -1712 {
      return ThingsBridgeError(message: "Things didn't respond. macOS may be waiting for you to allow things3pp to control Things.", code: "permission_pending")
    }
    if message.range(of: "Application can.t be found", options: .regularExpression) != nil {
      return ThingsBridgeError(message: "Things 3 doesn't seem to be installed.", code: "not_installed")
    }
    if message.hasPrefix("No to-do") || message.hasPrefix("No project") || message.hasPrefix("No area") || n == -1728 {
      return ThingsBridgeError(message: message, code: "not_found")
    }
    return ThingsBridgeError(message: "Things reported an error: \(message.trimmingCharacters(in: .whitespacesAndNewlines))", code: "things_error")
  }

  /// One bridge operation, e.g. call("addTodo", ["title": "Milk"]).
  static func call(_ op: String, _ args: [String: Any] = [:]) throws -> Any? {
    let input = try JSONSerialization.data(withJSONObject: ["op": op, "args": args])
    let stdout = try osascript(language: "JavaScript", scriptName: "things.jxa.js", args: [String(data: input, encoding: .utf8)!])
    guard let data = stdout.trimmingCharacters(in: .whitespacesAndNewlines).data(using: .utf8),
      let res = try JSONSerialization.jsonObject(with: data) as? [String: Any]
    else { throw ThingsBridgeError(message: "Unexpected response from Things: \(stdout.prefix(200))", code: "things_error") }
    if res["ok"] as? Bool == true { return res["data"] }
    throw mapError(res["error"] as? String ?? "Unknown error", res["errorNumber"] as? Int)
  }

  /// Moves to Inbox / Anytime / Someday (JXA's move is broken; see move.applescript).
  static func move(_ id: String, to list: String) throws {
    guard let listId = listIds[list] else { return }
    _ = try osascript(language: "AppleScript", scriptName: "move.applescript", args: [id, listId])
  }

  // ----- basic mode: snapshot from AppleScript (port of applescript-snapshot.ts) -----

  static func basicSnapshot(readLogbook: Bool, previousLogbook: [TaskItem]) throws -> (Snapshot, [TaskItem]) {
    guard let raw = try call("snapshot", ["logbook": readLogbook, "logbookLimit": 500]) as? [String: Any] else {
      throw ThingsBridgeError(message: "Things returned no data.", code: "things_error")
    }
    let rawTags = raw["tags"] as? [[String: Any]] ?? []
    let tags = rawTags.enumerated().map { i, t in TagItem(id: t["id"] as? String ?? "", title: t["title"] as? String ?? "", parentId: t["parentId"] as? String, shortcut: nil, index: i) }
    var tagIdByName: [String: String] = [:]
    for t in tags { tagIdByName[t.title] = t.id }
    let areas = (raw["areas"] as? [[String: Any]] ?? []).enumerated().map { i, a in AreaItem(id: a["id"] as? String ?? "", title: a["title"] as? String ?? "", index: i, tags: []) }
    let lists = raw["lists"] as? [String: [String]] ?? [:]
    func position(_ key: String) -> [String: Int] {
      var m: [String: Int] = [:]
      for (i, id) in (lists[key] ?? []).enumerated() { m[id] = i }
      return m
    }
    let inbox = position("inbox"), today = position("today"), upcoming = position("upcoming"), anytime = position("anytime"), someday = position("someday")

    func toTask(_ r: [String: Any], start: String, index: Int, todayIndex: Int) -> TaskItem {
      let status = r["status"] as? String ?? "open"
      return TaskItem(
        id: r["id"] as? String ?? "", kind: r["kind"] as? String ?? "todo", title: r["title"] as? String ?? "", notes: r["notes"] as? String ?? "",
        status: status, start: start, when: r["when"] as? String, evening: false, deadline: r["deadline"] as? String, reminder: nil,
        areaId: r["areaId"] as? String, projectId: r["projectId"] as? String, headingId: nil,
        tags: (r["tagNames"] as? [String] ?? []).compactMap { tagIdByName[$0] }, checklist: [], index: index, todayIndex: todayIndex,
        repeating: false, trashed: false, createdAt: r["createdAt"] as? String, modifiedAt: r["modifiedAt"] as? String,
        completedAt: status == "open" ? nil : r["completedAt"] as? String)
    }

    let items = raw["items"] as? [[String: Any]] ?? []
    let tasks: [TaskItem] = items.enumerated().map { i, r in
      let id = r["id"] as? String ?? ""
      let start = inbox[id] != nil ? "inbox" : (someday[id] != nil || upcoming[id] != nil) ? "someday" : "anytime"
      let index = inbox[id] ?? anytime[id] ?? someday[id] ?? upcoming[id] ?? (10_000 + i)
      return toTask(r, start: start, index: index, todayIndex: today[id] ?? (10_000 + i))
    }
    let open = Set(tasks.map(\.id))
    let logbook: [TaskItem]
    if let rawLog = raw["logbook"] as? [[String: Any]] {
      logbook = rawLog.enumerated().compactMap { i, r in open.contains(r["id"] as? String ?? "") ? nil : toTask(r, start: "anytime", index: i, todayIndex: 0) }
    } else {
      logbook = previousLogbook.filter { !open.contains($0.id) }
    }
    let snap = Snapshot(
      rev: 0, generatedAt: isoFormatter.string(from: Date()), timeZone: TimeZone.current.identifier,
      tasks: tasks + logbook, areas: areas, tags: tags, capabilities: Capabilities(urlScheme: false, database: false))
    return (snap, logbook)
  }
}

// ----- relay actions (port of packages/core/src/things/actions.ts) -----

struct ActionResult {
  var ok: Bool
  var id: String? = nil
  var data: Any? = nil
  var error: String? = nil
  var code: String? = nil

  var json: [String: Any] {
    var o: [String: Any] = ["ok": ok]
    if let id { o["id"] = id }
    if let data { o["data"] = data }
    if let error { o["error"] = error }
    if let code { o["code"] = code }
    return o
  }
}

enum MacActions {
  static let urlSchemeHelp = "This change needs Things URLs. In Things, open Settings → General, turn on \"Enable Things URLs\", and try again."
  static let dayRegex = try! NSRegularExpression(pattern: #"^\d{4}-\d{2}-\d{2}$"#)

  /// Validates like ActionSchema (zod) in core, then runs it. Never throws.
  static func run(_ action: [String: Any], token: () -> String?) -> ActionResult {
    guard let op = action["op"] as? String else { return invalid("missing op") }
    let args = action["args"] as? [String: Any] ?? [:]
    do {
      try validate(op: op, args: args)
      switch op {
      case "addTodo": return try addTodo(args, token: token)
      case "addProject":
        let r = try writeThenMove("addProject", args, id: nil)
        return ActionResult(ok: true, id: (r as? [String: Any])?["id"] as? String, data: r)
      case "update": return try update(args, token: token)
      case "setStatus":
        let r = try ThingsBridge.call("setStatus", ["id": args["id"]!, "status": args["status"]!])
        return ActionResult(ok: true, id: args["id"] as? String, data: r)
      case "setChecklist":
        guard let t = token() else { throw ThingsBridgeError(message: urlSchemeHelp, code: "things_error") }
        let items = (args["items"] as? [[String: Any]] ?? []).map { ["type": "checklist-item", "attributes": ["title": $0["title"] ?? "", "completed": $0["done"] ?? false]] }
        try jsonUpdate(token: t, id: args["id"] as! String, attributes: ["checklist-items": items])
        return ActionResult(ok: true, id: args["id"] as? String)
      case "refresh": return ActionResult(ok: true)
      default: return invalid("unknown operation")
      }
    } catch let e as ThingsBridgeError {
      return ActionResult(ok: false, error: e.message, code: e.code)
    } catch let e as ValidationError {
      return invalid(e.message)
    } catch {
      return ActionResult(ok: false, error: error.localizedDescription, code: "things_error")
    }
  }

  struct ValidationError: Error { let message: String }
  private static func invalid(_ why: String) -> ActionResult { ActionResult(ok: false, error: "Invalid request: \(why)", code: "invalid") }

  private static func validate(op: String, args: [String: Any]) throws {
    let allowed: [String: Set<String>] = [
      "addTodo": ["title", "notes", "when", "evening", "deadline", "tags", "project", "area", "headingId", "checklist"],
      "addProject": ["title", "notes", "when", "deadline", "tags", "area", "todos"],
      "update": ["id", "title", "notes", "when", "evening", "deadline", "tags", "project", "area", "headingId"],
      "setStatus": ["id", "status"],
      "setChecklist": ["id", "items"],
      "refresh": [],
    ]
    guard let keys = allowed[op] else { throw ValidationError(message: "unknown operation") }
    for k in args.keys where !keys.contains(k) { throw ValidationError(message: "unexpected field \(k)") }
    func string(_ k: String, max: Int, required: Bool = false) throws {
      guard let v = args[k] else {
        if required { throw ValidationError(message: "\(k) is required") }
        return
      }
      guard let s = v as? String, !s.trimmingCharacters(in: .whitespaces).isEmpty || k == "notes", s.count <= max else { throw ValidationError(message: "bad \(k)") }
    }
    func day(_ k: String, nullable: Bool = false) throws {
      guard let v = args[k] else { return }
      if v is NSNull, nullable { return }
      guard let s = v as? String, dayRegex.firstMatch(in: s, range: NSRange(s.startIndex..., in: s)) != nil else { throw ValidationError(message: "\(k) must be YYYY-MM-DD") }
    }
    if ["update", "setStatus", "setChecklist"].contains(op) { try string("id", max: 200, required: true) }
    if op == "addTodo" || op == "addProject" { try string("title", max: 1000, required: true) } else { try string("title", max: 1000) }
    try string("notes", max: 10_000)
    try string("project", max: 500)
    try string("area", max: 500)
    try string("headingId", max: 200)
    try day("deadline", nullable: op == "update")
    if let w = args["when"] {
      guard let s = w as? String, ["today", "anytime", "someday", "inbox"].contains(s) || dayRegex.firstMatch(in: s, range: NSRange(s.startIndex..., in: s)) != nil else {
        throw ValidationError(message: "bad when")
      }
    }
    if let e = args["evening"], !(e is Bool) { throw ValidationError(message: "bad evening") }
    if let t = args["tags"] { guard let a = t as? [String], a.count <= 50, a.allSatisfy({ !$0.isEmpty && $0.count <= 100 }) else { throw ValidationError(message: "bad tags") } }
    if let t = args["todos"] { guard let a = t as? [String], a.count <= 100 else { throw ValidationError(message: "bad todos") } }
    if let c = args["checklist"] { guard let a = c as? [String], a.count <= 200 else { throw ValidationError(message: "bad checklist") } }
    if op == "setStatus" { guard let s = args["status"] as? String, ["open", "completed", "canceled"].contains(s) else { throw ValidationError(message: "bad status") } }
    if op == "setChecklist" {
      guard let items = args["items"] as? [[String: Any]], items.count <= 200,
        items.allSatisfy({ ($0["title"] as? String).map { !$0.isEmpty && $0.count <= 1000 } ?? false && $0["done"] is Bool })
      else { throw ValidationError(message: "bad items") }
    }
  }

  private static func isListMove(_ when: Any?) -> String? {
    guard let w = when as? String, ["inbox", "anytime", "someday"].contains(w) else { return nil }
    return w
  }

  /// Runs a write op, then a list move if `when` was inbox/anytime/someday (like ThingsClient.writeThenMove).
  private static func writeThenMove(_ op: String, _ input: [String: Any], id: String?) throws -> Any? {
    var args = input
    let move = isListMove(args["when"])
    if move != nil { args.removeValue(forKey: "when") }
    let result = try ThingsBridge.call(op, args)
    guard let list = move else { return result }
    let targetId = id ?? ((result as? [String: Any])?["id"] as? String) ?? ""
    try ThingsBridge.move(targetId, to: list)
    return try ThingsBridge.call("get", ["id": targetId])
  }

  private static func jsonUpdate(token: String, id: String, attributes: [String: Any]) throws {
    let payload = try JSONSerialization.data(withJSONObject: [["type": "to-do", "operation": "update", "id": id, "attributes": attributes]])
    var comps = URLComponents()
    comps.scheme = "things"
    comps.host = ""
    comps.path = "/json"
    comps.queryItems = [URLQueryItem(name: "auth-token", value: token), URLQueryItem(name: "data", value: String(data: payload, encoding: .utf8))]
    guard let url = comps.url else { throw ThingsBridgeError(message: "Couldn't build the Things link.", code: "things_error") }
    let config = NSWorkspace.OpenConfiguration()
    config.activates = false
    let sem = DispatchSemaphore(value: 0)
    var failure: Error?
    NSWorkspace.shared.open(url, configuration: config) { _, err in
      failure = err
      sem.signal()
    }
    _ = sem.wait(timeout: .now() + 15)
    if let failure { throw failure }
  }

  private static func addTodo(_ input: [String: Any], token: () -> String?) throws -> ActionResult {
    var basic = input
    let evening = basic.removeValue(forKey: "evening") as? Bool ?? false
    let headingId = basic.removeValue(forKey: "headingId") as? String
    let checklist = basic.removeValue(forKey: "checklist") as? [String] ?? []
    if evening { basic["when"] = "today" }
    let todo = try writeThenMove("addTodo", basic, id: nil)
    let id = (todo as? [String: Any])?["id"] as? String ?? ""
    var extra: [String: Any] = [:]
    if evening { extra["when"] = "evening" }
    if let headingId { extra["heading-id"] = headingId }
    if !checklist.isEmpty { extra["checklist-items"] = checklist.map { ["type": "checklist-item", "attributes": ["title": $0]] } }
    if !extra.isEmpty {
      guard let t = token() else { throw ThingsBridgeError(message: urlSchemeHelp, code: "things_error") }
      try jsonUpdate(token: t, id: id, attributes: extra)
    }
    return ActionResult(ok: true, id: id, data: todo)
  }

  private static func update(_ input: [String: Any], token: () -> String?) throws -> ActionResult {
    var basic = input
    let evening = basic.removeValue(forKey: "evening") as? Bool
    let headingId = basic.removeValue(forKey: "headingId") as? String
    let id = basic["id"] as! String
    var extra: [String: Any] = [:]
    let tok = token()
    if evening == true { extra["when"] = "evening" } else if evening == false, basic["when"] == nil || basic["when"] as? String == "today", tok != nil { extra["when"] = "today" }
    if let headingId { extra["heading-id"] = headingId }
    if extra["when"] != nil { basic.removeValue(forKey: "when") } else if evening == false, basic["when"] == nil { basic["when"] = "today" }
    let changes = basic.keys.contains { $0 != "id" }
    var data: Any?
    if changes {
      // The bridge clears a deadline when given JSON null.
      data = try writeThenMove("update", basic, id: id)
    }
    if !extra.isEmpty {
      guard let t = tok else { throw ThingsBridgeError(message: urlSchemeHelp, code: "things_error") }
      try jsonUpdate(token: t, id: id, attributes: extra)
    }
    return ActionResult(ok: true, id: id, data: data)
  }
}
