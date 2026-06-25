import { Route, Routes } from 'react-router-dom'
import { Feed } from './components/Feed'
import { PostDetailPage } from './components/PostDetailPage'
import './App.css'

function App() {
  return (
    <div className="app-shell">
      <Routes>
        <Route path="/" element={<Feed />} />
        <Route path="/post/:id" element={<PostDetailPage />} />
      </Routes>
    </div>
  )
}

export default App
