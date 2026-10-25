// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "LaunchStackCapture",
    platforms: [.macOS(.v14)],
    products: [.executable(name: "LaunchStackCapture", targets: ["CaptureApp"])],
    dependencies: [
        .package(url: "https://github.com/sparkle-project/Sparkle", exact: "2.8.1"),
    ],
    targets: [
        .target(name: "CaptureCore"),
        .executableTarget(
            name: "CaptureApp",
            dependencies: ["CaptureCore", .product(name: "Sparkle", package: "Sparkle")],
            linkerSettings: [
                .unsafeFlags(["-Xlinker", "-rpath", "-Xlinker", "@executable_path/../Frameworks"]),
            ]
        ),
        .testTarget(name: "CaptureCoreTests", dependencies: ["CaptureCore"]),
    ]
)
