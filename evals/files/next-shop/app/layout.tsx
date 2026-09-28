import type { ReactNode } from 'react';

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header>
          <a href="/">Example Shop</a>
          {/* cart link goes here */}
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
