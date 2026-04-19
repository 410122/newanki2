// 时间服务配置文件
// 修改 TIME_MODE 为 'offline' 启用离线测试模式
// 设置 MOCK_TIME 为 ISO 8601 字符串指定模拟当前时间

//export const TIME_MODE: 'online' | 'offline' = 'offline';
//export const MOCK_TIME: string | null = '2026-04-20T00:00:00.000Z';

export const TIME_MODE: 'online' | 'offline' = 'online';
export const MOCK_TIME: string | null = null;

// export const TIME_MODE: 'online' | 'offline' = 'offline';
// export const MOCK_TIME: string | null = '2026-04-23T00:08:00.000Z';