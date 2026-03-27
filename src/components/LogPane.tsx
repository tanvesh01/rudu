import { useRef, useEffect } from "react";
import type { ScrollBoxRenderable } from "@opentui/core";
import "opentui-spinner/react";
import type {
  SessionLogLine,
  SessionSnapshot,
} from "../services/SessionManager.js";
import { isMissingPiSessionFileError } from "../services/SessionManager.js";
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
  user: "#888888", // grey for "You" label
  assistant: "#4ade80", // green for "Assistant" label
  tool: "#4ade80", // green for tool calls
  system: "#666666", // muted grey
  error: "#ef4444", // red for errors
};

const roleLabels: Record<string, string> = {
  user: "You",
  assistant: "Assistant",
  tool: "Tool",
  system: "System",
  error: "Error",
};

const showMarkdownDemo =
  process.env.NODE_ENV === "development" &&
  process.env.RUDU_MARKDOWN_DEMO === "1";

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

// Combined markdown + code syntax style for OpenTUI markdown rendering.
const markdownSyntaxStyle = SyntaxStyle.fromStyles({
  // Markdown structure
  "markup.heading": { fg: RGBA.fromHex(theme.blue), bold: true },
  "markup.heading.1": { fg: RGBA.fromHex(theme.blue), bold: true },
  "markup.heading.2": { fg: RGBA.fromHex(theme.cyan), bold: true },
  "markup.heading.3": { fg: RGBA.fromHex(theme.green), bold: true },
  "markup.heading.4": { fg: RGBA.fromHex(theme.orange), bold: true },
  "markup.heading.5": { fg: RGBA.fromHex(theme.purple), bold: true },
  "markup.heading.6": { fg: RGBA.fromHex(theme.yellow), bold: true },
  "markup.list": { fg: RGBA.fromHex(theme.fgLight) },
  "markup.list.checked": { fg: RGBA.fromHex(theme.green) },
  "markup.list.unchecked": { fg: RGBA.fromHex(theme.fgLight) },
  "markup.raw": { fg: RGBA.fromHex(theme.orange) },
  "markup.raw.block": { fg: RGBA.fromHex(theme.orange) },
  "markup.raw.inline": { fg: RGBA.fromHex(theme.fgBright) },
  "markup.strong": { fg: RGBA.fromHex(theme.yellow), bold: true },
  "markup.bold": { fg: RGBA.fromHex(theme.yellow), bold: true },
  "markup.italic": { fg: RGBA.fromHex(theme.cyan), italic: true },
  "markup.strikethrough": { fg: RGBA.fromHex(theme.fgDark), dim: true },
  "markup.link": { fg: RGBA.fromHex(theme.blue), underline: true },
  "markup.link.url": { fg: RGBA.fromHex(theme.cyan), underline: true },
  "markup.link.label": { fg: RGBA.fromHex(theme.blue) },
  "markup.quote": { fg: RGBA.fromHex(theme.fgDark), italic: true },

  // Code fences inside markdown
  keyword: { fg: RGBA.fromHex(theme.purple), bold: true },
  string: { fg: RGBA.fromHex(theme.green) },
  comment: { fg: RGBA.fromHex(theme.fgDark), italic: true },
  number: { fg: RGBA.fromHex(theme.orange) },
  boolean: { fg: RGBA.fromHex(theme.orange), bold: true },
  function: { fg: RGBA.fromHex(theme.blue) },
  "function.call": { fg: RGBA.fromHex(theme.blue) },
  type: { fg: RGBA.fromHex(theme.cyan) },
  constructor: { fg: RGBA.fromHex(theme.cyan) },
  property: { fg: RGBA.fromHex(theme.fgLight) },
  variable: { fg: RGBA.fromHex(theme.fgLight) },
  constant: { fg: RGBA.fromHex(theme.orange) },
  operator: { fg: RGBA.fromHex(theme.purple) },
  punctuation: { fg: RGBA.fromHex(theme.fgLight) },

  default: { fg: RGBA.fromHex(theme.white) },
});

