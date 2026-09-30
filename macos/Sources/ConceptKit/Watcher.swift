import Foundation
import CoreServices

/// FSEvents-based vault watcher. Fires `onEvent` on the main actor, debounced.
public final class VaultWatcher: @unchecked Sendable {
    private var stream: FSEventStreamRef?
    private let watchURL: URL
    private let queue = DispatchQueue(label: "dev.concept.vaultwatcher")
    private let lock = NSLock()
    private var pendingWorkItem: DispatchWorkItem?
    private let debounce: TimeInterval

    /// Called on the main actor after file changes settle.
    @MainActor public var onEvent: () -> Void = {}
    @MainActor public var onError: (String) -> Void = { _ in }

    public private(set) var isRunning = false

    public init(url: URL, debounce: TimeInterval = 0.4) {
        self.watchURL = url.standardizedFileURL
        self.debounce = debounce
    }

    deinit {
        stop()
    }

    public func start() {
        lock.lock()
        defer { lock.unlock() }
        guard stream == nil else { return }
        var context = FSEventStreamContext(
            version: 0,
            info: Unmanaged<VaultWatcher>.passUnretained(self).toOpaque(),
            retain: nil, release: nil, copyDescription: nil)

        let callback: FSEventStreamCallback = { _, info, _, _, _, _ in
            guard let info else { return }
            let watcher = Unmanaged<VaultWatcher>.fromOpaque(info).takeUnretainedValue()
            watcher.scheduleEvent()
        }

        let paths = [watchURL.path] as CFArray
        guard let streamRef = FSEventStreamCreate(
            kCFAllocatorDefault,
            callback,
            &context,
            paths,
            FSEventStreamEventId(kFSEventStreamEventIdSinceNow),
            0.1,
            FSEventStreamCreateFlags(kFSEventStreamCreateFlagFileEvents | kFSEventStreamCreateFlagNoDefer))
        else {
            Task { @MainActor in
                self.onError("FSEventStreamCreate failed for \(watchURL.path)")
            }
            return
        }
        stream = streamRef
        FSEventStreamSetDispatchQueue(streamRef, queue)
        FSEventStreamStart(streamRef)
        isRunning = true
    }

    public func stop() {
        lock.lock()
        defer { lock.unlock() }
        queue.sync {
            pendingWorkItem?.cancel()
            pendingWorkItem = nil
        }
        guard let streamRef = stream else { return }
        FSEventStreamStop(streamRef)
        FSEventStreamInvalidate(streamRef)
        FSEventStreamRelease(streamRef)
        stream = nil
        isRunning = false
    }

    fileprivate func scheduleEvent() {
        queue.async { [self] in
            pendingWorkItem?.cancel()
            let item = DispatchWorkItem { [weak self] in
                guard let self else { return }
                Task { @MainActor in
                    self.onEvent()
                }
            }
            pendingWorkItem = item
            queue.asyncAfter(deadline: .now() + debounce, execute: item)
        }
    }
}
