# X/Bluesky 스타일 피드: 가상화 + 스크롤 복원 구현 분석

> 트윗 1만 개를 스크롤해도 60fps를 유지하고(virtualization), 상세 페이지에 들어갔다 **뒤로** 돌아와도 보던 위치가 그대로 복원되는 피드를 직접 구현한 예제입니다. x.com / bsky.app의 실제 동작을 분석해 동일한 기법을 재현했습니다.

- **Stack**: React 19 + Vite + TypeScript, `react-router-dom`, `@tanstack/react-query`, `@tanstack/react-virtual`
- **두 가지 레이아웃**: 단일 열 피드(`/`)는 `@tanstack/react-virtual`로, 반응형 메이슨리(`/masonry`)는 직접 구현한 결정론적 가상화로 만들었습니다.

---

## 1. 문제 정의: 두 가지를 동시에 만족해야 한다

1. **성능 (Virtualization)** — 1만 개의 포스트를 전부 DOM에 그리면 노드가 수십만 개가 되어 죽습니다. 화면에 보이는 것만 그려야 합니다.
2. **스크롤 복원 (Scroll Restoration)** — 피드를 한참 내리다 글 하나를 눌러 상세로 가고, 뒤로 가기를 눌렀을 때 **보던 그 위치, 그 글**이 그대로 나와야 합니다.

이 둘은 서로 충돌합니다. 가상화는 "지금 안 보이는 건 DOM에서 지운다"는 전제인데, 그러면 스크롤 위치를 결정하는 **전체 높이**라는 정보 자체가 사라지기 때문입니다. 핵심은 이 충돌을 어떻게 푸느냐입니다.

---

## 2. 실제 서비스는 어떻게 하고 있나 (분석)

헤드리스 브라우저로 직접 DOM을 들여다봤습니다.

### Bluesky (`bsky.app`)
- `react-native-web`의 `FlatList`를 사용하고, **스크롤 컨테이너는 `window`(body)** 입니다.
- 윈도잉을 하지만 렌더 윈도우가 넉넉합니다 (스크롤 시 렌더 항목이 55 → 85개로 늘고, 위쪽도 잘 안 버립니다).

### X (`x.com`)
- **단일 스크롤 영역** 안에서 각 트윗(`cellInnerDiv`)을 `transform: translateY(...)`로 **absolute 배치**합니다.
- 컨테이너는 이런 식입니다:

```css
/* x.com 타임라인 컨테이너 (실측) */
position: relative;
min-height: 31766px;   /* 스크롤하며 새 배치가 로드될 때마다 계속 커진다 */
```

여기서 **결정적인 관찰**: x.com의 높이는 `min-height`이고 **계속 증가**합니다. 트윗을 미리 1만 개 받아두지 않고 **배치(페이지) 단위로 페칭**하기 때문에, "지금까지 로드해서 실제로 높이를 잰 만큼"만 높이로 잡는 것입니다.

> 이 한 가지가 순진한 구현과 실제 서비스를 가르는 지점입니다. 자세한 비교는 §6.

---

## 3. 전체 구조

```
src/
├── data/feed.ts          # 결정론적 mock 데이터 + 페이지 단위 fetch API
├── hooks/useFeedQuery.ts # react-query useInfiniteQuery 래퍼 (페이지·커서 캐시)
├── lib/scrollCache.ts    # 라우트별 "스크롤 위치" 캐시 (복원용)
├── components/
│   ├── Feed.tsx          # 단일 열: react-virtual 가상화 + 복원 (§4·5)
│   ├── PostCard.tsx      # 트윗 카드 (가변 높이)
│   ├── MasonryFeed.tsx   # 메이슨리: 직접 구현한 결정론적 가상화 + 복원 (§8)
│   ├── MasonryCard.tsx   # 핀터레스트식 카드 (이미지 상단)
│   └── PostDetailPage.tsx# 상세 페이지
├── main.tsx              # QueryClientProvider + BrowserRouter
└── App.tsx               # 라우팅 (/ , /post/:id , /masonry)
```

데이터 페칭과 스크롤 위치 복원의 **책임을 분리**한 것이 이 예제의 뼈대입니다.

| 무엇 | 어디에 저장 | 왜 |
|---|---|---|
| 로드된 페이지 + 다음 커서 | **react-query 캐시** (`useInfiniteQuery`) | 상세를 다녀와도 캐시가 살아 있어 타임라인이 그대로 |
| 측정된 높이 + 앵커 위치 | **scrollCache** (모듈 `Map`) | 라이브러리가 모르는 "보던 스크롤 위치" |

