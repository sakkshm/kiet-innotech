import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, Info, LoaderCircle, XCircle } from "lucide-react";

const variants = {
  primary: "bg-accent-500 text-white shadow-lg shadow-accent-500/25 hover:bg-accent-600",
  dark: "bg-navy-900 text-white hover:bg-navy-800",
  outline: "border border-navy-800/15 bg-white text-navy-800 hover:border-navy-800",
  ghost: "text-navy-800 hover:bg-surface",
  danger: "border border-red-200 bg-white text-red-700 hover:border-red-500 hover:bg-red-50",
  destructive: "bg-red-600 text-white shadow-lg shadow-red-600/20 hover:bg-red-700",
  link: "text-accent-600 underline-offset-4 hover:underline",
};

const sizes = {
  sm: "px-4 py-2 text-sm",
  md: "px-6 py-3 text-sm",
  lg: "px-7 py-3.5 text-base",
};

export type ButtonVariant = keyof typeof variants;

/** Button classes, also used to style links as buttons. */
export function buttonStyles(variant: ButtonVariant = "primary", size: keyof typeof sizes = "md") {
  const padding = variant === "link" ? "p-0 text-sm" : sizes[size];
  return `inline-flex items-center justify-center gap-2 rounded-full font-semibold transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-500/30 disabled:pointer-events-none disabled:opacity-50 ${variants[variant]} ${padding}`;
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: keyof typeof sizes;
  pending?: boolean;
};

export function Button({ variant = "primary", size = "md", pending = false, className = "", children, disabled, type = "button", ...props }: ButtonProps) {
  return (
    <button type={type} disabled={disabled || pending} aria-busy={pending} className={`${buttonStyles(variant, size)} ${className}`} {...props}>
      {pending && <LoaderCircle size={16} className="animate-spin" aria-hidden="true" />}
      {children}
    </button>
  );
}

type FieldProps = {
  id: string;
  label: string;
  hint?: ReactNode;
  error?: string | null;
  optional?: boolean;
  className?: string;
  children: ReactNode;
};

/** A labelled form control with an optional hint and error message. */
export function Field({ id, label, hint, error, optional, className = "", children }: FieldProps) {
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-2 block text-sm font-semibold text-navy-800">
        {label}
        {optional && <span className="ml-1 font-normal text-muted">(optional)</span>}
      </label>
      {children}
      {error ? (
        <p id={`${id}-error`} className="mt-2 text-sm font-medium text-red-700">
          {error}
        </p>
      ) : (
        hint && (
          <p id={`${id}-hint`} className="mt-2 text-sm text-muted">
            {hint}
          </p>
        )
      )}
    </div>
  );
}

const control =
  "w-full rounded-xl border border-line bg-white px-4 py-3 text-[15px] text-ink transition placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-brand-500/15 disabled:cursor-not-allowed disabled:bg-surface disabled:text-muted aria-[invalid=true]:border-red-400";

function describedBy(id: string | undefined, invalid: boolean) {
  return id ? (invalid ? `${id}-error` : `${id}-hint`) : undefined;
}

type ControlProps = { invalid?: boolean };

export function Input({ invalid = false, className = "", ...props }: InputHTMLAttributes<HTMLInputElement> & ControlProps) {
  return <input aria-invalid={invalid} aria-describedby={describedBy(props.id, invalid)} className={`${control} ${className}`} {...props} />;
}

export function Select({ invalid = false, className = "", children, ...props }: SelectHTMLAttributes<HTMLSelectElement> & ControlProps) {
  return (
    <div className={`relative ${className}`}>
      <select aria-invalid={invalid} aria-describedby={describedBy(props.id, invalid)} className={`${control} appearance-none pr-10`} {...props}>
        {children}
      </select>
      <ChevronDown size={18} className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-muted" aria-hidden="true" />
    </div>
  );
}

export function Textarea({ invalid = false, className = "", ...props }: TextareaHTMLAttributes<HTMLTextAreaElement> & ControlProps) {
  return <textarea aria-invalid={invalid} aria-describedby={describedBy(props.id, invalid)} className={`${control} min-h-36 leading-relaxed ${className}`} {...props} />;
}

const noticeTones = {
  info: { box: "bg-brand-50 text-brand-700 ring-brand-100", icon: Info },
  success: { box: "bg-emerald-50 text-emerald-800 ring-emerald-100", icon: CheckCircle2 },
  warning: { box: "bg-accent-50 text-accent-600 ring-accent-100", icon: AlertTriangle },
  error: { box: "bg-red-50 text-red-800 ring-red-100", icon: XCircle },
};

/** A short message block. Errors are announced to screen readers. */
export function Notice({ tone = "info", title, children, className = "" }: { tone?: keyof typeof noticeTones; title?: string; children?: ReactNode; className?: string }) {
  const { box, icon: ToneIcon } = noticeTones[tone];
  return (
    <div role={tone === "error" ? "alert" : "status"} className={`flex gap-3 rounded-2xl p-4 text-sm ring-1 ${box} ${className}`}>
      <ToneIcon size={20} className="mt-px shrink-0" aria-hidden="true" />
      <div className="min-w-0 leading-relaxed">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={title ? "mt-1 opacity-90" : ""}>{children}</div>}
      </div>
    </div>
  );
}

/** A small rounded label, e.g. a team status. */
export function Pill({ tone = "slate", children }: { tone?: "slate" | "green" | "orange" | "charcoal" | "red" | "navy"; children: ReactNode }) {
  const tones = {
    slate: "bg-slate-100 text-slate-700",
    green: "bg-emerald-50 text-emerald-700",
    orange: "bg-accent-50 text-accent-600",
    charcoal: "bg-navy-900/[0.07] text-navy-800",
    red: "bg-red-50 text-red-700",
    navy: "bg-navy-900 text-white",
  };
  return <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${tones[tone]}`}>{children}</span>;
}
