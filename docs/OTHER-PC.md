# 在别的电脑上装出同样的「✨ 增强」按钮

核心结论一句话：**按钮不是插件，是改过 app.asar 的本地注入脚本**。所以每台电脑都必须各自执行一次「备份 → 注入 → 重启」。

---

## 0. 三个事实

| 事实 | 含义 |
|---|---|
| 按钮活在 `resources/app.asar` 里 | 换电脑就要重新注入，复制配置解决不了 |
| 反重力每次自动更新会覆盖 app.asar | 更新后按钮消失是正常现象，重跑安装器即可 |
| 插件目录与 app.asar 相互独立 | 只用 `✨/++` 前缀增强的人，可以只装插件不碰 asar |

---

## 1. 前置条件

- Windows 10/11 x64
- **Node.js LTS >= 18**（`node -v` 有输出）：https://nodejs.org/
- Antigravity 桌面端**已启动过一次**（生成 `%USERPROFILE%\.gemini\antigravity`）
- 装在 `C:\Program Files` 需要管理员；装在 `%LOCALAPPDATA%\Programs` 不需要

---

## 2. 三条路线

### 路线 A：一键脚本（推荐）

1. 把 Release zip 或整个仓库拷过去（路径别带中文和空格，例如 `D:\tools\ago`）；
2. 双击 **`oneclick.ps1`**（右键 → 使用 PowerShell 运行）。

它依次执行：清宿主环境变量 → 定位仓库 → 检查/引导安装 Node → 预装 `@electron/asar` → **备份对话存档** → 体检 → 注入 asar → 装插件 → 冻结自动更新 → 启动反重力 → 自检按钮是否出现。

PowerShell 策略拦住时：

```bat
powershell -NoProfile -ExecutionPolicy Bypass -File .\oneclick.ps1
```

完全无人值守（不弹确认、不启动反重力）：

```bat
powershell -NoProfile -ExecutionPolicy Bypass -File .\oneclick.ps1 -Auto -NoLaunch
```

### 路线 B：从 GitHub 拉

```bat
git clone https://github.com/luohaoyan/antigravity-prompt-forge.git D:\tools\ago
cd /d D:\tools\ago
powershell -NoProfile -ExecutionPolicy Bypass -File .\oneclick.ps1
```

### 路线 C：对方装不了 Node

在已装好的机器上生成补丁包，再拷到对方机器，**反重力版本必须一致**：

```powershell
node loader\patch-composer-asar.mjs --out D:\share\app.asar.patched
# 对方机器：
Copy-Item "$env:LOCALAPPDATA\Programs\antigravity\resources\app.asar" "$env:LOCALAPPDATA\Programs\antigravity\resources\app.asar.pre_prompt_optimize.bak"
Copy-Item D:\share\app.asar.patched "$env:LOCALAPPDATA\Programs\antigravity\resources\app.asar" -Force
```

版本不一致 → 选择器失配 → 表现为「没有按钮」或「点了没反应」。

> 汉化是 asar 内自带的 i18n 产物。英文原版 asar 注入后按钮照样出现，但界面仍是英文（本项目不提供汉化包）。

---

## 3. 装完验证

```bat
doctor.bat
```

| 检查项 | 期望 |
|---|---|
| 输入框右下角 | **✨ 增强**，与「请求审核」同一行、在其左侧 |
| 点一下 | 草稿前出现 `✨:enhanced ` 前缀（未配 API Key 的免配置模式） |
| 再点一下 | 变 **↩ 还原**，文本精确恢复 |

---

## 4. 更新后按钮消失

双击 `reinstall-after-update.bat`（先 `--rollback` 再重新注入）。想一劳永逸：

```bat
node installer\install.mjs --freeze-update
```

它把 `resources\app-update.yml` 的 `url` 改成 `http://127.0.0.1:1/disabled/`（原件存为 `.original`），并把 `app_storage.json` 的 `autoCheckForUpdates` 设为 `"false"`。

---

## 5. 多机同步清单

| 项目 | 同步? | 说明 |
|---|---|---|
| `plugin/data/settings.json`（API Key） | 不要 | 明文密钥，别进云盘/仓库；每台右键 ✨ 各自填 |
| `~/.gemini/antigravity/conversations` | 视需要 | 与按钮无关，想搬对话就整目录复制 |
| `resources/app.asar` | 仅同版本 | 同版本可直接拷；否则重新注入 |
| 仓库目录 | 可以 | 脚本与 widget 通用 |

---

## 6. 一句话版

> 解压 → 双击 `oneclick.ps1` → 等反重力重启 → 看输入框右下角有没有 ✨ 增强。

失败就把 `doctor.bat` 的输出贴出来。
