import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '스큐 (SQ)',
  description: '스터디큐브 관리',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
