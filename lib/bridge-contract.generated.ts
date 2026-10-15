// Generated from lib/bridge-contract.json by scripts/build-bridge-contract.mjs. Do not edit.
export const BRIDGE_CONTRACT = {
  "version": 1,
  "source": "docs/DESIGN.md, Settings bridge contract",
  "message": {
    "maxBytes": 4096,
    "maxDepth": 16,
    "id": {
      "min": 1,
      "max": 2147483647
    },
    "keys": [
      "id",
      "action",
      "args"
    ]
  },
  "codes": [
    "done",
    "refused",
    "busy",
    "cancelled",
    "unavailable",
    "expired"
  ],
  "limits": {
    "queue": 4,
    "resultTimeoutSeconds": 60,
    "cacheRefreshSeconds": 5,
    "pairingPollSeconds": 2
  },
  "status": {
    "version": 1,
    "maxBytes": 16384,
    "appVersionMaxLength": 32,
    "customSkinsMax": 32
  },
  "dashboardFragments": [
    "limits",
    "activity",
    "tokens",
    "dictation",
    "sources",
    "settings",
    "setup"
  ],
  "whiteSpace": [
    9,
    10,
    11,
    12,
    13,
    32,
    133,
    160,
    5760,
    8192,
    8193,
    8194,
    8195,
    8196,
    8197,
    8198,
    8199,
    8200,
    8201,
    8202,
    8232,
    8233,
    8239,
    8287,
    12288
  ],
  "address": {
    "maxLength": 39,
    "ipv4": [
      [
        "10.0.0.0",
        8
      ],
      [
        "172.16.0.0",
        12
      ],
      [
        "192.168.0.0",
        16
      ],
      [
        "100.64.0.0",
        10
      ]
    ],
    "ipv6FirstGroup": {
      "min": 64512,
      "max": 65023
    }
  },
  "values": {
    "tailscaleStatus": [
      "running",
      "offline",
      "needs-login",
      "needs-device-approval",
      "stopped",
      "starting",
      "other-user",
      "not-installed",
      "unsupported",
      "unavailable"
    ],
    "pairingState": [
      "idle",
      "identity-ready",
      "identity-required",
      "identity-recovery-required",
      "inactive",
      "waiting",
      "confirming",
      "awaiting-confirmation",
      "local-ready",
      "acknowledged",
      "configuration-ready",
      "working",
      "cancelled",
      "paired",
      "unpaired",
      "unavailable"
    ],
    "transport": [
      "none",
      "ssh",
      "tls"
    ],
    "sharingReason": [
      "ready",
      "pairing-unavailable",
      "account-unavailable",
      "source-unavailable"
    ],
    "appearance": [
      "system",
      "light",
      "dark"
    ]
  },
  "actions": {
    "refresh": {
      "args": {}
    },
    "check-updates": {
      "args": {}
    },
    "open-dashboard": {
      "args": {
        "section": {
          "type": "enum",
          "values": [
            "limits",
            "activity",
            "tokens",
            "dictation",
            "sources",
            "settings"
          ]
        }
      }
    },
    "open-settings": {
      "args": {}
    },
    "set-source": {
      "args": {
        "source": {
          "type": "enum",
          "values": [
            "activity",
            "codex",
            "claude",
            "wispr",
            "quota"
          ]
        },
        "enabled": {
          "type": "boolean"
        }
      }
    },
    "set-skin": {
      "args": {
        "skin": {
          "type": "skin",
          "bundled": [
            "sage",
            "almanac",
            "instrument",
            "amber-crt"
          ],
          "maxLength": 32
        }
      }
    },
    "set-device-name": {
      "args": {
        "name": {
          "type": "deviceName",
          "nullable": true,
          "minUtf16": 1,
          "maxUtf16": 32,
          "forbidden": [
            "/",
            "\\",
            ":"
          ]
        }
      }
    },
    "set-startup": {
      "args": {
        "enabled": {
          "type": "boolean"
        }
      }
    },
    "set-appearance": {
      "args": {
        "mode": {
          "type": "enum",
          "values": [
            "system",
            "light",
            "dark"
          ]
        }
      }
    },
    "set-limits-consent": {
      "args": {
        "enabled": {
          "type": "boolean"
        }
      }
    },
    "set-sharing": {
      "args": {
        "channel": {
          "type": "enum",
          "values": [
            "codex-limits",
            "claude-code-tokens"
          ]
        },
        "enabled": {
          "type": "boolean"
        },
        "token": {
          "type": "hex64",
          "presentWhen": {
            "key": "enabled",
            "equals": true
          }
        }
      }
    },
    "pairing-identity-create": {
      "args": {}
    },
    "pairing-host-start": {
      "args": {
        "address": {
          "type": "address"
        },
        "port": {
          "type": "integer",
          "min": 1024,
          "max": 65535
        }
      },
      "value": true
    },
    "pairing-copy-invitation": {
      "args": {}
    },
    "pairing-host-confirm": {
      "args": {
        "fingerprint": {
          "type": "hex64"
        },
        "peerAddress": {
          "type": "address"
        },
        "peerPort": {
          "type": "integer",
          "min": 1024,
          "max": 65535
        }
      }
    },
    "pairing-join-claim": {
      "args": {
        "invitation": {
          "type": "invitation",
          "prefix": "observatory-pair:v1:",
          "maxLength": 2048
        }
      }
    },
    "pairing-join-confirm": {
      "args": {}
    },
    "pairing-cancel": {
      "args": {},
      "immediate": true
    },
    "pairing-disconnect": {
      "args": {}
    },
    "pairing-repair-prepare": {
      "args": {}
    },
    "tailscale-check": {
      "args": {},
      "value": true
    },
    "export-data": {
      "args": {}
    },
    "status": {
      "args": {},
      "immediate": true,
      "value": true
    },
    "complete-setup": {
      "args": {}
    }
  }
} as const;

