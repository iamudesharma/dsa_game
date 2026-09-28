import Link from 'next/link'

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center px-4 py-16">
      <p className="text-[0.7rem] font-semibold tracking-[0.16em] text-[var(--dsa-accent)] uppercase">
        Nothing here
      </p>
      <h1 className="mt-1.5 text-3xl font-bold tracking-tight text-[var(--dsa-ink)]">
        There is no page at this address.
      </h1>
      <p className="mt-2 text-[0.95rem] leading-relaxed text-[var(--dsa-muted)]">
        If you were following a link to a game you were playing, that game belongs to the tab you started it in.
        Head back to the topics and start a fresh board.
      </p>
      <Link className="btn btn-primary mt-5 self-start" href="/">
        Pick a topic
      </Link>
    </main>
  )
}
