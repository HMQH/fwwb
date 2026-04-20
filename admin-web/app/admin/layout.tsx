"use client"

import type React from "react"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { AdminSidebar } from "@/components/admin/sidebar"
import { AdminTopbar } from "@/components/admin/topbar"
import { MobileNav } from "@/components/admin/mobile-nav"
import { useAdminSession } from "@/components/admin/admin-session-provider"
import { Spinner } from "@/components/ui/spinner"

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const { status } = useAdminSession()

  useEffect(() => {
    if (status === "unauthenticated") {
      router.replace("/login")
    }
  }, [router, status])

  if (status !== "authenticated") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="inline-flex items-center gap-3 rounded-full border border-border bg-card px-4 py-2 text-sm text-muted-foreground">
          <Spinner className="size-4" />
          正在进入后台
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      <AdminSidebar />
      <div className="flex min-h-screen flex-col min-w-0 md:ml-60">
        <AdminTopbar />
        <main className="flex-1 p-4 md:p-6 pb-24 md:pb-6">{children}</main>
      </div>
      <MobileNav />
    </div>
  )
}
