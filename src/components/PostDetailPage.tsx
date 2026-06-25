import { useNavigate, useParams } from 'react-router-dom'
import { getPost } from '../data/feed'
import { PostCard } from './PostCard'

export function PostDetailPage() {
  const navigate = useNavigate()
  const { id } = useParams()
  const post = getPost(Number(id))

  if (!post) {
    return (
      <div className="detail-scroller">
        <p style={{ padding: 24 }}>Post not found.</p>
      </div>
    )
  }

  return (
    <div className="detail-scroller">
      <header className="feed-header">
        <button type="button" className="back-btn" onClick={() => navigate(-1)}>
          ← Back
        </button>
        <h1>Post</h1>
      </header>
      <div className="detail-main">
        <PostCard post={post} />
      </div>
    </div>
  )
}
