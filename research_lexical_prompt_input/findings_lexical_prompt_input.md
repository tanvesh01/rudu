## Lexical model

- Lexical's source of truth is an editor state, not the DOM. That state contains a node tree that starts from the root node and a selection.
- The root node represents the contenteditable itself. Lexical intentionally forbids inserting text nodes directly under the root, so visible text normally appears under child element nodes such as paragraphs.
- Text nesting such as root -> paragraph -> text is therefore expected and should not be "flattened" in Rudu's prompt editor.

Source: https://lexical.dev/docs/concepts/editor-state
Source: https://lexical.dev/docs/concepts/nodes

## React structure

- The React integration composes LexicalComposer with RichTextPlugin or PlainTextPlugin.
- RichTextPlugin receives the ContentEditable element and placeholder; plugins consume the editor instance from LexicalComposer context.
- The docs also call out that plugins can require registered nodes via initialConfig.nodes.

Source: https://lexical.dev/docs/react/plugins

## Local Rudu finding

- `src/features/review-chat/review-chat-prompt-editor.tsx` uses the correct LexicalComposer -> RichTextPlugin -> ContentEditable shape.
- The broken input appearance comes from passing `theme: {}` while using RichTextPlugin. The default paragraph DOM is a native `p`, so browser default paragraph margins leak into the prompt input.
- The existing review comment composer already avoids this class of issue by assigning paragraph classes in its Lexical theme.
- The focused fix is to give the prompt editor a paragraph theme that resets margins and preserves the prompt input line height.