---

## 4. 가상화: `translateY`로 보이는 것만 그리기

`@tanstack/react-virtual`의 `useVirtualizer`를 씁니다. x.com과 동일하게 **전용 스크롤 컨테이너 + absolute 셀 + translateY** 구조입니다.

```tsx
// Feed.tsx
const virtualizer = useVirtualizer({
  count: posts.length,
  getScrollElement: () => parentRef.current,
  estimateSize: () => 140,        // 아직 안 잰 항목의 추정 높이
  overscan: 6,                    // 화면 밖 위아래로 6개씩 더 그려 스크롤을 매끄럽게
  initialMeasurementsCache: saved?.measurements, // (복원용 — §5)
})
```

렌더링은 이렇게 합니다. 바깥 div에 전체 높이(`min-height`)를 주고, 각 행은 **absolute + `translateY`** 로 자기 자리에 띄웁니다.

```tsx
// Feed.tsx
<div ref={parentRef} className="feed-scroller">
  <div className="feed-inner" style={{ minHeight: virtualizer.getTotalSize() }}>
    {virtualizer.getVirtualItems().map((item) => {
      const post = posts[item.index]
      return (
        <div
          key={item.key}
          data-index={item.index}
          ref={virtualizer.measureElement}   // ← 실제 높이를 측정해 캐시
          className="feed-row"
          style={{ transform: `translateY(${item.start}px)` }}
        >
          <PostCard post={post} onOpen={() => navigate(`/post/${post.id}`)} />
        </div>
      )
    })}
  </div>
</div>
```

```css
/* App.css */
.feed-scroller { height: 100vh; overflow-y: auto; }  /* 단일 스크롤 영역 */
.feed-inner    { position: relative; width: 100%; }   /* 높이를 잡아주는 spacer */
.feed-row      { position: absolute; top: 0; left: 0; width: 100%; }
```

### 왜 `top`/`margin`이 아니라 `transform: translateY`인가
`translateY`는 레이아웃(reflow)을 일으키지 않고 컴포지터 단계에서 처리됩니다. 수천 개 노드의 위치를 매 스크롤 프레임마다 바꿔야 하므로, `top`을 건드려 reflow를 유발하면 프레임이 무너집니다. x.com이 `translateY`를 쓰는 이유가 이것입니다.

### 가변 높이 문제와 `measureElement`
트윗은 텍스트 길이도 이미지 유무도 제각각이라 **높이가 고정이 아닙니다**. 그래서 처음에는 `estimateSize`(140px)로 자리를 잡고, 실제로 렌더된 행을 `ref={virtualizer.measureElement}`가 `ResizeObserver`로 **실측**해 캐시에 기록합니다. 이 "측정된 높이 캐시"가 다음 절에서 복원의 핵심 재료가 됩니다.

---

## 5. 스크롤 복원: "픽셀"이 아니라 "앵커 아이템"을 기억한다

가장 까다로운 부분입니다. 처음엔 단순히 `scrollTop`(픽셀 오프셋)을 저장·복원했는데, **34번 글에서 들어갔다 나오면 42번이 보이는** 식의 오차가 생겼습니다.

### 왜 픽셀 복원은 실패하는가
복원 직후 화면에 보이는 행들이 `measureElement`로 **다시 측정**되는데, 추정값(140px)과 실측값이 다르면 그 행들의 높이가 바뀝니다. 그러면 그 위/아래 콘텐츠가 밀리면서, 같은 `scrollTop`이어도 화면에 보이는 글이 달라집니다. 픽셀 좌표는 "그 사이 콘텐츠 높이가 안 변한다"를 가정하는데 가상화에서는 그 가정이 깨집니다.

### 해결: 앵커(anchor) 기반 복원
실제 서비스가 쓰는 방식입니다. **픽셀이 아니라 "맨 위에 보이는 아이템의 인덱스 + 그 아이템 안으로 얼마나 들어갔는지(delta)"** 를 기억합니다. 복원할 때 그 아이템을 같은 위치에 다시 핀(pin) 합니다. 위쪽 아이템들의 높이가 재측정되어 바뀌어도, 앵커 아이템은 항상 같은 자리에 고정되므로 오차가 없습니다.

저장하는 상태 — **타임라인(posts·cursor)은 react-query가 갖고 있으므로** 여기엔 "스크롤 위치"만 담습니다:

