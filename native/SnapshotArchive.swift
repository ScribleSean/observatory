import Foundation
import Darwin

enum SnapshotArchive {
    static let maximumBytes = 16_000_000

    static func parse(_ data: Data) throws -> Snapshot {
        guard data.count <= maximumBytes,
              let object = try JSONSerialization.jsonObject(with: data) as? JSONObject,
              number(object["schema"]) == 2, parseDate(object["collectedAt"]) != nil else {
            throw CocoaError(.fileReadCorruptFile)
        }
        return Snapshot(object: object)
    }

    // User-selected archive only. Never follows links or opens a live store,
    // executes content, changes collection, or merges this data into live totals.
    static func read(_ url: URL) throws -> Snapshot {
        let descriptor = open(url.path, O_RDONLY | O_NOFOLLOW | O_NONBLOCK)
        guard descriptor >= 0 else { throw CocoaError(.fileReadNoPermission) }
        let handle = FileHandle(fileDescriptor: descriptor, closeOnDealloc: true)
        defer { try? handle.close() }
        var before = stat()
        guard fstat(descriptor, &before) == 0, before.st_mode & S_IFMT == S_IFREG,
              before.st_size >= 0, before.st_size <= maximumBytes else { throw CocoaError(.fileReadTooLarge) }
        let data = try handle.read(upToCount: Int(before.st_size) + 1) ?? Data()
        var after = stat()
        guard fstat(descriptor, &after) == 0, data.count == Int(before.st_size),
              after.st_size == before.st_size, after.st_mtimespec.tv_sec == before.st_mtimespec.tv_sec,
              after.st_mtimespec.tv_nsec == before.st_mtimespec.tv_nsec else { throw CocoaError(.fileReadCorruptFile) }
        return try parse(data)
    }
}
