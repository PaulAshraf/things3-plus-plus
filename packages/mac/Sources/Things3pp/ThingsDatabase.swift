// Reads the Things database read-only (port of packages/core/src/things/db.ts, same static SQL).
// SECURITY: queries are constants; the database is opened with SQLITE_OPEN_READONLY.
import Foundation
import SQLite3

enum DatabaseAccess: Equatable {
  case granted(path: String)
  case denied
  case notFound
}

struct DatabaseError: Error, LocalizedError {
  let message: String
  var errorDescription: String? { message }
}

enum ThingsDatabase {
  static let containerPath = FileManager.default.homeDirectoryForCurrentUser
    .appendingPathComponent("Library/Group Containers/JLMPQHK86H.com.culturedcode.ThingsMac").path

  /// Can we read the database right now? (Touching it is also what makes macOS ask, where it asks.)
  static func access() -> DatabaseAccess {
    let fm = FileManager.default
    let entries: [String]
    do {
      entries = try fm.contentsOfDirectory(atPath: containerPath)
    } catch let e as NSError {
      if e.domain == NSCocoaErrorDomain && (e.code == NSFileReadNoPermissionError || e.code == 257) { return .denied }
      if let posix = e.userInfo[NSUnderlyingErrorKey] as? NSError, posix.code == Int(EPERM) || posix.code == Int(EACCES) { return .denied }
      return fm.fileExists(atPath: containerPath) ? .denied : .notFound
    }
    let candidates = entries.filter { $0.hasPrefix("ThingsData-") }.map { "\(containerPath)/\($0)/Things Database.thingsdatabase/main.sqlite" }
      + ["\(containerPath)/Things Database.thingsdatabase/main.sqlite"]
    guard let path = candidates.first(where: { fm.fileExists(atPath: $0) }) else { return .notFound }
    // Listing can succeed while opening is still blocked; check the file itself.
    guard let db = open(path) else { return .denied }
    sqlite3_close(db)
    return .granted(path: path)
  }

  private static func open(_ path: String) -> OpaquePointer? {
    var db: OpaquePointer?
    guard sqlite3_open_v2(path, &db, SQLITE_OPEN_READONLY, nil) == SQLITE_OK else {
      sqlite3_close(db)
      return nil
    }
    // Opening is lazy; force a real read.
    if sqlite3_exec(db, "SELECT 1 FROM sqlite_master LIMIT 1", nil, nil, nil) != SQLITE_OK {
      sqlite3_close(db)
      return nil
    }
    sqlite3_busy_timeout(db, 3000)
    return db
  }

  /// Runs a constant query that returns one text column in one row.
  private static func scalar(_ db: OpaquePointer, _ sql: String) throws -> String {
    var stmt: OpaquePointer?
    guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else {
      throw DatabaseError(message: "Couldn't read the Things database: \(String(cString: sqlite3_errmsg(db)))")
    }
    defer { sqlite3_finalize(stmt) }
    guard sqlite3_step(stmt) == SQLITE_ROW, let text = sqlite3_column_text(stmt, 0) else { return "" }
    return String(cString: text)
  }

  private static func rows(_ db: OpaquePointer, _ sql: String) throws -> [[Any]] {
    let text = try scalar(db, sql)
    guard let data = text.data(using: .utf8), let arr = try JSONSerialization.jsonObject(with: data) as? [[Any]] else { return [] }
    return arr
  }

  // Columns read from TMTask, in order. Missing ones (older Things versions) are read as NULL.
  static let taskCols = [
    "uuid", "type", "status", "trashed", "title", "notes", "start", "startDate", "startBucket", "deadline",
    "reminderTime", "area", "project", "heading", "index", "todayIndex", "rt1_repeatingTemplate",
    "creationDate", "userModificationDate", "stopDate",
  ]
  static let textCols: Set<String> = ["uuid", "title", "notes", "area", "project", "heading", "rt1_repeatingTemplate"]

  static let taskFilter = """
    rt1_recurrenceRule IS NULL AND (
      (trashed = 0 AND status = 0)
      OR (trashed = 0 AND type IN (1, 2))
      OR uuid IN (SELECT uuid FROM TMTask WHERE trashed = 0 AND status != 0 AND rt1_recurrenceRule IS NULL ORDER BY stopDate DESC LIMIT 1000)
      OR uuid IN (SELECT uuid FROM TMTask WHERE trashed = 1 AND rt1_recurrenceRule IS NULL ORDER BY userModificationDate DESC LIMIT 200)
    )
    """

