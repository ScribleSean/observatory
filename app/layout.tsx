import type { Metadata } from 'next';
import './globals.css';
import './observatory.css';

export const metadata: Metadata = {
  title: 'Observatory',
  description: 'A lightweight local workspace monitor for activity, AI usage and dictation.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" data-theme="dark">
      <body className="antialiased">{children}</body>
    </html>
  );
}
