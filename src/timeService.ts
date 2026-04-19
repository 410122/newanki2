// 时间服务中心化模块
// 提供统一的时间获取接口，支持在线（真实时间）和离线（模拟时间）两种模式

import { TIME_MODE, MOCK_TIME } from './config/time';

export interface TimeService {
    /** 获取当前时间 Date 对象 */
    now(): Date;

    /** 获取当前时间的 ISO 8601 字符串 */
    nowISO(): string;

    /** 获取当前时间戳（毫秒） */
    nowTimestamp(): number;

    /** 解析 ISO 字符串为 Date 对象（保持现有逻辑不变） */
    parseISO(iso: string): Date;

    /** 检查当前是否处于模拟时间模式 */
    isMockMode(): boolean;

    /** 设置模拟时间（仅在 MockTimeService 中生效） */
    setMockTime(date: Date | string): void;

    /** 重置为真实时间（仅在 MockTimeService 中生效） */
    resetToRealTime(): void;
}

class RealTimeService implements TimeService {
    now(): Date {
        return new Date();
    }

    nowISO(): string {
        return new Date().toISOString();
    }

    nowTimestamp(): number {
        return Date.now();
    }

    parseISO(iso: string): Date {
        return new Date(iso);
    }

    isMockMode(): boolean {
        return false;
    }

    setMockTime(_date: Date | string): void {
        // 真实时间服务忽略设置调用
    }

    resetToRealTime(): void {
        // 真实时间服务忽略重置调用
    }
}

class MockTimeService implements TimeService {
    private mockTime: Date;

    constructor(initialTime?: Date) {
        this.mockTime = initialTime ?? new Date();
    }

    now(): Date {
        // 返回副本，避免外部修改内部状态
        return new Date(this.mockTime.getTime());
    }

    nowISO(): string {
        return this.mockTime.toISOString();
    }

    nowTimestamp(): number {
        return this.mockTime.getTime();
    }

    parseISO(iso: string): Date {
        return new Date(iso);
    }

    isMockMode(): boolean {
        return true;
    }

    setMockTime(date: Date | string): void {
        this.mockTime = typeof date === 'string' ? new Date(date) : date;
    }

    resetToRealTime(): void {
        this.mockTime = new Date();
    }
}

/**
 * 检测是否应该使用模拟时间模式
 * 优先级：全局变量 > 配置文件 > 默认真实时间
 */
function shouldUseMockMode(): boolean {
    // 1. 检查全局变量（开发时临时覆盖）
    if (typeof window !== 'undefined') {
        const globalMode = (window as any).__NEWANKI_TIME_MODE;
        if (globalMode === 'offline') {
            return true;
        }
        if (globalMode === 'online') {
            return false;
        }
    }

    // 2. 检查配置文件
    return TIME_MODE === 'offline';
}

/**
 * 从配置中获取模拟时间
 * 优先级：全局变量 > 配置文件 > 当前真实时间
 */
function getMockTimeFromConfig(): Date | null {
    // 1. 检查全局变量
    if (typeof window !== 'undefined') {
        const globalMockTime = (window as any).__NEWANKI_MOCK_TIME;
        if (globalMockTime) {
            const date = new Date(globalMockTime);
            if (!isNaN(date.getTime())) {
                return date;
            }
        }
    }

    // 2. 检查配置文件
    if (MOCK_TIME) {
        const date = new Date(MOCK_TIME);
        if (!isNaN(date.getTime())) {
            return date;
        }
    }

    return null;
}

/**
 * 创建时间服务实例
 */
export function createTimeService(): TimeService {
    const useMock = shouldUseMockMode();

    if (!useMock) {
        return new RealTimeService();
    }

    const service = new MockTimeService();
    const mockTime = getMockTimeFromConfig();
    if (mockTime) {
        service.setMockTime(mockTime);
    }

    return service;
}

// 全局单例实例
export const timeService: TimeService = createTimeService();

// 便捷访问函数
export function getTimeService(): TimeService {
    return timeService;
}