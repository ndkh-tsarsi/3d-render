import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Cat Defense · Game Lab',
  description: 'A standalone HTML5 game controlled by its React host through the Cat Defense iframe SDK.',
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