```ts
// lib/scrollCache.ts
interface FeedScrollState {
  index: number               // 맨 위에 보이던 아이템의 인덱스 (앵커)
  delta: number               // 그 아이템 안으로 스크롤된 양
  measurements?: VirtualItem[] // 단일 열: react-virtual 측정 캐시 — 전체 높이를 즉시 재구성
  heights?: number[]          // 메이슨리: 인덱스별 측정 높이 (§8)
  columns?: number            // 메이슨리: 저장 시점 컬럼 수 (§8)
}

const cache = new Map<string, FeedScrollState>()
export const saveFeedScroll = (k: string, s: FeedScrollState) => cache.set(k, s)
export const loadFeedScroll = (k: string) => cache.get(k)
```

**저장 (상세 페이지로 떠날 때, 언마운트 시 1회):**

```tsx
// Feed.tsx — 매 스크롤 리렌더가 아니라 언마운트 때 딱 한 번 저장하기 위해 ref 사용
const snapshot = useRef<() => void>(() => {})
snapshot.current = () => {
  const offset = virtualizer.scrollOffset ?? 0
  const items = virtualizer.getVirtualItems()
  const anchor = items.find((it) => it.end > offset) ?? items[0] // 맨 위 보이는 아이템
  saveFeedScroll(FEED_KEY, {
    index: anchor?.index ?? 0,
    delta: anchor ? offset - anchor.start : 0,  // 아이템 안으로 들어간 양
    measurements: virtualizer.measurementsCache,
  })
}
useEffect(() => () => snapshot.current(), [])
```

**복원 (피드로 돌아왔을 때):**

`posts`는 react-query 캐시에서 **동기적으로** 돌아오고(§6), 측정 캐시는 렌더 시점에 읽어 되살립니다. 이게 있어야 첫 페인트에서 전체 높이가 즉시 맞아 스크롤바가 점프하지 않습니다.

```tsx
// Feed.tsx
const { posts } = useFeedQuery()              // 캐시된 페이지가 그대로 복원됨 (§6)
const saved = loadFeedScroll(FEED_KEY)
// useVirtualizer({ ..., initialMeasurementsCache: saved?.measurements })
```

그 다음 앵커 아이템을 같은 자리에 핀합니다. 한 번만 호출하면 재측정 도중 어긋날 수 있어, **몇 프레임에 걸쳐 다시 고정**합니다:

```tsx
// Feed.tsx
useLayoutEffect(() => {
  if (!saved) return
  let raf = 0, tries = 0
  const pin = () => {
    const m = virtualizer.measurementsCache[saved.index]
    if (m) virtualizer.scrollToOffset(m.start + saved.delta) // 앵커.시작 + 들어간 양
    if (++tries < 6) raf = requestAnimationFrame(pin)         // 재측정이 안정될 때까지 재핀
  }
  pin()
  return () => cancelAnimationFrame(raf)
}, [])
```

> **검증 결과**: 깊이 스크롤 → 138번 글 진입 → 뒤로. 진입 전후 `topIdx: 138`, `topY: 731px`, 로드 수 `150`이 **완전히 동일**하게 복원됩니다.

---

## 6. 핵심 통찰: 높이는 "추정 선예약"이 아니라 "실측 점진 확장"

순진하게 구현하면 데이터 1만 개를 미리 만들어 두고 `estimateSize`로 곱해 전체 높이를 한 번에 예약합니다:

```
height = 10000 × 140px ≈ 1,400,000px   // 시작부터 고정 (추정값)
```

하지만 x.com은 다릅니다:

```
min-height = 6,435px → 49,190px → ...   // 로드한 만큼만, 실측값으로 점진 증가
```

차이의 원인은 두 가지입니다.

| | 순진한 구현 | x.com (이 예제) |
|---|---|---|
| **데이터** | 1만 개를 한 번에 보유 | API로 30개씩 배치 페칭 |
| **높이 계산** | 추정값으로 전체 선예약 | 로드+실측한 만큼만 누적 |
| **결과** | `height` 고정 | `min-height` 점진 증가 |

x.com이 후자인 이유는 **트윗을 미리 다 받아둘 수 없기 때문**입니다. 없는 데이터의 높이는 추정조차 할 수 없습니다.

이 예제도 동일하게 mock API로 배치 페칭하고, 그 페칭을 **`react-query`의 `useInfiniteQuery`로 일원화**합니다(실서비스의 일반적인 패턴):

