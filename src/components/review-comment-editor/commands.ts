import { $createCodeNode, CodeNode } from "@lexical/code";
import { $setBlocksType } from "@lexical/selection";
import type { HeadingNode, QuoteNode } from "@lexical/rich-text";
import {
  $createLineBreakNode,
  $createParagraphNode,
  $createTabNode,
  $createTextNode,
  $getSelection,
  $isRangeSelection,
  $isTextNode,
  $setState,
  type LexicalEditor,
} from "lexical";
import { normalizeSeededCodeText } from "../ui/review-comment-code-text";
import { suggestionBlockState } from "./markdown";

function appendCodeText(codeNode: CodeNode, text: string) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");

  for (let index = 0; index < lines.length; index += 1) {
    const segments = lines[index].split("\t");
    for (
      let segmentIndex = 0;
      segmentIndex < segments.length;
      segmentIndex += 1
    ) {
      const segment = segments[segmentIndex];
      if (segment.length > 0) {
        codeNode.append($createTextNode(segment));
      }
      if (segmentIndex < segments.length - 1) {
        codeNode.append($createTabNode());
      }
    }

    if (index < lines.length - 1) {
      codeNode.append($createLineBreakNode());
    }
  }
}

function insertCodeBlock(
  editor: LexicalEditor,
  language: string,
  codeTheme: string,
  emptyPlaceholder?: string,
) {
  editor.update(() => {
    const selection = $getSelection();
    if (!$isRangeSelection(selection)) {
      return;
    }

    const selectedText = selection.getTextContent();
    const codeNode = $createCodeNode(language);
    codeNode.setTheme(codeTheme);
    if (selectedText.length > 0) {
      appendCodeText(codeNode, normalizeSeededCodeText(selectedText));
    } else if (emptyPlaceholder && emptyPlaceholder.length > 0) {
      appendCodeText(codeNode, normalizeSeededCodeText(emptyPlaceholder));
    } else {
      codeNode.append($createTextNode(""));
    }

    const trailingParagraph = $createParagraphNode();
    selection.insertNodes([codeNode, trailingParagraph]);

    if (selectedText.length > 0) {
      trailingParagraph.selectStart();
      return;
    }

    const firstChild = codeNode.getFirstChild();
    if ($isTextNode(firstChild)) {
      const length = firstChild.getTextContentSize();
      firstChild.select(0, length);
    } else {
      codeNode.selectStart();
    }
  });
}

function insertSuggestionBlock(
  editor: LexicalEditor,
  language: string,
  codeTheme: string,
  emptyPlaceholder?: string,
) {
  editor.update(() => {
    const selection = $getSelection();
    if (!$isRangeSelection(selection)) {
      return;
    }

    const selectedText = selection.getTextContent();
    const codeNode = $createCodeNode(language);
    codeNode.setTheme(codeTheme);
    $setState(codeNode, suggestionBlockState, true);

    if (selectedText.length > 0) {
      appendCodeText(codeNode, normalizeSeededCodeText(selectedText));
    } else if (emptyPlaceholder && emptyPlaceholder.length > 0) {
      appendCodeText(codeNode, normalizeSeededCodeText(emptyPlaceholder));
    } else {
      codeNode.append($createTextNode(""));
    }

    const trailingParagraph = $createParagraphNode();
    selection.insertNodes([codeNode, trailingParagraph]);

    if (selectedText.length > 0) {
      trailingParagraph.selectStart();
      return;
    }

    const firstChild = codeNode.getFirstChild();
    if ($isTextNode(firstChild)) {
      const length = firstChild.getTextContentSize();
      firstChild.select(0, length);
    } else {
      codeNode.selectStart();
    }
  });
}

function setBlockType(
  editor: LexicalEditor,
  factory: () => HeadingNode | QuoteNode,
) {
  editor.update(() => {
    const selection = $getSelection();
    if ($isRangeSelection(selection)) {
      $setBlocksType(selection, factory);
    }
  });
}

export { insertCodeBlock, insertSuggestionBlock, setBlockType };
