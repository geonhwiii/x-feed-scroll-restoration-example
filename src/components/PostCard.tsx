import type { Post } from '../data/feed'

function fmt(n: number): string {
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K'
  return String(n)
}

export function PostCard({ post, onOpen }: { post: Post; onOpen?: () => void }) {
  return (
    <article className="post" onClick={onOpen}>
      <div
        className="post-avatar"
        style={{ background: `hsl(${post.avatarHue} 60% 55%)` }}
        aria-hidden
      />
      <div className="post-body">
        <div className="post-head">
          <span className="post-author">{post.author}</span>
          <span className="post-handle">{post.handle}</span>
        </div>
        <p className="post-text">{post.text}</p>
        {post.image && (
          <div
            className="post-image"
            style={{
              aspectRatio: String(post.image.aspect),
              background: `linear-gradient(135deg, hsl(${post.image.hue} 65% 55%), hsl(${(post.image.hue + 60) % 360} 65% 45%))`,
            }}
          />
        )}
        <div className="post-actions">
          <span>💬 {fmt(post.replies)}</span>
          <span>🔁 {fmt(post.reposts)}</span>
          <span>❤️ {fmt(post.likes)}</span>
        </div>
      </div>
    </article>
  )
}
