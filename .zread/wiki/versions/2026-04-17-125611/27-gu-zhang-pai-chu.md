本文档提供了 NewAnki 插件在使用过程中可能遇到的各种问题的解决方案和调试方法。涵盖从数据存储异常到界面显示问题的全方位故障排除指南。

## 数据存储问题

### 卡片数据丢失或损坏

**症状**: 卡片数量显示异常、复习进度丢失、设置重置

**原因分析**: 数据存储可能因以下原因出现问题：
- Obsidian 插件数据存储限制或损坏
- 文件系统权限问题
- 插件版本升级时的数据迁移问题

**解决方案**:
1. **检查插件数据文件**: 在 Obsidian 设置中查看插件数据存储状态
2. **备份当前数据**: 使用 `this.plugin.loadData()` 和 `this.plugin.saveData()` 方法进行数据备份
3. **重置插件数据**: 在插件设置中提供"重置数据"选项，重新初始化默认数据结构

**预防措施**:
- 实现数据完整性检查机制
- 定期自动备份重要数据
- 提供数据迁移工具支持版本升级

Sources: [store.ts](src/store.ts#L13-L28)

### 文件路径变更导致的卡片关联丢失

**症状**: 卡片无法找到源文件、复习时源文件高亮失效

**原因分析**: 当文件被重命名或移动时，卡片数据中的文件路径引用需要同步更新

**解决方案**:
```typescript
// 文件重命名事件处理
async handleFileRename(oldPath: string, newPath: string): Promise<boolean> {
    let changed = false;
    const entries = Object.entries(this.data.cards);
    const oldPrefix = `${oldPath}/`;
    const newPrefix = `${newPath}/`;

    for (const [path, cards] of entries) {
        const isExact = path === oldPath;
        const isChild = path.startsWith(oldPrefix);
        if (!isExact && !isChild) continue;

        const targetPath = isExact ? newPath : path.replace(oldPrefix, newPrefix);
        const migrated = cards.map((c) => ({
            ...c,
            sourceFile: targetPath,
        }));
        // ... 迁移逻辑
    }
    return changed;
}
```

Sources: [store.ts](src/store.ts#L134-L167)

## 算法计算异常

### SM-2 算法间隔计算错误

**症状**: 复习间隔异常、卡片状态转换错误、日期计算不准确

**原因分析**:
- 日期解析错误（`Date.parse()` 返回 NaN）
- 浮点数精度问题
- 边界条件处理不当

**调试方法**:
```typescript
// 检查日期解析有效性
private isCardDue(card: CardData, now: Date): boolean {
    const dueMs = Date.parse(card.due);
    if (Number.isNaN(dueMs)) {
        return false; // 无效日期视为未到期
    }
    // ... 其他逻辑
}
```

**关键检查点**:
1. 验证所有日期字符串的 ISO 格式
2. 检查间隔计算中的数值边界
3. 确保浮点数运算的精度控制

Sources: [sm2.ts](src/sm2.ts#L60-L73)

### 复习状态转换异常

**症状**: 卡片状态停滞、学习步骤无法推进、复习进度异常

**解决方案**:
- 实现状态机完整性检查
- 添加状态转换日志记录
- 提供手动状态重置功能

```typescript
// 状态转换调试日志
export function reviewCard(card: CardData, rating: Rating, settings: PluginSettings): ScheduleResult {
    console.log(`状态转换: ${State[card.state]} -> ${Rating[rating]}`);
    // ... 转换逻辑
    console.log(`新状态: ${State[updated.state]}, 间隔: ${updated.currentInterval}`);
    return { card: updated, rating, reviewDatetime: now };
}
```

Sources: [sm2.ts](src/sm2.ts#L69-L241)

## 用户界面问题

### Markdown 渲染失败

**症状**: 卡片内容显示异常、预览区域空白、渲染错误提示

**原因分析**: Obsidian Markdown 渲染器可能因以下原因失败：
- 源文件不存在或权限问题
- Markdown 语法错误
- 插件冲突

**解决方案**:
```typescript
private async renderPreview(markdown: string): Promise<void> {
    try {
        await MarkdownRenderer.render(this.app, markdown, preview, sourcePath, this);
    } catch (error) {
        // 优雅降级处理
        preview.empty();
        preview.createEl("div", {
            cls: "newanki-preview-error",
            text: "Markdown 预览渲染失败",
        });
        console.error("NewAnki preview render failed:", error);
    }
}
```

**预防措施**:
- 实现渲染重试机制
- 提供纯文本回退显示
- 记录详细的错误信息

Sources: [reviewView.ts](src/reviewView.ts#L213-L244)

### 视图布局和样式问题

**症状**: 复习界面布局错乱、按钮点击无响应、样式丢失

**调试步骤**:
1. **检查 CSS 类名应用**: 确认所有元素正确应用了样式类
2. **验证事件绑定**: 确保按钮点击事件正确绑定
3. **排查 DOM 操作时序**: 避免在渲染过程中进行 DOM 操作

**常见问题**:
- 样式类名冲突：使用 `newanki-` 前缀避免冲突
- 事件监听器泄漏：确保正确清理事件监听器
- 异步操作时序：使用 Promise 和 async/await 管理异步操作

Sources: [reviewView.ts](src/reviewView.ts#L60-L125)

## 插件集成问题

### Obsidian API 调用异常

**症状**: 插件功能部分失效、命令无法执行、界面元素缺失

**原因分析**:
- Obsidian 版本兼容性问题
- API 权限限制
- 其他插件冲突

**解决方案**:
1. **版本兼容性检查**: 在 `manifest.json` 中明确指定兼容的 Obsidian 版本
2. **API 调用错误处理**: 对所有 Obsidian API 调用添加异常捕获
3. **插件冲突检测**: 提供插件冲突检测和解决建议

**调试工具**:
```typescript
// API 调用监控
private async safeAPICall(apiCall: () => Promise<any>): Promise<any> {
    try {
        return await apiCall();
    } catch (error) {
        console.error("Obsidian API call failed:", error);
        new Notice("插件功能暂时不可用，请检查控制台日志");
        return null;
    }
}
```

Sources: [main.ts](src/main.ts#L13-L47)

### 命令和快捷键冲突

**症状**: 快捷键无响应、命令执行异常、功能重复

**排查方法**:
1. **检查命令 ID 唯一性**: 确保所有命令 ID 在插件内唯一
2. **验证快捷键绑定**: 检查是否有其他插件使用相同快捷键
3. **提供自定义配置**: 允许用户重新配置快捷键

**冲突解决**:
- 在插件设置中提供快捷键重新映射功能
- 实现命令执行前的冲突检测
- 提供详细的冲突报告和解决方案

Sources: [main.ts](src/main.ts#L142-L197)

## 性能优化问题

### 大数据量下的性能瓶颈

**症状**: 界面卡顿、操作响应延迟、内存占用过高

**优化策略**:
1. **数据分页加载**: 对大量卡片数据实现分页加载
2. **虚拟滚动**: 在卡片预览界面实现虚拟滚动
3. **缓存优化**: 对频繁访问的数据实现缓存机制

**性能监控**:
```typescript
// 性能监控装饰器
function performanceMonitor(target: any, propertyName: string, descriptor: PropertyDescriptor) {
    const method = descriptor.value;
    descriptor.value = function (...args: any[]) {
        const start = performance.now();
        const result = method.apply(this, args);
        const end = performance.now();
        console.log(`${propertyName} 执行时间: ${end - start}ms`);
        return result;
    };
    return descriptor;
}
```

Sources: [store.ts](src/store.ts#L38-L58)

## 调试和日志系统

### 开发调试工具

**启用调试模式**:
```typescript
// 在插件设置中添加调试开关
interface PluginSettings {
    // ... 其他设置
    enableDebugMode: boolean;
}

// 调试日志函数
function debugLog(...args: any[]) {
    if (this.settings.enableDebugMode) {
        console.log("[NewAnki Debug]", ...args);
    }
}
```

### 错误报告收集

**用户错误报告**:
- 提供一键错误报告功能
- 收集必要的环境信息（Obsidian 版本、插件版本、操作系统）
- 自动生成错误日志摘要

**日志级别控制**:
- ERROR: 严重错误，影响功能使用
- WARN: 警告信息，功能可能受限
- INFO: 一般操作日志
- DEBUG: 详细调试信息

Sources: [main.ts](src/main.ts#L234-L244)

## 常见问题快速参考

| 问题现象 | 可能原因 | 解决方案 |
|---------|---------|---------|
| 卡片数量显示为0 | 数据存储损坏 | 检查插件数据文件，尝试重置数据 |
| 复习界面无法打开 | 视图注册失败 | 重启 Obsidian，检查插件冲突 |
| 卡片内容编辑失效 | Markdown 渲染错误 | 检查源文件权限，尝试重新创建卡片 |
| 快捷键无响应 | 命令冲突 | 重新配置快捷键，检查其他插件 |
| 内存占用过高 | 大数据量未优化 | 启用分页加载，清理无用数据 |

通过系统性的故障排除方法和详细的调试工具，NewAnki 插件能够快速定位和解决各种运行时问题，确保用户获得稳定可靠的学习体验。