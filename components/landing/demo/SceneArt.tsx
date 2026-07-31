/**
 * Ilustración del frame de demostración.
 *
 * Es SVG generado, no una foto. Motivo de producto, no de comodidad: la landing
 * no puede usar fotogramas de contenido ajeno ni fotos de producto de marcas
 * reales para decorar algo que se presenta como una detección. Con siluetas
 * abstractas, la demo enseña el MECANISMO (objeto → caja → catálogo) sin
 * afirmar nada falso sobre a quién pertenece lo que se ve.
 *
 * Sistema de coordenadas: `viewBox="0 0 178 100"` (16:9 exacto). Las cajas de
 * detección viven en porcentajes, así que la conversión es `x * 1.78` en el eje
 * horizontal e identidad en el vertical. Las siluetas están colocadas para caer
 * DENTRO de sus cajas: si se mueve una caja en `lib/landing/demoScene.ts`, hay
 * que mover la silueta aquí o la demo deja de tener sentido.
 */

const X = (pct: number) => +(pct * 1.78).toFixed(1);

function Atmosphere({
  id,
  palette,
}: {
  id: string;
  palette: { from: string; via: string; to: string };
}) {
  return (
    <>
      <defs>
        <linearGradient id={`${id}-bg`} x1="0" y1="0" x2="0.6" y2="1">
          <stop offset="0%" stopColor={palette.from} />
          <stop offset="55%" stopColor={palette.via} />
          <stop offset="100%" stopColor={palette.to} />
        </linearGradient>
        <radialGradient id={`${id}-keylight`} cx="0.3" cy="0.15" r="0.8">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.16" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${id}-silhouette`} x1="0" y1="0" x2="0.3" y2="1">
          <stop offset="0%" stopColor="#0c0d15" stopOpacity="0.97" />
          <stop offset="100%" stopColor="#05050a" stopOpacity="0.99" />
        </linearGradient>
        <linearGradient id={`${id}-rim`} x1="0" y1="0" x2="1" y2="0.4">
          <stop offset="0%" stopColor="#8b7fff" stopOpacity="0.55" />
          <stop offset="60%" stopColor="#22d3ee" stopOpacity="0.3" />
          <stop offset="100%" stopColor="#22d3ee" stopOpacity="0" />
        </linearGradient>
        <linearGradient id={`${id}-floor`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.05" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
      </defs>

      <rect width="178" height="100" fill={`url(#${id}-bg)`} />
      <rect width="178" height="100" fill={`url(#${id}-keylight)`} />

      {/* bokeh de fondo: da profundidad sin coste de render */}
      <g opacity="0.5">
        <circle cx="24" cy="22" r="13" fill="#8b7fff" opacity="0.13" />
        <circle cx="150" cy="30" r="17" fill="#22d3ee" opacity="0.09" />
        <circle cx="120" cy="12" r="8" fill="#e055c8" opacity="0.1" />
      </g>

      {/* suelo */}
      <rect y="76" width="178" height="24" fill={`url(#${id}-floor)`} />
      <line x1="0" y1="76" x2="178" y2="76" stroke="#ffffff" strokeOpacity="0.07" strokeWidth="0.4" />
    </>
  );
}

/** Escena 1 — figura de calle: abrigo, bolso en la mano, botas. */
function StreetScene({ id }: { id: string }) {
  const sil = `url(#${id}-silhouette)`;
  const rim = `url(#${id}-rim)`;
  return (
    <>
      {/* cabeza y cuello */}
      <ellipse cx="80" cy="13" rx="6.4" ry="7.6" fill={sil} />
      <rect x="77.4" y="19" width="5.2" height="5" fill={sil} />

      {/* abrigo — caja `coat` (x 53.4→106.8, y 20→60) */}
      <path
        d="M80 23 C69 23 62 26 59 31 L55.5 56 C55.5 58.4 57 59 59.5 59 L100.5 59 C103 59 104.5 58.4 104.5 56 L101 31 C98 26 91 23 80 23 Z"
        fill={sil}
      />
      {/* solapa: lectura de prenda, no de bloque */}
      <path d="M80 23 L74 40 L80 59 L86 40 Z" fill="#12131d" opacity="0.85" />
      <path d="M80 23 C69 23 62 26 59 31 L55.5 56" stroke={rim} strokeWidth="0.8" fill="none" />

      {/* piernas */}
      <path d="M69 59 L67.5 74 L75 74 L76.5 59 Z" fill={sil} />
      <path d="M83.5 59 L85 74 L92.5 74 L91 59 Z" fill={sil} />

      {/* botas — caja `boot` (x 58.7→96.1, y 72→88) */}
      <path d="M64.5 73 L63.5 84 C63.5 85.6 64.6 86.2 66.4 86.2 L76 86.2 C77.4 86.2 78 85.5 78 84.3 L77 73 Z" fill={sil} />
      <path d="M84 73 L83 84.3 C83 85.5 83.6 86.2 85 86.2 L94.6 86.2 C96.4 86.2 97.5 85.6 97.5 84 L96.5 73 Z" fill={sil} />
      <path d="M63.5 84 L78 84" stroke={rim} strokeWidth="0.7" />

      {/* brazo derecho hacia el bolso */}
      <path d="M100 33 L107 45 L112 47 L110 50 L102 48 L96 36 Z" fill={sil} />

      {/* bolso — caja `bag` (x 101.5→135.3, y 46→66) */}
      <path d="M107 52 L129 52 L131 65 L105 65 Z" fill={sil} />
      <path d="M110 52 C110 47 114 45 118 45 C122 45 126 47 126 52" stroke="#1a1c28" strokeWidth="1.4" fill="none" />
      <path d="M107 52 L129 52" stroke={rim} strokeWidth="0.8" />
      <rect x="115" y="56" width="6" height="4" rx="0.8" fill="#1c1e2b" />
    </>
  );
}

/** Escena 2 — salón: butaca, lámpara de pie, cojín. */
function LivingScene({ id }: { id: string }) {
  const sil = `url(#${id}-silhouette)`;
  const rim = `url(#${id}-rim)`;
  return (
    <>
      {/* butaca — caja `armchair` (x 39.2→99.7, y 40→78) */}
      <path
        d="M45 62 C45 45 52 41 69 41 C86 41 93 45 93 62 L93 66 L45 66 Z"
        fill={sil}
      />
      <path d="M45 62 C45 45 52 41 69 41 C86 41 93 45 93 62" stroke={rim} strokeWidth="0.8" fill="none" />
      {/* asiento */}
      <path d="M42 64 L96 64 C98 64 99 65 99 67 L99 71 C99 72.6 98 73.4 96 73.4 L42 73.4 C40 73.4 39 72.6 39 71 L39 67 C39 65 40 64 42 64 Z" fill="#0e0f18" />
      <path d="M39 67 L99 67" stroke="#ffffff" strokeOpacity="0.07" strokeWidth="0.5" />
      {/* patas */}
      <rect x="43" y="73.4" width="2.6" height="4.6" fill={sil} />
      <rect x="92.4" y="73.4" width="2.6" height="4.6" fill={sil} />

      {/* cojín — caja `cushion` (x 49.8→76.5, y 45→59) */}
      <path d="M54 48 L72 48 C74 48 74.6 49 74.6 51 L74.6 57 C74.6 58.4 74 59 72 59 L54 59 C52 59 51.4 58.4 51.4 57 L51.4 51 C51.4 49 52 48 54 48 Z" fill="#171926" />
      <path d="M54 48 L72 48" stroke={rim} strokeWidth="0.7" />

      {/* lámpara — caja `lamp` (x 117.5→147.7, y 18→52) */}
      <path d="M124 20 L141 20 L145 38 L120 38 Z" fill={sil} />
      <path d="M124 20 L141 20" stroke={rim} strokeWidth="0.9" />
      {/* luz que emite: justifica el key light de la escena */}
      <path d="M120 38 L145 38 L152 76 L113 76 Z" fill="#fbbf24" opacity="0.07" />
      <rect x="131.6" y="38" width="1.8" height="36" fill={sil} />
      <path d="M124 76 L141 76 L139 78 L126 78 Z" fill={sil} />
    </>
  );
}

/** Escena 3 — plató: reloj en la muñeca, zapatilla, auriculares. */
function StudioScene({ id }: { id: string }) {
  const sil = `url(#${id}-silhouette)`;
  const rim = `url(#${id}-rim)`;
  return (
    <>
      {/* cabeza — bajo la caja `headphones` (x 103.2→138.8, y 16→34) */}
      <ellipse cx="121" cy="27" rx="7.6" ry="8.8" fill={sil} />

      {/* auriculares */}
      <path d="M111 26 C111 18.5 115.5 14.5 121 14.5 C126.5 14.5 131 18.5 131 26" stroke="#15171f" strokeWidth="2.6" fill="none" />
      <path d="M111 26 C111 18.5 115.5 14.5 121 14.5 C126.5 14.5 131 18.5 131 26" stroke={rim} strokeWidth="0.8" fill="none" />
      <rect x="107.6" y="24.5" width="5.4" height="8.4" rx="2.4" fill="#191b26" />
      <rect x="129" y="24.5" width="5.4" height="8.4" rx="2.4" fill="#191b26" />

      {/* torso */}
      <path d="M121 36 C112 36 107 39 105 44 L102 64 L140 64 L137 44 C135 39 130 36 121 36 Z" fill={sil} />

      {/* brazo hacia la izquierda, muñeca en la caja `watch` (x 81.9→108.6, y 33→47) */}
      <path d="M106 42 L94 39 L90 41 L92 45 L104 48 Z" fill={sil} />

      {/* reloj */}
      <rect x="93" y="37.6" width="7.6" height="6.4" rx="1.6" fill="#1d2030" />
      <rect x="94.4" y="38.8" width="4.8" height="4" rx="1" fill="#2b3045" />
      <path d="M93 37.6 L100.6 37.6" stroke={rim} strokeWidth="0.8" />
      <circle cx="96.8" cy="40.8" r="0.9" fill="#22d3ee" opacity="0.8" />

      {/* piernas */}
      <path d="M108 64 L98 76 L106 76 L116 64 Z" fill={sil} />
      <path d="M126 64 L130 76 L137 76 L134 64 Z" fill={sil} />

      {/* zapatilla — caja `sneaker` (x 53.4→96.1, y 68→85) */}
      <path
        d="M60 78 C60 75.6 62 74.5 65 74.5 L74 74.5 L82 79 L90 80.6 C92.6 81 93.6 81.8 93.6 83 C93.6 84.2 92.6 84.8 90.6 84.8 L64 84.8 C61.4 84.8 60 84 60 82 Z"
        fill={sil}
      />
      <path d="M60 82 L93.6 82.6" stroke="#ffffff" strokeOpacity="0.16" strokeWidth="0.7" />
      <path d="M60 78 C60 75.6 62 74.5 65 74.5 L74 74.5" stroke={rim} strokeWidth="0.8" fill="none" />
      <path d="M70 75 L76 80 M74 74.6 L80 79.6" stroke="#22283a" strokeWidth="0.9" />
    </>
  );
}

const SCENES: Record<string, (p: { id: string }) => React.ReactElement> = {
  street: StreetScene,
  living: LivingScene,
  studio: StudioScene,
};

export function SceneArt({
  sceneId,
  palette,
  className,
}: {
  sceneId: string;
  palette: { from: string; via: string; to: string };
  className?: string;
}) {
  const Scene = SCENES[sceneId] ?? StreetScene;
  // El id debe ser único por escena: dos <defs> con el mismo id en el documento
  // hacen que la segunda escena herede los gradientes de la primera.
  const id = `scene-${sceneId}`;

  return (
    <svg
      viewBox="0 0 178 100"
      preserveAspectRatio="xMidYMid slice"
      className={className}
      aria-hidden
      focusable="false"
    >
      <Atmosphere id={id} palette={palette} />
      <Scene id={id} />
      {/* viñeta: cierra el frame y evita que las siluetas toquen el borde */}
      <rect width="178" height="100" fill={`url(#${id}-vignette)`} />
      <defs>
        <radialGradient id={`${id}-vignette`} cx="0.5" cy="0.45" r="0.75">
          <stop offset="55%" stopColor="#000000" stopOpacity="0" />
          <stop offset="100%" stopColor="#000000" stopOpacity="0.55" />
        </radialGradient>
      </defs>
    </svg>
  );
}

export { X as pctToSvgX };
