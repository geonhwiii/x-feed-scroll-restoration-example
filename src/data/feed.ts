// Deterministic mock feed: generated once at module load so the post order and
// content stay identical across navigations — a prerequisite for scroll restoration.

export interface Post {
  id: number
  author: string
  handle: string
  avatarHue: number
  text: string
  image: { hue: number; aspect: number } | null
  replies: number
  reposts: number
  likes: number
}

// Tiny seeded PRNG (mulberry32) — same seed => same feed every reload.
function mulberry32(seed: number) {
  return function () {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const NAMES = [
  'Ada Lovelace', 'Alan Turing', 'Grace Hopper', 'Linus Torvalds',
  'Margaret Hamilton', 'Dennis Ritchie', 'Barbara Liskov', 'Ken Thompson',
  'Katherine Johnson', 'Donald Knuth',
]

const SENTENCES = [
  'Just shipped a new virtualized feed and the scroll restoration finally feels right.',
  'Hot take: most "infinite scroll" bugs are actually layout measurement bugs.',
  'Reminder that translateY beats top/margin for moving thousands of nodes.',
  'Spent the afternoon profiling re-renders. The React Compiler is doing real work here.',
  'A good estimateSize is worth a thousand reflows.',
  'If your back button loses scroll position, your users notice every single time.',
  'Caching measured heights is the whole trick. Everything else is plumbing.',
  'TIL window scroll vs container scroll changes how you restore position entirely.',
  'Ten thousand items, sixty frames per second. No magic, just windowing.',
  'The detail page should never reset the timeline behind it.',
]

function buildPosts(count: number): Post[] {
  const rand = mulberry32(20260625)
  const posts: Post[] = []
  for (let i = 0; i < count; i++) {
    const nameIdx = Math.floor(rand() * NAMES.length)
    const author = NAMES[nameIdx]
    // Variable-length text => variable heights (exercises dynamic measurement).
    const lines = 1 + Math.floor(rand() * 4)
    const text = Array.from({ length: lines }, () => SENTENCES[Math.floor(rand() * SENTENCES.length)]).join(' ')
    const hasImage = rand() < 0.35
    posts.push({
      id: i,
      author,
      handle: '@' + author.toLowerCase().replace(/[^a-z]/g, '') + (nameIdx + 1),
      avatarHue: Math.floor(rand() * 360),
      text: `#${i} · ${text}`,
      image: hasImage ? { hue: Math.floor(rand() * 360), aspect: 0.5 + rand() * 1.2 } : null,
      replies: Math.floor(rand() * 500),
      reposts: Math.floor(rand() * 2000),
      likes: Math.floor(rand() * 9000),
    })
  }
  return posts
}

// The full backing "server" dataset. The client never sees this directly —
// it pages through it via fetchPage, exactly like X hitting a timeline API.
const ALL_POSTS: Post[] = buildPosts(10000)

export const PAGE_SIZE = 30

export interface Page {
  posts: Post[]
  nextCursor: number | null // index to fetch from next, or null when exhausted
}

// Fetch a single post by id (for the detail page).
export function getPost(id: number): Post | undefined {
  return ALL_POSTS[id]
}

// Simulated network fetch: returns one page after a short delay.
export function fetchPage(cursor: number): Promise<Page> {
  return new Promise((resolve) => {
    setTimeout(() => {
      const posts = ALL_POSTS.slice(cursor, cursor + PAGE_SIZE)
      const next = cursor + PAGE_SIZE
      resolve({ posts, nextCursor: next < ALL_POSTS.length ? next : null })
    }, 350)
  })
}
