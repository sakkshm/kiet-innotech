"use client";

import { useState } from "react";
import { Award, ShieldAlert } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { useAdmin } from "@/lib/auth/AuthProvider";
import type { CertificateTemplate, CertificateType } from "@/lib/admin-types";
import { CERTIFICATE_TYPES, certificateLabels } from "@/lib/certificate-defaults";
import { useQuery } from "@/lib/use-query";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Loading, Notice } from "@/components/ui/Notice";
import { PageHeader } from "@/components/ui/PageHeader";
import { Pill } from "@/components/ui/Pill";

export function CertificatesView() {
  const me = useAdmin();
  const isSuper = me.role === "super_admin";
  const templates = useQuery(isSuper ? "certificates" : null, () => api.listCertificateTemplates());
  const [busy, setBusy] = useState<CertificateType | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function togglePublished(template: CertificateTemplate, publish: boolean) {
    setBusy(template.type);
    setError(null);
    setMessage(null);
    try {
      const next = publish ? await api.publishCertificate(template.type) : await api.withdrawCertificate(template.type);
      templates.setData((templates.data ?? []).map((item) => (item.type === next.type ? next : item)));
      setMessage(
        publish
          ? `${certificateLabels[template.type]} is now available to eligible recipients.`
          : `${certificateLabels[template.type]} is no longer available to recipients.`,
      );
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  if (!isSuper) {
    return (
      <div className="space-y-6">
        <PageHeader title="Certificates" />
        <section className="max-w-xl border-l-4 border-red-500 bg-white py-4 pl-4 pr-4">
          <p className="flex items-center gap-2 text-red-700">
            <ShieldAlert aria-hidden="true" className="size-5" />
            <span className="font-display text-lg font-bold">Not authorised</span>
          </p>
          <p className="mt-1 text-sm text-muted">Only the super admin designs and publishes certificates.</p>
          <ButtonLink href="/" size="sm" className="mt-4">Back to overview</ButtonLink>
        </section>
      </div>
    );
  }

  const byType = new Map((templates.data ?? []).map((template) => [template.type, template]));

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Super admin"
        title="Certificates"
        description="One template per certificate type. Upload the PDF, place the fields over the design, then publish. Participation certificates need published results and a present student; winners need published awards; judges get one certificate each."
      />
      {templates.error && <Notice tone="error">{templates.error}</Notice>}
      {error && <Notice tone="error">{error}</Notice>}
      {message && <Notice tone="success">{message}</Notice>}
      {!templates.data && !templates.error && <Loading label="Loading certificate templates" />}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {CERTIFICATE_TYPES.map((type) => {
          const template = byType.get(type);
          return (
            <article key={type} className="flex flex-col overflow-hidden rounded-2xl bg-white ring-1 ring-line">
              <div className="relative aspect-[1.414/1] bg-surface">
                <Preview type={type} available={Boolean(template?.hasPreview)} />
              </div>
              <div className="flex flex-1 flex-col gap-3 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="font-display text-base font-bold text-navy-900">{certificateLabels[type]}</h2>
                    <p className="mt-0.5 text-xs text-muted">
                      {type.startsWith("institute") ? "Institute certificate · distribution not enabled" : "Department certificate"}
                    </p>
                  </div>
                  <Pill tone={template?.isPublished ? "green" : "slate"}>{template?.isPublished ? "Published" : template ? "Draft" : "No template"}</Pill>
                </div>
                <div className="mt-auto flex flex-wrap items-center gap-2">
                  <ButtonLink href={`/certificates/designer/?kind=${type}`} size="sm" variant="secondary">
                    {template ? "Design" : "Upload template"}
                  </ButtonLink>
                  {template && (
                    <Button
                      size="sm"
                      variant={template.isPublished ? "danger" : "primary"}
                      pending={busy === type}
                      disabled={busy !== null && busy !== type}
                      onClick={() => void togglePublished(template, !template.isPublished)}
                    >
                      {template.isPublished ? "Stop distribution" : "Publish & distribute"}
                    </Button>
                  )}
                </div>
              </div>
            </article>
          );
        })}
      </div>
      <Notice tone="info">
        <span className="inline-flex items-center gap-2"><Award aria-hidden="true" className="size-4" /> Institute templates can be designed and published now, but students and judges cannot download them yet.</span>
      </Notice>
    </div>
  );
}

function Preview({ type, available }: { type: (typeof CERTIFICATE_TYPES)[number]; available: boolean }) {
  if (!available) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted">
        <span className="inline-flex items-center gap-2"><Award aria-hidden="true" className="size-4" /> No PDF uploaded</span>
      </div>
    );
  }
  return <PreviewImage type={type} />;
}

function PreviewImage({ type }: { type: (typeof CERTIFICATE_TYPES)[number] }) {
  const image = useQuery(`preview-${type}`, () => api.certificatePreview(type));
  if (image.error) return <div className="flex h-full items-center justify-center p-4 text-xs text-red-700">{errorMessage(image.error)}</div>;
  if (!image.data) return <div className="flex h-full items-center justify-center text-xs text-muted">Loading preview…</div>;
  return <img src={image.data} alt={`${certificateLabels[type]} template`} className="h-full w-full object-contain" />;
}