  static func readSnapshot(path: String) throws -> Snapshot {
    guard let db = open(path) else { throw DatabaseError(message: "macOS is blocking access to the Things database.") }
    defer { sqlite3_close(db) }

    let colsJSON = try scalar(db, "SELECT json_group_array(name) FROM pragma_table_info('TMTask')")
    let present = Set((try? JSONSerialization.jsonObject(with: Data(colsJSON.utf8)) as? [String]) ?? [])
    guard present.contains("uuid") else { throw DatabaseError(message: "This doesn't look like a Things database.") }
    let exprs = taskCols.map { c -> String in
      guard present.contains(c) else { return "NULL" }
      return textCols.contains(c) ? "CAST(\"\(c)\" AS TEXT)" : "\"\(c)\""
    }
    let filter = present.contains("rt1_recurrenceRule") ? taskFilter : taskFilter.replacingOccurrences(of: "rt1_recurrenceRule IS NULL AND ", with: "")

    let taskRows = try rows(db, "SELECT json_group_array(json_array(\(exprs.joined(separator: ", ")))) FROM TMTask WHERE \(filter)")
    let checkRows = try rows(db, "SELECT json_group_array(json_array(CAST(uuid AS TEXT), CAST(task AS TEXT), CAST(title AS TEXT), status, \"index\")) FROM TMChecklistItem WHERE task IN (SELECT uuid FROM TMTask WHERE trashed = 0 AND status = 0)")
    let taskTagRows = try rows(db, "SELECT json_group_array(json_array(CAST(tasks AS TEXT), CAST(tags AS TEXT))) FROM TMTaskTag")
    let areaRows = try rows(db, "SELECT json_group_array(json_array(CAST(uuid AS TEXT), CAST(title AS TEXT), \"index\")) FROM TMArea")
    let areaTagRows = try rows(db, "SELECT json_group_array(json_array(CAST(areas AS TEXT), CAST(tags AS TEXT))) FROM TMAreaTag")
    let tagRows = try rows(db, "SELECT json_group_array(json_array(CAST(uuid AS TEXT), CAST(title AS TEXT), CAST(parent AS TEXT), CAST(shortcut AS TEXT), \"index\")) FROM TMTag")
    let urlScheme = (try? scalar(db, "SELECT CASE WHEN EXISTS (SELECT 1 FROM TMSettings WHERE uriSchemeAuthenticationToken IS NOT NULL AND uriSchemeAuthenticationToken != '') THEN 1 ELSE 0 END")) == "1"

    var checklists: [String: [(ChecklistItem, Int)]] = [:]
    for r in checkRows {
      let item = ChecklistItem(id: str(r, 0) ?? "", title: str(r, 2) ?? "", done: num(r, 3) != 0)
      checklists[str(r, 1) ?? "", default: []].append((item, num(r, 4)))
    }
    var tagsOf: [String: [String]] = [:]
    for r in taskTagRows { if let t = str(r, 0), let g = str(r, 1) { tagsOf[t, default: []].append(g) } }
    var areaTags: [String: [String]] = [:]
    for r in areaTagRows { if let a = str(r, 0), let g = str(r, 1) { areaTags[a, default: []].append(g) } }

    let statusMap = [0: "open", 2: "canceled", 3: "completed"]
    let startMap = [0: "inbox", 1: "anytime", 2: "someday"]
    let kindMap = [0: "todo", 1: "project", 2: "heading"]
    let col = Dictionary(uniqueKeysWithValues: taskCols.enumerated().map { ($1, $0) })

    let tasks: [TaskItem] = taskRows.map { r in
      func v(_ name: String) -> Any? {
        let i = col[name]!
        return i < r.count ? r[i] : nil
      }
      let id = (v("uuid") as? String) ?? ""
      let status = statusMap[intOf(v("status"))] ?? "open"
      return TaskItem(
        id: id,
        kind: kindMap[intOf(v("type"))] ?? "todo",
        title: (v("title") as? String) ?? "",
        notes: cleanNotes(v("notes") as? String),
        status: status,
        start: startMap[intOf(v("start"))] ?? "anytime",
        when: unpackDay(v("startDate")),
        evening: intOf(v("startBucket")) == 1,
        deadline: unpackDay(v("deadline")),
        reminder: unpackTime(v("reminderTime")),
        areaId: nonEmpty(v("area")),
        projectId: nonEmpty(v("project")),
        headingId: nonEmpty(v("heading")),
        tags: tagsOf[id] ?? [],
        checklist: (checklists[id] ?? []).sorted { $0.1 < $1.1 }.map { $0.0 },
        index: intOf(v("index")),
        todayIndex: intOf(v("todayIndex")),
        repeating: nonEmpty(v("rt1_repeatingTemplate")) != nil,
        trashed: intOf(v("trashed")) == 1,
        createdAt: unixToIso(v("creationDate")),
        modifiedAt: unixToIso(v("userModificationDate")),
        completedAt: status == "open" ? nil : unixToIso(v("stopDate")))
    }
    let areas = areaRows.map { r in AreaItem(id: str(r, 0) ?? "", title: str(r, 1) ?? "", index: num(r, 2), tags: areaTags[str(r, 0) ?? ""] ?? []) }
    let tags = tagRows.map { r in TagItem(id: str(r, 0) ?? "", title: str(r, 1) ?? "", parentId: str(r, 2), shortcut: str(r, 3), index: num(r, 4)) }

    return Snapshot(
      rev: 0, generatedAt: isoFormatter.string(from: Date()), timeZone: TimeZone.current.identifier,
      tasks: tasks, areas: areas, tags: tags, capabilities: Capabilities(urlScheme: urlScheme, database: true))
  }

