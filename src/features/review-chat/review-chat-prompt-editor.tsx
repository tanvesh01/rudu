import { AutoFocusPlugin } from "@lexical/react/LexicalAutoFocusPlugin";
import { ClearEditorPlugin } from "@lexical/react/LexicalClearEditorPlugin";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import {
  ArrowTopRightOnSquareIcon,
  DocumentTextIcon,
} from "@heroicons/react/20/solid";
import {
  $getRoot,
  $isElementNode,
  CLEAR_EDITOR_COMMAND,
  type EditorState,
  type LexicalNode,
} from "lexical";
import {
  $isBeautifulMentionNode,
  BeautifulMentionsPlugin,
  createBeautifulMentionNode,
  type BeautifulMentionsItem,
  type BeautifulMentionsItemData,
  type BeautifulMentionsMenuItemProps,
  type BeautifulMentionsMenuProps,
} from "lexical-beautiful-mentions";
import Fuse from "fuse.js";
import {
  forwardRef,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type KeyboardEvent,
} from "react";
import { getPullRequestSummary } from "../../queries/github-native";
import type { IssueSummary } from "../../types/issues";
import {
  addReviewChatAttachment,
  isInlineReviewChatAttachment,
  type ReviewChatAttachment,
  type ReviewChatInlineAttachmentRange,
} from "./line-selection";
import { ReviewChatMentionAttachment } from "./attachments/ReviewChatMentionAttachment";
import { IssueProviderIcon } from "./attachments/IssueAttachment";
import {
  createAttachmentFromMentionData,
  createIssueMentionItem,
  createPullRequestMentionItem,
  createWorkspaceFileMentionItem,
} from "./attachments/mention-attachment-data";

type ReviewChatPromptDraft = {
  attachments: ReviewChatAttachment[];
  inlineAttachments: ReviewChatInlineAttachmentRange[];
  text: string;
};

type PullRequestMentionTarget = {
  number: number;
  repo: string;
};

type ReviewChatPromptEditorProps = {
  autoFocus?: boolean;
  clearSignal: number;
  currentRepo: string | null;
  disabled: boolean;
  knownIssues: IssueSummary[];
  placeholder: string;
  sessionHeadSha: string | null;
  sessionId: string | null;
  workspaceFiles: string[];
  onChange(draft: ReviewChatPromptDraft): void;
};

