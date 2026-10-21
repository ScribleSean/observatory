# Mac folder permissions

Observatory's development builds currently use ad-hoc signing. Keeping the same application name, bundle identifier and installation folder does not make that signature stable across builds.

macOS associates privacy approvals with a code-signing requirement. An ad-hoc signature identifies a particular version of the code, so rebuilding can cause macOS to request access again. A successful read from a terminal does not prove that the application has the same access. See Apple's [code-signing requirements](https://developer.apple.com/documentation/technotes/tn3127-inside-code-signing-requirements).

## When a source becomes unavailable

1. Check whether macOS is asking Observatory for access to the configured folder. Only approve access that you intend to grant.
2. After approving, refresh Sources and check the new observation. Retained history is separate from a successful current read.
3. If it still fails, inspect the source status. Do not assume every unavailable result means a permission denial.

The receipt reader bounds its optional worker so a blocked folder does not prevent other sources from being saved. New source diagnostics distinguish fixed categories such as `access-denied`, `directory-missing`, `unsafe-directory`, `read-timeout` and worker failures. They do not include configured paths, receipt contents or raw operating-system error messages. These diagnostics require a build containing the updated reader; existing installations do not change when source is pushed.

## Across updates

A lasting distribution solution needs a consistent signing identity and verification of the application's designated requirement across upgrades. Developer ID signing and notarization remain release work, not properties of the current ad-hoc builds. Changing between development and distribution signing can also require a new approval.

Do not edit the macOS privacy database, disable system protections or replace a signing requirement with an identifier-only check to suppress prompts. Repeatedly rebuilding and accepting prompts is not a verified permanent-permission solution.

See [desktop updates](UPDATES.md), [Mac setup](MAC.md) and the [release checklist](RELEASE-CHECKLIST.md).
