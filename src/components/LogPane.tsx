import type {
  SessionLogLine,
  SessionSnapshot,
} from "../services/SessionManager.js";
import type { TranscriptMessage } from "../domain/transcript.js";
import { SyntaxStyle, RGBA } from "@opentui/core";
import { theme } from "../app/theme.js";

interface LogPaneProps {
  session: SessionSnapshot | null;
  logs: SessionLogLine[];
  transcripts?: TranscriptMessage[];
}

const streamColors: Record<string, string> = {
  stdout: theme.stream.stdout,
  stderr: theme.stream.stderr,
  system: theme.stream.system,
};

const roleColors: Record<string, string> = {
  user: "#888888",      // grey for "You" label
  assistant: "#4ade80", // green for "Assistant" label
  tool: "#4ade80",      // green for tool calls
  system: "#666666",    // muted grey
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

// Monochrome syntax style for markdown rendering (white on black with green accents)
const markdownSyntaxStyle = SyntaxStyle.fromStyles({
  "markup.heading.1": { fg: RGBA.fromHex("#ffffff"), bold: true },
  "markup.heading.2": { fg: RGBA.fromHex("#ffffff"), bold: true },
  "markup.heading.3": { fg: RGBA.fromHex("#ffffff"), bold: true },
  "markup.heading.4": { fg: RGBA.fromHex("#ffffff"), bold: true },
  "markup.heading.5": { fg: RGBA.fromHex("#ffffff"), bold: true },
  "markup.heading.6": { fg: RGBA.fromHex("#ffffff"), bold: true },
  "markup.list": { fg: RGBA.fromHex("#cccccc") },
  "markup.list.checked": { fg: RGBA.fromHex("#4ade80") },
  "markup.list.unchecked": { fg: RGBA.fromHex("#cccccc") },
  "markup.raw": { fg: RGBA.fromHex("#888888") },
  "markup.raw.block": { fg: RGBA.fromHex("#888888") },
  "markup.strong": { bold: true },
  "markup.italic": { italic: true },
  "markup.strikethrough": { dim: true },
  "markup.link": { fg: RGBA.fromHex("#4ade80"), underline: true },
  "markup.link.url": { fg: RGBA.fromHex("#4ade80"), underline: true },
  "markup.link.label": { fg: RGBA.fromHex("#4ade80") },
  "markup.quote": { fg: RGBA.fromHex("#888888") },
  default: { fg: RGBA.fromHex("#ffffff") },
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
                  <box flexDirection="row" alignItems="flex-start">
                    <text fg="#4ade80" content={msg.text} />
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
                  width={
                    msg.role === "user" || msg.role === "assistant"
                      ? "80%"
                      : "100%"
                  }
                  flexDirection="column"
                  alignItems={msg.role === "user" ? "flex-end" : "flex-start"}
                >
                  <box marginBottom={1}>
                    <text
                      fg={roleColors[msg.role] ?? theme.fg}
                      content={roleLabels[msg.role] ?? msg.role}
                    />
                  </box>

                  {msg.role === "assistant" ? (
                    <box width="100%">
                      <markdown
                        content={msg.text}
                        syntaxStyle={markdownSyntaxStyle}
                        streaming={true}
                        conceal={true}
                      />
                    </box>
                  ) : (
                    <text fg="#ffffff" content={msg.text} />
                  )}
                </box>
              </box>
            );
          })
        ) : process.env.NODE_ENV === "development" ? (
          // Demo mode: show sample assistant message with markdown (only in dev)
          <box
            width="100%"
            flexDirection="row"
            justifyContent="flex-start"
            marginBottom={1}
          >
            <box width="80%" flexDirection="column" alignItems="flex-start">
              <box marginBottom={1}>
                <text fg="#4ade80" content="Assistant (Demo)" />
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
            <text content="Waiting for output..." fg={theme.fgDark} />
          </box>
        ) : (
          logs.map((log, i) => (
            <box key={i} marginBottom={1}>
              <text
                content={log.text}
                fg={streamColors[log.stream] ?? theme.fg}
              />
            </box>
          ))
        )}
      </scrollbox>
    </box>
  );
}
