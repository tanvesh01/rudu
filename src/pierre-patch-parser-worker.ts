import { parsePatchFiles, trimPatchContext, type FileDiffMetadata } from "@pierre/diffs";

type ParsePatchRequest = {
  type: "parse-patch";
  requestId: number;
  patch: string;
  cacheKeyPrefix: string;
  contextSize: number;
};

type ParsePatchSuccess = {
  type: "parse-patch-success";
  requestId: number;
  fileDiffs: FileDiffMetadata[];
};

type ParsePatchError = {
  type: "parse-patch-error";
  requestId: number;
  error: string;
};

type ParsePatchResponse = ParsePatchSuccess | ParsePatchError;

function postResponse(message: ParsePatchResponse) {
  self.postMessage(message);
}

self.onmessage = (event: MessageEvent<ParsePatchRequest>) => {
  const message = event.data;

  if (message.type !== "parse-patch") {
    return;
  }

  try {
    const trimmedPatch = trimPatchContext(message.patch, message.contextSize);
    const fileDiffs = parsePatchFiles(trimmedPatch, message.cacheKeyPrefix).flatMap(
      (parsedPatch) => parsedPatch.files,
    );

    postResponse({
      type: "parse-patch-success",
      requestId: message.requestId,
      fileDiffs,
    });
  } catch (error) {
    postResponse({
      type: "parse-patch-error",
      requestId: message.requestId,
      error:
        error instanceof Error ? error.message : "Failed to parse the PR patch.",
    });
  }
};
