import type { SessionLogLine, SessionSnapshot } from "../services/SessionManager.js";
import type { TranscriptMessage } from "../domain/transcript.js";
import { SyntaxStyle, RGBA } from "@opentui/core";

interface LogPaneProps {
  session: SessionSnapshot | null;
  logs: SessionLogLine[];
  transcripts?: TranscriptMessage[];
}

const streamColors: Record<string, string> = {
  stdout: "#cccccc",
  stderr: "#888888",
  system: "#666666",
};

const roleLabels: Record<string, string> = {
  user: "You",
  assistant: "Assistant",
  tool: "Tool",
  system: "System",
};

// Demo markdown content for testing the markdown renderer
const demoMarkdownContent = `# Authentication Refactoring Complete

I've successfully refactored the authentication middleware to use JWT tokens.

## Changes Made

1. **Replaced session-based auth** with JWT tokens
2. **Added token validation** middleware  
3. **Implemented refresh token** rotation

## Code Example

\`\`\`typescript
const authMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  // Validate JWT...
};
\`\`\`

## Benefits

- **Stateless**: No server-side session storage needed
- **Scalable**: Easy to distribute across multiple servers
- **Secure**: Tokens can have expiration times

> Note: Make sure to store the JWT secret securely!

Check out [the documentation](https://example.com) for more details.`;

// Syntax style for markdown rendering
// Scope names based on OpenTUI's tree-sitter markdown queries
const markdownSyntaxStyle = SyntaxStyle.fromStyles({
  "markup.heading.1": { fg: RGBA.fromHex("#58A6FF"), bold: true },
  "markup.heading.2": { fg: RGBA.fromHex("#58A6FF"), bold: true },
  "markup.heading.3": { fg: RGBA.fromHex("#58A6FF"), bold: true },
  "markup.heading.4": { fg: RGBA.fromHex("#58A6FF"), bold: true },
  "markup.heading.5": { fg: RGBA.fromHex("#58A6FF"), bold: true },
  "markup.heading.6": { fg: RGBA.fromHex("#58A6FF"), bold: true },
  "markup.list": { fg: RGBA.fromHex("#FF7B72") },
  "markup.list.checked": { fg: RGBA.fromHex("#3FB950") },
  "markup.list.unchecked": { fg: RGBA.fromHex("#FF7B72") },
  "markup.raw": { fg: RGBA.fromHex("#A5D6FF") },
  "markup.raw.block": { fg: RGBA.fromHex("#A5D6FF") },
  "markup.strong": { bold: true },
  "markup.italic": { italic: true },
  "markup.strikethrough": { dim: true },
  "markup.link": { fg: RGBA.fromHex("#58A6FF"), underline: true },
  "markup.link.url": { fg: RGBA.fromHex("#79C0FF"), underline: true },
  "markup.link.label": { fg: RGBA.fromHex("#58A6FF") },
  "markup.quote": { fg: RGBA.fromHex("#8B949E") },
  default: { fg: RGBA.fromHex("#E6EDF3") },
});

export function LogPane({ session, logs, transcripts }: LogPaneProps) {
  const hasTranscripts = transcripts && transcripts.length > 0;
  if (!session) {
    return (
      <box flexGrow={1} backgroundColor="#000000">
        <text content="Select a session to view logs" fg="#666666" />
      </box>
    );
  }

  return (
    <box flexDirection="column" flexGrow={1}>
      <box backgroundColor="#111111">
        <text content={session.title} fg="#ffffff" />
        <box marginLeft={2}>
          <text 
            content={hasTranscripts 
              ? `${session.status} | messages: ${transcripts.length}`
              : `${session.status} | lines: ${session.logSummary.retainedLines}${
                  session.logSummary.droppedLines > 0
                    ? ` (${session.logSummary.droppedLines} dropped)`
                    : ""
                }`
            } 
            fg="#666666" 
          />
        </box>
      </box>

      <scrollbox
        flexGrow={1}
        backgroundColor="#000000"
        paddingLeft={2}
        paddingRight={2}
      >
        {hasTranscripts ? (
          transcripts.map((msg, i) => {
            // Tool messages render with minimal chrome - just the tool names on one line
            if (msg.role === "tool") {
              return (
                <box
                  key={i}
                  width="100%"
                  flexDirection="row"
                  justifyContent="flex-start"
                  marginBottom={1}
                >
                  <box
                    flexDirection="row"
                    alignItems="flex-start"
                  >
                    <text fg="#888888" content={msg.text} />
                  </box>
                </box>
              );
            }
            return (
              <box
                key={i}
                width="100%"
                flexDirection="row"
                justifyContent={msg.role === "user" ? "flex-end" : "flex-start"}
                marginBottom={1}
              >
                <box
                  width={msg.role === "user" || msg.role === "assistant" ? "80%" : "100%"}
                  flexDirection="column"
                  alignItems={msg.role === "user" ? "flex-end" : "flex-start"}
                >
                  <box marginBottom={1}>
                    <text fg="#888888" content={roleLabels[msg.role] ?? msg.role} />
                  </box>
                  <box width="100%">
                    {msg.role === "assistant" ? (
                      <markdown
                        content={msg.text}
                        syntaxStyle={markdownSyntaxStyle}
                        streaming={true}
                        conceal={true}
                      />
                    ) : (
                      <text fg="#cccccc" content={msg.text} />
                    )}
                  </box>
                </box>
              </box>
            );
          })
        ) : process.env.NODE_ENV === "development" ? (
          // Demo mode: show sample assistant message with markdown (only in dev)
          <box width="100%" flexDirection="row" justifyContent="flex-start" marginBottom={1}>
            <box width="80%" flexDirection="column" alignItems="flex-start">
              <box marginBottom={1}>
                <text fg="#888888" content="Assistant (Demo)" />
              </box>
              <box width="100%">
                <markdown
                  content={demoMarkdownContent}
                  syntaxStyle={markdownSyntaxStyle}
                  streaming={false}
                  conceal={true}
                />
              </box>
            </box>
          </box>
        ) : logs.length === 0 ? (
          <box marginBottom={1}>
            <text content="Waiting for output..." fg="#666666" />
          </box>
        ) : (
          logs.map((log, i) => (
            <box key={i} marginBottom={1}>
              <text content={log.text} fg={streamColors[log.stream] ?? "#cccccc"} />
            </box>
          ))
        )}
      </scrollbox>
    </box>
  );
}
