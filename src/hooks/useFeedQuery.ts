import { useInfiniteQuery } from '@tanstack/react-query'
import { fetchPage, type Post } from '../data/feed'

// 피드 데이터 페칭을 react-query로 일원화한다. 홈/메이슨리가 같은 queryKey를
// 공유하므로 한쪽에서 로드한 페이지를 다른 쪽도 캐시로 재사용한다.
//
// 무한스크롤의 페이지 목록(pages)과 다음 커서(nextCursor)는 모두 QueryClient
// 캐시에 보관된다. 따라서 상세 페이지로 떠났다 돌아와도 이미 로드한 타임라인이
// 그대로 복원되어, 더 이상 posts/cursor를 직접 캐싱할 필요가 없다.
export function useFeedQuery() {
  const query = useInfiniteQuery({
    queryKey: ['feed'],
    queryFn: ({ pageParam }) => fetchPage(pageParam),
    initialPageParam: 0,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  })

  // 페이지들을 단일 Post 배열로 평탄화해 가상화에 그대로 넘긴다.
  const posts: Post[] = query.data?.pages.flatMap((p) => p.posts) ?? []

  return {
    posts,
    fetchNextPage: query.fetchNextPage,
    hasNextPage: query.hasNextPage,
    isFetchingNextPage: query.isFetchingNextPage,
  }
}
