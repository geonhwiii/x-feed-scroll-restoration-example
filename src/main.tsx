import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import './index.css'
import App from './App.tsx'

// staleTime: Infinity → 상세에서 돌아와 피드가 재마운트돼도 캐시된 페이지를
// 그대로 동기 반환하고 재페칭하지 않는다(스크롤 복원이 깜빡임 없이 성립).
// gcTime을 넉넉히 둬 잠깐 떠나도 캐시가 살아 있게 한다.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: Infinity, gcTime: 1000 * 60 * 30 },
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
)
