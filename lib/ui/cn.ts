import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Une clases resolviendo conflictos de Tailwind (la última gana). Es la base de
 * todos los componentes del sistema: permite que un consumidor sobrescriba
 * cualquier clase por prop `className` sin pelearse con la especificidad.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
