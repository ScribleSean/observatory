import Foundation

// Local snapshots may be old or contain unknown fields. Render only fixed
// explanations, never a raw error, private path or unrecognized reason string.
func receiptSourceHelp(_ source: JSONObject?) -> String? {
    guard let source, !["ok", "not-connected"].contains(text(source["status"])) else { return nil }
    switch text(source["reason"]) {
    case "access-denied":
        return "macOS denied access to the receipt folder. Review Observatory's folder permission, then refresh. Development updates may require a new approval."
    case "read-timeout":
        return "Receipt reading timed out. Check for a macOS folder prompt or unavailable storage, then refresh. A timeout does not prove that access was denied."
    case "directory-missing":
        return "The configured receipt folder was not found. Check its location before refreshing."
    case "unsafe-directory":
        return "The receipt source must be a regular folder, not a file or symbolic link."
    case "directory-read-failed":
        return "The receipt folder could not be read. Check folder access and storage availability before refreshing."
    case "worker-start-failed":
        return "The receipt reader could not start. Try reopening Observatory, then refresh."
    case "worker-input-failed", "worker-output-failed":
        return "The local connection to the receipt reader failed. Refresh to retry."
    case "worker-invalid-output", "worker-output-limit":
        return "The receipt reader returned an unsupported response. No receipts from that response were accepted."
    case "worker-failed":
        return "The receipt reader stopped before completing. Refresh to retry."
    default:
        return "Receipt coverage is incomplete. This snapshot has no recognized failure detail. Missing receipts are not zero usage."
    }
}