  /// The URL-scheme auth token. Stays on this Mac: never put into a snapshot or sent anywhere.
  static func urlSchemeToken(path: String) -> String? {
    guard let db = open(path) else { return nil }
    defer { sqlite3_close(db) }
    let t = (try? scalar(db, "SELECT CAST(uriSchemeAuthenticationToken AS TEXT) FROM TMSettings LIMIT 1")) ?? ""
    return t.isEmpty ? nil : t
  }

  /// Latest modification time of the database files, to notice changes cheaply.
  static func lastChange(path: String) -> Date? {
    let fm = FileManager.default
    return [path, path + "-wal"].compactMap { (try? fm.attributesOfItem(atPath: $0))?[.modificationDate] as? Date }.max()
  }

  // ----- decoding (same rules as db.ts) -----

  static func intOf(_ v: Any?) -> Int {
    if let n = v as? NSNumber { return n.intValue }
    return 0
  }
  static func unpackDay(_ v: Any?) -> String? {
    let n = intOf(v)
    guard n > 0 else { return nil }
    let y = n >> 16, m = (n >> 12) & 0xF, d = (n >> 7) & 0x1F
    guard y > 0, m > 0, d > 0 else { return nil }
    return String(format: "%04d-%02d-%02d", y, m, d)
  }
  static func unpackTime(_ v: Any?) -> String? {
    let n = intOf(v)
    guard n > 0 else { return nil }
    let h = n >> 26, m = (n >> 20) & 0x3F
    guard h <= 23, m <= 59 else { return nil }
    return String(format: "%02d:%02d", h, m)
  }
  static func unixToIso(_ v: Any?) -> String? {
    guard let n = v as? NSNumber, n.doubleValue > 0 else { return nil }
    return isoFormatter.string(from: Date(timeIntervalSince1970: n.doubleValue))
  }
  static func cleanNotes(_ s: String?) -> String {
    guard let s else { return "" }
    guard s.hasPrefix("<note") else { return s }
    var out = s.replacingOccurrences(of: #"^<note[^>]*>"#, with: "", options: .regularExpression)
    out = out.replacingOccurrences(of: #"</note>\s*$"#, with: "", options: .regularExpression)
    for (k, v) in [("&lt;", "<"), ("&gt;", ">"), ("&quot;", "\""), ("&apos;", "'"), ("&amp;", "&")] { out = out.replacingOccurrences(of: k, with: v) }
    return out
  }
  private static func nonEmpty(_ v: Any?) -> String? {
    guard let s = v as? String, !s.isEmpty else { return nil }
    return s
  }
  private static func str(_ r: [Any], _ i: Int) -> String? { i < r.count ? nonEmpty(r[i]) : nil }
  private static func num(_ r: [Any], _ i: Int) -> Int { i < r.count ? intOf(r[i]) : 0 }
}
