# Compose dashboard views with your own Claude

Observatory has an optional MCP server. It lets Claude Code or Claude Desktop build a custom dashboard view from a plain question, such as "show this week's spend by repository next to what landed". You do not need it. The built-in views and the Ask field work without it.

## What it can do

The server offers four tools:

| Tool | What it does |
| --- | --- |
| `get_catalog` | Lists the blocks a view can be made of, the options each takes, the limits and an example. |
| `compose_view` | Checks a view against the block catalog and saves it. A view that fails the check, is over the limits or names an unknown block is refused with the reasons. |
| `list_views` | Lists the saved views, or returns one with its spec so it can be changed. |
| `remove_view` | Deletes one saved view by id. |

A saved view appears in the dashboard's list of saved views and is drawn by the same code as the built-in views. Open it from there.

## What it cannot do

- It cannot read your usage. A view holds block names and queries (which metric, which breakdown, which period), never numbers, session titles or file names. The dashboard fills in the numbers when it draws the view, so the model never sees them.
- It never reads your transcripts, your snapshots, your history or your settings.
- It writes only saved views, in the `public/local/views` folder inside your data folder, at most 50 views of at most 32 KB each.
- It does not start, stop or send anything to an agent, and it does not change the dashboard server, which still answers only GET and HEAD from your own computer.
- It uses no network. It talks to your Claude client over standard input and output.

## Add it to Claude Code

Run this once, with the path to your copy of Observatory:

```sh
claude mcp add observatory -- node /path/to/observatory/scripts/mcp-server.mjs
```

## Add it to Claude Desktop

Open the settings, choose Developer, then Edit Config, and add this to the file it opens. Keep any servers already listed.

```json
{
  "mcpServers": {
    "observatory": {
      "command": "node",
      "args": ["/path/to/observatory/scripts/mcp-server.mjs"]
    }
  }
}
```

Restart Claude Desktop afterwards. On Windows, write the path with forward slashes or doubled backslashes.

## Which data folder

The server reads `observatory.config.json` in the Observatory folder, the same file the collector and the dashboard use, so it saves views in the same data folder the dashboard reads. To use another settings file, set `OBSERVATORY_CONFIG` to its path in the server's environment (`"env": {"OBSERVATORY_CONFIG": "/path/to/file.json"}` in the Desktop config). If the settings file is missing, the server stops and says so on its error output.

## Try it

Ask Claude: "Using the observatory tools, make a view of this week's spend by repository and by model, and the sessions that cost the most." Claude calls `get_catalog`, then `compose_view`. Open the dashboard and pick the view from the saved views list. To drop it, ask Claude to remove it, or delete its file in `public/local/views`.

## Limits and checks

A view is refused when it:

- names a block that is not in the catalog, or an option a block does not take,
- asks for a breakdown a metric does not support, for example commits by model,
- has more than 40 blocks, is nested more than 4 levels deep, or is larger than 32,000 bytes,
- carries a value that is not a query: free numbers, names and text are accepted only as a short plain-text section title.

The dashboard checks each saved view again before it lists it, so a file edited by hand into something invalid is left out.
