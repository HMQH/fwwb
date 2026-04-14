# 仓库开发指引

## 项目结构与模块划分
本仓库分为 `front/`（Expo + React Native）与 `backend/`（FastAPI）。`front/app/` 存放 expo-router 页面；`front/features/` 按功能分包（如 `auth/`）；`front/shared/` 存放跨功能工具（如 `api.ts`、`theme.ts`）。`backend/app/api/routes/` 暴露接口；`backend/app/domain/` 包含业务逻辑与仓储；`backend/app/shared/` 包含配置、数据库与 schemas。认证相关库表可用 `backend/sql/init_auth.sql` 初始化。`文档/` 为项目文档；`others/` 为参考资料，非线上运行代码。前端更细的约定另见 `front/AGENTS.md`。

## 新增功能时的目录约定
- **前端**：加新功能时，在 `front/app/` 下为该功能**新建独立文件夹**（路由与页面），并在 `front/features/` 下**再建一组对应该功能的文件夹**（屏幕、组件、业务逻辑等）。**一个功能对应各自目录下的一组文件夹**，不要把多个无关功能混在同一目录里；名称建议与功能一致，便于前后对照。
- **后端**：在 `backend/app/api` 与 `backend/app/domain` 下同样按功能拆分。**一项功能一套目录/模块**：领域层在 `backend/app/domain/<功能名>/`（如现有的 `user/`、`detection/`）下放 `service`、`repository` 等；HTTP 层在 `backend/app/api` 侧为该项功能增加独立路由模块（一般为 `backend/app/api/routes/` 下的独立文件，或按需再分子目录），勿把多业务路由与领域代码堆在同一模块里。

## 构建、测试与开发命令
- `cd front && npm install`：安装前端依赖。
- `cd front && npm start`：启动 Metro；可用 `npm run android`、`npm run ios` 或 `npm run web` 指定目标平台。
- `cd front && npm run lint`：运行 Expo ESLint。
- `cd backend && python -m venv .venv && .\.venv\Scripts\Activate.ps1 && pip install -r requirements.txt`：创建并安装后端虚拟环境（PowerShell）。
- `cd backend && uvicorn main:app --reload --host 0.0.0.0 --port 8000`：本地启动 API。
- `curl http://127.0.0.1:8000/health` 与 `/health/db`：快速检查后端与数据库连通性。
电脑上开启adb reverse tcp:8081 tcp:8081
adb reverse tcp:8000 tcp:8000 手机转发

## 代码风格与命名
优先小范围、局部修改。TypeScript 为 `strict`，沿用现有风格：2 空格缩进、双引号、分号；组件 PascalCase（如 `AuthProvider.tsx`），工具/hooks 用 camelCase。Python 遵循 PEP 8：4 空格缩进，模块与函数 snake_case，并写清类型注解。FastAPI 路由文件保持精简；业务规则放在 `domain/*/service.py`。真正共用的代码放在 `front/shared/` 或 `backend/app/shared/`，避免无关功能之间互相 import。


不要大段营销文案,同步改成 App 卡片流，避免你下次一进去又看到“网页感”布局

