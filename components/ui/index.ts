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
export { Reveal, RevealGroup, RevealItem } from "./Reveal";
