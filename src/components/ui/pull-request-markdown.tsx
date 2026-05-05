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

function PullRequestInlineCode({
  children,
  ...props
}: ComponentProps<"code">) {
  return (
    <code
      {...props}
      className="rounded bg-canvas px-1 py-0.5 font-mono text-[0.92em] text-ink-900 before:content-none after:content-none"
    >
      {children}
    </code>
  );
}

function PullRequestCodeBlock({
  lang,
  text,
}: {
  lang?: string;
  text: string;
}) {
  const [html, setHtml] = useState("");
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

function PullRequestMarkdown({ body }: { body: string }) {
  return (
    <div className="prose prose-sm max-w-none break-words text-sm leading-6 dark:prose-invert prose-headings:text-ink-900 prose-h2:mb-3 prose-h2:mt-1 prose-h2:border-b prose-h2:border-ink-200 prose-h2:pb-2 prose-h2:text-lg prose-h2:font-semibold prose-p:my-3 prose-p:text-ink-800 prose-a:text-ink-700 prose-a:underline prose-a:underline-offset-2 hover:prose-a:text-ink-900 prose-strong:text-ink-900 prose-code:text-ink-900 prose-blockquote:border-ink-200 prose-blockquote:text-ink-600 prose-ul:my-3 prose-ul:list-disc prose-ul:pl-6 prose-ol:my-3 prose-ol:list-decimal prose-ol:pl-6 prose-li:my-1 prose-li:pl-0 prose-li:text-ink-800 prose-hr:border-ink-200 prose-pre:bg-transparent prose-pre:p-0">
      <Markdown
        options={{
          disableParsingRawHTML: true,
          forceBlock: true,
          renderRule(next, node) {
            if (node.type === RuleType.codeBlock) {
              return (
                <PullRequestCodeBlock
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
                <a {...props} rel="noreferrer" target="_blank">
                  {children}
                </a>
              ),
            },
            code: { component: PullRequestInlineCode },
            pre: {
              component: ({ children, ...props }) => (
                <div {...props}>{children}</div>
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

export { PullRequestMarkdown };
