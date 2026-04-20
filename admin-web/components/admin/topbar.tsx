"use client"

import { useRouter, usePathname } from "next/navigation"
import { Bell, LogOut, Search, User } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { useAdminSession } from "@/components/admin/admin-session-provider"

const TITLES: Record<string, string> = {
  "/admin": "可视化展示",
  "/admin/knowledge": "知识库管理",
  "/admin/cases": "案例管理",
  "/admin/feedback": "用户反馈",
}

export function AdminTopbar() {
  const router = useRouter()
  const pathname = usePathname()
  const { clearSession, user } = useAdminSession()
  const title = TITLES[pathname] ?? "管理后台"
  const fallback = user?.display_name?.trim()?.slice(0, 1) || "管"
  const phone = user?.phone && user.phone.length === 11 ? `${user.phone.slice(0, 3)}****${user.phone.slice(-4)}` : user?.phone || "--"

  const handleLogout = () => {
    clearSession()
    router.replace("/login")
  }

  return (
    <header className="h-16 shrink-0 border-b border-border bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-20">
      <div className="h-full px-4 md:px-6 flex items-center gap-4">
        <div className="flex-1 min-w-0">
          <h1 className="text-base md:text-lg font-semibold text-foreground truncate">{title}</h1>
        </div>

        <div className="hidden lg:flex items-center gap-2 h-9 px-3 rounded-md border border-border bg-card text-sm text-muted-foreground w-72">
          <Search className="h-4 w-4" />
          <span className="text-xs">快捷搜索…</span>
          <kbd className="ml-auto text-[10px] bg-muted px-1.5 py-0.5 rounded border border-border">⌘K</kbd>
        </div>

        <Button
          variant="ghost"
          size="icon"
          aria-label="通知"
          className="relative text-muted-foreground hover:text-foreground"
        >
          <Bell className="h-4 w-4" />
          <span className="absolute top-2 right-2 h-1.5 w-1.5 rounded-full bg-destructive" />
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="flex items-center gap-2 h-9 pl-1 pr-3 rounded-full hover:bg-accent transition-colors"
              aria-label="管理员菜单"
            >
              <Avatar className="h-7 w-7">
                <AvatarFallback className="bg-primary/20 text-primary text-xs font-medium">{fallback}</AvatarFallback>
              </Avatar>
              <span className="hidden sm:inline text-sm text-foreground">{user?.display_name || "管理员"}</span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>
              <div className="flex flex-col gap-0.5">
                <span className="text-sm text-foreground">{user?.display_name || "管理员"}</span>
                <span className="text-xs text-muted-foreground">{phone}</span>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem>
              <User className="h-4 w-4" />
              个人资料
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleLogout} className="text-destructive focus:text-destructive">
              <LogOut className="h-4 w-4" />
              退出登录
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}
