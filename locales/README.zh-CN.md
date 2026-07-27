[English](../README.md) | 简体中文 | [Русский](README.ru.md)
# EasyEDA Copilot
适用于 EasyEDA Pro 和 JLCEDA 的 AI 助手。支持通过自然语言生成原理图、完善现有电路、根据需求搜索 LCSC 元器件、运行 SPICE 仿真，并可在 EDA 工作流中直接复用经过验证的电路模块。

<p align="center">
<a href="https://github.com/biosshot/easyeda-copilot/releases/latest">
<img src="https://img.shields.io/github/v/release/biosshot/easyeda-copilot?label=release" alt="Latest release">
</a>
<a href="https://github.com/biosshot/easyeda-copilot/blob/main/LICENSE">
<img src="https://img.shields.io/badge/license-MIT-blue" alt="License">
</a>
<a href="https://discord.gg/AXCGjTDYkq">
<img src="https://img.shields.io/badge/Discord-7289DA?logo=discord&logoColor=white" alt="Discord">
</a>
</p>

<p align="center">
<img src="https://raw.githubusercontent.com/biosshot/easyeda-copilot/refs/heads/main/docs/media/main.png" alt="EasyEDA Copilot interface">
</p>

## 核心功能
EasyEDA Copilot 为 EasyEDA Pro 引入了全新的 AI 设计层：
- **文本生成电路**：描述您需要的电路，让 AI 代理为您生成原理图方案。
- **完善现有原理图**：附加选定的电路片段，让 Copilot 添加、替换或连接器件。
- **搜索 LCSC 元器件**：通过自然语言描述需求和电气特性来查找元器件。
- **使用可复用模块**：插入经过验证的标准子电路，如稳压器、接口和保护电路模块。
- **解释与分析电路**：探讨原理图行为、信号流向以及设计权衡。
- **运行 SPICE 仿真**：对支持的电路进行仿真，并在采信结果前检查所选用的模型。
- **通过 MCP 设计 PCB**：生成元件布局、组装电路板、进行布线、检查结果，并通过 MCP 客户端运行 DRC（设计规则检查）。

