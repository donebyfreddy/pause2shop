"use client";

import { useSyncExternalStore } from "react";

/**
 * `prefers-reduced-motion` de forma segura para hidratación.
 *
 * Por qué no vale `useReducedMotion()` de la librería de movimiento cuando el
 * valor decide QUÉ se renderiza: el servidor no puede conocer la preferencia del
 * usuario, así que devuelve una cosa en el HTML de servidor y otra en el primer
 * render del cliente. React descarta el HTML del servidor y avisa por consola.
 * Pasó de verdad y lo detectó el E2E con `emulateMedia({ reducedMotion: "reduce" })`.
 *
 * `useSyncExternalStore` es exactamente la herramienta para esto: acepta un
 * *snapshot de servidor* separado (`getServerSnapshot`), y React lo usa también
 * durante la hidratación. Así el primer render del cliente coincide con el del
 * servidor (`false`) y la preferencia real se aplica en el render siguiente.
 * Además es suscripción de verdad: si el usuario cambia el ajuste del sistema, el
 * componente se actualiza.
 *
 * Nota: para animaciones de la propia librería no hace falta esto —
 * `<MotionConfig reducedMotion="user">` en `LocaleProvider` ya las desactiva sin
 * tocar el árbol—. Este hook es para lo que la librería no puede saber: parar un
 * `setInterval`, o etiquetar un control de reproducción.
 */

const QUERY = "(prefers-reduced-motion: reduce)";

function subscribe(onStoreChange: () => void): () => void {
  const query = window.matchMedia(QUERY);
  query.addEventListener("change", onStoreChange);
  return () => query.removeEventListener("change", onStoreChange);
}

function getSnapshot(): boolean {
  return window.matchMedia(QUERY).matches;
}

/** En servidor se asume que NO hay preferencia: es el valor que se hidrata. */
function getServerSnapshot(): boolean {
  return false;
}

export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
