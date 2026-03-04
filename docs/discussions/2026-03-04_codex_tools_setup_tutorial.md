# Codex Tooling Setup Tutorial (MCP + Better Code Navigation)

Date: 2026-03-04

## Goal
Set up Codex so it can use richer external tools (for example docs lookup, repo-aware indexing, AST/LSP helpers) instead of only plain text search.

## Key Point
Codex itself does not have a universal "AST mode" toggle in this project.  
To get AST/LSP-style capabilities, you connect an MCP server that provides those tools.

## 1) Add MCP servers to Codex

Use either CLI or config file.

### CLI pattern
```bash
codex mcp add <name> --url <server-url>
```

Example from OpenAI docs:
```bash
codex mcp add openaiDeveloperDocs --url https://developers.openai.com/mcp
```

### Config file pattern
In `~/.codex/config.toml`:

```toml
[mcp_servers.openaiDeveloperDocs]
url = "https://developers.openai.com/mcp"
```

You can also configure enable/disable behavior in Codex config:
- `enabled_tools`
- `disabled_tools`
- per-server `required` (if supported by your Codex build)
- timeout-related options

## 2) Verify tool availability

After adding MCP servers:
1. Restart Codex (or reload config if your build supports it).
2. Ask Codex to use the tool directly (example: "search official OpenAI docs for X").
3. Confirm tool calls in logs/output.

If tools do not appear, check:
- MCP server URL reachable
- auth/environment requirements for that server
- config syntax errors in `config.toml`

## 3) Why logs sometimes show plain search

When you see logs like:
- `Searched for ...`
- `Read runtime.js`

that typically means text search/read operations (grep-style or file reads).  
AST/LSP behavior appears only when an active tool provides those semantics and Codex chooses it.

## 4) Practical recommendation for this repo

For this codebase, keep both:
1. Fast text search (`rg`) for broad discovery.
2. MCP tools for semantic tasks (symbol refs, structural edits, doc-grounded lookups).

This gives good speed + precision without forcing everything through one tool path.

## References
- OpenAI Codex MCP docs: <https://developers.openai.com/codex/mcp>
- OpenAI Codex config reference: <https://developers.openai.com/codex/config-reference>
- OpenAI MCP docs hub: <https://developers.openai.com/resources/docs-mcp>
