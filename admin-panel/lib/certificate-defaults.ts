import type { CertificateField, CertificateKind, CertificateScope, CertificateType } from "./admin-types";

export const CERTIFICATE_TYPES: CertificateType[] = [
  "dept_judge",
  "dept_participation",
  "dept_winner",
  "institute_judge",
  "institute_participation",
  "institute_winner",
];

export const certificateLabels: Record<CertificateType, string> = {
  dept_judge: "Department · Judge",
  dept_participation: "Department · Participation",
  dept_winner: "Department · Winner",
  institute_judge: "Institute · Judge",
  institute_participation: "Institute · Participation",
  institute_winner: "Institute · Winner",
};

export const certificateSources = [
  "recipient_name",
  "team_name",
  "team_code",
  "department",
  "category",
  "project_title",
  "place",
  "award_amount",
  "organisation",
];

export function certificateScope(type: CertificateType): CertificateScope {
  return type.startsWith("dept_") ? "department" : "institute";
}

export function certificateKind(type: CertificateType): CertificateKind {
  return type.replace(/^(dept|institute)_/, "") as CertificateKind;
}

export function defaultFields(type: CertificateType): CertificateField[] {
  const fields: CertificateField[] = [
    {
      id: "name",
      label: "recipient_name",
      xPt: 150,
      yPt: 300,
      wPt: 542,
      hPt: 32,
      font: "Montserrat",
      fontsize: 26,
      color: "#0b1f3a",
      align: 1,
      rotation: 0,
      lineheight: 1.2,
      defaultText: "",
      sourceKey: "recipient_name",
    },
  ];
  if (certificateKind(type) === "winner") {
    fields.push({
      id: "category",
      label: "category",
      xPt: 485,
      yPt: 333,
      wPt: 180,
      hPt: 20,
      font: "Montserrat",
      fontsize: 13,
      color: "#0b1f3a",
      align: 1,
      rotation: 0,
      lineheight: 1.2,
      defaultText: "",
      sourceKey: "category",
    });
  }
  return fields;
}
