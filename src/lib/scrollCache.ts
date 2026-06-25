// Per-route cache of the state needed to restore an infinite-scroll feed after
// navigating away and back — the core of X/Bsky-style restoration.
//
// Because the feed is fetched in batches, on return we must restore:
//   - posts:        the exact list of items already loaded (so the timeline is
//                   identical and the same number of rows exist)
//   - cursor:       where to resume fetching the next batch
//   - index/delta:  the first visible item + how far we'd scrolled into it
//   - measurements: every measured height/start, so the total scroll height is
//                   reconstructed on the first paint with no jump
//
// Anchoring to an item (index + delta) — not a raw pixel offset — keeps
// restoration drift-free even if items above re-measure slightly.

import type { VirtualItem } from '@tanstack/react-virtual'
import type { Post } from '../data/feed'

interface FeedScrollState {
  posts: Post[]
  cursor: number | null
  index: number
  delta: number
  measurements: VirtualItem[]
  // Masonry only: column count at save time. Item heights depend on column
  // width, so cached measurements are only reusable if columns still match.
  columns?: number
}

const cache = new Map<string, FeedScrollState>()

export function saveFeedScroll(key: string, state: FeedScrollState): void {
  cache.set(key, state)
}

export function loadFeedScroll(key: string): FeedScrollState | undefined {
  return cache.get(key)
}
