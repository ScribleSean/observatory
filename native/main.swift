import AppKit
import ApplicationServices
import Combine
import SwiftUI
import ServiceManagement
import WebKit

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate, NSMenuItemValidation {
    private var statusItem: NSStatusItem!
    private let popover = NSPopover()
    private var usageWindow: NSPanel?
    private var detail: NSWindow?
    private var directPairingWindow: DirectPairingWindowController?
    private var webView: WKWebView?
    private var bridgeHandler: BridgeHandler?
    private var bridgeHost: MacBridgeHost?
    private var webDashboardSection = "limits"
    private var dashboardCollectionObserver: AnyCancellable?
    private var store: ObservatoryStore!
    private var terminationSignal: DispatchSourceSignal?
    private var panelSize = NSSize.zero
    private var unreliableUsageAnchor: NSRect?
    private var previewRuntime: URL?
    private var openedTimingDashboard = false
    private weak var lifecycleContent: NSView?
    private lazy var updateController = MacUpdateController { [weak self] in
        guard let self, let store = self.store else { return false }
        return selectedRuntime == nil && self.previewRuntime == nil && !store.shuttingDown && !store.refreshing &&
            !store.pairingMaintenance && !store.collectionPausedForPairing
    }
    private var reportsPanelTiming: Bool { CommandLine.arguments.contains("--panel-timing") }
    private var webPanel: WebPanelController?
    private var collectionObserver: AnyCancellable?
    private var dismissMonitors: [Any] = []
    private var expectedDashboardPresent: Bool { webView != nil }

    func applicationDidFinishLaunching(_ notification: Notification) {
        if MacUpdateGate.isBlocked(bundle: Bundle.main.bundleURL) {
            // The installer retains the previous app and removes its lock only
            // after verification. Do not start collection during replacement.
            if !CommandLine.arguments.contains("--background") {
                NSApp.setActivationPolicy(.regular)
                let alert = NSAlert()
                alert.alertStyle = .informational
                alert.messageText = "Observatory cannot open during an update"
                alert.informativeText = "An installation or recovery operation may still be in progress. Wait for it to finish, then open Observatory again. If this message persists, check the update recovery instructions."
                alert.addButton(withTitle: "OK")
                NSApp.activate(ignoringOtherApps: true)
                alert.runModal()
            }
            NSApp.terminate(nil)
            return
        }
        ObservatoryTheme.registerFont()
        NSApp.setActivationPolicy(.regular)
        let runtime: URL
        let lifecycleTest = CommandLine.arguments.contains("--test-lifecycle")
        let popupTest = CommandLine.arguments.contains("--test-popup") || CommandLine.arguments.contains("--preview-pace")
        if let selectedRuntime {
            runtime = selectedRuntime
        } else if CommandLine.arguments.contains("--preview") || CommandLine.arguments.contains("--preview-setup") || lifecycleTest || popupTest {
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
                .appendingPathComponent("Library/Application Support/Observatory")
        }
        store = ObservatoryStore(runtime: runtime, collectionAllowed: previewRuntime == nil)
        if let identity = selectedRuntimeIdentity, let selectedRuntime {
            store.runtimeIdentityValid = {
                FileIdentity.matches(descriptor: runtimeDirectoryDescriptor, path: selectedRuntime.path, expected: identity)
            }
        }
        if previewRuntime == nil && selectedRuntime == nil { WebViewerPreferences.migrateIfNeeded(runtime: store.runtime) }
        let handler = BridgeHandler()
        let hooks = MacBridgeHooks(openDashboard: { [weak self] in self?.openDashboard($0) },
            checkForUpdates: { [weak self] in
                guard let self, self.previewRuntime == nil, selectedRuntime == nil else { return false }
                do { try self.updateController.check(); return true } catch { return false }
            }, directPairingOpen: { [weak self] in self?.directPairingWindow != nil },
            applyViewerPreferences: { [weak self] skin, theme in
                self?.webPanel?.applyPreferences(skin: skin, theme: theme)
                if let web = self?.webView { applyViewerPreferences(web, skin: skin, theme: theme) }
            })
        let host = MacBridgeHost(store: store, resources: Bundle.main.resourceURL,
                                 preview: previewRuntime != nil, handler: handler, hooks: hooks, isolatedRuntime: selectedRuntime != nil)
        handler.host = host
        bridgeHandler = handler; bridgeHost = host
        dashboardCollectionObserver = store.$refreshing.dropFirst().removeDuplicates().filter { !$0 }
            .receive(on: DispatchQueue.main).sink { [weak self] _ in
                guard let self, let webView = self.webView else { return }
                webView.evaluateJavaScript("window.dispatchEvent(new Event('observatory:snapshot-changed'))")
            }

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
        // A regular app may bring its dashboard forward during activation.
        // Keep the popup open across that same-app window transition.
        popover.behavior = .semitransient
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
        if lifecycleTest {
            checkDashboardLifecycle(remaining: 3); return
        }
        if popupTest { DispatchQueue.main.async { [self] in checkUsagePopup() }; return }
        store.start()
        if store.setupRequired { DispatchQueue.main.async { [self] in openDashboard("setup") }; return }
        if CommandLine.arguments.contains("--show") {
            DispatchQueue.main.async { [self] in togglePanel() }
        } else if !CommandLine.arguments.contains("--background") {
            DispatchQueue.main.async { [self] in openDashboard("allowances") }
        }
    }

    private func makeMenu() {
        let menu = NSMenu()
        let application = NSMenuItem()
        let items = NSMenu(title: "Observatory")
        items.addItem(withTitle: "About Observatory", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        items.addItem(.separator())
        items.addItem(withTitle: "Settings…", action: #selector(sourceSettings), keyEquivalent: ",").target = self
        items.addItem(withTitle: "Check for updates…", action: #selector(checkForUpdates), keyEquivalent: "").target = self
        items.addItem(.separator())
        items.addItem(withTitle: "Hide Observatory", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        let hideOthers = items.addItem(withTitle: "Hide Others", action: #selector(NSApplication.hideOtherApplications(_:)), keyEquivalent: "h")
        hideOthers.keyEquivalentModifierMask = [.command, .option]
        items.addItem(withTitle: "Show All", action: #selector(NSApplication.unhideAllApplications(_:)), keyEquivalent: "")
        items.addItem(.separator())
        items.addItem(withTitle: "Quit Observatory", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        application.submenu = items
        menu.addItem(application)
        let file = NSMenuItem()
        let fileMenu = NSMenu(title: "File")
        fileMenu.addItem(withTitle: "Open Observatory", action: #selector(openDefault), keyEquivalent: "o").target = self
        fileMenu.addItem(withTitle: "Close Window", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        fileMenu.addItem(.separator())
        fileMenu.addItem(withTitle: "Device Connection Settings…", action: #selector(sourceSettings), keyEquivalent: "").target = self
        file.submenu = fileMenu
        menu.addItem(file)
        let edit = NSMenuItem()
        let editMenu = NSMenu(title: "Edit")
        // Nil targets use the focused responder, including native text fields
        // and WebKit. AppKit disables commands that cannot act on the selection.
        editMenu.addItem(withTitle: "Undo", action: Selector(("undo:")), keyEquivalent: "z")
        let redo = editMenu.addItem(withTitle: "Redo", action: Selector(("redo:")), keyEquivalent: "z")
        redo.keyEquivalentModifierMask = [.command, .shift]
        editMenu.addItem(.separator())
        editMenu.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        editMenu.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        editMenu.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        editMenu.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        edit.submenu = editMenu
        menu.addItem(edit)
        let view = NSMenuItem()
        let viewMenu = NSMenu(title: "View")
        viewMenu.addItem(withTitle: "Show Usage Popup", action: #selector(showUsage), keyEquivalent: "u").target = self
        viewMenu.addItem(withTitle: "Refresh Sources", action: #selector(refresh), keyEquivalent: "r").target = self
        viewMenu.addItem(.separator())
        let sections = WebDashboardPage.sections
        for (index, section) in sections.enumerated() {
            let item = viewMenu.addItem(withTitle: section.1, action: #selector(navigateSection(_:)), keyEquivalent: String(index + 1))
            item.target = self
            item.representedObject = section.0
        }
        viewMenu.addItem(.separator())

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
        windowMenu.addItem(withTitle: "Bring All to Front", action: #selector(NSApplication.arrangeInFront(_:)), keyEquivalent: "")
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
        removeDismissMonitors()
    }

    // The popover stays semitransient so a dashboard handoff inside this app
    // does not close it early. These monitors close it on any click outside
    // it, in this app or in another one, as other menu-bar panels do.
    private func installDismissMonitors() {
        guard dismissMonitors.isEmpty, popover.isShown || usageWindow?.isVisible == true else { return }
        let mouseDown: NSEvent.EventTypeMask = [.leftMouseDown, .rightMouseDown, .otherMouseDown]
        // A click on the menu-bar icon is left to togglePanel.
        let onIcon: () -> Bool = { [weak self] in
            self?.statusItem.button?.window?.frame.contains(NSEvent.mouseLocation) == true
        }
        if let global = NSEvent.addGlobalMonitorForEvents(matching: mouseDown, handler: { [weak self] _ in
            DispatchQueue.main.async { if !onIcon() { self?.closeUsage() } }
        }) { dismissMonitors.append(global) }
        if let local = NSEvent.addLocalMonitorForEvents(matching: mouseDown, handler: { [weak self] event in
            guard let self, !onIcon() else { return event }
            let panelWindow = self.popover.contentViewController?.view.window
            if event.window !== panelWindow, event.window !== self.usageWindow { self.closeUsage() }
            return event
        }) { dismissMonitors.append(local) }
    }

    private func removeDismissMonitors() {
        dismissMonitors.forEach(NSEvent.removeMonitor)
        dismissMonitors.removeAll()
    }

    private func webPanelContent(size: NSSize) -> NSViewController? {
        guard let resources = Bundle.main.resourceURL else { return nil }
        if webPanel == nil {
            webPanel = WebPanelController(runtime: store.runtime, resources: resources) { [weak self] action in
                guard let self else { return }
                if self.reportsPanelTiming { print("panel-action name=\(action.rawValue)"); fflush(stdout) }
                switch action {
                case .refresh: self.store.refreshLimitsFirst()
                case .checkUpdates: self.checkForUpdates()
                case .openSettings: self.openPanelSettings()
                case .openDashboard: self.openDefault()
                }
            }
            // The page reloads its snapshot when a collection ends.
            collectionObserver = store.$refreshing.dropFirst().removeDuplicates().filter { !$0 }
                .receive(on: DispatchQueue.main).sink { [weak self] _ in self?.webPanel?.snapshotChanged() }
        }
        webPanel?.preferredContentSize = size
        webPanel?.view.setFrameSize(size)
        webPanel?.loadIfNeeded()
        return webPanel
    }

    // Timing is printed only with --panel-timing. The web panel also takes its
    // height from the page once the page reports that it has drawn.
    private func panelOpened(since start: CFAbsoluteTime) {
        let report: (String) -> Void = { [weak self] kind in
            guard self?.reportsPanelTiming == true else { return }
            print("panel-open kind=\(kind) ms=\(Int(((CFAbsoluteTimeGetCurrent() - start) * 1000).rounded()))")
            fflush(stdout)
        }
        guard let webPanel else { return }
        webPanel.whenDrawn { [weak self] height in
            report(height == nil ? "web-not-ready" : "web")
            guard let self, let height else { return }
            let visible = (self.statusItem.button?.window?.screen ?? NSScreen.main)?.visibleFrame.height ?? 800
            let size = NSSize(width: webPanel.preferredContentSize.width, height: min(height, max(240, visible - 48)))
            webPanel.preferredContentSize = size
            if self.popover.isShown { self.popover.contentSize = size }
            else if let window = self.usageWindow, window.isVisible {
                let top = window.frame.maxY
                window.setContentSize(size)
                window.setFrameTopLeftPoint(NSPoint(x: window.frame.minX, y: top))
            }
            if self.reportsPanelTiming {
                webPanel.describe { [weak self] facts in
                    guard let self else { return }
                    print("panel-facts \(facts)")
                    fflush(stdout)
                    if let runtime = self.previewRuntime {
                        webPanel.savePreview(to: runtime.appendingPathComponent("panel-timing.png"))
                        if !self.openedTimingDashboard {
                            self.openedTimingDashboard = true
                            self.openDefault()
                        }
                    }
                }
            }
        }
    }

    private func usageContent(size: NSSize) -> NSViewController {
        guard let web = webPanelContent(size: size) else {
            preconditionFailure("Bundled web panel resources unavailable")
        }
        return web
    }

    private func openPanelSettings() { openDashboard("settings") }

    private func showFloatingUsage(size: NSSize, visible: NSRect) {
        let window = NSPanel(contentRect: NSRect(origin: .zero, size: size),
            styleMask: [.titled, .closable, .utilityWindow, .nonactivatingPanel], backing: .buffered, defer: false)
        window.title = "Observatory usage"
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
        let alreadyOpen = popover.isShown
        let start = CFAbsoluteTimeGetCurrent()
        presentUsage()
        installDismissMonitors()
        if !alreadyOpen { panelOpened(since: start) }
    }

    private func presentUsage() {
        store.reload()
        // A status-item click opens only the usage surface. Activating the app
        // here can bring its existing dashboard forward behind the popup.
        if popover.isShown { return }
        if let usageWindow { usageWindow.makeKeyAndOrderFront(nil); return }
        guard let button = statusItem.button else { return }
        let visible = button.window?.screen?.visibleFrame ?? NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 800, height: 600)
        let width = min(WebPanelController.width, max(240, visible.width - 32))
        let size = NSSize(width: width, height: min(webPanel?.contentHeight ?? 520, max(240, visible.height - 48)))
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
        // Every opening starts at all devices and Day.
        panelSize = size
        popover.contentViewController = usageContent(size: size)
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
        menu.addItem(withTitle: "Check for updates…", action: #selector(checkForUpdates), keyEquivalent: "").target = self
        menu.addItem(withTitle: "Settings and device connection…", action: #selector(sourceSettings), keyEquivalent: "").target = self
        menu.addItem(.separator())
        menu.addItem(withTitle: "Pair with Windows…", action: #selector(setupPairing), keyEquivalent: "").target = self
        menu.addItem(withTitle: "Disconnect paired device…", action: #selector(disconnectPairing), keyEquivalent: "").target = self
        menu.addItem(withTitle: "Prepare pairing repair…", action: #selector(preparePairingRepair), keyEquivalent: "").target = self
        menu.addItem(withTitle: "Direct device pairing…", action: #selector(setupDirectPairing), keyEquivalent: "").target = self
        menu.addItem(.separator())
        let login = menu.addItem(withTitle: "Launch at login", action: #selector(toggleLogin), keyEquivalent: "")
        login.target = self
        login.isEnabled = previewRuntime == nil && selectedRuntime == nil
        login.state = SMAppService.mainApp.status == .enabled ? .on : .off
        menu.addItem(withTitle: "Login settings…", action: #selector(loginSettings), keyEquivalent: "").target = self
        menu.addItem(.separator())
        menu.addItem(withTitle: "Quit Observatory", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        guard let button = statusItem.button else { return }
        menu.popUp(positioning: nil, at: NSPoint(x: 0, y: button.bounds.minY), in: button)
    }

    @objc private func toggleLogin() {
        guard !store.shuttingDown else { return }
        guard previewRuntime == nil, selectedRuntime == nil else { return }
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
        guard previewRuntime == nil, selectedRuntime == nil else { return }
        SMAppService.openSystemSettingsLoginItems()
    }
    @objc private func sourceSettings() {
        guard !store.shuttingDown else { return }
        closeUsage()
        openDashboard("settings")
    }
    @objc private func refresh() { store.refreshLimitsFirst() }
    @objc private func setupDirectPairing() {
        guard !store.shuttingDown, previewRuntime == nil, selectedRuntime == nil else { return }
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
        guard previewRuntime == nil, selectedRuntime == nil else { return }
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
        guard previewRuntime == nil, selectedRuntime == nil else { return }
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
        guard previewRuntime == nil, selectedRuntime == nil else { return }
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
    @objc private func openDefault() { openDashboard("allowances") }

    @objc private func navigateSection(_ sender: NSMenuItem) {
        guard !store.shuttingDown,
              let section = sender.representedObject as? String else { return }
        let sections = WebDashboardPage.sections
        guard sections.contains(where: { $0.0 == section }) else { return }
        openDashboard(section)
    }

    @objc private func zoomIn() {
        guard let webView else { return }
        webView.pageZoom = CGFloat(DashboardZoom.step(from: Double(webView.pageZoom), increasing: true))
    }
    @objc private func zoomOut() {
        guard let webView else { return }
        webView.pageZoom = CGFloat(DashboardZoom.step(from: Double(webView.pageZoom), increasing: false))
    }
    @objc private func actualSize() {
        webView?.pageZoom = 1
    }
    @objc private func doubleSize() {
        webView?.pageZoom = 2
    }

    func validateMenuItem(_ item: NSMenuItem) -> Bool {
        if store.shuttingDown { return false }
        let zoom: Double? = webView.map { Double($0.pageZoom) }
        switch item.action {
        case #selector(navigateSection(_:)):
            guard let section = item.representedObject as? String else { return false }
            let sections = WebDashboardPage.sections
            guard sections.contains(where: { $0.0 == section }) else { return false }
            let current = webDashboardSection
            item.state = detail?.isVisible == true && current == section ? .on : .off
            return true
        case #selector(setupDirectPairing): return previewRuntime == nil && selectedRuntime == nil
        case #selector(checkForUpdates), #selector(setupPairing), #selector(disconnectPairing), #selector(preparePairingRepair),
             #selector(toggleLogin), #selector(loginSettings): return previewRuntime == nil && selectedRuntime == nil
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
        let needsSetup = (try? FirstRunSetup.required(runtime: store.runtime)) != false
        if detail == nil {
            guard let resources = Bundle.main.resourceURL else { return }
            let web = WebDashboardPage.isBundled(resources: resources) ? makeWebDashboard(runtime: store.runtime, resources: resources, bridge: bridgeHandler) : nil
            let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1150, height: 770),
                                  styleMask: [.titled, .closable, .miniaturizable, .resizable],
                                  backing: .buffered, defer: false)
            window.title = previewRuntime != nil ? "Observatory web preview" : "Observatory"
            window.titlebarAppearsTransparent = true
            window.minSize = NSSize(width: 800, height: 550)
            if let web {
                window.contentView = web
            } else {
                let container = NSView()
                let label = NSTextField(wrappingLabelWithString: "The dashboard could not start. This build is missing its dashboard page. Collection is separate from this window.")
                label.translatesAutoresizingMaskIntoConstraints = false
                container.addSubview(label)
                NSLayoutConstraint.activate([
                    label.leadingAnchor.constraint(equalTo: container.leadingAnchor, constant: 30),
                    label.trailingAnchor.constraint(equalTo: container.trailingAnchor, constant: -30),
                    label.topAnchor.constraint(equalTo: container.topAnchor, constant: 30),
                    label.bottomAnchor.constraint(lessThanOrEqualTo: container.bottomAnchor, constant: -30)
                ])
                window.contentView = container
            }
            window.delegate = self
            window.isReleasedWhenClosed = false
            if previewRuntime == nil && selectedRuntime == nil { window.setFrameAutosaveName("ObservatoryDetail") }
            window.center()
            detail = window
            webView = web
        }
        webDashboardSection = needsSetup ? "setup" : WebDashboardPage.section(for: tab == "setup" ? "limits" : tab)
        webView?.load(URLRequest(url: WebDashboardPage.url(section: webDashboardSection)))
        if reportsPanelTiming, let web = webView {
            describeViewer(web) { [weak self, weak web] facts in
                guard let self, let webView = self.webView, webView === web else { return }
                print("dashboard-facts \(facts)")
                fflush(stdout)
                if let runtime = self.previewRuntime {
                    saveViewerPreview(webView, to: runtime.appendingPathComponent("dashboard-timing.png"))
                }
            }
        }

        if detail?.isMiniaturized == true { detail?.deminiaturize(nil) }
        detail?.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    func windowWillClose(_ notification: Notification) {
        if let window = notification.object as? NSWindow, window === usageWindow {
            window.contentViewController = nil
            usageWindow = nil
            if !popover.isShown { removeDismissMonitors() }
            return
        }
        guard let window = notification.object as? NSWindow, window === detail else { return }
        bridgeHandler?.dashboardClosed()
        // Closing the main window releases its web view, while the panel web view is kept.
        webView?.stopLoading()
        webView?.configuration.userContentController.removeAllScriptMessageHandlers()
        detail?.contentView = nil
        webView = nil
        detail = nil
    }

    private func checkDashboardLifecycle(remaining: Int) {
        let menus = NSApp.mainMenu?.items.compactMap(\.submenu) ?? []
        precondition(menus.map(\.title) == ["Observatory", "File", "Edit", "View", "Window"])
        // macOS may add its own writing tools, dictation and emoji commands.
        let expectedEdits = ["Undo", "Redo", "Cut", "Copy", "Paste", "Select All"]
        let editItems = menus[2].items.filter { expectedEdits.contains($0.title) }
        precondition(editItems.map(\.title) == expectedEdits)
        precondition(editItems.allSatisfy { $0.target == nil })
        precondition(menus[1].items.contains { $0.keyEquivalent == "w" && $0.action == #selector(NSWindow.performClose(_:)) })
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
        DispatchQueue.main.asyncAfter(deadline: .now() + 1) { [self] in
            let deadline = Date().addingTimeInterval(5)
            @MainActor func closeWhenLoaded() {
                if webView?.isLoading == true || webView?.url == nil {
                    precondition(Date() < deadline, "Dashboard loading timed out")
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) { closeWhenLoaded() }
                    return
                }
                precondition(webView?.url?.path == "/dashboard.html", "Dashboard page did not load")
                precondition(webView?.url?.fragment == "activity", "Dashboard activity section did not load")
                let invalid = NSMenuItem(title: "Invalid", action: #selector(navigateSection(_:)), keyEquivalent: "")
                invalid.representedObject = "unrecognized"
                precondition(!validateMenuItem(invalid), "Invalid dashboard section accepted")
                let section = webDashboardSection
                let url = webView?.url
                navigateSection(invalid)
                precondition(webDashboardSection == section && webView?.url == url, "Invalid item changed the web section")

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
            closeWhenLoaded()
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
            var sampleWindows = windows
            sampleWindows[0]["remainingPercent"] = 65 + Double(11 - index) * 5 / 3
            return ["checkedAt": iso.string(from: now.addingTimeInterval(Double(index - 11) * 300)), "windows": sampleWindows]
        }
        store.snapshot = Snapshot(object: ["schema": 2, "collectedAt": iso.string(from: now),
            "activity": [], "tokens": [], "settings": [], "dictation": [],
            "quota": ["status": "ok", "checkedAt": iso.string(from: now), "windows": windows, "history": history,
                      "pace": [["bucket": "codex", "window": "primary", "asOf": iso.string(from: now),
                                "status": "projected", "coverageFraction": 0.8125, "percentagePointsPerHour": 20,
                                "estimatedExhaustionAt": iso.string(from: now.addingTimeInterval(3.25 * 3600)),
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
        Task { @MainActor [self] in
            guard let webPanel else { preconditionFailure("Web usage panel was not created") }
            let height: CGFloat? = await withCheckedContinuation { continuation in
                webPanel.whenDrawn { continuation.resume(returning: $0) }
            }
            precondition(height != nil, "Web usage panel did not draw")

            // Request the accessibility tree through a client while the
            // main thread remains available to service AppKit.
            let accessibilityResult = await Task.detached {
                let app = AXUIElementCreateApplication(ProcessInfo.processInfo.processIdentifier)
                AXUIElementSetMessagingTimeout(app, 3)
                var windows: CFTypeRef?
                return AXUIElementCopyAttributeValue(app, kAXWindowsAttribute as CFString, &windows)
            }.value
            guard accessibilityResult == .success else {
                print("Native usage popup failed: accessibility client request returned \(accessibilityResult.rawValue)")
                exit(1)
            }
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
            guard detail == nil else {
                print("Native usage popup failed: opening the menu-bar popup opened the dashboard")
                exit(1)
            }
            guard let web = webPanel.view as? WKWebView else { preconditionFailure("Web usage view missing") }
            let script = """
            const groups = [...document.querySelectorAll('fieldset.ob-segments')]
            const labels = groups.map(group => group.getAttribute('aria-label'))
            const buttons = groups.map(group => [...group.querySelectorAll('button')])
            const selected = buttons.map(group => group.filter(button => button.getAttribute('aria-pressed') === 'true').map(button => button.textContent))
            return window.observatoryPanelReady === true && labels.join('|') === 'Device|Period' &&
                buttons[0].some(button => button.textContent === 'All') &&
                !buttons[0].some(button => button.textContent === 'Ubuntu') &&
                buttons[1].map(button => button.textContent).join('|') === 'Now|Day|Week|Month|All time' &&
                selected[0].join('|') === 'All' && selected[1].join('|') === 'Day'
            """
            let valid = try? await web.callAsyncJavaScript(script, arguments: [:], in: nil, contentWorld: .page)
            precondition(NSApp.activationPolicy() == .regular && valid as? Bool == true,
                         "Web usage filter inventory or default selection differs")
            print("Web usage popup passed: production panel visible on screen, accessible filters default to all devices and Day, regular app activation")

            if CommandLine.arguments.contains("--preview-pace") { return }
            openDefault()
            precondition(webDashboardSection == "limits")
            // AppKit can hide the window before its closing animation updates
            // isShown. Wait for the closed state with a bounded deadline.
            afterUsageClosed { [self] in
                guard usageWindow == nil, !popover.isShown, detail?.isVisible == true else {
                    print("Native usage popup failed: dashboard handoff did not close the usage view")
                    exit(1)
                }
                // Establish activation from AppKit state before simulating a
                // later status-item click. A fixed delay races slow runners.
                afterDashboardActivated { [self] in
                detail?.orderOut(nil)
                showUsage()
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [self] in
                    guard detail?.isVisible == false else {
                        print("Native usage popup failed: reopening usage raised the hidden dashboard, active=\(NSApp.isActive) dashboardKey=\(detail?.isKeyWindow ?? false) anchoredShown=\(popover.isShown) fallbackVisible=\(usageWindow?.isVisible ?? false)")
                        exit(1)
                    }
                    guard popover.isShown || usageWindow?.isVisible == true else {
                        print("Native usage popup failed: usage view did not reopen beside the dashboard, active=\(NSApp.isActive) anchoredShown=\(popover.isShown) fallbackRetained=\(usageWindow != nil) fallbackVisible=\(usageWindow?.isVisible ?? false) anchor=\(String(describing: statusItem.button?.window?.frame)) failedAnchor=\(String(describing: unreliableUsageAnchor))")
                        exit(1)
                    }
                    if let unreliableUsageAnchor, statusItem.button?.window?.frame == unreliableUsageAnchor {
                        precondition(usageWindow?.isVisible == true && !popover.isShown)
                    }
                    let previousDashboard = detail
                    openPanelSettings()
                    precondition(detail === previousDashboard)
                    precondition(webDashboardSection == "settings")
                    afterUsageClosed { [self] in
                        guard usageWindow == nil, !popover.isShown, detail?.isVisible == true, expectedDashboardPresent else {
                            print("Native usage popup failed after close: usageRetained=\(usageWindow != nil) anchoredShown=\(popover.isShown) dashboardPresent=\(detail != nil) dashboardVisible=\(detail?.isVisible ?? false) webRetained=\(webView != nil)")
                            exit(1)
                        }
                        print("Native usage popup passed: dashboard handoff and Settings gear reused the dashboard")
                        detail?.performClose(nil)
                        NSApp.terminate(nil)
                    }
                }
                }
            }
        }
    }

    private func afterDashboardActivated(deadline: Date = Date().addingTimeInterval(2), completion: @escaping () -> Void) {
        if NSApp.isActive, detail?.isKeyWindow == true, detail?.isVisible == true { completion(); return }
        guard Date() < deadline else {
            print("Native usage popup failed: dashboard activation deadline exceeded, active=\(NSApp.isActive) dashboardKey=\(detail?.isKeyWindow ?? false) dashboardVisible=\(detail?.isVisible ?? false)")
            exit(1)
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) { [self] in
            afterDashboardActivated(deadline: deadline, completion: completion)
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
    @objc private func checkForUpdates() {
        guard previewRuntime == nil, selectedRuntime == nil else { return }
        do { try updateController.check() }
        catch {
            let alert = NSAlert()
            alert.messageText = "Observatory updates"
            alert.informativeText = error.localizedDescription
            alert.runModal()
        }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        guard let store else { return .terminateNow }
        if store.shuttingDown { return .terminateLater }
        bridgeHost?.documentEnded()
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
        if popover.isShown || usageWindow?.isVisible == true { return false }
        openDashboard(webDashboardSection)
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

#if OBSERVATORY_PREVIEW_ONLY
// UI tools may relaunch a closed app without preserving its launch arguments.
// Preview-only builds must never fall through to the installed data runtime.
let previewArguments = Array(CommandLine.arguments.dropFirst())
let allowedPreviewArguments = [["--self-test"], ["--preview"], ["--preview", "--preview-setup"],
    ["--test-popup"], ["--test-popup", "--force-offscreen-popup"], ["--test-quota-archive"]]
guard allowedPreviewArguments.contains(previewArguments) else {
    print("Preview-only build requires an explicit isolated preview mode")
    exit(64)
}
#endif

let realDataFolder = FileManager.default.homeDirectoryForCurrentUser
    .appendingPathComponent("Library/Application Support/Observatory")
let runtimeOption = RuntimeOption.parse(arguments: CommandLine.arguments, realDataFolder: realDataFolder, userID: getuid())
let selectedRuntime: URL?
var runtimeLockDescriptor: Int32 = -1
var runtimeDirectoryDescriptor: Int32 = -1
var selectedRuntimeIdentity: FileIdentity?
switch runtimeOption {
case .none: selectedRuntime = nil
case .refused(let reason):
    fputs(reason + "\n", stderr)
    exit(64)
case .runtime(let folder, let identity):
    selectedRuntime = folder
    selectedRuntimeIdentity = identity
}

let removedArguments: Set<String> = ["--legacy-dashboard", "--native-viewer", "--render-style",
    "--render-archive-style", "--preview-quota-archive"]
if CommandLine.arguments.dropFirst().contains(where: { removedArguments.contains($0) }) {
    fputs("This option was removed.\n", stderr)
    exit(64)
}

if let selectedRuntime {
    do {
        let locked = try RuntimeOption.createAndLock(selectedRuntime, realDataFolder: realDataFolder)
        runtimeLockDescriptor = locked.descriptor
        if selectedRuntimeIdentity == nil { selectedRuntimeIdentity = locked.createdIdentity }
    }
    catch RuntimeOption.LockError.realDataFolder {
        fputs("--runtime cannot use the real Observatory data folder or a folder inside it.\n", stderr)
        exit(64)
    } catch RuntimeOption.LockError.inUse {
        fputs("Another Observatory is already using this folder.\n", stderr)
        exit(64)
    } catch {
        fputs("The runtime folder could not be created or locked.\n", stderr)
        exit(64)
    }
    runtimeDirectoryDescriptor = open(selectedRuntime.path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
    guard let identity = selectedRuntimeIdentity,
          FileIdentity.matches(descriptor: runtimeDirectoryDescriptor, path: selectedRuntime.path, expected: identity),
          FileIdentity.at(realDataFolder.path) != identity else {
        fputs("The runtime folder changed while it was being checked.\n", stderr)
        exit(64)
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
} else if CommandLine.arguments.contains("--test-quota-archive") {
    Task { @MainActor in
        do { try await testQuotaArchiveBridge(); exit(0) }
        catch { print("Packaged allowance archive test failed: \((error as NSError).domain) \((error as NSError).code)"); exit(1) }
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
    if CommandLine.arguments.contains("--preview") || selectedRuntime != nil {
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
