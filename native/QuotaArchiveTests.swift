import Foundation

@MainActor
func testQuotaArchiveBridge() async throws {
    guard let resources = Bundle.main.resourceURL else { throw CocoaError(.fileReadUnknown) }
    let runtime = FileManager.default.temporaryDirectory.appendingPathComponent("observatory-archive-test-\(UUID().uuidString)")
    try FileManager.default.createDirectory(at: runtime, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
    defer { try? FileManager.default.removeItem(at: runtime) }
    let empty = try await QuotaArchiveProcess.run(runtime: runtime, request: ["action": "accounts"])
    print("Archive empty-store bridge passed")
    precondition(empty.accounts?.isEmpty == true)
    let files = try FileManager.default.contentsOfDirectory(atPath: runtime.path)
    precondition(files.isEmpty)
    let script = resources.appendingPathComponent("Collector/scripts/quota-store.mjs")
    let seed = Process()
    seed.executableURL = resources.appendingPathComponent("Runtime/node/bin/node")
    seed.arguments = ["--input-type=module", "-e", """
        import {pathToFileURL} from 'node:url';
        import {realpath} from 'node:fs/promises';
        const {readQuotaState,updateQuotaState}=await import(pathToFileURL(process.argv[1]));
        const root=await realpath(process.argv[2]),start=Date.parse('2025-01-01T12:00:00Z');
        for(const [scope,offset] of [['a'.repeat(64),0],['a'.repeat(64),300000],['b'.repeat(64),600000]]) {
          const at=start+offset,state=await readQuotaState(root,at);
          await updateQuotaState(root,{revision:state.revision,scope,observation:{
            status:'ok',checkedAt:new Date(at).toISOString(),
            windows:[{bucket:'codex',window:'primary',remainingPercent:75}],
            accountUsage:{status:'ok',checkedAt:new Date(at).toISOString(),
              dailyUsageBuckets:[{startDate:'2025-01-01',tokens:123}]}}},at);
        }
        """, script.path, runtime.resolvingSymlinksInPath().path]
    seed.standardOutput = FileHandle.nullDevice
    seed.standardError = FileHandle.standardError
    try seed.run()
    seed.waitUntilExit()
    guard seed.terminationStatus == 0 else { throw CocoaError(.fileWriteUnknown) }
    print("Synthetic archive seed passed")
    let catalogue = try await QuotaArchiveProcess.run(runtime: runtime, request: ["action": "accounts"])
    print("Archive catalogue bridge passed")
    precondition(catalogue.accounts?.count == 2)
    precondition(catalogue.accounts?.last?.current == true)
    let scope = String(repeating: "a", count: 64)
    var request: [String: Any] = ["action": "page", "scope": scope, "kind": "observation",
        "from": 0, "to": 2_000_000_000_000, "limit": 1]
    let first = try await QuotaArchiveProcess.run(runtime: runtime, request: request)
    precondition(first.records?.count == 1)
    guard case .page(let next) = first.next else { throw CocoaError(.fileReadCorruptFile) }
    request["after"] = ["at": next.at, "id": next.id]
    let second = try await QuotaArchiveProcess.run(runtime: runtime, request: request)
    precondition(second.records?.count == 1 && second.next == nil)
    precondition(first.records?.first?.checkedAt != second.records?.first?.checkedAt)
    request.removeValue(forKey: "after")
    request["kind"] = "daily"
    let daily = try await QuotaArchiveProcess.run(runtime: runtime, request: request)
    precondition(daily.records?.first?.tokens == 123)
    request["kind"] = "poll"
    let poll = try await QuotaArchiveProcess.run(runtime: runtime, request: request)
    precondition(poll.records?.first?.status == "ok")
    var rejected = false
    do { _ = try await QuotaArchiveProcess.run(runtime: runtime, request: ["action": "delete"]) }
    catch { rejected = true }
    precondition(rejected)
    print("Packaged allowance archive process, account isolation, pagination and record kinds passed")
}
