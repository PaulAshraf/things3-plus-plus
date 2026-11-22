import XCTest
@testable import Things3pp

final class CoreTests: XCTestCase {
  func task(_ id: String, title: String = "x") -> TaskItem {
    TaskItem(id: id, kind: "todo", title: title, notes: "", status: "open", start: "anytime", when: nil, evening: false, deadline: nil, reminder: nil,
      areaId: nil, projectId: nil, headingId: nil, tags: [], checklist: [], index: 0, todayIndex: 0, repeating: false, trashed: false,
      createdAt: nil, modifiedAt: nil, completedAt: nil)
  }

  func testDiff() {
    let caps = Capabilities(urlScheme: true, database: true)
    let a = Snapshot(rev: 1, generatedAt: "", timeZone: "UTC", tasks: [task("x"), task("y")], areas: [], tags: [], capabilities: caps)
    var b = a
    b.rev = 2
    b.tasks = [task("x", title: "changed"), task("z")]
    let p = diffSnapshots(a, b)!
    XCTAssertEqual(p.remove.tasks, ["y"])
    XCTAssertEqual(Set(p.upsert.tasks.map(\.id)), ["x", "z"])
    XCTAssertNil(diffSnapshots(a, a))
  }

  func testNullsAreEncoded() throws {
    let json = String(data: try JSONEncoder().encode(task("x")), encoding: .utf8)!
    XCTAssertTrue(json.contains("\"when\":null"))
    XCTAssertTrue(json.contains("\"projectId\":null"))
  }

  func testDecoding() {
    XCTAssertEqual(ThingsDatabase.unpackDay(NSNumber(value: (2026 << 16) | (11 << 12) | (22 << 7))), "2026-11-22")
    XCTAssertEqual(ThingsDatabase.unpackTime(NSNumber(value: (18 << 26) | (30 << 20))), "18:30")
    XCTAssertEqual(ThingsDatabase.cleanNotes("<note xml:space=\"preserve\">a &amp; b</note>"), "a & b")
  }

  func testActionsRejectUnknownAndDelete() {
    let r = MacActions.run(["op": "trash", "args": ["id": "x"]], token: { nil })
    XCTAssertFalse(r.ok)
    XCTAssertEqual(r.code, "invalid")
    XCTAssertEqual(MacActions.run(["op": "update", "args": ["id": "x", "when": "next tuesday"]], token: { nil }).code, "invalid")
    XCTAssertEqual(MacActions.run(["op": "update", "args": ["id": "x", "rm": true]], token: { nil }).code, "invalid")
  }

  func testDeviceKeySignsVerifiably() throws {
    let id = DeviceIdentity.fresh(serverURL: "https://example.com")
    let sig = try id.sign("hello")
    XCTAssertEqual(base64urlDecode(sig)?.count, 64)
    XCTAssertEqual(base64urlDecode(id.publicKey)?.count, 32)
  }

  func testPKCS8Import() {
    // A Node-generated Ed25519 PKCS#8 key: the seed is the last 32 bytes.
    let pem = "-----BEGIN PRIVATE KEY-----\nMC4CAQAwBQYDK2VwBCIEIBRmY0g2fGv2N3DkfaldNG0xbKFwH0n2dD0a2LCm6k6i\n-----END PRIVATE KEY-----\n"
    XCTAssertEqual(CLIImport.rawKey(fromPKCS8PEM: pem)?.count, 32)
  }
}
