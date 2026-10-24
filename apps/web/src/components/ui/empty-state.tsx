import { Button } from "./button";

export function EmptyState({ title, description, actionLabel, onAction }: {
  title: string; description: string; actionLabel?: string; onAction?: () => void;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-8 text-center">
      <p aria-hidden="true" className="text-4xl">📦</p>
      <h3 className="mt-3 text-base font-semibold">{title}</h3>
      <p className="mx-auto mt-1 max-w-md text-sm text-text-muted">{description}</p>
      {actionLabel && onAction ? <div className="mt-4"><Button onClick={onAction}>{actionLabel}</Button></div> : null}
    </div>
  );
}