```ts
// data/feed.ts — 실제 API를 흉내 낸 페이지 단위 fetch (cursor / nextCursor)
export function fetchPage(cursor: number): Promise<Page> {
  return new Promise((resolve) => {
    setTimeout(() => {  // 네트워크 지연 시뮬레이션
      const posts = ALL_POSTS.slice(cursor, cursor + PAGE_SIZE)
      const next = cursor + PAGE_SIZE
      resolve({ posts, nextCursor: next < ALL_POSTS.length ? next : null })
    }, 350)
  })
}
```

```ts
// hooks/useFeedQuery.ts — 홈/메이슨리가 같은 queryKey를 공유해 캐시도 공유
export function useFeedQuery() {
  const query = useInfiniteQuery({
    queryKey: ['feed'],
    queryFn: ({ pageParam }) => fetchPage(pageParam),
    initialPageParam: 0,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  })
  const posts = query.data?.pages.flatMap((p) => p.posts) ?? []
  return { posts, fetchNextPage: query.fetchNextPage, hasNextPage: query.hasNextPage, isFetchingNextPage: query.isFetchingNextPage }
}
```

무한스크롤은 "마지막 아이템이 보이면 다음 페이지를 당겨오는" 방식입니다:

```tsx
// Feed.tsx
const { posts, fetchNextPage, hasNextPage, isFetchingNextPage } = useFeedQuery()
const lastItem = virtualizer.getVirtualItems().at(-1)
useEffect(() => {
  if (lastItem && lastItem.index >= posts.length - 1 && hasNextPage && !isFetchingNextPage) {
    fetchNextPage()
  }
}, [lastItem?.index, posts.length, hasNextPage, isFetchingNextPage])
```

### 이게 복원과 직결된다
높이가 "실측 누적"이라는 건, 뒤로 돌아왔을 때 그 높이를 **그대로 재구성**해야 한다는 뜻입니다. 그러려면 ① 로드했던 **페이지 전체**와 ② **실측 높이**가 둘 다 돌아와야 합니다.

①은 react-query가 맡습니다. `QueryClient`를 앱 루트에 두고 `staleTime: Infinity`로 설정하면, 상세에서 돌아와 피드가 재마운트돼도 **캐시된 페이지가 동기적으로 그대로 반환**되고 재페칭하지 않습니다. 덕분에 `posts`를 직접 캐싱할 필요가 없어지고, scrollCache는 ②(측정 높이·앵커 위치)만 책임집니다.

```tsx
// main.tsx
const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: Infinity, gcTime: 1000 * 60 * 30 } },
})
```

---

## 7. 결정론적 mock 데이터

복원이 성립하려면 **같은 데이터가 같은 순서로** 나와야 합니다. 그래서 시드 기반 PRNG(`mulberry32`)로 데이터를 생성해, 새로고침/재마운트에도 항상 동일한 피드를 보장합니다. 가변 높이를 만들기 위해 텍스트 줄 수와 이미지 유무·비율을 의도적으로 흔들었습니다.

```ts
// data/feed.ts
function mulberry32(seed: number) { /* 시드 → 항상 같은 난수열 */ }

function buildPosts(count: number): Post[] {
  const rand = mulberry32(20260625)
  // 줄 수(1~4), 이미지 유무(35%)와 종횡비를 난수로 → 높이 편차 유도
}
const ALL_POSTS = buildPosts(10000)
```

---

## 8. 반응형 메이슨리: 결정론적 레이아웃으로 직접 가상화

피드를 1열이 아니라 **핀터레스트식 다열 메이슨리**로도 만들었습니다(`/masonry`). 목표는 동일합니다 — 1만 개에서도 60fps, 그리고 상세에 들어갔다 **뒤로** 와도 메이슨리 레이아웃과 스크롤 위치가 그대로 복원될 것.

### 8.1 메이슨리 구현 방식 비교

| 방식 | 장점 | 단점 |
|---|---|---|
| `column-count` (CSS columns) | 한 줄, 반응형 자동 | 읽는 순서가 **세로**(1→2→3이 한 열에 쌓임) + **가상화 불가** |
| CSS Grid `masonry` | 네이티브 | 아직 실험적·지원 부족 + **가상화 불가** |
| **직접 컬럼 분배 + 가상화** | 순서 보존, 1만 개 OK, 복원 안정 | 각 아이템의 (x, y) 위치를 직접 계산 |

핵심 기준은 **"가상화가 되는가"** 입니다. CSS columns / grid masonry는 DOM을 전부 그려야 하므로 1만 개와 양립할 수 없습니다. 그래서 직접 컬럼을 나누고 직접 가상화합니다.

