import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans, Space_Grotesk } from "next/font/google";
import "./globals.css";

const bodyFont = Plus_Jakarta_Sans({
  variable: "--font-body",
  subsets: ["latin"],
});

const headingFont = Space_Grotesk({
  variable: "--font-heading",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "InnoTech26 | KIET Annual Technical Fest",
  description:
    "InnoTech26 at KIET Deemed to be University, 30 October 2026. Building an Innovative, Secure and Sustainable Viksit Bharat @2047. Eight categories, no registration fee.",
};

export const viewport: Viewport = {
  themeColor: "#292b38",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${bodyFont.variable} ${headingFont.variable} antialiased`}
      suppressHydrationWarning
    >
      <head>
        {/* Marks that JavaScript is running so scroll-reveal styles can safely hide content. */}
        <script dangerouslySetInnerHTML={{ __html: "document.documentElement.classList.add('js')" }} />
      </head>
      <body className="min-h-screen font-sans">{children}</body>
    </html>
  );
}
