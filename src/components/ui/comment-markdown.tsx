import { useEffect, useState, type ComponentProps } from "react";
import Markdown, { RuleType } from "markdown-to-jsx";
import { codeToHtml, type BundledLanguage } from "shiki";
import type { ThemeRegistrationResolved } from "@shikijs/types";
import pierreDarkTheme from "@pierre/theme/pierre-dark";
import pierreLightTheme from "@pierre/theme/pierre-light";
import { useDocumentDarkMode } from "../../hooks/use-document-dark-mode";

const CODE_THEME = {
  dark: { id: "pierre-dark", theme: toShikiTheme(pierreDarkTheme) },
  light: { id: "pierre-light", theme: toShikiTheme(pierreLightTheme) },
} as const;

const codeHtmlCache = new Map<string, Promise<string>>();

function toShikiTheme(theme: typeof pierreDarkTheme): ThemeRegistrationResolved {
  const semanticTokenColors = Object.fromEntries(
    Object.entries(theme.semanticTokenColors).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );

  return {
    ...theme,
    settings: theme.tokenColors.map((token) => ({
      ...token,
      settings: { ...token.settings },
    })),
    tokenColors: theme.tokenColors.map((token) => ({
      ...token,
      settings: { ...token.settings },
    })),
    semanticTokenColors,
    fg: theme.colors["editor.foreground"] ?? theme.colors.foreground ?? "#000000",
    bg: theme.colors["editor.background"] ?? "#ffffff",
  };
}

function normalizeLanguage(language: string | undefined) {
  if (!language) return "text";

  switch (language.toLowerCase()) {
    case "js":
    case "jsx":
      return "javascript";
    case "ts":
    case "tsx":
      return "typescript";
    case "sh":
    case "shell":
      return "bash";
    default:
      return language.toLowerCase();
  }
}

function getThemeEntry(isDark: boolean) {
  return isDark ? CODE_THEME.dark : CODE_THEME.light;
}

function InlineCode({ children, ...props }: ComponentProps<"code">) {
  return (
    <code
      {...props}
      className="rounded bg-canvas px-1 py-0.5 font-mono text-[0.92em] text-ink-900"
    >
      {children}
    </code>
  );
}

function MarkdownCodeBlock({
  lang,
  text,
}: {
  lang?: string;
  text: string;
}) {
  const [html, setHtml] = useState<string>("");
  const isDark = useDocumentDarkMode();

  useEffect(() => {
    let cancelled = false;
    const normalizedLanguage = normalizeLanguage(lang);
    const themeEntry = getThemeEntry(isDark);
    const cacheKey = `${themeEntry.id}:${normalizedLanguage}:${text}`;

    let promise = codeHtmlCache.get(cacheKey);
    if (!promise) {
      promise = codeToHtml(text, {
        lang: normalizedLanguage as BundledLanguage,
        theme: themeEntry.theme,
      });
      codeHtmlCache.set(cacheKey, promise);
    }

    void promise
      .then((result) => {
        if (!cancelled) {
          setHtml(result);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setHtml("");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [isDark, lang, text]);

  if (!html) {
    return (
      <pre className="m-0 overflow-x-auto rounded-lg border border-ink-200 bg-canvas p-3 text-sm leading-6 text-ink-800">
        <code>{text}</code>
      </pre>
    );
  }

  return (
    <div
      className="overflow-x-auto rounded-lg border border-ink-200 bg-canvas text-sm [&_.shiki]:m-0 [&_.shiki]:p-3"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function CommentMarkdown({ body }: { body: string }) {
  return (
    <div className="font-sans whitespace-normal break-words">
      <Markdown
        options={{
          disableParsingRawHTML: true,
          renderRule(next, node) {
            if (node.type === RuleType.codeBlock) {
              return (
                <MarkdownCodeBlock
                  lang={node.lang}
                  text={String(node.text ?? "")}
                />
              );
            }

            return next();
          },
          overrides: {
            a: {
              component: ({ children, ...props }) => (
                <a
                  {...props}
                  className="text-ink-700 underline-offset-2 hover:text-ink-900 hover:underline"
                  rel="noreferrer"
                  target="_blank"
                >
                  {children}
                </a>
              ),
            },
            blockquote: {
              component: ({ children, ...props }) => (
                <blockquote
                  {...props}
                  className="m-0 border-l-2 border-ink-200 pl-3 text-ink-600"
                >
                  {children}
                </blockquote>
              ),
            },
            code: { component: InlineCode },
            li: {
              component: ({ children, ...props }) => (
                <li {...props} className="my-1 leading-6 text-ink-800">
                  {children}
                </li>
              ),
            },
            ol: {
              component: ({ children, ...props }) => (
                <ol {...props} className="my-2 list-decimal pl-5">
                  {children}
                </ol>
              ),
            },
            p: {
              component: ({ children, ...props }) => (
                <p
                  {...props}
                  className="my-2 leading-6 text-ink-800 first:mt-0 last:mb-0"
                >
                  {children}
                </p>
              ),
            },
            pre: {
              component: ({ children, ...props }) => (
                <div {...props} className="my-3">
                  {children}
                </div>
              ),
            },
            ul: {
              component: ({ children, ...props }) => (
                <ul {...props} className="my-2 list-disc pl-5">
                  {children}
                </ul>
              ),
            },
          },
        }}
      >
        {body}
      </Markdown>
    </div>
  );
}

export { CommentMarkdown };
