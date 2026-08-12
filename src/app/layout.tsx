import type { Metadata } from "next";
import { Archivo, Spectral } from "next/font/google";
import "./globals.css";

const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

const spectral = Spectral({
  variable: "--font-spectral",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
  style: ["normal", "italic"],
});

export const metadata: Metadata = {
  title: "mrkos.ai — Your Stoic Companion",
  description: "Voice-only AI companion embodying Marcus Aurelius",
  icons: {
    icon: "/favicon-android.png",
    apple: "/favicon-iphone.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${archivo.variable} ${spectral.variable} font-sans antialiased`}>
        {children}
      </body>
    </html>
  );
}
