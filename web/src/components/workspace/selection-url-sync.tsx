"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";

import {
  mergeSelectionIntoQuery,
  selectionFromParams,
  selectionSignature,
} from "@/lib/state/selection-url";
import { useWorkspaceSelection } from "@/lib/state/selection";

/**
 * Keeps the workspace selection and the URL in step.
 * - On load and on back/forward the URL wins and hydrates the store.
 * - Any later change to the store rewrites the query with `history.replaceState`, non-default
 *   parameters only, leaving parameters owned by the page untouched.
 * Renders nothing. Mounted once by WorkspaceFrame inside a Suspense boundary.
 */
export function SelectionUrlSync() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const query = searchParams.toString();
  const lastWritten = useRef<string | null>(null);

  // URL -> store
  useEffect(() => {
    const signature = selectionSignature(query);
    if (signature === lastWritten.current) return;
    lastWritten.current = signature;
    const fromStore = selectionSignature(
      mergeSelectionIntoQuery("", useWorkspaceSelection.getState()),
    );
    if (signature === fromStore) return;
    // A bare URL on a stage change keeps the selection already held in the store.
    if (signature === "" && fromStore !== "") {
      lastWritten.current = null;
      return;
    }
    useWorkspaceSelection
      .getState()
      .hydrate(selectionFromParams(new URLSearchParams(query)));
  }, [query]);

  // store -> URL
  useEffect(() => {
    const write = () => {
      const current = window.location.search.replace(/^\?/, "");
      const next = mergeSelectionIntoQuery(
        current,
        useWorkspaceSelection.getState(),
      );
      const signature = selectionSignature(next);
      if (next === current) {
        lastWritten.current = signature;
        return;
      }
      lastWritten.current = signature;
      window.history.replaceState(
        null,
        "",
        `${window.location.pathname}${next ? `?${next}` : ""}${window.location.hash}`,
      );
    };
    write();
    return useWorkspaceSelection.subscribe(write);
  }, [pathname]);

  return null;
}
