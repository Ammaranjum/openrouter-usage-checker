// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "OpenRouterUsage",
    platforms: [.macOS(.v13)],
    products: [.executable(name: "OpenRouterUsage", targets: ["OpenRouterUsage"])],
    targets: [
        .target(name: "UsageCore"),
        .executableTarget(name: "OpenRouterUsage", dependencies: ["UsageCore"]),
        .testTarget(name: "UsageCoreTests", dependencies: ["UsageCore"])
    ]
)
