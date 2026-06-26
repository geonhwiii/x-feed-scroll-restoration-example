// Per-route cache of the *view* state needed to restore an infinite-scroll feed
// after navigating away and back.
//
// The loaded timeline itself (pages + next cursor) now lives in the react-query
// cache (see useFeedQuery), so here we only keep what react-query can't know:
//   - index/delta:  the first visible item + how far we'd scrolled into it
//   - measurements: every measured height/start, so the total scroll height is
//                   reconstructed on the first paint with no jump
//
// Anchoring to an item (index + delta) — not a raw pixel offset — keeps
// restoration drift-free even if items above re-measure slightly.

import type { VirtualItem } from '@tanstack/react-virtual'

interface FeedScrollState {
  index: number
  delta: number
  // Single-column feed: tanstack measured heights/positions.
  measurements?: VirtualItem[]
  // Masonry: per-item measured heights (deterministic round-robin layout).
  heights?: number[]
  // Masonry only: column count at save time. Item heights depend on column
  // width, so cached heights are only reusable if columns still match.
  columns?: number
}

const cache = new Map<string, FeedScrollState>()

export function saveFeedScroll(key: string, state: FeedScrollState): void {
  cache.set(key, state)
}

export function loadFeedScroll(key: string): FeedScrollState | undefined {
  return cache.get(key)
}
