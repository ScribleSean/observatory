import Foundation
import Darwin

enum RuntimeOption: Equatable {
    case none
    case runtime(URL)
    case refused(String)

    static func parse(arguments: [String], realDataFolder: URL, userID: uid_t) -> RuntimeOption {
        guard let index = arguments.firstIndex(of: "--runtime") else { return .none }
        guard arguments.filter({ $0 == "--runtime" }).count == 1,
              index + 1 < arguments.count, !arguments[index + 1].hasPrefix("-") else {
            return .refused("--runtime requires one absolute folder path.")
        }
        let conflicts = ["--preview", "--preview-setup", "--test-lifecycle", "--test-popup", "--preview-pace"]
        guard !arguments.contains(where: conflicts.contains) else {
            return .refused("--runtime cannot be combined with a preview or lifecycle option.")
        }
        let path = arguments[index + 1]
        guard path.hasPrefix("/"), !path.utf8.contains(0),
              !path.split(separator: "/").contains(where: { $0 == "." || $0 == ".." }) else {
            return .refused("--runtime requires an absolute path without dot components.")
        }
        // standardizedFileURL would turn an existing /private/tmp path into /tmp, so build the path from its components.
        let parts = path.split(separator: "/").map(String.init)
        let folder = URL(fileURLWithPath: "/" + parts.joined(separator: "/"), isDirectory: true)
        let candidate = folder.path.lowercased()
        var protected = [realDataFolder.standardizedFileURL.path.lowercased()]
        if let resolved = realpath(realDataFolder.path, nil) {
            protected.append(String(cString: resolved).lowercased())
            free(resolved)
        }
        guard !protected.contains(where: { candidate == $0 || candidate.hasPrefix($0 + "/") }) else {
            return .refused("--runtime cannot use the real Observatory data folder or a folder inside it.")
        }
        var current = URL(fileURLWithPath: "/")
        let components = folder.path.split(separator: "/")
        for (index, component) in components.enumerated() {
            current.appendPathComponent(String(component))
            var info = stat()
            if lstat(current.path, &info) != 0 {
                guard errno == ENOENT, index == components.count - 1 else {
                    return .refused("The runtime parent folder must exist and be readable.")
                }
                continue
            }
            if info.st_mode & S_IFMT == S_IFLNK {
                return .refused("The runtime path contains a symbolic link. Use the resolved path such as /private/tmp/... instead.")
            }
            guard info.st_mode & S_IFMT == S_IFDIR else { return .refused("The runtime path must be a directory.") }
            if index == components.count - 1 {
                guard info.st_uid == userID, info.st_mode & 0o022 == 0 else {
                    return .refused("The runtime folder must be owned by the current user and not writable by other users.")
                }
            } else if info.st_mode & 0o022 != 0 && info.st_mode & S_ISVTX == 0 {
                return .refused("A runtime ancestor is writable by other users without the sticky bit.")
            }
        }
        guard !components.isEmpty else { return .refused("The runtime folder cannot be the filesystem root.") }
        return .runtime(folder)
    }

    static func createAndLock(_ folder: URL) throws -> Int32 {
        var info = stat()
        if lstat(folder.path, &info) != 0 {
            guard errno == ENOENT, mkdir(folder.path, 0o700) == 0 else { throw CocoaError(.fileWriteNoPermission) }
        }
        let descriptor = open(folder.appendingPathComponent(".observatory.lock").path,
                              O_RDWR | O_CREAT | O_NOFOLLOW | O_CLOEXEC, 0o600)
        guard descriptor >= 0 else { throw CocoaError(.fileWriteNoPermission) }
        guard fstat(descriptor, &info) == 0, info.st_mode & S_IFMT == S_IFREG,
              info.st_uid == getuid(), info.st_mode & 0o077 == 0 else {
            close(descriptor)
            throw CocoaError(.fileWriteNoPermission)
        }
        guard flock(descriptor, LOCK_EX | LOCK_NB) == 0 else {
            close(descriptor)
            throw LockError.inUse
        }
        return descriptor
    }
    enum LockError: Error { case inUse }
}