export type BridgeAction = "refresh" | "check-updates" | "open-dashboard" | "open-settings" | "set-source" | "set-skin" | "set-device-name" | "set-startup" | "set-appearance" | "set-limits-consent" | "set-sharing" | "pairing-identity-create" | "pairing-host-start" | "pairing-copy-invitation" | "pairing-host-confirm" | "pairing-join-claim" | "pairing-join-confirm" | "pairing-cancel" | "pairing-disconnect" | "pairing-repair-prepare" | "tailscale-check" | "export-data" | "status" | "complete-setup";
export type BridgeArgs = {
  "refresh": Record<string, never>;
  "check-updates": Record<string, never>;
  "open-dashboard": { "section": "limits" | "activity" | "tokens" | "dictation" | "sources" | "settings" };
  "open-settings": Record<string, never>;
  "set-source": { "source": "activity" | "codex" | "claude" | "wispr" | "quota"; "enabled": boolean };
  "set-skin": { "skin": string };
  "set-device-name": { "name": string | null };
  "set-startup": { "enabled": boolean };
  "set-appearance": { "mode": "system" | "light" | "dark" };
  "set-limits-consent": { "enabled": boolean };
  "set-sharing": { "channel": "codex-limits" | "claude-code-tokens"; "enabled": boolean; "token"?: string };
  "pairing-identity-create": Record<string, never>;
  "pairing-host-start": { "address": string; "port": number };
  "pairing-copy-invitation": Record<string, never>;
  "pairing-host-confirm": { "fingerprint": string; "peerAddress": string; "peerPort": number };
  "pairing-join-claim": { "invitation": string };
  "pairing-join-confirm": Record<string, never>;
  "pairing-cancel": Record<string, never>;
  "pairing-disconnect": Record<string, never>;
  "pairing-repair-prepare": Record<string, never>;
  "tailscale-check": Record<string, never>;
  "export-data": Record<string, never>;
  "status": Record<string, never>;
  "complete-setup": Record<string, never>;
};
export type BridgeCode = "done" | "refused" | "busy" | "cancelled" | "unavailable" | "expired";
export type BridgeResultDetail = { id: number; ok: boolean; code: BridgeCode; value?: unknown };