更多示例请访问 [Oshwlab](https://oshwlab.com/biosshot/edacopilotexamples)。

## 安装
从 [Releases](https://github.com/biosshot/easyeda-copilot/releases/latest) 下载最新的 `.eext` 安装包。

在 EasyEDA Pro 中：
1. 打开 `设置 -> 扩展 -> 扩展管理器` (`Settings -> Extensions -> Extensions Manager`)。
2. 点击 `导入扩展` (`Import Extensions`)。
3. 选择下载好的 `.eext` 文件。
4. 允许 `外部交互` (`External Interactions`)。
5. 打开原理图，使用 `Copilot -> 界面` (`Copilot -> Interface`)。

## MCP 服务器
EasyEDA Copilot 可以连接到外部 MCP 客户端。该扩展每 5 秒扫描一次 `ws://127.0.0.1:8787`，并在您的 MCP 服务器可用时进行连接。`Copilot -> MCP` 菜单项可暂停或恢复此扫描。

Codex:
```bash
codex mcp add easyeda-copilot -- npx easyeda-copilot-mcp
```

Claude Code:

```bash
claude mcp add easyeda-copilot -- npx easyeda-copilot-mcp
```

推荐操作步骤：

1. 将 MCP 服务器添加到您的代理中。
2. 启动 Codex、Claude Code 或其他启用了此 MCP 服务器的 MCP 客户端。
3. 在 EasyEDA Pro 中打开原理图。
4. EasyEDA Copilot 将自动连接。仅在需要暂停或恢复扫描时使用 `Copilot -> MCP`。

请参阅  [README к пакету MCP](mcp/README.md)

## PCB 工作流（仅限 MCP

PCB 布局功能仅可通过 Codex 或 Claude Code 等外部 MCP 客户端使用。内置的 Copilot 聊天窗口不支持此功能。

MCP 会生成布局信息：板框轮廓、机械约束、元器件、安装孔、焊盘和位号位置。请先查看机械预览，确认最终布局后，再将其导入 EasyEDA。组装完成后，MCP 可运行内置的自动布线器、检查 PCB 对象，并在打开的桌面版文档上运行 EasyEDA DRC。

PCB 组装、预览以及客户端布线支持已在 **EasyEDA Desktop V3.2.149** 版本中验证通过。

### RP2040 开发板：Copilot 与 Quilter

<p align="center">
  <img src="https://raw.githubusercontent.com/biosshot/easyeda-copilot/refs/heads/main/docs/media/pcb-examples/rp2040_copilot_top.png" alt="RP2040 Copilot, top layer" width="48%">
  <img src="https://raw.githubusercontent.com/biosshot/easyeda-copilot/refs/heads/main/docs/media/pcb-examples/rp2040_quiliter_top.png" alt="RP2040 Quilter, top layer" width="48%">
</p>
<p align="center">
  <img src="https://raw.githubusercontent.com/biosshot/easyeda-copilot/refs/heads/main/docs/media/pcb-examples/rp2040_copilot_bot.png" alt="RP2040 Copilot, bottom layer" width="48%">
  <img src="https://raw.githubusercontent.com/biosshot/easyeda-copilot/refs/heads/main/docs/media/pcb-examples/rp2040_quiliter_bot.png" alt="RP2040 Quilter, bottom layer" width="48%">
</p>

### Duck 紧凑型开发板：Copilot 与 Quilter

<p align="center">
  <img src="https://raw.githubusercontent.com/biosshot/easyeda-copilot/refs/heads/main/docs/media/pcb-examples/pico_duck_copilot_top.png" alt="PICO Duck Copilot, top layer" width="48%">
  <img src="https://raw.githubusercontent.com/biosshot/easyeda-copilot/refs/heads/main/docs/media/pcb-examples/pico_duck_quilter_top.png" alt="PICO Duck Quilter, top layer" width="48%">
</p>
<p align="center">
  <img src="https://raw.githubusercontent.com/biosshot/easyeda-copilot/refs/heads/main/docs/media/pcb-examples/pico_duck_copilot_bot.png" alt="PICO Duck Copilot, bottom layer" width="48%">
  <img src="https://raw.githubusercontent.com/biosshot/easyeda-copilot/refs/heads/main/docs/media/pcb-examples/pico_duck_quilter_bot.png" alt="PICO Duck Quilter, bottom layer" width="48%">
</p>

### ESPower 开发板：Copilot 与 Quilter

<p align="center">
  <img src="https://raw.githubusercontent.com/biosshot/easyeda-copilot/refs/heads/main/docs/media/pcb-examples/espower_copilot_top.png" alt="ESPower Copilot, top layer" width="48%">
  <img src="https://raw.githubusercontent.com/biosshot/easyeda-copilot/refs/heads/main/docs/media/pcb-examples/espower_quiliter_top.png" alt="ESPower Quilter, top layer" width="48%">
</p>
<p align="center">
  <img src="https://raw.githubusercontent.com/biosshot/easyeda-copilot/refs/heads/main/docs/media/pcb-examples/espower_copilot_bot.png" alt="ESPower Copilot, bottom layer" width="48%">
  <img src="https://raw.githubusercontent.com/biosshot/easyeda-copilot/refs/heads/main/docs/media/pcb-examples/espower_quiliter_bot.png" alt="ESPower Quilter, bottom layer" width="48%">
</p>

## 兼容性

| EasyEDA Pro  版本   | 状态       |
| ------------------- | --------- |
| Desktop V3.2.149    | 已验证     |
| Desktop V2.2.45     | 已验证     |
| Desktop V2.2.47     | 已验证     |

## 特性

### 原理图生成

通过自然语言描述生成原理图。Copilot 可以规划电路、搜索元器件、生成结构化结果，并在原理图生成就绪时提供 `组装电路` (`Assemble circuit`) 操作。

<p align="center">
  <img src="https://raw.githubusercontent.com/biosshot/easyeda-copilot/refs/heads/main/docs/media/use-reused.gif" alt="Generate a circuit with reusable blocks">
</p>

### 电路补全

在现有原理图片段上使用 Copilot。您可以让它补全缺失的模块、添加元器件、连接信号，或基于选定的电路上下文提出修改建议。

<p align="center">
  <img src="https://raw.githubusercontent.com/biosshot/easyeda-copilot/refs/heads/main/docs/media/circuit-compl-ex1.gif" alt="Circuit completion example 1" width="48%">
  <img src="https://raw.githubusercontent.com/biosshot/easyeda-copilot/refs/heads/main/docs/media/circuit-compl-ex2.gif" alt="Circuit completion example 2" width="48%">
</p>

### 元器件选型

通过意图在 LCSC 中搜索元器件，无需手动调整目录过滤器。示例：

- `find 5V relay`
- `Find DC-DC chip 5V and 10A current`
- `find capacitor 22uF Murata SMD 1210`

<p align="center">
  <img src="https://raw.githubusercontent.com/biosshot/easyeda-copilot/refs/heads/main/docs/media/comp-search-ex1.png" alt="Find 5V relay" width="31%">
  <img src="https://raw.githubusercontent.com/biosshot/easyeda-copilot/refs/heads/main/docs/media/comp-search-ex2.png" alt="Find DC-DC chip 5V and 10A current" width="31%">
  <img src="https://raw.githubusercontent.com/biosshot/easyeda-copilot/refs/heads/main/docs/media/comp-search-ex3.png" alt="Find capacitor 22uF Murata SMD 1210" width="31%">
</p>

### 可复用模块

可复用模块是经过审查的原理图片段，AI 代理可以对其进行调整并插入到生成的电路中。它们非常适合拓扑结构稳定、仅端口或被动元件参数发生变化的标准子电路。

请参阅 [可复用模块文档](docs/reusable-blocks.md).

### SPICE 仿真

Copilot 可以运行 SPICE 仿真，并自动从元器件模型库中选择合适的模型。

请务必验证用于替换元器件的 SPICE 模型。仿真完成后，所选模型将显示在图表下方

<p align="center">
  <img src="https://raw.githubusercontent.com/biosshot/easyeda-copilot/refs/heads/main/docs/media/spice.gif" alt="SPICE simulation">
</p>

## 文档

- [设置](docs/settings.md)
- [将电路附加到 AI 代理](docs/attaching-circuits.md)
- [由 AI 代理组装电路](docs/assembling-circuits.md)
- [可复用模块](docs/reusable-blocks.md)
