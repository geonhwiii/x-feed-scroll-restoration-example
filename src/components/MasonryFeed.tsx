import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useFeedQuery } from '../hooks/useFeedQuery'
import { loadFeedScroll, saveFeedScroll } from '../lib/scrollCache'
import { MasonryCard } from './MasonryCard'

const FEED_KEY = 'masonry-feed'
const ESTIMATE = 280 // 아직 측정되지 않은 카드의 추정 높이
const OVERSCAN = 600 // 뷰포트 위아래로 더 그릴 픽셀

// 화면 너비 → 컬럼 수.
function columnsFor(width: number): number {
  if (width < 540) return 1
  if (width < 840) return 2
  if (width < 1140) return 3
  if (width < 1500) return 4
  return 5
}

interface ItemPos {
  index: number
  lane: number
  y: number
  h: number
}

export function MasonryFeed() {
  const navigate = useNavigate()
  const parentRef = useRef<HTMLDivElement>(null)

  const { posts, fetchNextPage, hasNextPage, isFetchingNextPage } = useFeedQuery()
  const saved = loadFeedScroll(FEED_KEY)

  const [columns, setColumns] = useState(
    () => saved?.columns ?? columnsFor(typeof window === 'undefined' ? 1200 : window.innerWidth),
  )
  const [scrollTop, setScrollTop] = useState(0)
  const [viewport, setViewport] = useState(0)
  const [tick, forceTick] = useState(0)

  // 측정된 높이(인덱스별). 복원 시 저장된 높이를 그대로 시드해 첫 페인트부터
  // 레이아웃이 정확하게 잡히도록 한다(컬럼 수가 일치할 때만).
  const heightsRef = useRef<number[]>([])
  const seeded = useRef(false)
  if (!seeded.current) {
    seeded.current = true
    if (saved?.heights && saved.columns === columns) heightsRef.current = saved.heights.slice()
  }

  // 측정 결과를 모아 한 프레임에 한 번만 리렌더한다(스크롤 중 폭주 방지).
  const tickScheduled = useRef(false)
  const scheduleTick = useCallback(() => {
    if (tickScheduled.current) return
    tickScheduled.current = true
    requestAnimationFrame(() => {
      tickScheduled.current = false
      forceTick((n) => n + 1)
    })
  }, [])

  // 컨테이너 크기 관찰: 컬럼 수와 뷰포트 높이.
  useEffect(() => {
    const el = parentRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      setColumns(columnsFor(el.clientWidth))
      setViewport(el.clientHeight)
    })
    ro.observe(el)
    setViewport(el.clientHeight)
    return () => ro.disconnect()
  }, [])

  // 컬럼 수가 바뀌면 폭이 달라져 높이가 무효 → 측정값을 버리고 다시 잰다.
  const prevColumns = useRef(columns)
  if (prevColumns.current !== columns) {
    prevColumns.current = columns
    heightsRef.current = []
  }

  // ---- 결정론적 라운드로빈 레이아웃 ----
  // 각 글의 컬럼은 index % columns로 고정 → 측정값이 흔들려도 컬럼이 재배치되지
  // 않는다. 한 카드가 재측정되면 "같은 컬럼의 아래 카드들"만 밀린다(단일 열과 동일).
  const layout = useMemo(() => {
    const laneH = new Array(columns).fill(0)
    const pos: ItemPos[] = posts.map((_, i) => {
      const lane = i % columns
      const y = laneH[lane]
      const h = heightsRef.current[i] ?? ESTIMATE
      laneH[lane] = y + h
      return { index: i, lane, y, h }
    })
    return { pos, total: laneH.length ? Math.max(...laneH) : 0 }
    // tick: 측정으로 heightsRef가 바뀌면 재계산
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [posts, columns, tick])
  const layoutRef = useRef(layout)
  layoutRef.current = layout

  // 보이는 항목만 렌더.
  const visible = layout.pos.filter(
    (p) => p.y + p.h > scrollTop - OVERSCAN && p.y < scrollTop + viewport + OVERSCAN,
  )

  // 측정: 렌더된 행을 ResizeObserver로 실측해 높이 캐시를 갱신.
  const observerRef = useRef<ResizeObserver | null>(null)
  if (!observerRef.current) {
    observerRef.current = new ResizeObserver((entries) => {
      let changed = false
      for (const e of entries) {
        const i = Number((e.target as HTMLElement).dataset.index)
        const h = (e.target as HTMLElement).offsetHeight
        if (h && heightsRef.current[i] !== h) {
          heightsRef.current[i] = h
          changed = true
        }
      }
      if (changed) scheduleTick()
    })
  }
  const measureRow = useCallback((el: HTMLElement | null) => {
    if (!el) return
    const ro = observerRef.current!
    ro.observe(el)
    return () => ro.unobserve(el) // React 19 ref cleanup: 행이 재활용되면 관찰 해제
  }, [])
  useEffect(() => () => observerRef.current?.disconnect(), [])

  // 스크롤 추적(rAF 스로틀) + 무한스크롤 트리거.
  useEffect(() => {
    const el = parentRef.current
    if (!el) return
    let raf = 0
    const onScroll = () => {
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        setScrollTop(el.scrollTop)
      })
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      el.removeEventListener('scroll', onScroll)
      cancelAnimationFrame(raf)
    }
  }, [])

  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage && layout.total - (scrollTop + viewport) < 800) {
      fetchNextPage()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollTop, viewport, layout.total, hasNextPage, isFetchingNextPage])

  // ---- 스크롤 복원 ----
  // 레이아웃이 결정론적이므로 저장된 앵커 글의 y를 그대로 재현할 수 있다. 앵커 글을
  // 뷰포트의 저장된 위치(delta)에 다시 맞춘다. 보이는 행이 재측정되며 y가 갱신되면
  // 몇 프레임에 걸쳐 재적용해 정확히 수렴시킨다.
  useLayoutEffect(() => {
    if (!saved || saved.columns !== columns) return
    const sc = parentRef.current
    if (!sc) return
    let raf = 0
    let tries = 0
    let stable = 0
    const pin = () => {
      const p = layoutRef.current.pos[saved.index]
      if (p) {
        const target = p.y - saved.delta
        if (Math.abs(sc.scrollTop - target) < 0.5) stable++
        else {
          sc.scrollTop = target
          stable = 0
        }
      }
      if (stable < 3 && ++tries < 60) raf = requestAnimationFrame(pin)
    }
    pin()
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 뷰포트 최상단에 가장 가까운 글을 앵커로 계속 추적해 ref에 담는다.
  const anchorRef = useRef<{ index: number; delta: number }>({ index: 0, delta: 0 })
  anchorRef.current = useMemo(() => {
    let best = anchorRef.current
    let bestDist = Infinity
    for (const p of visible) {
      const dist = Math.abs(p.y - scrollTop)
      if (dist < bestDist) {
        bestDist = dist
        best = { index: p.index, delta: p.y - scrollTop }
      }
    }
    return best
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollTop])

  const snapshot = useRef<() => void>(() => {})
  snapshot.current = () => {
    saveFeedScroll(FEED_KEY, {
      index: anchorRef.current.index,
      delta: anchorRef.current.delta, // 앵커의 뷰포트 상대 top
      heights: heightsRef.current.slice(),
      columns,
    })
  }
  useEffect(() => {
    return () => snapshot.current()
  }, [])

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
      <div className="masonry-inner" style={{ minHeight: layout.total }}>
        {visible.map((p) => {
          const post = posts[p.index]
          return (
            <div
              key={p.index}
              data-index={p.index}
              ref={measureRow}
              className="masonry-row"
              style={{
                width: `${laneWidth}%`,
                transform: `translateX(${p.lane * 100}%) translateY(${p.y}px)`,
              }}
            >
              <MasonryCard post={post} onOpen={() => navigate(`/post/${post.id}`)} />
            </div>
          )
        })}
      </div>
      {hasNextPage && <div className="feed-loading">Loading more…</div>}
    </div>
  )
}
