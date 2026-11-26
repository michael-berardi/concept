// swift-tools-version:6.0
import PackageDescription

let package = Package(
    name: "Concept",
    platforms: [.macOS(.v14)],
    products: [
        .library(name: "ConceptKit", targets: ["ConceptKit"]),
        .executable(name: "Concept", targets: ["Concept"]),
    ],
    dependencies: [
        .package(url: "https://github.com/sparkle-project/Sparkle", from: "2.10.0")
    ],
    targets: [
        .target(
            name: "ConceptKit",
            path: "Sources/ConceptKit"
        ),
        .executableTarget(
            name: "Concept",
            dependencies: [
                "ConceptKit",
                .product(name: "Sparkle", package: "Sparkle"),
            ],
            path: "Sources/Concept",
            linkerSettings: [
                .unsafeFlags(["-Xlinker", "-rpath", "-Xlinker", "@executable_path/../Frameworks"])
            ]
        ),
        .testTarget(
            name: "ConceptKitTests",
            dependencies: ["ConceptKit"],
            path: "Tests/ConceptKitTests",
            resources: [.copy("Fixtures")]
        ),
    ]
)
