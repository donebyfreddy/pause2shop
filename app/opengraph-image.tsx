import { ImageResponse } from "next/og";
import { APP_NAME } from "@/lib/seo";

/**
 * Imagen de Open Graph / Twitter. Antes `/opengraph-image` devolvía 404 y no
 * había ninguna etiqueta social, así que compartir el enlace producía una
 * previsualización desnuda. Para un producto que se presenta enviando una URL,
 * esta imagen es la primera impresión real.
 *
 * Se genera en el servidor y se sirve estática: no hay que mantener un PNG a
 * mano ni recordar regenerarlo cuando cambie el mensaje.
 *
 * Restricciones de `ImageResponse` que condicionan el diseño: solo un subconjunto
 * de CSS (flexbox sí, grid no), sin `backdrop-filter` y sin `mask-image`. La
 * profundidad se consigue con gradientes superpuestos, que sí soporta.
 */

export const alt = `${APP_NAME} — Convierte cada escena en una oportunidad de compra`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 72,
          background: "#06060a",
          position: "relative",
        }}
      >
        {/* atmósfera de marca */}
        <div
          style={{
            position: "absolute",
            top: -220,
            left: 300,
            width: 900,
            height: 700,
            background:
              "radial-gradient(circle, rgba(109,94,252,0.55) 0%, rgba(109,94,252,0) 68%)",
          }}
        />
        <div
          style={{
            position: "absolute",
            bottom: -260,
            right: -120,
            width: 700,
            height: 700,
            background:
              "radial-gradient(circle, rgba(34,211,238,0.32) 0%, rgba(34,211,238,0) 70%)",
          }}
        />

        {/* marca */}
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 12,
              background: "linear-gradient(160deg, #8b7fff 0%, #4a3ce0 100%)",
            }}
          />
          <div
            style={{
              fontSize: 30,
              fontWeight: 600,
              color: "#f2f3f7",
              letterSpacing: -0.5,
            }}
          >
            {APP_NAME}
          </div>
          <div
            style={{
              marginLeft: 12,
              padding: "7px 15px",
              borderRadius: 999,
              border: "1px solid #2c3043",
              fontSize: 19,
              color: "#a2a5b4",
            }}
          >
            Visual commerce para vídeo y VOD
          </div>
        </div>

        {/* mensaje */}
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div
            style={{
              fontSize: 68,
              fontWeight: 600,
              color: "#f2f3f7",
              lineHeight: 1.06,
              letterSpacing: -2.4,
              maxWidth: 900,
              display: "flex",
              flexDirection: "column",
            }}
          >
            <span>Convierte cada escena</span>
            <span style={{ color: "#8b7fff" }}>en una oportunidad de compra.</span>
          </div>

          <div
            style={{
              marginTop: 28,
              fontSize: 25,
              color: "#a2a5b4",
              lineHeight: 1.45,
              maxWidth: 820,
            }}
          >
            Detección por escena, coincidencia contra tu catálogo y umbral
            editorial: solo se publica lo fiable.
          </div>
        </div>

        {/* pie: el motivo de detección, que es la metáfora del producto */}
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {["Escena", "Detección", "Catálogo", "Umbral"].map((step, i) => (
            <div key={step} style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div
                style={{
                  padding: "9px 19px",
                  borderRadius: 10,
                  border: `1px solid ${i === 3 ? "rgba(34,211,238,0.5)" : "#1e2130"}`,
                  background: i === 3 ? "rgba(34,211,238,0.1)" : "rgba(255,255,255,0.025)",
                  fontSize: 20,
                  color: i === 3 ? "#22d3ee" : "#6b6f80",
                }}
              >
                {step}
              </div>
              {i < 3 && <div style={{ fontSize: 20, color: "#494d5c" }}>→</div>}
            </div>
          ))}
        </div>
      </div>
    ),
    size
  );
}
