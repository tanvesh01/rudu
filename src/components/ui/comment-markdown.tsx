import { useEffect, useState, type ComponentProps } from "react";
import Markdown, { RuleType } from "markdown-to-jsx";
import { codeToHtml, type BundledLanguage } from "shiki";

const CODE_THEME = {
  dark: "github-dark",
  light: "github-light",
} as const;

const codeHtmlCache = new Map<string, Promise<string>>();

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

function getTheme(isDark: boolean) {
  return isDark ? CODE_THEME.dark : CODE_THEME.light;
}

function usePrefersDarkMode() {
  const [isDark, setIsDark] = useState(() => {
    if (typeof window === "undefined") return true;
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  });

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = () => setIsDark(mediaQuery.matches);

    handleChange();
    mediaQuery.addEventListener("change", handleChange);

    return () => mediaQuery.removeEventListener("change", handleChange);
  }, []);

  return isDark;
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
  const isDark = usePrefersDarkMode();

  useEffect(() => {
    let cancelled = false;
    const normalizedLanguage = normalizeLanguage(lang);
    const theme = getTheme(isDark);
    const cacheKey = `${theme}:${normalizedLanguage}:${text}`;

    let promise = codeHtmlCache.get(cacheKey);
    if (!promise) {
      promise = codeToHtml(text, {
        lang: normalizedLanguage as BundledLanguage,
        theme,
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
      className="overflow-x-auto rounded-lg border border-ink-200 bg-canvas text-sm"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function CommentMarkdown({ body }: { body: string }) {
  return (
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
              <p {...props} className="my-2 leading-6 text-ink-800 first:mt-0 last:mb-0">
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
  );
}

export { CommentMarkdown };