export function LogPane({ session, logs, transcripts }: LogPaneProps) {
  const scrollboxRef = useRef<ScrollBoxRenderable>(null);
  const prevSessionId = useRef<string | null>(null);
  const prevTranscriptCount = useRef(0);

  const hasTranscripts = transcripts && transcripts.length > 0;
  const showPiHistoryUnavailable =
    session?.runtimeType === "pi-sdk" &&
    !hasTranscripts &&
    !session.canResume &&
    isMissingPiSessionFileError(session.error);

  // Compute spinner visibility based on transcript state
  const lastMessage = hasTranscripts ? transcripts[transcripts.length - 1] : undefined;
  const hasStreamingAssistant = hasTranscripts
    ? transcripts.some((m) => m.role === "assistant" && m.streaming === true)
    : false;

  // Show spinner immediately after user sends message, before assistant starts streaming
  const waitingForFirstAssistantChunk =
    hasTranscripts &&
    session?.status === "running" &&
    lastMessage?.role === "user";

  const showAssistantSpinner = hasStreamingAssistant || waitingForFirstAssistantChunk;

  // Auto-scroll to bottom on session change or new messages
  useEffect(() => {
    if (!scrollboxRef.current || !session) return;

    const currentSessionId = session.id;
    const currentTranscriptCount = transcripts?.length ?? 0;
    const isNewSession = prevSessionId.current !== currentSessionId;
    const hasNewMessages = currentTranscriptCount > prevTranscriptCount.current;

    // Scroll to bottom when:
    // 1. Loading a new session
    // 2. New messages arrive (streaming)
    if (isNewSession || hasNewMessages) {
      // Set scrollTop to scrollHeight to scroll to bottom
      scrollboxRef.current.scrollTop = scrollboxRef.current.scrollHeight;
    }

    prevSessionId.current = currentSessionId;
    prevTranscriptCount.current = currentTranscriptCount;
  }, [session?.id, transcripts?.length]);

  if (!session) {
    return (
      <box flexGrow={1} backgroundColor="#000000" paddingLeft={2}>
        <text content="Select a session to view logs" fg="#666666" />
      </box>
    );
  }

  return (
    <scrollbox
      ref={scrollboxRef}
      stickyScroll
      flexGrow={1}
      backgroundColor="#000000"
      paddingLeft={2}
      paddingRight={2}
    >
      {showMarkdownDemo ? (
        <box
          width="80%"
          flexDirection="column"
          alignItems="flex-start"
          marginBottom={2}
        >
          <text fg="#4ade80" content="Markdown Demo" marginBottom={1} />
          <markdown
            content={demoMarkdownContent}
            syntaxStyle={markdownSyntaxStyle}
            streaming={false}
            conceal={true}
            width={80}
          />
        </box>
      ) : null}

      {hasTranscripts ? (
        <>
          {transcripts.map((msg, i) => {
            // Tool messages render with minimal chrome - just the tool names on one line
            if (msg.role === "tool") {
              return (
                <text
                  key={i}
                  fg="#4ade80"
                  content={msg.text}
                  marginBottom={1}
                />
              );
            }

            // Error messages render with minimal chrome - just the error text in red
            if (msg.role === "error") {
              return (
                <text
                  key={i}
                  fg="#ef4444"
                  content={msg.text}
                  marginBottom={1}
                />
              );
            }

            const isUser = msg.role === "user";
            const label = roleLabels[msg.role] ?? msg.role;
            const labelColor = roleColors[msg.role] ?? theme.fg;

            return (
              <box
                key={i}
                width={isUser || msg.role === "assistant" ? "80%" : "100%"}
                maxWidth={isUser || msg.role === "assistant" ? 100 : undefined}
                flexDirection="column"
                alignItems={isUser ? "flex-end" : "flex-start"}
                alignSelf={isUser ? "flex-end" : "flex-start"}
                marginBottom={1}
              >
                <text fg={labelColor} content={label} marginBottom={1} />

                {msg.role === "assistant" ? (
                  <markdown
                    content={msg.text}
                    syntaxStyle={markdownSyntaxStyle}
                    streaming={msg.streaming === true}
                    conceal={true}
                    width={80}
                  />
                ) : (
                  <text fg="#ffffff" content={msg.text} />
                )}
              </box>
            );
          })}

          {/* Show spinner when assistant is generating or waiting to start */}
          {showAssistantSpinner ? (
            <box
              width="80%"
              maxWidth={100}
              flexDirection="column"
              alignItems="flex-start"
              alignSelf="flex-start"
              marginBottom={1}
            >
              <text fg="#4ade80" content="Assistant" marginBottom={1} />
              <spinner name="dots" color="#4ade80" />
            </box>
          ) : null}
        </>
      ) : showPiHistoryUnavailable ? (
        <box flexDirection="column">
          <text
            content="History unavailable for this PI session."
            fg="#ef4444"
            marginBottom={1}
          />
          <text content={session.error ?? ""} fg={theme.fgDark} />
        </box>
      ) : process.env.NODE_ENV === "development" ? (
        // Demo mode: show sample assistant message with markdown (only in dev)
        <box width="80%" flexDirection="column" alignItems="flex-start">
          <text fg="#4ade80" content="Assistant (Demo)" marginBottom={1} />
          <markdown
            content={demoMarkdownContent}
            syntaxStyle={markdownSyntaxStyle}
            streaming={false}
            conceal={true}
          />
        </box>
      ) : logs.length === 0 ? (
        <text content="Waiting for output..." fg={theme.fgDark} />
      ) : (
        logs.map((log, i) => (
          <text
            key={i}
            content={log.text}
            fg={streamColors[log.stream] ?? theme.fg}
            marginBottom={1}
          />
        ))
      )}
    </scrollbox>
  );
}
