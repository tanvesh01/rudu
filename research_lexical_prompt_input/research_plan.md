Main question: how Lexical structures editable content in React, and what that implies for the broken Rudu review-chat prompt input layout/nesting.

Subtopics:
- Lexical document model: root, element, paragraph, text nodes, and why visible text is nested in block nodes.
- React composition: LexicalComposer, RichTextPlugin, ContentEditable, placeholder, and required wrapper responsibilities.
- Rudu implementation check: compare the prompt input component against the recommended Lexical structure and local styling.

Synthesis:
- Use official Lexical docs as the source of truth for the editor model.
- Map those rules to the local `review-chat-prompt-editor` and `prompt-composer` components.
- Recommend or apply the smallest layout fix that preserves Lexical's expected nesting.