### 8.2 왜 `react-virtual`의 `lanes`를 쓰지 않았나 (이 예제의 핵심 교훈)

`react-virtual`에는 메이슨리용 `lanes` 옵션이 있습니다. 처음엔 이걸 썼는데, **복원할 때 컬럼이 통째로 어긋나는** 버그가 있었습니다. 원인은 `lanes`의 배치 규칙입니다:

> `lanes`는 각 아이템을 **현재 가장 짧은 열**에 넣습니다(높이 균형).

이 규칙은 **측정된 높이에 의존**합니다. 복원 순간 화면 밖 일부 카드가 아직 추정 높이(280)인 상태라면, 그 미세한 차이가 누적돼 **이후 카드들의 열 배정이 통째로 뒤집힙니다.** 실제로 같은 카드(크기 동일)가 저장 땐 lane 0(start 4917) → 복원 땐 lane 1(start 4406)로 이동하는 걸 관찰했습니다. 한 아이템을 고정해도 옆 컬럼이 어긋나니 복원이 깨집니다.

**해결의 열쇠는 "열 배정을 측정값과 무관하게 고정"하는 것**입니다. 그래서 가장 짧은 열(greedy)이 아니라 **인덱스 기준 라운드로빈**으로 바꿨습니다:

```
컬럼 = index % columns      // 측정 높이와 무관, 항상 동일
```

이러면 카드 하나가 재측정돼도 **같은 열의 아래 카드들만** 밀립니다(단일 열 피드 §5와 똑같은 안정성). 열 균형은 약간 포기하지만, 복원 정확성을 위한 올바른 트레이드오프입니다. 단, `lanes`가 해주던 측정·가상화·위치 계산을 직접 해야 하므로 작은 가상화 엔진을 만듭니다.

### 8.3 결정론적 레이아웃 계산

측정 높이(`heightsRef`)로부터 모든 아이템의 (lane, y)를 계산합니다. 열 배정이 고정이라 이 결과는 **같은 높이 입력 → 항상 같은 출력**입니다.

```tsx
// MasonryFeed.tsx
const layout = useMemo(() => {
  const laneH = new Array(columns).fill(0)        // 열별 현재 높이
  const pos = posts.map((_, i) => {
    const lane = i % columns                       // ← 고정 배정
    const y = laneH[lane]
    const h = heightsRef.current[i] ?? ESTIMATE    // 측정값 없으면 추정(280)
    laneH[lane] = y + h
    return { index: i, lane, y, h }
  })
  return { pos, total: Math.max(...laneH) }         // total = 가장 긴 열 (min-height)
}, [posts, columns, tick])                          // tick: 측정되면 재계산
```

렌더는 보이는 범위만 — 가로는 `translateX(lane × 100%)`, 세로는 계산한 `y`:

```tsx
const visible = layout.pos.filter(
  (p) => p.y + p.h > scrollTop - OVERSCAN && p.y < scrollTop + viewport + OVERSCAN,
)

<div className="masonry-inner" style={{ minHeight: layout.total }}>
  {visible.map((p) => (
    <div
      key={p.index}
      data-index={p.index}
      ref={measureRow}                              // ResizeObserver로 실측 (§8.4)
      className="masonry-row"
      style={{
        width: `${100 / columns}%`,
        transform: `translateX(${p.lane * 100}%) translateY(${p.y}px)`,
      }}
    >
      <MasonryCard post={posts[p.index]} onOpen={() => navigate(`/post/${posts[p.index].id}`)} />
    </div>
  ))}
</div>
```

### 8.4 측정과 스크롤 추적

높이는 `ResizeObserver`로 실측해 캐시하고, 한 프레임에 한 번만 리렌더(`tick`)해 폭주를 막습니다. 행이 재활용되면 React 19의 ref 클린업으로 관찰을 해제합니다.

```tsx
const measureRow = useCallback((el: HTMLElement | null) => {
  if (!el) return
  const ro = observerRef.current!
  ro.observe(el)
  return () => ro.unobserve(el)                     // React 19: ref 클린업
}, [])
```

스크롤은 컨테이너 `scroll` 이벤트를 rAF로 스로틀해 `scrollTop` state로 반영하고, 컬럼 수·뷰포트 높이는 `ResizeObserver`로 추적합니다(`columnsFor(width)`로 1~5열).

### 8.5 스크롤 복원

