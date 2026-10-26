"use client";

import { useEffect, useState } from "react";
import { Award, Download } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { certificateLabels } from "@/lib/certificate-defaults";
import type { CertificateAvailability, CertificateType } from "@/lib/types";
import { Button, Notice } from "@/components/ui/form";
import { PageHeading, Panel } from "@/components/portal/PageHeading";

export default function CertificatesPage() {
  const [certificates, setCertificates] = useState<CertificateAvailability[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<CertificateType | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    api.getMyCertificates().then(
      (list) => {
        if (!cancelled) setCertificates(list);
      },
      (err: unknown) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : "Could not load your certificates.");
      },
    );
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  // Pick up a certificate the organisers published while this tab was in the background.
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") setRefreshKey((value) => value + 1);
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);

  async function download(type: CertificateType) {
    setDownloading(type);
    setError(null);
    try {
      const blob = await api.downloadCertificate(type);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `innotech26-${type}.pdf`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not download the certificate.");
    } finally {
      setDownloading(null);
    }
  }

  return (
    <>
      <PageHeading eyebrow="Your achievements" title="Certificates">
        Download your InnoTech26 certificates. Participation needs your department results to be published and your
        attendance to be marked at the venue. Winners need the department awards to be published.
      </PageHeading>

      {error && <Notice tone="error">{error}</Notice>}

      {!certificates && !error && (
        <p role="status" className="text-sm text-muted">Loading your certificates…</p>
      )}

      {certificates && certificates.length === 0 && (
        <Panel title="Nothing to download yet">
          <p className="text-sm text-muted">
            There is no certificate available for your account yet. Certificates appear here after you are marked
            present and the organisers publish the department results or awards.
          </p>
        </Panel>
      )}

      {certificates && certificates.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2">
          {certificates.filter((item) => item.available).map((item) => (
            <Panel key={item.type}>
              <div className="flex flex-col gap-6">
                <div className="flex items-start gap-3">
                  <span className="rounded-full bg-accent-50 p-2 text-accent-600">
                    <Award aria-hidden="true" className="size-5" />
                  </span>
                  <div>
                    <h2 className="font-display text-lg font-bold text-ink">{certificateLabels[item.type]}</h2>
                  </div>
                </div>
                <Button className="self-start" pending={downloading === item.type} onClick={() => void download(item.type)}>
                  {downloading !== item.type && <Download aria-hidden="true" className="size-4" />}
                  Download PDF
                </Button>
              </div>
            </Panel>
          ))}
        </div>
      )}
    </>
  );
}
