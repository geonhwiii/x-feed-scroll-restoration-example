import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useVirtualizer } from '@tanstack/react-virtual'
import { fetchPage, type Post } from '../data/feed'
import { loadFeedScroll, saveFeedScroll } from '../lib/scrollCache'
import { MasonryCard } from './MasonryCard'

const FEED_KEY = 'masonry-feed'

// 화면 너비 → 컬럼 수. 컬럼 수만 반응형으로 바꾸고, 각 아이템의 세로 위치는
// virtualizer의 lanes가 "가장 짧은 열"에 배치해 계산한다(핀터레스트 방식).
function columnsFor(width: number): number {
  if (width < 540) return 1
  if (width < 840) return 2
  if (width < 1140) return 3
  if (width < 1500) return 4
  return 5
}

export function MasonryFeed() {
  const navigate = useNavigate()
  const parentRef = useRef<HTMLDivElement>(null)

  const saved = loadFeedScroll(FEED_KEY)
  const [posts, setPosts] = useState<Post[]>(() => saved?.posts ?? [])
  const [cursor, setCursor] = useState<number | null>(() => saved?.cursor ?? 0)
  // 초기 컬럼 수: 복원 시에는 저장된 값을 그대로 써서 measurements와 레이아웃을 맞춘다.
  const [columns, setColumns] = useState(
    () => saved?.columns ?? columnsFor(typeof window === 'undefined' ? 1200 : window.innerWidth),
  )
  const loadingRef = useRef(false)

  const loadMore = useCallback(async () => {
    if (loadingRef.current || cursor === null) return
    loadingRef.current = true
    const page = await fetchPage(cursor)
    setPosts((prev) => [...prev, ...page.posts])
    setCursor(page.nextCursor)
    loadingRef.current = false
  }, [cursor])

  useEffect(() => {
    if (posts.length === 0) loadMore()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 컨테이너 너비를 관찰해 컬럼 수를 갱신한다.
  useEffect(() => {
    const el = parentRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setColumns(columnsFor(el.clientWidth)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // 저장 시점과 컬럼 수가 같을 때만 측정 캐시를 재사용한다(폭이 달라지면 높이도 달라짐).
  const reuseMeasurements = saved && saved.columns === columns ? saved.measurements : undefined

  const virtualizer = useVirtualizer({
    count: posts.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 280,
    overscan: 8,
    lanes: columns,
    initialMeasurementsCache: reuseMeasurements,
  })

  // 컬럼 수가 "바뀔 때만" 재측정한다. 첫 마운트에서 measure()를 호출하면
  // 복원해 둔 initialMeasurementsCache가 지워져 스크롤 복원이 어긋난다.
  const prevColumns = useRef(columns)
  useLayoutEffect(() => {
    if (prevColumns.current !== columns) {
      prevColumns.current = columns
      virtualizer.measure()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columns])

  // 앵커 아이템 고정으로 스크롤 복원(컬럼 수가 일치할 때만 의미 있음).
  useLayoutEffect(() => {
    if (!saved || saved.columns !== columns) return
    let raf = 0
    let tries = 0
    const pin = () => {
      // 전체 measurementsCache를 복원하므로 총 높이가 그대로다 → 저장한 원시
      // 스크롤 오프셋으로 바로 이동하면 같은 픽셀에 정확히 도달한다. 레인 패킹의
      // 좌표계 차이(measurementsCache.start ≠ 렌더 위치)에 의존하지 않는다.
      virtualizer.scrollToOffset(saved.delta)
      if (++tries < 12) raf = requestAnimationFrame(pin)
    }
    pin()
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const snapshot = useRef<() => void>(() => {})
  snapshot.current = () => {
    // delta에 원시 스크롤 오프셋을 저장한다(측정 캐시를 그대로 복원하므로
    // 픽셀 오프셋이 안정적이다). index는 미사용.
    saveFeedScroll(FEED_KEY, {
      posts,
      cursor,
      index: 0,
      delta: virtualizer.scrollOffset ?? 0,
      measurements: virtualizer.measurementsCache,
      columns,
    })
  }
  useEffect(() => {
    return () => snapshot.current()
  }, [])

  const items = virtualizer.getVirtualItems()
  const lastItem = items[items.length - 1]
  useEffect(() => {
    if (lastItem && lastItem.index >= posts.length - 1) loadMore()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastItem?.index, posts.length])

  const laneWidth = 100 / columns

  return (
    <div ref={parentRef} className="masonry-scroller">
      <header className="feed-header">
        <Link to="/" className="back-btn">
          ← Home
        </Link>
        <h1>Masonry</h1>
        <span className="feed-count">
          {posts.length.toLocaleString()} loaded · {columns} cols
        </span>
      </header>
      <div className="masonry-inner" style={{ minHeight: virtualizer.getTotalSize() }}>
        {items.map((item) => {
          const post = posts[item.index]
          return (
            <div
              key={item.key}
              data-index={item.index}
              ref={virtualizer.measureElement}
              className="masonry-row"
              style={{
                width: `${laneWidth}%`,
                transform: `translateX(${item.lane * 100}%) translateY(${item.start}px)`,
              }}
            >
              <MasonryCard post={post} onOpen={() => navigate(`/post/${post.id}`)} />
            </div>
          )
        })}
      </div>
      {cursor !== null && <div className="feed-loading">Loading more…</div>}
    </div>
  )
}
