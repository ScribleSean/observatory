import Foundation
import Darwin

enum RuntimeOption: Equatable {
    case none
    case runtime(URL, FileIdentity?)
    case refused(String)

    static func parse(arguments: [String], realDataFolder: URL, userID: uid_t) -> RuntimeOption {
        guard !arguments.contains(where: { $0.hasPrefix("--runtime") && $0 != "--runtime" }) else {
            return .refused("Use --runtime followed by the folder as a separate argument.")
        }
        guard let index = arguments.firstIndex(of: "--runtime") else { return .none }
        guard arguments.filter({ $0 == "--runtime" }).count == 1,
              index + 1 < arguments.count, !arguments[index + 1].hasPrefix("-") else {
            return .refused("--runtime requires one absolute folder path.")
        }
        let conflicts = ["--preview", "--preview-setup", "--test-lifecycle", "--test-popup", "--preview-pace",
            "--enable-login", "--login-status", "--self-test", "--test-web", "--test-collector", "--test-shutdown",
            "--test-quota-archive", "--test-trusted-sync-owner", "--test-direct-pairing-model", "--test-pairing-details"]
        guard !arguments.contains(where: conflicts.contains) else {
            return .refused("--runtime cannot be combined with a preview, lifecycle or one-shot option.")
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
        var realPaths = [realDataFolder.path]
        var protected = [realDataFolder.standardizedFileURL.path.lowercased()]
        if let resolved = realpath(realDataFolder.path, nil) {
            realPaths.append(String(cString: resolved))
            protected.append(String(cString: resolved).lowercased())
            free(resolved)
        }
        guard !protected.contains(where: { candidate == $0 || candidate.hasPrefix($0 + "/") }) else {
            return .refused("--runtime cannot use the real Observatory data folder or a folder inside it.")
        }
        let realIdentities = realPaths.compactMap { FileIdentity.at($0) }
        var candidateIdentity: FileIdentity?
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
            guard !realIdentities.contains(FileIdentity(info)) else {
                return .refused("--runtime cannot use the real Observatory data folder or a folder inside it.")
            }
            if info.st_mode & S_IFMT == S_IFLNK {
                return .refused("The runtime path contains a symbolic link. Use the resolved path such as /private/tmp/... instead.")
            }
            guard info.st_mode & S_IFMT == S_IFDIR else { return .refused("The runtime path must be a directory.") }
            if index == components.count - 1 {
                candidateIdentity = FileIdentity(info)
                guard info.st_uid == userID, info.st_mode & 0o022 == 0 else {
                    return .refused("The runtime folder must be owned by the current user and not writable by other users or the group.")
                }
            } else if info.st_mode & 0o022 != 0 && info.st_mode & S_ISVTX == 0 {
                return .refused("A runtime ancestor is writable by other users without the sticky bit.")
            }
        }
        guard !components.isEmpty else { return .refused("The runtime folder cannot be the filesystem root.") }
        if let candidateIdentity {
            for path in realPaths {
                var ancestor = URL(fileURLWithPath: path)
                while true {
                    if FileIdentity.at(ancestor.path) == candidateIdentity {
                        return .refused("--runtime cannot contain the real Observatory data folder.")
                    }
                    if ancestor.path == "/" { break }
                    ancestor.deleteLastPathComponent()
                }
            }
        }
        return .runtime(folder, candidateIdentity)
    }

    static func createAndLock(_ folder: URL, realDataFolder: URL) throws -> (descriptor: Int32, createdIdentity: FileIdentity?) {
        var createdIdentity: FileIdentity?
        var created = false
        var info = stat()
        if lstat(folder.path, &info) != 0 {
            guard errno == ENOENT, mkdir(folder.path, 0o700) == 0 else { throw CocoaError(.fileWriteNoPermission) }
            created = true
        }
        let directory = open(folder.path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
        guard directory >= 0 else { throw CocoaError(.fileWriteNoPermission) }
        defer { close(directory) }
        guard fstat(directory, &info) == 0 else { throw CocoaError(.fileWriteNoPermission) }
        let identity = FileIdentity(info)
        if created { createdIdentity = identity }
        var realIdentities = [FileIdentity.at(realDataFolder.path)]
        if let parent = realpath(realDataFolder.deletingLastPathComponent().path, nil) {
            let resolved = URL(fileURLWithPath: String(cString: parent)).appendingPathComponent(realDataFolder.lastPathComponent)
            free(parent)
            realIdentities.append(FileIdentity.at(resolved.path))
        }
        if realIdentities.contains(identity) {
            if createdIdentity == identity, FileIdentity.at(folder.path) == identity {
                _ = rmdir(folder.path)
            }
            throw LockError.realDataFolder
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
        return (descriptor, createdIdentity)
    }
    enum LockError: Error { case inUse, realDataFolder }
}

struct FileIdentity: Equatable {
    let device: dev_t
    let inode: ino_t

    init(_ info: stat) {
        device = info.st_dev
        inode = info.st_ino
    }

    static func at(_ path: String) -> FileIdentity? {
        var info = stat()
        return stat(path, &info) == 0 ? FileIdentity(info) : nil
    }

    static func matches(descriptor: Int32, path: String, expected: FileIdentity) -> Bool {
        var info = stat()
        return fstat(descriptor, &info) == 0 && FileIdentity(info) == expected && at(path) == expected
    }
}
