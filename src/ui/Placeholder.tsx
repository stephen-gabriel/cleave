export function Placeholder({ title, text }: { title: string; text: string }) {
  return (
    <section className="card" style={{ maxWidth: 640 }}>
      <h2>{title}</h2>
      <p className="muted" style={{ marginTop: 8 }}>
        {text}
      </p>
    </section>
  )
}