레이아웃이 결정론적이라 복원이 단순해집니다. 저장된 **높이를 시드**하면 앵커 글의 `y`가 첫 페인트부터 정확히 재현되고, 그 글을 뷰포트의 저장된 위치(`delta`)에 다시 맞추면 끝입니다.

```ts
// scrollCache에 저장 (메이슨리)
{
  index,                       // 뷰포트 최상단에 가장 가까웠던 글
  delta,                       // 그 글의 뷰포트 상대 top
  heights: heightsRef.current, // 인덱스별 측정 높이 (레이아웃 재현용)
  columns,                     // 컬럼 수가 같을 때만 복원 적용
}
```

```tsx
// 복원: 높이는 렌더 전에 시드, 앵커는 몇 프레임에 걸쳐 재핀
if (saved?.heights && saved.columns === columns) heightsRef.current = saved.heights.slice()

useLayoutEffect(() => {
  if (!saved || saved.columns !== columns) return
  let raf = 0, tries = 0, stable = 0
  const pin = () => {
    const p = layoutRef.current.pos[saved.index]
    if (p) {
      const target = p.y - saved.delta             // 앵커를 저장된 화면 위치로
      if (Math.abs(sc.scrollTop - target) < 0.5) stable++
      else { sc.scrollTop = target; stable = 0 }
    }
    if (stable < 3 && ++tries < 60) raf = requestAnimationFrame(pin)
  }
  pin()
  return () => cancelAnimationFrame(raf)
}, [])
```

> 측정 높이는 **컬럼 폭에 의존**하므로, 저장 시점과 컬럼 수가 같을 때만 복원합니다. 창 크기가 바뀌어 컬럼 수가 달라지면 높이를 버리고 다시 측정합니다.

> **검증 결과**: 깊이 스크롤(idx 59) → 진입 → 뒤로, 다른 위치(idx 19)에서 한 번 더 — **두 번 모두** 최상단 글과 픽셀 위치가 진입 전과 완전히 동일하게 복원됩니다. (greedy `lanes`에선 첫 복원이 깨지고 두 번째만 맞았던 문제가 사라짐)

### 8.6 단일 열(§5) vs 메이슨리(§8) 복원 — 한눈에

| | 단일 열 피드 (§5) | 메이슨리 (§8) |
|---|---|---|
| 가상화 | `@tanstack/react-virtual` | 직접 구현 (라운드로빈) |
| 열 배정 | 1열 | `index % columns` (고정) |
| 측정 캐시 | `measurements` (VirtualItem[]) | `heights` (number[]) |
| 복원 단위 | 앵커 아이템 (index + delta) | 앵커 아이템 (index + delta) |
| 공통 토대 | 측정 높이를 복원해 **레이아웃을 그대로 재현** → 앵커 고정 | (동일) |

즉 두 레이아웃 모두 **"측정 높이를 복원해 레이아웃을 결정론적으로 재현하고, 앵커 글을 같은 자리에 핀한다"**는 같은 원리를 따릅니다. 메이슨리에서 추가로 필요한 단 한 가지가 **열 배정의 결정성**이었습니다.

---

## 9. 요약: 동작을 가르는 5가지 결정

1. **`transform: translateY`로 absolute 배치** — reflow 없이 수천 노드를 옮긴다.
2. **가변 높이를 실측·캐시** — 트윗마다 높이가 다른 현실에 대응(`measureElement` / `ResizeObserver`).
3. **앵커(인덱스+delta) 기반 복원** — 픽셀이 아니라 아이템을 고정해 재측정 드리프트를 없앤다.
4. **책임 분리: react-query가 페이지·커서를, scrollCache가 스크롤 위치를** — `staleTime: Infinity`로 캐시된 타임라인이 동기 복원되고, `min-height`는 로드+실측한 만큼만 점진 확장된다.
5. **메이슨리는 결정론적 라운드로빈으로 직접 가상화** — 열 배정을 `index % columns`로 고정해, greedy `lanes`가 복원 때 컬럼을 뒤섞던 문제를 원천 차단한다(§8).

## 실행

```bash
bun install
bun dev   # http://localhost:5173
```

`/` 피드에서 한참 스크롤 → 아무 글 클릭 → 뒤로 가기. 위치가 그대로 복원되는지 확인하세요.
헤더의 **Masonry →** 로 이동하면 반응형 메이슨리(`/masonry`)에서도 동일하게 동작합니다(창 크기를 바꿔 컬럼 수 변화도 확인해 보세요).