const REVIEW_CHAT_MENTION_NODES = createBeautifulMentionNode(
  ReviewChatMentionAttachment,
);
const MENTION_TRIGGER = "@";
const MENTION_PUNCTUATION = "\\,\\*\\?\\$\\|{}\\(\\)\\^\\[\\]\\\\!%'\"~=<>:;";

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function parsePullRequestMention(
  query: string,
  currentRepo: string | null,
): PullRequestMentionTarget | null {
  const currentRepoMatch = query.match(/^#([1-9]\d*)$/);
  if (currentRepoMatch && currentRepo) {
    return {
      repo: currentRepo,
      number: Number(currentRepoMatch[1] ?? 0),
    };
  }

  const crossRepoMatch = query.match(
    /^([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)#([1-9]\d*)$/,
  );
  if (!crossRepoMatch) {
    return null;
  }

  return {
    repo: crossRepoMatch[1] ?? "",
    number: Number(crossRepoMatch[2] ?? 0),
  };
}

function readMentionKind(
  data: Record<string, BeautifulMentionsItemData> | undefined,
) {
  return typeof data?.kind === "string" ? data.kind : null;
}

function readIssueProvider(
  data: Record<string, BeautifulMentionsItemData> | undefined,
) {
  return data?.provider === "linear" ? "linear" : "github";
}

function readIssueState(
  data: Record<string, BeautifulMentionsItemData> | undefined,
) {
  return typeof data?.state === "string" ? data.state : "";
}

function getIssueStateClassName(state: string) {
  const normalizedState = state.toLowerCase();

  if (normalizedState === "open") {
    return "text-emerald-600 dark:text-emerald-300";
  }

  if (normalizedState === "in progress") {
    return "text-amber-600 dark:text-amber-300";
  }

  return "text-ink-500";
}

function MentionMenu({ className, loading, ...props }: BeautifulMentionsMenuProps) {
  return (
    <ul
      className={cx(
        "z-50 m-0 max-h-56 w-full overflow-y-auto rounded-md border border-ink-200 bg-surface p-1 text-xs shadow-lg",
        className,
      )}
      data-loading={loading ? "true" : undefined}
      {...props}
    />
  );
}

const MentionMenuItem = forwardRef<
  HTMLLIElement,
  BeautifulMentionsMenuItemProps
>(function MentionMenuItem({ item, selected, ...itemProps }, ref) {
  const { itemValue, label, ...props } = itemProps;
  void itemValue;
  void label;
  const kind = readMentionKind(item.data);
  const title =
    kind === "issue"
      ? `${item.value} ${item.data?.title ?? ""}`.trim()
      : item.value;
  const issueState = kind === "issue" ? readIssueState(item.data) : "";
  const subtitle =
    kind === "workspace-file"
      ? ""
      : kind === "pull-request"
        ? "Pull request"
        : kind === "issue"
          ? issueState
          : "Mention";
  const subtitleClassName =
    kind === "issue" ? getIssueStateClassName(issueState) : "text-ink-500";
  const icon =
    kind === "pull-request" ? (
      <ArrowTopRightOnSquareIcon aria-hidden="true" className="size-3.5" />
    ) : kind === "issue" ? (
      <IssueProviderIcon provider={readIssueProvider(item.data)} />
    ) : (
      <DocumentTextIcon aria-hidden="true" className="size-3.5" />
    );

  return (
    <li
      className={cx(
        "flex cursor-pointer items-center gap-1.5 rounded px-1.5 py-1 text-left outline-none transition",
        selected ? "bg-canvasDark" : "hover:bg-canvasDark",
      )}
      {...props}
      ref={ref}
    >
      <span className="inline-flex shrink-0 items-center justify-center text-ink-500">
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate font-medium text-ink-800">
        {title}
      </span>
      {subtitle ? (
        <span
          className={`shrink-0 truncate text-[11px] leading-5 ${subtitleClassName}`}
        >
          {subtitle}
        </span>
      ) : null}
    </li>
  );
});

function MentionEmpty() {
  return (
    <div className="rounded px-2 py-2 text-xs text-ink-500">
      No mentions found.
    </div>
  );
}

function PromptPlaceholder({ text }: { text: string }) {
  return (
    <div className="pointer-events-none absolute left-2 top-2 text-xs leading-5 text-ink-400">
      {text}
    </div>
  );
}

function appendPromptText(draft: ReviewChatPromptDraft, text: string) {
  draft.text += text.replace(/\u200B/g, "");
}

function appendPromptNode(
  draft: ReviewChatPromptDraft,
  node: LexicalNode,
) {
  if ($isBeautifulMentionNode(node)) {
    const start = draft.text.length;
    const attachment = createAttachmentFromMentionData(node.getData());
    appendPromptText(draft, node.getTextContent());

    if (attachment && isInlineReviewChatAttachment(attachment)) {
      const end = draft.text.length;
      draft.attachments = addReviewChatAttachment(
        draft.attachments,
        attachment,
      );
      draft.inlineAttachments.push({
        attachment,
        end,
        start,
        text: draft.text.slice(start, end),
      });
    }

    return;
  }

  if ($isElementNode(node)) {
    const children = node.getChildren();

    children.forEach((child, index) => {
      appendPromptNode(draft, child);

      if (
        $isElementNode(child) &&
        index !== children.length - 1 &&
        !child.isInline()
      ) {
        appendPromptText(draft, "\n\n");
      }
    });
    return;
  }

  appendPromptText(draft, node.getTextContent());
}

function readPromptDraft(editorState: EditorState): ReviewChatPromptDraft {
  let draft: ReviewChatPromptDraft = {
    attachments: [],
    inlineAttachments: [],
    text: "",
  };

  editorState.read(() => {
    appendPromptNode(draft, $getRoot());
  });

  return draft;
}

function EditablePlugin({ disabled }: { disabled: boolean }) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    editor.setEditable(!disabled);
  }, [disabled, editor]);

  return null;
}

function ClearSignalPlugin({ clearSignal }: { clearSignal: number }) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    if (clearSignal === 0) return;
    editor.dispatchCommand(CLEAR_EDITOR_COMMAND, undefined);
  }, [clearSignal, editor]);

  return null;
}

