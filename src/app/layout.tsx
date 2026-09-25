import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import logo from "./icon.png";
import ServiceAssistant, { WorkspaceNav } from "@/components/ServiceAssistant";
import "./globals.css";
export const metadata: Metadata = {
  title: "虚拟工程师 · 微控制器实验工作区",
  description: "教师复核指导、实验修订与学习记录",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body>
        <a href="#main-content" className="skip-link">跳到工作区</a>
        <header className="app-header">
          <div className="header-inner">
            <Link href="/" className="brand">
              <span className="brand-mark" aria-hidden="true">
                <Image src={logo} alt="" width={42} height={42} sizes="42px" priority />
              </span>
              虚拟工程师
            </Link>
            <span className="header-caption">
              微控制器原理及应用技术 · 实验工作区
            </span>
            <WorkspaceNav />
          </div>
        </header>
        <main id="main-content" className="app-main">
          {children}
        </main>
        <footer className="app-footer">
          实验观察 · 教师指导 · 验证修订
          <span className="muted">
            　｜　技术结论以已确认的实验参数与实际验证为依据
          </span>
        </footer>
        <ServiceAssistant />
      </body>
    </html>
  );
}
