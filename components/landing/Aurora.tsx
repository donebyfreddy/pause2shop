/**
 * Fondo atmosférico de la landing: tres manchas de color en movimiento lento +
 * retícula enmascarada. Es puramente decorativo (`aria-hidden`) y CSS-only —
 * sin canvas ni WebGL, para no gastar main thread en el primer render.
 */
export function Aurora({ intense = false }: { intense?: boolean }) {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="mask-fade absolute inset-0 grid-backdrop opacity-60" />

      <div
        className="animate-aurora absolute -top-40 left-1/2 size-[52rem] -translate-x-1/2 rounded-full blur-[130px]"
        style={{
          background:
            "radial-gradient(circle, color-mix(in oklab, var(--color-brand) 60%, transparent) 0%, transparent 68%)",
          opacity: intense ? 0.75 : 0.5,
        }}
      />
      <div
        className="animate-aurora absolute top-24 -left-32 size-[34rem] rounded-full blur-[120px]"
        style={{
          background:
            "radial-gradient(circle, color-mix(in oklab, var(--color-accent) 45%, transparent) 0%, transparent 70%)",
          animationDelay: "-6s",
          opacity: 0.4,
        }}
      />
      <div
        className="animate-aurora absolute -right-32 bottom-0 size-[38rem] rounded-full blur-[130px]"
        style={{
          background:
            "radial-gradient(circle, color-mix(in oklab, var(--color-magenta) 40%, transparent) 0%, transparent 70%)",
          animationDelay: "-12s",
          opacity: 0.35,
        }}
      />

      {/* Vignette inferior: cose el hero con la sección siguiente. */}
      <div className="absolute inset-x-0 bottom-0 h-40 bg-linear-to-b from-transparent to-canvas" />
    </div>
  );
}
