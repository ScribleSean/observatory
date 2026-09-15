import SwiftUI

struct ActivityWatchHelp: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("ActivityWatch is a separate application. Install and run it on the device you want to track, enable ActivityWatch in Observatory Settings, then refresh sources. If it is already running, check its local server on port 5600. Missing readings remain Unknown. Tokens and Allowances can be used independently.")
                .observatoryFont(.callout).foregroundStyle(.secondary)
            Link("ActivityWatch installation and help", destination: URL(string: "https://activitywatch.net/")!)
        }
    }
}
