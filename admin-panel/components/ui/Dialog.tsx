"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { Button } from "./Button";
import { Field, Input, Textarea } from "./Field";
import { errorMessage } from "@/lib/api";

const widths = { md: "max-w-lg", lg: "max-w-2xl", xl: "max-w-4xl" } as const;

/**
 * Modal built on the native <dialog> element, which traps focus and handles Escape.
 * Render it only while it should be open; unmounting closes it and resets its state.
 */
export function Dialog({
  title,
  description,
  onClose,
  busy = false,
  children,
  footer,
  size = "md",
}: {
  title: string;
  description?: ReactNode;
  onClose: () => void;
  /** While true, Escape and the close button are ignored. */
  busy?: boolean;
  children?: ReactNode;
  footer: ReactNode;
  /** md for confirmations, lg for forms, xl for wide pickers. */
  size?: "md" | "lg" | "xl";
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => dialog?.close();
  }, []);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
      className={`m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] ${widths[size]} flex-col overflow-hidden rounded-2xl bg-white p-0 text-ink shadow-2xl ring-1 ring-line backdrop:bg-navy-950/60 open:flex`}
    >
      <div className="flex shrink-0 items-start justify-between gap-4 border-b border-line px-5 py-4">
        <div className="min-w-0">
          <h2 id={titleId} className="font-display text-lg font-bold text-navy-900">
            {title}
          </h2>
          {description && (
            <div id={descriptionId} className="mt-1 text-sm text-muted">
              {description}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          disabled={busy}
          aria-label="Close dialog"
          className="-mr-1 inline-flex size-8 shrink-0 items-center justify-center rounded-full text-muted transition hover:bg-surface hover:text-navy-900 focus-visible:outline-2 focus-visible:outline-brand-500 disabled:opacity-50"
        >
          <X aria-hidden="true" className="size-4" />
        </button>
      </div>
      {/* Long content scrolls inside the dialog; the title and buttons stay in view. flex-auto, not flex-1: Safari sizes a zero-basis
          item in a dialog with no fixed height at zero, which left the content a sliver you could scroll but not read. */}
      {children && <div className="min-h-0 flex-auto overflow-y-auto overscroll-contain px-5 py-4">{children}</div>}
      <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-line bg-surface/60 px-5 py-3">{footer}</div>
    </dialog>
  );
}

/** A confirmation dialog for a consequential action, optionally asking for a reason. */
export function ConfirmDialog({
  title,
  description,
  confirmLabel,
  tone = "primary",
  reasonLabel,
  typeToConfirm,
  onConfirm,
  onClose,
  children,
}: {
  title: string;
  description?: ReactNode;
  confirmLabel: string;
  tone?: "primary" | "danger";
  /** When set, a reason of at least 5 characters is required. */
  reasonLabel?: string;
  /** When set, the confirm button stays disabled until this exact phrase is typed (for actions that cannot be undone). */
  typeToConfirm?: string;
  onConfirm: (reason: string) => Promise<void>;
  onClose: () => void;
  children?: ReactNode;
}) {
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const reasonId = useId();
  const phraseId = useId();
  const phraseOk = !typeToConfirm || typed.trim() === typeToConfirm;

  async function confirm() {
    if (!phraseOk) return;
    if (reasonLabel && reason.trim().length < 5) {
      setError("Give a reason of at least 5 characters. It is saved in the audit log.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      await onConfirm(reason.trim());
    } catch (err) {
      setError(errorMessage(err));
      setPending(false);
    }
  }

  return (
    <Dialog
      title={title}
      description={description}
      onClose={onClose}
      busy={pending}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button variant={tone} onClick={confirm} pending={pending} disabled={!phraseOk}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
      {typeToConfirm && (
        <div className="mt-4">
          <Field label={`Type ${typeToConfirm} to confirm`} htmlFor={phraseId}>
            <Input id={phraseId} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" spellCheck={false} className="font-mono tracking-widest" />
          </Field>
        </div>
      )}
      {reasonLabel && (
        <Field label={reasonLabel} htmlFor={reasonId} hint="Required. Saved in the audit log with your email.">
          <Textarea
            id={reasonId}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={500}
            required
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${reasonId}-dialog-error` : `${reasonId}-hint`}
          />
        </Field>
      )}
      {error && (
        <p id={`${reasonId}-dialog-error`} role="alert" className="mt-3 text-sm font-medium text-red-700">
          {error}
        </p>
      )}
    </Dialog>
  );
}
