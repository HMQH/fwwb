"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { BookOpen, FolderSearch, LayoutDashboard, MessageSquareWarning, Shield } from "lucide-react"
import { cn } from "@/lib/utils"

const NAV_ITEMS = [
  { href: "/admin", label: "可视化展示", icon: LayoutDashboard, exact: true },
  { href: "/admin/knowledge", label: "知识库管理", icon: BookOpen },
  { href: "/admin/cases", label: "案例管理", icon: FolderSearch },
  { href: "/admin/feedback", label: "用户反馈", icon: MessageSquareWarning },
]

export function AdminSidebar() {
  const pathname = usePathname()

  return (
    <aside className="hidden border-r border-sidebar-border bg-sidebar md:fixed md:inset-y-0 md:left-0 md:z-30 md:flex md:w-60 md:flex-col">
      <div className="flex h-16 items-center gap-3 border-b border-sidebar-border px-5">
        <div className="flex h-8 w-8 items-center justify-center rounded-md border border-primary/30 bg-primary/15">
          <Shield className="h-4 w-4 text-primary" />
        </div>
        <div className="leading-tight">
          <p className="text-sm font-semibold text-sidebar-foreground">守望反诈</p>
          <p className="text-[11px] text-muted-foreground">管理后台</p>
        </div>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto p-3" aria-label="主导航">
        <p className="px-3 py-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">管理</p>
        {NAV_ITEMS.map((item) => {
          const active = item.exact ? pathname === item.href : pathname.startsWith(item.href)
          const Icon = item.icon
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-md border px-3 py-2 text-sm transition-colors",
                active
                  ? "border-sidebar-border bg-sidebar-accent text-sidebar-accent-foreground"
                  : "border-transparent text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
              )}
            >
              <Icon className={cn("h-4 w-4", active ? "text-primary" : "")} />
              <span>{item.label}</span>
            </Link>
          )
        })}
      </nav>

      <div className="border-t border-sidebar-border p-4">
        <div className="rounded-lg border border-sidebar-border bg-sidebar-accent/60 p-3">
          <p className="text-xs font-medium text-sidebar-foreground">系统状态</p>
          <div className="mt-2 flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-chart-4 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-chart-4" />
            </span>
            <span className="text-xs text-muted-foreground">运行正常 · v1.0.3</span>
          </div>
        </div>
      </div>
    </aside>
  )
}
