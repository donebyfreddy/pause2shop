/**
 * Barrel del sistema de diseño. Landing, estudio y admin importan SIEMPRE desde
 * aquí (`@/components/ui`): si un componente empieza a pintar sus propios
 * botones o badges, se nota en el diff.
 */
export { Button, ButtonLink, buttonStyles, type ButtonProps } from "./Button";
export { Badge, badgeStyles, type BadgeTone } from "./Badge";
export {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardBody,
  CardFooter,
  SectionLabel,
} from "./Card";
export { Input, Select, SearchInput, Label, DataRow } from "./Field";
export {
  Skeleton,
  SkeletonText,
  SkeletonRows,
  EmptyState,
  Progress,
  Callout,
} from "./Feedback";
export { Drawer, Modal } from "./Overlay";
export { Segmented, type SegmentedOption } from "./Segmented";
export { StatCard } from "./Stat";
export { Table, TableWrap, THead, TH, TBody, TR, TD, TableEmpty } from "./Table";
export { ToastProvider, useToast } from "./Toast";
// `Reveal` se ha eliminado a propósito. Arrancaba en `opacity: 0` esperando un
// `IntersectionObserver` y `useReducedMotion` solo le neutralizaba el
// desplazamiento, no la opacidad: con movimiento reducido, o sin que el observer
// llegara a dispararse, el contenido no aparecía nunca. Su sustituto es
// `@/components/motion` (`FadeIn`, `StaggerGroup`, `StaggerItem`), que marca los
// envoltorios con `data-reveal` para que CSS pueda dejarlos en su estado final.
