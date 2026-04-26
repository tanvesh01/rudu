import { startTransition, useEffect, useRef, useState } from "react";
import {
  parsePatchFiles,
  trimPatchContext,
  type FileDiffMetadata,
} from "@pierre/diffs";
import type { PrPatch } from "../types/github";
import PatchParserWorker from "../pierre-patch-parser-worker.ts?worker";

type ParsedPatchState = {
  fileDiffs: FileDiffMetadata[];
  parseError: string;
  isParsing: boolean;
};

type ParsePatchWorkerRequest = {
  type: "parse-patch";
  requestId: number;
  patch: string;
  cacheKeyPrefix: string;
  contextSize: number;
};

type ParsePatchWorkerResponse =
  | {
      type: "parse-patch-success";
      requestId: number;
      fileDiffs: FileDiffMetadata[];
    }
  | {
      type: "parse-patch-error";
      requestId: number;
      error: string;
    };

function parsePatchLocally(
  patch: string,
  cacheKeyPrefix: string,
  contextSize: number,
): FileDiffMetadata[] {
  const trimmedPatch = trimPatchContext(patch, contextSize);
  return parsePatchFiles(trimmedPatch, cacheKeyPrefix).flatMap(
    (parsedPatch) => parsedPatch.files,
  );
}

const AGGRESSIVE_PATCH_CONTEXT_SIZE = 3;

export function usePatchParsing(selectedPatch: PrPatch | null) {
  const [parsedPatch, setParsedPatch] = useState<ParsedPatchState>({
    fileDiffs: [],
    parseError: "",
    isParsing: false,
  });
  const patchParserWorkerRef = useRef<Worker | null>(null);
  const parseRequestIdRef = useRef(0);
  const pendingParseRequestRef = useRef<ParsePatchWorkerRequest | null>(null);

  useEffect(() => {
    let worker: Worker | null = null;

    try {
      worker = new PatchParserWorker();
    } catch (error) {
      console.error("Failed to initialize patch parser worker.", error);
      patchParserWorkerRef.current = null;
      return undefined;
    }

    patchParserWorkerRef.current = worker;

    const handleWorkerMessage = (
      event: MessageEvent<ParsePatchWorkerResponse>,
    ) => {
      const message = event.data;
      if (message.requestId !== parseRequestIdRef.current) {
        return;
      }

      startTransition(() => {
        if (message.type === "parse-patch-success") {
          setParsedPatch({
            fileDiffs: message.fileDiffs,
            parseError: "",
            isParsing: false,
          });
          return;
        }

        setParsedPatch({
          fileDiffs: [],
          parseError: message.error,
          isParsing: false,
        });
      });
    };

    const handleWorkerError = (event: ErrorEvent) => {
      console.error(
        "Patch parser worker failed.",
        event.error ?? event.message,
      );

      const pendingRequest = pendingParseRequestRef.current;
      if (
        !pendingRequest ||
        pendingRequest.requestId !== parseRequestIdRef.current
      ) {
        return;
      }

      try {
        const fileDiffs = parsePatchLocally(
          pendingRequest.patch,
          pendingRequest.cacheKeyPrefix,
          pendingRequest.contextSize,
        );

        startTransition(() => {
          setParsedPatch({
            fileDiffs,
            parseError: "",
            isParsing: false,
          });
        });
      } catch (error) {
        startTransition(() => {
          setParsedPatch({
            fileDiffs: [],
            parseError:
              error instanceof Error
                ? error.message
                : "Failed to parse the PR patch.",
            isParsing: false,
          });
        });
      }
    };

    worker.addEventListener("message", handleWorkerMessage);
    worker.addEventListener("error", handleWorkerError);

    return () => {
      worker.removeEventListener("message", handleWorkerMessage);
      worker.removeEventListener("error", handleWorkerError);
      worker.terminate();
      patchParserWorkerRef.current = null;
    };
  }, []);

  useEffect(() => {
    parseRequestIdRef.current += 1;

    if (!selectedPatch?.patch) {
      setParsedPatch({ fileDiffs: [], parseError: "", isParsing: false });
      return;
    }

    setParsedPatch({ fileDiffs: [], parseError: "", isParsing: true });

    const request = {
      type: "parse-patch",
      requestId: parseRequestIdRef.current,
      patch: selectedPatch.patch,
      cacheKeyPrefix: `${selectedPatch.repo}-${selectedPatch.number}-${selectedPatch.headSha}`,
      contextSize: AGGRESSIVE_PATCH_CONTEXT_SIZE,
    } satisfies ParsePatchWorkerRequest;

    pendingParseRequestRef.current = request;

    if (!patchParserWorkerRef.current) {
      try {
        const fileDiffs = parsePatchLocally(
          request.patch,
          request.cacheKeyPrefix,
          request.contextSize,
        );
        setParsedPatch({ fileDiffs, parseError: "", isParsing: false });
      } catch (error) {
        setParsedPatch({
          fileDiffs: [],
          parseError:
            error instanceof Error
              ? error.message
              : "Failed to parse the PR patch.",
          isParsing: false,
        });
      }
      return;
    }

    patchParserWorkerRef.current.postMessage(request);
  }, [selectedPatch]);

  return { parsedPatch };
}
