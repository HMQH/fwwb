"use client"

import type React from "react"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Shield, Phone, Lock, Loader2 } from "lucide-react"
import { useAdminSession } from "@/components/admin/admin-session-provider"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { loginAdmin } from "@/lib/admin-api"

export default function LoginPage() {
  const router = useRouter()
  const { setSession, status } = useAdminSession()
  const [phone, setPhone] = useState("")
  const [password, setPassword] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (status === "authenticated") {
      router.replace("/admin")
    }
  }, [router, status])

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)

    if (!/^1\d{10}$/.test(phone)) {
      setError("请输入 11 位手机号")
      return
    }

    if (!password.trim()) {
      setError("请输入密码")
      return
    }

    setLoading(true)
    try {
      const payload = await loginAdmin(phone, password)
      setSession(payload)
      router.replace("/admin")
    } catch (caughtError) {
      const message = caughtError instanceof Error ? caughtError.message : "登录失败"
      setError(message)
    } finally {
      setLoading(false)
    }
  }

  if (status === "loading") {
    return (
      <main className="min-h-screen flex items-center justify-center bg-background">
        <div className="inline-flex items-center gap-3 rounded-full border border-border bg-card px-4 py-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          正在检查登录状态
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-background relative overflow-hidden px-4">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-[0.07]"
        style={{
          backgroundImage:
            "linear-gradient(to right, var(--color-foreground) 1px, transparent 1px), linear-gradient(to bottom, var(--color-foreground) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
        }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-32 left-1/2 -translate-x-1/2 h-[420px] w-[680px] rounded-full blur-3xl opacity-20"
        style={{ background: "var(--color-primary)" }}
      />

      <div className="relative w-full max-w-md">
        <div className="flex items-center gap-3 mb-8">
          <div className="h-10 w-10 rounded-lg bg-primary/15 border border-primary/30 flex items-center justify-center">
            <Shield className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-foreground leading-none">守望反诈</h1>
            <p className="text-xs text-muted-foreground mt-1">管理后台</p>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-8 shadow-xl shadow-primary/5">
          <div className="mb-6">
            <h2 className="text-2xl font-semibold text-card-foreground">管理员登录</h2>
            <p className="text-sm text-muted-foreground mt-2">手机号 + 密码</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="phone" className="text-sm text-foreground">
                手机号
              </Label>
              <div className="relative">
                <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="phone"
                  type="tel"
                  inputMode="numeric"
                  maxLength={11}
                  placeholder="请输入手机号"
                  value={phone}
                  onChange={(event) => setPhone(event.target.value.replace(/\D/g, ""))}
                  className="pl-9 bg-input/60 border-border h-11"
                  autoComplete="tel"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="password" className="text-sm text-foreground">
                密码
              </Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="password"
                  type="password"
                  placeholder="请输入密码"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="pl-9 bg-input/60 border-border h-11"
                  autoComplete="current-password"
                />
              </div>
            </div>

            {error ? (
              <div role="alert" className="text-sm text-destructive bg-destructive/10 border border-destructive/30 rounded-md px-3 py-2">
                {error}
              </div>
            ) : null}

            <Button type="submit" disabled={loading} className="w-full h-11 font-medium">
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  登录中
                </>
              ) : (
                "登录"
              )}
            </Button>
          </form>
        </div>
      </div>
    </main>
  )
}
