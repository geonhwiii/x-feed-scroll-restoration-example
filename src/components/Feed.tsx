import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useVirtualizer } from '@tanstack/react-virtual'
import { fetchPage, type Post } from '../data/feed'
import { loadFeedScroll, saveFeedScroll } from '../lib/scrollCache'
import { PostCard } from './PostCard'

const FEED_KEY = 'home-feed'

export function Feed() {
  const navigate = useNavigate()
  const parentRef = useRef<HTMLDivElement>(null)

  // 상세 페이지에서 돌아온 경우 이전에 불러온 타임라인을 복원하고,
  // 그렇지 않으면 빈 상태로 시작해 첫 페이지를 가져온다.
  const saved = loadFeedScroll(FEED_KEY)
  const [posts, setPosts] = useState<Post[]>(() => saved?.posts ?? [])
  const [cursor, setCursor] = useState<number | null>(() => saved?.cursor ?? 0)
  const loadingRef = useRef(false)

  const loadMore = useCallback(async () => {
    if (loadingRef.current || cursor === null) return
    loadingRef.current = true
    const page = await fetchPage(cursor)
    setPosts((prev) => [...prev, ...page.posts])
    setCursor(page.nextCursor)
    loadingRef.current = false
  }, [cursor])

  // 저장된 상태가 없는 새 마운트에서 첫 fetch를 시작한다.
  useEffect(() => {
    if (posts.length === 0) loadMore()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const virtualizer = useVirtualizer({
    count: posts.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 140,
    overscan: 6,
    // 측정된 높이를 복원해 첫 렌더에서 전체 크기가 올바르게 계산되도록 한다.
    initialMeasurementsCache: saved?.measurements,
  })

  // 저장된 앵커 아이템을 고정해 스크롤을 복원하고, 보이는 행이 재측정되는 동안
  // 몇 프레임에 걸쳐 재적용해 앵커가 밀리지 않게 한다.
  useLayoutEffect(() => {
    if (!saved) return
    let raf = 0
    let tries = 0
    const pin = () => {
      const m = virtualizer.measurementsCache[saved.index]
      if (m) virtualizer.scrollToOffset(m.start + saved.delta)
      if (++tries < 6) raf = requestAnimationFrame(pin)
    }
    pin()
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 최신 상태를 ref에 담아 스크롤마다가 아니라 unmount 시 한 번만 저장한다.
  const snapshot = useRef<() => void>(() => {})
  snapshot.current = () => {
    const offset = virtualizer.scrollOffset ?? 0
    const items = virtualizer.getVirtualItems()
    const anchor = items.find((it) => it.end > offset) ?? items[0]
    saveFeedScroll(FEED_KEY, {
      posts,
      cursor,
      index: anchor?.index ?? 0,
      delta: anchor ? offset - anchor.start : 0,
      measurements: virtualizer.measurementsCache,
    })
  }
  useEffect(() => {
    return () => snapshot.current()
  }, [])

  // 무한 스크롤: 마지막 아이템이 보이면 다음 페이지를 가져온다.
  const items = virtualizer.getVirtualItems()
  const lastItem = items[items.length - 1]
  useEffect(() => {
    if (lastItem && lastItem.index >= posts.length - 1) loadMore()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastItem?.index, posts.length])

  return (
    <div ref={parentRef} className="feed-scroller">
      <header className="feed-header">
        <h1>Home</h1>
        <span className="feed-count">{posts.length.toLocaleString()} loaded</span>
      </header>
      <div className="feed-inner" style={{ minHeight: virtualizer.getTotalSize() }}>
        {items.map((item) => {
          const post = posts[item.index]
          return (
            <div
              key={item.key}
              data-index={item.index}
              ref={virtualizer.measureElement}
              className="feed-row"
              style={{ transform: `translateY(${item.start}px)` }}
            >
              <PostCard post={post} onOpen={() => navigate(`/post/${post.id}`)} />
            </div>
          )
        })}
      </div>
      {cursor !== null && <div className="feed-loading">Loading more…</div>}
    </div>
  )
}
