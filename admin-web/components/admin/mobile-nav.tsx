"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { LayoutDashboard, BookOpen, FolderSearch, MessageSquareWarning } from "lucide-react"
import { cn } from "@/lib/utils"

const ITEMS = [
  { href: "/admin", label: "概览", icon: LayoutDashboard, exact: true },
  { href: "/admin/knowledge", label: "知识库", icon: BookOpen },
  { href: "/admin/cases", label: "案例", icon: FolderSearch },
  { href: "/admin/feedback", label: "反馈", icon: MessageSquareWarning },
]

export function MobileNav() {
  const pathname = usePathname()
  return (
    <nav
      aria-label="移动端导航"
      className="md:hidden fixed bottom-0 inset-x-0 z-30 border-t border-border bg-background/95 backdrop-blur"
    >
      <ul className="grid grid-cols-4">
        {ITEMS.map((item) => {
          const active = item.exact ? pathname === item.href : pathname.startsWith(item.href)
          const Icon = item.icon
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                className={cn(
                  "flex flex-col items-center justify-center gap-1 py-2.5 text-[11px]",
                  active ? "text-primary" : "text-muted-foreground",
                )}
              >
                <Icon className="h-5 w-5" />
                {item.label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
