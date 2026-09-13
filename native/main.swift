import AppKit
import SwiftUI
import ServiceManagement
import WebKit

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate, NSMenuItemValidation {
    private var statusItem: NSStatusItem!
    private let popover = NSPopover()
    private var usageWindow: NSPanel?
    private var detail: NSWindow?
    private var setupWindow: NSWindow?
    private var directPairingWindow: DirectPairingWindowController?
    private var webView: WKWebView?
    private let navigation = LocalNavigation()
    private var store: ObservatoryStore!
    private var terminationSignal: DispatchSourceSignal?
    private var panelSize = NSSize.zero
    private var unreliableUsageAnchor: NSRect?
    private var previewRuntime: URL?
    private weak var lifecycleContent: NSView?
    private let nativeSelection = NativeDashboardSelection()
    private var usesNativeDashboard: Bool { !CommandLine.arguments.contains("--legacy-dashboard") }
    private var expectedDashboardPresent: Bool {
        usesNativeDashboard ? detail?.contentView is NSHostingView<NativeDashboard> && webView == nil : webView != nil
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
        let runtime: URL
        let lifecycleTest = CommandLine.arguments.contains("--test-lifecycle")
        let popupTest = CommandLine.arguments.contains("--test-popup") || CommandLine.arguments.contains("--preview-pace")
        if CommandLine.arguments.contains("--preview") || lifecycleTest || popupTest {
            // An isolated, empty UI preview never changes installed settings or login state.
            let temporary = FileManager.default.temporaryDirectory.appendingPathComponent("observatory-ui-preview-\(UUID().uuidString)")
            do {
                if CommandLine.arguments.contains("--preview-setup") { _ = try FirstRunSetup.prepare(runtime: temporary) }
                _ = try CollectorConfiguration.prepare(runtime: temporary)
                try CollectorConfiguration.save(Dictionary(uniqueKeysWithValues: CollectorConfiguration.defaults.keys.map { ($0, false) }), runtime: temporary)
            } catch { NSApp.terminate(nil); return }
            previewRuntime = temporary
            runtime = temporary
        } else {
            runtime = FileManager.default.homeDirectoryForCurrentUser
                .appendingPathComponent("Library/Application Support/Workspace Observatory")
        }
        store = ObservatoryStore(runtime: runtime, collectionAllowed: previewRuntime == nil)
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        if let button = statusItem.button {
            let image = telescopeImage(template: true)
            button.image = image
            button.toolTip = previewRuntime == nil ? "Observatory" : "Observatory (temporary preview)"
            button.setAccessibilityLabel("Observatory usage")
            button.target = self
            button.action = #selector(togglePanel)
            button.sendAction(on: [.leftMouseUp, .rightMouseUp])
        }
        popover.behavior = .transient
        // Keep visibility state synchronous with fallback and dashboard handoff.
        // An opening animation can otherwise outlive a close request.
        popover.animates = false
        makeMenu()
        signal(SIGTERM, SIG_IGN)
        let termination = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
        termination.setEventHandler { NSApp.terminate(nil) }
        termination.resume()
        terminationSignal = termination
        // Lifecycle tests use empty private settings and never start collection.
        if lifecycleTest { checkDashboardLifecycle(remaining: 3); return }
        if popupTest { DispatchQueue.main.async { [self] in checkUsagePopup() }; return }
        store.start()
        if store.setupRequired { DispatchQueue.main.async { [self] in showSetup() }; return }
        if CommandLine.arguments.contains("--show") {
            DispatchQueue.main.async { [self] in togglePanel() }
        } else if !CommandLine.arguments.contains("--background") {
            DispatchQueue.main.async { [self] in openDashboard("activity") }
        }
    }

    private func showSetup() {
        if setupWindow == nil {
            let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 600, height: 500),
                                  styleMask: [.titled, .closable], backing: .buffered, defer: false)
            window.title = "Set up Observatory"
            window.isReleasedWhenClosed = false
            window.contentView = NSHostingView(rootView: SetupWizard(runtime: store.runtime, pairingAllowed: previewRuntime == nil) { [weak self] pair in
                guard let self else { return }
                self.setupWindow?.close()
                self.setupWindow = nil
                self.openDashboard("activity")
                if pair && self.previewRuntime == nil { self.setupPairing() }
                self.store.refresh()
            })
            window.center()
            setupWindow = window
        }
        setupWindow?.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    private func makeMenu() {
        let menu = NSMenu()
        let application = NSMenuItem()
        let items = NSMenu()
        items.addItem(withTitle: "Open Observatory", action: #selector(openDefault), keyEquivalent: "o").target = self
        items.addItem(withTitle: "Show usage popup", action: #selector(showUsage), keyEquivalent: "u").target = self
        items.addItem(withTitle: "Refresh sources", action: #selector(refresh), keyEquivalent: "r").target = self
        items.addItem(withTitle: "Local source settings…", action: #selector(sourceSettings), keyEquivalent: ",").target = self
        items.addItem(withTitle: "Pair with Windows…", action: #selector(setupPairing), keyEquivalent: "").target = self
        items.addItem(withTitle: "Disconnect paired device…", action: #selector(disconnectPairing), keyEquivalent: "").target = self
        items.addItem(withTitle: "Prepare pairing repair…", action: #selector(preparePairingRepair), keyEquivalent: "").target = self
        items.addItem(.separator())
        items.addItem(withTitle: "Quit Observatory", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        application.submenu = items
        menu.addItem(application)
        let view = NSMenuItem()
        let viewMenu = NSMenu(title: "View")
        viewMenu.addItem(withTitle: "Zoom In", action: #selector(zoomIn), keyEquivalent: "=").target = self
        viewMenu.addItem(withTitle: "Zoom Out", action: #selector(zoomOut), keyEquivalent: "-").target = self
        viewMenu.addItem(withTitle: "Actual Size", action: #selector(actualSize), keyEquivalent: "0").target = self
        viewMenu.addItem(.separator())
        viewMenu.addItem(withTitle: "200%", action: #selector(doubleSize), keyEquivalent: "").target = self
        view.submenu = viewMenu
        menu.addItem(view)
        let window = NSMenuItem()
        let windowMenu = NSMenu(title: "Window")
        windowMenu.addItem(withTitle: "Minimize", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        windowMenu.addItem(withTitle: "Close", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        window.submenu = windowMenu
        menu.addItem(window)
        NSApp.mainMenu = menu
        NSApp.windowsMenu = windowMenu
    }

    @objc private func togglePanel() {
        if NSApp.currentEvent?.type == .rightMouseUp { showMenu(); return }
        if popover.isShown || usageWindow?.isVisible == true { closeUsage(); return }
        showUsage()
    }

    private func closeUsage() {
        // This read-only view has no unsaved edits or delegate veto. Explicit
        // navigation must close it even if AppKit has attached a child window.
        popover.close()
        usageWindow?.close()
    }

    private func usageContent(size: NSSize) -> NSViewController {
        let panel = ObservatoryPanel(store: store,
                open: { [weak self] tab in self?.openDashboard(tab) },
                settings: { [weak self] in self?.showMenu() }, panelWidth: size.width, compact: size.height < 560)
        .frame(width: size.width, height: size.height, alignment: .top)
        .background(ObservatoryBackdrop())
        .preferredColorScheme(.dark)
        let controller = NSHostingController(rootView: panel)
        controller.preferredContentSize = size
        controller.view.setFrameSize(size)
        return controller
    }

    private func showFloatingUsage(size: NSSize, visible: NSRect) {
        let window = NSPanel(contentRect: NSRect(origin: .zero, size: size),
            styleMask: [.titled, .closable, .utilityWindow], backing: .buffered, defer: false)
        window.title = "Observatory usage"
        window.appearance = NSAppearance(named: .darkAqua)
        window.isFloatingPanel = true
        window.hidesOnDeactivate = true
        window.isReleasedWhenClosed = false
        window.delegate = self
        window.contentViewController = usageContent(size: size)
        window.setContentSize(size)
        window.contentView?.layoutSubtreeIfNeeded()
        window.setFrameOrigin(NSPoint(x: max(visible.minX + 8, visible.maxX - window.frame.width - 16),
                                      y: max(visible.minY + 8, visible.maxY - window.frame.height - 16)))
        usageWindow = window
        window.makeKeyAndOrderFront(nil)
    }

    private func recoverOffscreenUsage(size: NSSize, visible: NSRect) {
        guard popover.isShown, let window = popover.contentViewController?.view.window else { return }
        guard !NSScreen.screens.contains(where: { $0.frame.contains(window.frame) }) else { return }
        // AppKit can accept a visible menu item but place its popover outside
        // the display. Reuse the bounded fallback, never leave controls clipped.
        unreliableUsageAnchor = statusItem.button?.window?.frame
        popover.close()
        showFloatingUsage(size: size, visible: visible)
    }

    @objc private func showUsage() {
        store.reload()
        NSApp.activate(ignoringOtherApps: true)
        if popover.isShown { return }
        if let usageWindow { usageWindow.makeKeyAndOrderFront(nil); return }
        guard let button = statusItem.button else { return }
        let visible = button.window?.screen?.visibleFrame ?? NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 800, height: 600)
        let size = NSSize(width: min(370, max(240, visible.width - 32)), height: min(580, max(240, visible.height - 48)))
        // A hidden or overflowed menu-bar item cannot anchor an NSPopover.
        // Keep the same usage view available to the explicit menu/keyboard action.
        if button.visibleRect.isEmpty || button.window?.isVisible != true {
            showFloatingUsage(size: size, visible: visible)
            return
        }
        // An unchanged anchor that already produced an offscreen popover is
        // not a new opportunity to retry it on every dashboard handoff.
        // A display or menu-bar layout change permits anchored placement again.
        if let unreliableUsageAnchor, button.window?.frame == unreliableUsageAnchor {
            showFloatingUsage(size: size, visible: visible)
            return
        }
        unreliableUsageAnchor = nil
        if popover.contentViewController == nil || size != panelSize {
            panelSize = size
            popover.contentViewController = usageContent(size: size)
        }
        popover.contentSize = size
        popover.show(relativeTo: button.bounds, of: button, preferredEdge: .minY)
        if popover.isShown {
            popover.contentViewController?.view.window?.makeKey()
            DispatchQueue.main.async { [weak self] in
                self?.recoverOffscreenUsage(size: size, visible: visible)
            }
        }
        else {
            // Visibility can change between checking the anchor and showing it.
            popover.close()
            showFloatingUsage(size: size, visible: visible)
        }
    }

    private func showMenu() {
        closeUsage()
        let menu = NSMenu()
        menu.addItem(withTitle: "Open Observatory", action: #selector(openDefault), keyEquivalent: "").target = self
        menu.addItem(withTitle: "Show usage popup", action: #selector(showUsage), keyEquivalent: "").target = self
        menu.addItem(withTitle: "Refresh sources", action: #selector(refresh), keyEquivalent: "").target = self
        menu.addItem(withTitle: "Local source settings…", action: #selector(sourceSettings), keyEquivalent: "").target = self
        menu.addItem(withTitle: "Pair with Windows…", action: #selector(setupPairing), keyEquivalent: "").target = self
        menu.addItem(withTitle: "Disconnect paired device…", action: #selector(disconnectPairing), keyEquivalent: "").target = self
        menu.addItem(withTitle: "Prepare pairing repair…", action: #selector(preparePairingRepair), keyEquivalent: "").target = self
        menu.addItem(.separator())
        let login = menu.addItem(withTitle: "Launch at login", action: #selector(toggleLogin), keyEquivalent: "")
        login.target = self
        login.isEnabled = previewRuntime == nil
        login.state = SMAppService.mainApp.status == .enabled ? .on : .off
        menu.addItem(withTitle: "Login settings…", action: #selector(loginSettings), keyEquivalent: "").target = self
        menu.addItem(.separator())
        menu.addItem(withTitle: "Quit Observatory", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        guard let button = statusItem.button else { return }
        menu.popUp(positioning: nil, at: NSPoint(x: 0, y: button.bounds.minY), in: button)
    }

    @objc private func toggleLogin() {
        guard !store.shuttingDown else { return }
        guard previewRuntime == nil else { return }
        do {
            if SMAppService.mainApp.status == .enabled { try SMAppService.mainApp.unregister() }
            else { try SMAppService.mainApp.register() }
        } catch {
            let alert = NSAlert()
            alert.messageText = "Launch at login needs attention"
            alert.informativeText = "Open Login Items in System Settings to allow Observatory."
            alert.runModal()
        }
    }
    @objc private func loginSettings() {
        guard previewRuntime == nil else { return }
        SMAppService.openSystemSettingsLoginItems()
    }
    @objc private func sourceSettings() {
        guard !store.shuttingDown else { return }
        closeUsage()
        if usesNativeDashboard {
            openDashboard("settings")
            return
        }
        let alert = NSAlert()
        alert.messageText = "Local source settings"
        let local: Bool
        do { local = try CollectorConfiguration.prepare(runtime: store.runtime) }
        catch {
            alert.informativeText = "The local configuration could not be read. Existing settings have been preserved."
            alert.runModal()
            return
        }
        guard local else {
            alert.informativeText = "This preview uses your existing cross-device configuration. It has been preserved. Local-only settings are available for new installations."
            alert.runModal()
            return
        }
        guard !store.refreshing else {
            alert.informativeText = "A collection is running. Try again when it finishes so source changes apply to the next complete snapshot."
            alert.runModal()
            return
        }
        do {
            let config = try CollectorConfiguration.read(runtime: store.runtime)
            let sources = [("activity", "ActivityWatch screen time (must be running)"),
                           ("codex", "Saved Codex usage and settings"),
                           ("quota", "Codex account limits and token history (online)"),
                           ("wispr", "Wispr Flow statistics")]
            let buttons = sources.map { key, title in
                let button = NSButton(checkboxWithTitle: title, target: nil, action: nil)
                button.state = config[key] == true ? .on : .off
                return button
            }
            let stack = NSStackView(views: buttons)
            stack.orientation = .vertical
            stack.alignment = .leading
            stack.spacing = 10
            stack.frame = NSRect(x: 0, y: 0, width: 390, height: 145)
            alert.accessoryView = stack
            alert.informativeText = "Read usage metadata without prompts, window titles, transcripts or audio. Optional account monitoring uses the installed Codex sign-in to read online limits and daily tokens. Turning it off clears its retained readings, not your Codex login."
            alert.addButton(withTitle: "Save")
            alert.addButton(withTitle: "Cancel")
            if alert.runModal() == .alertFirstButtonReturn {
                guard !store.shuttingDown else { return }
                guard !store.refreshing else {
                    let busy = NSAlert()
                    busy.messageText = "Collection started while settings were open"
                    busy.informativeText = "Try again after it finishes. Source settings have not changed."
                    busy.runModal()
                    return
                }
                let updated = Dictionary(uniqueKeysWithValues: zip(sources, buttons).map { ($0.0.0, $0.1.state == .on) })
                try CollectorConfiguration.save(updated, runtime: store.runtime)
                store.refresh()
            }
        } catch {
            let failure = NSAlert()
            failure.messageText = "Source settings unavailable"
            failure.informativeText = "The local settings file could not be read or saved. Existing settings were not intentionally replaced."
            failure.runModal()
        }
    }
    @objc private func refresh() { store.refresh() }
    private func setupDirectPairing() {
        guard !store.shuttingDown, previewRuntime == nil else { return }
        if let directPairingWindow { directPairingWindow.showWindow(nil); directPairingWindow.window?.makeKeyAndOrderFront(nil); return }
        guard !store.refreshing, !store.pairingMaintenance, let resources = Bundle.main.resourceURL else { return }
        closeUsage()
        do {
            let bridge = try TLSSetupProcess(runtime: store.runtime, resources: resources)
            store.pairingMaintenance = true
            let controller = DirectPairingWindowController(bridge: bridge) { [weak self] in
                self?.directPairingWindow = nil
                bridge.closeAndWait { [weak self] stopped in
                    guard let self else { return }
                    if !stopped { self.store.collectionPausedForPairing = true }
                    self.store.pairingMaintenance = false
                }
            }
            directPairingWindow = controller; controller.showWindow(nil)
            controller.window?.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps: true)
        } catch {
            let alert = NSAlert(); alert.messageText = "Pairing tools unavailable"
            alert.informativeText = "The bundled setup controller could not start. Saved data and pairing state were not changed."
            alert.runModal()
        }
    }
    @objc private func setupPairing() {
        guard !store.shuttingDown else { return }
        guard previewRuntime == nil else { return }
        closeUsage()
        guard !store.refreshing, !store.pairingMaintenance, let resources = Bundle.main.resourceURL else {
            let busy = NSAlert()
            busy.messageText = "Pairing is waiting"
            busy.informativeText = "A local operation is running. Try again when it finishes."
            busy.runModal()
            return
        }
        store.pairingMaintenance = true
        Task { @MainActor in
            var refreshAfter = false
            defer { store.pairingMaintenance = false; if refreshAfter { store.refresh() } }
            let result = NSAlert()
            do {
                let saved = try await PairingSetup.status(runtime: store.runtime, resources: resources)
                guard saved.status != .needsRepair else {
                    result.messageText = "Pairing needs repair"
                    result.informativeText = "Private state is disabled, conflicting or unreadable. It was not changed. Use Prepare pairing repair on each device, then pair again from this Mac. If preparation fails, keep the retained state for inspection. Do not delete private files or remove a revocation marker to reconnect."
                    result.runModal()
                    return
                }
                NSApp.activate(ignoringOtherApps: true)
                guard let request = PairingSetupDialog.request(saved: saved) else { return }
                let progress = PairingSetupDialog.progress()
                do {
                    try await PairingSetup.connect(runtime: store.runtime, resources: resources, request: request)
                    progress.close()
                    store.collectionPausedForPairing = false
                    refreshAfter = true
                    result.messageText = "Pairing acknowledged"
                    result.informativeText = "Windows acknowledged the saved pairing. Source settings are unchanged. Combined data appears after successful collection and exchange on both devices. This does not verify that every source is available."
                } catch {
                    progress.close()
                    store.collectionPausedForPairing = true
                    result.messageText = "Pairing setup incomplete"
                    result.informativeText = "Collection is paused for this session. Windows may already have saved its pairing. Check the existing SSH connection and Windows installation, then open Pair with Windows again to retry the saved target. Private state was not replaced."
                }
            } catch {
                result.messageText = "Pairing status unavailable"
                result.informativeText = "The bundled setup tool could not read pairing status. No setup was requested and existing private state was not changed."
            }
            result.runModal()
        }
    }
    @objc private func disconnectPairing() {
        guard !store.shuttingDown else { return }
        guard previewRuntime == nil else { return }
        closeUsage()
        let alert = NSAlert()
        alert.messageText = "Disconnect paired device?"
        guard !store.refreshing, !store.pairingMaintenance else {
            alert.informativeText = "A local operation is running. Try again when it finishes."
            alert.runModal()
            return
        }
        guard FileManager.default.fileExists(atPath: store.runtime.appendingPathComponent("private-sync").path) else {
            alert.informativeText = "No private pairing state was found for this installation."
            alert.runModal()
            return
        }
        alert.informativeText = "Disable pairing on this Mac only. Local collection continues and saved data is retained. A transfer already in flight may finish. Disconnect on the other device separately. To reconnect, prepare pairing repair on both devices and pair again from the Mac."
        alert.addButton(withTitle: "Cancel")
        alert.addButton(withTitle: "Disconnect on this Mac")
        guard alert.runModal() == .alertSecondButtonReturn else { return }
        store.collectionPausedForPairing = true
        guard !store.refreshing, !store.pairingMaintenance else {
            let busy = NSAlert()
            busy.messageText = "Disconnection is waiting"
            busy.informativeText = "An operation started while confirmation was open. It may finish, but further collection is paused for this session. Retry disconnection when it finishes."
            busy.runModal()
            return
        }
        guard let resources = Bundle.main.resourceURL else { return }
        store.pairingMaintenance = true
        Task { @MainActor in
            let result = NSAlert()
            do {
                try await PairingMaintenance.disconnect(runtime: store.runtime, resources: resources)
                result.messageText = "Pairing disabled on this Mac"
                result.informativeText = "Saved data remains. The dashboard will return to local-only data after the next successful collection. Disconnect the other device separately; SSH access is unchanged."
                store.collectionPausedForPairing = false
            } catch {
                result.messageText = "Disconnection could not be verified"
                result.informativeText = "Collection is paused for this session. Private state was not deleted, and pairing may already be disabled. Retry disconnection or quit the app until the pairing state can be inspected."
            }
            store.pairingMaintenance = false
            store.refresh()
            result.runModal()
        }
    }
    @objc private func preparePairingRepair() {
        guard !store.shuttingDown else { return }
        guard previewRuntime == nil else { return }
        closeUsage()
        let alert = NSAlert()
        alert.messageText = "Prepare pairing repair on this Mac?"
        guard !store.refreshing, !store.pairingMaintenance else {
            alert.informativeText = "A local operation is running. Try again when it finishes."
            alert.runModal()
            return
        }
        alert.informativeText = "If this Mac has pairing state, disable it and retain a private backup. Otherwise, confirm this Mac is ready for repair. Nothing is deleted or sent. A transfer already in flight may finish. Confirm Prepare pairing repair on Windows separately, then use Pair with Windows here to create fresh credentials. Retirement cannot be undone by this action."
        alert.addButton(withTitle: "Cancel")
        alert.addButton(withTitle: "Retain backup and prepare")
        guard alert.runModal() == .alertSecondButtonReturn else { return }
        store.collectionPausedForPairing = true
        guard !store.refreshing, !store.pairingMaintenance, let resources = Bundle.main.resourceURL else {
            let busy = NSAlert()
            busy.messageText = "Repair preparation is waiting"
            busy.informativeText = "Collection is paused for this session. An operation may still be finishing. Retry preparation when it finishes."
            busy.runModal()
            return
        }
        store.pairingMaintenance = true
        Task { @MainActor in
            let result = NSAlert()
            do {
                try await PairingMaintenance.prepareRepair(runtime: store.runtime, resources: resources)
                store.collectionPausedForPairing = false
                result.messageText = "This Mac is ready for a new pairing"
                result.informativeText = "Any retired state remains in a disabled private backup. Confirm Prepare pairing repair on Windows separately, then choose Pair with Windows on this Mac. Local collection can continue. No new pairing has been enabled by this action."
            } catch {
                result.messageText = "Repair preparation could not be verified"
                result.informativeText = "Collection is paused for this session. Saved state was not deleted, but it may already be retired. Retry or quit until this installation can be inspected. Do not restore old pairing files over a new pairing."
            }
            store.pairingMaintenance = false
            store.refresh()
            result.runModal()
        }
    }
    @objc private func openDefault() { openDashboard("activity") }

    @objc private func zoomIn() {
        guard let webView else { return }
        webView.pageZoom = CGFloat(DashboardZoom.step(from: Double(webView.pageZoom), increasing: true))
    }
    @objc private func zoomOut() {
        guard let webView else { return }
        webView.pageZoom = CGFloat(DashboardZoom.step(from: Double(webView.pageZoom), increasing: false))
    }
    @objc private func actualSize() { webView?.pageZoom = 1 }
    @objc private func doubleSize() { webView?.pageZoom = 2 }

    func validateMenuItem(_ item: NSMenuItem) -> Bool {
        if store.shuttingDown { return false }
        let zoom = webView?.pageZoom
        switch item.action {
        case #selector(setupPairing), #selector(disconnectPairing), #selector(preparePairingRepair),
             #selector(toggleLogin), #selector(loginSettings): return previewRuntime == nil
        case #selector(zoomIn): return zoom.map { $0 < 2 } ?? false
        case #selector(zoomOut): return zoom.map { $0 > 0.75 } ?? false
        case #selector(actualSize):
            item.state = zoom == 1 ? .on : .off
            return zoom != nil
        case #selector(doubleSize):
            item.state = zoom == 2 ? .on : .off
            return zoom != nil
        default: return true
        }
    }

    private func openDashboard(_ tab: String) {
        closeUsage()
        if (try? FirstRunSetup.required(runtime: store.runtime)) != false { showSetup(); return }
        if usesNativeDashboard {
            nativeSelection.section = ["activity", "tokens", "allowances", "agents", "dictation", "sources", "settings"].contains(tab) ? tab : "activity"
            if detail == nil {
                let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1000, height: 720),
                                      styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
                window.title = previewRuntime == nil ? "Observatory" : "Observatory native preview"
                window.minSize = NSSize(width: 760, height: 560)
                window.contentView = NSHostingView(rootView: NativeDashboard(store: store, selection: nativeSelection,
                    settingsActions: NativeSettingsActions(pair: { [weak self] in self?.setupPairing() },
                        disconnect: { [weak self] in self?.disconnectPairing() }, repair: { [weak self] in self?.preparePairingRepair() },
                        toggleLogin: { [weak self] in self?.toggleLogin() }, loginSettings: { [weak self] in self?.loginSettings() },
                        preview: previewRuntime != nil, directPair: { [weak self] in self?.setupDirectPairing() })))
                window.delegate = self
                window.isReleasedWhenClosed = false
                window.center()
                if previewRuntime == nil { window.setFrameAutosaveName("ObservatoryNativeDetail") }
                detail = window
            }
            detail?.deminiaturize(nil)
            detail?.makeKeyAndOrderFront(nil)
            NSApp.activate(ignoringOtherApps: true)
            return
        }
        if detail == nil {
            guard let resources = Bundle.main.resourceURL else { return }
            let web = makeDashboard(runtime: store.runtime, resources: resources)
            web.navigationDelegate = navigation
            web.uiDelegate = navigation
            let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1150, height: 770),
                                  styleMask: [.titled, .closable, .miniaturizable, .resizable],
                                  backing: .buffered, defer: false)
            window.title = "Observatory"
            window.titlebarAppearsTransparent = true
            window.minSize = NSSize(width: 800, height: 550)
            window.contentView = web
            window.delegate = self
            window.isReleasedWhenClosed = false
            if previewRuntime == nil { window.setFrameAutosaveName("ObservatoryDetail") }
            window.center()
            detail = window
            webView = web
        }
        let safeTab = ["activity", "tokens", "agents", "dictation", "sources"].contains(tab) ? tab : "activity"
        webView?.load(URLRequest(url: URL(string: "observatory://app/index.html#\(safeTab)")!))
        detail?.deminiaturize(nil)
        detail?.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    func windowWillClose(_ notification: Notification) {
        if let window = notification.object as? NSWindow, window === usageWindow {
            window.contentViewController = nil
            usageWindow = nil
            return
        }
        guard let window = notification.object as? NSWindow, window === detail else { return }
        webView?.stopLoading()
        webView?.configuration.userContentController.removeAllScriptMessageHandlers()
        detail?.contentView = nil
        webView = nil
        detail = nil
    }

    private func checkDashboardLifecycle(remaining: Int) {
        guard remaining > 0 else {
            print("Dashboard lifecycle passed: three open/close cycles released their content views, menu-bar app remained running")
            NSApp.terminate(nil)
            return
        }
        openDashboard("activity")
        lifecycleContent = detail?.contentView
        guard lifecycleContent != nil, expectedDashboardPresent, detail?.isVisible == true else {
            print("Native lifecycle failed: dashboard did not open")
            exit(1)
        }
        if usesNativeDashboard {
            let activityWindow = detail
            sourceSettings()
            precondition(detail === activityWindow && nativeSelection.section == "settings" && expectedDashboardPresent)
            openDashboard("tokens")
            precondition(detail === activityWindow && nativeSelection.section == "tokens" && expectedDashboardPresent)
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 1) { [self] in
            detail?.performClose(nil)
            // Allow AppKit's close notification and autorelease pool to drain.
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [self] in
                guard detail == nil, webView == nil, lifecycleContent == nil,
                      statusItem.button != nil, NSApp.isRunning else {
                    print("Native lifecycle failed: closed dashboard retained state or menu-bar app stopped")
                    exit(1)
                }
                checkDashboardLifecycle(remaining: remaining - 1)
            }
        }
    }

    private func checkUsagePopup() {
        // Exercise the production popup with synthetic data and no collectors.
        precondition(previewRuntime != nil && !store.collectionAllowed)
        for action in [#selector(setupPairing), #selector(disconnectPairing), #selector(preparePairingRepair),
                       #selector(toggleLogin), #selector(loginSettings)] {
            precondition(!validateMenuItem(NSMenuItem(title: "Preview action", action: action, keyEquivalent: "")))
        }
        // Direct callbacks must refuse before showing a dialog or invoking a tool.
        setupPairing()
        disconnectPairing()
        preparePairingRepair()
        precondition(!store.pairingMaintenance && !store.collectionPausedForPairing)
        for folder in ["private-sync", "private-repair"] {
            precondition(!FileManager.default.fileExists(atPath: store.runtime.appendingPathComponent(folder).path))
        }
        let now = Date()
        let iso = ISO8601DateFormatter()
        let windows: [JSONObject] = [
            ["bucket": "codex", "window": "primary", "remainingPercent": 65, "durationMinutes": 300,
             "resetsAt": iso.string(from: now.addingTimeInterval(4 * 3600))],
            ["bucket": "codex", "window": "secondary", "remainingPercent": 82, "durationMinutes": 10080],
            ["bucket": "spark", "window": "primary", "remainingPercent": 40, "durationMinutes": 300]
        ]
        let history: [JSONObject] = (0..<12).map { index in
            ["checkedAt": iso.string(from: now.addingTimeInterval(Double(index - 11) * 300)), "windows": windows]
        }
        store.snapshot = Snapshot(object: ["schema": 2, "collectedAt": iso.string(from: now),
            "activity": [], "tokens": [], "settings": [], "dictation": [],
            "quota": ["status": "ok", "checkedAt": iso.string(from: now), "windows": windows, "history": history,
                      "pace": [["bucket": "codex", "window": "primary", "asOf": iso.string(from: now),
                                "status": "projected", "coverageFraction": 0.8125,
                                "summary": "20.0% of allowance/hour over 60 min. Approximately 3h 15m left at this pace (at last check). Reset in 4h 0m. Estimated allowance covers 81% of the time until reset (at last check)."]],
                      "dailyUsageBuckets": [["startDate": String(iso.string(from: now).prefix(10)), "tokens": 12000]]]])
        showUsage()
        if CommandLine.arguments.contains("--force-offscreen-popup"),
           let window = popover.contentViewController?.view.window, popover.isShown {
            window.setFrameOrigin(NSPoint(x: -100000, y: -100000))
            let visible = NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 800, height: 600)
            recoverOffscreenUsage(size: panelSize, visible: visible)
            precondition(usageWindow?.isVisible == true && !popover.isShown)
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 1) { [self] in
            let view = usageWindow?.contentViewController?.view ?? popover.contentViewController?.view
            guard popover.isShown || usageWindow?.isVisible == true, let view,
                  let window = view.window, window.isVisible,
                  NSScreen.screens.contains(where: { (usageWindow == nil ? $0.frame : $0.visibleFrame).contains(window.frame) }),
                  view.bounds.width > 200, view.bounds.height > 200 else {
                let window = usageWindow ?? popover.contentViewController?.view.window
                let button = statusItem.button
                print("Native usage popup failed: shown=\(popover.isShown) visible=\(window?.isVisible ?? false) active=\(NSApp.isActive) anchorVisible=\(button?.window?.isVisible ?? false) anchorHidden=\(button?.isHiddenOrHasHiddenAncestor ?? true) screenCount=\(NSScreen.screens.count) window=\(String(describing: window?.frame)) view=\(String(describing: view?.bounds)) screens=\(NSScreen.screens.map(\.visibleFrame))")
                exit(1)
            }
            print("Native usage popup passed: \(usageWindow == nil ? "anchored" : "floating fallback") production panel visible on screen with synthetic quota and token charts")
            if CommandLine.arguments.contains("--preview-pace") { return }
            openDashboard("activity")
            // AppKit can hide the window before its closing animation updates
            // isShown. Wait for the closed state with a bounded deadline.
            afterUsageClosed { [self] in
                guard usageWindow == nil, !popover.isShown, detail?.isVisible == true else {
                    print("Native usage popup failed: dashboard handoff did not close the usage view")
                    exit(1)
                }
                showUsage()
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [self] in
                    guard popover.isShown || usageWindow?.isVisible == true else {
                        print("Native usage popup failed: usage view did not reopen beside the dashboard, active=\(NSApp.isActive) anchoredShown=\(popover.isShown) fallbackRetained=\(usageWindow != nil) fallbackVisible=\(usageWindow?.isVisible ?? false) anchor=\(String(describing: statusItem.button?.window?.frame)) failedAnchor=\(String(describing: unreliableUsageAnchor))")
                        exit(1)
                    }
                    if let unreliableUsageAnchor, statusItem.button?.window?.frame == unreliableUsageAnchor {
                        precondition(usageWindow?.isVisible == true && !popover.isShown)
                    }
                    closeUsage()
                    afterUsageClosed { [self] in
                        guard usageWindow == nil, !popover.isShown, detail?.isVisible == true, expectedDashboardPresent else {
                            print("Native usage popup failed after close: usageRetained=\(usageWindow != nil) anchoredShown=\(popover.isShown) dashboardPresent=\(detail != nil) dashboardVisible=\(detail?.isVisible ?? false) webRetained=\(webView != nil)")
                            exit(1)
                        }
                        print("Native usage popup passed: dashboard handoff and usage reopen/close preserved the dashboard")
                        detail?.performClose(nil)
                        NSApp.terminate(nil)
                    }
                }
            }
        }
    }

    private func afterUsageClosed(deadline: Date = Date().addingTimeInterval(2), completion: @escaping () -> Void) {
        if usageWindow == nil, !popover.isShown { completion(); return }
        guard Date() < deadline else {
            print("Native usage popup failed: close deadline exceeded, anchoredShown=\(popover.isShown) windowVisible=\(popover.contentViewController?.view.window?.isVisible ?? false) usageRetained=\(usageWindow != nil)")
            exit(1)
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) { [self] in
            afterUsageClosed(deadline: deadline, completion: completion)
        }
    }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        guard let store else { return .terminateNow }
        if store.shuttingDown { return .terminateLater }
        store.drainForQuit { completed in
            sender.reply(toApplicationShouldTerminate: completed)
            if !completed {
                let alert = NSAlert()
                alert.messageText = "Observatory is still finishing work"
                alert.informativeText = "The app stayed open to preserve active collection or pairing work. Try quitting again after it finishes."
                alert.runModal()
            }
        }
        return .terminateLater
    }
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if let usageWindow { usageWindow.makeKeyAndOrderFront(nil); return true }
        if popover.isShown { return true }
        openDashboard("activity")
        return true
    }
    func applicationWillTerminate(_ notification: Notification) {
        directPairingWindow?.close()
        store?.stop()
        // Keep a preview directory if collection is still shutting down. It contains
        // only this preview's settings/snapshots, never installed application state.
        if let temporary = previewRuntime, store?.refreshing == false, store?.pairingMaintenance == false {
            try? FileManager.default.removeItem(at: temporary)
        }
    }
}

if CommandLine.arguments.count == 4 && CommandLine.arguments[1] == "--test-trusted-sync-owner" {
    Task { @MainActor in
        do {
            try await TrustedSyncProcess.selfTest(node: URL(fileURLWithPath: CommandLine.arguments[2]),
                script: URL(fileURLWithPath: CommandLine.arguments[3]))
            exit(0)
        } catch { print("Trusted sync owner test failed"); exit(1) }
    }
    NSApplication.shared.run()
} else if CommandLine.arguments.contains("--test-direct-pairing-model") {
    Task { @MainActor in
        await testDirectPairingModel(); print("Native pairing model consent, confirmation, cancellation and cleanup passed"); exit(0)
    }
    NSApplication.shared.run()
} else if CommandLine.arguments.contains("--test-shutdown") {
    Task { @MainActor in
        do { try await testShutdownDrain(); print("Mac shutdown drain, timeout resume and refresh exclusion passed"); exit(0) }
        catch { print("Mac shutdown drain test failed"); exit(1) }
    }
    NSApplication.shared.run()
} else if CommandLine.arguments.contains("--self-test") {
    runSelfTests()
} else if CommandLine.arguments.count == 3 && CommandLine.arguments[1] == "--test-pairing-details" {
    do {
        guard CommandLine.arguments[2].hasPrefix("/") else { throw CocoaError(.fileReadCorruptFile) }
        let file = try FileHandle(forReadingFrom: URL(fileURLWithPath: CommandLine.arguments[2]))
        defer { try? file.close() }
        guard let data = try file.read(upToCount: 8193), data.count <= 8192,
              let value = String(data: data, encoding: .utf8) else { throw CocoaError(.fileReadCorruptFile) }
        _ = try WindowsPairingDetails.parse(value)
        print("Windows pairing details import passed")
    } catch { print("Windows pairing details import failed"); exit(1) }
} else if CommandLine.arguments.contains("--test-collector") {
    runCollectorSelfTest()
} else if CommandLine.arguments.contains("--test-web") {
    MainActor.assumeIsolated {
        let application = NSApplication.shared
        application.setActivationPolicy(.prohibited)
        let test = WebSmokeTest()
        test.start()
        withExtendedLifetime(test) { application.run() }
    }
} else if CommandLine.arguments.contains("--enable-login") {
    if CommandLine.arguments.contains("--preview") {
        print("Login registration is disabled for previews")
        exit(1)
    }
    do {
        try SMAppService.mainApp.register()
        print(SMAppService.mainApp.status == .enabled ? "enabled" : "approval-required")
    } catch {
        print("registration-failed")
        exit(1)
    }
} else if CommandLine.arguments.contains("--login-status") {
    print(SMAppService.mainApp.status == .enabled ? "enabled" : "not-enabled")
} else {
    MainActor.assumeIsolated {
        let application = NSApplication.shared
        let delegate = AppDelegate()
        application.delegate = delegate
        withExtendedLifetime(delegate) { application.run() }
    }
}
