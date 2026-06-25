import { Route, Routes } from 'react-router-dom'
import { Feed } from './components/Feed'
import { MasonryFeed } from './components/MasonryFeed'
import { PostDetailPage } from './components/PostDetailPage'
import './App.css'

// 600px 중앙 컬럼(홈/상세)과 전체 폭(메이슨리)을 라우트별로 분리한다.
function Column({ children }: { children: React.ReactNode }) {
  return <div className="app-shell">{children}</div>
}

function App() {
  return (
    <Routes>
      <Route path="/" element={<Column><Feed /></Column>} />
      <Route path="/post/:id" element={<Column><PostDetailPage /></Column>} />
      <Route path="/masonry" element={<MasonryFeed />} />
    </Routes>
  )
}

export default App
