# 前端 AI 开发准则（`front/`）

本文描述本目录的**工程布局与协作约定**，供人类与 AI 在后续开发中保持一致。修改代码前请先对照本文，避免把文件放到错误层级或引入交叉耦合。

---

## 1. 技术栈

- **Expo** + **React Native** + **expo-router**（文件系统路由）
- **TypeScript**（`strict`）
- 路径别名：`@/`指向 `front/` 根目录（见 `tsconfig.json`）

---

## 2. 三层目录职责（必须遵守）

### `app/` — 路由壳，保持「薄」

- 只负责：**URL ↔ 屏幕**、根 `_layout`、页面级组合与导航。
- 使用 **路由组** 按功能分区，**组名括号不参与 URL**：
  - `app/(auth)/`：未登录流程（如 `login.tsx` → `/login`，`register.tsx` → `/register`）
  - `app/(main)/`：登录后主流程（如 `index.tsx` → `/`）
- **不要**在 `app/` 里堆业务逻辑、复杂状态机或大量 API 细节；应下沉到 `features/`。
- 新增业务域时：优先新增 `app/(<域名>)/` 下的路由文件，与 `features/<域名>/` 对齐。

### `features/` — 按功能域（Feature）封装

- 每个子目录是一整块业务能力（当前有 `features/auth/`）。
-典型内容（按需要组合，不必每一项都有）：
  - `types.ts`：与该域相关的类型、与后端契约的 DTO
  - `api.ts`：该域的 HTTP 封装（内部使用 `shared/api` 的 `request`）
  - `validation.ts`：表单/入参校验（若仅该域使用）
  - `auth-storage.ts` 等：仅该域使用的持久化
  - `*Provider.tsx` 或状态：该域全局状态
  - `components/`：**仅该域使用**的 UI
  - `index.ts`：**对外导出**（供 `app/` 与其它 feature 使用的公共 API）
- **域内**优先使用相对路径（如 `./types`、`./api`），避免通过 `index.ts` 间接引用造成循环依赖。
- **域与域之间**：尽量避免 `features/A` 直接依赖 `features/B` 的实现文件。若必须共享，先评估是否应抽到 `shared/`，或通过 `app/` 组合两个域的接口。

### `shared/` — 跨域基础设施

- 只放**与具体业务无关**、多个 feature 会共用的模块。
- 当前示例：
  - `shared/api.ts`：`API_BASE`、`request`、`ApiError`、环境变量 `EXPO_PUBLIC_API_BASE_URL`
  - `shared/theme.ts`：颜色、圆角、字体等设计 token
- 新增共享能力（如通用 hooks、工具函数、设计系统扩展）时放在此处，**不要**塞进某个 feature 再被其它 feature 引用。

---

## 3. 认证与网络（与现有实现对齐）

- **登录态**：`features/auth/AuthProvider.tsx` + `app/_layout.tsx` 包裹全树；页面通过 `useAuth()` 读取状态。
- **HTTP**：所有后端请求最终走 `shared/api.ts` 的 `request`；各域在自有 `api.ts` 中封装路径与方法。
- **敏感存储**：`features/auth/auth-storage.ts`（SecureStore / Web 降级），其它域勿重复造轮子，除非有独立安全需求。

---

## 4. 环境与配置

- **接口基址**：`front/.env` 中 `EXPO_PUBLIC_API_BASE_URL`；修改后需重启 Metro。
- **Expo 配置**：`app.json`（名称、图标、插件、`experiments.typedRoutes` 等）。
- **类型**：`expo-env.d.ts`；路由类型由 Expo 生成于 `.expo/types/`（勿手改生成文件）。

---

## 5. AI / 协作者开发时的硬性建议

1. **最小改动**：只改与当前任务相关的文件；禁止顺手大重构、删注释、改无关格式。
2. **跟随现有风格**：命名、导出方式、组件结构与同目录已有文件保持一致。
3. **新功能默认路径**：新路由 → `app/(<组>)/`；新业务能力 → `features/<名>/`；真·通用 → `shared/`。
4. **不要**在 `app/` 里复制大段 `features` 已有逻辑；应 import 并组合。
5. **不要**新增未被用户要求的长篇说明文档；本 `AGENTS.md` 与必要的代码内注释即可。
6. 用户要求**简体中文**沟通时，说明与注释以中文为主，代码标识符仍用英文常规命名。

---

## 6. 当前结构速查

```
front/
  app/
    _layout.tsx
    (auth)/login.tsx, register.tsx
    (main)/index.tsx
  features/
    auth/…  shared/
    api.ts, theme.ts
  AGENTS.md          ← 本文  app.json, tsconfig.json, …
```

后续若在仓库根目录另有总览，须与本文不冲突；**以前端开发为准时以 `front/AGENTS.md` 为准**。
