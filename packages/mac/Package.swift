// swift-tools-version:5.10
import PackageDescription

// things3pp for Mac: a menu-bar app that keeps your Mac connected to your hosted Things.
// Built into a .app by scripts/build-app.sh (which also bundles the AppleScript bridge).
let package = Package(
  name: "Things3pp",
  platforms: [.macOS(.v14)],
  targets: [
    .executableTarget(
      name: "Things3pp",
      path: "Sources/Things3pp",
      linkerSettings: [.linkedLibrary("sqlite3")]
    ),
    .testTarget(name: "Things3ppTests", dependencies: ["Things3pp"], path: "Tests/Things3ppTests"),
  ]
)
