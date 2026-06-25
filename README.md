# X/Bluesky 스타일 피드: 가상화 + 스크롤 복원 구현 분석

> 트윗 1만 개를 스크롤해도 60fps를 유지하고(virtualization), 상세 페이지에 들어갔다 **뒤로** 돌아와도 보던 위치가 그대로 복원되는 피드를 직접 구현한 예제입니다. x.com / bsky.app의 실제 동작을 분석해 동일한 기법을 재현했습니다.

- **Stack**: React 19 + Vite + TypeScript, `react-router-dom`, `@tanstack/react-virtual`

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
├── lib/scrollCache.ts    # 라우트별 스크롤 상태 캐시 (복원의 핵심 저장소)
├── components/
│   ├── Feed.tsx          # 가상화 + 무한스크롤 + 복원 (핵심)
│   ├── PostCard.tsx      # 트윗 카드 (가변 높이)
│   └── PostDetailPage.tsx# 상세 페이지
└── App.tsx               # 라우팅 (/ , /post/:id)
```

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
      if (!post) return null
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

저장하는 상태:

```ts
// lib/scrollCache.ts
interface FeedScrollState {
  posts: Post[]            // 이미 로드된 타임라인 전체 (그대로 복원해야 동일)
  cursor: number | null    // 다음에 어디서부터 페칭할지
  index: number            // 맨 위에 보이던 아이템의 인덱스 (앵커)
  delta: number            // 그 아이템 안으로 스크롤된 양
  measurements: VirtualItem[] // 측정된 높이/위치 — 전체 높이를 즉시 재구성
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
    posts,
    cursor,
    index: anchor?.index ?? 0,
    delta: anchor ? offset - anchor.start : 0,  // 아이템 안으로 들어간 양
    measurements: virtualizer.measurementsCache,
  })
}
useEffect(() => () => snapshot.current(), [])
```

**복원 (피드로 돌아왔을 때):**

먼저 렌더 시점에 캐시를 읽어 **데이터와 측정 캐시부터** 되살립니다. 이게 있어야 첫 페인트에서 전체 높이가 즉시 맞아 스크롤바가 점프하지 않습니다.

```tsx
// Feed.tsx
const saved = loadFeedScroll(FEED_KEY)
const [posts, setPosts]   = useState<Post[]>(() => saved?.posts ?? [])
const [cursor, setCursor] = useState<number | null>(() => saved?.cursor ?? 0)
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

이 예제도 동일하게 mock API로 배치 페칭합니다:

```ts
// data/feed.ts — 실제 API를 흉내 낸 페이지 단위 fetch
export const PAGE_SIZE = 30

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

무한스크롤은 "마지막 아이템이 보이면 다음 페이지를 당겨오는" 방식입니다:

```tsx
// Feed.tsx
const items = virtualizer.getVirtualItems()
const lastItem = items[items.length - 1]
useEffect(() => {
  if (lastItem && lastItem.index >= posts.length - 1) loadMore()
}, [lastItem?.index, posts.length])
```

### 이게 복원과 직결된다
높이가 "실측 누적"이라는 건, 뒤로 돌아왔을 때 그 높이를 **그대로 재구성**해야 한다는 뜻입니다. 그래서 복원 캐시에 `posts`(로드된 목록)와 `measurements`(실측 높이)를 함께 저장하는 것입니다. 이게 없으면 돌아왔을 때 피드가 다시 30개부터 시작해 전체 높이가 쪼그라들고, 앵커는 의미를 잃습니다. §5의 `posts` 복원이 바로 이 역할입니다.

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

## 8. 요약: 동작을 가르는 4가지 결정

1. **`transform: translateY`로 absolute 배치** — reflow 없이 수천 노드를 옮긴다.
2. **`measureElement`로 가변 높이 실측·캐시** — 트윗마다 높이가 다른 현실에 대응.
3. **앵커(인덱스+delta) 기반 복원** — 픽셀이 아니라 아이템을 고정해 재측정 드리프트를 없앤다.
4. **배치 페칭 + `min-height` 점진 확장, 그리고 그 상태(posts·measurements)를 캐시** — 미리 다 받지 않는 실제 피드를 그대로 재현하고, 돌아왔을 때 높이를 재구성한다.

## 실행

```bash
bun install
bun dev   # http://localhost:5173
```

`/` 피드에서 한참 스크롤 → 아무 글 클릭 → 뒤로 가기. 위치가 그대로 복원되는지 확인하세요.
