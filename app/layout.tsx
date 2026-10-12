//wraps all of our code
import type { Metadata } from "next";
import {Inter} from "next/font/google"
import "./globals.css";
import {ClerkProvider} from "@clerk/nextjs"
import Header from "@/components/header.jsx"
import { Toaster } from "sonner";

const inter=Inter({subsets:["latin"]});

export const metadata: Metadata = {
  title: "WealthWise — AI Personal Finance & Split Expenses",
  description:
    "Track income and spending across accounts, scan receipts with AI, set budgets, and split expenses with friends on a decimal-safe shared ledger.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ClerkProvider>
    <html lang="en">
      <body
        className={`${inter.className}`}
      >
        <Header />
       <main className="min-h-screen">{children}</main> 
       <Toaster richColors/>
        <footer className="bg-blue-50 py-12">
          <div className="container mx-auto px-4 text-center text-gray-600">
            <p>Made by Ayush Jangid</p>
          </div>
        </footer>
      </body>
    </html>
    </ClerkProvider>
  );
}
