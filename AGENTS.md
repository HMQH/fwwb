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
- 后端环境使用`conda activate fraud`激活
- `cd backend && uvicorn main:app --reload --host 0.0.0.0 --port 8000`：本地启动 API。
- `curl http://127.0.0.1:8000/health` 与 `/health/db`：快速检查后端与数据库连通性。
- 电脑上开启 `adb reverse tcp:8081 tcp:8081`
- 电脑上开启 `adb reverse tcp:8000 tcp:8000`：手机转发

## 代码风格与命名
优先小范围、局部修改。TypeScript 为 `strict`，沿用现有风格：2 空格缩进、双引号、分号；组件 PascalCase（如 `AuthProvider.tsx`），工具/hooks 用 camelCase。Python 遵循 PEP 8：4 空格缩进，模块与函数 snake_case，并写清类型注解。FastAPI 路由文件保持精简；业务规则放在 `domain/*/service.py`。真正共用的代码放在 `front/shared/` 或 `backend/app/shared/`，避免无关功能之间互相 import。

## 前端展示约束
- 不要大段营销文案，同步改成 App 卡片流，避免一进去又看到“网页感”布局。
- 前端不要出现描述性小字、说明性长句、解释性段落；界面只保留必要标签、数据、按钮与结果。
- 推理图、流程图必须是真正的节点连线图或阶段动画，不要用静态文案、假图、纯列表替代。
- 不做“网页感”大横幅、大段说明区，优先卡片化、分段、移动端友好的信息密度。
- 文案要短、直接、可操作；避免“系统会先……再……”这类解释性句子。

## 前端导航硬规则（新增，强制）
- **从“我的”页进入的一层功能页**（如 `用户画像`、`上传管理`、`关系记忆`、`监护人`），左上返回**不能**使用 `router.back()` 作为默认实现。
- 原因：这些页面挂在 `Tabs` 体系下，`router.back()` 依赖历史栈，**很容易错误返回到首页**或其他页面，而不是“我的”页。
- 这类页面的返回必须**显式**指向 `"/profile"`，优先使用：
  - `router.replace("/profile")`
  - 或在明确需要保留栈时使用 `router.push("/profile")`
- **二级详情页**（例如 `关系详情`、`监护联动详情`、`上传归档`）如果其上一级就是对应功能首页，则可以使用 `router.back()` 返回上一层；不要把这个规则误套到“我的”页进入的一层功能页。
- 只要需求里出现“从我的页进入后，返回应回到我的页”，就默认检查并修正：
  - 页面左上返回按钮
  - 成功操作后的跳转 / replace
  - Android 实体返回的预期路径
  - 底边栏隐藏后是否仍存在错误回首页的问题

## 编码、文案与占位符安全
- 所有中文文件必须使用 UTF-8；前端 `ts/tsx` 优先使用 UTF-8 无 BOM，禁止用会把中文写成 `????` 的编码保存。
- 任何面向用户的文本，禁止提交 `?`、`??`、`???` 这类占位符；包括：
  - 前端页面标题、按钮、卡片标签、空态
  - 后端 fallback `summary` / `advice` / `final_reason`
  - 推理图节点名、链路标签、管线步骤名
  - 数据库初始化、测试数据、演示数据中的显示文案
- 搜索问号占位时，要区分真正的脏文案与语法符号，不能误伤 TypeScript 的 `??`、`?.`、可选属性 `?:`。
- 如果页面文字来自后端或数据库，不能只改前端；必须同时检查：
  - 前端静态文案
  - 后端返回字段
  - 历史库里的脏数据
  - 前端对历史脏标签的兜底清洗
- 控制台若出现中文乱码，先确认是终端编码问题还是文件实际损坏；不要只凭 PowerShell 输出判断源码已坏。
- 改完后至少执行：
  - `cd front && npx tsc --noEmit`
  - `cd front && npm run lint`
  - `python -m py_compile backend\\app\\domain\\detection\\analyzer.py backend\\app\\domain\\detection\\service.py`
- 提交前对 `front/app`、`front/features`、`front/shared`、`backend/app` 做一轮用户文案扫描，确保没有残留 `??` 占位。

## 中文编码硬规则（新增，强制）
- **优先使用 `apply_patch` 修改含中文的源码、配置、Markdown。**
- **禁止**用 PowerShell 的 `Set-Content`、`Out-File`、重定向 `>`、`>>` 直接写入含中文的 `ts` / `tsx` / `md` / `json` / `py` 文件，除非已经明确指定 UTF-8 且验证结果正确。
- **禁止**通过 shell heredoc、PowerShell here-string 直接整段覆盖中文源码内容后立即提交；这类操作最容易把中文写成 `????`、乱码或混入 BOM。
- 如果必须用脚本写文件，只能显式使用 UTF-8，例如 Python `Path.write_text(text, encoding="utf-8", newline="\\n")`，并在写后立刻复查。
- 修改中文文件后，必须额外检查两件事：
  - 文件开头不能有 BOM
  - 用户可见文案里不能出现 `????`、`???`、单独异常的 `?`
- 若发现中文已经被写坏，**先修复编码，再继续开发**；不能带着乱码继续叠加修改。
- `AGENTS.md`、`front/app`、`front/features`、`front/shared`、`backend/app` 属于中文高风险区域；修改后必须优先复查。

