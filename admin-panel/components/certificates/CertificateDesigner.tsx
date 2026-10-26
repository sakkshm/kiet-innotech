"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type ChangeEvent, type PointerEvent as ReactPointerEvent } from "react";
import { ArrowLeft, Download, FileUp, Plus, Save, Send, Trash2, Type, Upload, X } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import type { CertificateField, CertificateFont, CertificateTemplate, CertificateType } from "@/lib/admin-types";
import { useAdmin } from "@/lib/auth/AuthProvider";
import { CERTIFICATE_TYPES, certificateLabels, certificateSources, defaultFields } from "@/lib/certificate-defaults";
import { certificateDownloadName } from "@/lib/certificates";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Field";
import { Loading, Notice } from "@/components/ui/Notice";
import { PageHeader } from "@/components/ui/PageHeader";

function isCertificateType(value: string | null): value is CertificateType {
  return CERTIFICATE_TYPES.includes(value as CertificateType);
}

export function CertificateDesigner() {
  const me = useAdmin();
  const params = useSearchParams();
  const kindParam = params.get("kind");
  const kind = isCertificateType(kindParam) ? kindParam : null;

  const [template, setTemplate] = useState<CertificateTemplate | null>(null);
  const [fields, setFields] = useState<CertificateField[]>([]);
  const [preview, setPreview] = useState<string | null>(null);
  const [fonts, setFonts] = useState<CertificateFont[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [scale, setScale] = useState(1);
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const fontRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!kind) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([api.getCertificateTemplate(kind).catch(() => null), api.listCertificateFonts()]).then(
      async ([loaded, loadedFonts]) => {
        if (cancelled) return;
        setTemplate(loaded);
        setFields(loaded?.fields ?? defaultFields(kind));
        setFonts(loadedFonts);
        setSelectedId(loaded?.fields[0]?.id ?? null);
        if (loaded?.hasPreview) {
          try {
            const url = await api.certificatePreview(kind);
            if (!cancelled) setPreview(url);
          } catch {
            if (!cancelled) setPreview(null);
          }
        }
        if (!cancelled) setLoading(false);
      },
      (err: unknown) => {
        if (cancelled) return;
        setError(errorMessage(err));
        setLoading(false);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [kind]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  if (!me.role || me.role !== "super_admin") {
    return (
      <div className="space-y-6">
        <PageHeader title="Certificate designer" />
        <Notice tone="error">Only the super admin can design certificates.</Notice>
        <ButtonLink href="/">Back to overview</ButtonLink>
      </div>
    );
  }

  if (!kind) {
    return (
      <div className="space-y-6">
        <PageHeader title="Certificate designer" />
        <Notice tone="error">Choose a certificate type from the Certificates page.</Notice>
        <ButtonLink href="/certificates">Back to certificates</ButtonLink>
      </div>
    );
  }

  if (loading) return <Loading label="Loading designer" />;

  const certType: CertificateType = kind;
  const selected = fields.find((field) => field.id === selectedId) ?? null;
  const update = (id: string, patch: Partial<CertificateField>) => {
    setFields((current) => current.map((field) => (field.id === id ? { ...field, ...patch } : field)));
    setDirty(true);
  };

  const fit = () => {
    const image = imageRef.current;
    if (!image || !template) return;
    const width = image.getBoundingClientRect().width;
    if (width > 0) setScale(template.pageWidthPt / width);
  };

  async function save(): Promise<CertificateTemplate | null> {
    setBusy(true);
    setError(null);
    try {
      const saved = await api.saveCertificateFields(certType, fields);
      setTemplate(saved);
      setDirty(false);
      return saved;
    } catch (err) {
      setError(errorMessage(err));
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function publish(publish: boolean) {
    const saved = await save();
    if (!saved) return;
    setBusy(true);
    try {
      const next = publish ? await api.publishCertificate(certType) : await api.withdrawCertificate(certType);
      setTemplate(next);
      setMessage(publish ? "Published. Eligible students can now download it." : "Withdrawn. Downloads are closed.");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function uploadPdf(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const next = await api.uploadCertificateTemplate(certType, file, certificateLabels[certType]);
      setTemplate(next);
      setFields(next.fields);
      setSelectedId(next.fields[0]?.id ?? null);
      setPreview(await api.certificatePreview(certType));
      setDirty(false);
      setMessage("Template uploaded. Place the fields, then save and publish.");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function downloadSample() {
    if (!template) return;
    if (dirty && !(await save())) return;
    setBusy(true);
    setError(null);
    try {
      const blob = await api.certificateSample(certType);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = certificateDownloadName(template);
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function uploadFont(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const font = await api.uploadCertificateFont(file, file.name.replace(/\.(ttf|otf)$/i, ""));
      setFonts((current) => [...current, font]);
      setMessage(`Font ${font.name} uploaded.`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function deleteFont(font: CertificateFont) {
    setBusy(true);
    setError(null);
    try {
      await api.deleteCertificateFont(font.id);
      setFonts((current) => current.filter((item) => item.id !== font.id));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/certificates" className="inline-flex items-center gap-1 text-sm font-semibold text-brand-600 hover:text-brand-700">
            <ArrowLeft aria-hidden="true" className="size-4" /> Certificates
          </Link>
          <PageHeader eyebrow={template?.isPublished ? "Published" : "Draft"} title={certificateLabels[kind]} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input ref={uploadRef} type="file" accept="application/pdf,.pdf" className="hidden" onChange={uploadPdf} />
          <Button variant="secondary" size="sm" onClick={() => uploadRef.current?.click()} disabled={busy}>
            <FileUp aria-hidden="true" className="size-4" /> {template ? "Replace PDF" : "Upload PDF"}
          </Button>
          <Button variant="secondary" size="sm" onClick={downloadSample} disabled={busy || !template}>
            <Download aria-hidden="true" className="size-4" /> Sample
          </Button>
          <Button variant="secondary" size="sm" onClick={() => void save()} pending={busy}>
            <Save aria-hidden="true" className="size-4" /> Save
          </Button>
          {template?.isPublished ? (
            <Button variant="danger" size="sm" onClick={() => void publish(false)} disabled={busy}>
              Withdraw
            </Button>
          ) : (
            <Button size="sm" onClick={() => void publish(true)} disabled={busy || !template}>
              <Send aria-hidden="true" className="size-4" /> Publish
            </Button>
          )}
        </div>
      </div>

      {error && <Notice tone="error">{error}</Notice>}
      {message && <Notice tone="success">{message}</Notice>}
      {dirty && <Notice tone="warning">Unsaved changes. Save before publishing or leaving this page.</Notice>}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <section className="rounded-2xl bg-white p-4 ring-1 ring-line">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-display text-base font-bold text-navy-900">Design</h2>
            <Button variant="secondary" size="sm" onClick={() => {
              const field: CertificateField = {
                id: `field-${Date.now()}`,
                label: "recipient_name",
                xPt: 150,
                yPt: 300,
                wPt: 400,
                hPt: 32,
                font: "Montserrat",
                fontsize: 22,
                color: "#0b1f3a",
                align: 1,
                rotation: 0,
                lineheight: 1.2,
                defaultText: "",
                sourceKey: "recipient_name",
              };
              setFields((current) => [...current, field]);
              setSelectedId(field.id);
              setDirty(true);
            }}>
              <Plus aria-hidden="true" className="size-4" /> Add field
            </Button>
          </div>
          {!preview ? (
            <div className="flex min-h-72 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-line bg-surface p-8 text-center">
              <Type aria-hidden="true" className="size-8 text-muted" />
              <p className="text-sm text-muted">Upload this certificate&apos;s PDF to start placing fields.</p>
              <Button size="sm" onClick={() => uploadRef.current?.click()} disabled={busy}>
                <Upload aria-hidden="true" className="size-4" /> Upload PDF
              </Button>
            </div>
          ) : (
            <div className="relative mx-auto w-full overflow-hidden rounded-lg ring-1 ring-line" style={{ aspectRatio: `${template?.pageWidthPt ?? 841.89} / ${template?.pageHeightPt ?? 595.276}` }}>
              <img ref={imageRef} src={preview} alt="Certificate template" className="block w-full select-none" onLoad={fit} draggable={false} />
              <div className="absolute inset-0">
                {fields.map((field) => (
                  <FieldBox
                    key={field.id}
                    field={field}
                    scale={scale}
                    selected={field.id === selectedId}
                    onSelect={() => setSelectedId(field.id)}
                    onChange={(patch) => update(field.id, patch)}
                  />
                ))}
              </div>
            </div>
          )}
        </section>

        <aside className="space-y-4">
          <section className="rounded-2xl bg-white p-4 ring-1 ring-line">
            <h2 className="font-display text-base font-bold text-navy-900">Fields</h2>
            <div className="mt-2 space-y-1">
              {fields.length === 0 && <p className="text-sm text-muted">No fields yet. Add the recipient&apos;s name first.</p>}
              {fields.map((field) => (
                <button
                  key={field.id}
                  type="button"
                  onClick={() => setSelectedId(field.id)}
                  className={`flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-sm ${field.id === selectedId ? "bg-brand-50 font-semibold text-navy-900" : "text-navy-800 hover:bg-surface"}`}
                >
                  <span>{field.sourceKey ?? "(fixed text)"}</span>
                  <span className="text-xs text-muted">{Math.round(field.wPt)}×{Math.round(field.hPt)}</span>
                </button>
              ))}
            </div>
          </section>

          {selected && (
            <section className="space-y-3 rounded-2xl bg-white p-4 ring-1 ring-line">
              <div className="flex items-center justify-between">
                <h2 className="font-display text-base font-bold text-navy-900">Configure</h2>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label="Delete field"
                  onClick={() => {
                    setFields((current) => current.filter((field) => field.id !== selected.id));
                    setSelectedId(null);
                    setDirty(true);
                  }}
                >
                  <Trash2 aria-hidden="true" className="size-4" />
                </Button>
              </div>
              <Field label="Content" htmlFor="field-content">
                <Select id="field-content"
                  value={selected.sourceKey ?? ""}
                  onChange={(event) => {
                    const source = event.target.value;
                    update(selected.id, { sourceKey: source || null, label: source });
                  }}
                >
                  <option value="">Fixed text</option>
                  {certificateSources.map((source) => (
                    <option key={source} value={source}>{source.replaceAll("_", " ")}</option>
                  ))}
                </Select>
              </Field>
              {!selected.sourceKey && (
                <Field label="Text" htmlFor="field-text">
                  <Input id="field-text" value={selected.defaultText} onChange={(event) => update(selected.id, { defaultText: event.target.value })} />
                </Field>
              )}
              <Field label="Font" htmlFor="field-font">
                <Select id="field-font" value={selected.font} onChange={(event) => update(selected.id, { font: event.target.value })}>
                  <option value="Montserrat">Montserrat</option>
                  <option value="Montserrat SemiBold">Montserrat SemiBold</option>
                  <option value="Montserrat Bold">Montserrat Bold</option>
                  {fonts.map((font) => (
                    <option key={font.id} value={font.name}>{font.name}</option>
                  ))}
                </Select>
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Size (pt)" htmlFor="field-size">
                  <Input id="field-size" type="number" min={6} max={120} value={selected.fontsize} onChange={(event) => update(selected.id, { fontsize: Number(event.target.value) || 6 })} />
                </Field>
                <Field label="Colour" htmlFor="field-color">
                  <Input id="field-color" type="color" value={selected.color} onChange={(event) => update(selected.id, { color: event.target.value })} />
                </Field>
                <Field label="Align" htmlFor="field-align">
                  <Select id="field-align" value={String(selected.align)} onChange={(event) => update(selected.id, { align: Number(event.target.value) })}>
                    <option value="0">Left</option>
                    <option value="1">Centre</option>
                    <option value="2">Right</option>
                  </Select>
                </Field>
                <Field label="Rotation" htmlFor="field-rotation">
                  <Select id="field-rotation" value={String(selected.rotation)} onChange={(event) => update(selected.id, { rotation: Number(event.target.value) })}>
                    <option value="0">0°</option>
                    <option value="90">90°</option>
                    <option value="180">180°</option>
                    <option value="270">270°</option>
                  </Select>
                </Field>
              </div>
            </section>
          )}

          <section className="space-y-2 rounded-2xl bg-white p-4 ring-1 ring-line">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-base font-bold text-navy-900">Fonts</h2>
              <input ref={fontRef} type="file" accept=".ttf,.otf,font/ttf,font/otf" className="hidden" onChange={uploadFont} />
              <Button variant="secondary" size="sm" onClick={() => fontRef.current?.click()} disabled={busy}>
                <Upload aria-hidden="true" className="size-4" /> Upload
              </Button>
            </div>
            <p className="text-xs text-muted">Montserrat is bundled. Upload a TTF or OTF (max 2 MB).</p>
            <ul className="space-y-1">
              {fonts.map((font) => (
                <li key={font.id} className="flex items-center justify-between rounded-lg bg-surface px-2 py-1.5 text-sm">
                  <span>{font.name}</span>
                  <button type="button" aria-label={`Delete ${font.name}`} className="text-red-600 hover:text-red-700" onClick={() => void deleteFont(font)}>
                    <X aria-hidden="true" className="size-4" />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </div>
    </div>
  );
}

function FieldBox({ field, scale, selected, onSelect, onChange }: {
  field: CertificateField;
  scale: number;
  selected: boolean;
  onSelect: () => void;
  onChange: (patch: Partial<CertificateField>) => void;
}) {
  const start = useRef<{ x: number; y: number; field: CertificateField; mode: "drag" | "resize" } | null>(null);

  function down(event: ReactPointerEvent<HTMLDivElement>, mode: "drag" | "resize") {
    event.preventDefault();
    event.stopPropagation();
    onSelect();
    start.current = { x: event.clientX, y: event.clientY, field: { ...field }, mode };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }

  function move(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = start.current;
    if (!drag) return;
    const dx = (event.clientX - drag.x) * scale;
    const dy = (event.clientY - drag.y) * scale;
    if (drag.mode === "drag") {
      onChange({ xPt: Math.max(0, drag.field.xPt + dx), yPt: Math.max(0, drag.field.yPt + dy) });
    } else {
      onChange({ wPt: Math.max(20, drag.field.wPt + dx), hPt: Math.max(10, drag.field.hPt + dy) });
    }
  }

  function up() {
    start.current = null;
  }

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Field ${field.sourceKey ?? "fixed text"}`}
      onPointerDown={(event) => down(event, "drag")}
      onPointerMove={move}
      onPointerUp={up}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") onSelect();
      }}
      className={`absolute cursor-move border text-[10px] ${selected ? "border-brand-500 bg-brand-500/10" : "border-navy-800/30 bg-white/10 hover:border-brand-500"}`}
      style={{ left: `${field.xPt / scale}px`, top: `${field.yPt / scale}px`, width: `${field.wPt / scale}px`, height: `${field.hPt / scale}px` }}
    >
      <span className="pointer-events-none absolute -top-4 left-0 whitespace-nowrap rounded bg-navy-900/80 px-1 text-[9px] text-white">
        {field.sourceKey ?? field.defaultText ?? "fixed"}
      </span>
      <div
        role="presentation"
        onPointerDown={(event) => down(event, "resize")}
        onPointerMove={move}
        onPointerUp={up}
        className="absolute -bottom-1 -right-1 size-2.5 cursor-nwse-resize rounded-sm bg-brand-500"
      />
    </div>
  );
}
