// swift-tools-version: 5.9

import PackageDescription

let package = Package(
    name: "launchstack-system-audio",
    platforms: [
        .macOS(.v14),
    ],
    products: [
        .executable(
            name: "launchstack-system-audio",
            targets: ["LaunchStackSystemAudio"]
        ),
    ],
    targets: [
        .executableTarget(
            name: "LaunchStackSystemAudio",
            path: "Sources"
        ),
    ]
)
