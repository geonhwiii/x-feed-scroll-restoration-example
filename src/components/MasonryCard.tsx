import type { Post } from '../data/feed'

function fmt(n: number): string {
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K'
  return String(n)
}

// Pinterest-style card: image on top (variable aspect ratio → variable height,
// which is what makes the masonry effect), text + meta below.
export function MasonryCard({ post, onOpen }: { post: Post; onOpen?: () => void }) {
  return (
    <article className="mcard" onClick={onOpen}>
      {post.image && (
        <div
          className="mcard-image"
          style={{
            aspectRatio: String(post.image.aspect),
            background: `linear-gradient(135deg, hsl(${post.image.hue} 65% 55%), hsl(${(post.image.hue + 60) % 360} 65% 45%))`,
          }}
        />
      )}
      <div className="mcard-body">
        <div className="mcard-head">
          <div
            className="mcard-avatar"
            style={{ background: `hsl(${post.avatarHue} 60% 55%)` }}
            aria-hidden
          />
          <span className="mcard-author">{post.author}</span>
          <span className="mcard-handle">{post.handle}</span>
        </div>
        <p className="mcard-text">{post.text}</p>
        <div className="mcard-actions">
          <span>💬 {fmt(post.replies)}</span>
          <span>🔁 {fmt(post.reposts)}</span>
          <span>❤️ {fmt(post.likes)}</span>
        </div>
      </div>
    </article>
  )
}
