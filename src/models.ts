//都是一些字段，数据结构  TODO:添加New状态
export enum State {
	Learning = 1,  //新卡片或重新学习的卡片
	Review = 2,  //已掌握进入定期复习的卡片
	Relearning = 3,  //复习失败后重新学习的卡片
}

export enum Rating {
	Again = 1,
	Hard = 2,
	Good = 3,
	Easy = 4,
}

//卡片的属性字段
export interface CardData {
	cardId: string;  // 卡片ID唯一标识符
	question: string; // 问题
	answer: string;  // 答案
	sourceFile: string; //源文件路径
	lineStart: number;  //起始行号
	lineEnd: number;  //结束行号
	state: State;  //学习状态
	step: number | null;  //step
	ease: number | null;  //难度系数
	due: string;  //到期时间
	currentInterval: number | null;  //当前间隔
	createdAt: string;  //创建时间
}

//每次复习的评分和时间
export interface ReviewLogData {
	cardId: string;
	rating: Rating;
	reviewDatetime: string;
	prevState: State;
	prevEase: number | null;
	prevInterval: number | null;
}

//插件参数设置
export interface PluginSettings {
	learningSteps: number[]; //step
	graduatingInterval: number; //// 毕业间隔（天）
	easyInterval: number;  //// 简单间隔（天）
	relearningSteps: number[];  /// 重学步骤（分钟）
	minimumInterval: number; // 最小间隔（天）
	maximumInterval: number;  // 最大间隔（天）
	startingEase: number;  // 初始难度因子
	easyBonus: number;  // 简单奖励系数
	intervalModifier: number;   // 间隔修改器
	hardInterval: number;  // 困难间隔系数
	newInterval: number;  // 遗忘后新间隔系数
}

export const DEFAULT_SETTINGS: PluginSettings = {
	learningSteps: [1, 10],
	graduatingInterval: 1,
	easyInterval: 4,
	relearningSteps: [10],
	minimumInterval: 1,
	maximumInterval: 36500,
	startingEase: 2.5,
	easyBonus: 1.3,
	intervalModifier: 1.0,
	hardInterval: 1.2,
	newInterval: 0.0,
};

export interface PluginData {
	settings: PluginSettings;
	cards: Record<string, CardData[]>;
}

export const DEFAULT_PLUGIN_DATA: PluginData = {
	settings: { ...DEFAULT_SETTINGS },
	cards: {},
};
