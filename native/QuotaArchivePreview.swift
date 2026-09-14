import AppKit
import SwiftUI

private struct ArchivePreviewRoot: View {
    let runtime: URL
    @State private var shown = true
    var body: some View {
        Text("Synthetic archive preview. No live data or collectors.")
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .sheet(isPresented: $shown) { NativeQuotaArchive(runtime: runtime) }
            .onChange(of: shown) { if !shown { NSApp.terminate(nil) } }
    }
}

@MainActor
final class QuotaArchivePreview: NSObject, NSApplicationDelegate {
    private var window: NSWindow?
    private var runtime: URL?
    func applicationDidFinishLaunching(_ notification: Notification) {
        do {
            guard let resources = Bundle.main.resourceURL else { throw CocoaError(.fileReadUnknown) }
            let root = FileManager.default.temporaryDirectory.appendingPathComponent("observatory-archive-preview-\(UUID().uuidString)")
            try FileManager.default.createDirectory(at: root, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
            runtime = root
            let seed = Process()
            seed.executableURL = resources.appendingPathComponent("Runtime/node/bin/node")
            seed.arguments = ["--input-type=module", "-e", """
                import {pathToFileURL} from 'node:url';
                import {realpath} from 'node:fs/promises';
                const {readQuotaState,updateQuotaState}=await import(pathToFileURL(process.argv[1]));
                const root=await realpath(process.argv[2]),start=Date.now()-2*86400000;
                for(let i=0;i<108;i++) {
                  const at=start+i*300000,state=await readQuotaState(root,at),scope=(i<105?'a':'b').repeat(64);
                  await updateQuotaState(root,{revision:state.revision,scope,observation:{
                    status:'ok',checkedAt:new Date(at).toISOString(),
                    windows:[{bucket:'codex',window:'primary',remainingPercent:Math.max(0,95-i/2)}],
                    accountUsage:{status:'ok',checkedAt:new Date(at).toISOString(),
                      dailyUsageBuckets:[{startDate:new Date(at).toISOString().slice(0,10),tokens:1000+i}]}}},at);
                }
                """, resources.appendingPathComponent("Collector/scripts/quota-store.mjs").path, root.path]
            seed.standardOutput = FileHandle.nullDevice; seed.standardError = FileHandle.nullDevice
            try seed.run()
            let timeout = DispatchWorkItem { if seed.isRunning { seed.terminate() } }
            DispatchQueue.global().asyncAfter(deadline: .now() + 20, execute: timeout)
            seed.waitUntilExit(); timeout.cancel()
            guard seed.terminationStatus == 0 else { throw CocoaError(.fileWriteUnknown) }
            ObservatoryTheme.registerFont()
            NSApp.setActivationPolicy(.regular)
            let appearance: ColorScheme = CommandLine.arguments.contains("--preview-light") ? .light : .dark
            let view = NSHostingView(rootView: ArchivePreviewRoot(runtime: root).preferredColorScheme(appearance))
            let panel = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 900, height: 660),
                styleMask: [.titled, .closable, .resizable], backing: .buffered, defer: false)
            panel.title = "Observatory · Synthetic history preview"
            panel.contentView = view; panel.center(); panel.makeKeyAndOrderFront(nil)
            window = panel
            NSApp.activate(ignoringOtherApps: true)
        } catch { print("Synthetic history preview failed"); NSApp.terminate(nil) }
    }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
    func applicationWillTerminate(_ notification: Notification) {
        if let runtime { try? FileManager.default.removeItem(at: runtime) }
    }
}
