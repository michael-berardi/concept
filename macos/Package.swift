// swift-tools-version:6.0
import PackageDescription

let package = Package(
    name: "Concept",
    platforms: [.macOS(.v14)],
    products: [
        .library(name: "ConceptKit", targets: ["ConceptKit"]),
        .executable(name: "Concept", targets: ["Concept"]),
    ],
    targets: [
        .target(
            name: "ConceptKit",
            path: "Sources/ConceptKit"
        ),
        .executableTarget(
            name: "Concept",
            dependencies: ["ConceptKit"],
            path: "Sources/Concept"
        ),
        .testTarget(
            name: "ConceptKitTests",
            dependencies: ["ConceptKit"],
            path: "Tests/ConceptKitTests",
            resources: [.copy("Fixtures")]
        ),
    ]
)
