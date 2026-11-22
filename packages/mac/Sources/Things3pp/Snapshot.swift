// The same data model as packages/core/src/model/types.ts, encoded with explicit nulls so the
// Worker and web app see exactly what the Node agent would send.
import Foundation

struct ChecklistItem: Codable, Equatable {
  var id: String
  var title: String
  var done: Bool
}

struct TaskItem: Codable, Equatable {
  var id: String
  var kind: String  // todo | project | heading
  var title: String
  var notes: String
  var status: String  // open | completed | canceled
  var start: String  // inbox | anytime | someday
  var when: String?
  var evening: Bool
  var deadline: String?
  var reminder: String?
  var areaId: String?
  var projectId: String?
  var headingId: String?
  var tags: [String]
  var checklist: [ChecklistItem]
  var index: Int
  var todayIndex: Int
  var repeating: Bool
  var trashed: Bool
  var createdAt: String?
  var modifiedAt: String?
  var completedAt: String?

  enum CodingKeys: String, CodingKey {
    case id, kind, title, notes, status, start, when, evening, deadline, reminder, areaId, projectId, headingId, tags, checklist, index, todayIndex, repeating, trashed, createdAt, modifiedAt, completedAt
  }

  // Optionals are written as null (not omitted): the web app checks `=== null`.
  func encode(to encoder: Encoder) throws {
    var c = encoder.container(keyedBy: CodingKeys.self)
    try c.encode(id, forKey: .id)
    try c.encode(kind, forKey: .kind)
    try c.encode(title, forKey: .title)
    try c.encode(notes, forKey: .notes)
    try c.encode(status, forKey: .status)
    try c.encode(start, forKey: .start)
    try c.encode(when, forKey: .when)
    try c.encode(evening, forKey: .evening)
    try c.encode(deadline, forKey: .deadline)
    try c.encode(reminder, forKey: .reminder)
    try c.encode(areaId, forKey: .areaId)
    try c.encode(projectId, forKey: .projectId)
    try c.encode(headingId, forKey: .headingId)
    try c.encode(tags, forKey: .tags)
    try c.encode(checklist, forKey: .checklist)
    try c.encode(index, forKey: .index)
    try c.encode(todayIndex, forKey: .todayIndex)
    try c.encode(repeating, forKey: .repeating)
    try c.encode(trashed, forKey: .trashed)
    try c.encode(createdAt, forKey: .createdAt)
    try c.encode(modifiedAt, forKey: .modifiedAt)
    try c.encode(completedAt, forKey: .completedAt)
  }
}

struct AreaItem: Codable, Equatable {
  var id: String
  var title: String
  var index: Int
  var tags: [String]
}

struct TagItem: Codable, Equatable {
  var id: String
  var title: String
  var parentId: String?
  var shortcut: String?
  var index: Int

  enum CodingKeys: String, CodingKey { case id, title, parentId, shortcut, index }
  func encode(to encoder: Encoder) throws {
    var c = encoder.container(keyedBy: CodingKeys.self)
    try c.encode(id, forKey: .id)
    try c.encode(title, forKey: .title)
    try c.encode(parentId, forKey: .parentId)
    try c.encode(shortcut, forKey: .shortcut)
    try c.encode(index, forKey: .index)
  }
}

struct Capabilities: Codable, Equatable {
  var urlScheme: Bool
  var database: Bool
}

struct Snapshot: Codable, Equatable {
  var rev: Int
  var generatedAt: String
  var timeZone: String
  var tasks: [TaskItem]
  var areas: [AreaItem]
  var tags: [TagItem]
  var capabilities: Capabilities
}


struct SnapshotPatch: Codable {
  struct Upsert: Codable {
    var tasks: [TaskItem]
    var areas: [AreaItem]
    var tags: [TagItem]
  }
  struct Remove: Codable {
    var tasks: [String]
    var areas: [String]
    var tags: [String]
  }
  var rev: Int
  var baseRev: Int
  var generatedAt: String
  var timeZone: String
  var capabilities: Capabilities
  var upsert: Upsert
  var remove: Remove
}

private func diffList<T: Equatable>(_ prev: [T], _ next: [T], id: (T) -> String) -> (upsert: [T], remove: [String]) {
  var before: [String: T] = [:]
  for x in prev { before[id(x)] = x }
  let upsert = next.filter { before[id($0)] != $0 }
  let nextIds = Set(next.map(id))
  let remove = prev.map(id).filter { !nextIds.contains($0) }
  return (upsert, remove)
}

/// What changed between two snapshots, or nil if nothing did (mirrors diffSnapshots in core).
func diffSnapshots(_ prev: Snapshot, _ next: Snapshot) -> SnapshotPatch? {
  let t = diffList(prev.tasks, next.tasks) { $0.id }
  let a = diffList(prev.areas, next.areas) { $0.id }
  let g = diffList(prev.tags, next.tags) { $0.id }
  let metaChanged = prev.timeZone != next.timeZone || prev.capabilities != next.capabilities
  if !metaChanged && t.upsert.isEmpty && t.remove.isEmpty && a.upsert.isEmpty && a.remove.isEmpty && g.upsert.isEmpty && g.remove.isEmpty {
    return nil
  }
  return SnapshotPatch(
    rev: next.rev, baseRev: prev.rev, generatedAt: next.generatedAt, timeZone: next.timeZone, capabilities: next.capabilities,
    upsert: .init(tasks: t.upsert, areas: a.upsert, tags: g.upsert),
    remove: .init(tasks: t.remove, areas: a.remove, tags: g.remove))
}

let isoFormatter: ISO8601DateFormatter = {
  let f = ISO8601DateFormatter()
  f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
  return f
}()