function ReviewChatPromptEditor({
  autoFocus,
  clearSignal,
  currentRepo,
  disabled,
  knownIssues,
  placeholder,
  sessionHeadSha,
  sessionId,
  workspaceFiles,
  onChange,
}: ReviewChatPromptEditorProps) {
  const editorFrameRef = useRef<HTMLDivElement>(null);
  const fileFuse = useMemo(
    () =>
      new Fuse(workspaceFiles, {
        ignoreLocation: true,
        threshold: 0.35,
      }),
    [workspaceFiles],
  );
  const issueFuse = useMemo(
    () =>
      new Fuse(knownIssues, {
        ignoreLocation: true,
        keys: ["key", "title", "repo", "teamName"],
        threshold: 0.35,
      }),
    [knownIssues],
  );
  const searchMentions = useCallback(
    async (
      trigger: string,
      queryString?: string | null,
    ): Promise<BeautifulMentionsItem[]> => {
      if (
        trigger !== MENTION_TRIGGER ||
        !sessionId ||
        !sessionHeadSha ||
        disabled
      ) {
        return [];
      }

      const query = queryString?.trim() ?? "";
      const pullRequestTarget = parsePullRequestMention(query, currentRepo);
      if (pullRequestTarget) {
        try {
          const pullRequest = await getPullRequestSummary(pullRequestTarget);
          return [
            createPullRequestMentionItem(pullRequestTarget.repo, pullRequest),
          ];
        } catch {
          return [];
        }
      }

      if (query.includes("#")) {
        return [];
      }

      const issueMatches = query
        ? issueFuse.search(query, { limit: 5 }).map((result) => result.item)
        : knownIssues.slice(0, 5);
      const fileMatches = query
        ? fileFuse.search(query, { limit: 6 }).map((result) => result.item)
        : workspaceFiles.slice(0, 6);
      const fileItems = fileMatches.map(createWorkspaceFileMentionItem);
      const issueItems = issueMatches.map(createIssueMentionItem);

      return query.includes("/") || query.includes(".")
        ? [...fileItems, ...issueItems]
        : [...issueItems, ...fileItems];
    },
    [
      currentRepo,
      disabled,
      fileFuse,
      issueFuse,
      knownIssues,
      sessionHeadSha,
      sessionId,
      workspaceFiles,
    ],
  );
  const handleChange = useCallback(
    (editorState: EditorState) => {
      onChange(readPromptDraft(editorState));
    },
    [onChange],
  );
  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        event.currentTarget.closest("form")?.requestSubmit();
      }
    },
    [],
  );

  useEffect(() => {
    const root = document.documentElement;

    function updateMentionMenuBounds() {
      const frame = editorFrameRef.current;
      if (!frame) return;

      const rect = frame.getBoundingClientRect();
      const left = `${rect.left + window.pageXOffset}px`;
      const top = `${rect.top + window.pageYOffset}px`;
      const width = `${rect.width}px`;
      const height = `${rect.height}px`;

      root.style.setProperty(
        "--review-chat-mention-menu-left",
        left,
      );
      root.style.setProperty(
        "--review-chat-mention-menu-width",
        width,
      );

      const anchor = document.querySelector<HTMLElement>(
        ".review-chat-mention-menu-anchor",
      );
      if (!anchor) return;

      anchor.style.setProperty("left", left, "important");
      anchor.style.setProperty("top", top, "important");
      anchor.style.setProperty("width", width, "important");
      anchor.style.setProperty("height", height, "important");
    }

    updateMentionMenuBounds();

    const frame = editorFrameRef.current;
    const resizeObserver = new ResizeObserver(updateMentionMenuBounds);
    if (frame) {
      resizeObserver.observe(frame);
    }
    const mutationObserver = new MutationObserver(updateMentionMenuBounds);
    mutationObserver.observe(document.body, {
      childList: true,
      subtree: true,
    });

    window.addEventListener("resize", updateMentionMenuBounds);
    document.addEventListener("scroll", updateMentionMenuBounds, {
      capture: true,
      passive: true,
    });

    return () => {
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      window.removeEventListener("resize", updateMentionMenuBounds);
      document.removeEventListener("scroll", updateMentionMenuBounds, {
        capture: true,
      });
      root.style.removeProperty("--review-chat-mention-menu-left");
      root.style.removeProperty("--review-chat-mention-menu-width");
    };
  }, []);

  return (
    <LexicalComposer
      initialConfig={{
        editable: !disabled,
        namespace: "review-chat-prompt-editor",
        nodes: [...REVIEW_CHAT_MENTION_NODES],
        onError(error) {
          throw error;
        },
        theme: {},
      }}
    >
      <div className="relative" ref={editorFrameRef}>
        <RichTextPlugin
          ErrorBoundary={LexicalErrorBoundary}
          contentEditable={
            <ContentEditable
              aria-label={placeholder}
              className="max-h-32 min-h-10 w-full overflow-y-auto whitespace-pre-wrap break-words rounded-lg bg-canvas px-2 py-2 text-sm leading-5 text-ink-900 outline-none transition disabled:cursor-not-allowed disabled:opacity-60"
              onKeyDown={handleKeyDown}
              spellCheck={false}
            />
          }
          placeholder={<PromptPlaceholder text={placeholder} />}
        />
      </div>
      <BeautifulMentionsPlugin
        allowSpaces
        autoSpace
        creatable={false}
        emptyComponent={MentionEmpty}
        insertOnBlur={false}
        menuAnchorClassName="review-chat-mention-menu-anchor"
        menuComponent={MentionMenu}
        menuItemComponent={MentionMenuItem}
        menuItemLimit={8}
        onSearch={searchMentions}
        punctuation={MENTION_PUNCTUATION}
        searchDelay={120}
        showCurrentMentionsAsSuggestions={false}
        triggers={[MENTION_TRIGGER]}
      />
      <HistoryPlugin />
      <ClearEditorPlugin />
      <ClearSignalPlugin clearSignal={clearSignal} />
      <EditablePlugin disabled={disabled} />
      <OnChangePlugin
        ignoreHistoryMergeTagChange
        ignoreSelectionChange
        onChange={handleChange}
      />
      {autoFocus ? <AutoFocusPlugin /> : null}
    </LexicalComposer>
  );
}

export { ReviewChatPromptEditor };
export type { ReviewChatPromptDraft };
