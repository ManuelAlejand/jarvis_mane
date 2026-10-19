/** Anillo "reactor": el arco exterior muestra el gasto de API frente al tope mensual. */
export function Reactor({ spent, budget, openTasks }: { spent: number; budget: number; openTasks: number }) {
  const pct = budget > 0 ? Math.min(1, spent / budget) : 0;
  const r = 92;
  const c = 2 * Math.PI * r;
  const color = pct >= 0.9 ? "var(--alert)" : pct >= 0.7 ? "var(--gold)" : "var(--arc)";
  const ticks = Array.from({ length: 48 }, (_, i) => i);

  return (
    <div className="reactor" role="img" aria-label={`Gasto de API ${spent.toFixed(2)} de ${budget.toFixed(2)} dólares. ${openTasks} tareas abiertas.`}>
      <svg viewBox="0 0 220 220" aria-hidden="true">
        <g className="reactor-spin">
          {ticks.map((i) => (
            <line
              key={i}
              x1="110" y1="4" x2="110" y2={i % 4 === 0 ? 13 : 9}
              stroke="var(--arc)" strokeOpacity={i % 4 === 0 ? 0.55 : 0.22} strokeWidth="1.5"
              transform={`rotate(${i * 7.5} 110 110)`}
            />
          ))}
        </g>
        <circle cx="110" cy="110" r={r} fill="none" stroke="var(--line)" strokeWidth="10" />
        <circle
          cx="110" cy="110" r={r} fill="none" stroke={color} strokeWidth="10"
          strokeDasharray={`${c * pct} ${c}`} strokeLinecap="butt"
          transform="rotate(-90 110 110)"
          style={{ filter: `drop-shadow(0 0 6px ${color})`, transition: "stroke-dasharray 600ms ease" }}
        />
        <circle cx="110" cy="110" r="70" fill="none" stroke="var(--arc)" strokeOpacity="0.18" strokeWidth="1" />
        <circle cx="110" cy="110" r="62" fill="rgba(127,227,255,0.04)" stroke="var(--arc)" strokeOpacity="0.35" strokeWidth="1" strokeDasharray="3 5" />
      </svg>
      <div className="reactor-core">
        <span className="num">{openTasks}</span>
        <span className="small muted">tareas abiertas</span>
        <span className="small num" style={{ marginTop: 10, color }}>
          ${spent.toFixed(2)} / ${budget.toFixed(0)}
        </span>
        <span className="small muted">API este mes</span>
      </div>
    </div>
  );
}
