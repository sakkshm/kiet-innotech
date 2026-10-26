import type { CertificateTemplate } from "./admin-types";

export function certificateDownloadName(template: CertificateTemplate) {
  return `innotech26-${template.type}.pdf`;
}
