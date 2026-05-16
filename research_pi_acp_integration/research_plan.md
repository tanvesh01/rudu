# Pi ACP Integration Research Plan

## Main Question

Can Rudu simplify or delete parts of its current Pi ACP integration now that review context will come from local Review Workspaces instead of a Cloudflare Worker-backed file API?

## Subtopics

1. Pi ACP adapter contract
   - Confirm how `pi-acp` starts Pi, how `PI_ACP_PI_COMMAND` works, and whether Rudu still needs wrapper scripts.

2. Agent Client Protocol capabilities
   - Confirm the current ACP session/prompt/tool/permission event model and whether Rudu's event translation layer can be simplified.

3. Pi tool extension model
   - Confirm how custom Pi tools are registered and whether local Review Workspace tools can replace Worker-backed tools without changing ACP.

## Synthesis

Compare current documented behavior with Rudu's implementation and identify what should stay, what can be deleted immediately, and what should remain deferred.
