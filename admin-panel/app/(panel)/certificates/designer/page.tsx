import type { Metadata } from "next";
import { Suspense } from "react";
import { CertificateDesigner } from "@/components/certificates/CertificateDesigner";
import { Loading } from "@/components/ui/Notice";

export const metadata: Metadata = { title: "Certificate designer" };

export default function CertificateDesignerPage() {
  return (
    <Suspense fallback={<Loading label="Loading designer" />}>
      <CertificateDesigner />
    </Suspense>
  );
}
